import { ConnectomeLoader } from "./connectomeLoader";
import { NeuralEngine } from "./neuralEngine";
import type {
  ConnectomeCSRGraph,
  FlyMotorCommand,
  FlySensoryInput,
  InterventionSettings,
  NeuralTelemetrySnapshot,
} from "./types";

export class NeuralBridge {
  private worker: Worker | null = null;
  private localEngine: NeuralEngine | null = null;
  private isReady = false;
  private currentTelemetry: NeuralTelemetrySnapshot | null = null;
  private currentMotorCommand: FlyMotorCommand = {
    vx: 0,
    vz: 0,
    steerTorque: 0,
    swingTriggered: false,
    swingType: "forehand",
    swingPower: 0.5,
    arousal: 0.2,
    flightState: "HOVER",
  };
  private graph: ConnectomeCSRGraph | null = null;

  constructor() {
    if (
      typeof process !== "undefined" &&
      process.versions?.node &&
      typeof window === "undefined"
    ) {
      try {
        this.graph = ConnectomeLoader.loadSync();
        this.localEngine = new NeuralEngine(this.graph);
        this.isReady = true;
        this.currentTelemetry = this.localEngine.getTelemetry();
      } catch (e) {
        // Fallback or async init
      }
    }
  }

  async init(
    preferWorker: boolean = true,
    baseUrl: string = "/data/connectome",
  ) {
    try {
      this.graph = await ConnectomeLoader.load(baseUrl);
      this.localEngine = new NeuralEngine(this.graph);

      if (
        preferWorker &&
        typeof window !== "undefined" &&
        typeof Worker !== "undefined"
      ) {
        try {
          this.worker = new Worker("/neural-worker.js");
          this.worker.onmessage = (e) => {
            const { type, payload } = e.data;
            if (type === "READY") {
              this.isReady = true;
            } else if (type === "TELEMETRY") {
              this.currentTelemetry = payload;
              if (payload.motorCommand) {
                this.currentMotorCommand = payload.motorCommand;
              }
            }
          };
          this.worker.postMessage({ type: "INIT", payload: { baseUrl } });
        } catch (workerErr) {
          console.warn(
            "Could not spawn worker, falling back to main-thread LIF engine:",
            workerErr,
          );
          this.worker = null;
        }
      }

      this.isReady = true;
      this.currentTelemetry = this.localEngine.getTelemetry();
      return this.graph;
    } catch (err) {
      console.error("Failed to initialize NeuralBridge:", err);
      throw err;
    }
  }

  get ready(): boolean {
    return this.isReady;
  }

  getConnectomeGraph(): ConnectomeCSRGraph | null {
    return this.graph;
  }

  getEngine(): NeuralEngine | null {
    return this.localEngine;
  }

  update(dtSec: number, sensoryInput: FlySensoryInput): FlyMotorCommand {
    if (!this.isReady || !this.localEngine) {
      return this.currentMotorCommand;
    }

    if (this.worker) {
      this.worker.postMessage({ type: "SENSORY", payload: sensoryInput });
      // If worker telemetry has arrived, return the decoded motor command
      return this.currentMotorCommand;
    } else {
      // Step local engine directly
      const cmd = this.localEngine.update(dtSec, sensoryInput);
      this.currentMotorCommand = cmd;
      this.currentTelemetry = this.localEngine.getTelemetry();
      return cmd;
    }
  }

  applyInterventions(settings: Partial<InterventionSettings>) {
    if (this.localEngine) {
      if (settings.silencedTypes !== undefined)
        this.localEngine.interventions.setSilencedTypes(settings.silencedTypes);
      if (settings.silencedNeuronIds !== undefined)
        this.localEngine.interventions.setSilencedNeuronIds(
          settings.silencedNeuronIds,
        );
      if (settings.synapticGain !== undefined)
        this.localEngine.interventions.setSynapticGain(settings.synapticGain);
      if (settings.backgroundDrive !== undefined)
        this.localEngine.interventions.setBackgroundDrive(
          settings.backgroundDrive,
        );
      if (settings.mode !== undefined)
        this.localEngine.interventions.setMode(settings.mode);
    }

    if (this.worker) {
      this.worker.postMessage({ type: "INTERVENTIONS", payload: settings });
    }
  }

  reset() {
    if (this.localEngine) {
      this.localEngine.reset();
      this.currentTelemetry = this.localEngine.getTelemetry();
    }
    if (this.worker) {
      this.worker.postMessage({ type: "RESET" });
    }
  }

  getTelemetry(): NeuralTelemetrySnapshot | null {
    if (this.worker && this.currentTelemetry) {
      return this.currentTelemetry;
    }
    return this.localEngine ? this.localEngine.getTelemetry() : null;
  }

  getMotorCommand(): FlyMotorCommand {
    return this.currentMotorCommand;
  }
}
