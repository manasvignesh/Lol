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
   * Extract biologically grounded optical & kinematic features from 3D court state.
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

    // Threat / urgency metric
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
   * Injects external synaptic currents into real MaleCNS visual projection neurons
   * based on optical retinal features.
   *
   * Biological rule: External visual currents stimulate exclusively genuine
   * visual projection neuron populations (LC4, LC6, LC10a/b, LPLC1/2).
   * Central Complex compass (EPG, P-EN) and Descending pathways receive excitation
   * solely through downstream synaptic propagation across the biological connectome.
   */
  encode(features: FlySensoryFeatures, currentBuffer: Float32Array) {
    const {
      lc4Left,
      lc4Right,
      lc6Left,
      lc6Right,
      lc10Left,
      lc10Right,
      lplcLeft,
      lplcRight,
    } = this.pathways.index;

    // 1. LC10 (Small Target / Azimuth Tracking Visual Projection Neurons)
    // Excited when shuttle is within the visual field, with ipsilateral azimuth weighting
    if (features.distance < 16.0) {
      const baseTrack = Math.min(
        40.0,
        (14.0 / Math.max(0.8, features.distance)) * 18.0,
      );

      // Left hemisphere visual field tuning
      const leftWeight = Math.max(
        0.0,
        Math.min(1.0, (25.0 - features.azimuthDeg) / 50.0),
      );
      if (leftWeight > 0.05) {
        for (const id of lc10Left) {
          currentBuffer[id] += baseTrack * leftWeight;
        }
      }

      // Right hemisphere visual field tuning
      const rightWeight = Math.max(
        0.0,
        Math.min(1.0, (features.azimuthDeg + 25.0) / 50.0),
      );
      if (rightWeight > 0.05) {
        for (const id of lc10Right) {
          currentBuffer[id] += baseTrack * rightWeight;
        }
      }
    }

    // 2. LC4 & LC6 (Looming Collision & High-Speed Expansion VPNs)
    // Non-linear acceleration response to looming expansion rate and fast closing speed
    if (features.isApproaching) {
      const speedBonus = Math.max(0, (features.relativeSpeed - 8.0) * 1.5);
      const loomingDrive = Math.min(
        75.0,
        features.loomingRate * 900.0 + speedBonus,
      );

      if (loomingDrive > 1.0) {
        if (features.azimuthDeg <= 20) {
          for (const id of lc4Left) currentBuffer[id] += loomingDrive * 1.4;
          for (const id of lc6Left) currentBuffer[id] += loomingDrive * 1.1;
        }
        if (features.azimuthDeg >= -20) {
          for (const id of lc4Right) currentBuffer[id] += loomingDrive * 1.4;
          for (const id of lc6Right) currentBuffer[id] += loomingDrive * 1.1;
        }
      }
    }

    // 3. LPLC (Radial Expansion & Optic Flow)
    if (features.isApproaching && features.angularSizeDeg > 0.6) {
      const expDrive = Math.min(45.0, features.angularSizeDeg * 8.5);
      if (features.azimuthDeg <= 5) {
        for (const id of lplcLeft) currentBuffer[id] += expDrive;
      }
      if (features.azimuthDeg >= -5) {
        for (const id of lplcRight) currentBuffer[id] += expDrive;
      }
    }
  }

  getLastFeatures(): FlySensoryFeatures {
    return this.lastFeatures;
  }
}
