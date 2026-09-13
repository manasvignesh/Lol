import * as T from "three";
import type {
  ActivePathwayNode,
  ConnectomeCSRGraph,
  MorphologyData,
  NeuralTelemetrySnapshot,
  NeuronData,
  NeuronDetailData,
  NeuronMorphologyMeta,
  NeuronTelemetryItem,
  NeuropilRegion,
} from "./types";

export type BrainViewMode = "morphology" | "circuit" | "spatial" | "raster";
export type BrainColorMode = "activity" | "anatomy";

// Region color palette (Biological connectomics convention)
export const REGION_COLORS: Record<
  NeuropilRegion | string,
  [number, number, number]
> = {
  OpticLobe: [0.0, 0.85, 1.0], // Cyan / Electric Blue (Vision, LC4/LC10)
  CentralComplex: [0.1, 0.95, 0.6], // Emerald / Teal (Compass, EPG/PEN/PFL)
  Protocerebrum: [0.65, 0.45, 1.0], // Indigo / Violet (Intermediate routing, LAL)
  Descending: [1.0, 0.65, 0.1], // Amber / Orange (Motor commands, DNa02/DNp01)
  VNC: [1.0, 0.25, 0.35], // Rose / Red (Motor effectors)
};

export const REGION_HEX: Record<NeuropilRegion | string, string> = {
  OpticLobe: "#00d9ff",
  CentralComplex: "#10f09a",
  Protocerebrum: "#a773ff",
  Descending: "#ffaa1a",
  VNC: "#ff4455",
};

export class BrainRenderer {
  private container: HTMLElement;
  private canvas2d: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  // Three.js 3D WebGL Subsystem
  private threeRenderer: T.WebGLRenderer;
  private scene: T.Scene;
  private camera: T.PerspectiveCamera;
  private morphologyGroup: T.Group;
  private lineMesh: T.LineSegments | null = null;
  private shaderMaterial: T.ShaderMaterial | null = null;
  private activityTexture: T.DataTexture | null = null;
  private activityData: Float32Array | null = null; // 64x64x4 RGBA float

  // Scale bar 3D object
  private scaleBarGroup: T.Group;

  // Data & State
  private graph: ConnectomeCSRGraph | null = null;
  private morphology: MorphologyData | null = null;
  private viewMode: BrainViewMode = "morphology";
  private colorMode: BrainColorMode = "activity";

  private hoveredNeuronIndex: number | null = null;
  private hoveredNeuronItem: NeuronTelemetryItem | null = null;
  private selectedNeuronIndex: number | null = null;

  private width = 420;
  private height = 520;
  private isPaused = false;
  private isMicroscope = false;

  // Camera Orbit Controls
  private rotX = 0.25;
  private rotY = 0.0;
  private targetRotX = 0.25;
  private targetRotY = 0.0;
  private cameraDistance = 3.2;
  private targetCameraDistance = 3.2;
  private panX = 0;
  private panY = 0;
  private isDragging = false;
  private isPanning = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  // Temporal Decay & History
  private spikeExcitation: Float32Array = new Float32Array(2439);
  private lastRenderTime = performance.now();
  private spikeHistory: { time: number; neuronIndex: number }[] = [];
  private rateHistory: {
    time: number;
    optic: number;
    central: number;
    descending: number;
  }[] = [];
  private pulsePhase = 0;
  private lastTelemetry: NeuralTelemetrySnapshot | null = null;

  private inDegrees: Int32Array | null = null;
  private inSynapseSums: Int32Array | null = null;

  public onNeuronSelected?: (
    item: NeuronTelemetryItem,
    details: NeuronDetailData,
  ) => void;

  constructor(container: HTMLElement) {
    this.container = container;
    container.style.position = "relative";
    container.style.overflow = "hidden";

    // 1. Setup Three.js WebGL renderer
    this.threeRenderer = new T.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.threeRenderer.setSize(this.width, this.height);
    this.threeRenderer.domElement.className = "brain-three-canvas";
    this.threeRenderer.domElement.style.position = "absolute";
    this.threeRenderer.domElement.style.top = "0";
    this.threeRenderer.domElement.style.left = "0";
    this.threeRenderer.domElement.style.width = "100%";
    this.threeRenderer.domElement.style.height = "100%";
    this.threeRenderer.domElement.style.display = "block";
    container.appendChild(this.threeRenderer.domElement);

    // 2. Setup Three.js Scene & Camera
    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(
      45,
      this.width / this.height,
      0.05,
      50,
    );
    this.camera.position.set(0, 0, this.cameraDistance);
    this.camera.lookAt(0, 0, 0);

    this.morphologyGroup = new T.Group();
    this.scene.add(this.morphologyGroup);

    this.scaleBarGroup = new T.Group();
    this.scene.add(this.scaleBarGroup);

    // 3. Setup 2D Canvas for Circuit/Raster/Overlays
    this.canvas2d = document.createElement("canvas");
    this.canvas2d.className = "brain-2d-canvas";
    this.canvas2d.style.position = "absolute";
    this.canvas2d.style.top = "0";
    this.canvas2d.style.left = "0";
    this.canvas2d.style.width = "100%";
    this.canvas2d.style.height = "100%";
    this.canvas2d.style.pointerEvents = "none";
    container.appendChild(this.canvas2d);

    const ctx = this.canvas2d.getContext("2d");
    if (!ctx)
      throw new Error("Could not get 2D canvas context for BrainRenderer");
    this.ctx = ctx;

    this.setupListeners();
    this.resize();
  }

  setGraph(graph: ConnectomeCSRGraph) {
    this.graph = graph;
    this.precomputeConnectivity();
    if (this.spikeExcitation.length !== graph.neurons.length) {
      this.spikeExcitation = new Float32Array(graph.neurons.length);
    }
  }

  setMorphology(morphology: MorphologyData) {
    this.morphology = morphology;
    this.buildMorphologyGeometry();
    this.buildScaleBar();
  }

  private buildMorphologyGeometry() {
    if (!this.morphology) return;
    const morph = this.morphology;
    const totalSegments = morph.manifest.totalSegments;
    const totalVertices = totalSegments * 2;

    // Remove existing mesh
    if (this.lineMesh) {
      this.morphologyGroup.remove(this.lineMesh);
      this.lineMesh.geometry.dispose();
      this.lineMesh = null;
    }

    const geometry = new T.BufferGeometry();

    // 1. Position attribute [x, y, z] flat array of segment endpoints
    geometry.setAttribute(
      "position",
      new T.BufferAttribute(morph.positions, 3),
    );

    // 2. Vertex neuron index attribute (float for shader lookup)
    const neuronIndices = new Float32Array(totalVertices);
    // 3. Region base color attribute (RGB)
    const regionColors = new Float32Array(totalVertices * 3);

    for (let seg = 0; seg < totalSegments; seg++) {
      const neuronIdx = morph.segmentBodyIds[seg];
      const v1 = seg * 2;
      const v2 = v1 + 1;

      neuronIndices[v1] = neuronIdx;
      neuronIndices[v2] = neuronIdx;

      const meta = morph.meta[neuronIdx];
      const region = meta?.region || "Protocerebrum";
      const rgb = REGION_COLORS[region] || [0.5, 0.5, 0.6];

      regionColors[v1 * 3] = rgb[0];
      regionColors[v1 * 3 + 1] = rgb[1];
      regionColors[v1 * 3 + 2] = rgb[2];

      regionColors[v2 * 3] = rgb[0];
      regionColors[v2 * 3 + 1] = rgb[1];
      regionColors[v2 * 3 + 2] = rgb[2];
    }

    geometry.setAttribute(
      "aNeuronIndex",
      new T.BufferAttribute(neuronIndices, 1),
    );
    geometry.setAttribute(
      "aRegionColor",
      new T.BufferAttribute(regionColors, 3),
    );

    // 4. Setup Activity Texture (64x64 float RGBA = 4096 capacity >= 2439 neurons)
    const texSize = 64;
    this.activityData = new Float32Array(texSize * texSize * 4);
    this.activityTexture = new T.DataTexture(
      this.activityData,
      texSize,
      texSize,
      T.RGBAFormat,
      T.FloatType,
    );
    this.activityTexture.minFilter = T.NearestFilter;
    this.activityTexture.magFilter = T.NearestFilter;
    this.activityTexture.needsUpdate = true;

    // 5. Custom Vertex & Fragment Shader for Single-Draw-Call 60 FPS rendering
    const vertexShader = `
      attribute float aNeuronIndex;
      attribute vec3 aRegionColor;

      uniform sampler2D uActivityTex;
      uniform float uColorMode;      // 0.0 = Activity, 1.0 = Anatomy
      uniform float uSelectedNeuron; // -1.0 if none, else selected index
      uniform float uDimOthers;      // 1.0 when a neuron is selected/isolated

      varying vec4 vColor;

      void main() {
        float idx = aNeuronIndex;
        float u = (mod(idx, 64.0) + 0.5) / 64.0;
        float v = (floor(idx / 64.0) + 0.5) / 64.0;
        vec4 act = texture2D(uActivityTex, vec2(u, v));

        float firingRate = act.r;    // 0..1 normalized firing rate
        float spikeDecay = act.g;    // 0..1 recent spike pulse with decay
        float isHovered = act.b;     // 1.0 if hovered

        // Biological resting baseline: subtle dark slate grey with delicate region tint
        vec3 restSlate = vec3(0.16, 0.20, 0.27);
        vec3 restAnatomy = aRegionColor * 0.75;
        vec3 baseColor = mix(restSlate, restAnatomy, uColorMode);

        // Active neural glow: electric cyan transitioning to bright white-gold on spike
        vec3 pulseColor = mix(vec3(0.05, 0.92, 1.0), vec3(1.0, 0.98, 0.7), spikeDecay);

        float excitation = max(firingRate * 0.85, spikeDecay);
        vec3 finalColor = mix(baseColor, pulseColor, excitation);
        float alpha = mix(0.32, 0.95, excitation);

        // Selection / Hover highlight
        bool isSelected = (uSelectedNeuron >= 0.0 && abs(idx - uSelectedNeuron) < 0.5);
        if (isSelected || isHovered > 0.5) {
          finalColor = vec3(1.0, 0.95, 0.25); // Vibrant golden arborization
          alpha = 1.0;
        } else if (uDimOthers > 0.5) {
          alpha *= 0.12;
          finalColor *= 0.35;
        }

        vColor = vec4(finalColor, alpha);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      precision highp float;
      varying vec4 vColor;

      void main() {
        gl_FragColor = vColor;
      }
    `;

    this.shaderMaterial = new T.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uActivityTex: { value: this.activityTexture },
        uColorMode: { value: this.colorMode === "anatomy" ? 1.0 : 0.0 },
        uSelectedNeuron: {
          value:
            this.selectedNeuronIndex !== null ? this.selectedNeuronIndex : -1.0,
        },
        uDimOthers: { value: this.selectedNeuronIndex !== null ? 1.0 : 0.0 },
      },
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
    });

    this.lineMesh = new T.LineSegments(geometry, this.shaderMaterial);
    this.morphologyGroup.add(this.lineMesh);
  }

  private buildScaleBar() {
    if (!this.morphology) return;
    // Clear existing scale bar
    while (this.scaleBarGroup.children.length > 0) {
      const c = this.scaleBarGroup.children[0];
      this.scaleBarGroup.remove(c);
      if ((c as any).geometry) (c as any).geometry.dispose();
    }

    const scale100um = this.morphology.manifest.transform.scaleBar100umUnits;
    // 3D scale bar line positioned at bottom left of the brain
    const barGeo = new T.BufferGeometry().setFromPoints([
      new T.Vector3(-0.7, -0.75, 0),
      new T.Vector3(-0.7 + scale100um, -0.75, 0),
    ]);
    const barMat = new T.LineBasicMaterial({ color: 0x88bbdd, linewidth: 2 });
    const barLine = new T.Line(barGeo, barMat);
    this.scaleBarGroup.add(barLine);
  }

  private precomputeConnectivity() {
    if (!this.graph) return;
    const n = this.graph.neurons.length;
    this.inDegrees = new Int32Array(n);
    this.inSynapseSums = new Int32Array(n);

    const indptr = this.graph.indptr;
    const indices = this.graph.indices;
    const bioW = this.graph.biologicalWeights;

    for (let i = 0; i < n; i++) {
      const start = indptr[i];
      const end = indptr[i + 1];
      for (let k = start; k < end; k++) {
        const post = indices[k];
        if (post < n) {
          this.inDegrees[post]++;
          if (bioW) {
            this.inSynapseSums[post] += bioW[k];
          }
        }
      }
    }
  }

  setViewMode(mode: BrainViewMode) {
    this.viewMode = mode;
    if (mode === "morphology" || mode === "spatial") {
      this.threeRenderer.domElement.style.display = "block";
      this.canvas2d.style.pointerEvents = "none";
    } else {
      this.threeRenderer.domElement.style.display = "none";
      this.canvas2d.style.pointerEvents = "auto";
    }
    this.resize();
  }

  getViewMode(): BrainViewMode {
    return this.viewMode;
  }

  setColorMode(mode: BrainColorMode) {
    this.colorMode = mode;
    if (this.shaderMaterial) {
      this.shaderMaterial.uniforms.uColorMode.value =
        mode === "anatomy" ? 1.0 : 0.0;
    }
  }

  getColorMode(): BrainColorMode {
    return this.colorMode;
  }

  setPaused(paused: boolean) {
    this.isPaused = paused;
  }

  setMicroscopeMode(enabled: boolean) {
    this.isMicroscope = enabled;
    this.resize();
  }

  resetCamera() {
    this.targetRotX = 0.25;
    this.targetRotY = 0.0;
    this.targetCameraDistance = 3.2;
    this.panX = 0;
    this.panY = 0;
  }

  selectNeuronByIndex(index: number | null) {
    this.selectedNeuronIndex = index;
    if (this.shaderMaterial) {
      this.shaderMaterial.uniforms.uSelectedNeuron.value =
        index !== null ? index : -1.0;
      this.shaderMaterial.uniforms.uDimOthers.value =
        index !== null ? 1.0 : 0.0;
    }
    if (index !== null) {
      const details = this.getNeuronDetails(index);
      const item = this.lastTelemetry?.neurons[index];
      if (details && item && this.onNeuronSelected) {
        this.onNeuronSelected(item, details);
      }
    }
  }

  getNeuronDetails(index: number): NeuronDetailData | null {
    if (!this.graph || index < 0 || index >= this.graph.neurons.length)
      return null;
    const n = this.graph.neurons[index];
    const indptr = this.graph.indptr;
    const outDegree = indptr[index + 1] - indptr[index];

    let outSynapses = outDegree;
    if (this.graph.biologicalWeights) {
      let sum = 0;
      for (let k = indptr[index]; k < indptr[index + 1]; k++) {
        sum += this.graph.biologicalWeights[k];
      }
      outSynapses = sum;
    }

    const inDegree = this.inDegrees ? this.inDegrees[index] : 0;
    const inSynapses = this.inSynapseSums
      ? this.inSynapseSums[index]
      : inDegree;
    const telemItem = this.lastTelemetry?.neurons[index];

    return {
      index,
      bodyId: n.bodyId,
      type: n.type,
      instance: n.instance,
      hemisphere: n.hemisphere,
      region: n.region,
      neurotransmitter: n.neurotransmitter,
      coordinateType: n.coordinateType || "soma_voxel",
      pos: n.pos,
      inDegree,
      inSynapses,
      outDegree,
      outSynapses,
      vm: telemItem ? telemItem.v : -65.0,
      firingRateHz: telemItem ? telemItem.firingRateHz : 0,
      spiking: telemItem ? telemItem.spiking : false,
    };
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    this.width = Math.max(200, rect.width || 420);
    this.height = Math.max(200, rect.height || 520);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    // Resize Three.js
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.threeRenderer.setSize(this.width, this.height);
    this.threeRenderer.setPixelRatio(dpr);

    // Resize 2D Canvas
    this.canvas2d.width = this.width * dpr;
    this.canvas2d.height = this.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private setupListeners() {
    window.addEventListener("resize", () => this.resize());

    const dom = this.container;

    dom.addEventListener("mousedown", (e) => {
      this.isDragging = true;
      this.isPanning = e.button === 2 || e.shiftKey;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });

    window.addEventListener("mouseup", () => {
      this.isDragging = false;
      this.isPanning = false;
    });

    dom.addEventListener("contextmenu", (e) => e.preventDefault());

    dom.addEventListener("mousemove", (e) => {
      const rect = dom.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (this.isDragging) {
        const dx = e.clientX - this.lastMouseX;
        const dy = e.clientY - this.lastMouseY;

        if (this.isPanning) {
          this.panX += dx * 0.003 * this.cameraDistance;
          this.panY -= dy * 0.003 * this.cameraDistance;
        } else {
          this.targetRotY += dx * 0.01;
          this.targetRotX = Math.max(
            -1.4,
            Math.min(1.4, this.targetRotX + dy * 0.01),
          );
        }

        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
      }

      if (this.viewMode === "morphology" || this.viewMode === "spatial") {
        this.checkRaycastHover(mx, my);
      }
    });

    dom.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
        this.targetCameraDistance = Math.max(
          0.6,
          Math.min(8.0, this.targetCameraDistance * zoomFactor),
        );
      },
      { passive: false },
    );

    dom.addEventListener("mouseleave", () => {
      this.hoveredNeuronIndex = null;
      this.hoveredNeuronItem = null;
      this.isDragging = false;
    });

    dom.addEventListener("click", (e) => {
      if (this.hoveredNeuronIndex !== null) {
        this.selectNeuronByIndex(this.hoveredNeuronIndex);
      } else {
        // Deselect if clicked empty space
        this.selectNeuronByIndex(null);
      }
    });
  }

  private checkRaycastHover(screenX: number, screenY: number) {
    if (!this.morphology || !this.lastTelemetry) return;

    // Convert screen coordinates to Normalized Device Coordinates (-1 to +1)
    const ndcX = (screenX / this.width) * 2 - 1;
    const ndcY = -(screenY / this.height) * 2 + 1;

    const raycaster = new T.Raycaster();
    raycaster.setFromCamera(new T.Vector2(ndcX, ndcY), this.camera);
    const ray = raycaster.ray;

    let closestIdx: number | null = null;
    let minDistanceToRay = 0.09 * (this.cameraDistance / 3.0); // Picking threshold in 3D units

    const metaList = this.morphology.meta;
    for (let i = 0; i < metaList.length; i++) {
      const meta = metaList[i];
      if (!meta.hasMorphology) continue;

      const [cx, cy, cz] = meta.centroid;
      const centroidVec = new T.Vector3(cx, cy, cz);
      centroidVec.applyMatrix4(this.morphologyGroup.matrixWorld);

      const dist = ray.distanceToPoint(centroidVec);
      if (dist < minDistanceToRay) {
        minDistanceToRay = dist;
        closestIdx = i;
      }
    }

    this.hoveredNeuronIndex = closestIdx;
    this.hoveredNeuronItem =
      closestIdx !== null ? this.lastTelemetry.neurons[closestIdx] : null;
  }

  render(telemetry: NeuralTelemetrySnapshot | null) {
    if (!telemetry || !this.graph) return;
    this.lastTelemetry = telemetry;

    const now = performance.now();
    const dt = Math.min(
      0.1,
      Math.max(0.001, (now - this.lastRenderTime) / 1000),
    );
    this.lastRenderTime = now;
    this.pulsePhase += 0.05;

    // Smooth camera interpolation
    this.rotX += (this.targetRotX - this.rotX) * 0.15;
    this.rotY += (this.targetRotY - this.rotY) * 0.15;
    this.cameraDistance +=
      (this.targetCameraDistance - this.cameraDistance) * 0.15;

    // Subtle idle auto-rotation
    if (
      !this.isDragging &&
      !this.isPaused &&
      (this.viewMode === "morphology" || this.viewMode === "spatial")
    ) {
      this.targetRotY += 0.0025;
    }

    // Update Spike History & Temporal Rate Decays
    if (!this.isPaused) {
      for (let i = 0; i < telemetry.neurons.length; i++) {
        const item = telemetry.neurons[i];
        if (item?.spiking) {
          this.spikeExcitation[i] = 1.0;
          this.spikeHistory.push({ time: now, neuronIndex: i });
        } else {
          // Exponential decay (~150ms half-life)
          this.spikeExcitation[i] *= Math.exp(-dt / 0.15);
        }
      }
      this.spikeHistory = this.spikeHistory.filter((s) => now - s.time < 1200);

      this.rateHistory.push({
        time: now,
        optic: telemetry.regionActivity.OpticLobe || 0,
        central: telemetry.regionActivity.CentralComplex || 0,
        descending: telemetry.regionActivity.Descending || 0,
      });
      if (this.rateHistory.length > 80) this.rateHistory.shift();
    }

    const w = this.width;
    const h = this.height;

    if (this.viewMode === "morphology" || this.viewMode === "spatial") {
      this.renderMorphology3D(telemetry, w, h);
    } else {
      this.render2DViews(telemetry, w, h);
    }
  }

  private renderMorphology3D(
    telemetry: NeuralTelemetrySnapshot,
    w: number,
    h: number,
  ) {
    // 1. Update Dynamic GPU Activity Texture Buffer
    if (this.activityData && this.activityTexture) {
      const neurons = telemetry.neurons;
      for (let i = 0; i < neurons.length; i++) {
        const item = neurons[i];
        const baseIdx = i * 4;
        const firingNorm = Math.min(1.0, (item?.firingRateHz || 0) / 120.0);
        const spikeDecay = this.spikeExcitation[i] || 0.0;
        const isHovered = this.hoveredNeuronIndex === i ? 1.0 : 0.0;

        this.activityData[baseIdx] = firingNorm;
        this.activityData[baseIdx + 1] = spikeDecay;
        this.activityData[baseIdx + 2] = isHovered;
        this.activityData[baseIdx + 3] = 1.0;
      }
      this.activityTexture.needsUpdate = true;
    }

    // 2. Position Camera & Morphology Group
    this.morphologyGroup.rotation.x = this.rotX;
    this.morphologyGroup.rotation.y = this.rotY;
    this.morphologyGroup.position.set(this.panX, this.panY, 0);

    this.scaleBarGroup.position.set(this.panX, this.panY, 0);
    this.scaleBarGroup.rotation.x = this.rotX;
    this.scaleBarGroup.rotation.y = this.rotY;

    this.camera.position.set(0, 0, this.cameraDistance);
    this.camera.lookAt(0, 0, 0);

    // 3. Render WebGL Scene
    this.threeRenderer.render(this.scene, this.camera);

    // 4. Draw 2D HUD Overlays (Scale Bar Badge, Tooltip, Active Pathway)
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    this.drawScaleBarBadge(w, h);
    this.drawSensoryMotorBar(telemetry, w, h);

    if (this.hoveredNeuronItem && this.hoveredNeuronIndex !== null) {
      this.drawTooltip(this.hoveredNeuronItem, w, h);
    }
  }

  private drawScaleBarBadge(w: number, h: number) {
    const ctx = this.ctx;
    const barY = h - 38;
    const barX = 16;

    // Authentic Scale Bar overlay
    ctx.save();
    ctx.fillStyle = "rgba(10, 20, 28, 0.85)";
    ctx.strokeStyle = "rgba(69, 208, 223, 0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(barX - 4, barY - 18, 180, 28, 4);
    ctx.fill();
    ctx.stroke();

    // Scale Line (matches MaleCNS EM 100um)
    ctx.strokeStyle = "#45d0df";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(barX + 4, barY - 2);
    ctx.lineTo(barX + 44, barY - 2);
    ctx.stroke();

    ctx.fillStyle = "#e6f8fa";
    ctx.font = "600 10px monospace";
    ctx.fillText("100 µm (MaleCNS EM)", barX + 50, barY + 1);
    ctx.restore();
  }

  private render2DViews(
    telemetry: NeuralTelemetrySnapshot,
    w: number,
    h: number,
  ) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    // High-tech dark background with subtle grid
    ctx.fillStyle = "rgba(8, 16, 22, 0.96)";
    ctx.fillRect(0, 0, w, h);
    this.drawGrid(w, h);

    if (this.viewMode === "circuit") {
      this.drawCircuitView(telemetry, w, h);
    } else if (this.viewMode === "raster") {
      this.drawRasterView(telemetry, w, h);
    }

    if (telemetry.activePathway && telemetry.activePathway.length > 0) {
      this.drawActivePathway(telemetry.activePathway, w, h);
    }

    this.drawSensoryMotorBar(telemetry, w, h);

    if (this.hoveredNeuronItem) {
      this.drawTooltip(this.hoveredNeuronItem, w, h);
    }
  }

  private drawGrid(w: number, h: number) {
    const ctx = this.ctx;
    ctx.strokeStyle = "rgba(42, 75, 84, 0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < w; x += 32) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = 0; y < h; y += 32) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
  }

  private drawCircuitView(
    telemetry: NeuralTelemetrySnapshot,
    w: number,
    h: number,
  ) {
    const ctx = this.ctx;
    if (!this.graph) return;

    const compartments: {
      name: string;
      subtext: string;
      key: NeuropilRegion;
      y: number;
      h: number;
      color: string;
    }[] = [
      {
        name: "1. VISION (Optic Lobe VPNs)",
        subtext: "LC4 Looming · LC6 · LC10 Retinotopic Target Tracking",
        key: "OpticLobe",
        y: 28,
        h: 70,
        color: "#45d0df",
      },
      {
        name: "2. INTERMEDIATE (Protocerebrum / LAL)",
        subtext: "Lateral Accessory Lobe · Reciprocal Inhibition Routing",
        key: "Protocerebrum",
        y: 108,
        h: 60,
        color: "#a55eea",
      },
      {
        name: "3. CENTRAL / NAVIGATION (CX Heading)",
        subtext: "EPG Compass Ring Attractor · PEN · PFL3 Motor Vectors",
        key: "CentralComplex",
        y: 178,
        h: 60,
        color: "#61e89b",
      },
      {
        name: "4. DESCENDING MOTOR COMMANDS (DNs)",
        subtext:
          "DNa02 Steering Asymmetry · DNp01 Forward Thrust · MDN Braking",
        key: "Descending",
        y: 248,
        h: 65,
        color: "#ffaa1a",
      },
      {
        name: "5. VNC MOTOR EFFECTORS",
        subtext: "Wing Stroke Amplitude · Physical Racket Kinematics",
        key: "VNC",
        y: 323,
        h: 55,
        color: "#ff5252",
      },
    ];

    for (const comp of compartments) {
      const act = telemetry.regionActivity[comp.key] || 0;
      const isHot = act > 0.08;

      ctx.fillStyle = isHot
        ? "rgba(20, 38, 48, 0.75)"
        : "rgba(12, 22, 30, 0.45)";
      ctx.strokeStyle = isHot ? comp.color : "rgba(50, 80, 92, 0.4)";
      ctx.lineWidth = isHot ? 1.5 : 1;
      ctx.beginPath();
      ctx.roundRect(14, comp.y, w - 28, comp.h, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isHot ? "#e6f8fa" : "#8caab5";
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.fillText(comp.name, 22, comp.y + 16);

      ctx.fillStyle = "rgba(140, 170, 181, 0.75)";
      ctx.font = "9px system-ui, sans-serif";
      ctx.fillText(comp.subtext, 22, comp.y + 28);

      const barW = Math.min(100, Math.max(0, act * 100));
      ctx.fillStyle = "rgba(18, 30, 38, 0.8)";
      ctx.fillRect(w - 130, comp.y + 8, 104, 10);
      ctx.fillStyle = comp.color;
      ctx.fillRect(w - 128, comp.y + 10, barW, 6);

      ctx.fillStyle = isHot ? comp.color : "#6c8c99";
      ctx.font = "bold 9px monospace";
      ctx.fillText(`${(act * 100).toFixed(0)}%`, w - 22, comp.y + 16);
    }
  }

  private drawRasterView(
    telemetry: NeuralTelemetrySnapshot,
    w: number,
    h: number,
  ) {
    const ctx = this.ctx;
    const now = performance.now();
    const plotX = 50;
    const plotY = 30;
    const plotW = w - 65;
    const plotH = h - 160;

    ctx.fillStyle = "rgba(6, 12, 18, 0.8)";
    ctx.fillRect(plotX, plotY, plotW, plotH);
    ctx.strokeStyle = "rgba(42, 75, 84, 0.4)";
    ctx.strokeRect(plotX, plotY, plotW, plotH);

    ctx.fillStyle = "#8caab5";
    ctx.font = "10px monospace";
    ctx.fillText("LIF SPIKE RASTER (PAST 1.2 SECONDS)", plotX, plotY - 8);

    const timeWindow = 1200;
    const totalNeurons = this.graph?.neurons.length || 2439;

    for (const spike of this.spikeHistory) {
      const dt = now - spike.time;
      if (dt < 0 || dt > timeWindow) continue;

      const sx = plotX + plotW - (dt / timeWindow) * plotW;
      const sy = plotY + (spike.neuronIndex / totalNeurons) * plotH;

      const neuron = this.graph?.neurons[spike.neuronIndex];
      const region = neuron?.region || "Protocerebrum";
      ctx.fillStyle = REGION_HEX[region] || "#45d0df";
      ctx.fillRect(sx, sy, 2, 2);
    }
  }

  private drawActivePathway(
    pathway: ActivePathwayNode[],
    w: number,
    h: number,
  ) {
    const ctx = this.ctx;
    const boxY = h - 110;
    const boxH = 40;
    const boxW = w - 28;

    ctx.fillStyle = "rgba(10, 20, 28, 0.85)";
    ctx.strokeStyle = "rgba(69, 208, 223, 0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(14, boxY, boxW, boxH, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#45d0df";
    ctx.font = "bold 9px monospace";
    ctx.fillText("⚡ ACTIVE SENSORIMOTOR TRACE:", 20, boxY + 12);

    const slotW = (boxW - 12) / Math.max(1, pathway.length);
    for (let i = 0; i < pathway.length; i++) {
      const node = pathway[i];
      const nx = 20 + i * slotW;
      const ny = boxY + 18;

      ctx.fillStyle = REGION_HEX[node.region] || "#45d0df";
      ctx.font = "bold 10px monospace";
      ctx.fillText(`${node.type}`, nx, ny + 14);

      if (i < pathway.length - 1) {
        ctx.fillStyle = "rgba(140, 170, 181, 0.6)";
        ctx.fillText("→", nx + slotW - 10, ny + 14);
      }
    }
  }

  private drawSensoryMotorBar(
    telemetry: NeuralTelemetrySnapshot,
    w: number,
    h: number,
  ) {
    const ctx = this.ctx;
    const barY = h - 60;
    const barH = 20;

    const steer =
      telemetry.motorCommand.biological?.steeringTorque ??
      telemetry.motorCommand.steerTorque ??
      0;
    const thrust =
      telemetry.motorCommand.biological?.forwardThrust ??
      telemetry.motorCommand.vz ??
      0;

    ctx.fillStyle = "rgba(10, 22, 30, 0.9)";
    ctx.fillRect(14, barY, w - 28, barH);
    ctx.strokeStyle = "rgba(42, 75, 84, 0.6)";
    ctx.strokeRect(14, barY, w - 28, barH);

    ctx.fillStyle = "#8caab5";
    ctx.font = "bold 9px monospace";
    ctx.fillText("MOTOR OUTPUT:", 20, barY + 14);

    // Steering bar
    const midX = 14 + (w - 28) * 0.55;
    const steerLen = steer * 40;
    ctx.fillStyle = steer >= 0 ? "#45d0df" : "#ffaa1a";
    ctx.fillRect(midX, barY + 4, steerLen, 12);

    ctx.fillStyle = "#e6f8fa";
    ctx.fillText(
      `STEER: ${steer > 0 ? "+" : ""}${steer.toFixed(2)}`,
      midX + 50,
      barY + 14,
    );
  }

  private drawTooltip(item: NeuronTelemetryItem, w: number, h: number) {
    const ctx = this.ctx;
    const neuron = this.graph?.neurons[item.index];
    if (!neuron) return;

    const tipW = 210;
    const tipH = 92;
    const tipX = Math.min(w - tipW - 10, Math.max(10, 16));
    const tipY = 16;

    ctx.save();
    ctx.fillStyle = "rgba(8, 16, 24, 0.94)";
    ctx.strokeStyle = REGION_HEX[neuron.region] || "#45d0df";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(tipX, tipY, tipW, tipH, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = REGION_HEX[neuron.region] || "#45d0df";
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.fillText(`${neuron.type} · #${neuron.bodyId}`, tipX + 10, tipY + 18);

    ctx.fillStyle = "#8caab5";
    ctx.font = "10px monospace";
    ctx.fillText(`Region: ${neuron.region}`, tipX + 10, tipY + 34);
    ctx.fillText(
      `Transmitter: ${neuron.neurotransmitter || "unknown"}`,
      tipX + 10,
      tipY + 48,
    );
    ctx.fillText(`Voltage Vm: ${item.v.toFixed(1)} mV`, tipX + 10, tipY + 62);
    ctx.fillText(
      `Rate: ${item.firingRateHz.toFixed(1)} Hz ${item.spiking ? "⚡ SPIKE" : ""}`,
      tipX + 10,
      tipY + 76,
    );
    ctx.restore();
  }

  destroy() {
    this.threeRenderer.dispose();
    if (this.lineMesh) {
      this.lineMesh.geometry.dispose();
    }
    if (this.shaderMaterial) {
      this.shaderMaterial.dispose();
    }
  }
}
