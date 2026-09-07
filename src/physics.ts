import { C } from "./config";
import { add, sub, mul, len, mix, v, type V3, clamp } from "./math";
import type { Intent } from "./motion";
export type Shuttle = { p: V3; prev: V3; velocity: V3; lastHit: 0 | 1 };
export function integrate(s: Shuttle, dt: number) {
  s.prev = { ...s.p };
  // Semi-implicit quadratic drag, stable even for high-speed smash impulses.
  s.velocity = mul(s.velocity, 1 / (1 + C.drag * len(s.velocity) * dt));
  s.velocity.y -= C.gravity * dt;
  s.p = add(s.p, mul(s.velocity, dt));
}
export function inCourt(p: V3) {
  return (
    Math.abs(p.x) <= C.halfWidth + 0.025 &&
    Math.abs(p.z) <= C.halfLength + 0.025
  );
}
export function netCrossing(a: V3, b: V3) {
  if (a.z * b.z > 0 || a.z === b.z) return false;
  const p = mix(a, b, Math.abs(a.z) / (Math.abs(a.z) + Math.abs(b.z)));
  return Math.abs(p.x) < 3.05 && p.y <= C.netHeight + 0.04;
}
export function predict(s: Shuttle, max = 3) {
  const copy: Shuttle = {
    p: { ...s.p },
    prev: { ...s.p },
    velocity: { ...s.velocity },
    lastHit: s.lastHit,
  };
  const points: V3[] = [];
  for (let t = 0; t < max; t += 1 / 60) {
    integrate(copy, 1 / 60);
    points.push({ ...copy.p });
    if (copy.p.y < 0) break;
  }
  return points;
}

export type Interception = {
  target: V3;
  arrivalTime: number;
  points: V3[];
};

export function predictInterception(
  s: Shuttle,
  isPlayer = true,
  maxTime = 3.0,
): Interception {
  const points = predict(s, maxTime);
  if (points.length === 0) {
    return {
      target: v(0, 1.4, isPlayer ? 4.0 : -3.9),
      arrivalTime: 1.0,
      points,
    };
  }

  const dt = 1 / 60;
  if (isPlayer) {
    // Look for optimal player interception on positive Z half (court depth 1.8 to 5.6)
    let bestIdx = -1;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p.z >= 1.6 && p.z <= 5.6 && p.y >= 0.4 && p.y <= 2.5) {
        // Ideal contact band: z between 3.0 and 4.2, height ~ 1.2 to 2.0
        if (p.z >= 2.8 && p.z <= 4.4 && p.y >= 0.8 && p.y <= 2.2) {
          bestIdx = i;
          break;
        }
        if (bestIdx === -1) bestIdx = i;
      }
    }
    if (bestIdx === -1) {
      // If dropping in front or behind, find the closest reasonable point in player court
      bestIdx = points.findIndex((p) => p.z > 0.8 && p.y > 0.2);
      if (bestIdx === -1) bestIdx = points.length - 1;
    }
    const target = points[bestIdx] ?? points[points.length - 1] ?? s.p;
    return {
      target: v(
        clamp(target.x, -C.halfWidth + 0.2, C.halfWidth - 0.2),
        clamp(target.y, 0.4, 2.5),
        clamp(target.z, 1.8, 5.6),
      ),
      arrivalTime: (bestIdx + 1) * dt,
      points,
    };
  } else {
    // Opponent court (negative Z half)
    let bestIdx = points.findIndex((p) => p.z < -1.0 && p.y < 1.8 && p.y > 0.4);
    if (bestIdx === -1) bestIdx = points.length - 1;
    const target = points[bestIdx] ?? s.p;
    return {
      target: v(
        clamp(target.x, -2.4, 2.4),
        clamp(target.y, 0.4, 2.2),
        clamp(target.z, -6.0, -1.0),
      ),
      arrivalTime: (bestIdx + 1) * dt,
      points,
    };
  }
}
/** Numerical shooting solver uses the same drag integrator as gameplay. */
export function shotVelocity(
  start: V3,
  target: V3,
  intent: Intent | "serve",
  power: number,
) {
  const times = {
    clear: 1.65,
    lift: 1.75,
    drop: 1.25,
    drive: 1.0,
    smash: 0.68,
    serve: 1.5,
  };
  const duration = times[intent] * (1.08 - clamp(power, 0, 1) * 0.16);
  let velocity = mul(sub(target, start), 1 / duration);
  velocity.y += C.gravity * duration * 0.5;
  for (let iteration = 0; iteration < 9; iteration++) {
    const s: Shuttle = {
      p: { ...start },
      prev: { ...start },
      velocity: { ...velocity },
      lastHit: 0,
    };
    const steps = Math.ceil(duration / C.dt),
      dt = duration / steps;
    for (let i = 0; i < steps; i++) integrate(s, dt);
    velocity = add(velocity, mul(sub(target, s.p), 1.35 / duration));
  }
  return velocity;
}
export class MatchManager {
  score = [0, 0];
  winner: number | null = null;
  server: 0 | 1 = 0;
  point(side: 0 | 1) {
    if (this.winner !== null) return;
    this.score[side]++;
    this.server = side;
    const a = this.score[side],
      b = this.score[1 - side];
    if ((a >= 21 && a - b >= 2) || a >= 30) this.winner = side;
  }
}
