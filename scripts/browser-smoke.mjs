import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
await mkdir("test-results", { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: [
    "--enable-unsafe-swiftshader",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream"
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(process.env.GAME_URL || "http://127.0.0.1:5173");
await page.locator("#play").waitFor();
await page.screenshot({ path: "test-results/home.png" });
await page.locator("#keyboard").dispatchEvent("click");
await page.keyboard.press("Space");
// Easy AI is allowed to miss; start another rally instead of treating a miss as a broken game.
for (let i = 0; i < 60; i++) {
  const status = await page.evaluate(() => window.motionDiagnostics);
  if (status.contacts >= 2) break;
  if (status.state === "ready") await page.keyboard.press("Space");
  await page.waitForTimeout(200);
}
if ((await page.evaluate(() => window.motionDiagnostics.contacts)) < 2)
  throw new Error("No AI return after repeated serves");
const rally = await page.evaluate(() => window.motionDiagnostics);
await page.screenshot({ path: "test-results/game.png" });
await page.locator("#pause").click();
await page.locator("#resume").waitFor({ state: "visible" });
await page.locator("#settings-open").click();
await page.locator("#difficulty").selectOption("normal");
await page.locator("#settings-done").click();
if (await page.locator("#pause-screen").isHidden())
  throw new Error("Settings did not return to paused match");
await page.locator("#back-home").click();
await page.locator("#synthetic").click();
await page.waitForFunction(() => window.motionDiagnostics.contacts > 0);
const synthetic = await page.evaluate(() => window.motionDiagnostics);
await page.locator("#pause").click();
await page.locator("#back-home").click();
if (errors.length) throw new Error(errors.join("\n"));
const report = { rally, synthetic, errors };
await writeFile(
  "test-results/browser-smoke.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
await browser.close();
