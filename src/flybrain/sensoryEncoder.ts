import type { FlySensoryFeatures, FlySensoryInput, NeuronData } from "./types";
import type { PathwayRegistry } from "./pathwayRegistry";

export class SensoryEncoder {
  private lastFeatures: FlySensoryFeatures = {
    distance: 10,
    azimuthDeg: 0,
    elevationDeg: 0,
    relativeSpeed: 0,
    loomingRate: 0,
    angularSizeDeg: 0.5,
    retinalVelocityDegPerSec: 0,
    isApproaching: false,
    incomingTrajectoryThreat: 0,
  };

  private prevDistance = 10;
  private prevTime = 0;

  constructor(private readonly pathways: PathwayRegistry) {}

  /**
   * Extract biologically relevant optical & kinematic features from 3D court state.
   */
  extractFeatures(input: FlySensoryInput): FlySensoryFeatures {
    const [sx, sy, sz] = input.shuttlePos;
    const [vx, vy, vz] = input.shuttleVel;
    const [fx, fy, fz] = input.flyPos;

    const dx = sx - fx;
    const dy = sy - fy;
    const dz = sz - fz; // Positive means shuttle is in front of fly (+Z towards player)

    const dist = Math.max(0.1, Math.sqrt(dx * dx + dy * dy + dz * dz));
    const distXZ = Math.max(0.01, Math.sqrt(dx * dx + dz * dz));

    // Azimuth in fly visual field (0 deg = straight ahead along +Z, >0 right, <0 left)
    const rawAzimuth = Math.atan2(dx, dz) * (180 / Math.PI);
    const azimuthDeg = rawAzimuth - input.flyHeading * (180 / Math.PI);

    // Elevation (0 deg = horizontal, >0 above fly, <0 below)
    const elevationDeg = Math.atan2(dy, distXZ) * (180 / Math.PI);

    // Radial approach velocity (positive when closing in)
    const radialVel = -((dx * vx + dy * vy + dz * vz) / dist);
    const isApproaching = radialVel > 0.5 && dz > -0.5;

    // Looming angular expansion rate d(theta)/dt approx proportional to r_shuttle * v_approach / d^2
    const shuttleRadius = 0.035; // 3.5cm radius
    const angularSizeRad = 2 * Math.atan(shuttleRadius / (2 * dist));
    const angularSizeDeg = angularSizeRad * (180 / Math.PI);

    let loomingRate = 0;
    if (isApproaching) {
      loomingRate = (shuttleRadius * radialVel) / (dist * dist);
    }

    // Retinal drift velocity
    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
    const retinalVelocityDegPerSec = (speed / dist) * (180 / Math.PI);

    // Threat / urgency metric (higher when fast shuttle is heading directly toward fly court)
    const incomingTrajectoryThreat = isApproaching
      ? Math.min(1.0, Math.max(0.0, (radialVel / 15.0) * (5.0 / dist)))
      : 0;

    const features: FlySensoryFeatures = {
      distance: dist,
      azimuthDeg,
      elevationDeg,
      relativeSpeed: speed,
      loomingRate,
      angularSizeDeg,
      retinalVelocityDegPerSec,
      isApproaching,
      incomingTrajectoryThreat,
    };

    this.lastFeatures = features;
    this.prevDistance = dist;
    this.prevTime = input.time;

    return features;
  }

  /**
   * Injects external synaptic currents into visual projection and sensory neurons
   * based on extracted optical features.
   */
  encode(features: FlySensoryFeatures, currentBuffer: Float32Array) {
    const neurons = this.pathways.graph.neurons;

    // 1. LC10 (Azimuth Small-Target Tracking Neurons)
    // Active when shuttle is in view, with Gaussian angular tuning
    const encodeLC10 = (id: number) => {
      const n = neurons[id];
      if (!n.receptiveField) return;
      const rf = n.receptiveField;
      const azCenter = (rf.azimuthMin + rf.azimuthMax) * 0.5;
      const azWidth = (rf.azimuthMax - rf.azimuthMin) * 0.6;
      const elCenter = (rf.elevationMin + rf.elevationMax) * 0.5;
      const elWidth = (rf.elevationMax - rf.elevationMin) * 0.6;

      const dAz = (features.azimuthDeg - azCenter) / azWidth;
      const dEl = (features.elevationDeg - elCenter) / elWidth;
      const gaussian = Math.exp(-(dAz * dAz + dEl * dEl));

      // Current injection in pA/mV
      if (features.distance < 14) {
        currentBuffer[id] +=
          gaussian *
          22.0 *
          Math.min(2.0, 4.0 / Math.max(1.0, features.distance));
      }
    };

    this.pathways.index.lc10Left.forEach(encodeLC10);
    this.pathways.index.lc10Right.forEach(encodeLC10);

    // 2. LC4 & LC6 (Looming & Target Approach Neurons)
    // Strong non-linear response to looming expansion rate eta(t)
    if (features.isApproaching && features.loomingRate > 0.005) {
      const loomingDrive = Math.min(45.0, features.loomingRate * 600.0);

      // Distribute to Left or Right based on azimuth
      if (features.azimuthDeg < 15) {
        // Left hemisphere or centered
        this.pathways.index.lc4Left.forEach((id) => {
          currentBuffer[id] += loomingDrive * 1.2;
        });
        this.pathways.index.lc6Left.forEach((id) => {
          currentBuffer[id] += loomingDrive * 0.9;
        });
      }

      if (features.azimuthDeg > -15) {
        // Right hemisphere or centered
        this.pathways.index.lc4Right.forEach((id) => {
          currentBuffer[id] += loomingDrive * 1.2;
        });
        this.pathways.index.lc6Right.forEach((id) => {
          currentBuffer[id] += loomingDrive * 0.9;
        });
      }
    }

    // 3. LPLC2 (Radial Expansion)
    if (features.isApproaching && features.angularSizeDeg > 1.0) {
      const expDrive = Math.min(30.0, features.angularSizeDeg * 6.0);
      if (features.azimuthDeg <= 0) {
        this.pathways.index.lplc2Left.forEach((id) => {
          currentBuffer[id] += expDrive;
        });
      }
      if (features.azimuthDeg >= 0) {
        this.pathways.index.lplc2Right.forEach((id) => {
          currentBuffer[id] += expDrive;
        });
      }
    }

    // 4. Central Complex Compass Integration (P-EN heading shifts from optical drift)
    const drift =
      features.retinalVelocityDegPerSec * (features.azimuthDeg < 0 ? -1 : 1);
    if (Math.abs(drift) > 5) {
      if (drift < 0) {
        this.pathways.index.penLeft.forEach((id) => {
          currentBuffer[id] += Math.min(18.0, Math.abs(drift) * 0.15);
        });
      } else {
        this.pathways.index.penRight.forEach((id) => {
          currentBuffer[id] += Math.min(18.0, Math.abs(drift) * 0.15);
        });
      }
    }
  }

  getLastFeatures(): FlySensoryFeatures {
    return this.lastFeatures;
  }
}
