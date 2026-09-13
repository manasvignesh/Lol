import type {
  BiologicalMotorSignals,
  FlyMotorCommand,
  FlySensoryFeatures,
} from "./types";

/**
 * Engineered Badminton Embodiment Adapter
 *
 * Explicitly separates biological neural decoding from virtual badminton game mechanics:
 *
 * Biological Signals (from MotorDecoder):
 * - steeringTorque (DNa01/02, PFL3) -> lateral turning intention
 * - forwardThrust (DNp01, VNC motor) -> flight surge
 * - brakingDrive (MDN) -> backward deceleration
 * - turnImpulse (DNb01) -> flight turning / saccadic impulse
 * - escapeActivation (Giant Fiber, DNp01) -> rapid escape / motor burst
 * - locomotorDrive -> arousal / wing amplitude
 *
- Engineered Embodiment Actions (Virtual Badminton Avatar):
 * - Translates biological steering and thrust into court flight velocities (vx, vz)
 * - Uses motor burst and turn impulses combined with racket geometry to trigger cyber-racket swings
 * - Determines racket stroke type (forehand, backhand, overhead, lift) from spatial geometry
 * - Enforces engineered racket/stroke cooldown
 */
export class EmbodimentAdapter {
  private smoothedVx = 0;
  private smoothedVz = 0;
  private smoothedArousal = 0.2;
  private swingCooldown = 0;

  /**
   * Adapts biological motor signals into a concrete virtual badminton action.
   */
  adapt(
    bio: BiologicalMotorSignals,
    features: FlySensoryFeatures,
    dt: number = 0.016,
  ): FlyMotorCommand {
    this.swingCooldown = Math.max(0, this.swingCooldown - dt);

    // 1. Court Flight Velocity Mapping
    // Steering torque (-1..1) maps to lateral velocity (-2.6..2.6 m/s)
    const targetVx = bio.steeringTorque * 2.6;

    // Forward thrust (0..1) minus braking (0..1) maps to longitudinal velocity (-2.5..2.5 m/s)
    const netThrust = bio.forwardThrust * 2.5 - bio.brakingDrive * 2.8;
    const targetVz = Math.max(-2.5, Math.min(2.5, netThrust));

    // Smooth velocities with aerodynamic flight inertia
    const smoothing = Math.min(1.0, dt * 10.0);
    this.smoothedVx += (targetVx - this.smoothedVx) * smoothing;
    this.smoothedVz += (targetVz - this.smoothedVz) * smoothing;

    // 2. Cyber-Racket Swing Trigger (Engineered Embodiment Mapping)
    // Uses high motor activation (escapeActivation / turnImpulse) when shuttle is in reach
    const maxImpulse = Math.max(bio.escapeActivation, bio.turnImpulse);
    let swingTriggered = false;
    let swingType: FlyMotorCommand["swingType"] = "forehand";
    let swingPower = 0.55;

    if (
      this.swingCooldown <= 0 &&
      maxImpulse > 0.42 &&
      features.distance < 2.5
    ) {
      swingTriggered = true;
      this.swingCooldown = 0.35; // 350ms engineered racket/stroke cooldown
      swingPower = Math.min(1.0, 0.45 + maxImpulse * 0.55);

      // Swing orientation derived from shuttle spatial geometry relative to fly racket
      if (features.elevationDeg > 22) {
        swingType = "overhead";
      } else if (features.elevationDeg < -15) {
        swingType = "lift";
      } else if (features.azimuthDeg < 0 || bio.steeringTorque < -0.1) {
        swingType = "backhand";
      } else {
        swingType = "forehand";
      }
    }

    // 3. Arousal / Readiness Smoothing
    this.smoothedArousal +=
      (bio.locomotorDrive - this.smoothedArousal) * Math.min(1.0, dt * 6.0);

    // 4. Virtual Opponent Flight State
    let flightState: FlyMotorCommand["flightState"] = "HOVER";
    if (swingTriggered || this.swingCooldown > 0.2) {
      flightState = "STRIKE";
    } else if (
      Math.abs(this.smoothedVx) > 0.35 ||
      Math.abs(this.smoothedVz) > 0.35
    ) {
      flightState = "PURSUIT";
    } else if (bio.brakingDrive > 0.4) {
      flightState = "RECOVER";
    }

    return {
      biological: bio,
      vx: this.smoothedVx,
      vz: this.smoothedVz,
      steerTorque: bio.steeringTorque,
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
