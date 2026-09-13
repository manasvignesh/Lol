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
  predictInterception,
  type Shuttle,
} from "../src/physics";

describe("motion interpretation & intent", () => {
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
      expect(m.speed).toBeCloseTo(outputs[1].speed, 0);
      expect(Number.isFinite(m.elbowAngle)).toBe(true);
    }
  });

  it("detects small torso lean as directional intent", () => {
    const m = new MotionInterpreter();
    m.calibration = {
      center: v(0.5, 0.5),
      width: 0.22,
      range: 0.15,
      hand: "right",
      reach: 1.8,
    };
    // Neutral standing
    const neutral = m.update(syntheticPose(0.3, 0.57, 0, 1, 0), 1000)!;
    expect(neutral.intentDirection).toBe("center");

    // Lean right (small shoulder shift)
    const rightLean = m.update(syntheticPose(0.3, 0.57, 0, 1, 0.04), 1033)!;
    expect(rightLean.intentDirection).toBe("right");
    expect(rightLean.intentWeight).toBeGreaterThan(0);

    // Lean left
    const leftLean = m.update(syntheticPose(0.3, 0.57, 0, 1, -0.04), 1066)!;
    expect(leftLean.intentDirection).toBe("left");
    expect(leftLean.intentWeight).toBeGreaterThan(0);
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
    }
  });

  it("streamlined calibration detects left hand and extended reach without room displacement", () => {
    const c = new CalibrationManager();
    let result;
    // Stage 0: Neutral standing
    for (let i = 0; i < 45; i++) c.update(syntheticPose(), 1 / 30);
    expect(c.stage).toBe(1);

    // Stage 1: Raise left hand
    for (let i = 0; i < 30; i++) {
      const p = syntheticPose();
      p[15].y = 0.19;
      result = c.update(p, 1 / 30);
    }
    expect(c.hand).toBe("left");
    expect(c.stage).toBe(2);

    // Stage 2: Extend reach
    for (let i = 0; i < 30; i++) {
      const p = syntheticPose();
      p[15].x = 0.91;
      p[15].y = 0.36;
      result = c.update(p, 1 / 30);
    }
    expect(result?.done?.hand).toBe("left");
    expect(result?.done?.reach).toBeGreaterThan(1.1);
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

  it("handles tracking loss by rejecting degraded confidence poses and resetting cleanly on recovery", () => {
    const m = new MotionInterpreter();
    m.calibration = {
      center: v(0.5, 0.5),
      width: 0.22,
      range: 0.15,
      hand: "right",
      reach: 1.8,
    };
    // Valid pose
    const valid = m.update(syntheticPose(0.3, 0.57), 1000);
    expect(valid).not.toBeNull();
    expect(valid!.confidence).toBeGreaterThanOrEqual(C.confidence);

    // Degraded visibility (e.g. user stepped out of frame)
    const degraded = syntheticPose(0.3, 0.57);
    degraded[16].visibility = 0.2;
    const result = m.update(degraded, 1033);
    expect(result).toBeNull();

    // User steps back in after a pause (> staleMs)
    const recovered = m.update(syntheticPose(0.3, 0.57), 2000);
    expect(recovered).not.toBeNull();
    expect(recovered!.speed).toBe(0); // Velocity history was reset safely without velocity spikes
    expect(recovered!.swing).toBe(false);
  });
});

describe("auto-footwork, contact envelope & timing windows", () => {
  it("avatar auto-moves toward predicted interception without user room traversal", () => {
    const g = new Game({ ...defaults });
    g.state = "rally";
    // Incoming shot to right side (x: 1.5, z: 3.5)
    g.shuttle = {
      p: v(0, 1.8, 0.5),
      prev: v(0, 1.8, 0.5),
      velocity: shotVelocity(v(0, 1.8, 0.5), v(1.6, 0.03, 4.2), "clear", 0.7),
      lastHit: 1,
    };
    expect(g.playerPos.x).toBe(0);
    expect(g.footworkState).toBe("READY");

    // Neutral player standing in place
    g.setMotion({ ...neutralMotion(), confidence: 1 });

    // Step physics forward 0.5s
    for (let i = 0; i < 60; i++) g.step(1 / 120);

    expect(g.footworkState).toBe("INTERCEPTING");
    expect(g.targetPos.x).toBeGreaterThan(0.8);
    // Player avatar moved towards the right autonomously
    expect(g.playerPos.x).toBeGreaterThan(0.5);
  });

  it("player lean accelerates commitment to predicted interception", () => {
    const gNeutral = new Game({ ...defaults });
    gNeutral.state = "rally";
    gNeutral.shuttle = {
      p: v(0, 1.8, 0.5),
      prev: v(0, 1.8, 0.5),
      velocity: shotVelocity(v(0, 1.8, 0.5), v(2.2, 0.03, 4.0), "drive", 0.7),
      lastHit: 1,
    };
    gNeutral.setMotion({
      ...neutralMotion(),
      confidence: 1,
      intentDirection: "center",
    });

    const gLean = new Game({ ...defaults });
    gLean.state = "rally";
    gLean.shuttle = { ...gNeutral.shuttle };
    gLean.setMotion({
      ...neutralMotion(),
      confidence: 1,
      intentDirection: "right",
      intentWeight: 1,
    });

    for (let i = 0; i < 10; i++) {
      gNeutral.step(1 / 120);
      gLean.step(1 / 120);
    }

    // Leaning in the direction of the shot boosts avatar traversal
    expect(gLean.playerPos.x).toBeGreaterThan(gNeutral.playerPos.x);
  });

  it("recovers avatar toward base position after returning a shot", () => {
    const g = new Game({ ...defaults });
    g.state = "rally";
    g.playerPos = v(1.5, 0, 4.8); // Player avatar was deep right
    g.targetPos = v(1.5, 0, 4.8);
    g.shuttle = {
      p: v(1.5, 1.4, 4.8),
      prev: v(1.5, 1.4, 4.8),
      velocity: v(0, 5, -15),
      lastHit: 0, // Player just hit it
    };
    g.footworkState = "RECOVERING";

    for (let i = 0; i < 60; i++) g.step(1 / 120);

    // Avatar moves back towards center base (x: 0, z: 4.0)
    expect(g.playerPos.x).toBeLessThan(1.5);
    expect(g.playerPos.z).toBeLessThan(4.8);
  });

  it("early swing connects inside allowed timing window", () => {
    const g = new Game({ ...defaults, assist: "beginner" });
    g.state = "rally";
    g.shuttle = {
      p: v(0, 1.8, 2.0),
      prev: v(0, 1.8, 2.0),
      velocity: v(0, -1, 4),
      lastHit: 1,
    };
    g.playerPos = v(0, 0, 3.8);
    // User swings while shuttle is still 1.8m away (early swing)
    g.setMotion({
      ...neutralMotion(),
      confidence: 1,
      swing: true,
      swingId: 101,
      power: 0.8,
      intent: "clear",
    });
    g.step(1 / 120);
    expect(g.primedSwing).not.toBeNull();
    expect(g.totalHits).toBe(0);

    // User arm swing finishes (swing becomes false)
    g.setMotion({ ...neutralMotion(), confidence: 1, swing: false });

    // Shuttle flies closer into the contact envelope
    let connected = false;
    for (let i = 0; i < 40; i++) {
      g.step(1 / 120);
      if (g.totalHits > 0) {
        connected = true;
        break;
      }
    }
    expect(connected).toBe(true);
    expect(g.usedSwing).toBe(101);
  });

  it("late swing outside timing window misses", () => {
    const g = new Game({ ...defaults, assist: "normal" });
    g.state = "rally";
    g.shuttle = {
      p: v(0, 0.2, 5.5),
      prev: v(0, 0.2, 5.5),
      velocity: v(0, -5, 1),
      lastHit: 1,
    };
    g.playerPos = v(0, 0, 3.8);

    // Shuttle already fell below / past the player
    g.setMotion({
      ...neutralMotion(),
      confidence: 1,
      swing: true,
      swingId: 202,
      power: 0.8,
    });
    for (let i = 0; i < 15; i++) g.step(1 / 120);
    expect(g.totalHits).toBe(0);
    expect(g.state).toBe("point");
  });

  it("cannot hit by proximity alone or reuse a single swing ID", () => {
    const g = new Game({ ...defaults });
    g.state = "rally";
    g.shuttle = {
      p: v(0, 1.5, 3.8),
      prev: v(0, 1.5, 3.8),
      velocity: v(0, 0, 1),
      lastHit: 1,
    };
    g.playerPos = v(0, 0, 3.8);

    // No swing active -> no hit
    g.setMotion({ ...neutralMotion(), confidence: 1 });
    g.step(1 / 120);
    expect(g.totalHits).toBe(0);

    // Valid swing with physical racket alignment -> hit 1
    g.racket = v(0, 1.5, 3.8);
    g.previousRacket = v(0, 1.5, 3.8);
    g.setMotion({
      ...neutralMotion(),
      racket: v(0, 1.5, 3.85),
      confidence: 1,
      swing: true,
      swingId: 5,
      power: 0.7,
    });
    g.step(1 / 120);
    expect(g.totalHits).toBe(1);

    // Same swing ID cannot hit again
    g.shuttle.lastHit = 1;
    g.shuttle.p = v(0, 1.5, 3.8);
    g.step(1 / 120);
    expect(g.totalHits).toBe(1);
  });

  it("Beginner assistance is more forgiving than Normal in contact envelope and timing", () => {
    expect(C.contactEnvelope.beginner).toBeGreaterThan(
      C.contactEnvelope.normal,
    );
    expect(C.timingWindow.beginner).toBeGreaterThan(C.timingWindow.normal);
    expect(C.playerSpeed.beginner).toBeGreaterThanOrEqual(C.playerSpeed.normal);
  });
});

describe("contact, court and shuttle physics", () => {
  it("catches a fast crossing between frames", () => {
    expect(
      sweptDistance(v(-2, 1, 0), v(2, 1, 0), v(0, 1, -1), v(0, 1, 1)).distance,
    ).toBeCloseTo(0);
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
  it("sustains rallies with auto-footwork player control across seeded opponents", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const g = new Game(
        { ...defaults, difficulty: "normal", opponentType: "classic" },
        seeded(seed),
      );
      let id = 1;
      for (let step = 0; step < 7200; step++) {
        const s = g.shuttle;
        const swing =
          g.state === "ready" ||
          (s.lastHit === 1 && s.p.z > 2.0 && Math.abs(s.p.y - 1.5) < 1.2);
        if (g.state === "ready" && id <= g.usedSwing) id++;
        else if (swing && step % 24 === 0) id++;
        g.setMotion({
          ...neutralMotion(),
          racket: g.state === "ready" ? v(0.35, 1.05, 3.5) : v(0.5, 1.5, 3.4),
          confidence: 1,
          swing,
          swingId: id,
          power: 0.75,
          intent: "clear",
        });
        g.step(C.dt);
        expect(Number.isFinite(s.p.x + s.p.y + s.p.z)).toBe(true);
      }
      expect(g.bestRally).toBeGreaterThanOrEqual(4);
      expect(g.totalHits).toBeGreaterThanOrEqual(4);
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

  it("connects synthetic pose → motion → serve → AI → auto-footwork contact → scoring", () => {
    const g = new Game({ ...defaults, opponentType: "classic" }, seeded(7)),
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
      if (s.p.z > 2.2 && s.p.y < 2.8) {
        const input = {
          ...neutralMotion(),
          confidence: 1,
          swing: true,
          swingId: 500,
          power: 0.7,
          intent: "clear" as const,
        };
        g.setMotion(input);
      }
      g.step(C.dt);
      if (g.totalHits >= 3) {
        hit = true;
        break;
      }
    }
    expect(hit).toBe(true);
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

  describe("Physical Human Racket Contact & Ghost-Hit Prevention", () => {
    it.each([8, 12, 16, 20])(
      "rejects ghost hits at %i m/s shuttle speed when swing is not physically confirmed",
      (speed) => {
        const g = new Game({ ...defaults });
        g.state = "rally";
        g.playerPos = v(0, 0, 4.0);
        g.shuttle = {
          p: v(0, 1.4, 2.0),
          prev: v(0, 1.4, 2.0),
          velocity: v(0, 0, speed),
          lastHit: 1,
        };

        // 1. Passive / No swing -> Shuttle flies past avatar without auto-hit
        g.setMotion({ ...neutralMotion(), confidence: 1, swing: false });
        for (let i = 0; i < 30; i++) {
          g.step(1 / 120);
        }
        expect(g.totalHits).toBe(0);
        expect(g.lastHumanDiagnostic?.hitRejectedReason).toBe(
          "NO_CONFIRMED_SWING",
        );

        // Reset shuttle
        g.state = "rally";
        g.shuttle = {
          p: v(0, 1.4, 2.0),
          prev: v(0, 1.4, 2.0),
          velocity: v(0, 0, speed),
          lastHit: 1,
        };

        // 2. predictedSwing only -> MUST NEVER trigger hit
        g.setMotion({
          ...neutralMotion(),
          confidence: 1,
          predictedSwing: true,
          swing: false,
          swingId: 99,
        });
        for (let i = 0; i < 30; i++) {
          g.step(1 / 120);
        }
        expect(g.totalHits).toBe(0);

        // Reset shuttle
        g.state = "rally";
        g.shuttle = {
          p: v(0, 1.4, 2.0),
          prev: v(0, 1.4, 2.0),
          velocity: v(0, 0, speed),
          lastHit: 1,
        };

        // 3. Confirmed swing but racket is far on left side -> Misses
        g.setMotion({
          ...neutralMotion(),
          racket: v(-1.5, 1.4, 3.4),
          confidence: 1,
          swing: true,
          swingId: 100,
          power: 0.7,
        });
        for (let i = 0; i < 30; i++) {
          g.step(1 / 120);
        }
        expect(g.totalHits).toBe(0);
        expect(g.lastHumanDiagnostic?.hitRejectedReason).toBe(
          "NO_PHYSICAL_CONTACT",
        );

        // Reset shuttle
        g.state = "rally";
        g.shuttle = {
          p: v(0, 1.4, 2.0),
          prev: v(0, 1.4, 2.0),
          velocity: v(0, 0, speed),
          lastHit: 1,
        };

        // 4. Confirmed swing + swept racket intersection -> Exactly 1 hit accepted
        g.shuttle = {
          p: v(0, 1.4, 3.4),
          prev: v(0, 1.4, 3.4),
          velocity: v(0, 0, speed),
          lastHit: 1,
        };
        g.racket = v(0, 1.4, 3.6);
        g.previousRacket = v(0, 1.4, 3.6);
        g.setMotion({
          ...neutralMotion(),
          racket: v(0, 1.4, 3.85),
          confidence: 1,
          swing: true,
          swingId: 101,
          power: 0.8,
        });
        let hitRecorded = false;
        for (let i = 0; i < 30; i++) {
          g.step(1 / 120);
          if (g.totalHits === 1) {
            hitRecorded = true;
            break;
          }
        }
        expect(hitRecorded).toBe(true);
        expect(g.lastHumanDiagnostic?.hitAccepted).toBe(true);
        expect(g.lastHumanDiagnostic?.hitRejectedReason).toBe("NONE");
      },
    );

    it("verifies hand waves and wrist gestures away from shuttle do not alter velocity or launch serve", () => {
      const g = new Game({ ...defaults });
      g.ready();

      // Hand wave far above or away from held shuttle
      g.setMotion({
        ...neutralMotion(),
        racket: v(-1.2, 2.6, 2.0),
        confidence: 0.95,
        swing: true,
        swingId: 12,
        power: 0.8,
      });
      for (let i = 0; i < 15; i++) {
        g.step(1 / 120);
      }
      // Serve must NOT have triggered
      expect(g.state).toBe("ready");
      expect(g.totalHits).toBe(0);

      // Now swing with racket passing directly through held shuttle
      g.racket = v(0.35, 1.05, 3.5);
      g.previousRacket = v(0.35, 1.05, 3.5);
      g.setMotion({
        ...neutralMotion(),
        racket: v(0.35, 1.05, 3.5),
        confidence: 1.0,
        swing: true,
        swingId: 13,
        power: 0.75,
      });
      g.step(1 / 120);
      expect(g.state).toBe("rally");
      expect(g.totalHits).toBe(1);
    });
  });
});
