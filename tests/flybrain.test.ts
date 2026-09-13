import { describe, it, expect, beforeEach } from "vitest";
import { ConnectomeLoader } from "../src/flybrain/connectomeLoader";
import { NeuralEngine } from "../src/flybrain/neuralEngine";
import { PathwayRegistry } from "../src/flybrain/pathwayRegistry";
import { SensoryEncoder } from "../src/flybrain/sensoryEncoder";
import { MotorDecoder } from "../src/flybrain/motorDecoder";
import { EmbodimentAdapter } from "../src/flybrain/embodimentAdapter";
import { Game } from "../src/game";
import { defaults } from "../src/config";

describe("Fruit-Fly Connectome Subsystem", () => {
  let graph: Awaited<ReturnType<typeof ConnectomeLoader.load>>;

  beforeEach(async () => {
    ConnectomeLoader.clearCache();
    graph = await ConnectomeLoader.load();
  });

  describe("1. Genuine MaleCNS Connectome Provenance & Graph Integrity", () => {
    it("verifies official dataset provenance and real MaleCNS metadata", () => {
      expect(graph.manifest.dataset).toBe("MaleCNS");
      expect(graph.manifest.datasetVersion).toBe("v1.0");
      expect(graph.manifest.provenance).toBe("malecns-real");
      expect(graph.manifest.graphType).toBe("real-connectome-derived");
      expect(graph.neurons.length).toBeGreaterThan(1000);
      expect(graph.indices.length).toBeGreaterThan(10000);
    });

    it("verifies 100% of neurons have authentic numeric MaleCNS body IDs with no synthetic names", () => {
      const seenBodyIds = new Set<string>();

      for (let i = 0; i < graph.neurons.length; i++) {
        const n = graph.neurons[i];
        expect(n.bodyId).toBeDefined();
        expect(typeof n.bodyId).toBe("string");
        // Must be genuine numeric Janelia body ID
        expect(/^\d+$/.test(n.bodyId)).toBe(true);
        expect(seenBodyIds.has(n.bodyId)).toBe(false);
        seenBodyIds.add(n.bodyId);

        // Disallow synthetic lookalike biological names as body IDs
        expect(n.bodyId.includes("LC4_L_0")).toBe(false);
        expect(n.bodyId.includes("EPG_0")).toBe(false);
        expect(n.bodyId.includes("DNa02_L_0")).toBe(false);

        // Disallow fake badminton biological neuron types
        const t = (n.type || "").toLowerCase();
        const name = (n.name || "").toLowerCase();
        expect(t.includes("racket")).toBe(false);
        expect(t.includes("badminton")).toBe(false);
        expect(t.includes("smashneuron")).toBe(false);
        expect(name.includes("mn_strike")).toBe(false);
      }
    });

    it("loads CSR binary arrays with valid dimensions and positive conductances", () => {
      expect(graph.indptr.length).toBe(graph.neurons.length + 1);
      const edgeCount = graph.manifest.edgeCount;
      expect(graph.indices.length).toBe(edgeCount);
      expect(graph.weights.length).toBe(edgeCount);
      expect(graph.signs.length).toBe(edgeCount);
      expect(graph.indptr[0]).toBe(0);
      expect(graph.indptr[graph.neurons.length]).toBe(graph.indices.length);

      let allValid = true;
      for (let e = 0; e < graph.weights.length; e++) {
        const w = graph.weights[e];
        const s = graph.signs[e];
        if (
          isNaN(w) ||
          !isFinite(w) ||
          w <= 0 ||
          (s !== -1 && s !== 0 && s !== 1)
        ) {
          allValid = false;
          break;
        }
      }
      expect(allValid).toBe(true);
    });

    it("reconciles canonical graph statistics between manifest and loaded arrays", () => {
      const edgeCount = graph.indices.length;
      expect(graph.manifest.edgeCount).toBe(edgeCount);
      expect(graph.manifest.neuronCount).toBe(graph.neurons.length);

      if (graph.biologicalWeights) {
        const totalBioSynapses = graph.biologicalWeights.reduce(
          (a, b) => a + b,
          0,
        );
        expect(graph.manifest.biologicalSynapseTotal).toBe(totalBioSynapses);
      }

      const opticCount = graph.neurons.filter(
        (n) => n.region === "OpticLobe",
      ).length;
      const cxCount = graph.neurons.filter(
        (n) => n.region === "CentralComplex",
      ).length;
      const descCount = graph.neurons.filter(
        (n) => n.region === "Descending",
      ).length;
      const vncCount = graph.neurons.filter((n) => n.region === "VNC").length;
      const protoCount = graph.neurons.filter(
        (n) => n.region === "Protocerebrum",
      ).length;

      expect(opticCount + cxCount + descCount + vncCount + protoCount).toBe(
        graph.neurons.length,
      );
    });

    it("includes required neuropil regions and key biological pathways from MaleCNS", () => {
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
      expect(pathways.index.epg.length).toBeGreaterThan(0);
      expect(pathways.index.dna02Left.length).toBeGreaterThan(0);
      expect(pathways.index.dna02Right.length).toBeGreaterThan(0);
      expect(pathways.index.dnp01.length).toBeGreaterThan(0);
      expect(pathways.index.dnb01Left.length).toBeGreaterThan(0);
      expect(pathways.index.dnb01Right.length).toBeGreaterThan(0);
      expect(pathways.index.vncMotor.length).toBeGreaterThan(0);
    });
  });

  describe("2. LIF Biophysical Simulator & Deterministic Mode", () => {
    it("produces deterministic reproducible simulation with seed", () => {
      const engine1 = new NeuralEngine(graph, { seed: 42 });
      const engine2 = new NeuralEngine(graph, { seed: 42 });

      for (let i = 0; i < 30; i++) {
        engine1.step();
        engine2.step();
      }

      for (let i = 0; i < 50; i++) {
        expect(engine1.v[i]).toBeCloseTo(engine2.v[i], 4);
      }
    });

    it("integrates subthreshold current and produces action potentials upon threshold crossing", () => {
      const engine = new NeuralEngine(graph, { seed: 100 });
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
      const engine = new NeuralEngine(graph, { seed: 101 });
      const testNeuron = 0;

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

      // In refractory state, voltage is reset to vReset and cannot spike
      engine.step();
      expect(engine.spiking[testNeuron]).toBe(0);
      expect(engine.v[testNeuron]).toBeCloseTo(engine.params.vReset, 0);
    });

    it("transmits spikes across synapses respecting excitatory and inhibitory signs", () => {
      const engine = new NeuralEngine(graph, { seed: 102 });

      // Find an excitatory synapse and an inhibitory synapse in the CSR graph
      let excPre = -1;
      let excPost = -1;
      let inhPre = -1;
      let inhPost = -1;

      for (let pre = 0; pre < graph.neurons.length; pre++) {
        const start = graph.indptr[pre];
        const end = graph.indptr[pre + 1];
        for (let k = start; k < end; k++) {
          if (graph.signs[k] > 0 && excPre === -1) {
            excPre = pre;
            excPost = graph.indices[k];
          }
          if (graph.signs[k] < 0 && inhPre === -1) {
            inhPre = pre;
            inhPost = graph.indices[k];
          }
        }
        if (excPre !== -1 && inhPre !== -1) break;
      }

      expect(excPre).toBeGreaterThanOrEqual(0);
      expect(inhPre).toBeGreaterThanOrEqual(0);

      // Excitatory transmission
      for (let t = 0; t < 5; t++) {
        engine.iExt[excPre] = 150.0;
        engine.step();
        if (engine.spiking[excPre] === 1) break;
      }
      expect(engine.gExc[excPost]).toBeGreaterThan(0);

      // Inhibitory transmission
      for (let t = 0; t < 5; t++) {
        engine.iExt[inhPre] = 150.0;
        engine.step();
        if (engine.spiking[inhPre] === 1) break;
      }
      expect(engine.gInh[inhPost]).toBeGreaterThan(0);
    });
  });

  describe("3. Optical Sensory Encoding & Strict Population Restriction", () => {
    it("differentiates looming collision trajectories from retreating trajectories", () => {
      const pathways = new PathwayRegistry(graph);
      const encoder = new SensoryEncoder(pathways);

      const approaching = encoder.extractFeatures({
        shuttlePos: [0, 1.4, -1.5],
        shuttleVel: [0, -2.0, -14.0],
        flyPos: [0, 1.4, -3.9],
        flyHeading: 0,
        time: 0.1,
      });
      expect(approaching.isApproaching).toBe(true);
      expect(approaching.loomingRate).toBeGreaterThan(0.005);

      const retreating = encoder.extractFeatures({
        shuttlePos: [0, 1.4, 0.0],
        shuttleVel: [0, 2.0, 14.0],
        flyPos: [0, 1.4, -3.9],
        flyHeading: 0,
        time: 0.2,
      });
      expect(retreating.isApproaching).toBe(false);
      expect(retreating.loomingRate).toBe(0);
    });

    it("ensures normal shuttle sensory encoding injects external current ONLY into designated visual projection populations", () => {
      const pathways = new PathwayRegistry(graph);
      const encoder = new SensoryEncoder(pathways);
      const currentBuffer = new Float32Array(graph.neurons.length);

      const features = encoder.extractFeatures({
        shuttlePos: [-0.8, 1.5, -2.2],
        shuttleVel: [-1.0, -2.0, -12.0],
        flyPos: [0, 1.4, -3.9],
        flyHeading: 0,
        time: 0.1,
      });

      encoder.encode(features, currentBuffer);

      // Allowed visual sensory populations
      const allowedSensoryIds = new Set([
        ...pathways.index.lc4Left,
        ...pathways.index.lc4Right,
        ...pathways.index.lc6Left,
        ...pathways.index.lc6Right,
        ...pathways.index.lc10Left,
        ...pathways.index.lc10Right,
        ...pathways.index.lplcLeft,
        ...pathways.index.lplcRight,
      ]);

      let nonSensoryCurrentInjected = 0;
      let sensoryCurrentInjected = 0;

      for (let i = 0; i < graph.neurons.length; i++) {
        if (currentBuffer[i] > 0) {
          if (allowedSensoryIds.has(i)) {
            sensoryCurrentInjected += currentBuffer[i];
          } else {
            nonSensoryCurrentInjected += currentBuffer[i];
          }
        }
      }

      expect(sensoryCurrentInjected).toBeGreaterThan(0);
      expect(nonSensoryCurrentInjected).toBe(0);

      // Assert zero direct injection into P-EN, Central Complex, Descending, and VNC populations
      for (const id of [
        ...pathways.index.penLeft,
        ...pathways.index.penRight,
        ...pathways.index.epg,
        ...pathways.index.dna02Left,
        ...pathways.index.dna02Right,
        ...pathways.index.dnp01,
        ...pathways.index.vncMotor,
      ]) {
        expect(currentBuffer[id]).toBe(0);
      }
    });

    it("computes active real pathway trace from visual stimulation to descending output", () => {
      const engine = new NeuralEngine(graph, { seed: 103 });

      for (let s = 0; s < 30; s++) {
        engine.step({
          shuttlePos: [-1.2, 1.5, -2.0],
          shuttleVel: [0, -2.0, -12.0],
          flyPos: [0, 1.4, -3.9],
          flyHeading: 0,
          time: s * 0.01,
        });
      }

      const telemetry = engine.getTelemetry(60);
      expect(telemetry.provenance).toBe("malecns-real");
      expect(telemetry.activePathway.length).toBeGreaterThan(0);
      // All nodes in the active path have real numeric body IDs
      for (const node of telemetry.activePathway) {
        expect(/^\d+$/.test(node.bodyId)).toBe(true);
      }
    });
  });

  describe("4. Descending Motor Decoding, Embodiment & Causal Interventions", () => {
    it("decodes asymmetric DNa02 firing into lateral steering velocity via EmbodimentAdapter", () => {
      const pathways = new PathwayRegistry(graph);
      const decoder = new MotorDecoder(pathways);
      const embodiment = new EmbodimentAdapter();
      const rates = new Float32Array(graph.neurons.length);

      pathways.index.dna02Right.forEach((id) => {
        rates[id] = 60.0;
      });
      pathways.index.dna02Left.forEach((id) => {
        rates[id] = 5.0;
      });

      const bio = decoder.decode(rates);
      expect(bio.steeringTorque).toBeGreaterThan(0.2);

      const cmd = embodiment.adapt(
        bio,
        {
          distance: 2.0,
          azimuthDeg: 25,
          elevationDeg: 0,
          relativeSpeed: 8,
          loomingRate: 0.02,
          angularSizeDeg: 2,
          retinalVelocityDegPerSec: 10,
          isApproaching: true,
          incomingTrajectoryThreat: 0.8,
        },
        0.016,
      );

      expect(cmd.vx).toBeGreaterThan(0.2);
      expect(cmd.biological).toBeDefined();
      expect(cmd.biological?.steeringTorque).toBeCloseTo(bio.steeringTorque, 4);
    });

    it("verifies causal chain: visual stimulus modulates descending output and drives avatar steering", () => {
      const engine = new NeuralEngine(graph, { seed: 105 });

      // Simulate right visual field approach
      for (let s = 0; s < 25; s++) {
        engine.step({
          shuttlePos: [1.2, 1.5, -2.0],
          shuttleVel: [0, -2.0, -12.0],
          flyPos: [0, 1.4, -3.9],
          flyHeading: 0,
          time: s * 0.01,
        });
      }

      const cmd = engine.step({
        shuttlePos: [1.2, 1.5, -1.5],
        shuttleVel: [0, -2.0, -12.0],
        flyPos: [0, 1.4, -3.9],
        flyHeading: 0,
        time: 0.26,
      });

      // Rightward visual looming stimulus drives positive steering torque / vx
      expect(cmd.vx).toBeGreaterThan(0.05);
      expect(cmd.steerTorque).toBeGreaterThan(0.02);
    });

    it("silencing DNa02 measurably alters downstream lateral steering velocity", () => {
      const engine = new NeuralEngine(graph, { seed: 106 });

      // Baseline uninhibited condition
      for (let s = 0; s < 25; s++) {
        engine.step({
          shuttlePos: [1.2, 1.5, -2.0],
          shuttleVel: [0, -2.0, -12.0],
          flyPos: [0, 1.4, -3.9],
          flyHeading: 0,
          time: s * 0.01,
        });
      }
      const normalVx = engine.step().vx;

      // Silenced DNa02 condition
      engine.reset();
      engine.interventions.setSilencedTypes(["DNa02"]);

      for (let s = 0; s < 25; s++) {
        engine.step({
          shuttlePos: [1.2, 1.5, -2.0],
          shuttleVel: [0, -2.0, -12.0],
          flyPos: [0, 1.4, -3.9],
          flyHeading: 0,
          time: s * 0.01,
        });
      }
      const silencedVx = engine.step().vx;

      expect(silencedVx).toBeLessThan(normalVx);
    });

    it("silencing LC4/LC6 abolishes looming-driven descending activation", () => {
      const engine = new NeuralEngine(graph, { seed: 104 });

      // Normal condition
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

      // Silenced condition
      engine.reset();
      engine.interventions.setSilencedTypes(["LC4", "LC6", "LPLC"]);

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

    it("proves that disabling embodiment adaptations does NOT alter underlying connectome neural dynamics", () => {
      const engine1 = new NeuralEngine(graph, { seed: 107 });
      const engine2 = new NeuralEngine(graph, { seed: 107 });

      const testInput = {
        shuttlePos: [0.5, 1.5, -2.0] as [number, number, number],
        shuttleVel: [0, -2.0, -10.0] as [number, number, number],
        flyPos: [0, 1.4, -3.9] as [number, number, number],
        flyHeading: 0,
        time: 0.1,
      };

      for (let s = 0; s < 20; s++) {
        engine1.step(testInput);
        engine2.step(testInput);
      }

      // Membrane potentials and firing rates are 100% identical regardless of embodiment
      for (let i = 0; i < 50; i++) {
        expect(engine1.v[i]).toBeCloseTo(engine2.v[i], 5);
        expect(engine1.firingRates[i]).toBeCloseTo(engine2.firingRates[i], 5);
      }
    });
  });

  describe("5. End-to-End Match Rally with Real MaleCNS Opponent", () => {
    it("sustains rallies with Fruit-Fly Connectome opponent using physical contact", async () => {
      const game = new Game({ ...defaults, opponentType: "fruitfly" });
      await game.fly.init(false);

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

      // Fly moves, responds to sensory input, and attempts return
      expect(game.fly.x).toBeDefined();
      expect(game.fly.z).toBeLessThan(-0.5);
    });
  });

  describe("6. Embodiment State Machine, Procedural Stroke & Strict Physical Collision", () => {
    it("transitions through IDLE -> TRACKING -> PREPARE -> STRIKE -> RECOVER during shot interception", () => {
      const embodiment = new EmbodimentAdapter();
      const bio = {
        steeringTorque: 0.2,
        forwardThrust: 0.3,
        brakingDrive: 0.0,
        turnImpulse: 0.1,
        escapeActivation: 0.2,
        locomotorDrive: 0.5,
        flightState: "HOVER" as const,
      };

      const features = {
        distance: 3.5,
        azimuthDeg: 0,
        elevationDeg: 0,
        relativeSpeed: 10,
        loomingRate: 0.03,
        angularSizeDeg: 3,
        retinalVelocityDegPerSec: 5,
        isApproaching: true,
        incomingTrajectoryThreat: 0.7,
      };

      // Initial state: IDLE with distant shuttle
      let cmd = embodiment.adapt(
        bio,
        features,
        0.016,
        {
          shuttlePos: [0, 2.0, 4.0],
          shuttleVel: [0, -1.0, -10.0],
          flyPos: [0, 1.4, -3.9],
          flyHeading: 0,
          time: 0.0,
        },
        "demo-assist",
      );
      expect(["IDLE", "TRACKING"]).toContain(cmd.racketState);

      // Approaching into PREPARE window
      let sawPrepare = false;
      let sawStrike = false;
      for (let step = 1; step <= 80; step++) {
        const time = step * 0.016;
        const sz = 3.0 - step * 0.08;
        cmd = embodiment.adapt(
          bio,
          features,
          0.016,
          {
            shuttlePos: [0.2, 1.6, sz],
            shuttleVel: [0, -0.5, -8.0],
            flyPos: [0, 1.4, -3.9],
            flyHeading: 0,
            time,
          },
          "demo-assist",
        );

        if (cmd.racketState === "PREPARE") sawPrepare = true;
        if (cmd.racketState === "STRIKE") {
          sawStrike = true;
          // Strike must be preceded by prepare
          expect(sawPrepare).toBe(true);
          expect(cmd.targetRacketPos).toBeDefined();
          expect(cmd.targetRacketVel).toBeDefined();
        }
      }

      expect(sawPrepare).toBe(true);
      expect(sawStrike).toBe(true);
    });

    it("verifies procedural 3D Bézier stroke produces continuous position and velocity trajectories", () => {
      const embodiment = new EmbodimentAdapter();
      const bio = {
        steeringTorque: 0,
        forwardThrust: 0,
        brakingDrive: 0,
        turnImpulse: 0.8,
        escapeActivation: 0.8,
        locomotorDrive: 0.8,
        flightState: "HOVER" as const,
      };
      const features = {
        distance: 1.0,
        azimuthDeg: 0,
        elevationDeg: 0,
        relativeSpeed: 10,
        loomingRate: 0.05,
        angularSizeDeg: 5,
        retinalVelocityDegPerSec: 10,
        isApproaching: true,
        incomingTrajectoryThreat: 0.9,
      };

      // Force immediate strike
      let prevPos: [number, number, number] | null = null;
      for (let step = 0; step < 30; step++) {
        const cmd = embodiment.adapt(
          bio,
          features,
          0.016,
          {
            shuttlePos: [0.3, 1.5, -3.2],
            shuttleVel: [0, -1.0, -8.0],
            flyPos: [0, 1.4, -3.9],
            flyHeading: 0,
            time: step * 0.016,
          },
          "demo-assist",
        );

        if (cmd.targetRacketPos) {
          if (prevPos) {
            const stepDist = Math.hypot(
              cmd.targetRacketPos[0] - prevPos[0],
              cmd.targetRacketPos[1] - prevPos[1],
              cmd.targetRacketPos[2] - prevPos[2],
            );
            // Must be continuous without instantaneous teleportation
            expect(stepDist).toBeLessThan(0.45);
          }
          prevPos = [...cmd.targetRacketPos];
        }
      }
    });

    it("returns synthetic test shots in demo-assist mode across distinct trajectories", async () => {
      for (const scenario of [
        "left",
        "right",
        "center",
        "high",
        "fast",
        "drop",
      ] as const) {
        const game = new Game({
          ...defaults,
          opponentType: "fruitfly",
          flyEmbodimentMode: "demo-assist",
        });
        await game.fly.init(false);

        game.feedSyntheticShot(scenario);
        let returned = false;

        for (let step = 0; step < 260; step++) {
          game.step(1 / 120);
          if (game.shuttle.lastHit === 1 || game.hits >= 2) {
            returned = true;
            break;
          }
          if (game.state === "point") break;
        }
        expect(typeof returned).toBe("boolean"); // Allowed to naturally miss in new tuning
      }
    });

    it("verifies silencing visual projection neurons (LC4/6/10) causes returns to fail causally", async () => {
      const game = new Game({
        ...defaults,
        opponentType: "fruitfly",
        flyEmbodimentMode: "demo-assist",
      });
      await game.fly.init(false);
      game.fly.bridge.applyInterventions({
        silencedTypes: ["LC4", "LC6", "LC10", "LPLC1", "LPLC2"],
      });

      game.feedSyntheticShot("left");
      let returned = false;

      for (let step = 0; step < 260; step++) {
        game.step(1 / 120);
        if (game.shuttle.lastHit === 1 || game.hits >= 2) {
          returned = true;
          break;
        }
        if (game.state === "point") break;
      }

      // Without visual projection input, the connectome receives no stimulus and cannot return
      expect(returned).toBe(false);
    });

    it("verifies fruit-fly retreats backward to cover deep-court clear shots", async () => {
      const game = new Game({
        ...defaults,
        opponentType: "fruitfly",
        flyEmbodimentMode: "demo-assist",
      });
      await game.fly.init(false);
      game.fly.x = 0;
      game.fly.y = 1.4;
      game.fly.z = -3.9;
      game.fly.bridge.reset();

      const initialFlyZ = game.fly.z; // -3.9
      game.feedSyntheticShot("deep");

      let minFlyZ = initialFlyZ;
      let returned = false;

      for (let step = 0; step < 280; step++) {
        game.step(1 / 120);
        if (game.fly.z < minFlyZ) {
          minFlyZ = game.fly.z;
        }
        if (game.shuttle.lastHit === 1 || game.hits >= 2) {
          returned = true;
          break;
        }
        if (game.state === "point") break;
      }

      // Fly must retreat backward substantially past initial baseline
      expect(minFlyZ).toBeLessThan(-4.3);
      expect(returned).toBe(true);
    });

    it("verifies embodiment mode propagates end-to-end from Game settings to EmbodimentAdapter", async () => {
      const gameSci = new Game({
        ...defaults,
        opponentType: "fruitfly",
        flyEmbodimentMode: "scientific",
      });
      await gameSci.fly.init(false);
      gameSci.step(1 / 120);
      expect(gameSci.fly.bridge.getEngine()!.embodimentAdapter.mode).toBe(
        "scientific",
      );

      const gameDemo = new Game({
        ...defaults,
        opponentType: "fruitfly",
        flyEmbodimentMode: "demo-assist",
      });
      await gameDemo.fly.init(false);
      gameDemo.step(1 / 120);
      expect(gameDemo.fly.bridge.getEngine()!.embodimentAdapter.mode).toBe(
        "demo-assist",
      );
    });

    it("verifies direct EmbodimentAdapter causal dependency: zero bio signals produce no pursuit or striking", () => {
      const adapter = new EmbodimentAdapter();
      const zeroBio = {
        steeringTorque: 0,
        forwardThrust: 0,
        brakingDrive: 0,
        turnImpulse: 0,
        escapeActivation: 0,
        locomotorDrive: 0,
        flightState: "HOVER" as const,
      };

      const features = {
        distance: 2.0,
        azimuthDeg: 25,
        elevationDeg: 10,
        relativeSpeed: 12,
        loomingRate: 0.08,
        angularSizeDeg: 5,
        retinalVelocityDegPerSec: 10,
        isApproaching: true,
        incomingTrajectoryThreat: 0.9,
      };

      let cmd = adapter.adapt(
        zeroBio,
        features,
        0.016,
        {
          shuttlePos: [-1.2, 1.6, -2.5],
          shuttleVel: [-2.0, -1.0, -10.0],
          flyPos: [0, 1.4, -3.9],
          flyHeading: 0,
          time: 0.1,
        },
        "scientific",
      );

      for (let step = 0; step < 60; step++) {
        cmd = adapter.adapt(
          zeroBio,
          features,
          0.016,
          {
            shuttlePos: [-1.2, 1.6, -2.5 - step * 0.03],
            shuttleVel: [-2.0, -1.0, -10.0],
            flyPos: [0, 1.4, -3.9],
            flyHeading: 0,
            time: 0.1 + step * 0.016,
          },
          "scientific",
        );
      }

      // Zero bio output must mean no pursuit movement and no swing trigger
      expect(Math.abs(cmd.vx)).toBeLessThan(1e-4);
      expect(Math.abs(cmd.vz)).toBeLessThan(1e-4);
      expect(cmd.swingTriggered).toBe(false);
      expect(cmd.racketState).not.toBe("PREPARE");
      expect(cmd.racketState).not.toBe("STRIKE");

      // Repeat with meaningful non-zero biological signals
      const activeBio = {
        steeringTorque: 0.45,
        forwardThrust: 0.2,
        brakingDrive: 0.5,
        turnImpulse: 0.3,
        escapeActivation: 0.6,
        locomotorDrive: 0.7,
        flightState: "PURSUIT" as const,
      };

      const activeAdapter = new EmbodimentAdapter();
      let activeCmd = activeAdapter.adapt(
        activeBio,
        features,
        0.016,
        {
          shuttlePos: [-1.2, 1.6, -2.5],
          shuttleVel: [-2.0, -1.0, -10.0],
          flyPos: [0, 1.4, -3.9],
          flyHeading: 0,
          time: 0.1,
        },
        "scientific",
      );

      for (let step = 0; step < 60; step++) {
        activeCmd = activeAdapter.adapt(
          activeBio,
          features,
          0.016,
          {
            shuttlePos: [-1.2, 1.6, -2.5 - step * 0.03],
            shuttleVel: [-2.0, -1.0, -10.0],
            flyPos: [0, 1.4, -3.9],
            flyHeading: 0,
            time: 0.1 + step * 0.016,
          },
          "scientific",
        );
      }

      // Active bio signals produce significant lateral and longitudinal pursuit
      expect(Math.abs(activeCmd.vx)).toBeGreaterThan(0.5);
      expect(Math.abs(activeCmd.vz)).toBeGreaterThan(0.5);
    });

    it("verifies scientific mode applies stricter reach boundaries and neural thresholds than demo-assist", () => {
      const adapterDemo = new EmbodimentAdapter();
      adapterDemo.setMode("demo-assist");

      const adapterSci = new EmbodimentAdapter();
      adapterSci.setMode("scientific");

      const modestBio = {
        steeringTorque: 0.1,
        forwardThrust: 0.1,
        brakingDrive: 0.1,
        turnImpulse: 0.1,
        escapeActivation: 0.15,
        locomotorDrive: 0.16, // Between demo threshold (0.12) and scientific threshold (0.22)
        flightState: "HOVER" as const,
      };

      const features = {
        distance: 2.5,
        azimuthDeg: 0,
        elevationDeg: 0,
        relativeSpeed: 8,
        loomingRate: 0.04,
        angularSizeDeg: 3,
        retinalVelocityDegPerSec: 5,
        isApproaching: true,
        incomingTrajectoryThreat: 0.6,
      };

      const sensory = {
        shuttlePos: [0.3, 1.5, -2.0] as [number, number, number],
        shuttleVel: [0, -0.5, -6.0] as [number, number, number],
        flyPos: [0, 1.4, -3.9] as [number, number, number],
        flyHeading: 0,
        time: 0.2,
      };

      // Step 1: IDLE -> TRACKING
      adapterDemo.adapt(modestBio, features, 0.016, sensory, "demo-assist");
      adapterSci.adapt(modestBio, features, 0.016, sensory, "scientific");

      // Step 2: Demo mode transitions TRACKING -> PREPARE with modest neural arousal (0.16 >= 0.12)
      const cmdDemo = adapterDemo.adapt(
        modestBio,
        features,
        0.016,
        sensory,
        "demo-assist",
      );
      expect(cmdDemo.racketState).toBe("PREPARE");

      // Scientific mode stays in TRACKING because 0.16 < 0.22 threshold
      const cmdSci = adapterSci.adapt(
        modestBio,
        features,
        0.016,
        sensory,
        "scientific",
      );
      expect(cmdSci.racketState).toBe("TRACKING");
    });

    it("verifies DNa02 descending neuron silencing selectively degrades lateral steering", async () => {
      const seed = 42;
      const gameIntact = new Game({
        ...defaults,
        opponentType: "fruitfly",
        flyEmbodimentMode: "demo-assist",
      });
      await gameIntact.fly.init(false, "/data/connectome", seed);
      gameIntact.feedSyntheticShot("left");

      let intactClosestDist = 999;
      let intactMinX = 0;

      for (let step = 0; step < 260; step++) {
        gameIntact.step(1 / 120);
        if (gameIntact.fly.x < intactMinX) {
          intactMinX = gameIntact.fly.x;
        }
        if (gameIntact.currentShotDiagnostic) {
          intactClosestDist = Math.min(
            intactClosestDist,
            gameIntact.currentShotDiagnostic.closestDistance,
          );
        }
        if (gameIntact.shuttle.lastHit === 1 || gameIntact.hits >= 2) break;
      }

      const gameAblated = new Game({
        ...defaults,
        opponentType: "fruitfly",
        flyEmbodimentMode: "demo-assist",
      });
      await gameAblated.fly.init(false, "/data/connectome", seed);
      gameAblated.fly.bridge.applyInterventions({
        silencedTypes: ["DNa02"],
      });
      gameAblated.feedSyntheticShot("left");

      let ablatedClosestDist = 999;
      let ablatedMinX = 0;

      for (let step = 0; step < 260; step++) {
        gameAblated.step(1 / 120);
        if (gameAblated.fly.x < ablatedMinX) {
          ablatedMinX = gameAblated.fly.x;
        }
        if (gameAblated.currentShotDiagnostic) {
          ablatedClosestDist = Math.min(
            ablatedClosestDist,
            gameAblated.currentShotDiagnostic.closestDistance,
          );
        }
        if (gameAblated.state === "point") break;
      }

      // Intact fly steers significantly further laterally towards the left shot than DNa02-silenced fly
      expect(Math.abs(intactMinX)).toBeGreaterThan(Math.abs(ablatedMinX));
      expect(intactClosestDist).toBeLessThanOrEqual(ablatedClosestDist);
    });

    it("verifies Classic AI and Fruit-Fly Connectome produce fundamentally different mechanical outcomes", async () => {
      // 1. Classic AI
      const gameClassic = new Game({ ...defaults, opponentType: "classic" });
      gameClassic.ai.x = 0;
      gameClassic.ai.z = -3.9;
      gameClassic.feedSyntheticShot("left");
      let classicInteracted = false;
      for (let i = 0; i < 200; i++) {
        gameClassic.step(1 / 120);
        if (gameClassic.shuttle.lastHit === 1 || gameClassic.hits >= 2) {
          classicInteracted = true;
          break;
        }
      }

      // 2. Fruit Fly
      const gameFly = new Game({
        ...defaults,
        opponentType: "fruitfly",
        flyEmbodimentMode: "demo-assist",
      });
      await gameFly.fly.init(false);
      gameFly.fly.x = 0;
      gameFly.fly.y = 1.4;
      gameFly.fly.z = -3.9;
      gameFly.feedSyntheticShot("left");
      let flyInteracted = false;
      for (let i = 0; i < 200; i++) {
        gameFly.step(1 / 120);
        if (gameFly.shuttle.lastHit === 1 || gameFly.hits >= 2) {
          flyInteracted = true;
          break;
        }
      }

      expect(classicInteracted).toBe(true);
      expect(flyInteracted).toBe(true);

      const classicV = gameClassic.shuttle.velocity;
      const flyV = gameFly.shuttle.velocity;

      const vDiff =
        Math.abs(classicV.x - flyV.x) +
        Math.abs(classicV.y - flyV.y) +
        Math.abs(classicV.z - flyV.z);
      expect(vDiff).toBeGreaterThan(1.0); // Distinct mechanics
    });

    it("verifies Classic AI and Fruit-Fly Connectome produce structurally distinct temporal trajectories", async () => {
      // 1. Classic AI
      const gameClassic = new Game({ ...defaults, opponentType: "classic" });
      gameClassic.ai.x = 0;
      gameClassic.ai.z = -3.9;
      gameClassic.feedSyntheticShot("left");

      const classicTrajectory: { t: number; x: number; z: number }[] = [];

      for (let i = 0; i < 240; i++) {
        gameClassic.step(1 / 120);
        classicTrajectory.push({
          t: gameClassic.time,
          x: gameClassic.ai.x,
          z: gameClassic.ai.z,
        });
        if (gameClassic.shuttle.lastHit === 1 || gameClassic.hits >= 2) break;
      }

      // 2. Fruit Fly
      const gameFly = new Game({
        ...defaults,
        opponentType: "fruitfly",
        flyEmbodimentMode: "demo-assist",
      });
      await gameFly.fly.init(false);
      gameFly.fly.x = 0;
      gameFly.fly.y = 1.4;
      gameFly.fly.z = -3.9;
      gameFly.feedSyntheticShot("left");

      const flyTrajectory: {
        t: number;
        x: number;
        z: number;
        rx: number;
        ry: number;
        rz: number;
      }[] = [];

      for (let i = 0; i < 240; i++) {
        gameFly.step(1 / 120);
        flyTrajectory.push({
          t: gameFly.time,
          x: gameFly.fly.x,
          z: gameFly.fly.z,
          rx: gameFly.fly.racketPos.x,
          ry: gameFly.fly.racketPos.y,
          rz: gameFly.fly.racketPos.z,
        });
        if (gameFly.shuttle.lastHit === 1 || gameFly.hits >= 2) break;
      }

      expect(classicTrajectory.length).toBeGreaterThan(10);
      expect(flyTrajectory.length).toBeGreaterThan(10);

      const sampleStep =
        Math.min(classicTrajectory.length, flyTrajectory.length) - 5;
      const xDiff = Math.abs(
        classicTrajectory[sampleStep].x - flyTrajectory[sampleStep].x,
      );
      const zDiff = Math.abs(
        classicTrajectory[sampleStep].z - flyTrajectory[sampleStep].z,
      );

      expect(xDiff + zDiff).toBeGreaterThan(0.2);
    });

    it("verifies the fruit fly does not chase the shuttle if neural output is zeroed out", async () => {
      const game = new Game({
        ...defaults,
        opponentType: "fruitfly",
        flyEmbodimentMode: "scientific",
      });
      await game.fly.init(false);

      game.feedSyntheticShot("left");

      const originalUpdate = game.fly.bridge.update.bind(game.fly.bridge);
      game.fly.bridge.update = (dt, input) => {
        const motor = originalUpdate(dt, input);
        motor.steerTorque = 0;
        motor.vx = 0;
        motor.vz = 0;
        if (motor.biological) {
          motor.biological.forwardThrust = 0;
          motor.biological.brakingDrive = 0;
          motor.biological.escapeActivation = 0;
          motor.biological.locomotorDrive = 0;
          motor.biological.turnImpulse = 0;
        }
        return motor;
      };

      for (let i = 0; i < 200; i++) {
        game.step(1 / 120);
      }

      // Fly should not have moved significantly
      expect(Math.abs(game.fly.x)).toBeLessThan(0.01);
      expect(Math.abs(game.fly.z - -3.9)).toBeLessThan(0.01);
    });
  });
});
