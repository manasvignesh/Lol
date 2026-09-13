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
import { ConnectomeLoader } from "./flybrain/connectomeLoader";
import type { LiveEventEntry, NeuronDetailData } from "./flybrain/types";

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
  brainPanelOpen = true,
  presentationMode = false,
  brainPaused = false,
  scienceSplashTimer = 0;

const liveEvents: LiveEventEntry[] = [];
let eventIdCounter = 0;

// Tracking milestones for event generator
let lastEventState = {
  shuttleIncoming: false,
  opticActive: false,
  centralActive: false,
  steerDirection: 0,
  embodimentSteerActive: false,
  lastHitSide: -1,
};

$("#app").innerHTML = `
<div id="court-container">
  <div id="court"></div>
  <div class="vignette"></div>
</div>

<header>
  <a class="brand" href="#" aria-label="Motion Badminton home">
    <span class="brand-icon">↗</span> MOTION<span class="brand-light">BADMINTON</span>
    <span class="brand-sub">CONNECTOME EDITION</span>
  </a>
  <div class="header-right">
    <div class="opp-toggle-bar">
      <button id="btn-quick-fly" class="opp-quick-btn active">Fruit-Fly Connectome</button>
      <button id="btn-quick-classic" class="opp-quick-btn">Classic AI</button>
    </div>
    <button id="btn-toggle-presentation" class="nav-pill-btn" title="Toggle High-Contrast Presentation Mode for Demos">📺 PRESENTATION</button>
    <button id="btn-toggle-brain" class="brain-nav-btn active">🧠 CONNECTOME LAB</button>
    <button class="icon" id="settings-open" aria-label="Settings">⚙</button>
  </div>
</header>

<main id="home" class="panel screen">
  <div class="eyebrow">NEUROSCIENCE EXPERIMENT / 01</div>
  <h1>Human vs Fruit-Fly.<br>Connectome <em>Badminton.</em></h1>
  <p class="intro">Play badminton against an opponent powered by a real <em>Drosophila</em> connectome simulation (HHMI Janelia MaleCNS v1.0).<br>No headset. No controller. Just your camera.</p>
  <div class="cta-row">
    <button class="primary" id="play">PLAY NOW <span>↗</span></button>
    <button class="secondary" id="how-it-works">HOW IT WORKS</button>
  </div>
  <div class="home-actions">
    <button id="home-settings">Settings</button>
  </div>
  <div id="developer-tools" class="hidden">
    <button class="secondary" id="keyboard">KEYBOARD TEST MODE →</button>
    <button id="synthetic">Synthetic Pose Diagnostic</button>
  </div>
  <div class="safety">↔ &nbsp; Play from where you stand (~1m space). Avatar handles court traversal.<small>No cloud inference · 100% on-device MediaPipe & LIF connectome simulation.</small></div>
</main>

<div id="home-caption">
  <span>REAL MALECNS-DERIVED CONNECTOME</span>
  <b id="home-caption-stats">2,439 Real Neurons · 44,781 Biological Edges.<br>1,146,043 Underlying Synaptic Contacts.</b>
  <small>HHMI JANELIA MALECNS v1.0 / LEAKY INTEGRATE-AND-FIRE / ENGINEERED EMBODIMENT</small>
</div>

<!-- SCIENCE INTRO SPLASH -->
<div id="science-splash" class="splash-screen hidden">
  <div class="splash-card">
    <div class="splash-eyebrow">HHMI JANELIA RESEARCH CAMPUS</div>
    <h2>REAL WIRING.<br><em>SIMULATED DYNAMICS.</em></h2>
    <div class="splash-badge-line">MALECNS v1.0 SENSORIMOTOR CONNECTOME</div>
    <div class="splash-stats-row">
      <div class="stat-pill"><b id="splash-neurons">2,439</b><span>RECONSTRUCTED NEURONS</span></div>
      <div class="stat-pill"><b id="splash-edges">44,781</b><span>BIOLOGICAL EDGES</span></div>
      <div class="stat-pill"><b id="splash-synapses">1,146,043</b><span>SYNAPTIC CONTACTS</span></div>
    </div>
    <p class="splash-desc">Your shot stimulates real optical projection neurons (LC4/6/10). Activity propagates through central compass circuits to descending motor effectors (DNa02/DNp01), generating physical court movement.</p>
    <button id="btn-skip-splash" class="primary">PLAY THE CONNECTOME <span>↗</span></button>
  </div>
</div>

<section id="camera-setup" class="screen hidden dialog">
  <div class="eyebrow">CHOOSE YOUR CAMERA</div>
  <h2>Let’s get you ready.</h2>
  
  <div class="camera-preview-container">
    <video id="setup-video" autoplay playsinline muted></video>
    <div id="setup-guide">Upper body + racket arm is enough.</div>
  </div>

  <div class="setup-controls">
    <label>Camera:
      <select id="setup-camera-select"><option value="">Default camera</option></select>
    </label>
    <div class="setup-hand-toggle">
      <span>Playing hand:</span>
      <button id="setup-hand-right" class="active">Right</button>
      <button id="setup-hand-left">Left</button>
    </div>
    <div id="setup-tracking-status">● Connecting...</div>
  </div>

  <div class="cta-row">
    <button id="setup-start" class="primary" disabled>START GAME <span>↗</span></button>
    <button id="setup-cancel" class="secondary">Back to home</button>
  </div>
</section>

<div id="camera-error-dialog" class="screen hidden dialog onboarding-card">
  <div class="eyebrow">CAMERA ERROR</div>
  <h2>Camera couldn't start</h2>
  <p id="camera-error-msg">Please check your permissions and make sure no other app is using the camera.</p>
  <div class="ob-actions">
    <button id="camera-error-retry" class="primary">TRY AGAIN</button>
    <button id="camera-error-another" class="secondary">CHOOSE ANOTHER CAMERA</button>
    <button id="camera-error-keyboard" class="text-button">KEYBOARD MODE</button>
  </div>
</div>

<div id="onboarding" class="screen hidden dialog onboarding-card">
  <div class="eyebrow" id="ob-step-label">STEP 1 OF 5</div>
  <h2 id="ob-title">Move</h2>
  <p id="ob-desc">You don't need to walk around your room.<br>Lean slightly and the avatar handles court movement.</p>
  <div class="ob-actions">
    <button id="ob-next" class="primary">NEXT</button>
    <button id="ob-skip" class="text-button">SKIP TUTORIAL</button>
  </div>
</div>

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
  <div id="contact-badge" class="hud-alert-badge contact hidden">⚡ NEURAL → PHYSICAL CONTACT</div>
  <div id="miss-badge" class="hud-alert-badge miss hidden">🔴 MISS</div>
  <div id="keyboard-help" class="hidden">A / D intent · W / S reach · SPACE swing · 1 clear / 2 drive / 3 drop / 4 smash / 5 lift</div>
</div>

<!-- SYNTHETIC SHOT TESTER BAR (Developer / Test Mode) -->
<div id="synthetic-shot-bar" class="hidden">
  <span class="shot-bar-label">🎯 SHOT SCENARIOS:</span>
  <button data-shot="left" class="shot-btn">[1] LEFT DRIVE</button>
  <button data-shot="right" class="shot-btn">[2] RIGHT DRIVE</button>
  <button data-shot="center" class="shot-btn">[3] CENTER DRIVE</button>
  <button data-shot="high" class="shot-btn">[4] HIGH CLEAR</button>
  <button data-shot="fast" class="shot-btn">[5] FAST SMASH</button>
  <button data-shot="drop" class="shot-btn">[6] NET DROP</button>
</div>

<!-- CONNECTOME NEURAL LAB PANEL (Split-Screen Neuroscience Instrument) -->
<aside id="brain-panel" class="">
  <div class="brain-header">
    <div class="brain-title-col">
      <div class="badge-row">
        <span class="brain-badge">MALECNS v1.0</span>
        <span id="brain-live-badge" class="badge-live">● LIVE</span>
      </div>
      <h3 id="brain-header-title">REAL CONNECTOME · SIMULATED DYNAMICS</h3>
      <div id="brain-stats-line" class="brain-stats-meta">2,439 Neurons · 44,781 Biological Edges · 1,146,043 Synapses</div>
    </div>
    <div class="brain-header-actions">
      <button id="btn-brain-close" aria-label="Toggle Brain Panel">✕</button>
    </div>
  </div>

  <div class="brain-toolbar">
    <div class="brain-view-tabs">
      <button id="btn-view-spatial" class="active" title="Real MaleCNS Drosophila 3D Skeletons">3D Skeletons</button>
      <button id="btn-view-circuit" title="Functional Circuit Flow">Circuit</button>
      <button id="btn-view-raster" title="LIF Spike Timeline">Spikes</button>
    </div>
    <div class="sim-step-controls">
      <button id="btn-brain-color-mode" class="sim-btn" title="Toggle Activity / Anatomy Region Colors">🎨 Activity</button>
      <button id="btn-brain-reset-cam" class="sim-btn" title="Reset 3D Camera">↺ 3D</button>
      <button id="btn-pause-brain" class="sim-btn" title="Pause / Resume Neural Simulation">⏸ Pause</button>
      <button id="btn-step-2ms" class="sim-btn step-btn" title="Advance Simulation by 2ms (1 LIF step)">+2ms</button>
      <button id="btn-step-10ms" class="sim-btn step-btn" title="Advance Simulation by 10ms (5 LIF steps)">+10ms</button>
      <button id="btn-toggle-microscope" class="sim-btn microscope-btn" title="Expand Microscope Mode">🔬 Lab</button>
    </div>
  </div>

  <div id="brain-viewport"></div>

  <!-- Live Signal Propagation Story -->
  <div class="event-story-box">
    <div class="event-story-header">
      <span>LIVE SIGNAL PROPAGATION STORY</span>
      <small id="sim-clock-display">00.000s</small>
    </div>
    <div id="live-event-stream" class="event-stream-list">
      <div class="event-item init">
        <span class="event-time">00.000s</span>
        <span class="event-text">Connectome ready · Awaiting incoming optical stimulus</span>
      </div>
    </div>
  </div>

  <!-- Biology vs Engineered Embodiment Dashboard -->
  <div class="bio-vs-embodiment-panel">
    <div class="bio-col">
      <div class="col-header">BIOLOGICAL OUTPUT</div>
      <div class="bio-metric">
        <span>DNa02 Steering</span>
        <b id="bio-steer-val">0.00 (CENTER)</b>
      </div>
      <div class="bio-metric">
        <span>DNp01 Motor Vigor</span>
        <b id="bio-vigor-val">0.20</b>
      </div>
      <div class="bio-metric">
        <span>DNb01 Strike Drive</span>
        <b id="bio-strike-val">RESTING</b>
      </div>
      <div class="bio-metric">
        <span>MDN Braking</span>
        <b id="bio-brake-val">0.00</b>
      </div>
    </div>
    <div class="embodiment-col">
      <div class="col-header">ENGINEERED EMBODIMENT</div>
      <div class="embodiment-metric">
        <span>Court Velocity</span>
        <b id="emb-vel-val">vx: 0.00 | vz: 0.00</b>
      </div>
      <div class="embodiment-metric">
        <span>Flight State</span>
        <b id="emb-state-val">HOVER</b>
      </div>
      <div class="embodiment-metric">
        <span>Racket Action</span>
        <b id="emb-racket-val">READY</b>
      </div>
      <div class="embodiment-metric">
        <span>Contact Model</span>
        <b id="emb-contact-val">SWEPT RACKET</b>
      </div>
    </div>
  </div>

  <!-- Presentation-Ready Neural Lab Controls -->
  <div class="neural-lab-controls">
    <div class="lab-title">
      <span>OPTOGENETIC INTERVENTIONS & DRIVES</span>
      <button id="btn-lab-reset" class="text-button">Reset Network</button>
    </div>
    <div class="lab-toggles">
      <button id="silence-lc4" class="lab-toggle" title="Optogenetically silence looming visual projection neurons">
        Silence Looming (LC4/6)
        <small id="lc-matched-count" class="lab-sub">939 neurons</small>
      </button>
      <button id="silence-dna" class="lab-toggle" title="Inhibit lateral steering descending neurons">
        Silence Steering (DNa02)
        <small id="dna-matched-count" class="lab-sub">2 neurons</small>
      </button>
      <button id="silence-dnb" class="lab-toggle" title="Prevent descending strike trigger">
        Silence Strike (DNb01)
        <small id="dnb-matched-count" class="lab-sub">2 neurons</small>
      </button>
    </div>
    <div class="lab-sliders">
      <label>Synaptic Gain <span id="gain-val">1.0x</span>
        <input id="slider-gain" type="range" min="0.2" max="2.5" step="0.1" value="1.0">
      </label>
      <label>Sensory Drive <span id="drive-val">1.2</span>
        <input id="slider-drive" type="range" min="0" max="4.0" step="0.2" value="1.2">
      </label>
      <label>Sensory Noise <span id="noise-val">0.0 pA</span>
        <input id="slider-noise" type="range" min="0" max="2.0" step="0.1" value="0.0">
      </label>
    </div>
  </div>
</aside>

<!-- NEURON INSPECTOR MODAL -->
<div id="neuron-inspector-modal" class="modal-backdrop hidden">
  <div class="inspector-card">
    <div class="inspector-header">
      <div>
        <span class="inspector-badge">MALECNS v1.0 NEURON INSPECTOR</span>
        <h3 id="ins-body-id">Body ID #10001</h3>
      </div>
      <button id="btn-inspector-close" class="icon-close" aria-label="Close Inspector">✕</button>
    </div>
    <div class="inspector-grid">
      <div class="ins-row"><span>Cell Type</span><b id="ins-type">LC10a</b></div>
      <div class="ins-row"><span>Instance</span><b id="ins-instance">LC10a_R</b></div>
      <div class="ins-row"><span>Hemisphere</span><b id="ins-hemi">Right</b></div>
      <div class="ins-row"><span>Region</span><b id="ins-region">Optic Lobe</b></div>
      <div class="ins-row"><span>Transmitter</span><b id="ins-nt">Acetylcholine (+1 Exc)</b></div>
      <div class="ins-row"><span>Coordinates</span><b id="ins-coords">EM Voxel Soma</b></div>
    </div>
    <div class="inspector-section">
      <h4>BIOLOGICAL CONNECTIVITY</h4>
      <div class="ins-conn-grid">
        <div class="conn-box"><span>In-Degree</span><b id="ins-in-deg">42 Partners</b><small id="ins-in-syn">318 Synapses</small></div>
        <div class="conn-box"><span>Out-Degree</span><b id="ins-out-deg">18 Partners</b><small id="ins-out-syn">154 Synapses</small></div>
      </div>
    </div>
    <div class="inspector-section">
      <h4>SIMULATION ELECTRICAL STATE</h4>
      <div class="ins-sim-grid">
        <div><span>Membrane Potential</span><b id="ins-vm">-54.2 mV</b></div>
        <div><span>Firing Rate</span><b id="ins-rate">18.5 Hz</b></div>
        <div><span>Spiking State</span><b id="ins-spike-state">SUBTHRESHOLD</b></div>
      </div>
    </div>
    <div class="inspector-footer">
      <span class="prov-tag">REAL CONNECTOME / SIMULATED ELECTRICAL STATE</span>
    </div>
  </div>
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
  <div class="eyebrow">CONFIGURATION</div>
  <h2>Settings</h2>
  <div class="setting-grid">
    <label>Camera<select id="camera-select"><option value="">Default camera</option></select></label>
    <label>Difficulty<select id="difficulty"><option value="easy">Easy</option><option value="normal">Normal</option></select></label>
    <label>Motion assistance<select id="assist"><option value="beginner">Casual (Beginner)</option><option value="normal">Precision (Normal)</option></select></label>
    <label>Audio volume<input id="volume" type="range" min="0" max="1" step="0.05"></label>
  </div>
  <div class="settings-advanced hidden" id="settings-advanced">
    <hr>
    <h4>Advanced Settings</h4>
    <div class="setting-grid">
      <label>Opponent Type
        <select id="opponent-type">
          <option value="fruitfly">Fruit-Fly Connectome (MaleCNS v1.0)</option>
          <option value="classic">Classic Scripted AI</option>
        </select>
      </label>
      <label>Swing sensitivity<input id="sensitivity" type="range" min="0.6" max="1.8" step="0.1"></label>
      <label>Movement sensitivity<input id="movement" type="range" min="0.5" max="1.8" step="0.1"></label>
      <label class="check"><input id="preview" type="checkbox"> Webcam preview</label>
      <label class="check"><input id="debug" type="checkbox"> Developer overlay</label>
    </div>
  </div>
  <button id="settings-toggle-advanced" class="text-button">Show Advanced</button>
  <button id="settings-replay-tutorial" class="secondary">Replay Tutorial</button>
  <button id="settings-done" class="primary">SAVE SETTINGS</button>
</section>

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

  // Connect neuron click inspector
  brainRenderer.onNeuronSelected = (_item, details) => {
    openNeuronInspector(details);
  };

  // Initialize Drosophila connectome simulation
  void game.fly.init(true, "/data/connectome").then(() => {
    const g = game.fly.bridge.getConnectomeGraph();
    if (g) {
      if (brainRenderer) brainRenderer.setGraph(g);

      // Load genuine MaleCNS 3D morphology
      void ConnectomeLoader.loadMorphology("/data/morphology").then((morph) => {
        if (brainRenderer) {
          brainRenderer.setMorphology(morph);
          brainRenderer.setViewMode("morphology");
        }
      });

      const isReal = g.manifest.provenance === "malecns-real";
      const edgeCount = g.manifest.edgeCount;
      const bioSynapses = g.manifest.biologicalSynapseTotal ?? edgeCount;
      const statsStr = `${g.manifest.neuronCount.toLocaleString()} Real Neurons · ${edgeCount.toLocaleString()} Biological Edges · ${bioSynapses.toLocaleString()} Synaptic Contacts`;

      const captionStats = $("#home-caption-stats");
      if (captionStats) {
        captionStats.innerHTML = `${g.manifest.neuronCount.toLocaleString()} Real Neurons · ${edgeCount.toLocaleString()} Biological Edges.<br>${bioSynapses.toLocaleString()} Underlying Synaptic Contacts.`;
      }
      const brainStatsLine = $("#brain-stats-line");
      if (brainStatsLine) brainStatsLine.textContent = statsStr;

      const splashN = $("#splash-neurons");
      const splashE = $("#splash-edges");
      const splashS = $("#splash-synapses");
      if (splashN)
        splashN.textContent = g.manifest.neuronCount.toLocaleString();
      if (splashE) splashE.textContent = edgeCount.toLocaleString();
      if (splashS) splashS.textContent = bioSynapses.toLocaleString();

      // Update matched counts in interventions
      const lcMatched = g.neurons.filter((n) =>
        ["LC4", "LC6", "LC10a", "LC10b", "LPLC1", "LPLC2"].includes(n.type),
      ).length;
      const dnaMatched = g.neurons.filter((n) =>
        ["DNa01", "DNa02"].includes(n.type),
      ).length;
      const dnbMatched = g.neurons.filter((n) =>
        ["DNb01", "DNp01"].includes(n.type),
      ).length;
      const lcEl = $("#lc-matched-count");
      const dnaEl = $("#dna-matched-count");
      const dnbEl = $("#dnb-matched-count");
      if (lcEl) lcEl.textContent = `${lcMatched} seed neurons`;
      if (dnaEl) dnaEl.textContent = `${dnaMatched} descending neurons`;
      if (dnbEl) dnbEl.textContent = `${dnbMatched} motor triggers`;
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
  $("#synthetic-shot-bar").classList.toggle(
    "hidden",
    next !== "game" || mode !== "keyboard",
  );
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

function triggerScienceSplash(force = false) {
  if (settings.opponentType === "fruitfly") {
    if (!force && localStorage.getItem("scienceIntroSeen") === "true") return;
    localStorage.setItem("scienceIntroSeen", "true");
    const splash = $("#science-splash");
    splash.classList.remove("hidden");
    splash.classList.add("fade-in");
    scienceSplashTimer = performance.now() + 2600;
  }
}

function startGame() {
  interpreter.reset();
  game.setMotion(neutralMotion());
  debug.swingUntil = 0;
  game.reset();
  trackingPaused = false;
  recovery = 0;
  liveEvents.length = 0;
  addLiveEvent("stimulus", "Match started", "Awaiting service from player");

  setScreen("game");
  triggerScienceSplash();

  $("#opp-label").textContent =
    settings.opponentType === "fruitfly" ? "FRUIT-FLY" : "OPPONENT";
  $("#control-label").textContent =
    mode === "camera"
      ? "CAMERA CONTROL"
      : mode === "keyboard"
        ? "KEYBOARD TEST"
        : "SYNTHETIC POSE DIAGNOSTIC";
  $("#keyboard-help").classList.toggle("hidden", mode !== "keyboard");
  $("#synthetic-shot-bar").classList.toggle("hidden", mode !== "keyboard");

  // Keep brain panel collapsed initially for first-time players
  const hasSeenBrain = localStorage.getItem("brainPanelSeen") === "true";
  toggleBrainPanel(hasSeenBrain);
  localStorage.setItem("brainPanelSeen", "true");
}

async function openCameraSetup() {
  audio.unlock();
  audio.volume = settings.volume;
  mode = "camera";
  calibrated = false;
  interpreter.reset();
  lastPose = null;
  lastGood = 0;
  previousPoseTime = 0;

  setScreen("camera-setup");
  $<HTMLVideoElement>("#setup-video").srcObject = null;
  $("#setup-tracking-status").textContent = "● Connecting...";
  $<HTMLButtonElement>("#setup-start").disabled = true;

  try {
    await camera.start(settings.camera);
    void populateCameras();
    $<HTMLVideoElement>("#setup-video").srcObject = camera.stream;
    $("#setup-tracking-status").textContent = "● Camera ready";
    $<HTMLButtonElement>("#setup-start").disabled = false;
  } catch (e) {
    setScreen("camera-error-dialog");
    const err = e instanceof Error ? e.message : "Camera access denied";
    $("#camera-error-msg").textContent = err;

    // Bind buttons dynamically
    $("#camera-error-retry").onclick = () => openCameraSetup();
    $("#camera-error-another").onclick = async () => {
      // Re-enter setup, attempt to populate cameras despite error (sometimes device enumeration still works)
      setScreen("camera-setup");
      await populateCameras();
    };
    $("#camera-error-keyboard").onclick = () => {
      audio.unlock();
      mode = "keyboard";
      calibrated = true;
      startGame();
    };
  }
}

let explicitHand: "left" | "right" = "right";
$("#setup-hand-right").addEventListener("click", () => {
  explicitHand = "right";
  $("#setup-hand-right").classList.add("active");
  $("#setup-hand-left").classList.remove("active");
});
$("#setup-hand-left").addEventListener("click", () => {
  explicitHand = "left";
  $("#setup-hand-left").classList.add("active");
  $("#setup-hand-right").classList.remove("active");
});

$("#setup-camera-select").addEventListener("change", async (e) => {
  const deviceId = (e.target as HTMLSelectElement).value;
  settings.camera = deviceId;
  await camera.start(deviceId);
  $<HTMLVideoElement>("#setup-video").srcObject = camera.stream;
});

$("#setup-start").addEventListener("click", () => {
  calibrated = true;
  // Apply the default background calibration with chosen hand
  interpreter.calibration = {
    center: { x: 0.5, y: 0.5, z: 0 },
    width: 0.25,
    range: 0.35,
    reach: 0.35,
    hand: explicitHand,
  };

  if (!localStorage.getItem("onboardingCompleted")) {
    startOnboarding();
  } else {
    startGame();
  }
});

$("#setup-cancel").addEventListener("click", home);

let onboardingStep = 0;
const onboardingData = [
  {
    title: "Move",
    desc: "You don't need to walk around your room.<br>Lean slightly and the avatar handles court movement.",
  },
  {
    title: "Swing",
    desc: "Swing naturally with your racket hand.<br>You don't need perfect positioning.",
  },
  {
    title: "The Fly",
    desc: "Your opponent uses a MaleCNS-derived fruit-fly connectome simulation.",
  },
  {
    title: "Connectome Lab",
    desc: "Open this anytime to see the simulated neural activity driving the opponent.",
  },
  { title: "Ready", desc: "That's it. Keep the shuttle alive." },
];

function startOnboarding() {
  onboardingStep = 0;
  setScreen("onboarding");
  updateOnboardingUI();
}

function updateOnboardingUI() {
  const step = onboardingData[onboardingStep];
  $("#ob-step-label").textContent =
    `STEP ${onboardingStep + 1} OF ${onboardingData.length}`;
  $("#ob-title").textContent = step.title;
  $("#ob-desc").innerHTML = step.desc;

  if (onboardingStep === onboardingData.length - 1) {
    $("#ob-next").textContent = "PLAY";
  } else {
    $("#ob-next").textContent = "NEXT";
  }
}

$("#ob-next").addEventListener("click", () => {
  if (onboardingStep < onboardingData.length - 1) {
    onboardingStep++;
    updateOnboardingUI();
  } else {
    localStorage.setItem("onboardingCompleted", "true");
    startGame();
  }
});

$("#ob-skip").addEventListener("click", () => {
  localStorage.setItem("onboardingCompleted", "true");
  startGame();
});

camera.onError = (message) => {
  if (screen === "game") setScreen("pause-screen");
  showError(message);
};

camera.onPose = (pose, timestamp) => {
  lastPose = pose;
  const now = performance.now();
  if (pose && poseQuality(pose, interpreter.calibration.hand === "right")) {
    lastGood = now;
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

// --- Live Signal Propagation Story Stream ---
function addLiveEvent(
  category: LiveEventEntry["category"],
  title: string,
  detail: string,
) {
  const timeMs = game.fly.getTelemetry()?.timeMs || 0;
  const s = (timeMs / 1000).toFixed(3);
  const icon =
    category === "stimulus"
      ? "🏸"
      : category === "sensory"
        ? "👁️"
        : category === "downstream"
          ? "⚡"
          : category === "descending"
            ? "🧠"
            : category === "embodiment"
              ? "🏃"
              : category === "contact"
                ? "💥"
                : "🔴";

  const entry: LiveEventEntry = {
    id: ++eventIdCounter,
    timeMs,
    timeFormatted: `${s}s`,
    category,
    icon,
    title,
    detail,
  };

  liveEvents.unshift(entry);
  if (liveEvents.length > 8) liveEvents.pop();

  const container = $("#live-event-stream");
  if (container) {
    container.innerHTML = liveEvents
      .map(
        (ev, i) => `
        <div class="event-item ${ev.category} ${i === 0 ? "latest" : ""}">
          <span class="event-time">${ev.timeFormatted}</span>
          <span class="event-icon">${ev.icon}</span>
          <span class="event-content">
            <b>${ev.title}</b>
            <small>${ev.detail}</small>
          </span>
        </div>
      `,
      )
      .join("");
  }
}

// --- Neuron Inspector Modal ---
function openNeuronInspector(details: NeuronDetailData) {
  $("#ins-body-id").textContent = `Body ID #${details.bodyId}`;
  $("#ins-type").textContent = details.type;
  $("#ins-instance").textContent = details.instance || "—";
  $("#ins-hemi").textContent =
    details.hemisphere === "L"
      ? "Left"
      : details.hemisphere === "R"
        ? "Right"
        : details.hemisphere || "Bilateral";
  $("#ins-region").textContent = details.region;
  $("#ins-nt").textContent = details.neurotransmitter || "Unclear";

  const coordStr =
    details.coordinateType === "soma_voxel"
      ? `EM Voxel Soma (${details.pos[0].toFixed(2)}, ${details.pos[1].toFixed(2)}, ${details.pos[2].toFixed(2)})`
      : `Derived Visualization (${details.pos[0].toFixed(2)}, ${details.pos[1].toFixed(2)})`;
  $("#ins-coords").textContent = coordStr;

  $("#ins-in-deg").textContent = `${details.inDegree} Partners`;
  $("#ins-in-syn").textContent = `${details.inSynapses} Biological Synapses`;
  $("#ins-out-deg").textContent = `${details.outDegree} Partners`;
  $("#ins-out-syn").textContent = `${details.outSynapses} Biological Synapses`;

  $("#ins-vm").textContent = `${details.vm.toFixed(1)} mV`;
  $("#ins-rate").textContent = `${details.firingRateHz.toFixed(1)} Hz`;
  $("#ins-spike-state").textContent = details.spiking
    ? "ACTION POTENTIAL (SPIKING)"
    : "SUBTHRESHOLD INTEGRATION";

  $("#neuron-inspector-modal").classList.remove("hidden");
}

$("#btn-inspector-close").addEventListener("click", () => {
  $("#neuron-inspector-modal").classList.add("hidden");
});

// --- Brain Panel & Neural Lab Event Listeners ---
function toggleBrainPanel(open?: boolean) {
  brainPanelOpen = open !== undefined ? open : !brainPanelOpen;
  $("#brain-panel").classList.toggle("hidden", !brainPanelOpen);
  $("#court-container").classList.toggle("split-view", brainPanelOpen);
  $("#btn-toggle-brain").classList.toggle("active", brainPanelOpen);
  if (brainPanelOpen && brainRenderer) {
    brainRenderer.resize();
  }
}

$("#btn-toggle-brain").addEventListener("click", () => toggleBrainPanel());
$("#btn-brain-close").addEventListener("click", () => toggleBrainPanel(false));

// View tabs
$("#btn-view-spatial").addEventListener("click", () => {
  brainRenderer?.setViewMode("morphology");
  document
    .querySelectorAll(".brain-view-tabs button")
    .forEach((b) => b.classList.remove("active"));
  $("#btn-view-spatial").classList.add("active");
});
$("#btn-view-circuit").addEventListener("click", () => {
  brainRenderer?.setViewMode("circuit");
  document
    .querySelectorAll(".brain-view-tabs button")
    .forEach((b) => b.classList.remove("active"));
  $("#btn-view-circuit").classList.add("active");
});
$("#btn-view-raster").addEventListener("click", () => {
  brainRenderer?.setViewMode("raster");
  document
    .querySelectorAll(".brain-view-tabs button")
    .forEach((b) => b.classList.remove("active"));
  $("#btn-view-raster").classList.add("active");
});

// Color Mode & Reset Controls
$("#btn-brain-color-mode").addEventListener("click", () => {
  if (!brainRenderer) return;
  const curr = brainRenderer.getColorMode();
  const next = curr === "activity" ? "anatomy" : "activity";
  brainRenderer.setColorMode(next);
  $("#btn-brain-color-mode").textContent =
    next === "activity" ? "🎨 Activity" : "🧬 Anatomy";
  toast(`Connectome coloring: ${next.toUpperCase()}`);
});

$("#btn-brain-reset-cam").addEventListener("click", () => {
  brainRenderer?.resetCamera();
  toast("3D Camera Reset");
});

let microscopeMode = false;
function toggleMicroscopeMode(active?: boolean) {
  microscopeMode = active !== undefined ? active : !microscopeMode;
  $("#court-container").classList.toggle("microscope-active", microscopeMode);
  $("#brain-panel").classList.toggle("microscope-mode", microscopeMode);
  $("#btn-toggle-microscope").classList.toggle("active", microscopeMode);
  brainRenderer?.setMicroscopeMode(microscopeMode);
  toast(microscopeMode ? "Microscope Lab View Active" : "Standard View Active");
}

$("#btn-toggle-microscope").addEventListener("click", () =>
  toggleMicroscopeMode(),
);

// Simulation Pause / Step controls
$("#btn-pause-brain").addEventListener("click", () => {
  brainPaused = !brainPaused;
  brainRenderer?.setPaused(brainPaused);
  const badge = $("#brain-live-badge");
  const pauseBtn = $("#btn-pause-brain");

  if (brainPaused) {
    pauseBtn.textContent = "▶ Resume";
    pauseBtn.classList.add("paused");
    badge.textContent = "⏸ PAUSED";
    badge.className = "badge-paused";
    toast("Neural simulation paused · Step to inspect");
  } else {
    pauseBtn.textContent = "⏸ Pause";
    pauseBtn.classList.remove("paused");
    badge.textContent = "● LIVE";
    badge.className = "badge-live";
    toast("Neural simulation resumed");
  }
});

$("#btn-step-2ms").addEventListener("click", () => {
  if (!brainPaused) {
    brainPaused = true;
    brainRenderer?.setPaused(true);
    $("#btn-pause-brain").textContent = "▶ Resume";
    $("#btn-pause-brain").classList.add("paused");
    $("#brain-live-badge").textContent = "⏸ PAUSED";
    $("#brain-live-badge").className = "badge-paused";
  }
  // Step 1 LIF cycle (2ms)
  game.step(0.002);
  toast("Stepped +2ms (1 LIF cycle)");
});

$("#btn-step-10ms").addEventListener("click", () => {
  if (!brainPaused) {
    brainPaused = true;
    brainRenderer?.setPaused(true);
    $("#btn-pause-brain").textContent = "▶ Resume";
    $("#btn-pause-brain").classList.add("paused");
    $("#brain-live-badge").textContent = "⏸ PAUSED";
    $("#brain-live-badge").className = "badge-paused";
  }
  // Step 5 LIF cycles (10ms)
  for (let i = 0; i < 5; i++) game.step(0.002);
  toast("Stepped +10ms (5 LIF cycles)");
});

// Presentation Mode Toggle
function togglePresentationMode(active?: boolean) {
  presentationMode = active !== undefined ? active : !presentationMode;
  document.body.classList.toggle("presentation-mode", presentationMode);
  $("#btn-toggle-presentation").classList.toggle("active", presentationMode);
  if (brainRenderer) brainRenderer.resize();
  toast(
    presentationMode
      ? "Presentation Mode ON (Projector-optimized layout)"
      : "Presentation Mode OFF",
  );
}

$("#btn-toggle-presentation").addEventListener("click", () =>
  togglePresentationMode(),
);

// Quick Opponent Switcher in Header
function setOpponentType(type: "fruitfly" | "classic") {
  settings.opponentType = type;
  localStorage.setItem("motion-settings", JSON.stringify(settings));
  game.settings = settings;

  $("#btn-quick-fly").classList.toggle("active", type === "fruitfly");
  $("#btn-quick-classic").classList.toggle("active", type === "classic");
  $("#opp-label").textContent =
    type === "fruitfly" ? "FRUIT-FLY" : "CLASSIC AI";

  const title = $("#brain-header-title");
  if (title) {
    title.textContent =
      type === "fruitfly"
        ? "REAL CONNECTOME · SIMULATED DYNAMICS"
        : "CLASSIC SCRIPTED AI (HEURISTIC BASELINE)";
  }

  toast(
    type === "fruitfly"
      ? "Switched to Fruit-Fly Connectome (MaleCNS v1.0)"
      : "Switched to Classic Scripted AI",
  );
}

$("#btn-quick-fly").addEventListener("click", () =>
  setOpponentType("fruitfly"),
);
$("#btn-quick-classic").addEventListener("click", () =>
  setOpponentType("classic"),
);

// Skip Science Intro Splash
$("#btn-skip-splash")?.addEventListener("click", () => {
  $("#science-splash").classList.add("hidden");
  scienceSplashTimer = 0;
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
    sensoryNoise: parseFloat(($("#slider-noise") as HTMLInputElement).value),
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
      ? `Silenced LC4/6 Looming (${matched.length} MaleCNS neurons)`
      : "Restored LC4/6 Looming",
  );
  addLiveEvent(
    "sensory",
    silencedLC ? "LC4/6 LOOMING SILENCED" : "LC4/6 LOOMING RESTORED",
    `Optogenetic intervention updated (${matched.length} matched neurons)`,
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
      ? `Silenced DNa02 Steering (${matched.length} neurons)`
      : "Restored DNa02 Steering",
  );
  addLiveEvent(
    "descending",
    silencedDNa ? "DNa02 STEERING SILENCED" : "DNa02 STEERING RESTORED",
    "Lateral turning torque inhibited",
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
      ? `Silenced DNb01 Strike (${matched.length} neurons)`
      : "Restored DNb01 Strike",
  );
  addLiveEvent(
    "descending",
    silencedDNb ? "DNb01 STRIKE SILENCED" : "DNb01 STRIKE RESTORED",
    "Cyber-racket strike trigger inhibited",
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
$("#slider-noise").addEventListener("input", (e) => {
  const val = (e.target as HTMLInputElement).value;
  $("#noise-val").textContent = `${parseFloat(val).toFixed(1)} pA`;
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
  ($("#slider-noise") as HTMLInputElement).value = "0.0";
  $("#gain-val").textContent = "1.0x";
  $("#drive-val").textContent = "1.2";
  $("#noise-val").textContent = "0.0 pA";
  game.fly.bridge.reset();
  updateInterventions();
  toast("Restored baseline network connectivity and drives");
  addLiveEvent(
    "downstream",
    "NETWORK RESTORED",
    "Baseline connectivity and synaptic gain reset",
  );
});

// Synthetic Shot Scenarios (Developer / Test Mode)
document.querySelectorAll(".shot-btn").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    const scenario = (e.currentTarget as HTMLElement).dataset
      .shot as Parameters<typeof game.feedSyntheticShot>[0];
    if (scenario) {
      game.feedSyntheticShot(scenario);
      toast(`Fired Synthetic Shot: ${scenario.toUpperCase()}`);
    }
  });
});

// UI Navigation listeners
$("#play").addEventListener("click", () => void openCameraSetup());
$("#how-it-works").addEventListener("click", () => triggerScienceSplash(true));

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
$("#recalibrate").addEventListener("click", () => void openCameraSetup());
$("#back-home").addEventListener("click", home);

$("#play-again").addEventListener("click", startGame);
$("#results-home").addEventListener("click", home);
$("#home-settings").addEventListener("click", openSettings);
$("#settings-open").addEventListener("click", openSettings);
$("#error-close").addEventListener("click", () =>
  $("#error").classList.add("hidden"),
);

$("#settings-toggle-advanced").addEventListener("click", () => {
  const adv = $("#settings-advanced");
  const isHidden = adv.classList.contains("hidden");
  adv.classList.toggle("hidden", !isHidden);
  $("#settings-toggle-advanced").textContent = isHidden
    ? "Hide Advanced"
    : "Show Advanced";
});

$("#settings-replay-tutorial").addEventListener("click", () => {
  // Save settings first just in case
  $("#settings-done").click();
  localStorage.removeItem("onboardingCompleted");
  openCameraSetup(); // Jump into setup -> tutorial
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

  $("#btn-quick-fly").classList.toggle(
    "active",
    settings.opponentType === "fruitfly",
  );
  $("#btn-quick-classic").classList.toggle(
    "active",
    settings.opponentType === "classic",
  );

  if (cameraChanged && camera.running) {
    void openCameraSetup();
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

// Key bindings
window.addEventListener("keydown", (e) => {
  if (e.code === "KeyP" && !e.ctrlKey && !e.metaKey) {
    togglePresentationMode();
    return;
  }
  if (screen === "game" && mode === "keyboard") {
    debug.keys.add(e.code);
    if (
      e.code === "Space" &&
      game.state === "ready" &&
      game.match.server === 0
    ) {
      game.hit(0, "serve");
    }
    // Number keys for synthetic shot triggers
    if (e.code === "Digit1") game.feedSyntheticShot("left");
    else if (e.code === "Digit2") game.feedSyntheticShot("right");
    else if (e.code === "Digit3") game.feedSyntheticShot("center");
    else if (e.code === "Digit4") game.feedSyntheticShot("high");
    else if (e.code === "Digit5") game.feedSyntheticShot("fast");
    else if (e.code === "Digit6") game.feedSyntheticShot("drop");
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
}

let uiClock = 0;
let contactBadgeTimer = 0;
let missBadgeTimer = 0;

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  fps = fps * 0.95 + (1 / Math.max(dt, 0.001)) * 0.05;

  // Science splash fade out
  if (scienceSplashTimer > 0 && now > scienceSplashTimer) {
    $("#science-splash").classList.add("hidden");
    scienceSplashTimer = 0;
  }

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
    if (!trackingPaused && !brainPaused) {
      accumulator += dt;
      while (accumulator >= C.dt) {
        game.step(C.dt);
        accumulator -= C.dt;
      }
    }

    for (const event of game.events) {
      audio.play(event.type);
      if (event.position) renderer.impact(event.position, event.speed);
      if (event.type === "point") {
        toast(event.text);
        if (event.text.includes("YOUR POINT") && game.lastMissReason) {
          $("#miss-badge").textContent = `🔴 MISS: ${game.lastMissReason}`;
          $("#miss-badge").classList.remove("hidden");
          missBadgeTimer = now + 1600;
          addLiveEvent(
            "miss",
            `FLY MISSED SHUTTLE`,
            `Cause: ${game.lastMissReason}`,
          );
        }
      } else if (event.type === "hit" && game.shuttle.lastHit === 1) {
        $("#contact-badge").classList.remove("hidden");
        contactBadgeTimer = now + 400;
        const motor = game.fly.lastMotorCommand;
        addLiveEvent(
          "contact",
          `SWEPT RACKET CONTACT (${motor.swingType.toUpperCase()})`,
          `Physical contact power: ${(motor.swingPower * 100).toFixed(0)}%`,
        );
      }
    }
    game.events = [];

    if (now > contactBadgeTimer) $("#contact-badge").classList.add("hidden");
    if (now > missBadgeTimer) $("#miss-badge").classList.add("hidden");

    if (game.state === "over") {
      $("#result-title").textContent =
        game.match.winner === 0
          ? "You defeated the Drosophila connectome."
          : "Connectome sustained the court.";
      $("#result-score").textContent = game.match.score.join(" : ");
      $("#result-stats").textContent =
        `Best rally: ${game.bestRally} shots · ${game.totalHits} total contacts`;
      setScreen("results");
    }
  }

  renderer.render(game, dt);

  // Render Live Neural Visualization
  if (brainPanelOpen && brainRenderer) {
    const tel = game.fly.getTelemetry();
    if (tel) {
      brainRenderer.render(tel);

      // Real simulation timestamp display
      const simSec = (tel.timeMs / 1000).toFixed(3);
      const clockEl = $("#sim-clock-display");
      if (clockEl) clockEl.textContent = `${simSec}s`;

      // Causal event milestones
      const s = game.shuttle;
      if (s.lastHit === 0 && s.p.z < 0 && !lastEventState.shuttleIncoming) {
        lastEventState.shuttleIncoming = true;
        addLiveEvent(
          "stimulus",
          "SHUTTLE ENTERS VISUAL FIELD",
          `Azimuth: ${tel.sensoryFeatures.azimuthDeg.toFixed(1)}° | Dist: ${tel.sensoryFeatures.distance.toFixed(1)}m`,
        );
      } else if (s.lastHit === 1) {
        lastEventState.shuttleIncoming = false;
        lastEventState.opticActive = false;
        lastEventState.centralActive = false;
        lastEventState.embodimentSteerActive = false;
      }

      const opticRate = tel.regionActivity.OpticLobe || 0;
      if (
        lastEventState.shuttleIncoming &&
        opticRate > 14 &&
        !lastEventState.opticActive
      ) {
        lastEventState.opticActive = true;
        addLiveEvent(
          "sensory",
          "LC10/VPN POPULATION RESPONSE",
          `Lobula Complex activity surge (${opticRate.toFixed(1)} Hz)`,
        );
      }

      const cxRate = tel.regionActivity.CentralComplex || 0;
      if (
        lastEventState.opticActive &&
        cxRate > 10 &&
        !lastEventState.centralActive
      ) {
        lastEventState.centralActive = true;
        addLiveEvent(
          "downstream",
          "DOWNSTREAM PROPAGATION (CX/LAL)",
          `Central heading & coordinate transformation active (${cxRate.toFixed(1)} Hz)`,
        );
      }

      const motor = tel.motorCommand;
      const steerMagnitude = Math.abs(motor.steerTorque);
      if (
        lastEventState.centralActive &&
        steerMagnitude > 0.25 &&
        !lastEventState.embodimentSteerActive
      ) {
        lastEventState.embodimentSteerActive = true;
        const dir = motor.steerTorque > 0 ? "RIGHT" : "LEFT";
        addLiveEvent(
          "descending",
          `DNa02 ASYMMETRY ➔ STEERING ${dir}`,
          `Biological output: torque ${motor.steerTorque.toFixed(2)} | vigor ${(motor.arousal * 100).toFixed(0)}%`,
        );
        addLiveEvent(
          "embodiment",
          `EMBODIMENT: vx = ${motor.vx.toFixed(2)} m/s`,
          `Virtual avatar flight pursuit active (${motor.flightState})`,
        );
      }
    }
  }

  uiClock += dt;
  if (uiClock > 0.08) {
    uiClock = 0;
    $("#your-score").textContent = String(game.match.score[0]).padStart(2, "0");
    $("#ai-score").textContent = String(game.match.score[1]).padStart(2, "0");
    $("#shot-label").textContent = game.lastShot;
    $("#rally-count").textContent = `RALLY ${game.hits}`;

    // Update Biology vs Embodiment metrics
    const tel = game.fly.getTelemetry();
    if (tel) {
      const m = tel.motorCommand;
      const steerDir =
        m.steerTorque > 0.05
          ? `RIGHT (+${m.steerTorque.toFixed(2)})`
          : m.steerTorque < -0.05
            ? `LEFT (${m.steerTorque.toFixed(2)})`
            : "CENTER (0.00)";
      $("#bio-steer-val").textContent = steerDir;
      $("#bio-vigor-val").textContent =
        `${(m.arousal * 100).toFixed(0)}% (DNp01)`;
      $("#bio-strike-val").textContent = m.swingTriggered
        ? `TRIGGERED (${m.swingType.toUpperCase()})`
        : "RESTING";
      $("#bio-brake-val").textContent = (
        tel.regionActivity.Descending > 12 ? 0.05 : 0.0
      ).toFixed(2);

      $("#emb-vel-val").textContent =
        `vx: ${m.vx > 0 ? "+" : ""}${m.vx.toFixed(2)} | vz: ${m.vz > 0 ? "+" : ""}${m.vz.toFixed(2)} m/s`;
      $("#emb-state-val").textContent = m.flightState;
      $("#emb-racket-val").textContent = m.swingTriggered
        ? `STRIKE (${m.swingType.toUpperCase()})`
        : "PREPARING";
    }

    $("#instruction").textContent =
      game.state === "ready"
        ? game.match.server === 0
          ? mode === "keyboard"
            ? "Press SPACE or Shot 1-6 to serve"
            : "Swing gently upward to serve"
          : "Opponent preparing to serve"
        : game.state === "point"
          ? "Reset stance. Next rally coming."
          : game.shuttle.lastHit === 1
            ? "Meet the shuttle. Swing through."
            : "Opponent brain reacting. Stay ready.";

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
        `Render ${fps.toFixed(0)} fps · camera ${camera.cameraFps.toFixed(0)} fps · pose ${camera.poseFps.toFixed(0)} fps`;
    }
  }

  if (now > toastUntil) $("#toast").classList.add("hidden");
}
requestAnimationFrame(frame);

// Read-only diagnostics for browser acceptance tests and verification
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
    presentationMode,
    brainPaused,
  }),
});
