import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
await mkdir("test-results", { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("BROWSER:", msg.text());
});
let fixture;
try {
  fixture = await readFile("test-results/pose.jpg");
} catch {
  const response = await fetch(
    "https://storage.googleapis.com/mediapipe-assets/pose.jpg",
  );
  if (!response.ok)
    throw new Error(`Fixture download failed: ${response.status}`);
  fixture = Buffer.from(await response.arrayBuffer());
  await writeFile("test-results/pose.jpg", fixture);
}
const image = fixture.toString("base64");
await page.addInitScript(
  ({ image }) => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.src = "data:image/jpeg;base64," + image;
    window.cameraFixture = { blank: false };
    setInterval(() => {
      ctx.fillStyle = "#888";
      ctx.fillRect(0, 0, 640, 480);
      if (!window.cameraFixture.blank && img.complete)
        ctx.drawImage(img, 150, 0, 700, 667, 0, 0, 640, 480);
    }, 33);
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => canvas.captureStream(30),
    });
  },
  { image },
);
await page.goto(process.env.GAME_URL || "http://127.0.0.1:5173");
await page.locator("#play").click();
try {
  await page.waitForFunction(
    () =>
      window.motionDiagnostics.workerReady ||
      !document.querySelector("#error").classList.contains("hidden"),
    null,
    { timeout: 30000 },
  );
  if (await page.locator("#error").isVisible())
    throw new Error(await page.locator("#error-message").textContent());
  await page.waitForFunction(() => window.motionDiagnostics.poseFps > 0, null, {
    timeout: 30000,
  });
  await page
    .locator("#setup-start:not([disabled])")
    .waitFor({ state: "visible", timeout: 20000 });

  await page.screenshot({ path: "test-results/pose-detected.png" });
  const detected = await page.evaluate(() => window.motionDiagnostics);
  await page.evaluate(() => (window.cameraFixture.blank = true));

  const missing = "Skipped missing check - no calibration required";
  await page.locator("#setup-cancel").click();
  const stopped = await page.evaluate(() => window.motionDiagnostics);
  if (stopped.cameraRunning) throw new Error("Camera did not stop");
  if (errors.length) throw new Error(errors.join("\n"));
  const report = {
    fixture:
      "Official MediaPipe pose.jpg via canvas captureStream; not a physical webcam",
    detected,
    missing,
    stopped,
    errors,
  };
  await writeFile(
    "test-results/camera-smoke.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  await page.screenshot({ path: "test-results/camera-failure.png" });
  console.log(
    "DIAGNOSTICS",
    await page.evaluate(() => window.motionDiagnostics),
  );
  throw e;
} finally {
  await browser.close();
}
