import "./style.css";
import { C, readSettings } from "./config";
import { Game } from "./game";
import { CourtRenderer } from "./renderer";
import { CameraManager } from "./camera";
import {
  CalibrationManager,
  MotionInterpreter,
  neutralMotion,
  poseQuality,
  bodyCenter,
  type Pose,
} from "./motion";
import { AudioManager } from "./audio";
import { DebugInput, syntheticPose } from "./synthetic";
import { BrainRenderer } from "./flybrain/brainRenderer";

const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
  document.querySelector<T>(s)!;
const settings = readSettings(),
  game = new Game(settings),
  camera = new CameraManager(),
  interpreter = new MotionInterpreter(),
  audio = new AudioManager(),
  debug = new DebugInput();
let screen = "home",
  mode: "camera" | "keyboard" | "synthetic" = "camera",
  calibration: CalibrationManager | null = null,
  calibrated = false,
  lastPose: Pose | null = null,
  lastGood = 0,
  previousPoseTime = 0,
  lastFrame = performance.now(),
  accumulator = 0,
  fps = 60,
  trackingPaused = false,
  recovery = 0,
  toastUntil = 0,
  syntheticTime = 0,
  brainPanelOpen = false;

$("#app").innerHTML = `
<div id="court"></div><div class="vignette"></div>
<header>
  <a class="brand" href="#" aria-label="Motion Badminton home"><span class="brand-icon">↗</span> MOTION<span class="brand-light">BADMINTON</span></a>
  <div class="header-right">
    <button id="btn-toggle-brain" class="brain-nav-btn">🧠 CONNECTOME LAB</button>
    <span class="local"><i></i> LOCAL PLAY · PRIVATE BY DESIGN</span>
    <button class="icon" id="settings-open" aria-label="Settings">⚙</button>
  </div>
</header>
<main id="home" class="panel screen">
  <div class="eyebrow">STEP INTO THE GAME / 01</div>
  <h1>Human vs Fruit-Fly.<br>Connectome <em>Badminton.</em></h1>
  <p class="intro">Play badminton against an opponent powered by a real <em>Drosophila</em> connectome simulation (MaleCNS v1.0).<br>Stand in place, lean, and swing naturally.</p>
  <button class="primary" id="play">PLAY WITH CAMERA <span>↗</span></button>
  <div class="home-actions">
    <button id="calibrate">Calibrate</button>
    <button id="home-settings">Settings</button>
    <button id="quit">Quit</button>
  </div>
  <div class="safety">↔ &nbsp; Clear a comfortable arm-span around you before playing.<small>Stay in place (~1m area). Avatar handles court traversal.</small></div>
  <button id="keyboard" class="text-button">No camera? Open keyboard test →</button>
  <div class="feature-row"><span>01 <b>CONNECT</b></span><span>02 <b>CALIBRATE</b></span><span>03 <b>RALLY</b></span></div>
</main>
<div id="home-caption">
  <span>PLAY AGAINST A REAL CONNECTOME</span>
  <b>160K Synapses.<br>Zero Scripting.</b>
  <small>JANELIA MALECNS v1.0 / LIF NEURAL SIMULATION / AUTO-FOOTWORK</small>
</div>
<section id="calibration" class="screen hidden dialog">
  <div class="eyebrow">FIND YOUR FORM</div>
  <h2>Let’s get you ready.</h2>
  <p id="calibration-message">Connecting your camera…</p>
  <div class="progress"><i id="calibration-progress"></i></div>
  <div class="steps"><span>Position</span><span>Racket hand</span><span>Reach & Intent</span></div>
  <p class="muted">Face the camera with your upper body visible.<br>Stay in place — small body shifts and natural swings control the game.</p>
  <button id="calibration-cancel" class="secondary">Back to home</button>
</section>
<div id="hud" class="screen hidden">
  <div class="scoreboard">
    <div><span>YOU</span><b id="your-score">00</b></div>
    <i>:</i>
    <div><span id="opp-label">FRUIT-FLY</span><b id="ai-score">00</b></div>
    <small>RALLY SCORING · FIRST TO 21</small>
  </div>
  <div class="session-label">
    <i></i>
    <span id="control-label">CAMERA CONTROL</span>
    <span id="tracking-status">TRACKING</span>
  </div>
  <button class="secondary" id="pause">Ⅱ &nbsp; Pause</button>
  <div id="rally-hint">
    <span id="shot-label">READY</span>
    <b id="instruction">Swing gently upward to serve</b>
    <small id="rally-count">RALLY 0</small>
  </div>
  <div id="keyboard-help" class="hidden">A / D intent · W / S reach · SPACE swing · 1 clear / 2 drive / 3 drop / 4 smash / 5 lift</div>
</div>
<section id="pause-screen" class="screen hidden dialog">
  <div class="eyebrow">TAKE A BREATHER</div>
  <h2>Match paused.</h2>
  <p>Your next rally is waiting.</p>
  <button id="resume" class="primary">BACK TO COURT ↗</button>
  <button id="recalibrate" class="secondary">Recalibrate camera</button>
  <button id="restart" class="secondary">Restart match</button>
  <button id="back-home" class="text-button">Return home</button>
</section>
<section id="results" class="screen hidden dialog">
  <div class="eyebrow">THAT’S A MATCH</div>
  <h2 id="result-title">Well played.</h2>
  <div id="result-score" class="result-score"></div>
  <p id="result-stats"></p>
  <button id="play-again" class="primary">PLAY AGAIN ↗</button>
  <button id="results-home" class="secondary">Home</button>
</section>
<section id="settings" class="screen hidden dialog">
  <div class="eyebrow">MAKE IT YOUR GAME</div>
  <h2>Settings</h2>
  <div class="setting-grid">
    <label>Opponent Type
      <select id="opponent-type">
        <option value="fruitfly">Fruit-Fly Connectome (MaleCNS v1.0)</option>
        <option value="classic">Classic Scripted AI</option>
      </select>
    </label>
    <label>Camera<select id="camera-select"><option value="">Default camera</option></select></label>
    <label>Difficulty<select id="difficulty"><option value="easy">Easy</option><option value="normal">Normal</option></select></label>
    <label>Motion assistance<select id="assist"><option value="beginner">Beginner</option><option value="normal">Normal</option></select></label>
    <label>Swing sensitivity<input id="sensitivity" type="range" min="0.6" max="1.8" step="0.1"></label>
    <label>Movement sensitivity<input id="movement" type="range" min="0.5" max="1.8" step="0.1"></label>
    <label>Audio volume<input id="volume" type="range" min="0" max="1" step="0.05"></label>
    <label class="check"><input id="preview" type="checkbox"> Webcam preview</label>
    <label class="check"><input id="debug" type="checkbox"> Developer overlay</label>
  </div>
  <p class="muted">Racket hand: <span id="hand-label">not calibrated</span>. Recalibrate to change hands.<br>Changing camera requires recalibration.</p>
  <button id="settings-done" class="primary">SAVE SETTINGS</button>
  <button id="synthetic" class="text-button">Run synthetic pose diagnostic →</button>
</section>

<!-- CONNECTOME NEURAL LAB PANEL -->
<aside id="brain-panel" class="hidden">
  <div class="brain-header">
    <div>
      <span class="brain-badge">MALE-CNS v1.0 LIVE TELEMETRY</span>
      <h3>Fruit-Fly Connectome Lab</h3>
    </div>
    <div class="brain-view-tabs">
      <button id="btn-view-circuit" class="active">Circuit</button>
      <button id="btn-view-spatial">Spatial</button>
      <button id="btn-view-raster">Raster</button>
      <button id="btn-brain-close" aria-label="Close Brain Panel">✕</button>
    </div>
  </div>
  <div id="brain-viewport"></div>
  <div class="neural-lab-controls">
    <div class="lab-title">
      <span>OPTOGENETIC INTERVENTIONS</span>
      <button id="btn-lab-reset" class="text-button">Reset All</button>
    </div>
    <div class="lab-toggles">
      <button id="silence-lc4" class="lab-toggle">Silence Looming (LC4/6)</button>
      <button id="silence-dna" class="lab-toggle">Silence Steering (DNa02)</button>
      <button id="silence-dnb" class="lab-toggle">Silence Strike (DNb01)</button>
    </div>
    <div class="lab-sliders">
      <label>Synaptic Gain <span id="gain-val">1.0x</span>
        <input id="slider-gain" type="range" min="0.2" max="2.5" step="0.1" value="1.0">
      </label>
      <label>Sensory Drive <span id="drive-val">1.2</span>
        <input id="slider-drive" type="range" min="0" max="4.0" step="0.2" value="1.2">
      </label>
    </div>
  </div>
</aside>

<aside id="preview-box" class="hidden"><canvas id="skeleton" width="640" height="480"></canvas><span id="preview-label">LIVE · ON DEVICE</span></aside>
<pre id="debug-overlay" class="hidden"></pre>
<div id="tracking-warning" class="hidden">Step back into frame<small>The rally is paused until tracking is stable.</small></div>
<div id="toast" role="status" class="hidden"></div>
<div id="error" role="alert" class="hidden"><b>Let’s fix that.</b><p id="error-message"></p><button id="error-close" class="secondary">Got it</button></div>
<footer><span>PLAY FROM WHERE YOU STAND.</span><span>CONNECTOME LAB / JANELIA MALECNS v1.0</span></footer>`;

let renderer: CourtRenderer;
try {
  renderer = new CourtRenderer($("#court"));
} catch {
  showError(
    "WebGL could not start. Enable hardware acceleration and open this page in Chrome or Edge.",
  );
  throw new Error("WebGL unavailable");
}

let brainRenderer: BrainRenderer | null = null;
try {
  brainRenderer = new BrainRenderer($("#brain-viewport"));
  // Initialize Drosophila connectome simulation
  void game.fly.init(true, "/data/connectome").then(() => {
    const g = game.fly.bridge.getConnectomeGraph();
    if (g) {
      if (brainRenderer) brainRenderer.setGraph(g);
      const isReal = g.manifest.provenance === "malecns-real";
      const caption = $("#home-caption");
      if (caption) {
        if (isReal) {
          caption.innerHTML = `
            <span>REAL MALECNS v1.0 CONNECTOME</span>
            <b>${g.manifest.synapseCount.toLocaleString()} Biological Synapses.<br>${g.manifest.neuronCount.toLocaleString()} Real Neurons.</b>
            <small>OFFICIAL JANELIA MALECNS v1.0 / REAL CONNECTIVITY / LIF SIMULATION</small>
          `;
        } else {
          caption.innerHTML = `
            <span>DEVELOPER TEST GRAPH</span>
            <b>NOT MALECNS DATA</b>
            <small>TEST FIXTURE ONLY</small>
          `;
        }
      }
    }
  });
} catch (err) {
  console.warn("BrainRenderer initialization deferred:", err);
}

$("#preview-box").prepend(camera.video);

function showError(message: string) {
  $("#error-message").textContent = message;
  $("#error").classList.remove("hidden");
}

function setScreen(next: string) {
  screen = next;
  document
    .querySelectorAll(".screen")
    .forEach((e) => e.classList.add("hidden"));
  $(`#${next === "game" ? "hud" : next}`).classList.remove("hidden");
  $("#home-caption").classList.toggle("hidden", next !== "home");
  $("#tracking-warning").classList.add("hidden");
  debug.keys.clear();
  accumulator = 0;
}

function home() {
  camera.stop();
  calibrated = false;
  lastGood = 0;
  lastPose = null;
  trackingPaused = false;
  setScreen("home");
}

function startGame() {
  interpreter.reset();
  game.setMotion(neutralMotion());
  debug.swingUntil = 0;
  game.reset();
  trackingPaused = false;
  recovery = 0;
  setScreen("game");
  $("#opp-label").textContent =
    settings.opponentType === "fruitfly" ? "FRUIT-FLY" : "OPPONENT";
  $("#control-label").textContent =
    mode === "camera"
      ? "CAMERA CONTROL"
      : mode === "keyboard"
        ? "KEYBOARD TEST"
        : "SYNTHETIC POSE DIAGNOSTIC";
  $("#keyboard-help").classList.toggle("hidden", mode !== "keyboard");
}

async function startCamera() {
  audio.unlock();
  audio.volume = settings.volume;
  mode = "camera";
  calibrated = false;
  calibration = new CalibrationManager();
  interpreter.reset();
  lastPose = null;
  lastGood = 0;
  previousPoseTime = 0;
  setScreen("calibration");
  $("#calibration-message").textContent =
    "Connecting camera and loading local pose model…";
  try {
    await camera.start(settings.camera);
    void populateCameras();
  } catch (e) {
    home();
    showError((e as Error).message);
  }
}

camera.onError = (message) => {
  if (screen === "game") setScreen("pause-screen");
  showError(message);
};

camera.onPose = (pose, timestamp) => {
  lastPose = pose;
  const now = performance.now();
  if (pose && poseQuality(pose)) lastGood = now;
  if (screen === "calibration" && calibration) {
    const dt = previousPoseTime
      ? Math.max(0.008, Math.min(0.1, (timestamp - previousPoseTime) / 1000))
      : 0.033;
    previousPoseTime = timestamp;
    const res = calibration.update(pose || undefined, dt);
    $("#calibration-progress").style.width =
      `${Math.round(calibration.progress * 100)}%`;
    $("#calibration-message").textContent = res.message;
    document
      .querySelectorAll("#calibration .steps span")
      .forEach((el, index) => {
        el.classList.toggle("active", index === calibration!.stage);
      });
    if (res.done) {
      calibrated = true;
      interpreter.calibration = res.done;
      $("#hand-label").textContent = `${res.done.hand.toUpperCase()} HAND`;
      startGame();
    }
    return;
  }
  if (screen === "game" && calibrated && pose) {
    const motion = interpreter.update(pose, timestamp);
    if (motion) game.setMotion(motion);
  }
};

function toast(text: string) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.remove("hidden");
  toastUntil = performance.now() + 1800;
}

// --- Brain Panel & Neural Lab Event Listeners ---
function toggleBrainPanel(open?: boolean) {
  brainPanelOpen = open !== undefined ? open : !brainPanelOpen;
  $("#brain-panel").classList.toggle("hidden", !brainPanelOpen);
  if (brainPanelOpen && brainRenderer) {
    brainRenderer.resize();
  }
}

$("#btn-toggle-brain").addEventListener("click", () => toggleBrainPanel());
$("#btn-brain-close").addEventListener("click", () => toggleBrainPanel(false));

$("#btn-view-circuit").addEventListener("click", () => {
  brainRenderer?.setViewMode("circuit");
  document
    .querySelectorAll(".brain-view-tabs button")
    .forEach((b) => b.classList.remove("active"));
  $("#btn-view-circuit").classList.add("active");
});
$("#btn-view-spatial").addEventListener("click", () => {
  brainRenderer?.setViewMode("spatial");
  document
    .querySelectorAll(".brain-view-tabs button")
    .forEach((b) => b.classList.remove("active"));
  $("#btn-view-spatial").classList.add("active");
});
$("#btn-view-raster").addEventListener("click", () => {
  brainRenderer?.setViewMode("raster");
  document
    .querySelectorAll(".brain-view-tabs button")
    .forEach((b) => b.classList.remove("active"));
  $("#btn-view-raster").classList.add("active");
});

// Interventions Toggles
let silencedLC = false;
let silencedDNa = false;
let silencedDNb = false;

function updateInterventions() {
  const silencedTypes: string[] = [];
  if (silencedLC) silencedTypes.push("LC4", "LC6", "LPLC");
  if (silencedDNa) silencedTypes.push("DNa01", "DNa02");
  if (silencedDNb) silencedTypes.push("DNb01", "DNp01");

  game.fly.bridge.applyInterventions({
    silencedTypes,
    synapticGain: parseFloat(($("#slider-gain") as HTMLInputElement).value),
    backgroundDrive: parseFloat(($("#slider-drive") as HTMLInputElement).value),
  });
}

$("#silence-lc4").addEventListener("click", () => {
  silencedLC = !silencedLC;
  $("#silence-lc4").classList.toggle("silenced", silencedLC);
  updateInterventions();
  const matched =
    game.fly.bridge.getEngine()?.interventions.getMatchedNeuronsForType("LC4")
      ?.bodyIds || [];
  toast(
    silencedLC
      ? `Silenced LC4/6 (${matched.length} MaleCNS neurons)`
      : "Restored LC4/6 Looming",
  );
});
$("#silence-dna").addEventListener("click", () => {
  silencedDNa = !silencedDNa;
  $("#silence-dna").classList.toggle("silenced", silencedDNa);
  updateInterventions();
  const matched =
    game.fly.bridge.getEngine()?.interventions.getMatchedNeuronsForType("DNa02")
      ?.bodyIds || [];
  toast(
    silencedDNa
      ? `Silenced DNa02 Steering (${matched.length} neurons: ${matched.join(", ")})`
      : "Restored DNa02 Steering",
  );
});
$("#silence-dnb").addEventListener("click", () => {
  silencedDNb = !silencedDNb;
  $("#silence-dnb").classList.toggle("silenced", silencedDNb);
  updateInterventions();
  const matched =
    game.fly.bridge.getEngine()?.interventions.getMatchedNeuronsForType("DNb01")
      ?.bodyIds || [];
  toast(
    silencedDNb
      ? `Silenced DNb01 Strike (${matched.length} neurons: ${matched.join(", ")})`
      : "Restored DNb01 Strike",
  );
});

$("#slider-gain").addEventListener("input", (e) => {
  const val = (e.target as HTMLInputElement).value;
  $("#gain-val").textContent = `${parseFloat(val).toFixed(1)}x`;
  updateInterventions();
});
$("#slider-drive").addEventListener("input", (e) => {
  const val = (e.target as HTMLInputElement).value;
  $("#drive-val").textContent = parseFloat(val).toFixed(1);
  updateInterventions();
});

$("#btn-lab-reset").addEventListener("click", () => {
  silencedLC = false;
  silencedDNa = false;
  silencedDNb = false;
  $("#silence-lc4").classList.remove("silenced");
  $("#silence-dna").classList.remove("silenced");
  $("#silence-dnb").classList.remove("silenced");
  ($("#slider-gain") as HTMLInputElement).value = "1.0";
  ($("#slider-drive") as HTMLInputElement).value = "1.2";
  $("#gain-val").textContent = "1.0x";
  $("#drive-val").textContent = "1.2";
  game.fly.bridge.reset();
  updateInterventions();
});

// UI Navigation listeners
$("#play").addEventListener("click", () => void startCamera());
$("#calibrate").addEventListener("click", () => void startCamera());
$("#keyboard").addEventListener("click", () => {
  audio.unlock();
  mode = "keyboard";
  calibrated = true;
  startGame();
});
$("#synthetic").addEventListener("click", () => {
  audio.unlock();
  mode = "synthetic";
  calibrated = true;
  startGame();
});
$("#pause").addEventListener("click", () => setScreen("pause-screen"));
$("#resume").addEventListener("click", () => setScreen("game"));
$("#restart").addEventListener("click", startGame);
$("#recalibrate").addEventListener("click", () => void startCamera());
$("#back-home").addEventListener("click", home);
$("#calibration-cancel").addEventListener("click", home);
$("#play-again").addEventListener("click", startGame);
$("#results-home").addEventListener("click", home);
$("#home-settings").addEventListener("click", openSettings);
$("#settings-open").addEventListener("click", openSettings);
$("#error-close").addEventListener("click", () =>
  $("#error").classList.add("hidden"),
);
$("#quit").addEventListener("click", () => {
  home();
  window.close();
});

let screenBeforeSettings = "home";

function openSettings() {
  screenBeforeSettings = screen;
  $<HTMLSelectElement>("#opponent-type").value = settings.opponentType;
  $<HTMLSelectElement>("#difficulty").value = settings.difficulty;
  $<HTMLSelectElement>("#assist").value = settings.assist;
  $<HTMLInputElement>("#sensitivity").value = String(settings.sensitivity);
  $<HTMLInputElement>("#movement").value = String(settings.movement);
  $<HTMLInputElement>("#volume").value = String(settings.volume);
  $<HTMLInputElement>("#preview").checked = settings.preview;
  $<HTMLInputElement>("#debug").checked = settings.debug;
  void populateCameras();
  setScreen("settings");
}

async function populateCameras() {
  const select = $<HTMLSelectElement>("#camera-select");
  const devices = await camera.devices();
  select.innerHTML = '<option value="">Default camera</option>';
  for (const device of devices) {
    const opt = document.createElement("option");
    opt.value = device.deviceId;
    opt.textContent = device.label || `Camera ${select.options.length}`;
    if (device.deviceId === settings.camera) opt.selected = true;
    select.append(opt);
  }
}

$("#settings-done").addEventListener("click", () => {
  settings.opponentType = $<HTMLSelectElement>("#opponent-type").value as any;
  settings.difficulty = $<HTMLSelectElement>("#difficulty").value as any;
  settings.assist = $<HTMLSelectElement>("#assist").value as any;
  settings.sensitivity = Number($<HTMLInputElement>("#sensitivity").value);
  settings.movement = Number($<HTMLInputElement>("#movement").value);
  settings.volume = Number($<HTMLInputElement>("#volume").value);
  settings.preview = $<HTMLInputElement>("#preview").checked;
  settings.debug = $<HTMLInputElement>("#debug").checked;
  const newCamera = $<HTMLSelectElement>("#camera-select").value;
  const cameraChanged = newCamera !== settings.camera;
  settings.camera = newCamera;
  localStorage.setItem("motion-settings", JSON.stringify(settings));
  audio.volume = settings.volume;
  game.settings = settings;
  if (cameraChanged && camera.running) {
    void startCamera();
  } else {
    setScreen(
      screenBeforeSettings !== "settings"
        ? screenBeforeSettings
        : calibrated
          ? "game"
          : "home",
    );
  }
});

window.addEventListener("keydown", (e) => {
  if (screen === "game" && mode === "keyboard") {
    debug.keys.add(e.code);
    if (
      e.code === "Space" &&
      game.state === "ready" &&
      game.match.server === 0
    ) {
      game.hit(0, "serve");
    }
  }
});
window.addEventListener("keyup", (e) => {
  if (screen === "game" && mode === "keyboard") {
    debug.keys.delete(e.code);
  }
});
window.addEventListener("beforeunload", () => camera.stop());

const skeleton = $<HTMLCanvasElement>("#skeleton"),
  ctx = skeleton.getContext("2d")!;
const edges = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
];

function drawPose() {
  ctx.clearRect(0, 0, 640, 480);
  if (!lastPose) return;
  ctx.strokeStyle = "#ceff8d";
  ctx.lineWidth = 3;
  for (const [a, b] of edges) {
    if (
      (lastPose[a].visibility ?? 0) < 0.5 ||
      (lastPose[b].visibility ?? 0) < 0.5
    )
      continue;
    ctx.beginPath();
    ctx.moveTo(lastPose[a].x * 640, lastPose[a].y * 480);
    ctx.lineTo(lastPose[b].x * 640, lastPose[b].y * 480);
    ctx.stroke();
  }
  for (const p of lastPose) {
    if ((p.visibility ?? 0) < 0.5) continue;
    ctx.fillStyle = "#f5ffe7";
    ctx.beginPath();
    ctx.arc(p.x * 640, p.y * 480, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  if (settings.debug) {
    const center = bodyCenter(lastPose),
      right = interpreter.calibration.hand === "right";
    const wrist = lastPose[right ? 16 : 15],
      elbow = lastPose[right ? 14 : 13];
    const dx = wrist.x - elbow.x,
      dy = wrist.y - elbow.y,
      d = Math.max(0.001, Math.hypot(dx, dy));
    ctx.strokeStyle = "#ffb882";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(wrist.x * 640, wrist.y * 480);
    ctx.lineTo(
      (wrist.x + (dx / d) * 0.12) * 640,
      (wrist.y + (dy / d) * 0.12) * 480,
    );
    ctx.stroke();
    ctx.strokeStyle = "#fff";
    ctx.beginPath();
    ctx.arc(center.x * 640, center.y * 480, 9, 0, Math.PI * 2);
    ctx.stroke();
  }
}

let uiClock = 0;
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  fps = fps * 0.95 + (1 / Math.max(dt, 0.001)) * 0.05;

  if (screen === "game") {
    if (mode === "keyboard") game.setMotion(debug.update(now, dt));
    else if (mode === "synthetic") {
      syntheticTime += dt;
      const phase = syntheticTime % 1.6;
      const x = phase < 0.3 ? 0.32 - phase * 1.0 : 0.2;
      lastPose = syntheticPose(
        x,
        phase < 0.3 ? 0.63 - phase * 1.1 : 0.3,
        Math.sin(syntheticTime * 0.5) * 0.08,
      );
      const m = interpreter.update(lastPose, now);
      if (m) game.setMotion(m);
    }
    if (mode === "camera") {
      const age = now - lastGood;
      if (age > C.staleMs)
        game.setMotion({ ...game.motion, swing: false, confidence: 0 });
      if (age > C.pauseMs) {
        trackingPaused = true;
        recovery = 0;
      }
      if (trackingPaused && age < 150) {
        recovery += dt;
        if (recovery > 0.65) {
          trackingPaused = false;
          interpreter.reset();
        }
      }
      $("#tracking-warning").classList.toggle("hidden", !trackingPaused);
    }
    if (!trackingPaused) {
      accumulator += dt;
      while (accumulator >= C.dt) {
        game.step(C.dt);
        accumulator -= C.dt;
      }
    }
    for (const event of game.events) {
      audio.play(event.type);
      if (event.position) renderer.impact(event.position, event.speed);
      if (event.type === "point") toast(event.text);
      else if (event.speed)
        toast(`${event.text} · ${Math.round(event.speed)} km/h`);
    }
    game.events = [];
    if (game.state === "over") {
      $("#result-title").textContent =
        game.match.winner === 0
          ? "You took the court."
          : "A rally worth replaying.";
      $("#result-score").textContent = game.match.score.join(" : ");
      $("#result-stats").textContent =
        `Best rally: ${game.bestRally} shots · ${game.totalHits} total contacts`;
      setScreen("results");
    }
  }

  renderer.render(game, dt);

  // Render Live Neural Visualization if panel is open
  if (brainPanelOpen && brainRenderer) {
    const tel = game.fly.getTelemetry();
    if (tel) {
      brainRenderer.render(tel);
    }
  }

  uiClock += dt;
  if (uiClock > 0.1) {
    uiClock = 0;
    $("#your-score").textContent = String(game.match.score[0]).padStart(2, "0");
    $("#ai-score").textContent = String(game.match.score[1]).padStart(2, "0");
    $("#shot-label").textContent = game.lastShot;
    $("#rally-count").textContent = `RALLY ${game.hits}`;
    $("#instruction").textContent =
      game.state === "ready"
        ? game.match.server === 0
          ? mode === "keyboard"
            ? "Press SPACE to serve"
            : "Swing gently upward to serve"
          : "Opponent preparing to serve"
        : game.state === "point"
          ? "Reset your stance. Next rally coming."
          : game.shuttle.lastHit === 1
            ? "Meet the shuttle. Swing through."
            : "Find your position. Stay ready.";
    $("#tracking-status").textContent =
      mode !== "camera"
        ? "TEST INPUT"
        : trackingPaused
          ? "PAUSED"
          : camera.poseFps > 0 && camera.poseFps < 18
            ? "LOW CAMERA FPS"
            : "TRACKING";
    $("#preview-box").classList.toggle(
      "hidden",
      !(camera.running && (settings.preview || screen === "calibration")),
    );
    if (camera.running) drawPose();
    $("#debug-overlay").classList.toggle("hidden", !settings.debug);
    if (settings.debug) {
      const m = game.motion;
      const flyCmd = game.fly.lastMotorCommand;
      $("#debug-overlay").textContent =
        `${mode.toUpperCase()} / ${m.state} (${game.footworkState})\n` +
        `Intent: ${m.intentDirection.toUpperCase()} · lean ${m.lean.toFixed(2)} · weight ${m.intentWeight.toFixed(2)}\n` +
        `Avatar: (${game.playerPos.x.toFixed(2)}, ${game.playerPos.z.toFixed(2)}) → Target: (${game.targetPos.x.toFixed(2)}, ${game.targetPos.z.toFixed(2)})\n` +
        `Opponent: ${settings.opponentType.toUpperCase()} at (${game.opponentX.toFixed(2)}, ${game.opponentZ.toFixed(2)})\n` +
        `Fly Motor: vx ${flyCmd.vx.toFixed(2)} | vz ${flyCmd.vz.toFixed(2)} | state ${flyCmd.flightState} | arousal ${(flyCmd.arousal * 100).toFixed(0)}%\n` +
        `Confidence ${m.confidence.toFixed(2)} · Speed ${m.speed.toFixed(2)} w/s · ${m.intent.toUpperCase()}\n` +
        `Swing #${m.swingId} (${m.phase}) · used #${game.usedSwing}\n` +
        `Racket (${game.racket.x.toFixed(2)}, ${game.racket.y.toFixed(2)}, ${game.racket.z.toFixed(2)})\n` +
        `Render ${fps.toFixed(0)} fps · camera ${camera.cameraFps.toFixed(0)} fps · pose ${camera.poseFps.toFixed(0)} fps`;
    }
  }
  if (now > toastUntil) $("#toast").classList.add("hidden");
}
requestAnimationFrame(frame);

// Read-only diagnostics for browser acceptance tests and local tuning.
Object.defineProperty(window, "motionDiagnostics", {
  get: () => ({
    screen,
    mode,
    state: game.state,
    score: [...game.match.score],
    fps,
    cameraFps: camera.cameraFps,
    poseFps: camera.poseFps,
    inferenceMs: camera.inferenceMs,
    latency: camera.latency,
    workerReady: camera.ready,
    cameraRunning: camera.running,
    trackingPaused,
    contacts: game.totalHits,
    swingState: game.motion.state,
    swingId: game.motion.swingId,
    intent: game.motion.intentDirection,
    footworkState: game.footworkState,
    playerPos: { ...game.playerPos },
    targetPos: { ...game.targetPos },
    shuttle: { ...game.shuttle.p },
    opponentType: settings.opponentType,
    opponentPos: { x: game.opponentX, y: game.opponentY, z: game.opponentZ },
    flyMotorCommand: { ...game.fly.lastMotorCommand },
    brainPanelOpen,
  }),
});
