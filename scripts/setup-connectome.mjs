import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

console.log("=== Setting up MaleCNS v1.0 Connectome Dataset ===");

// 1. Detect Python executable
let pythonCmd = "python";
if (process.platform === "win32" && existsSync(".venv/Scripts/python.exe")) {
  pythonCmd = resolve(".venv/Scripts/python.exe");
} else if (existsSync(".venv/bin/python")) {
  pythonCmd = resolve(".venv/bin/python");
}

console.log(`Using Python: ${pythonCmd}`);

const pipelineScript = resolve("tools/connectome/pipeline.py");
const res = spawnSync(pythonCmd, [pipelineScript], {
  stdio: "inherit",
  env: process.env,
});

if (res.status !== 0) {
  console.error("Connectome setup pipeline failed.");
  process.exit(res.status || 1);
}

console.log("Connectome setup completed successfully.");
