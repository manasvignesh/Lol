export type NeuropilRegion =
  | "OpticLobe"
  | "CentralComplex"
  | "Protocerebrum"
  | "Descending"
  | "VNC";

export type Neurotransmitter =
  | "acetylcholine"
  | "gaba"
  | "glutamate"
  | "histamine"
  | "dopamine"
  | "octopamine"
  | "serotonin"
  | "unclear";

export type ConnectomeProvenance =
  | "malecns-real"
  | "test-fixture"
  | "synthetic";

export interface ReceptiveField {
  azimuthMin: number;
  azimuthMax: number;
  elevationMin: number;
  elevationMax: number;
  preferredDirection?: "left" | "right" | "up" | "down" | "looming";
}

export interface NeuronData {
  index: number; // Runtime matrix index 0..N-1
  bodyId: string; // REAL MaleCNS body ID from Janelia reconstruction (e.g. "10001")
  name: string; // Display name with type, instance, and body ID
  type: string; // Biological cell type (e.g. "DNp01", "LC4", "EPG", "DNa02")
  instance?: string | null;
  hemisphere?: "L" | "R" | "bilateral" | "unknown" | null;
  superclass?: string | null;
  region: NeuropilRegion;
  neurotransmitter?: Neurotransmitter | string | null;
  pos: [number, number, number]; // Real MaleCNS normalized anatomical coordinates
  coordinateType?: "soma_voxel" | "partner_centroid" | "neuropil_fallback";
  sourceDataset: "male-cns:v1.0";
  receptiveField?: ReceptiveField;
}

export interface BiologicalMotorSignals {
  steeringTorque: number; // Decoded from DNa01, DNa02, PFL3 lateral rate asymmetry (-1.0 to 1.0)
  forwardThrust: number; // Decoded from DNp01 and VNC motor firing rate (0.0 to 1.0)
  brakingDrive: number; // Decoded from MDN firing rate (0.0 to 1.0)
  turnImpulse: number; // Decoded from DNb01 flight-turning/saccade descending activity (0.0 to 1.0)
  escapeActivation: number; // Decoded from DNp01 / Giant Fiber escape activity (0.0 to 1.0)
  locomotorDrive: number; // Overall motor arousal / wing amplitude drive (0.0 to 1.0)
  flightState: "HOVER" | "PURSUIT" | "MANEUVER" | "RECOVER";
}

export interface ConnectomeManifest {
  dataset: string; // "MaleCNS"
  datasetVersion: string; // "v1.0"
  source: string;
  provenance: ConnectomeProvenance;
  graphType: string; // "real-connectome-derived"
  extractionMode: string; // "sensorimotor-subgraph"
  neuronCount: number;
  edgeCount: number; // Exact count of directed biological edges (e.g. 44,781)
  biologicalSynapseTotal: number; // Total underlying biological synaptic contacts (e.g. 1,146,043)
  synapseCount?: number; // Deprecated alias for edgeCount
  seedCount: number;
  sourceHashes?: {
    annotations?: string;
    neurotransmitters?: string;
    weights?: string;
  };
  synapseToConductanceFactor?: number;
  generatedAt: string;
  extractionParameters?: {
    minSynapseWeight: number;
    visualSeeds: string[];
    cxSeeds: string[];
    descendingSeeds: string[];
    vncSuperclass: string;
  };
  populationCounts?: {
    opticLobe: number;
    centralComplex: number;
    protocerebrum: number;
    descending: number;
    vncMotor: number;
  };
  seedCounts?: {
    visualSeeds: number;
    cxSeeds: number;
    descendingSeeds: number;
    totalDNsInDataset?: number;
    vncMotorSeeds?: number;
  };
  pathwaySummary?: {
    opticLobeNeurons?: number;
    centralComplexNeurons?: number;
    descendingNeurons?: number;
    vncMotorNeurons?: number;
    interneurons?: number;
    visualNeurons?: number;
    cxNeurons?: number;
  };
}

export interface ConnectomeCSRGraph {
  neurons: NeuronData[];
  indptr: Uint32Array;
  indices: Uint32Array;
  weights: Float32Array;
  signs: Int8Array;
  biologicalWeights?: Uint32Array;
  manifest: ConnectomeManifest;
}

export interface LIFParams {
  vRest: number; // mV (e.g. -65)
  vReset: number; // mV (e.g. -70)
  vThresh: number; // mV (e.g. -50)
  tauMembrane: number; // ms (e.g. 15.0)
  tauExc: number; // ms (e.g. 3.5)
  tauInh: number; // ms (e.g. 6.0)
  refractoryPeriod: number; // ms (e.g. 2.5)
  eExc: number; // mV (e.g. 0.0)
  eInh: number; // mV (e.g. -80.0)
  noiseStd: number; // mV / sqrt(ms)
  dt: number; // ms (e.g. 2.0 ms = 500 Hz)
  seed?: number; // Optional deterministic seed for reproducible noise
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
  // Pure biological decoding
  biological?: BiologicalMotorSignals;
  // Engineered badminton embodiment variables
  vx: number; // Lateral target velocity (-2.5 to 2.5 m/s)
  vz: number; // Longitudinal target velocity (-3.0 to 3.0 m/s)
  steerTorque: number; // Heading rotational torque
  swingTriggered: boolean; // True if cyber-racket swing stroke triggered
  swingType: "forehand" | "backhand" | "overhead" | "lift";
  swingPower: number; // 0.0 to 1.0
  arousal: number; // 0.0 to 1.0 (wing buzzing / readiness)
  flightState: "HOVER" | "PURSUIT" | "STRIKE" | "RECOVER";
}

export interface NeuronTelemetryItem {
  index: number;
  bodyId: string;
  name: string;
  type: string;
  instance?: string | null;
  region: NeuropilRegion;
  hemisphere?: "L" | "R" | "bilateral" | "unknown" | null;
  neurotransmitter?: string | null;
  pos: [number, number, number];
  coordinateType?: "soma_voxel" | "partner_centroid" | "neuropil_fallback";
  v: number; // membrane potential
  spiking: boolean;
  firingRateHz: number;
}

export interface ActivePathwayNode {
  index: number;
  bodyId: string;
  type: string;
  region: NeuropilRegion;
  rateHz: number;
}

export interface NeuralTelemetrySnapshot {
  timeMs: number;
  stepCount: number;
  provenance: ConnectomeProvenance;
  neuronCount: number;
  edgeCount: number;
  biologicalSynapseTotal: number;
  synapseCount?: number; // Deprecated alias
  neurons: NeuronTelemetryItem[];
  regionActivity: Record<NeuropilRegion, number>; // Mean firing rate per region in Hz
  sensoryFeatures: FlySensoryFeatures;
  motorCommand: FlyMotorCommand;
  activeSpikeCount: number;
  activePathway: ActivePathwayNode[];
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
