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
  playerSpeed: { beginner: 5.8, normal: 5.2 },
  recoverySpeed: { beginner: 4.0, normal: 3.4 },
  intentLeanThreshold: 0.08,
  intentReachThreshold: 0.45,
  intentBoost: 1.35,
  intentPenalty: { beginner: 0.9, normal: 0.68 },
  timingWindow: { beginner: 0.35, normal: 0.2 },
  contactEnvelope: { beginner: 1.45, normal: 0.9 },
  assist: { beginner: 1.05, normal: 0.58 },
  shotCorrection: { beginner: 1.0, normal: 0.4 },
  ai: {
    easy: { speed: 2.9, reaction: 0.38, error: 0.5, miss: 0.1 },
    normal: { speed: 4.6, reaction: 0.21, error: 0.24, miss: 0.04 },
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
  opponentType: "fruitfly",
  flyEmbodimentMode: "demo-assist",
};
export function readSettings(): Settings {
  try {
    return {
      ...defaults,
      ...JSON.parse(localStorage.getItem("motion-settings") || "{}"),
    };
  } catch {
    return { ...defaults };
  }
}
