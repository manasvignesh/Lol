import { v, clamp } from "./math";
import { neutralMotion, type Pose, type Motion } from "./motion";
/** Anatomical MediaPipe ordering; test fixtures never masquerade as a live camera. */
export function syntheticPose(
  wristX = 0.3,
  wristY = 0.57,
  offset = 0,
  scale = 1,
  lean = 0,
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
  // Shoulders have lean tilt
  set(11, 0.61 - lean, 0.35);
  set(12, 0.39 - lean, 0.35);
  set(13, 0.67 - lean, 0.49);
  set(14, 0.3 - lean, 0.46);
  set(15, 0.7 - lean, 0.62);
  set(16, wristX, wristY);
  // Hips remain centered
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

  update(now: number, dt: number): Motion {
    const leftKey = this.keys.has("a") || this.keys.has("ArrowLeft");
    const rightKey = this.keys.has("d") || this.keys.has("ArrowRight");
    const upKey = this.keys.has("w") || this.keys.has("ArrowUp");
    const downKey = this.keys.has("s") || this.keys.has("ArrowDown");

    this.x = clamp(
      this.x + ((rightKey ? 1 : 0) - (leftKey ? 1 : 0)) * dt * 4,
      -2.35,
      2.35,
    );
    this.y = clamp(
      this.y + ((upKey ? 1 : 0) - (downKey ? 1 : 0)) * dt * 3,
      0.3,
      3.3,
    );

    const isSwinging = now < this.swingUntil;
    const intentDirection = rightKey
      ? "right"
      : leftKey
        ? "left"
        : upKey
          ? "front"
          : downKey
            ? "back"
            : "center";
    const lean = rightKey ? 0.25 : leftKey ? -0.25 : 0;

    return {
      ...neutralMotion(),
      time: now,
      confidence: 1,
      playerX: this.x,
      racket: v(this.x + 0.3, this.y, 3.3),
      direction: v(
        rightKey ? 0.6 : leftKey ? -0.6 : 0,
        isSwinging ? 0.7 : 0,
        -1,
      ),
      swing: isSwinging,
      swingId: this.id,
      power: 0.7,
      intent: this.intent,
      intentDirection,
      intentWeight: intentDirection !== "center" ? 0.8 : 0,
      lean,
      speed: isSwinging ? 7 : 0,
      state: isSwinging ? "SWINGING" : "IDLE",
    };
  }
}
