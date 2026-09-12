import { ConnectomeLoader } from "./connectomeLoader";
import { NeuralEngine } from "./neuralEngine";
import type {
  FlySensoryInput,
  InterventionSettings,
  NeuralTelemetrySnapshot,
} from "./types";

let engine: NeuralEngine | null = null;
let lastSensoryInput: FlySensoryInput | null = null;
let running = false;
let stepInterval: any = null;

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  switch (type) {
    case "INIT": {
      try {
        const graph =
          payload?.graph ||
          (await ConnectomeLoader.load(payload?.baseUrl || "/data/connectome"));
        engine = new NeuralEngine(graph);
        self.postMessage({
          type: "READY",
          payload: { manifest: graph.manifest },
        });
        startLoop();
      } catch (err: any) {
        self.postMessage({
          type: "ERROR",
          payload: { message: err?.message || String(err) },
        });
      }
      break;
    }

    case "SENSORY": {
      lastSensoryInput = payload;
      break;
    }

    case "INTERVENTIONS": {
      if (engine && payload) {
        const p = payload as Partial<InterventionSettings>;
        if (p.silencedTypes !== undefined)
          engine.interventions.setSilencedTypes(p.silencedTypes);
        if (p.silencedNeuronIds !== undefined)
          engine.interventions.setSilencedNeuronIds(p.silencedNeuronIds);
        if (p.synapticGain !== undefined)
          engine.interventions.setSynapticGain(p.synapticGain);
        if (p.backgroundDrive !== undefined)
          engine.interventions.setBackgroundDrive(p.backgroundDrive);
      }
      break;
    }

    case "RESET": {
      if (engine) engine.reset();
      break;
    }

    case "STOP": {
      stopLoop();
      break;
    }
  }
};

function startLoop() {
  if (running) return;
  running = true;

  // Run LIF simulation at 250 Hz (4ms intervals)
  let lastTime = performance.now();
  stepInterval = setInterval(() => {
    if (!engine) return;
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;

    // Step the simulation
    const motorCmd = engine.update(
      Math.min(0.05, Math.max(0.002, dt)),
      lastSensoryInput || undefined,
    );

    // Send telemetry snapshot at ~60 Hz
    const telemetry: NeuralTelemetrySnapshot = engine.getTelemetry(60);
    self.postMessage({ type: "TELEMETRY", payload: telemetry });
  }, 16);
}

function stopLoop() {
  running = false;
  if (stepInterval) {
    clearInterval(stepInterval);
    stepInterval = null;
  }
}
