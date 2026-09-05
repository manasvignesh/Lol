import { v, clamp } from "./math";
import { neutralMotion, type Pose, type Motion } from "./motion";
/** Anatomical MediaPipe ordering; test fixtures never masquerade as a live camera. */
export function syntheticPose(
  wristX = 0.3,
  wristY = 0.57,
  offset = 0,
  scale = 1,
): Pose {
  const p: Pose = Array.from({ length: 33 }, () => ({
    ...v(0.5, 0.5, 0),
    visibility: 0.98,
  }));
  const set = (i: number, x: number, y: number) =>
    (p[i] = {
      x: 0.5 + (x - 0.5) * scale + offset,
      y: 0.5 + (y - 0.5) * scale,
      z: 0,
      visibility: 0.98,
    });
  set(11, 0.61, 0.35);
  set(12, 0.39, 0.35);
  set(13, 0.67, 0.49);
  set(14, 0.3, 0.46);
  set(15, 0.7, 0.62);
  set(16, wristX, wristY);
  set(23, 0.57, 0.65);
  set(24, 0.43, 0.65);
  set(25, 0.56, 0.8);
  set(26, 0.44, 0.8);
  set(27, 0.56, 0.96);
  set(28, 0.44, 0.96);
  return p;
}
export class DebugInput {
  keys = new Set<string>();
  x = 0;
  y = 1.5;
  id = 0;
  swingUntil = 0;
  intent: Motion["intent"] = "clear";
  swing(now: number) {
    this.id++;
    this.swingUntil = now + 230;
  }
  update(now: number, dt: number) {
    this.x = clamp(
      this.x +
        ((this.keys.has("d") || this.keys.has("ArrowRight") ? 1 : 0) -
          (this.keys.has("a") || this.keys.has("ArrowLeft") ? 1 : 0)) *
          dt *
          4,
      -2.35,
      2.35,
    );
    this.y = clamp(
      this.y +
        ((this.keys.has("w") || this.keys.has("ArrowUp") ? 1 : 0) -
          (this.keys.has("s") || this.keys.has("ArrowDown") ? 1 : 0)) *
          dt *
          3,
      0.3,
      3.3,
    );
    return {
      ...neutralMotion(),
      time: now,
      confidence: 1,
      playerX: this.x,
      racket: v(this.x + 0.3, this.y, 3.3),
      swing: now < this.swingUntil,
      swingId: this.id,
      power: 0.7,
      intent: this.intent,
      speed: now < this.swingUntil ? 7 : 0,
      state: now < this.swingUntil ? "SWINGING" : "IDLE",
    } as Motion;
  }
}
