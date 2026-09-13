import { Game } from "../src/game.ts";
import { defaults } from "../src/config.ts";

// Simple reproducible linear congruential PRNG
function createPrng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  const weight = idx - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function median(arr) {
  return percentile(arr, 50);
}

export async function runStressBenchmark(
  title,
  configOverrides = {},
  silencer = null,
  trialsPerScenario = 100,
) {
  const scenarios = ["left", "right", "center", "high", "fast", "drop"];
  const seeds = [42, 101, 202, 303, 404, 505, 606, 707, 808, 909];
  const trialsPerSeed = Math.ceil(trialsPerScenario / seeds.length);
  const results = {};

  for (const sc of scenarios) {
    let attempts = 0;
    let contacts = 0;
    let returns = 0;
    const closestDists = [];
    const prepareLeadTimes = [];
    const strikeTimingErrors = [];
    const missReasons = {
      "EARLY STRIKE": 0,
      "LATE STRIKE": 0,
      "BODY MISS": 0,
      "RACKET MISS": 0,
      "NEURAL MISS": 0,
      "PATHWAY SILENCED": 0,
      "VERTICAL MISS": 0,
      "LATERAL MISS": 0,
    };

    const prng = createPrng(1337 + scenarios.indexOf(sc) * 100);

    for (let sIdx = 0; sIdx < seeds.length; sIdx++) {
      const seed = seeds[sIdx];

      for (let t = 0; t < trialsPerSeed; t++) {
        if (attempts >= trialsPerScenario) break;
        attempts++;

        const game = new Game({
          ...defaults,
          opponentType: "fruitfly",
          ...configOverrides,
        });
        await game.fly.init(false, undefined, seed);

        if (silencer) {
          silencer(game);
        }

        // Randomize trial parameters:
        // ±20% shuttle speed (0.80 to 1.20)
        const speedMultiplier = 0.8 + prng() * 0.4;
        // ±0.6 m lateral origin
        const originX = (prng() * 2 - 1) * 0.6;
        // ±0.35 m height
        const originY = (prng() * 2 - 1) * 0.35;
        // ±12% launch angle (pitch & yaw between -0.12 and +0.12 rad)
        const yaw = (prng() * 2 - 1) * 0.12;
        const pitch = (prng() * 2 - 1) * 0.12;

        game.feedSyntheticShot(sc, {
          originOffset: { x: originX, y: originY, z: 0 },
          speedMultiplier,
          anglePerturbation: { yaw, pitch },
        });

        let minRacketDist = 999;
        let returned = false;
        let contactMade = false;

        for (let step = 0; step < 320; step++) {
          game.step(1 / 120);

          const s = game.shuttle.p;
          const rPos = game.fly.racketPos;
          const dx = s.x - rPos.x;
          const dy = s.y - rPos.y;
          const dz = s.z - rPos.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist < minRacketDist) minRacketDist = dist;

          if (game.fly.swingAttempted) {
            contactMade = true;
          }

          if (game.shuttle.lastHit === 1 || game.hits >= 2) {
            returned = true;
            contactMade = true;
            break;
          }
          if (game.state === "point") {
            break;
          }
        }

        closestDists.push(minRacketDist);

        if (game.currentShotDiagnostic) {
          const diag = game.currentShotDiagnostic;
          if (diag.prepareTime > 0 && diag.closestTime > 0) {
            prepareLeadTimes.push(
              Math.max(0, diag.closestTime - diag.prepareTime),
            );
          }
          if (diag.predictedContactTime > 0 && diag.closestTime > 0) {
            strikeTimingErrors.push(
              Math.abs(diag.closestTime - diag.predictedContactTime),
            );
          }
          if (!returned) {
            const reason =
              diag.missReason || game.lastMissReason || "RACKET MISS";
            if (missReasons[reason] !== undefined) {
              missReasons[reason]++;
            } else {
              missReasons["RACKET MISS"]++;
            }
          }
        } else if (!returned) {
          missReasons["RACKET MISS"]++;
        }

        if (contactMade) contacts++;
        if (returned) returns++;
      }
    }

    const meanPrepLead =
      prepareLeadTimes.length > 0
        ? (
            prepareLeadTimes.reduce((a, b) => a + b, 0) /
            prepareLeadTimes.length
          ).toFixed(3) + "s"
        : "N/A";
    const meanStrikeErr =
      strikeTimingErrors.length > 0
        ? (
            strikeTimingErrors.reduce((a, b) => a + b, 0) /
            strikeTimingErrors.length
          ).toFixed(3) + "s"
        : "N/A";

    const missBreakdown =
      Object.entries(missReasons)
        .filter(([_, count]) => count > 0)
        .map(([name, count]) => `${name}:${count}`)
        .join(", ") || "None (100% returned)";

    results[sc] = {
      trials: attempts,
      contactRate: ((contacts / attempts) * 100).toFixed(1) + "%",
      returnRate: ((returns / attempts) * 100).toFixed(1) + "%",
      medianDist: median(closestDists).toFixed(2) + "m",
      p95Dist: percentile(closestDists, 95).toFixed(2) + "m",
      prepLead: meanPrepLead,
      strikeTimingErr: meanStrikeErr,
      missBreakdown,
    };
  }

  console.log(
    `\n================================================================================`,
  );
  console.log(`STRESS BENCHMARK (100 Trials / Scenario): ${title}`);
  console.log(
    `================================================================================`,
  );
  console.table(results);
  return results;
}

async function main() {
  console.log(
    "=== FRUIT-FLY CONNECTOME 100-TRIAL RANDOMIZED STRESS BENCHMARK ===\n",
  );
  console.log("Randomization per trial:");
  console.log(" - Shuttle Speed: ±20% (0.80x - 1.20x)");
  console.log(" - Lateral Origin: ±0.60m");
  console.log(" - Height Origin: ±0.35m");
  console.log(" - Launch Angle: ±12% (pitch/yaw)");
  console.log(" - Neural Seeds: 10 distinct seeds across 100 trials\n");

  // 1. Demo Assist Mode (100 trials/scenario = 600 trials total)
  await runStressBenchmark(
    "DEMO ASSIST MODE (Blade Envelope r = 0.82m)",
    {
      flyEmbodimentMode: "demo-assist",
    },
    null,
    100,
  );

  // 2. Scientific Baseline Mode (100 trials/scenario = 600 trials total)
  await runStressBenchmark(
    "SCIENTIFIC BASELINE (Blade Envelope r = 0.65m)",
    {
      flyEmbodimentMode: "scientific",
    },
    null,
    100,
  );

  // 3. Ablation: Silencing DNa02 (Steering Descending Neuron)
  await runStressBenchmark(
    "ABLATION: DNa02 SILENCED (Steering abolished)",
    {
      flyEmbodimentMode: "demo-assist",
    },
    (game) => {
      game.fly.bridge.applyInterventions({ silencedTypes: ["DNa02"] });
    },
    100,
  );

  // 4. Ablation: Silencing Visual Projection Neurons (LC4, LC6, LC10, LPLC)
  await runStressBenchmark(
    "ABLATION: VISUAL VPNS SILENCED (LC4, LC6, LC10, LPLC)",
    {
      flyEmbodimentMode: "demo-assist",
    },
    (game) => {
      game.fly.bridge.applyInterventions({
        silencedTypes: ["LC4", "LC6", "LC10", "LPLC1", "LPLC2"],
      });
    },
    100,
  );
}

main().catch(console.error);
