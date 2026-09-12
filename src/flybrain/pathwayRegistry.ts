import type { ConnectomeCSRGraph, NeuronData, NeuropilRegion } from "./types";

export interface PathwayIndex {
  // Visual Projection Neurons
  lc4Left: number[];
  lc4Right: number[];
  lc6Left: number[];
  lc6Right: number[];
  lc10Left: number[];
  lc10Right: number[];
  lplc2Left: number[];
  lplc2Right: number[];

  // Central Complex Compass & Navigation
  epg: number[];
  penLeft: number[];
  penRight: number[];
  pfnLeft: number[];
  pfnRight: number[];
  fb: number[];

  // Premotor Hubs
  lalLeft: number[];
  lalRight: number[];

  // Descending Sensorimotor Pathways
  dna01Left: number[];
  dna01Right: number[];
  dna02Left: number[];
  dna02Right: number[];
  dnp01: number[];
  dnb01Left: number[];
  dnb01Right: number[];
  giantFiberLeft: number[];
  giantFiberRight: number[];
  mdnLeft: number[];
  mdnRight: number[];

  // Motor effectors
  motorSteerLeft: number[];
  motorSteerRight: number[];
  motorThrust: number[];
  motorStrikeForehand: number[];
  motorStrikeBackhand: number[];
  motorBrake: number[];

  // Region index maps
  byRegion: Record<NeuropilRegion, number[]>;
  byType: Map<string, number[]>;
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
      lplc2Left: [],
      lplc2Right: [],
      epg: [],
      penLeft: [],
      penRight: [],
      pfnLeft: [],
      pfnRight: [],
      fb: [],
      lalLeft: [],
      lalRight: [],
      dna01Left: [],
      dna01Right: [],
      dna02Left: [],
      dna02Right: [],
      dnp01: [],
      dnb01Left: [],
      dnb01Right: [],
      giantFiberLeft: [],
      giantFiberRight: [],
      mdnLeft: [],
      mdnRight: [],
      motorSteerLeft: [],
      motorSteerRight: [],
      motorThrust: [],
      motorStrikeForehand: [],
      motorStrikeBackhand: [],
      motorBrake: [],
      byRegion: {
        OpticLobe: [],
        CentralComplex: [],
        Protocerebrum: [],
        Descending: [],
        VNC: [],
      },
      byType: new Map<string, number[]>(),
    };

    for (const n of neurons) {
      // Region grouping
      if (idx.byRegion[n.region]) {
        idx.byRegion[n.region].push(n.id);
      }

      // Type grouping
      if (!idx.byType.has(n.type)) {
        idx.byType.set(n.type, []);
      }
      idx.byType.get(n.type)!.push(n.id);

      // Specific pathway mapping
      if (n.type === "LC4") {
        if (n.hemisphere === "L") idx.lc4Left.push(n.id);
        else idx.lc4Right.push(n.id);
      } else if (n.type === "LC6") {
        if (n.hemisphere === "L") idx.lc6Left.push(n.id);
        else idx.lc6Right.push(n.id);
      } else if (n.type === "LC10") {
        if (n.hemisphere === "L") idx.lc10Left.push(n.id);
        else idx.lc10Right.push(n.id);
      } else if (n.type === "LPLC2") {
        if (n.hemisphere === "L") idx.lplc2Left.push(n.id);
        else idx.lplc2Right.push(n.id);
      } else if (n.type === "EPG") {
        idx.epg.push(n.id);
      } else if (n.type === "P-EN") {
        if (n.hemisphere === "L") idx.penLeft.push(n.id);
        else idx.penRight.push(n.id);
      } else if (n.type === "P-FN") {
        if (n.hemisphere === "L") idx.pfnLeft.push(n.id);
        else idx.pfnRight.push(n.id);
      } else if (n.type === "FB") {
        idx.fb.push(n.id);
      } else if (n.type === "LAL") {
        if (n.hemisphere === "L") idx.lalLeft.push(n.id);
        else idx.lalRight.push(n.id);
      } else if (n.type === "DNa01") {
        if (n.hemisphere === "L") idx.dna01Left.push(n.id);
        else idx.dna01Right.push(n.id);
      } else if (n.type === "DNa02") {
        if (n.hemisphere === "L") idx.dna02Left.push(n.id);
        else idx.dna02Right.push(n.id);
      } else if (n.type === "DNp01") {
        idx.dnp01.push(n.id);
      } else if (n.type === "DNb01") {
        if (n.hemisphere === "L") idx.dnb01Left.push(n.id);
        else idx.dnb01Right.push(n.id);
      } else if (n.type === "GiantFiber") {
        if (n.hemisphere === "L") idx.giantFiberLeft.push(n.id);
        else idx.giantFiberRight.push(n.id);
      } else if (n.type === "MDN") {
        if (n.hemisphere === "L") idx.mdnLeft.push(n.id);
        else idx.mdnRight.push(n.id);
      } else if (n.type === "MotorNeuron") {
        if (n.name.includes("Steer_L")) idx.motorSteerLeft.push(n.id);
        else if (n.name.includes("Steer_R")) idx.motorSteerRight.push(n.id);
        else if (n.name.includes("Thrust")) idx.motorThrust.push(n.id);
        else if (n.name.includes("Strike_Forehand"))
          idx.motorStrikeForehand.push(n.id);
        else if (n.name.includes("Strike_Backhand"))
          idx.motorStrikeBackhand.push(n.id);
        else if (n.name.includes("Brake")) idx.motorBrake.push(n.id);
      }
    }

    return idx;
  }
}
