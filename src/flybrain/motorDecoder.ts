import type { BiologicalMotorSignals } from "./types";
import type { PathwayRegistry } from "./pathwayRegistry";

/**
 * Biological Motor Decoder
 *
 * Decodes instantaneous population firing rates (Hz) of authentic MaleCNS
 * descending neurons (DNa01/02, DNp01, DNb01, MDN, Giant Fiber) and VNC motor
 * effectors into biologically interpretable locomotor and steering variables.
 *
 * Scientific Demarcation:
 * - DNa01/DNa02: Steering / locomotor turning torque
 * - DNp01: Flight initiation / forward power thrust
 * - DNb01: Flight turning / saccadic impulse
 * - Giant Fiber / DNp01: Fast escape / takeoff activation
 * - MDN (Moonwalker): Backward locomotion / braking drive
 * - VNC Motor: Flight trim / wing stroke amplitude
 *
 * Virtual badminton racket embodiment and game world geometry are handled
 * separately in EmbodimentAdapter.
 */
export class MotorDecoder {
  constructor(private readonly pathways: PathwayRegistry) {}

  /**
   * Decodes instantaneous firing rates of real MaleCNS populations into biological motor signals.
   */
  decode(firingRates: Float32Array): BiologicalMotorSignals {
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

    // Lateral turning drive: rightward positive, leftward negative
    const leftDrive = rateDNa02_L * 1.5 + rateDNa01_L * 0.8 + ratePFL_L * 0.5;
    const rightDrive = rateDNa02_R * 1.5 + rateDNa01_R * 0.8 + ratePFL_R * 0.5;
    const steerDelta = rightDrive - leftDrive;
    const steeringTorque = Math.max(-1.0, Math.min(1.0, steerDelta * 0.04));

    // 2. Forward Thrust & Flight Power (Real DNp01 and VNC Motor Effectors)
    const rateDNp01 = getMeanRate(this.pathways.index.dnp01);
    const rateVNC = getMeanRate(this.pathways.index.vncMotor);
    const forwardThrust = Math.min(
      1.0,
      Math.max(0.0, rateDNp01 * 0.02 + rateVNC * 0.015),
    );

    // 3. Braking / Deceleration Drive (Real MDN Moonwalker Neurons)
    const rateMDN =
      (getMeanRate(this.pathways.index.mdnLeft) +
        getMeanRate(this.pathways.index.mdnRight)) *
      0.5;
    const brakingDrive = Math.min(1.0, Math.max(0.0, rateMDN * 0.035));

    // 4. Flight-Turn / Saccade Impulse (Real DNb01 Descending Neurons)
    const rateDNb01_L = getMeanRate(this.pathways.index.dnb01Left);
    const rateDNb01_R = getMeanRate(this.pathways.index.dnb01Right);
    const maxDNb01 = Math.max(rateDNb01_L, rateDNb01_R);
    const turnImpulse = Math.min(1.0, Math.max(0.0, maxDNb01 * 0.03));

    // 5. High-Threshold Escape / Takeoff Activation (Real DNp01 & DNb01 descending populations)
    const escapeActivation = Math.min(
      1.0,
      Math.max(0.0, rateDNp01 * 0.018 + maxDNb01 * 0.015),
    );

    // 6. Overall Locomotor Vigor & Arousal (Strictly zero when all neural inputs are zero)
    const locomotorDrive = Math.min(
      1.0,
      Math.max(
        0.0,
        (forwardThrust +
          Math.abs(steeringTorque) +
          turnImpulse +
          escapeActivation) *
          0.35,
      ),
    );

    // 7. Biological Flight State
    let flightState: BiologicalMotorSignals["flightState"] = "HOVER";
    if (escapeActivation > 0.6 || turnImpulse > 0.5) {
      flightState = "MANEUVER";
    } else if (forwardThrust > 0.35 || Math.abs(steeringTorque) > 0.3) {
      flightState = "PURSUIT";
    } else if (brakingDrive > 0.4) {
      flightState = "RECOVER";
    }

    return {
      steeringTorque,
      forwardThrust,
      brakingDrive,
      turnImpulse,
      escapeActivation,
      locomotorDrive,
      flightState,
    };
  }

  reset() {}
}
