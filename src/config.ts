export const C = {
  halfWidth: 2.59,
  halfLength: 6.7,
  netHeight: 1.524,
  dt: 1 / 120,
  gravity: 9.81,
  drag: 0.095,
  racketLength: 0.68,
  confidence: 0.55,
  staleMs: 240,
  pauseMs: 800,
  swingStart: 1.8,
  swingPeak: 2.8,
  swingEnd: 1.15,
  swingAccelTrigger: 22.0,
  cooldown: 0.25,
  swingHistoryMs: 200,
  predictionLookahead: 0.05,
  playerBase: { x: 0, z: 4.0 },
  human: {
    playerSpeed: 5.8,
    recoverySpeed: 4.0,
    intentPenalty: 0.9,
    timingWindow: 0.52,
    contactEnvelope: 0.58,
    racketBladeRadius: 0.42,
    reachMultiplier: 2.0,
    depthScale: 1.81,
    aimClamp: 2.5,
    aimSoftEdge: 1.5,
    aimSoftCompression: 0.3,
    introRallyDampingHits: 6,
    assist: 1.05,
    shotCorrection: 1.0,
  },
  playerSpeed: { beginner: 5.8, normal: 5.8 },
  recoverySpeed: { beginner: 4.0, normal: 4.0 },
  intentLeanThreshold: 0.08,
  intentReachThreshold: 0.45,
  intentBoost: 1.35,
  intentPenalty: { beginner: 0.9, normal: 0.9 },
  timingWindow: { beginner: 0.52, normal: 0.52 },
  contactEnvelope: { beginner: 0.58, normal: 0.58 },
  racketBladeRadius: { beginner: 0.58, normal: 0.58 },
  assist: { beginner: 1.05, normal: 1.05 },
  shotCorrection: { beginner: 1.0, normal: 1.0 },
  ai: {
    easy: { speed: 3.6, reaction: 0.28, error: 0.35, miss: 0.05 },
    normal: { speed: 5.2, reaction: 0.16, error: 0.18, miss: 0.02 },
  },
} as const;
export type Settings = {
  sensitivity: number;
  movement: number;
  difficulty: "easy" | "normal";
  assist: "beginner" | "normal";
  volume: number;
  preview: boolean;
  debug: boolean;
  camera: string;
  opponentType: "fruitfly" | "classic";
  flyEmbodimentMode: "demo-assist" | "scientific";
};
export const defaults: Settings = {
  sensitivity: 1,
  movement: 1,
  difficulty: "easy",
  assist: "beginner",
  volume: 0.45,
  preview: true,
  debug: false,
  camera: "",
  opponentType: "classic",
  flyEmbodimentMode: "demo-assist",
};
export function readSettings(): Settings {
  try {
    const parsed = JSON.parse(localStorage.getItem("motion-settings") || "{}");
    return {
      ...defaults,
      ...parsed,
      assist: "beginner", // Human control profile is fixed
    };
  } catch {
    return { ...defaults };
  }
}
