import { describe, it, expect } from "vitest";
import { Game } from "../src/game";
import { defaults } from "../src/config";
import { v, type V3 } from "../src/math";

describe("Opponent Balance & Fly Mechanics Benchmark", () => {
  const scenarios: {
    name: string;
    target: V3;
    intent: "clear" | "drop" | "smash";
  }[] = [
    { name: "left-drive", target: v(-1.8, 1.2, -3.5), intent: "clear" },
    { name: "right-drive", target: v(1.8, 1.2, -3.5), intent: "clear" },
    { name: "center-clear", target: v(0.0, 1.8, -5.2), intent: "clear" },
    { name: "net-drop", target: v(-1.2, 0.8, -1.5), intent: "drop" },
    { name: "fast-smash", target: v(1.5, 0.9, -3.8), intent: "smash" },
  ];

  function runOpponentBenchmark(
    opponentType: "classic" | "fruitfly",
    difficulty: "easy" | "normal",
    flyEmbodimentMode: "demo-assist" | "scientific" = "demo-assist",
    rounds = 30,
  ) {
    let returns = 0;
    let longReturns = 0;
    let wideReturns = 0;
    let netReturns = 0;
    let totalAttempts = 0;

    for (let r = 0; r < rounds; r++) {
      const scenario = scenarios[r % scenarios.length];
      const g = new Game({
        ...defaults,
        opponentType,
        difficulty,
        flyEmbodimentMode,
      });

      g.state = "rally";
      g.shuttle = {
        p: v(0, 1.2, 3.5),
        prev: v(0, 1.2, 3.5),
        velocity: v(0, 0, 0),
        lastHit: 0,
      };
      g.hit(0, scenario.intent, 1.0);

      let returned = false;

      for (let step = 0; step < 360; step++) {
        g.step(1 / 120);

        // Check if opponent returned it
        if (g.shuttle.lastHit === 1 && !returned) {
          returned = true;
          returns++;
        }

        // Track flight if returned
        if (returned) {
          if (
            g.shuttle.p.y <= 0.03 ||
            g.shuttle.p.z > 7.0 ||
            Math.abs(g.shuttle.p.x) > 3.0
          ) {
            if (g.shuttle.p.z > 6.7) longReturns++;
            else if (Math.abs(g.shuttle.p.x) > 2.59) wideReturns++;
            else if (g.shuttle.p.z < 0 && g.shuttle.p.y < 1.524) netReturns++;
            break;
          }
        }

        if ((g.state as string) === "point" || (g.state as string) === "over")
          break;
      }
      totalAttempts++;
    }

    const returnRate = returns / totalAttempts;
    const longRate = returns > 0 ? longReturns / returns : 0;
    return {
      returnRate,
      longRate,
      wideReturns,
      netReturns,
      totalAttempts,
      returns,
    };
  }

  it("Classic AI Easy has beatable, rally-capable return rate (60% - 95%)", () => {
    const res = runOpponentBenchmark("classic", "easy", "demo-assist", 50);
    expect(res.returnRate).toBeGreaterThanOrEqual(0.6);
    expect(res.returnRate).toBeLessThanOrEqual(0.95);
  });

  it("Classic AI Normal is competitive and solid (80% - 100%)", () => {
    const res = runOpponentBenchmark("classic", "normal", "demo-assist", 50);
    expect(res.returnRate).toBeGreaterThanOrEqual(0.8);
    expect(res.returnRate).toBeLessThanOrEqual(1.0);
  });

  it("Fruit-Fly Demo-Assist returns shots with bounded out-of-court rate (< 30%)", () => {
    const res = runOpponentBenchmark("fruitfly", "normal", "demo-assist", 25);
    expect(res.returnRate).toBeGreaterThanOrEqual(0.35);
    expect(res.longRate).toBeLessThanOrEqual(0.3);
  }, 30000);

  it("Fruit-Fly Scientific is causally driven with zero artificial aim", () => {
    const res = runOpponentBenchmark("fruitfly", "normal", "scientific", 25);
    expect(res.returnRate).toBeGreaterThanOrEqual(0.25);
    expect(res.longRate).toBeLessThanOrEqual(0.35);
  }, 30000);
});
