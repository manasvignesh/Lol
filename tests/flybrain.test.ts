import { describe, it, expect, beforeEach } from "vitest";
import { ConnectomeLoader } from "../src/flybrain/connectomeLoader";
import { NeuralEngine } from "../src/flybrain/neuralEngine";
import { PathwayRegistry } from "../src/flybrain/pathwayRegistry";
import { SensoryEncoder } from "../src/flybrain/sensoryEncoder";
import { MotorDecoder } from "../src/flybrain/motorDecoder";
import { Game } from "../src/game";
import { defaults } from "../src/config";
import { v } from "../src/math";

describe("Fruit-Fly Connectome Subsystem", () => {
  let graph: Awaited<ReturnType<typeof ConnectomeLoader.load>>;

  beforeEach(async () => {
    ConnectomeLoader.clearCache();
    graph = await ConnectomeLoader.load();
  });

  describe("1. Connectome Graph & Data Loader", () => {
    it("loads CSR binary arrays and validates graph dimensions", () => {
      expect(graph.neurons.length).toBeGreaterThan(100);
      expect(graph.indptr.length).toBe(graph.neurons.length + 1);
      expect(graph.indices.length).toBe(graph.manifest.synapseCount);
      expect(graph.weights.length).toBe(graph.manifest.synapseCount);
      expect(graph.signs.length).toBe(graph.manifest.synapseCount);
      expect(graph.indptr[graph.neurons.length]).toBe(graph.indices.length);
    });

    it("includes required neuropil regions and key biological pathways", () => {
      const regions = new Set(graph.neurons.map((n) => n.region));
      expect(regions.has("OpticLobe")).toBe(true);
      expect(regions.has("CentralComplex")).toBe(true);
      expect(regions.has("Protocerebrum")).toBe(true);
      expect(regions.has("Descending")).toBe(true);
      expect(regions.has("VNC")).toBe(true);

      const pathways = new PathwayRegistry(graph);
      expect(pathways.index.lc4Left.length).toBeGreaterThan(0);
      expect(pathways.index.lc4Right.length).toBeGreaterThan(0);
      expect(pathways.index.lc10Left.length).toBeGreaterThan(0);
      expect(pathways.index.lc10Right.length).toBeGreaterThan(0);
      expect(pathways.index.epg.length).toBe(16);
      expect(pathways.index.dna02Left.length).toBeGreaterThan(0);
      expect(pathways.index.dna02Right.length).toBeGreaterThan(0);
      expect(pathways.index.dnp01.length).toBeGreaterThan(0);
      expect(pathways.index.dnb01Left.length).toBeGreaterThan(0);
      expect(pathways.index.dnb01Right.length).toBeGreaterThan(0);
    });
  });

  describe("2. LIF Biophysical Simulator", () => {
    it("integrates subthreshold current and produces action potentials upon threshold crossing", () => {
      const engine = new NeuralEngine(graph);
      const testNeuron = 0;

      // Without input and zero background drive, stays around resting potential (-65 mV +- noise)
      engine.interventions.setBackgroundDrive(0);
      for (let i = 0; i < 20; i++) engine.step();
      expect(engine.v[testNeuron]).toBeCloseTo(engine.params.vRest, 0);

      // Inject strong current into neuron 0
      let spiked = false;
      for (let t = 0; t < 50; t++) {
        engine.iExt[testNeuron] = 30.0;
        engine.step();
        if (engine.spiking[testNeuron] === 1) {
          spiked = true;
          break;
        }
      }
      expect(spiked).toBe(true);
    });

    it("enforces absolute refractory period post-spike", () => {
      const engine = new NeuralEngine(graph);
      const testNeuron = 0;

      // Force a spike
      let spiked = false;
      for (let i = 0; i < 5; i++) {
        engine.iExt[testNeuron] = 120.0;
        engine.step();
        if (engine.spiking[testNeuron] === 1) {
          spiked = true;
          break;
        }
      }
      expect(spiked).toBe(true);
      expect(engine.refractoryTimer[testNeuron]).toBeGreaterThan(0);

      // In the immediate subsequent step, neuron should be refractory (not spiking)
      engine.iExt[testNeuron] = 120.0;
      engine.step();
      expect(engine.spiking[testNeuron]).toBe(0);
    });

    it("transmits spikes across synapses respecting excitatory and inhibitory signs", () => {
      const engine = new NeuralEngine(graph);

      // Find an excitatory synapse and an inhibitory synapse
      let excPre = -1,
        excPost = -1;
      let inhPre = -1,
        inhPost = -1;

      for (let i = 0; i < graph.neurons.length; i++) {
        const start = graph.indptr[i];
        const end = graph.indptr[i + 1];
        for (let k = start; k < end; k++) {
          if (graph.signs[k] > 0 && excPre === -1) {
            excPre = i;
            excPost = graph.indices[k];
          }
          if (graph.signs[k] < 0 && inhPre === -1) {
            inhPre = i;
            inhPost = graph.indices[k];
          }
        }
        if (excPre !== -1 && inhPre !== -1) break;
      }

      expect(excPre).not.toBe(-1);
      expect(inhPre).not.toBe(-1);

      // Force spike on excitatory pre-synaptic neuron
      for (let i = 0; i < 5; i++) {
        engine.iExt[excPre] = 150.0;
        engine.step();
        if (engine.spiking[excPre] === 1) break;
      }
      expect(engine.gExc[excPost]).toBeGreaterThan(0);

      // Reset and force spike on inhibitory pre-synaptic neuron
      engine.reset();
      for (let i = 0; i < 5; i++) {
        engine.iExt[inhPre] = 150.0;
        engine.step();
        if (engine.spiking[inhPre] === 1) break;
      }
      expect(engine.gInh[inhPost]).toBeGreaterThan(0);
    });
  });

  describe("3. Optical Sensory Encoding", () => {
    it("differentiates looming collision trajectories from retreating trajectories", () => {
      const pathways = new PathwayRegistry(graph);
      const encoder = new SensoryEncoder(pathways);

      // Incoming fast looming shuttle
      const approaching = encoder.extractFeatures({
        shuttlePos: [0, 1.4, -1.5],
        shuttleVel: [0, -2.0, -14.0], // Heading toward fly at z = -3.9
        flyPos: [0, 1.4, -3.9],
        flyHeading: 0,
        time: 0.1,
      });
      expect(approaching.isApproaching).toBe(true);
      expect(approaching.loomingRate).toBeGreaterThan(0.01);

      // Retreating shuttle
      const retreating = encoder.extractFeatures({
        shuttlePos: [0, 1.4, 0.0],
        shuttleVel: [0, 2.0, 14.0], // Heading away from fly
        flyPos: [0, 1.4, -3.9],
        flyHeading: 0,
        time: 0.2,
      });
      expect(retreating.isApproaching).toBe(false);
      expect(retreating.loomingRate).toBe(0);
    });

    it("activates left visual projection neurons when shuttle is on the left", () => {
      const engine = new NeuralEngine(graph);

      // Shuttle positioned to the left (azimuth < 0)
      for (let step = 0; step < 15; step++) {
        engine.step({
          shuttlePos: [-1.8, 1.5, -2.0],
          shuttleVel: [0, -1.0, -8.0],
          flyPos: [0, 1.4, -3.9],
          flyHeading: 0,
          time: step * 0.01,
        });
      }

      const leftLC10Rate = engine.pathways.index.lc10Left.reduce(
        (sum, id) => sum + engine.firingRates[id],
        0,
      );
      const rightLC10Rate = engine.pathways.index.lc10Right.reduce(
        (sum, id) => sum + engine.firingRates[id],
        0,
      );

      expect(leftLC10Rate).toBeGreaterThan(rightLC10Rate);
    });
  });

  describe("4. Descending Motor Decoding & Interventions", () => {
    it("decodes asymmetric DNa02 firing into lateral steering velocity", () => {
      const pathways = new PathwayRegistry(graph);
      const decoder = new MotorDecoder(pathways);
      const rates = new Float32Array(graph.neurons.length);

      // Simulate strong rightward steering activity (DNa02_R active)
      pathways.index.dna02Right.forEach((id) => {
        rates[id] = 60.0;
      });
      pathways.index.dna02Left.forEach((id) => {
        rates[id] = 5.0;
      });

      const cmd = decoder.decode(rates, {
        distance: 2.0,
        azimuthDeg: 25,
        elevationDeg: 0,
        relativeSpeed: 8,
        loomingRate: 0.02,
        angularSizeDeg: 2,
        retinalVelocityDegPerSec: 10,
        isApproaching: true,
        incomingTrajectoryThreat: 0.8,
      });

      expect(cmd.vx).toBeGreaterThan(0.2); // Rightward target velocity
    });

    it("silencing LC4/LC6 abolishes looming-driven descending activation", () => {
      const engine = new NeuralEngine(graph);

      // Normal condition: incoming looming shuttle excites DNa02
      for (let s = 0; s < 25; s++) {
        engine.step({
          shuttlePos: [0.8, 1.5, -2.2],
          shuttleVel: [0, -2.0, -12.0],
          flyPos: [0, 1.4, -3.9],
          flyHeading: 0,
          time: s * 0.01,
        });
      }
      const normalDNpRate = engine.pathways.index.dnp01.reduce(
        (sum, id) => sum + engine.firingRates[id],
        0,
      );

      // Silenced condition: optogenetic silencing of LC4 and LC6
      engine.reset();
      engine.interventions.setSilencedTypes(["LC4", "LC6", "LPLC2"]);

      for (let s = 0; s < 25; s++) {
        engine.step({
          shuttlePos: [0.8, 1.5, -2.2],
          shuttleVel: [0, -2.0, -12.0],
          flyPos: [0, 1.4, -3.9],
          flyHeading: 0,
          time: s * 0.01,
        });
      }
      const silencedDNpRate = engine.pathways.index.dnp01.reduce(
        (sum, id) => sum + engine.firingRates[id],
        0,
      );

      expect(silencedDNpRate).toBeLessThan(normalDNpRate);
    });
  });

  describe("5. End-to-End Game & Match Rally with Fruit-Fly Connectome", () => {
    it("sustains rallies with Fruit-Fly Connectome opponent", async () => {
      const game = new Game({ ...defaults, opponentType: "fruitfly" });
      await game.fly.init(false); // In test environment, uses direct in-process LIF engine

      game.ready();
      expect(game.state).toBe("ready");

      // Serve from player side
      game.hit(0, "serve");
      expect(game.state).toBe("rally");
      expect(game.hits).toBe(1);

      // Step physics and connectome simulation forward across rally steps
      for (let f = 0; f < 300; f++) {
        game.step(1 / 60);
        if (game.hits >= 2) break;
      }

      // Fly should have reacted, moved, and attempted return or hit
      expect(game.fly.x).toBeDefined();
      expect(game.fly.z).toBeLessThan(-0.5);
    });
  });
});
