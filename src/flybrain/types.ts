export type NeuropilRegion =
  | "OpticLobe"
  | "CentralComplex"
  | "Protocerebrum"
  | "Descending"
  | "VNC";

export type Neurotransmitter = "acetylcholine" | "gaba" | "glutamate";

export interface ReceptiveField {
  azimuthMin: number;
  azimuthMax: number;
  elevationMin: number;
  elevationMax: number;
  preferredDirection?: "left" | "right" | "up" | "down" | "looming";
}

export interface NeuronData {
  id: number;
  name: string;
  type: string;
  hemisphere: "L" | "R" | "M";
  region: NeuropilRegion;
  neurotransmitter: Neurotransmitter;
  sign: 1 | -1;
  position: [number, number, number];
  role: string;
  receptiveField?: ReceptiveField;
}

export interface ConnectomeManifest {
  name: string;
  version: string;
  source: string;
  neuronCount: number;
  synapseCount: number;
  regions: Record<NeuropilRegion, number>;
  keyPathways: {
    loomingVPNs: string[];
    targetAzimuthVPNs: string[];
    compassIntegrators: string[];
    steeringDescending: string[];
    forwardThrustDescending: string[];
    strikeDescending: string[];
    brakingDescending: string[];
  };
  createdAt: string;
}

export interface ConnectomeCSRGraph {
  neurons: NeuronData[];
  indptr: Uint32Array;
  indices: Uint32Array;
  weights: Float32Array;
  signs: Int8Array;
  manifest: ConnectomeManifest;
}

export interface LIFParams {
  vRest: number; // mV (e.g. -65)
  vReset: number; // mV (e.g. -70)
  vThresh: number; // mV (e.g. -50)
  tauMembrane: number; // ms (e.g. 15.0)
  tauExc: number; // ms (e.g. 3.0)
  tauInh: number; // ms (e.g. 6.0)
  refractoryPeriod: number; // ms (e.g. 2.0)
  eExc: number; // mV (e.g. 0.0)
  eInh: number; // mV (e.g. -80.0)
  noiseStd: number; // mV / sqrt(ms)
  dt: number; // ms (e.g. 2.0 ms = 500 Hz)
}

export interface FlySensoryInput {
  shuttlePos: [number, number, number]; // [x, y, z] in court coordinates
  shuttleVel: [number, number, number]; // [vx, vy, vz]
  flyPos: [number, number, number]; // [x, y, z]
  flyHeading: number; // radians
  time: number; // seconds
}

export interface FlySensoryFeatures {
  distance: number;
  azimuthDeg: number;
  elevationDeg: number;
  relativeSpeed: number;
  loomingRate: number; // d(theta)/dt
  angularSizeDeg: number;
  retinalVelocityDegPerSec: number;
  isApproaching: boolean;
  incomingTrajectoryThreat: number; // 0 to 1
}

export interface FlyMotorCommand {
  vx: number; // Lateral target velocity (-2.5 to 2.5 m/s)
  vz: number; // Longitudinal target velocity (-3.0 to 3.0 m/s)
  steerTorque: number; // Heading rotational torque
  swingTriggered: boolean; // True if DNb01 / strike motor fired
  swingType: "forehand" | "backhand" | "overhead" | "lift";
  swingPower: number; // 0.0 to 1.0
  arousal: number; // 0.0 to 1.0 (wing buzzing / readiness)
  flightState: "HOVER" | "PURSUIT" | "STRIKE" | "RECOVER";
}

export interface NeuronTelemetryItem {
  id: number;
  name: string;
  type: string;
  region: NeuropilRegion;
  hemisphere: "L" | "R" | "M";
  neurotransmitter?: Neurotransmitter;
  v: number; // membrane potential
  spiking: boolean;
  firingRateHz: number;
}

export interface NeuralTelemetrySnapshot {
  timeMs: number;
  stepCount: number;
  neurons: NeuronTelemetryItem[];
  regionActivity: Record<NeuropilRegion, number>; // Mean firing rate per region in Hz
  sensoryFeatures: FlySensoryFeatures;
  motorCommand: FlyMotorCommand;
  activeSpikeCount: number;
  fps: number;
}

export interface InterventionSettings {
  silencedNeuronIds: number[];
  silencedTypes: string[]; // e.g. ["LC4", "DNa02"]
  synapticGain: number; // multiplier (default 1.0)
  backgroundDrive: number; // pA or mV base excitation
  refractoryMultiplier: number;
  mode: "fruitfly" | "classic";
}
