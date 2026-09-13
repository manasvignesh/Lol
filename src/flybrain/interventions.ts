import type { ConnectomeCSRGraph, InterventionSettings } from "./types";
import type { PathwayRegistry } from "./pathwayRegistry";

export class InterventionsManager {
  settings: InterventionSettings = {
    silencedNeuronIds: [],
    silencedTypes: [],
    synapticGain: 1.0,
    backgroundDrive: 1.2,
    sensoryNoise: 0.0,
    refractoryMultiplier: 1.0,
    mode: "fruitfly",
  };

  private silencedMask: Uint8Array;

  constructor(
    private readonly graph: ConnectomeCSRGraph,
    private readonly pathways: PathwayRegistry,
  ) {
    this.silencedMask = new Uint8Array(graph.neurons.length);
    this.rebuildMask();
  }

  isSilenced(neuronIndex: number): boolean {
    return this.silencedMask[neuronIndex] === 1;
  }

  isTypeSilenced(typePrefix: string): boolean {
    return this.settings.silencedTypes.some(
      (t) =>
        t === typePrefix ||
        t.startsWith(typePrefix) ||
        typePrefix.startsWith(t),
    );
  }

  getMask(): Uint8Array {
    return this.silencedMask;
  }

  setSilencedTypes(types: string[]) {
    this.settings.silencedTypes = [...types];
    this.rebuildMask();
  }

  toggleTypeSilencing(typePrefix: string, silence?: boolean) {
    const idx = this.settings.silencedTypes.indexOf(typePrefix);
    const shouldSilence = silence !== undefined ? silence : idx === -1;
    if (shouldSilence && idx === -1) {
      this.settings.silencedTypes.push(typePrefix);
    } else if (!shouldSilence && idx !== -1) {
      this.settings.silencedTypes.splice(idx, 1);
    }
    this.rebuildMask();
  }

  setSilencedNeuronIds(ids: number[]) {
    this.settings.silencedNeuronIds = [...ids];
    this.rebuildMask();
  }

  setSynapticGain(gain: number) {
    this.settings.synapticGain = Math.max(0.0, Math.min(4.0, gain));
  }

  setBackgroundDrive(drive: number) {
    this.settings.backgroundDrive = Math.max(0.0, Math.min(5.0, drive));
  }

  setMode(mode: "fruitfly" | "classic") {
    this.settings.mode = mode;
  }

  reset() {
    this.settings = {
      silencedNeuronIds: [],
      silencedTypes: [],
      synapticGain: 1.0,
      backgroundDrive: 1.2,
      sensoryNoise: 0.0,
      refractoryMultiplier: 1.0,
      mode: "fruitfly",
    };
    this.rebuildMask();
  }

  getMatchedNeuronsForType(typePrefix: string): {
    indices: number[];
    bodyIds: string[];
  } {
    const indices: number[] = [];
    const bodyIds: string[] = [];
    const neurons = this.graph.neurons;

    for (let i = 0; i < neurons.length; i++) {
      const n = neurons[i];
      if (n.type === typePrefix || n.type.startsWith(typePrefix)) {
        indices.push(i);
        bodyIds.push(n.bodyId);
      }
    }
    return { indices, bodyIds };
  }

  private rebuildMask() {
    this.silencedMask.fill(0);

    // Direct runtime indices
    for (const id of this.settings.silencedNeuronIds) {
      if (id >= 0 && id < this.silencedMask.length) {
        this.silencedMask[id] = 1;
      }
    }

    // By neuron type prefix
    const neurons = this.graph.neurons;
    for (const typePrefix of this.settings.silencedTypes) {
      for (let i = 0; i < neurons.length; i++) {
        const t = neurons[i].type || "";
        if (t === typePrefix || t.startsWith(typePrefix)) {
          this.silencedMask[i] = 1;
        }
      }
    }
  }
}
