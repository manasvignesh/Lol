import type {
  ConnectomeCSRGraph,
  NeuralTelemetrySnapshot,
  NeuronData,
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
  private width = 400;
  private height = 500;
  private spikeHistory: { time: number; neuronId: number }[] = [];
  private rateHistory: {
    time: number;
    optic: number;
    central: number;
    descending: number;
  }[] = [];
  private pulsePhase = 0;

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
  }

  setViewMode(mode: BrainViewMode) {
    this.viewMode = mode;
  }

  getViewMode(): BrainViewMode {
    return this.viewMode;
  }

  resize() {
    const rect = this.canvas.parentElement?.getBoundingClientRect() || {
      width: 400,
      height: 500,
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

    this.canvas.addEventListener("mousemove", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      this.checkHover(mx, my);
    });

    this.canvas.addEventListener("mouseleave", () => {
      this.hoveredNeuron = null;
    });
  }

  private checkHover(mx: number, my: number) {
    if (!this.lastTelemetry || !this.graph) return;

    let closest: NeuronTelemetryItem | null = null;
    let minDist = 18;

    for (const item of this.lastTelemetry.neurons) {
      const pos = this.getNeuronScreenPos(item.id);
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

    // Track active spikes
    const now = performance.now();
    for (const item of telemetry.neurons) {
      if (item.spiking) {
        this.spikeHistory.push({ time: now, neuronId: item.id });
      }
    }
    // Prune spikes older than 1.2s
    this.spikeHistory = this.spikeHistory.filter((s) => now - s.time < 1200);

    // Track rate history for chart
    this.rateHistory.push({
      time: now,
      optic: telemetry.regionActivity.OpticLobe || 0,
      central: telemetry.regionActivity.CentralComplex || 0,
      descending: telemetry.regionActivity.Descending || 0,
    });
    if (this.rateHistory.length > 80) this.rateHistory.shift();

    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    ctx.clearRect(0, 0, w, h);

    // Dark cyberpunk background with subtle grid
    ctx.fillStyle = "rgba(10, 18, 24, 0.95)";
    ctx.fillRect(0, 0, w, h);

    this.drawGrid(w, h);

    if (this.viewMode === "circuit") {
      this.drawCircuitView(telemetry, w, h);
    } else if (this.viewMode === "spatial") {
      this.drawSpatialView(telemetry, w, h);
    } else {
      this.drawRasterView(telemetry, w, h);
    }

    this.drawSensoryMotorBar(telemetry, w, h);

    // Draw hover tooltip
    if (this.hoveredNeuron) {
      this.drawTooltip(this.hoveredNeuron, w, h);
    }
  }

  private drawGrid(w: number, h: number) {
    const ctx = this.ctx;
    ctx.strokeStyle = "rgba(42, 75, 84, 0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < w; x += 30) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = 0; y < h; y += 30) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
  }

  /**
   * CIRCUIT FLOW VIEW: Structured hierarchy
   * Sensory (Top) -> Central/Premotor (Middle) -> Descending/Motor (Bottom)
   */
  private drawCircuitView(
    telemetry: NeuralTelemetrySnapshot,
    w: number,
    h: number,
  ) {
    const ctx = this.ctx;
    if (!this.graph) return;

    // Region labels & bounds
    const regions: {
      name: string;
      key: NeuropilRegion;
      y: number;
      color: string;
    }[] = [
      { name: "OPTIC LOBE (VPNs)", key: "OpticLobe", y: 45, color: "#45d0df" },
      {
        name: "CENTRAL COMPLEX / LAL",
        key: "CentralComplex",
        y: 145,
        color: "#61e89b",
      },
      {
        name: "DESCENDING PATHWAYS (DNs)",
        key: "Descending",
        y: 255,
        color: "#f7b731",
      },
      { name: "VNC MOTOR EFFECTORS", key: "VNC", y: 355, color: "#ff5e7e" },
    ];

    for (const r of regions) {
      const act = telemetry.regionActivity[r.key] || 0;
      ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
      ctx.font = "9px monospace";
      ctx.fillText(`${r.name}  [${act.toFixed(1)} Hz]`, 14, r.y - 12);

      ctx.strokeStyle = r.color;
      ctx.globalAlpha = 0.15;
      ctx.beginPath();
      ctx.roundRect(10, r.y - 8, w - 20, 75, 6);
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    }

    // Draw Synaptic connection flow lines (sample prominent pathways)
    ctx.lineWidth = 1.2;
    for (let i = 0; i < this.graph.neurons.length; i += 3) {
      const p1 = this.getNeuronScreenPos(i);
      const start = this.graph.indptr[i];
      const end = Math.min(start + 2, this.graph.indptr[i + 1]);

      for (let k = start; k < end; k++) {
        const post = this.graph.indices[k];
        const p2 = this.getNeuronScreenPos(post);
        const sign = this.graph.signs[k];
        const preSpiking = telemetry.neurons[i]?.spiking;

        ctx.strokeStyle =
          sign > 0 ? "rgba(97, 232, 155, 0.12)" : "rgba(255, 94, 126, 0.12)";
        if (preSpiking) {
          ctx.strokeStyle =
            sign > 0 ? "rgba(97, 232, 155, 0.8)" : "rgba(255, 94, 126, 0.8)";
        }

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
    }

    // Draw Neurons
    for (const n of telemetry.neurons) {
      const pos = this.getNeuronScreenPos(n.id);
      this.drawNeuronNode(pos.x, pos.y, n);
    }
  }

  /**
   * SPATIAL ANATOMICAL VIEW
   * Biological coordinates (microns) projected to 2D
   */
  private drawSpatialView(
    telemetry: NeuralTelemetrySnapshot,
    w: number,
    h: number,
  ) {
    const ctx = this.ctx;
    if (!this.graph) return;

    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.font = "10px monospace";
    ctx.fillText("DROSOPHILA MALECNS v1.0 ANATOMICAL GRAPH", 14, 25);

    // Draw synapses
    for (let i = 0; i < this.graph.neurons.length; i++) {
      const p1 = this.getSpatialScreenPos(i, w, h);
      const start = this.graph.indptr[i];
      const end = this.graph.indptr[i + 1];

      for (let k = start; k < end; k++) {
        const post = this.graph.indices[k];
        const p2 = this.getSpatialScreenPos(post, w, h);
        const preSpike = telemetry.neurons[i]?.spiking;

        ctx.strokeStyle = preSpike
          ? "rgba(255, 255, 255, 0.7)"
          : "rgba(69, 208, 223, 0.08)";
        ctx.lineWidth = preSpike ? 1.5 : 0.8;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
    }

    // Draw Neurons
    for (const n of telemetry.neurons) {
      const pos = this.getSpatialScreenPos(n.id, w, h);
      this.drawNeuronNode(pos.x, pos.y, n);
    }
  }

  /**
   * RASTER & FIRING RATE OSCILLOSCOPE VIEW
   */
  private drawRasterView(
    telemetry: NeuralTelemetrySnapshot,
    w: number,
    h: number,
  ) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.font = "10px monospace";
    ctx.fillText("REAL-TIME SPIKE RASTER & POPULATION DYNAMICS", 14, 25);

    const now = performance.now();
    const chartY = 40;
    const chartH = 180;

    // Draw spike dots
    ctx.fillStyle = "rgba(69, 208, 223, 0.8)";
    for (const spike of this.spikeHistory) {
      const age = (now - spike.time) / 1200; // 0 to 1
      const x = w - 20 - age * (w - 40);
      const y =
        chartY +
        (spike.neuronId / (this.graph?.neurons.length || 172)) * chartH;
      ctx.fillRect(x, y, 2, 2);
    }

    // Rate curves (Optic, Central, Descending)
    const curveY = chartY + chartH + 30;
    const curveH = 100;

    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.strokeRect(20, curveY, w - 40, curveH);

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
        const x = 20 + (i / Math.max(1, rates.length - 1)) * (w - 40);
        const val = Math.min(100, rates[i]) / 100;
        const y = curveY + curveH - val * curveH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.font = "9px monospace";
      ctx.fillText(`${label}`, 24 + offsetIdx * 90, curveY - 6);
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

  private drawNeuronNode(x: number, y: number, item: NeuronTelemetryItem) {
    const ctx = this.ctx;
    const isHovered = this.hoveredNeuron?.id === item.id;
    const rate = item.firingRateHz;

    let baseColor = "#45d0df";
    if (item.region === "CentralComplex") baseColor = "#61e89b";
    else if (item.region === "Protocerebrum") baseColor = "#a55eea";
    else if (item.region === "Descending") baseColor = "#f7b731";
    else if (item.region === "VNC") baseColor = "#ff5e7e";

    const radius = isHovered
      ? 6
      : item.spiking
        ? 5
        : Math.max(2.5, Math.min(4.5, 2.5 + rate * 0.05));

    if (item.spiking) {
      // Glow halo
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      ctx.beginPath();
      ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = item.spiking ? "#ffffff" : baseColor;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    if (isHovered) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  private drawSensoryMotorBar(
    telemetry: NeuralTelemetrySnapshot,
    w: number,
    h: number,
  ) {
    const ctx = this.ctx;
    const barY = h - 65;
    const barH = 55;

    ctx.fillStyle = "rgba(16, 28, 36, 0.9)";
    ctx.fillRect(10, barY, w - 20, barH);
    ctx.strokeStyle = "rgba(69, 208, 223, 0.3)";
    ctx.strokeRect(10, barY, w - 20, barH);

    const f = telemetry.sensoryFeatures;
    const m = telemetry.motorCommand;

    ctx.fillStyle = "#e6f1eb";
    ctx.font = "9px monospace";

    // Row 1: Sensory
    const loomTxt = f.isApproaching
      ? `LOOM: ${(f.loomingRate * 1000).toFixed(0)} mrad/s`
      : "LOOM: --";
    ctx.fillText(
      `AZ: ${f.azimuthDeg.toFixed(1)}° | DIST: ${f.distance.toFixed(1)}m | ${loomTxt}`,
      16,
      barY + 16,
    );

    // Row 2: Motor
    const steerTxt = `VX: ${m.vx > 0 ? "+" : ""}${m.vx.toFixed(2)} m/s`;
    const thrustTxt = `VZ: ${m.vz > 0 ? "+" : ""}${m.vz.toFixed(2)} m/s`;
    const stateTxt = `STATE: ${m.flightState} | AROUSAL: ${(m.arousal * 100).toFixed(0)}%`;
    ctx.fillStyle = m.swingTriggered ? "#ff5e7e" : "#61e89b";
    ctx.fillText(`${steerTxt} | ${thrustTxt} | ${stateTxt}`, 16, barY + 36);

    if (m.swingTriggered) {
      ctx.fillStyle = "#ff5e7e";
      ctx.font = "bold 9px monospace";
      ctx.fillText(
        `⚡ STRIKE: ${m.swingType.toUpperCase()} (${(m.swingPower * 100).toFixed(0)}%)`,
        16,
        barY + 48,
      );
    }
  }

  private drawTooltip(item: NeuronTelemetryItem, w: number, h: number) {
    const ctx = this.ctx;
    const pos =
      this.viewMode === "spatial"
        ? this.getSpatialScreenPos(item.id, w, h)
        : this.getNeuronScreenPos(item.id);

    const tx = Math.min(w - 170, Math.max(10, pos.x + 10));
    const ty = Math.min(h - 90, Math.max(10, pos.y - 30));

    ctx.fillStyle = "rgba(5, 12, 16, 0.95)";
    ctx.fillRect(tx, ty, 160, 72);
    ctx.strokeStyle = "#45d0df";
    ctx.lineWidth = 1;
    ctx.strokeRect(tx, ty, 160, 72);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 10px monospace";
    ctx.fillText(`${item.name} (${item.type})`, tx + 8, ty + 16);

    ctx.font = "9px monospace";
    ctx.fillStyle = "#8ba3a8";
    ctx.fillText(
      `Region: ${item.region} (${item.hemisphere})`,
      tx + 8,
      ty + 30,
    );
    ctx.fillText(`Transmitter: ${item.neurotransmitter}`, tx + 8, ty + 44);
    ctx.fillText(
      `Vm: ${item.v.toFixed(1)} mV | Rate: ${item.firingRateHz.toFixed(1)} Hz`,
      tx + 8,
      ty + 58,
    );
  }

  private getNeuronScreenPos(id: number): { x: number; y: number } {
    if (!this.graph) return { x: 0, y: 0 };
    const n = this.graph.neurons[id];
    const w = this.width;

    let baseY = 65;
    if (n.region === "CentralComplex") baseY = 165;
    else if (n.region === "Protocerebrum") baseY = 205;
    else if (n.region === "Descending") baseY = 275;
    else if (n.region === "VNC") baseY = 375;

    // Distribute horizontally by hemisphere and ID offset
    const regionNeurons = this.graph.neurons.filter(
      (rn) => rn.region === n.region,
    );
    const idxInRegion = regionNeurons.findIndex((rn) => rn.id === id);
    const totalInRegion = Math.max(1, regionNeurons.length);

    const margin = 28;
    const step = (w - margin * 2) / (totalInRegion + 1);
    const x = margin + (idxInRegion + 1) * step;
    const y = baseY + (idxInRegion % 2 === 0 ? -12 : 12);

    return { x, y };
  }

  private getSpatialScreenPos(
    id: number,
    w: number,
    h: number,
  ): { x: number; y: number } {
    if (!this.graph) return { x: 0, y: 0 };
    const n = this.graph.neurons[id];
    // Biological coordinates span roughly: X: [-250, 250], Y: [-80, 160], Z: [-80, 180]
    const cx = w * 0.5;
    const cy = h * 0.45;
    const scale = Math.min(w, h) / 550;

    const x = cx + n.position[0] * scale;
    const y = cy - (n.position[1] * 0.7 + n.position[2] * 0.4) * scale;
    return { x, y };
  }
}
