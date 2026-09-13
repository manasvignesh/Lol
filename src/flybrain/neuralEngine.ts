import type {
  ActivePathwayNode,
  BiologicalMotorSignals,
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
import { EmbodimentAdapter } from "./embodimentAdapter";

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
  readonly embodimentAdapter: EmbodimentAdapter;

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
  private rngState: number | null = null;

  public params: LIFParams;

  constructor(
    public readonly graph: ConnectomeCSRGraph,
    params?: Partial<LIFParams>,
  ) {
    this.params = { ...DEFAULT_LIF_PARAMS, ...params };
    this.numNeurons = graph.neurons.length;
    this.pathways = new PathwayRegistry(graph);
    this.interventions = new InterventionsManager(graph, this.pathways);
    this.sensoryEncoder = new SensoryEncoder(this.pathways);
    this.motorDecoder = new MotorDecoder(this.pathways);
    this.embodimentAdapter = new EmbodimentAdapter();

    if (this.params.seed !== undefined) {
      this.rngState = this.params.seed >>> 0 || 1;
    }

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

  private nextRandom(): number {
    if (this.rngState === null) {
      return Math.random();
    }
    // Mulberry32 deterministic PRNG
    let t = (this.rngState += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  setSeed(seed: number | null) {
    if (seed !== null) {
      this.rngState = seed >>> 0 || 1;
    } else {
      this.rngState = null;
    }
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
    this.embodimentAdapter.reset();
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

    // 1. Process optical sensory input
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
    const rateFilterAlpha = 1.0 - Math.exp(-dt / 40.0); // 40ms continuous rate filter

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
      const noise = (this.nextRandom() - 0.5) * 2.0 * noiseStd;
      const totalI = iLeak + iSyn + this.iExt[i] + backgroundDrive + noise;

      const dv = (dt / tauMembrane) * totalI;
      const nextV = vi + dv;

      // Spike emission upon threshold crossing
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

    // 5. Connectome-constrained motor decoding from MaleCNS descending firing rates
    const bioSignals = this.motorDecoder.decode(this.firingRates);

    // 6. Virtual badminton embodiment adaptation
    const motorCommand = this.embodimentAdapter.adapt(
      bioSignals,
      features,
      dt * 0.001,
      sensoryInput,
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
   * Computes the strongest active real path from stimulated visual neurons to descending outputs.
   */
  computeActivePathway(): ActivePathwayNode[] {
    const neurons = this.graph.neurons;
    const indptr = this.graph.indptr;
    const indices = this.graph.indices;
    const weights = this.graph.weights;

    // Find most active visual seed
    let topVis = -1;
    let maxVisRate = 0;
    for (const id of [
      ...this.pathways.index.lc4Left,
      ...this.pathways.index.lc4Right,
      ...this.pathways.index.lc6Left,
      ...this.pathways.index.lc6Right,
      ...this.pathways.index.lc10Left,
      ...this.pathways.index.lc10Right,
    ]) {
      if (this.firingRates[id] > maxVisRate) {
        maxVisRate = this.firingRates[id];
        topVis = id;
      }
    }

    if (topVis === -1 || maxVisRate < 2.0) {
      return [];
    }

    const path: ActivePathwayNode[] = [];
    let current = topVis;
    const visited = new Set<number>();

    for (let hop = 0; hop < 4; hop++) {
      visited.add(current);
      const n = neurons[current];
      path.push({
        index: current,
        bodyId: n.bodyId,
        type: n.type,
        region: n.region,
        rateHz: this.firingRates[current],
      });

      if (n.region === "Descending" || n.region === "VNC") {
        break;
      }

      // Find strongest active downstream neighbor
      const start = indptr[current];
      const end = indptr[current + 1];
      let bestNext = -1;
      let bestScore = -1;

      for (let k = start; k < end; k++) {
        const post = indices[k];
        if (visited.has(post)) continue;
        const score = weights[k] * (this.firingRates[post] + 0.1);
        if (score > bestScore) {
          bestScore = score;
          bestNext = post;
        }
      }

      if (bestNext === -1) break;
      current = bestNext;
    }

    return path;
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
        index: n.index !== undefined ? n.index : i,
        bodyId: n.bodyId,
        name: n.name,
        type: n.type,
        instance: n.instance,
        region: n.region,
        hemisphere: n.hemisphere,
        neurotransmitter: n.neurotransmitter,
        pos: n.pos,
        coordinateType: n.coordinateType,
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

    const edgeCount = this.graph.indices.length;
    const biologicalSynapseTotal =
      this.graph.manifest.biologicalSynapseTotal ??
      (this.graph.biologicalWeights
        ? this.graph.biologicalWeights.reduce((a, b) => a + b, 0)
        : edgeCount);

    return {
      timeMs: this.simTimeMs,
      stepCount: this.stepCount,
      provenance: this.graph.manifest.provenance || "malecns-real",
      neuronCount: this.numNeurons,
      edgeCount,
      biologicalSynapseTotal,
      neurons: items,
      regionActivity,
      sensoryFeatures: this.sensoryEncoder.getLastFeatures(),
      motorCommand: this.lastMotorCommand,
      activeSpikeCount: this.activeSpikesInStep,
      activePathway: this.computeActivePathway(),
      fps,
    };
  }
}
