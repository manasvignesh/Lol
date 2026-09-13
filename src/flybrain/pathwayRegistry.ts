import type { ConnectomeCSRGraph, NeuronData, NeuropilRegion } from "./types";

export interface PathwayIndex {
  // Visual Projection Neurons (VPNs)
  lc4Left: number[];
  lc4Right: number[];
  lc6Left: number[];
  lc6Right: number[];
  lc10Left: number[];
  lc10Right: number[];
  lplcLeft: number[];
  lplcRight: number[];

  // Central Complex Compass & Navigation
  epg: number[];
  penLeft: number[];
  penRight: number[];
  pfnLeft: number[];
  pfnRight: number[];
  pflLeft: number[];
  pflRight: number[];

  // Descending Sensorimotor Pathways
  dna01Left: number[];
  dna01Right: number[];
  dna02Left: number[];
  dna02Right: number[];
  dnp01: number[];
  dnb01Left: number[];
  dnb01Right: number[];
  mdnLeft: number[];
  mdnRight: number[];
  allDescending: number[];

  // VNC Motor effectors
  vncMotor: number[];

  // Region and type index maps
  byRegion: Record<NeuropilRegion, number[]>;
  byType: Map<string, number[]>;
  bodyIdToIndex: Map<string, number>;
}

export class PathwayRegistry {
  readonly index: PathwayIndex;

  constructor(public readonly graph: ConnectomeCSRGraph) {
    this.index = this.buildIndex(graph.neurons);
  }

  private buildIndex(neurons: NeuronData[]): PathwayIndex {
    const idx: PathwayIndex = {
      lc4Left: [],
      lc4Right: [],
      lc6Left: [],
      lc6Right: [],
      lc10Left: [],
      lc10Right: [],
      lplcLeft: [],
      lplcRight: [],
      epg: [],
      penLeft: [],
      penRight: [],
      pfnLeft: [],
      pfnRight: [],
      pflLeft: [],
      pflRight: [],
      dna01Left: [],
      dna01Right: [],
      dna02Left: [],
      dna02Right: [],
      dnp01: [],
      dnb01Left: [],
      dnb01Right: [],
      mdnLeft: [],
      mdnRight: [],
      allDescending: [],
      vncMotor: [],
      byRegion: {
        OpticLobe: [],
        CentralComplex: [],
        Protocerebrum: [],
        Descending: [],
        VNC: [],
      },
      byType: new Map<string, number[]>(),
      bodyIdToIndex: new Map<string, number>(),
    };

    for (let i = 0; i < neurons.length; i++) {
      const n = neurons[i];
      const neuronIndex = n.index !== undefined ? n.index : i;
      const t = n.type || "";
      const hemi = n.hemisphere || (n.pos[0] < 0 ? "L" : "R");

      idx.bodyIdToIndex.set(n.bodyId, neuronIndex);

      // Region grouping
      if (idx.byRegion[n.region]) {
        idx.byRegion[n.region].push(neuronIndex);
      }

      // Type grouping
      if (!idx.byType.has(t)) {
        idx.byType.set(t, []);
      }
      idx.byType.get(t)!.push(neuronIndex);

      // 1. Visual Projection Neurons
      if (t === "LC4") {
        if (hemi === "L") idx.lc4Left.push(neuronIndex);
        else idx.lc4Right.push(neuronIndex);
      } else if (t === "LC6") {
        if (hemi === "L") idx.lc6Left.push(neuronIndex);
        else idx.lc6Right.push(neuronIndex);
      } else if (t.startsWith("LC10")) {
        if (hemi === "L") idx.lc10Left.push(neuronIndex);
        else idx.lc10Right.push(neuronIndex);
      } else if (t.startsWith("LPLC")) {
        if (hemi === "L") idx.lplcLeft.push(neuronIndex);
        else idx.lplcRight.push(neuronIndex);
      }

      // 2. Central Complex
      else if (t.startsWith("EPG")) {
        idx.epg.push(neuronIndex);
      } else if (t.startsWith("PEN")) {
        if (hemi === "L") idx.penLeft.push(neuronIndex);
        else idx.penRight.push(neuronIndex);
      } else if (t.startsWith("PFN")) {
        if (hemi === "L") idx.pfnLeft.push(neuronIndex);
        else idx.pfnRight.push(neuronIndex);
      } else if (t.startsWith("PFL")) {
        if (hemi === "L") idx.pflLeft.push(neuronIndex);
        else idx.pflRight.push(neuronIndex);
      }

      // 3. Descending Channels
      if (
        n.region === "Descending" ||
        n.superclass === "descending_neuron" ||
        t.startsWith("DN")
      ) {
        idx.allDescending.push(neuronIndex);

        if (t === "DNa01") {
          if (hemi === "L") idx.dna01Left.push(neuronIndex);
          else idx.dna01Right.push(neuronIndex);
        } else if (t === "DNa02") {
          if (hemi === "L") idx.dna02Left.push(neuronIndex);
          else idx.dna02Right.push(neuronIndex);
        } else if (t === "DNp01") {
          idx.dnp01.push(neuronIndex);
        } else if (t === "DNb01") {
          if (hemi === "L") idx.dnb01Left.push(neuronIndex);
          else idx.dnb01Right.push(neuronIndex);
        } else if (t === "MDN") {
          if (hemi === "L") idx.mdnLeft.push(neuronIndex);
          else idx.mdnRight.push(neuronIndex);
        }
      }

      // 4. VNC Motor Effectors
      if (n.region === "VNC" || n.superclass === "vnc_motor") {
        idx.vncMotor.push(neuronIndex);
      }
    }

    return idx;
  }
}
