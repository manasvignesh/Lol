import type {
  ConnectomeCSRGraph,
  ConnectomeManifest,
  MorphologyData,
  MorphologyManifest,
  NeuronData,
  NeuronMorphologyMeta,
} from "./types";

export class ConnectomeLoader {
  private static cachedGraph: ConnectomeCSRGraph | null = null;
  private static cachedMorphology: MorphologyData | null = null;

  /**
   * Synchronous load for Node.js / test environments.
   */
  static loadSync(baseDir?: string): ConnectomeCSRGraph {
    if (this.cachedGraph) {
      return this.cachedGraph;
    }

    if (
      typeof process === "undefined" ||
      !process.versions ||
      !process.versions.node
    ) {
      throw new Error("ConnectomeLoader.loadSync is only available in Node.js");
    }

    let fs: any;
    let path: any;
    try {
      if (typeof (process as any).getBuiltinModule === "function") {
        fs = (process as any).getBuiltinModule("node:fs");
        path = (process as any).getBuiltinModule("node:path");
      }
    } catch {
      // ignore
    }

    if (!fs || !path) {
      throw new Error(
        "ConnectomeLoader.loadSync requires Node.js built-in modules; use ConnectomeLoader.load() instead.",
      );
    }

    const resolvedDir =
      baseDir || path.resolve(process.cwd(), "data", "connectome");

    const manifest: ConnectomeManifest = JSON.parse(
      fs.readFileSync(path.join(resolvedDir, "manifest.json"), "utf8"),
    );
    const neurons: NeuronData[] = JSON.parse(
      fs.readFileSync(path.join(resolvedDir, "neurons.json"), "utf8"),
    );

    const toAB = (b: any): ArrayBuffer =>
      new Uint8Array(b).buffer as ArrayBuffer;

    const indptrBuf = toAB(
      fs.readFileSync(path.join(resolvedDir, "indptr.bin")),
    );
    const indicesBuf = toAB(
      fs.readFileSync(path.join(resolvedDir, "indices.bin")),
    );
    const weightsBuf = toAB(
      fs.readFileSync(path.join(resolvedDir, "weights.bin")),
    );
    const signsBuf = toAB(fs.readFileSync(path.join(resolvedDir, "signs.bin")));

    const indptr = new Uint32Array(indptrBuf);
    const indices = new Uint32Array(indicesBuf);
    const weights = new Float32Array(weightsBuf);
    const signs = new Int8Array(signsBuf);

    let biologicalWeights: Uint32Array | undefined;
    const bioPath = path.join(resolvedDir, "biologicalWeights.bin");
    if (fs.existsSync(bioPath)) {
      biologicalWeights = new Uint32Array(toAB(fs.readFileSync(bioPath)));
    }

    if (indptr.length !== neurons.length + 1) {
      throw new Error(
        `Connectome CSR validation failed: indptr length (${indptr.length}) != neurons.length + 1 (${neurons.length + 1})`,
      );
    }

    const graph: ConnectomeCSRGraph = {
      neurons,
      indptr,
      indices,
      weights,
      signs,
      biologicalWeights,
      manifest,
    };

    this.cachedGraph = graph;
    return graph;
  }

  /**
   * Load connectome graph assets either via browser fetch or Node fs.
   */
  static async load(
    baseUrl: string = "/data/connectome",
  ): Promise<ConnectomeCSRGraph> {
    if (this.cachedGraph) {
      return this.cachedGraph;
    }

    // Node.js environment
    if (
      typeof process !== "undefined" &&
      process.versions &&
      process.versions.node &&
      typeof window === "undefined"
    ) {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const resolvedDir = path.resolve(process.cwd(), "data", "connectome");

      const manifest: ConnectomeManifest = JSON.parse(
        fs.readFileSync(path.join(resolvedDir, "manifest.json"), "utf8"),
      );
      const neurons: NeuronData[] = JSON.parse(
        fs.readFileSync(path.join(resolvedDir, "neurons.json"), "utf8"),
      );

      const toAB = (b: any): ArrayBuffer =>
        new Uint8Array(b).buffer as ArrayBuffer;

      const indptrBuf = toAB(
        fs.readFileSync(path.join(resolvedDir, "indptr.bin")),
      );
      const indicesBuf = toAB(
        fs.readFileSync(path.join(resolvedDir, "indices.bin")),
      );
      const weightsBuf = toAB(
        fs.readFileSync(path.join(resolvedDir, "weights.bin")),
      );
      const signsBuf = toAB(
        fs.readFileSync(path.join(resolvedDir, "signs.bin")),
      );

      const indptr = new Uint32Array(indptrBuf);
      const indices = new Uint32Array(indicesBuf);
      const weights = new Float32Array(weightsBuf);
      const signs = new Int8Array(signsBuf);

      let biologicalWeights: Uint32Array | undefined;
      const bioPath = path.join(resolvedDir, "biologicalWeights.bin");
      if (fs.existsSync(bioPath)) {
        biologicalWeights = new Uint32Array(toAB(fs.readFileSync(bioPath)));
      }

      if (indptr.length !== neurons.length + 1) {
        throw new Error(
          `Connectome CSR validation failed: indptr length (${indptr.length}) != neurons.length + 1 (${neurons.length + 1})`,
        );
      }

      const graph: ConnectomeCSRGraph = {
        neurons,
        indptr,
        indices,
        weights,
        signs,
        biologicalWeights,
        manifest,
      };

      this.cachedGraph = graph;
      return graph;
    }

    try {
      // Browser environment with fetch
      const [
        manifestRes,
        neuronsRes,
        indptrRes,
        indicesRes,
        weightsRes,
        signsRes,
      ] = await Promise.all([
        fetch(`${baseUrl}/manifest.json`),
        fetch(`${baseUrl}/neurons.json`),
        fetch(`${baseUrl}/indptr.bin`),
        fetch(`${baseUrl}/indices.bin`),
        fetch(`${baseUrl}/weights.bin`),
        fetch(`${baseUrl}/signs.bin`),
      ]);

      if (!manifestRes.ok || !neuronsRes.ok) {
        throw new Error(
          `Failed to fetch connectome metadata: ${manifestRes.statusText}`,
        );
      }

      const manifest: ConnectomeManifest = await manifestRes.json();
      const neurons: NeuronData[] = await neuronsRes.json();
      const indptrBuf = await indptrRes.arrayBuffer();
      const indicesBuf = await indicesRes.arrayBuffer();
      const weightsBuf = await weightsRes.arrayBuffer();
      const signsBuf = await signsRes.arrayBuffer();

      const indptr = new Uint32Array(indptrBuf);
      const indices = new Uint32Array(indicesBuf);
      const weights = new Float32Array(weightsBuf);
      const signs = new Int8Array(signsBuf);

      if (indptr.length !== neurons.length + 1) {
        throw new Error(
          `Connectome CSR validation failed: indptr length (${indptr.length}) != neurons.length + 1 (${neurons.length + 1})`,
        );
      }

      const graph: ConnectomeCSRGraph = {
        neurons,
        indptr,
        indices,
        weights,
        signs,
        manifest,
      };

      this.cachedGraph = graph;
      return graph;
    } catch (err) {
      console.warn("ConnectomeLoader error:", err);
      throw err;
    }
  }

  /**
   * Synchronous morphology load for Node.js / test environments.
   */
  static loadMorphologySync(baseDir?: string): MorphologyData {
    if (this.cachedMorphology) {
      return this.cachedMorphology;
    }

    if (
      typeof process === "undefined" ||
      !process.versions ||
      !process.versions.node
    ) {
      throw new Error(
        "ConnectomeLoader.loadMorphologySync is only available in Node.js",
      );
    }

    let fs: any;
    let path: any;
    try {
      if (typeof (process as any).getBuiltinModule === "function") {
        fs = (process as any).getBuiltinModule("node:fs");
        path = (process as any).getBuiltinModule("node:path");
      }
    } catch {
      // ignore
    }

    if (!fs || !path) {
      throw new Error(
        "ConnectomeLoader.loadMorphologySync requires Node.js built-in modules",
      );
    }

    const resolvedDir =
      baseDir || path.resolve(process.cwd(), "public", "data", "morphology");

    const manifest: MorphologyManifest = JSON.parse(
      fs.readFileSync(
        path.join(resolvedDir, "morphology-manifest.json"),
        "utf8",
      ),
    );
    const meta: NeuronMorphologyMeta[] = JSON.parse(
      fs.readFileSync(path.join(resolvedDir, "morphologyMeta.json"), "utf8"),
    );

    const toAB = (b: any): ArrayBuffer =>
      new Uint8Array(b).buffer as ArrayBuffer;

    const posBuf = toAB(
      fs.readFileSync(path.join(resolvedDir, "segmentPositions.bin")),
    );
    const bodyBuf = toAB(
      fs.readFileSync(path.join(resolvedDir, "segmentBodyIds.bin")),
    );
    const offsetBuf = toAB(
      fs.readFileSync(path.join(resolvedDir, "neuronOffsets.bin")),
    );

    const positions = new Float32Array(posBuf);
    const segmentBodyIds = new Uint16Array(bodyBuf);
    const neuronOffsets = new Uint32Array(offsetBuf);

    const morphologyData: MorphologyData = {
      manifest,
      meta,
      positions,
      segmentBodyIds,
      neuronOffsets,
    };

    this.cachedMorphology = morphologyData;
    return morphologyData;
  }

  /**
   * Asynchronous morphology load for Browser / Node.js.
   */
  static async loadMorphology(
    baseUrl: string = "/data/morphology",
  ): Promise<MorphologyData> {
    if (this.cachedMorphology) {
      return this.cachedMorphology;
    }

    // Node.js environment
    if (
      typeof process !== "undefined" &&
      process.versions &&
      process.versions.node &&
      typeof window === "undefined"
    ) {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const resolvedDir = path.resolve(
        process.cwd(),
        "public",
        "data",
        "morphology",
      );

      const manifest: MorphologyManifest = JSON.parse(
        fs.readFileSync(
          path.join(resolvedDir, "morphology-manifest.json"),
          "utf8",
        ),
      );
      const meta: NeuronMorphologyMeta[] = JSON.parse(
        fs.readFileSync(path.join(resolvedDir, "morphologyMeta.json"), "utf8"),
      );

      const toAB = (b: any): ArrayBuffer =>
        new Uint8Array(b).buffer as ArrayBuffer;

      const posBuf = toAB(
        fs.readFileSync(path.join(resolvedDir, "segmentPositions.bin")),
      );
      const bodyBuf = toAB(
        fs.readFileSync(path.join(resolvedDir, "segmentBodyIds.bin")),
      );
      const offsetBuf = toAB(
        fs.readFileSync(path.join(resolvedDir, "neuronOffsets.bin")),
      );

      const positions = new Float32Array(posBuf);
      const segmentBodyIds = new Uint16Array(bodyBuf);
      const neuronOffsets = new Uint32Array(offsetBuf);

      const morphologyData: MorphologyData = {
        manifest,
        meta,
        positions,
        segmentBodyIds,
        neuronOffsets,
      };

      this.cachedMorphology = morphologyData;
      return morphologyData;
    }

    try {
      // Browser environment with fetch
      const [manifestRes, metaRes, posRes, bodyRes, offsetRes] =
        await Promise.all([
          fetch(`${baseUrl}/morphology-manifest.json`),
          fetch(`${baseUrl}/morphologyMeta.json`),
          fetch(`${baseUrl}/segmentPositions.bin`),
          fetch(`${baseUrl}/segmentBodyIds.bin`),
          fetch(`${baseUrl}/neuronOffsets.bin`),
        ]);

      if (!manifestRes.ok || !metaRes.ok) {
        throw new Error(
          `Failed to fetch morphology metadata: ${manifestRes.statusText}`,
        );
      }

      const manifest: MorphologyManifest = await manifestRes.json();
      const meta: NeuronMorphologyMeta[] = await metaRes.json();
      const posBuf = await posRes.arrayBuffer();
      const bodyBuf = await bodyRes.arrayBuffer();
      const offsetBuf = await offsetRes.arrayBuffer();

      const positions = new Float32Array(posBuf);
      const segmentBodyIds = new Uint16Array(bodyBuf);
      const neuronOffsets = new Uint32Array(offsetBuf);

      const morphologyData: MorphologyData = {
        manifest,
        meta,
        positions,
        segmentBodyIds,
        neuronOffsets,
      };

      this.cachedMorphology = morphologyData;
      return morphologyData;
    } catch (err) {
      console.warn("ConnectomeLoader morphology error:", err);
      throw err;
    }
  }

  static clearCache() {
    this.cachedGraph = null;
    this.cachedMorphology = null;
  }
}
