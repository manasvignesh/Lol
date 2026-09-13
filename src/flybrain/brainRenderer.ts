import type {
  ActivePathwayNode,
  ConnectomeCSRGraph,
  NeuralTelemetrySnapshot,
  NeuronData,
  NeuronDetailData,
  NeuronTelemetryItem,
  NeuropilRegion,
} from "./types";

export type BrainViewMode = "circuit" | "spatial" | "raster";

export class BrainRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private graph: ConnectomeCSRGraph | null = null;
  private viewMode: BrainViewMode = "circuit";
  private hoveredNeuron: NeuronTelemetryItem | null = null;
  private selectedNeuronIndex: number | null = null;
  private width = 420;
  private height = 520;
  private spikeHistory: { time: number; neuronIndex: number }[] = [];
  private rateHistory: {
    time: number;
    optic: number;
    central: number;
    descending: number;
  }[] = [];
  private pulsePhase = 0;
  private representativeIndices: number[] = [];
  private inDegrees: Int32Array | null = null;
  private inSynapseSums: Int32Array | null = null;
  private isPaused = false;
  private rotY = 0;
  private isDragging = false;
  private lastMouseX = 0;

  public onNeuronSelected?: (
    item: NeuronTelemetryItem,
    details: NeuronDetailData,
  ) => void;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "brain-canvas";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.display = "block";
    container.appendChild(this.canvas);

    const ctx = this.canvas.getContext("2d");
    if (!ctx)
      throw new Error("Could not get 2D canvas context for BrainRenderer");
    this.ctx = ctx;

    this.setupListeners();
    this.resize();
  }

  setGraph(graph: ConnectomeCSRGraph) {
    this.graph = graph;
    this.buildRepresentativeSet();
    this.precomputeConnectivity();
  }

  private buildRepresentativeSet() {
    if (!this.graph) return;
    const neurons = this.graph.neurons;
    const rep: number[] = [];

    // Prioritize key seed populations, descending channels, and visual VPNs
    for (let i = 0; i < neurons.length; i++) {
      const n = neurons[i];
      const t = n.type || "";
      const isKey =
        t.startsWith("LC") ||
        t.startsWith("LPLC") ||
        t.startsWith("EPG") ||
        t.startsWith("PEN") ||
        t.startsWith("PFL") ||
        t.startsWith("DN") ||
        t.startsWith("MDN") ||
        n.region === "Descending" ||
        n.region === "CentralComplex" ||
        i % 3 === 0;

      if (isKey) rep.push(i);
    }
    this.representativeIndices = rep;
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

  setViewMode(mode: BrainViewMode) {
    this.viewMode = mode;
  }

  getViewMode(): BrainViewMode {
    return this.viewMode;
  }

  setPaused(paused: boolean) {
    this.isPaused = paused;
  }

  selectNeuronByIndex(index: number) {
    this.selectedNeuronIndex = index;
    const details = this.getNeuronDetails(index);
    const item = this.lastTelemetry?.neurons[index];
    if (details && item && this.onNeuronSelected) {
      this.onNeuronSelected(item, details);
    }
  }

  resize() {
    const rect = this.canvas.parentElement?.getBoundingClientRect() || {
      width: 420,
      height: 520,
    };
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(200, rect.width);
    this.height = Math.max(200, rect.height);
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.scale(dpr, dpr);
  }

  private setupListeners() {
    window.addEventListener("resize", () => this.resize());

    this.canvas.addEventListener("mousedown", (e) => {
      this.isDragging = true;
      this.lastMouseX = e.clientX;
    });

    window.addEventListener("mouseup", () => {
      this.isDragging = false;
    });

    this.canvas.addEventListener("mousemove", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (this.isDragging && this.viewMode === "spatial") {
        const dx = e.clientX - this.lastMouseX;
        this.rotY += dx * 0.012;
        this.lastMouseX = e.clientX;
      }

      this.checkHover(mx, my);
    });

    this.canvas.addEventListener("mouseleave", () => {
      this.hoveredNeuron = null;
      this.isDragging = false;
    });

    this.canvas.addEventListener("click", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      // Check active pathway clicks first
      if (this.lastTelemetry?.activePathway) {
        const path = this.lastTelemetry.activePathway;
        const boxY = this.height - 110;
        if (my >= boxY && my <= boxY + 40) {
          const slotW = (this.width - 32) / Math.max(1, path.length);
          const clickedSlot = Math.floor((mx - 16) / slotW);
          if (clickedSlot >= 0 && clickedSlot < path.length) {
            this.selectNeuronByIndex(path[clickedSlot].index);
            return;
          }
        }
      }

      if (this.hoveredNeuron) {
        this.selectNeuronByIndex(this.hoveredNeuron.index);
      }
    });
  }

  private checkHover(mx: number, my: number) {
    if (!this.lastTelemetry || !this.graph) return;

    let closest: NeuronTelemetryItem | null = null;
    let minDist = 20;

    const subset =
      this.representativeIndices.length > 0
        ? this.representativeIndices
        : this.lastTelemetry.neurons.map((_, i) => i);

    for (const idx of subset) {
      const item = this.lastTelemetry.neurons[idx];
      if (!item) continue;
      const pos =
        this.viewMode === "spatial"
          ? this.getSpatialScreenPos(idx, this.width, this.height)
          : this.getNeuronScreenPos(idx);
      const dx = mx - pos.x;
      const dy = my - pos.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < minDist) {
        minDist = d;
        closest = item;
      }
    }
    this.hoveredNeuron = closest;
  }

  private lastTelemetry: NeuralTelemetrySnapshot | null = null;

  render(telemetry: NeuralTelemetrySnapshot | null) {
    if (!telemetry || !this.graph) return;
    this.lastTelemetry = telemetry;
    this.pulsePhase += 0.05;

    if (!this.isDragging && this.viewMode === "spatial") {
      this.rotY += 0.003; // Subtle organic rotation
    }

    // Record spikes if not paused
    const now = performance.now();
    if (!this.isPaused) {
      for (let i = 0; i < telemetry.neurons.length; i++) {
        if (telemetry.neurons[i]?.spiking) {
          this.spikeHistory.push({ time: now, neuronIndex: i });
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

    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    ctx.clearRect(0, 0, w, h);

    // High-tech dark background with subtle blueprint grid
    ctx.fillStyle = "rgba(8, 16, 22, 0.96)";
    ctx.fillRect(0, 0, w, h);

    this.drawGrid(w, h);

    if (this.viewMode === "circuit") {
      this.drawCircuitView(telemetry, w, h);
    } else if (this.viewMode === "spatial") {
      this.drawSpatialView(telemetry, w, h);
    } else {
      this.drawRasterView(telemetry, w, h);
    }

    // Active pathway trace overlay
    if (telemetry.activePathway && telemetry.activePathway.length > 0) {
      this.drawActivePathway(telemetry.activePathway, w, h);
    }

    this.drawSensoryMotorBar(telemetry, w, h);

    // Tooltip
    if (this.hoveredNeuron) {
      this.drawTooltip(this.hoveredNeuron, w, h);
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

  /**
   * 1. CIRCUIT FLOW VIEW: Layered functional compartments with dynamic propagation
   */
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
        name: "4. DESCENDING OUTPUT (Brain ➔ VNC)",
        subtext: "DNa01/02 Steering · DNp01 Thrust · DNb01/GF Strike",
        key: "Descending",
        y: 248,
        h: 65,
        color: "#f7b731",
      },
      {
        name: "5. ENGINEERED EMBODIMENT",
        subtext: "Court Flight Velocity (vx, vz) · Swept Racket Return",
        key: "VNC",
        y: 323,
        h: 65,
        color: "#ff5e7e",
      },
    ];

    for (const c of compartments) {
      const act = telemetry.regionActivity[c.key] || 0;
      const normAct = Math.min(1.0, act / 35.0);

      // Compartment Box
      ctx.fillStyle = `rgba(14, 26, 34, ${0.45 + normAct * 0.25})`;
      ctx.beginPath();
      ctx.roundRect(10, c.y, w - 20, c.h, 6);
      ctx.fill();

      ctx.strokeStyle = c.color;
      ctx.globalAlpha = 0.25 + normAct * 0.55;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.globalAlpha = 1.0;

      // Activity Energy Bar on left edge
      ctx.fillStyle = c.color;
      ctx.fillRect(10, c.y, 4, c.h * normAct);

      // Title & Subtitle
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 9.5px monospace";
      ctx.fillText(c.name, 20, c.y + 14);

      ctx.fillStyle = c.color;
      ctx.font = "bold 9px monospace";
      ctx.fillText(`[${act.toFixed(1)} Hz]`, w - 75, c.y + 14);

      ctx.fillStyle = "rgba(180, 205, 215, 0.7)";
      ctx.font = "8px sans-serif";
      ctx.fillText(c.subtext, 20, c.y + 26);
    }

    // Draw active biological synapse connections
    ctx.lineWidth = 1.0;
    const subset = this.representativeIndices;
    for (let s = 0; s < subset.length; s += 2) {
      const i = subset[s];
      const p1 = this.getNeuronScreenPos(i);
      const start = this.graph.indptr[i];
      const end = Math.min(start + 3, this.graph.indptr[i + 1]);

      for (let k = start; k < end; k++) {
        const post = this.graph.indices[k];
        const p2 = this.getNeuronScreenPos(post);
        const sign = this.graph.signs[k];
        const preSpiking = telemetry.neurons[i]?.spiking;

        ctx.strokeStyle =
          sign > 0 ? "rgba(97, 232, 155, 0.08)" : "rgba(255, 94, 126, 0.08)";
        if (preSpiking) {
          ctx.strokeStyle =
            sign > 0 ? "rgba(97, 232, 155, 0.85)" : "rgba(255, 94, 126, 0.85)";
          ctx.lineWidth = 1.6;
        } else {
          ctx.lineWidth = 0.7;
        }

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
    }

    // Draw representative neurons
    for (const idx of subset) {
      const n = telemetry.neurons[idx];
      if (!n) continue;
      const pos = this.getNeuronScreenPos(idx);
      this.drawNeuronNode(pos.x, pos.y, n, idx === this.selectedNeuronIndex);
    }
  }

  /**
   * 2. CONNECTOME VIEW: 3D MaleCNS Anatomical Layout with EM Voxel Coordinates
   */
  private drawSpatialView(
    telemetry: NeuralTelemetrySnapshot,
    w: number,
    h: number,
  ) {
    const ctx = this.ctx;
    if (!this.graph) return;

    ctx.fillStyle = "rgba(69, 208, 223, 0.75)";
    ctx.font = "bold 9.5px monospace";
    ctx.fillText(`3D MALECNS v1.0 ANATOMICAL GRAPH`, 14, 20);

    ctx.fillStyle = "rgba(160, 185, 195, 0.6)";
    ctx.font = "8.5px sans-serif";
    ctx.fillText(
      `Drag to rotate · Showing ${this.representativeIndices.length} representative neurons`,
      14,
      32,
    );

    const subset = this.representativeIndices;
    // Synaptic connections
    for (let s = 0; s < subset.length; s += 2) {
      const i = subset[s];
      const p1 = this.getSpatialScreenPos(i, w, h);
      const start = this.graph.indptr[i];
      const end = Math.min(start + 2, this.graph.indptr[i + 1]);

      for (let k = start; k < end; k++) {
        const post = this.graph.indices[k];
        const p2 = this.getSpatialScreenPos(post, w, h);
        const preSpike = telemetry.neurons[i]?.spiking;

        ctx.strokeStyle = preSpike
          ? "rgba(255, 255, 255, 0.85)"
          : "rgba(69, 208, 223, 0.08)";
        ctx.lineWidth = preSpike ? 1.8 : 0.7;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
    }

    // Draw neurons
    for (const idx of subset) {
      const n = telemetry.neurons[idx];
      if (!n) continue;
      const pos = this.getSpatialScreenPos(idx, w, h);
      this.drawNeuronNode(pos.x, pos.y, n, idx === this.selectedNeuronIndex);
    }
  }

  /**
   * 3. SPIKE VIEW: Multi-Population Raster & Rate Oscilloscope
   */
  private drawRasterView(
    telemetry: NeuralTelemetrySnapshot,
    w: number,
    h: number,
  ) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.font = "bold 10px monospace";
    ctx.fillText(`SPIKE RASTER & POPULATION OSCILLOSCOPE`, 14, 20);

    const now = performance.now();
    const chartY = 32;
    const chartH = 175;

    // Raster background box
    ctx.fillStyle = "rgba(10, 20, 26, 0.6)";
    ctx.fillRect(14, chartY, w - 28, chartH);
    ctx.strokeStyle = "rgba(69, 208, 223, 0.25)";
    ctx.strokeRect(14, chartY, w - 28, chartH);

    // Draw spike dots
    ctx.fillStyle = "rgba(69, 208, 223, 0.9)";
    const totalN = this.graph?.neurons.length || 2439;
    for (const spike of this.spikeHistory) {
      const age = (now - spike.time) / 1200; // 0 to 1
      const x = w - 16 - age * (w - 32);
      const y = chartY + (spike.neuronIndex / totalN) * chartH;
      ctx.fillRect(x, y, 2.2, 2.2);
    }

    // Multi-region firing rate curves
    const curveY = chartY + chartH + 18;
    const curveH = 85;

    ctx.fillStyle = "rgba(10, 20, 26, 0.6)";
    ctx.fillRect(14, curveY, w - 28, curveH);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.strokeRect(14, curveY, w - 28, curveH);

    const drawCurve = (
      rates: number[],
      color: string,
      label: string,
      offsetIdx: number,
    ) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (let i = 0; i < rates.length; i++) {
        const x = 14 + (i / Math.max(1, rates.length - 1)) * (w - 28);
        const val = Math.min(100, rates[i]) / 100;
        const y = curveY + curveH - val * curveH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.font = "bold 8.5px monospace";
      ctx.fillText(`${label}`, 18 + offsetIdx * 82, curveY - 4);
    };

    drawCurve(
      this.rateHistory.map((r) => r.optic),
      "#45d0df",
      "OPTIC LOBE",
      0,
    );
    drawCurve(
      this.rateHistory.map((r) => r.central),
      "#61e89b",
      "CENTRAL CX",
      1,
    );
    drawCurve(
      this.rateHistory.map((r) => r.descending),
      "#f7b731",
      "DESCENDING",
      2,
    );
  }

  /**
   * ACTIVE PATHWAY TRACE MODE: Highlights real sensorimotor transmission route
   */
  private drawActivePathway(path: ActivePathwayNode[], w: number, h: number) {
    const ctx = this.ctx;
    if (path.length < 2) return;

    ctx.strokeStyle = "#ffd32a";
    ctx.lineWidth = 2.5;
    ctx.shadowColor = "#ffd32a";
    ctx.shadowBlur = 8;

    ctx.beginPath();
    for (let i = 0; i < path.length; i++) {
      const idx = path[i].index;
      const pos =
        this.viewMode === "spatial"
          ? this.getSpatialScreenPos(idx, w, h)
          : this.getNeuronScreenPos(idx);

      if (i === 0) ctx.moveTo(pos.x, pos.y);
      else ctx.lineTo(pos.x, pos.y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Interactive clickable active pathway breadcrumbs in bottom corner
    const boxY = h - 110;
    ctx.fillStyle = "rgba(10, 20, 26, 0.94)";
    ctx.fillRect(10, boxY, w - 20, 38);
    ctx.strokeStyle = "#ffd32a";
    ctx.lineWidth = 1;
    ctx.strokeRect(10, boxY, w - 20, 38);

    ctx.fillStyle = "#ffd32a";
    ctx.font = "bold 8.5px monospace";
    ctx.fillText(
      "⚡ ACTIVE CONNECTOME PATH (Click node to inspect):",
      16,
      boxY + 12,
    );

    const slotW = (w - 32) / Math.max(1, path.length);
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      const px = 16 + i * slotW;
      ctx.fillStyle = "rgba(255, 211, 42, 0.15)";
      ctx.fillRect(px, boxY + 18, slotW - 6, 16);
      ctx.strokeStyle = "rgba(255, 211, 42, 0.4)";
      ctx.strokeRect(px, boxY + 18, slotW - 6, 16);

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 8px monospace";
      ctx.fillText(`${p.type}`, px + 3, boxY + 29);
    }
  }

  private drawNeuronNode(
    x: number,
    y: number,
    item: NeuronTelemetryItem,
    isSelected: boolean,
  ) {
    const ctx = this.ctx;
    const isHovered = this.hoveredNeuron?.index === item.index;
    const rate = item.firingRateHz;

    let baseColor = "#45d0df";
    if (item.region === "CentralComplex") baseColor = "#61e89b";
    else if (item.region === "Protocerebrum") baseColor = "#a55eea";
    else if (item.region === "Descending") baseColor = "#f7b731";
    else if (item.region === "VNC") baseColor = "#ff5e7e";

    const radius = isSelected
      ? 7.5
      : isHovered
        ? 6.5
        : item.spiking
          ? 5.2
          : Math.max(2.4, Math.min(4.4, 2.4 + rate * 0.04));

    if (item.spiking) {
      // White glow halo
      ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
      ctx.beginPath();
      ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = item.spiking ? "#ffffff" : baseColor;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    if (isHovered || isSelected) {
      ctx.strokeStyle = isSelected ? "#ffd32a" : "#ffffff";
      ctx.lineWidth = isSelected ? 2.2 : 1.5;
      ctx.stroke();
    }
  }

  private drawSensoryMotorBar(
    telemetry: NeuralTelemetrySnapshot,
    w: number,
    h: number,
  ) {
    const ctx = this.ctx;
    const barY = h - 68;
    const barH = 58;

    ctx.fillStyle = "rgba(12, 24, 32, 0.94)";
    ctx.fillRect(10, barY, w - 20, barH);
    ctx.strokeStyle = "rgba(69, 208, 223, 0.35)";
    ctx.strokeRect(10, barY, w - 20, barH);

    const f = telemetry.sensoryFeatures;
    const m = telemetry.motorCommand;

    ctx.fillStyle = "#e6f1eb";
    ctx.font = "9px monospace";

    // Row 1: Optical Sensory Kinematics
    const loomTxt = f.isApproaching
      ? `LOOM: ${(f.loomingRate * 1000).toFixed(0)} mrad/s`
      : "LOOM: --";
    ctx.fillText(
      `AZ: ${f.azimuthDeg.toFixed(1)}° | DIST: ${f.distance.toFixed(1)}m | ${loomTxt}`,
      16,
      barY + 16,
    );

    // Row 2: Motor Decoding
    const steerTxt = `VX: ${m.vx > 0 ? "+" : ""}${m.vx.toFixed(2)} m/s`;
    const thrustTxt = `VZ: ${m.vz > 0 ? "+" : ""}${m.vz.toFixed(2)} m/s`;
    const stateTxt = `STATE: ${m.flightState} | AROUSAL: ${(m.arousal * 100).toFixed(0)}%`;
    ctx.fillStyle = m.swingTriggered ? "#ff5e7e" : "#61e89b";
    ctx.fillText(`${steerTxt} | ${thrustTxt} | ${stateTxt}`, 16, barY + 34);

    if (m.swingTriggered) {
      ctx.fillStyle = "#ff5e7e";
      ctx.font = "bold 9px monospace";
      ctx.fillText(
        `⚡ STRIKE: ${m.swingType.toUpperCase()} (${(m.swingPower * 100).toFixed(0)}%)`,
        16,
        barY + 49,
      );
    }
  }

  private drawTooltip(item: NeuronTelemetryItem, w: number, h: number) {
    const ctx = this.ctx;
    const pos =
      this.viewMode === "spatial"
        ? this.getSpatialScreenPos(item.index, w, h)
        : this.getNeuronScreenPos(item.index);

    const boxW = 215;
    const boxH = 106;
    const tx = Math.min(w - (boxW + 10), Math.max(10, pos.x + 10));
    const ty = Math.min(h - (boxH + 10), Math.max(10, pos.y - 30));

    ctx.fillStyle = "rgba(6, 14, 18, 0.96)";
    ctx.fillRect(tx, ty, boxW, boxH);
    ctx.strokeStyle = "#45d0df";
    ctx.lineWidth = 1;
    ctx.strokeRect(tx, ty, boxW, boxH);

    ctx.fillStyle = "#45d0df";
    ctx.font = "bold 10px monospace";
    ctx.fillText(`MaleCNS v1.0 [ID: ${item.bodyId}]`, tx + 8, ty + 14);

    ctx.font = "9px monospace";
    ctx.fillStyle = "#ffffff";
    const instStr = item.instance ? ` (${item.instance})` : "";
    ctx.fillText(
      `Type: ${item.type}${instStr}`.substring(0, 32),
      tx + 8,
      ty + 28,
    );

    ctx.fillStyle = "#8ba3a8";
    ctx.fillText(
      `Region: ${item.region} | Hemi: ${item.hemisphere || "unknown"}`,
      tx + 8,
      ty + 42,
    );
    ctx.fillText(
      `Transmitter: ${item.neurotransmitter || "unclear"}`,
      tx + 8,
      ty + 56,
    );

    const coordStr =
      item.coordinateType === "soma_voxel"
        ? "EM voxel soma (MaleCNS v1.0)"
        : "Coord: derived/fallback";
    ctx.fillText(coordStr, tx + 8, ty + 70);

    ctx.fillText(
      `Vm: ${item.v.toFixed(1)} mV | Rate: ${item.firingRateHz.toFixed(1)} Hz`,
      tx + 8,
      ty + 84,
    );

    ctx.fillStyle = item.spiking ? "#61e89b" : "#45d0df";
    ctx.fillText(
      `Spike: ${item.spiking ? "ACTIVE" : "RESTING"} | CLICK TO INSPECT`,
      tx + 8,
      ty + 98,
    );
  }

  private getNeuronScreenPos(idx: number): { x: number; y: number } {
    if (!this.graph) return { x: 0, y: 0 };
    const n = this.graph.neurons[idx];
    const w = this.width;

    let baseY = 58;
    if (n.region === "Protocerebrum") baseY = 138;
    else if (n.region === "CentralComplex") baseY = 208;
    else if (n.region === "Descending") baseY = 278;
    else if (n.region === "VNC") baseY = 352;

    const nx = n.pos ? n.pos[0] : 0;
    const x = w * 0.5 + nx * (w * 0.42);
    const ny = n.pos ? n.pos[1] : 0;
    const y = baseY + ny * 16;

    return { x: Math.max(18, Math.min(w - 18, x)), y: Math.max(25, y) };
  }

  private getSpatialScreenPos(
    idx: number,
    w: number,
    h: number,
  ): { x: number; y: number } {
    if (!this.graph) return { x: 0, y: 0 };
    const n = this.graph.neurons[idx];
    const cx = w * 0.5;
    const cy = h * 0.46;
    const scale = Math.min(w, h) * 0.42;

    const nx = n.pos ? n.pos[0] : 0;
    const ny = n.pos ? n.pos[1] : 0;
    const nz = n.pos ? n.pos[2] : 0;

    // Apply Y-axis rotation
    const cosR = Math.cos(this.rotY);
    const sinR = Math.sin(this.rotY);
    const rx = nx * cosR - nz * sinR;
    const rz = nx * sinR + nz * cosR;

    const x = cx + rx * scale;
    const y = cy + (ny * 0.85 - rz * 0.4) * scale;
    return { x, y };
  }
}
