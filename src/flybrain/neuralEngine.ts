import type {
  ConnectomeCSRGraph,
  FlyMotorCommand,
  FlySensoryFeatures,
  FlySensoryInput,
  InterventionSettings,
  LIFParams,
  NeuralTelemetrySnapshot,
  NeuronTelemetryItem,
  NeuropilRegion,
} from "./types";
import { PathwayRegistry } from "./pathwayRegistry";
import { InterventionsManager } from "./interventions";
import { SensoryEncoder } from "./sensoryEncoder";
import { MotorDecoder } from "./motorDecoder";

export const DEFAULT_LIF_PARAMS: LIFParams = {
  vRest: -65.0, // mV
  vReset: -70.0, // mV
  vThresh: -50.0, // mV
  tauMembrane: 15.0, // ms
  tauExc: 3.5, // ms
  tauInh: 6.0, // ms
  refractoryPeriod: 2.5, // ms
  eExc: 0.0, // mV
  eInh: -80.0, // mV
  noiseStd: 0.8, // mV / sqrt(ms)
  dt: 2.0, // ms (500 Hz simulation step)
};

export class NeuralEngine {
  readonly pathways: PathwayRegistry;
  readonly interventions: InterventionsManager;
  readonly sensoryEncoder: SensoryEncoder;
  readonly motorDecoder: MotorDecoder;

  readonly numNeurons: number;
  readonly v: Float32Array;
  readonly gExc: Float32Array;
  readonly gInh: Float32Array;
  readonly iExt: Float32Array;
  readonly refractoryTimer: Float32Array;
  readonly spiking: Uint8Array;
  readonly firingRates: Float32Array;

  private stepCount = 0;
  private simTimeMs = 0;
  private activeSpikesInStep = 0;
  private lastMotorCommand: FlyMotorCommand;

  constructor(
    public readonly graph: ConnectomeCSRGraph,
    public params: LIFParams = { ...DEFAULT_LIF_PARAMS },
  ) {
    this.numNeurons = graph.neurons.length;
    this.pathways = new PathwayRegistry(graph);
    this.interventions = new InterventionsManager(graph, this.pathways);
    this.sensoryEncoder = new SensoryEncoder(this.pathways);
    this.motorDecoder = new MotorDecoder(this.pathways);

    this.v = new Float32Array(this.numNeurons);
    this.gExc = new Float32Array(this.numNeurons);
    this.gInh = new Float32Array(this.numNeurons);
    this.iExt = new Float32Array(this.numNeurons);
    this.refractoryTimer = new Float32Array(this.numNeurons);
    this.spiking = new Uint8Array(this.numNeurons);
    this.firingRates = new Float32Array(this.numNeurons);

    this.lastMotorCommand = {
      vx: 0,
      vz: 0,
      steerTorque: 0,
      swingTriggered: false,
      swingType: "forehand",
      swingPower: 0.5,
      arousal: 0.2,
      flightState: "HOVER",
    };

    this.reset();
  }

  reset() {
    this.v.fill(this.params.vRest);
    this.gExc.fill(0);
    this.gInh.fill(0);
    this.iExt.fill(0);
    this.refractoryTimer.fill(0);
    this.spiking.fill(0);
    this.firingRates.fill(0);
    this.stepCount = 0;
    this.simTimeMs = 0;
    this.activeSpikesInStep = 0;
    this.motorDecoder.reset();
  }

  /**
   * Run one discrete LIF simulation time step (dt ms).
   */
  step(sensoryInput?: FlySensoryInput): FlyMotorCommand {
    const dt = this.params.dt;
    const {
      vRest,
      vReset,
      vThresh,
      tauMembrane,
      tauExc,
      tauInh,
      refractoryPeriod,
      eExc,
      eInh,
      noiseStd,
    } = this.params;
    const { synapticGain, backgroundDrive, refractoryMultiplier } =
      this.interventions.settings;
    const silenced = this.interventions.getMask();

    // 1. Process sensory input
    let features: FlySensoryFeatures;
    if (sensoryInput) {
      features = this.sensoryEncoder.extractFeatures(sensoryInput);
      this.sensoryEncoder.encode(features, this.iExt);
    } else {
      features = this.sensoryEncoder.getLastFeatures();
    }

    this.activeSpikesInStep = 0;

    // Decay factors
    const decayExc = Math.exp(-dt / tauExc);
    const decayInh = Math.exp(-dt / tauInh);
    const rateFilterAlpha = 1.0 - Math.exp(-dt / 40.0); // 40ms smoothing

    // 2. LIF Membrane Integration
    for (let i = 0; i < this.numNeurons; i++) {
      if (silenced[i] === 1) {
        this.v[i] = vRest;
        this.refractoryTimer[i] = 0;
        this.spiking[i] = 0;
        this.firingRates[i] = (1.0 - rateFilterAlpha) * this.firingRates[i];
        continue;
      }

      if (this.refractoryTimer[i] > 0) {
        this.refractoryTimer[i] -= dt;
        this.v[i] = vReset;
        this.spiking[i] = 0;
        this.firingRates[i] = (1.0 - rateFilterAlpha) * this.firingRates[i];
        continue;
      }

      const vi = this.v[i];
      const iSyn = this.gExc[i] * (eExc - vi) + this.gInh[i] * (eInh - vi);
      const iLeak = vRest - vi;
      const noise = (Math.random() - 0.5) * 2.0 * noiseStd;
      const totalI = iLeak + iSyn + this.iExt[i] + backgroundDrive + noise;

      const dv = (dt / tauMembrane) * totalI;
      const nextV = vi + dv;

      // Spike detection
      if (nextV >= vThresh) {
        this.v[i] = vReset;
        this.spiking[i] = 1;
        this.refractoryTimer[i] = refractoryPeriod * refractoryMultiplier;
        this.activeSpikesInStep++;
        this.firingRates[i] =
          (1.0 - rateFilterAlpha) * this.firingRates[i] +
          rateFilterAlpha * (1000.0 / dt);
      } else {
        this.v[i] = nextV;
        this.spiking[i] = 0;
        this.firingRates[i] = (1.0 - rateFilterAlpha) * this.firingRates[i];
      }
    }

    // 3. Synaptic spike transmission across CSR connectome graph
    const indptr = this.graph.indptr;
    const indices = this.graph.indices;
    const weights = this.graph.weights;
    const signs = this.graph.signs;

    for (let pre = 0; pre < this.numNeurons; pre++) {
      if (this.spiking[pre] === 1) {
        const start = indptr[pre];
        const end = indptr[pre + 1];

        for (let k = start; k < end; k++) {
          const post = indices[k];
          if (silenced[post] === 1) continue;

          const w = weights[k] * synapticGain * 0.05;
          const s = signs[k];

          if (s > 0) {
            this.gExc[post] += w;
          } else {
            this.gInh[post] += w;
          }
        }
      }
    }

    // 4. Conductance decay and clear sensory input buffer
    for (let i = 0; i < this.numNeurons; i++) {
      this.gExc[i] *= decayExc;
      this.gInh[i] *= decayInh;
      this.iExt[i] = 0;
    }

    // 5. Decode motor commands
    const motorCommand = this.motorDecoder.decode(
      this.firingRates,
      features,
      dt * 0.001,
    );
    this.lastMotorCommand = motorCommand;

    this.stepCount++;
    this.simTimeMs += dt;

    return motorCommand;
  }

  /**
   * Advance simulation for a specified delta time (in seconds).
   */
  update(dtSec: number, sensoryInput?: FlySensoryInput): FlyMotorCommand {
    const targetDtMs = dtSec * 1000;
    const stepDtMs = this.params.dt;
    const steps = Math.max(1, Math.round(targetDtMs / stepDtMs));

    let lastCmd = this.lastMotorCommand;
    for (let s = 0; s < steps; s++) {
      lastCmd = this.step(sensoryInput);
    }
    return lastCmd;
  }

  /**
   * Generate lightweight telemetry snapshot for UI visualizer.
   */
  getTelemetry(fps: number = 60): NeuralTelemetrySnapshot {
    const neurons = this.graph.neurons;
    const items: NeuronTelemetryItem[] = new Array(this.numNeurons);

    const regionSums: Record<NeuropilRegion, number> = {
      OpticLobe: 0,
      CentralComplex: 0,
      Protocerebrum: 0,
      Descending: 0,
      VNC: 0,
    };
    const regionCounts: Record<NeuropilRegion, number> = {
      OpticLobe: 0,
      CentralComplex: 0,
      Protocerebrum: 0,
      Descending: 0,
      VNC: 0,
    };

    for (let i = 0; i < this.numNeurons; i++) {
      const n = neurons[i];
      const rate = this.firingRates[i];
      items[i] = {
        id: n.id,
        name: n.name,
        type: n.type,
        region: n.region,
        hemisphere: n.hemisphere,
        neurotransmitter: n.neurotransmitter,
        v: this.v[i],
        spiking: this.spiking[i] === 1,
        firingRateHz: rate,
      };

      if (regionCounts[n.region] !== undefined) {
        regionSums[n.region] += rate;
        regionCounts[n.region]++;
      }
    }

    const regionActivity: Record<NeuropilRegion, number> = {
      OpticLobe: regionSums.OpticLobe / Math.max(1, regionCounts.OpticLobe),
      CentralComplex:
        regionSums.CentralComplex / Math.max(1, regionCounts.CentralComplex),
      Protocerebrum:
        regionSums.Protocerebrum / Math.max(1, regionCounts.Protocerebrum),
      Descending: regionSums.Descending / Math.max(1, regionCounts.Descending),
      VNC: regionSums.VNC / Math.max(1, regionCounts.VNC),
    };

    return {
      timeMs: this.simTimeMs,
      stepCount: this.stepCount,
      neurons: items,
      regionActivity,
      sensoryFeatures: this.sensoryEncoder.getLastFeatures(),
      motorCommand: this.lastMotorCommand,
      activeSpikeCount: this.activeSpikesInStep,
      fps,
    };
  }
}
