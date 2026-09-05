import { describe, it, expect } from "vitest";
import { C, defaults } from "../src/config";
import { v, len, seeded, sweptDistance } from "../src/math";
import {
  SwingDetector,
  MotionInterpreter,
  CalibrationManager,
  classify,
  neutralMotion,
  poseQuality,
  shoulderWidth,
} from "../src/motion";
import { syntheticPose } from "../src/synthetic";
import { Game, OpponentAI } from "../src/game";
import {
  integrate,
  MatchManager,
  inCourt,
  netCrossing,
  shotVelocity,
  predict,
  type Shuttle,
} from "../src/physics";
describe("motion interpretation", () => {
  it("requires deliberate speed and arm extension, then cools down", () => {
    const d = new SwingDetector();
    for (let i = 0; i < 30; i++)
      expect(d.update(0.2, 1 / 30, true)).toBe(false);
    expect(d.update(8, 1 / 30, false)).toBe(false);
    expect(d.update(2.4, 1 / 30, true)).toBe(false);
    expect(d.state).toBe("PREPARING");
    expect(d.update(6, 1 / 30, true)).toBe(true);
    expect(d.id).toBe(1);
    for (let i = 0; i < 20; i++) d.update(0, 1 / 30, true);
    expect(d.state).toBe("IDLE");
    expect(d.id).toBe(1);
  });
  it("normalizes movement and swing velocity to body scale", () => {
    const outputs = [0.7, 1, 1.4].map((scale) => {
      const m = new MotionInterpreter();
      m.calibration = {
        center: v(0.5, 0.5),
        width: 0.22 * scale,
        range: 0.15 * scale,
        hand: "right",
        reach: 1.8,
      };
      let result = neutralMotion();
      for (let i = 0; i < 8; i++)
        result = m.update(
          syntheticPose(0.3 - i * 0.02, 0.6 - i * 0.01, 0.03 * scale, scale),
          1000 + i * 33,
        )!;
      return result;
    });
    for (const m of outputs) {
      expect(m.playerX).toBeCloseTo(outputs[1].playerX, 4);
      expect(m.speed).toBeCloseTo(outputs[1].speed, 0);
      expect(Number.isFinite(m.elbowAngle)).toBe(true);
    }
  });
  it("rejects tracking gaps without a recovery velocity spike", () => {
    const m = new MotionInterpreter();
    m.update(syntheticPose(), 1000);
    const invalid = syntheticPose();
    invalid[16].visibility = 0.1;
    expect(m.update(invalid, 1033)).toBeNull();
    expect(m.update(syntheticPose(0.1, 0.2), 1100)!.speed).toBe(0);
    expect(m.update(syntheticPose(0.7, 0.6), 2000)!.swing).toBe(false);
  });
  it("does not turn whole-body translation into a swing", () => {
    const m = new MotionInterpreter();
    for (let i = 0; i < 20; i++) {
      const out = m.update(syntheticPose(0.3, 0.57, i * 0.005), 1000 + i * 33)!;
      expect(out.swing).toBe(false);
      expect(Math.abs(out.playerX)).toBeLessThanOrEqual(2.35);
    }
  });
  it("detects left hand, movement range and extended reach in calibration", () => {
    const c = new CalibrationManager();
    let result;
    for (let i = 0; i < 50; i++) c.update(syntheticPose(), 1 / 30);
    expect(c.stage).toBe(1);
    for (let i = 0; i < 35; i++) {
      const p = syntheticPose();
      p[15].y = 0.19;
      result = c.update(p, 1 / 30);
    }
    expect(c.hand).toBe("left");
    expect(c.stage).toBe(2);
    for (let i = 0; i < 100; i++)
      c.update(syntheticPose(0.3, 0.57, Math.sin(i * 0.1) * 0.08), 1 / 30);
    expect(c.stage).toBe(3);
    for (let i = 0; i < 40; i++) {
      const p = syntheticPose();
      p[15].x = 0.91;
      p[15].y = 0.36;
      result = c.update(p, 1 / 30);
    }
    expect(result?.done?.hand).toBe("left");
    expect(result?.done?.range).toBeGreaterThan(0.08);
  });
  it("classifies natural shot trajectories", () => {
    expect(classify(v(0, -1), 7, 2.6)).toBe("smash");
    expect(classify(v(0, 1), 6, 1.2)).toBe("lift");
    expect(classify(v(1, 0), 3.4, 1.4)).toBe("drop");
    expect(classify(v(1, 0), 6, 1.4)).toBe("drive");
    expect(classify(v(0.2, 0.8), 6, 2.5)).toBe("clear");
  });
  it("validates landmarks and measures shoulder width", () => {
    expect(poseQuality(undefined)).toBe(0);
    expect(shoulderWidth(syntheticPose())).toBeCloseTo(0.22);
    const p = syntheticPose();
    p[16].x = NaN;
    expect(poseQuality(p)).toBe(0);
  });
});
describe("contact, court and shuttle", () => {
  it("catches a fast crossing between frames", () => {
    expect(
      sweptDistance(v(-2, 1, 0), v(2, 1, 0), v(0, 1, -1), v(0, 1, 1)).distance,
    ).toBeCloseTo(0);
    expect(
      sweptDistance(v(-2, 1, 0), v(0, 1, 0), v(0, 1, -2), v(0, 1, -1)).distance,
    ).toBeGreaterThan(0.5);
  });
  it("counts boundary lines in and detects low net crossings", () => {
    expect(inCourt(v(C.halfWidth, 0, C.halfLength))).toBe(true);
    expect(inCourt(v(2.8, 0, 4))).toBe(false);
    expect(netCrossing(v(0, 1, 1), v(0, 1, -1))).toBe(true);
    expect(netCrossing(v(0, 2, 1), v(0, 2, -1))).toBe(false);
  });
  it("decelerates sharply with quadratic drag", () => {
    const s: Shuttle = {
      p: v(0, 4, 0),
      prev: v(),
      velocity: v(0, 0, -45),
      lastHit: 0,
    };
    for (let i = 0; i < 60; i++) integrate(s, C.dt);
    expect(Math.abs(s.velocity.z)).toBeLessThan(16);
    expect(s.p.y).toBeLessThan(4);
    expect(len(s.velocity)).toBeLessThan(45);
  });
  it.each(["clear", "drive", "drop", "smash", "lift", "serve"] as const)(
    "solves %s flight to a target",
    (intent) => {
      const start = v(0.2, intent === "smash" ? 3.1 : 1.6, 3.3),
        target = v(-1, 0.03, -5);
      const velocity = shotVelocity(start, target, intent, 0.7);
      expect(len(velocity)).toBeLessThan(100);
      const pts = predict({ p: start, prev: start, velocity, lastHit: 0 }, 4);
      const end = pts.at(-1)!;
      expect(end.y).toBeLessThan(0.1);
      expect(Math.abs(end.z - target.z)).toBeLessThan(0.65);
      expect(Math.abs(end.x - target.x)).toBeLessThan(0.2);
    },
  );
});
describe("match and connected rallies", () => {
  it("sustains rallies with interpolated player control across seeded opponents", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const g = new Game({ ...defaults, difficulty: "normal" }, seeded(seed));
      let id = 0;
      for (let step = 0; step < 7200; step++) {
        const s = g.shuttle;
        const points =
          s.lastHit === 1 && g.state === "rally" ? predict(s, 2) : [];
        const contact = points.find((p) => p.z >= 3.2) ?? s.p;
        const swing =
          g.state === "ready" ||
          (s.lastHit === 1 &&
            s.p.z > 2.5 &&
            Math.abs(s.p.y - g.racket.y) < 1.0);
        if (swing && step % 24 === 0) id++;
        g.setMotion({
          ...neutralMotion(),
          confidence: 1,
          playerX: Math.max(-2.35, Math.min(2.35, contact.x - 0.3)),
          racket: v(
            Math.max(-2.4, Math.min(2.4, contact.x)),
            Math.max(0.4, Math.min(3.2, contact.y)),
            3.3,
          ),
          swing,
          swingId: id,
          power: 0.7,
          intent: "clear",
        });
        g.step(C.dt);
        expect(Number.isFinite(s.p.x + s.p.y + s.p.z)).toBe(true);
      }
      expect(g.bestRally).toBeGreaterThanOrEqual(4);
      expect(g.match.score[0] + g.match.score[1]).toBeGreaterThan(0);
    }
  });
  it("uses rally scoring, win by two and cap at 30", () => {
    const match = new MatchManager();
    for (let i = 0; i < 20; i++) {
      match.point(0);
      match.point(1);
    }
    match.point(0);
    expect(match.winner).toBeNull();
    match.point(1);
    match.point(0);
    match.point(0);
    expect(match.winner).toBe(0);
    const capped = new MatchManager();
    capped.score = [29, 29];
    capped.point(1);
    expect(capped.winner).toBe(1);
  });
  it("AI waits, reacts and moves to predicted interception", () => {
    const ai = new OpponentAI();
    ai.incoming(
      {
        p: v(1, 2, 3),
        prev: v(),
        velocity: shotVelocity(v(1, 2, 3), v(2, 0, -5), "clear", 0.6),
        lastHit: 0,
      },
      defaults,
    );
    expect(ai.state).toBe("WAIT");
    ai.update(0.1, defaults);
    expect(ai.x).toBe(0);
    ai.update(0.5, defaults);
    expect(ai.state).toBe("MOVE");
    expect(ai.x).toBeGreaterThan(0);
  });
  it("connects synthetic pose → motion → serve → AI → swept contact → scoring", () => {
    const g = new Game({ ...defaults }, seeded(7)),
      m = new MotionInterpreter();
    let time = 1000;
    for (let i = 0; i < 9; i++) {
      const pose = syntheticPose(0.32 - i * 0.025, 0.65 - i * 0.035);
      const motion = m.update(pose, time)!;
      g.setMotion(motion);
      g.step(1 / 30);
      time += 33;
    }
    expect(g.state).toBe("rally");
    expect(g.totalHits).toBe(1);
    let aiReturned = false;
    for (let i = 0; i < 700 && g.state === "rally"; i++) {
      g.step(C.dt);
      if (g.shuttle.lastHit === 1) {
        aiReturned = true;
        break;
      }
    }
    expect(aiReturned).toBe(true);
    let hit = false;
    for (let i = 0; i < 600 && g.state === "rally"; i++) {
      const s = g.shuttle;
      if (s.p.z > 2.8 && s.p.y < 2.7) {
        const input = {
          ...neutralMotion(),
          confidence: 1,
          swing: true,
          swingId: 500,
          power: 0.7,
          intent: "clear" as const,
          racket: { ...s.p },
          playerX: s.p.x,
        };
        g.racket = { ...s.p };
        g.setMotion(input);
      }
      g.step(C.dt);
      if (g.totalHits >= 3) {
        hit = true;
        break;
      }
    }
    expect(hit).toBe(true);
    g.setMotion(neutralMotion());
    for (let i = 0; i < 1800 && g.state === "rally"; i++) g.step(C.dt);
    expect(g.match.score[0] + g.match.score[1]).toBe(1);
    for (let i = 0; i < 220; i++) g.step(C.dt);
    expect(["ready", "rally"]).toContain(g.state);
  });
  it("cannot hit by proximity alone or reuse a swing", () => {
    const g = new Game({ ...defaults });
    g.state = "rally";
    g.shuttle = {
      p: v(0.3, 1.5, 3.3),
      prev: v(0.3, 1.5, 3.3),
      velocity: v(0, 0, 1),
      lastHit: 1,
    };
    g.racket = v(0.3, 1.5, 3.3);
    g.setMotion({
      ...neutralMotion(),
      confidence: 1,
      racket: v(0.3, 1.5, 3.3),
    });
    g.step(C.dt);
    expect(g.totalHits).toBe(0);
    g.setMotion({ ...g.motion, swing: true, swingId: 2, power: 0.7 });
    g.step(C.dt);
    expect(g.totalHits).toBe(1);
    g.shuttle.lastHit = 1;
    g.shuttle.p = { ...g.racket };
    g.step(C.dt);
    expect(g.totalHits).toBe(1);
  });
  it("awards net and out faults to the non-hitting side", () => {
    const g = new Game({ ...defaults });
    g.state = "rally";
    g.shuttle = {
      p: v(0, 1, 0.02),
      prev: v(),
      velocity: v(0, 0, -10),
      lastHit: 0,
    };
    g.step(C.dt);
    expect(g.match.score).toEqual([0, 1]);
    const out = new Game({ ...defaults });
    out.state = "rally";
    out.shuttle = {
      p: v(3, 0.04, -3),
      prev: v(),
      velocity: v(0, -2, 0),
      lastHit: 0,
    };
    out.step(C.dt);
    expect(out.match.score).toEqual([0, 1]);
  });
});
