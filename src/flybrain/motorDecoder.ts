import type { FlyMotorCommand, FlySensoryFeatures } from "./types";
import type { PathwayRegistry } from "./pathwayRegistry";

export class MotorDecoder {
  private smoothedVx = 0;
  private smoothedVz = 0;
  private smoothedArousal = 0.2;
  private swingCooldown = 0;

  constructor(private readonly pathways: PathwayRegistry) {}

  /**
   * Decodes instantaneous firing rates (in Hz) of real MaleCNS descending populations into motor actions.
   */
  decode(
    firingRates: Float32Array,
    features: FlySensoryFeatures,
    dt: number = 0.016,
  ): FlyMotorCommand {
    this.swingCooldown = Math.max(0, this.swingCooldown - dt);

    const getMeanRate = (ids: number[]): number => {
      if (ids.length === 0) return 0;
      let sum = 0;
      for (const id of ids) sum += firingRates[id] || 0;
      return sum / ids.length;
    };

    // 1. Lateral Steering Activity (Real DNa02, DNa01, and PFL3 Descending Pathways)
    const rateDNa02_L = getMeanRate(this.pathways.index.dna02Left);
    const rateDNa02_R = getMeanRate(this.pathways.index.dna02Right);
    const rateDNa01_L = getMeanRate(this.pathways.index.dna01Left);
    const rateDNa01_R = getMeanRate(this.pathways.index.dna01Right);
    const ratePFL_L = getMeanRate(this.pathways.index.pflLeft);
    const ratePFL_R = getMeanRate(this.pathways.index.pflRight);

    // Lateral motor drive
    const leftDrive = rateDNa02_L * 1.5 + rateDNa01_L * 0.8 + ratePFL_L * 0.5;
    const rightDrive = rateDNa02_R * 1.5 + rateDNa01_R * 0.8 + ratePFL_R * 0.5;

    // Asymmetry determines lateral velocity
    const steerDelta = rightDrive - leftDrive; // >0 move right (+X), <0 move left (-X)
    const targetVx = Math.max(-2.6, Math.min(2.6, steerDelta * 0.075));

    // 2. Forward Thrust & Surge Activity (Real DNp01 Giant Fiber, VNC Motor, MDN Braking)
    const rateDNp01 = getMeanRate(this.pathways.index.dnp01);
    const rateVNC = getMeanRate(this.pathways.index.vncMotor);
    const rateMDN =
      (getMeanRate(this.pathways.index.mdnLeft) +
        getMeanRate(this.pathways.index.mdnRight)) *
      0.5;

    const thrustDrive = rateDNp01 * 1.2 + rateVNC * 0.8;
    const brakeDrive = rateMDN * 1.8;

    const netSurge = thrustDrive - brakeDrive;
    const targetVz = Math.max(-2.5, Math.min(2.5, netSurge * 0.055));

    // 3. Strike Triggering (Real DNb01 & Giant Fiber Population Activation)
    const rateDNb01_L = getMeanRate(this.pathways.index.dnb01Left);
    const rateDNb01_R = getMeanRate(this.pathways.index.dnb01Right);
    const maxStrikeRate = Math.max(rateDNb01_L, rateDNb01_R, rateDNp01 * 0.8);

    let swingTriggered = false;
    let swingType: FlyMotorCommand["swingType"] = "forehand";
    let swingPower = 0.55;

    // Trigger strike when biological descending strike command fires, shuttle is close, and refractory period elapsed
    if (
      this.swingCooldown <= 0 &&
      maxStrikeRate > 15.0 &&
      features.distance < 2.5
    ) {
      swingTriggered = true;
      this.swingCooldown = 0.35; // 350ms biological refractory recovery
      swingPower = Math.min(1.0, 0.45 + maxStrikeRate * 0.015);

      if (features.elevationDeg > 22) {
        swingType = "overhead";
      } else if (features.elevationDeg < -15) {
        swingType = "lift";
      } else if (features.azimuthDeg < 0 || rateDNb01_L > rateDNb01_R) {
        swingType = "backhand";
      } else {
        swingType = "forehand";
      }
    }

    // 4. Arousal / Flight Vibration Rate
    const rawArousal = Math.min(
      1.0,
      Math.max(
        0.1,
        (thrustDrive + Math.abs(steerDelta) + maxStrikeRate) * 0.02,
      ),
    );
    this.smoothedArousal +=
      (rawArousal - this.smoothedArousal) * Math.min(1.0, dt * 6.0);

    // Smooth velocities with realistic aerodynamic flight inertia
    const smoothing = Math.min(1.0, dt * 10.0);
    this.smoothedVx += (targetVx - this.smoothedVx) * smoothing;
    this.smoothedVz += (targetVz - this.smoothedVz) * smoothing;

    // Flight state
    let flightState: FlyMotorCommand["flightState"] = "HOVER";
    if (swingTriggered || this.swingCooldown > 0.2) {
      flightState = "STRIKE";
    } else if (
      Math.abs(this.smoothedVx) > 0.35 ||
      Math.abs(this.smoothedVz) > 0.35
    ) {
      flightState = "PURSUIT";
    } else if (rateMDN > 10) {
      flightState = "RECOVER";
    }

    return {
      vx: this.smoothedVx,
      vz: this.smoothedVz,
      steerTorque: steerDelta * 0.05,
      swingTriggered,
      swingType,
      swingPower,
      arousal: this.smoothedArousal,
      flightState,
    };
  }

  reset() {
    this.smoothedVx = 0;
    this.smoothedVz = 0;
    this.smoothedArousal = 0.2;
    this.swingCooldown = 0;
  }
}
