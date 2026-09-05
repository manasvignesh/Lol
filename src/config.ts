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
  swingStart: 2.0,
  swingPeak: 3.1,
  swingEnd: 1.25,
  cooldown: 0.27,
  assist: { beginner: 1.05, normal: 0.58 },
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
