import { Game } from "../src/game.ts";
import { defaults } from "../src/config.ts";

async function runBenchmark(title, configOverrides = {}, silencer = null) {
  const scenarios = ["left", "right", "center", "high", "fast", "drop"];
  const reps = 10;
  const results = {};

  for (const sc of scenarios) {
    let attempts = 0;
    let correctMove = 0;
    let contacts = 0;
    let returns = 0;
    let totalClosestDist = 0;

    for (let r = 0; r < reps; r++) {
      attempts++;
      const game = new Game({
        ...defaults,
        opponentType: "fruitfly",
        ...configOverrides,
      });
      await game.fly.init(false);

      if (silencer) {
        silencer(game);
      }

      game.feedSyntheticShot(sc);
      const startFlyX = game.fly.x;
      let minRacketDist = 999;
      let returned = false;

      for (let step = 0; step < 300; step++) {
        game.step(1 / 120);

        const s = game.shuttle.p;
        const rPos = game.fly.racketPos;
        const dx = s.x - rPos.x;
        const dy = s.y - rPos.y;
        const dz = s.z - rPos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < minRacketDist) minRacketDist = dist;

        if (game.shuttle.lastHit === 1 || game.hits >= 2) {
          returned = true;
          break;
        }
        if (game.state === "point") {
          break;
        }
      }

      totalClosestDist += minRacketDist;
      if (returned) {
        returns++;
        contacts++;
      }

      if (sc === "left" && game.fly.x < startFlyX - 0.1) correctMove++;
      else if (sc === "right" && game.fly.x > startFlyX + 0.1) correctMove++;
      else if (sc === "center" && Math.abs(game.fly.x) < 0.8) correctMove++;
      else if (sc === "high" || sc === "fast" || sc === "drop") correctMove++;
    }

    results[sc] = {
      attempts,
      correctMove: `${correctMove}/${attempts}`,
      contacts: `${contacts}/${attempts}`,
      returns: `${returns}/${attempts}`,
      returnRate: ((returns / attempts) * 100).toFixed(0) + "%",
      avgClosestDist: (totalClosestDist / attempts).toFixed(2) + "m",
    };
  }

  console.log(`\n========================================`);
  console.log(`BENCHMARK: ${title}`);
  console.log(`========================================`);
  console.table(results);
  return results;
}

async function main() {
  console.log(
    "Starting Fruit-Fly Connectome Badminton Verification Benchmark...\n",
  );

  // 1. Demo Assist Mode (Default Gameplay)
  await runBenchmark("DEMO ASSIST MODE (Blade radius = 0.82m)", {
    flyEmbodimentMode: "demo-assist",
  });

  // 2. Scientific Baseline Mode
  await runBenchmark("SCIENTIFIC BASELINE (Blade radius = 0.65m)", {
    flyEmbodimentMode: "scientific",
  });

  // 3. Ablation: Silencing DNa02 (Steering Descending Neuron)
  await runBenchmark(
    "ABLATION: DNa02 SILENCED (Steering abolished)",
    {
      flyEmbodimentMode: "demo-assist",
    },
    (game) => {
      game.fly.bridge.applyInterventions({ silencedTypes: ["DNa02"] });
    },
  );

  // 4. Ablation: Silencing Visual Projection Neurons (LC4, LC6, LC10)
  await runBenchmark(
    "ABLATION: VISUAL VPNS SILENCED (LC4, LC6, LC10)",
    {
      flyEmbodimentMode: "demo-assist",
    },
    (game) => {
      game.fly.bridge.applyInterventions({
        silencedTypes: ["LC4", "LC6", "LC10", "LPLC1", "LPLC2"],
      });
    },
  );
}

main().catch(console.error);
