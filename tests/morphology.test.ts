import { describe, it, expect, beforeEach } from "vitest";
import { ConnectomeLoader } from "../src/flybrain/connectomeLoader";

describe("Morphology Loading and Integrity", () => {
  beforeEach(() => {
    ConnectomeLoader.clearCache();
  });

  it("loads morphology data synchronously from disk", () => {
    const morph = ConnectomeLoader.loadMorphologySync();
    expect(morph).toBeDefined();
    expect(morph.manifest).toBeDefined();
    expect(morph.meta).toBeDefined();
    expect(morph.positions).toBeInstanceOf(Float32Array);
    expect(morph.segmentBodyIds).toBeInstanceOf(Uint16Array);
    expect(morph.neuronOffsets).toBeInstanceOf(Uint32Array);
  });

  it("verifies manifest matches MaleCNS dataset provenance", () => {
    const morph = ConnectomeLoader.loadMorphologySync();
    expect(morph.manifest.dataset).toBe("malecns:v1.0");
    expect(morph.manifest.datasetName).toBe("MaleCNS");
    expect(morph.manifest.provenance).toBe("official-janelia-neuprint-swc");
    expect(morph.manifest.neuronCount).toBe(2439);
    expect(morph.manifest.morphologyNeurons).toBe(2439);
    expect(morph.manifest.totalSegments).toBeGreaterThan(500000);
    expect(morph.manifest.transform.scaleFactor).toBeGreaterThan(0);
    expect(morph.manifest.transform.scaleBar100umUnits).toBeGreaterThan(0);
  });

  it("verifies binary buffer lengths align perfectly", () => {
    const morph = ConnectomeLoader.loadMorphologySync();
    const totalSegs = morph.manifest.totalSegments;

    expect(morph.positions.length).toBe(totalSegs * 6);
    expect(morph.segmentBodyIds.length).toBe(totalSegs);
    expect(morph.neuronOffsets.length).toBe(morph.manifest.neuronCount + 1);

    expect(morph.neuronOffsets[0]).toBe(0);
    expect(morph.neuronOffsets[morph.neuronOffsets.length - 1]).toBe(totalSegs);

    // Verify offsets are monotonic non-decreasing
    for (let i = 0; i < morph.neuronOffsets.length - 1; i++) {
      expect(morph.neuronOffsets[i + 1]).toBeGreaterThanOrEqual(
        morph.neuronOffsets[i],
      );
    }
  });

  it("verifies all coordinates are finite and within normalized bounds", () => {
    const morph = ConnectomeLoader.loadMorphologySync();
    let minX = Infinity,
      maxX = -Infinity;
    let minY = Infinity,
      maxY = -Infinity;
    let minZ = Infinity,
      maxZ = -Infinity;

    let nonFiniteCount = 0;
    for (let i = 0; i < morph.positions.length; i += 3) {
      const x = morph.positions[i];
      const y = morph.positions[i + 1];
      const z = morph.positions[i + 2];

      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        nonFiniteCount++;
      }

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    expect(nonFiniteCount).toBe(0);

    expect(minX).toBeGreaterThanOrEqual(-10);
    expect(maxX).toBeLessThanOrEqual(10);
    expect(minY).toBeGreaterThanOrEqual(-10);
    expect(maxY).toBeLessThanOrEqual(10);
    expect(minZ).toBeGreaterThanOrEqual(-10);
    expect(maxZ).toBeLessThanOrEqual(10);
  });

  it("verifies key neural cell types have valid morphology", () => {
    const morph = ConnectomeLoader.loadMorphologySync();
    const graph = ConnectomeLoader.loadSync();

    // Check specific descending and visual neurons
    const dna02 = morph.meta.find(
      (m) =>
        m.type === "DNa02" ||
        graph.neurons[m.index].name.includes("DNa02") ||
        graph.neurons[m.index].type === "DNa02",
    );
    expect(dna02).toBeDefined();
    if (dna02) {
      expect(dna02.hasMorphology).toBe(true);
      expect(dna02.segmentCount).toBeGreaterThan(0);
    }

    const dnp01 = morph.meta.find(
      (m) =>
        m.type === "DNp01" ||
        graph.neurons[m.index].name.includes("DNp01") ||
        graph.neurons[m.index].type === "DNp01",
    );
    expect(dnp01).toBeDefined();
    if (dnp01) {
      expect(dnp01.hasMorphology).toBe(true);
      expect(dnp01.segmentCount).toBeGreaterThan(0);
    }
  });
});
