import type { FlyMotorCommand, FlySensoryFeatures } from "./types";
import type { PathwayRegistry } from "./pathwayRegistry";

export class MotorDecoder {
  private smoothedVx = 0;
  private smoothedVz = 0;
  private smoothedArousal = 0.2;
  private swingCooldown = 0;

  constructor(private readonly pathways: PathwayRegistry) {}

  /**
   * Decodes instantaneous firing rates (in Hz) into physical motor commands.
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

    // 1. Lateral Steering Activity (DNa02 / DNa01 / MN_Steer)
    const rateDNa02_L = getMeanRate(this.pathways.index.dna02Left);
    const rateDNa02_R = getMeanRate(this.pathways.index.dna02Right);
    const rateDNa01_L = getMeanRate(this.pathways.index.dna01Left);
    const rateDNa01_R = getMeanRate(this.pathways.index.dna01Right);
    const rateMN_L = getMeanRate(this.pathways.index.motorSteerLeft);
    const rateMN_R = getMeanRate(this.pathways.index.motorSteerRight);

    const leftDrive = rateDNa02_L + 0.6 * rateDNa01_L + 0.8 * rateMN_L;
    const rightDrive = rateDNa02_R + 0.6 * rateDNa01_R + 0.8 * rateMN_R;

    // Asymmetry determines lateral acceleration / torque
    const steerDelta = rightDrive - leftDrive; // >0 move right (+X), <0 move left (-X)
    const targetVx = Math.max(-2.6, Math.min(2.6, steerDelta * 0.065));

    // 2. Forward Thrust & Surge Activity (DNp01 / MN_Thrust / MDN Brake)
    const rateDNp01 = getMeanRate(this.pathways.index.dnp01);
    const rateMN_Thrust = getMeanRate(this.pathways.index.motorThrust);
    const rateMDN =
      (getMeanRate(this.pathways.index.mdnLeft) +
        getMeanRate(this.pathways.index.mdnRight)) *
      0.5;
    const rateMN_Brake = getMeanRate(this.pathways.index.motorBrake);

    const thrustDrive = rateDNp01 + 0.9 * rateMN_Thrust;
    const brakeDrive = rateMDN * 1.5 + rateMN_Brake;

    const netSurge = thrustDrive - brakeDrive;
    const targetVz = Math.max(-2.5, Math.min(2.5, netSurge * 0.05));

    // 3. Strike Execution (DNb01 / Giant Fiber / MN_Strike)
    const rateDNb01_L = getMeanRate(this.pathways.index.dnb01Left);
    const rateDNb01_R = getMeanRate(this.pathways.index.dnb01Right);
    const rateGF_L = getMeanRate(this.pathways.index.giantFiberLeft);
    const rateGF_R = getMeanRate(this.pathways.index.giantFiberRight);
    const rateStrike_Forehand = getMeanRate(
      this.pathways.index.motorStrikeForehand,
    );
    const rateStrike_Backhand = getMeanRate(
      this.pathways.index.motorStrikeBackhand,
    );

    const maxStrikeRate = Math.max(
      rateDNb01_L,
      rateDNb01_R,
      rateGF_L * 1.2,
      rateGF_R * 1.2,
      rateStrike_Forehand,
      rateStrike_Backhand,
    );

    // Strike triggering conditions
    let swingTriggered = false;
    let swingType: FlyMotorCommand["swingType"] = "forehand";
    let swingPower = 0.5;

    // Trigger strike if neural activity is high, shuttle is close (< 2.2m) and cooldown is ready
    if (
      this.swingCooldown <= 0 &&
      maxStrikeRate > 18.0 &&
      features.distance < 2.4
    ) {
      swingTriggered = true;
      this.swingCooldown = 0.35; // 350ms biological refractory cooldown
      swingPower = Math.min(1.0, 0.4 + maxStrikeRate * 0.015);

      if (features.elevationDeg > 25) {
        swingType = "overhead";
      } else if (features.elevationDeg < -15) {
        swingType = "lift";
      } else if (
        features.azimuthDeg < 0 ||
        rateStrike_Backhand > rateStrike_Forehand
      ) {
        swingType = "backhand";
      } else {
        swingType = "forehand";
      }
    }

    // 4. Arousal / Wing Vibration Rate
    const rawArousal = Math.min(
      1.0,
      Math.max(0.1, (thrustDrive + Math.abs(steerDelta)) * 0.02),
    );
    this.smoothedArousal +=
      (rawArousal - this.smoothedArousal) * Math.min(1.0, dt * 6.0);

    // Smooth velocities with realistic flight inertia
    const smoothing = Math.min(1.0, dt * 10.0);
    this.smoothedVx += (targetVx - this.smoothedVx) * smoothing;
    this.smoothedVz += (targetVz - this.smoothedVz) * smoothing;

    // Flight state determination
    let flightState: FlyMotorCommand["flightState"] = "HOVER";
    if (swingTriggered || this.swingCooldown > 0.2) {
      flightState = "STRIKE";
    } else if (
      Math.abs(this.smoothedVx) > 0.4 ||
      Math.abs(this.smoothedVz) > 0.4
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
