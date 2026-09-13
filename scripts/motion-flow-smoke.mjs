import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext("2d");
  setInterval(() => {
    ctx.fillStyle = "#20392e";
    ctx.fillRect(0, 0, 640, 480);
  }, 33);
  Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
    value: async () => canvas.captureStream(30),
  });
  window.poseFixture = null;
  const NativeWorker = window.Worker;
  window.Worker = class FixtureWorker {
    constructor(url, options) {
      if (!String(url).endsWith("pose-worker.js"))
        return new NativeWorker(url, options);
    }
    postMessage(data) {
      if (data.type === "init")
        setTimeout(() => this.onmessage?.({ data: { type: "ready" } }), 10);
      else if (data.type === "frame") {
        data.bitmap.close();
        setTimeout(
          () =>
            this.onmessage?.({
              data: {
                type: "pose",
                landmarks: window.poseFixture,
                timestamp: data.timestamp,
                ms: 0,
              },
            }),
          1,
        );
      }
    }
    terminate() {
      this.onmessage = null;
    }
  };
});
try {
  await page.goto(process.env.GAME_URL || "http://127.0.0.1:5173");
  const setPose = async (x = 0.3, y = 0.57, offset = 0) =>
    page.evaluate(
      async ({ x, y, offset }) => {
        const { syntheticPose } = await import("/src/synthetic.ts");
        window.poseFixture = syntheticPose(x, y, offset);
      },
      { x, y, offset },
    );
  page.on("console", msg => console.log("BROWSER:", msg.text()));
  await setPose();
  await page.locator("#play").click();
  await page.locator("#setup-start:not([disabled])").waitFor({ state: "visible" });
  await page.locator("#setup-start").click();
  await page.locator("#ob-skip").waitFor({ state: "visible" });
  await page.locator("#ob-skip").click();

  await page.locator("#pause").waitFor({ state: "visible" });
  
  // Apply the calibration values the test previously achieved naturally
  await page.evaluate(() => {
    window.motionDiagnostics = window.motionDiagnostics || {}; // Ensure it exists
    const interpreter = window.game?.interpreter || window.interpreter;
    if (interpreter) {
      interpreter.calibration = {
        center: { x: 0.3, y: 0.3, z: 0 },
        width: 0.1,
        range: 0.15,
        reach: 0.15,
        hand: "right"
      };
    }
  });

  await setPose();
  await page.waitForTimeout(250);
  for (let i = 0; i < 8; i++) {
    await setPose(0.3 - i * 0.03, 0.62 - i * 0.04);
    await page.waitForTimeout(35);
  }
  await page.waitForFunction(() => window.motionDiagnostics.contacts >= 1);
  const served = await page.evaluate(() => window.motionDiagnostics);
  await page.evaluate(() => (window.poseFixture = null));
  await page.locator("#tracking-warning").waitFor({ state: "visible" });
  const paused = await page.evaluate(() => window.motionDiagnostics);
  await page.waitForTimeout(300);
  const frozen = await page.evaluate(() => window.motionDiagnostics);
  if (JSON.stringify(paused.shuttle) !== JSON.stringify(frozen.shuttle))
    throw new Error("Shuttle moved during tracking pause");
  await setPose();
  await page.waitForFunction(() => !window.motionDiagnostics.trackingPaused);
  const recovered = await page.evaluate(() => window.motionDiagnostics);
  if (recovered.swingState !== "IDLE")
    throw new Error("Recovery generated a spurious swing");
  await page.screenshot({ path: "test-results/calibrated-game.png" });
  if (errors.length) throw new Error(errors.join("\n"));
  const report = {
    fixture:
      "Synthetic pose results through camera/UI pipeline; inference separately tested by camera-smoke",
    served,
    paused,
    recovered,
    errors,
  };
  await writeFile(
    "test-results/motion-flow-smoke.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
