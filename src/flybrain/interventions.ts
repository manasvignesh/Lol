import type { ConnectomeCSRGraph, InterventionSettings } from "./types";
import type { PathwayRegistry } from "./pathwayRegistry";

export class InterventionsManager {
  settings: InterventionSettings = {
    silencedNeuronIds: [],
    silencedTypes: [],
    synapticGain: 1.0,
    backgroundDrive: 1.2,
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

  isSilenced(neuronId: number): boolean {
    return this.silencedMask[neuronId] === 1;
  }

  getMask(): Uint8Array {
    return this.silencedMask;
  }

  setSilencedTypes(types: string[]) {
    this.settings.silencedTypes = [...types];
    this.rebuildMask();
  }

  toggleTypeSilencing(type: string, silence?: boolean) {
    const idx = this.settings.silencedTypes.indexOf(type);
    const shouldSilence = silence !== undefined ? silence : idx === -1;
    if (shouldSilence && idx === -1) {
      this.settings.silencedTypes.push(type);
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
      refractoryMultiplier: 1.0,
      mode: "fruitfly",
    };
    this.rebuildMask();
  }

  private rebuildMask() {
    this.silencedMask.fill(0);

    // Direct IDs
    for (const id of this.settings.silencedNeuronIds) {
      if (id >= 0 && id < this.silencedMask.length) {
        this.silencedMask[id] = 1;
      }
    }

    // By neuron type
    for (const type of this.settings.silencedTypes) {
      const ids = this.pathways.index.byType.get(type);
      if (ids) {
        for (const id of ids) {
          this.silencedMask[id] = 1;
        }
      }
    }
  }
}
