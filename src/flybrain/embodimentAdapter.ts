import type {
  BiologicalMotorSignals,
  EmbodimentRacketState,
  FlyMotorCommand,
  FlySensoryFeatures,
  FlySensoryInput,
} from "./types";

/**
 * Engineered Badminton Embodiment Adapter
 *
 * Explicitly separates biological neural decoding from virtual badminton game mechanics:
 *
 * Biological Signals (from MotorDecoder):
 * - steeringTorque (DNa01/02, PFL3) -> lateral turning intention & body velocity
 * - forwardThrust (DNp01, VNC motor) -> flight surge & forward body velocity
 * - brakingDrive (MDN) -> backward deceleration
 * - turnImpulse (DNb01) -> flight turning / saccadic impulse
 * - escapeActivation (Giant Fiber, DNp01) -> rapid escape / motor burst
 * - locomotorDrive -> arousal / wing amplitude & neural readiness
 *
 * Engineered Embodiment Actions (Virtual Badminton Avatar & Artificial Racket Effector):
 * - Translates biological steering and thrust into court flight velocities (vx, vz)
 * - State Machine: IDLE -> TRACKING -> PREPARE -> STRIKE -> RECOVER
 * - PREPARE: Positions artificial racket near expected contact point early when neural readiness is present
 * - STRIKE: Executes a smooth 3D procedural stroke arc across the contact zone
 * - Strict Physical Collision: Contact is evaluated purely through swept physical geometry
 */
export class EmbodimentAdapter {
  private smoothedVx = 0;
  private smoothedVz = 0;
  private smoothedArousal = 0.2;

  // Effector State Machine
  private racketState: EmbodimentRacketState = "IDLE";
  private currentRacketPos: [number, number, number] = [0.55, 1.25, -3.55];
  private currentRacketVel: [number, number, number] = [0, 0, 0];
  private racketRotationZ = 0.4;

  // Procedural Strike Arc
  private strokeTime = 0;
  private strokeDuration = 0.24;
  private strokeP0: [number, number, number] = [0, 0, 0];
  private strokeP1: [number, number, number] = [0, 0, 0];
  private strokeP2: [number, number, number] = [0, 0, 0];
  private currentSwingType: FlyMotorCommand["swingType"] = "forehand";
  private currentSwingPower = 0.55;

  // Timers
  private cooldownTimer = 0;
  private prepareTimer = 0;
  private hasSwungThisShot = false;

  // Operating Mode ("demo-assist" vs "scientific")
  public mode: "demo-assist" | "scientific" = "demo-assist";

  /**
   * Adapts biological motor signals into court velocity and procedural racket movement.
   */
  adapt(
    bio: BiologicalMotorSignals,
    features: FlySensoryFeatures,
    dt: number = 0.016,
    sensoryInput?: FlySensoryInput,
    mode: "demo-assist" | "scientific" = this.mode,
  ): FlyMotorCommand {
    this.mode = mode;

    // 1. Biological Flight Velocity Mapping (Derived from MaleCNS Descending Neurons)
    // Steering torque (-1..1) maps to lateral velocity (-2.85..2.85 m/s)
    const targetVx = bio.steeringTorque * 2.85;

    // Smooth velocities with aerodynamic flight inertia
    const smoothing = Math.min(1.0, dt * 10.0);
    this.smoothedVx += (targetVx - this.smoothedVx) * smoothing;

    // Smooth neural locomotor readiness
    this.smoothedArousal +=
      (bio.locomotorDrive - this.smoothedArousal) * Math.min(1.0, dt * 6.0);

    // 2. Lightweight Physical Interception Estimation (For Artificial Racket Effector & Court Pursuit)
    let ttc = 99.0;
    let contactPoint: [number, number, number] = [0, 1.4, -3.55];

    const flyX = sensoryInput ? sensoryInput.flyPos[0] : 0;
    const flyY = sensoryInput ? sensoryInput.flyPos[1] : 1.4;
    const flyZ = sensoryInput ? sensoryInput.flyPos[2] : -3.9;

    if (sensoryInput) {
      const [sx, sy, sz] = sensoryInput.shuttlePos;
      const [vx, vy, vz] = sensoryInput.shuttleVel;

      if (vz < -0.3 && sz > flyZ - 1.2) {
        // Forward numerical simulation of parabolic shuttle path with gravity and aerodynamic drag
        let simX = sx;
        let simY = sy;
        let simZ = sz;
        let simVx = vx;
        let simVy = vy;
        let simVz = vz;
        const drag = 0.095;
        const gravity = 9.81;
        const simDt = 0.016;

        let bestTtc = 99.0;
        let bestPoint: [number, number, number] = [
          flyX,
          flyY + 0.1,
          flyZ + 0.35,
        ];
        let minScore = 9999;

        // Check if trajectory reaches a high apex (> 2.4m)
        let isHighArc = false;
        {
          let testY = sy;
          let testVy = vy;
          for (let s = 1; s <= 60; s++) {
            testVy -= gravity * simDt;
            testY += testVy * simDt;
            if (testY > 2.45) {
              isHighArc = true;
              break;
            }
          }
        }

        for (let step = 1; step <= 140; step++) {
          const t = step * simDt;
          const spd = Math.sqrt(simVx * simVx + simVy * simVy + simVz * simVz);
          const dragFactor = 1.0 / (1.0 + drag * spd * simDt);
          simVx *= dragFactor;
          simVy = (simVy - gravity * simDt) * dragFactor;
          simVz *= dragFactor;

          simX += simVx * simDt;
          simY += simVy * simDt;
          simZ += simVz * simDt;

          if (simY < 0.15) break; // Shuttle grounded

          // For high-arching shots, only intercept during descending phase
          if (isHighArc && simVy > 0.1) continue;

          // Reachable window: shuttle in fly court (z <= 0.2) and playable height (0.35m - 2.45m)
          if (simZ <= 0.2 && simZ >= -6.5 && simY >= 0.35 && simY <= 2.45) {
            const heightCost = Math.abs(simY - 1.45);
            // Prioritize comfortable strike height (1.45m) and earlier descending contact
            const score = heightCost * 2.8 + t * 0.15;

            if (score < minScore) {
              minScore = score;
              bestTtc = t;
              bestPoint = [simX, simY, simZ];
            }
          }
        }

        if (bestTtc < 90) {
          ttc = bestTtc;
          contactPoint = bestPoint;
        } else {
          const distZ = sz - (flyZ + 0.35);
          ttc = Math.max(0.04, distZ / Math.max(0.5, Math.abs(vz)));
          contactPoint = [sx, Math.max(0.4, sy), flyZ + 0.35];
        }
      } else {
        contactPoint = [flyX, flyY + 0.1, flyZ + 0.35];
      }
    }

    // Longitudinal velocity mapping: Separate depth direction (geometry) from neural readiness (magnitude)
    let targetVz = 0;
    const desiredFlyContactZ = flyZ + 0.25;
    const depthError = contactPoint[2] - desiredFlyContactZ;
    const neuralReadiness = Math.max(
      bio.locomotorDrive,
      bio.forwardThrust,
      bio.escapeActivation,
      bio.turnImpulse,
    );

    if (
      sensoryInput &&
      sensoryInput.shuttleVel[2] < -0.3 &&
      neuralReadiness > 0.06
    ) {
      if (depthError < -0.2) {
        // BACKWARD RETREAT: Target is deep behind the fly
        const depthMagnitude = Math.min(1.0, Math.abs(depthError) / 1.35);
        const maxRetreatSpeed = mode === "demo-assist" ? 3.6 : 3.0;

        // Modulated by biological arousal / braking / escape drive
        // Crucially: positive forwardThrust does NOT reverse this retreat direction!
        const biologicalRetreatModulation = Math.max(
          0.4,
          bio.locomotorDrive * 0.95,
          bio.brakingDrive * 1.3,
          bio.escapeActivation * 0.85,
        );

        targetVz =
          -depthMagnitude * maxRetreatSpeed * biologicalRetreatModulation;
      } else if (depthError > 0.2) {
        // FORWARD ADVANCE: Target is in front toward net (drop shot / short drive)
        const depthMagnitude = Math.min(1.0, depthError / 1.2);
        const maxAdvanceSpeed = mode === "demo-assist" ? 3.2 : 2.7;
        const biologicalAdvanceModulation = Math.max(
          0.4,
          bio.forwardThrust * 1.1,
          bio.locomotorDrive * 0.9,
        );

        targetVz =
          depthMagnitude * maxAdvanceSpeed * biologicalAdvanceModulation;
      } else {
        // Stabilizing hover near intercept zone
        targetVz = bio.forwardThrust * 0.4 - bio.brakingDrive * 0.4;
      }
    } else {
      // Baseline hover / idle positioning
      targetVz = bio.forwardThrust * 0.4 - bio.brakingDrive * 0.4;
    }

    const maxSpeedLimit = mode === "demo-assist" ? 3.8 : 3.2;
    targetVz = Math.max(-maxSpeedLimit, Math.min(maxSpeedLimit, targetVz));
    this.smoothedVz += (targetVz - this.smoothedVz) * smoothing;

    // Reset shot flag if shuttle is moving away from fly court
    if (sensoryInput && sensoryInput.shuttleVel[2] >= 0) {
      this.hasSwungThisShot = false;
    }

    // 3. Embodiment Thresholds
    const isDemo = mode === "demo-assist";
    const prepWindow = isDemo ? 0.85 : 0.55; // Time-to-contact window for racket preparation
    const prepThreshold = isDemo ? 0.14 : 0.22; // Minimum neural locomotor readiness to start preparing
    const strikeWindow = isDemo ? 0.26 : 0.17; // Time-to-contact window for initiating strike
    const strikeThreshold = isDemo ? 0.26 : 0.38; // Motor impulse burst threshold
    const maxImpulse = Math.max(
      bio.escapeActivation,
      bio.turnImpulse,
      bio.locomotorDrive,
    );

    let swingTriggered = false;

    // 4. State Machine Update
    switch (this.racketState) {
      case "IDLE": {
        const defaultRest: [number, number, number] = [
          flyX + 0.48,
          flyY - 0.15,
          flyZ + 0.3,
        ];
        this.currentRacketPos[0] +=
          (defaultRest[0] - this.currentRacketPos[0]) * Math.min(1.0, dt * 10);
        this.currentRacketPos[1] +=
          (defaultRest[1] - this.currentRacketPos[1]) * Math.min(1.0, dt * 10);
        this.currentRacketPos[2] +=
          (defaultRest[2] - this.currentRacketPos[2]) * Math.min(1.0, dt * 10);
        this.racketRotationZ = 0.4;
        this.currentRacketVel = [0, 0, 0];

        if (
          sensoryInput &&
          sensoryInput.shuttlePos[2] < 3.4 &&
          sensoryInput.shuttleVel[2] < -0.4
        ) {
          this.racketState = "TRACKING";
        }
        break;
      }

      case "TRACKING": {
        const isBackhand =
          contactPoint[0] < flyX - 0.08 || bio.steeringTorque < -0.12;
        const trackingRest: [number, number, number] = [
          flyX + (isBackhand ? -0.48 : 0.48),
          flyY - 0.05,
          flyZ + 0.32,
        ];
        this.currentRacketPos[0] +=
          (trackingRest[0] - this.currentRacketPos[0]) * Math.min(1.0, dt * 14);
        this.currentRacketPos[1] +=
          (trackingRest[1] - this.currentRacketPos[1]) * Math.min(1.0, dt * 14);
        this.currentRacketPos[2] +=
          (trackingRest[2] - this.currentRacketPos[2]) * Math.min(1.0, dt * 14);
        this.racketRotationZ = isBackhand ? -0.3 : 0.3;
        this.currentRacketVel = [0, 0, 0];

        // Transition to PREPARE if shuttle is approaching, in time window, and neural readiness is active
        if (
          !this.hasSwungThisShot &&
          ttc <= prepWindow &&
          bio.locomotorDrive >= prepThreshold &&
          sensoryInput &&
          sensoryInput.shuttleVel[2] < -0.4
        ) {
          this.racketState = "PREPARE";
          this.prepareTimer = 0;
        } else if (
          sensoryInput &&
          (sensoryInput.shuttleVel[2] >= 0 || sensoryInput.shuttlePos[2] > 3.8)
        ) {
          this.racketState = "IDLE";
        }
        break;
      }

      case "PREPARE": {
        this.prepareTimer += dt;

        // Determine stroke type based on contact point geometry
        if (contactPoint[1] > flyY + 0.45) {
          this.currentSwingType = "overhead";
        } else if (contactPoint[1] < flyY - 0.22) {
          this.currentSwingType = "lift";
        } else if (
          contactPoint[0] < flyX - 0.08 ||
          bio.steeringTorque < -0.12
        ) {
          this.currentSwingType = "backhand";
        } else {
          this.currentSwingType = "forehand";
        }

        // Clamp reachable interaction volume around fly avatar body
        const maxLateralReach = isDemo ? 0.72 : 0.52;
        const reachX = Math.max(
          flyX - maxLateralReach,
          Math.min(flyX + maxLateralReach, contactPoint[0]),
        );
        const reachY = Math.max(
          flyY - 1.05,
          Math.min(flyY + 1.65, contactPoint[1]),
        );
        const reachZ = Math.max(
          flyZ - 0.35,
          Math.min(flyZ + 1.25, contactPoint[2]),
        );

        // Preparatory loaded stance (backswing pose before strike)
        let prepX = reachX;
        let prepY = reachY;
        let prepZ = reachZ - 0.25;

        if (this.currentSwingType === "overhead") {
          prepX = reachX + 0.1;
          prepY = reachY + 0.32;
          prepZ = reachZ - 0.22;
          this.racketRotationZ = -0.5;
        } else if (this.currentSwingType === "lift") {
          prepX = reachX + 0.14;
          prepY = reachY - 0.3;
          prepZ = reachZ - 0.22;
          this.racketRotationZ = 0.6;
        } else if (this.currentSwingType === "backhand") {
          prepX = reachX - 0.26;
          prepY = reachY + 0.08;
          prepZ = reachZ - 0.25;
          this.racketRotationZ = -0.75;
        } else {
          // forehand
          prepX = reachX + 0.26;
          prepY = reachY + 0.08;
          prepZ = reachZ - 0.25;
          this.racketRotationZ = 0.75;
        }

        // Smoothly move towards preparation pose
        const prepSpeed = 26.0;
        const prevRx = this.currentRacketPos[0];
        const prevRy = this.currentRacketPos[1];
        const prevRz = this.currentRacketPos[2];

        this.currentRacketPos[0] +=
          (prepX - this.currentRacketPos[0]) * Math.min(1.0, dt * prepSpeed);
        this.currentRacketPos[1] +=
          (prepY - this.currentRacketPos[1]) * Math.min(1.0, dt * prepSpeed);
        this.currentRacketPos[2] +=
          (prepZ - this.currentRacketPos[2]) * Math.min(1.0, dt * prepSpeed);

        this.currentRacketVel = [
          (this.currentRacketPos[0] - prevRx) / Math.max(0.001, dt),
          (this.currentRacketPos[1] - prevRy) / Math.max(0.001, dt),
          (this.currentRacketPos[2] - prevRz) / Math.max(0.001, dt),
        ];

        // Trigger STRIKE when approaching contact window, high motor burst, or fast projectile reflex
        const isFastSpeed = sensoryInput
          ? Math.abs(sensoryInput.shuttleVel[2]) > 14.0
          : false;
        const effectiveStrikeWindow = isFastSpeed ? 0.17 : isDemo ? 0.22 : 0.16;

        const inLongitudinalReach = sensoryInput
          ? sensoryInput.shuttlePos[2] <= flyZ + 1.9
          : true;

        const shouldStrike =
          !this.hasSwungThisShot &&
          inLongitudinalReach &&
          (ttc <= effectiveStrikeWindow ||
            (maxImpulse >= strikeThreshold && ttc <= 0.26) ||
            (isFastSpeed &&
              ttc <= 0.22 &&
              bio.locomotorDrive >= prepThreshold));

        if (shouldStrike) {
          this.racketState = "STRIKE";
          this.strokeTime = 0;
          this.strokeDuration = isFastSpeed ? 0.18 : isDemo ? 0.24 : 0.2;
          this.currentSwingPower = Math.min(1.0, 0.45 + maxImpulse * 0.55);
          this.hasSwungThisShot = true;
          swingTriggered = true;

          // Configure 3D stroke path: P0 (start), P1 (contact apex), P2 (follow through)
          this.strokeP0 = [...this.currentRacketPos];
          this.strokeP1 = [
            reachX,
            this.currentSwingType === "overhead"
              ? reachY + 0.15
              : this.currentSwingType === "lift"
                ? reachY - 0.08
                : reachY,
            reachZ + 0.1,
          ];

          if (this.currentSwingType === "overhead") {
            this.strokeP2 = [reachX - 0.28, reachY - 0.48, reachZ + 0.45];
          } else if (this.currentSwingType === "lift") {
            this.strokeP2 = [reachX - 0.18, reachY + 0.62, reachZ + 0.38];
          } else if (this.currentSwingType === "backhand") {
            this.strokeP2 = [reachX + 0.4, reachY + 0.15, reachZ + 0.4];
          } else {
            this.strokeP2 = [reachX - 0.4, reachY + 0.15, reachZ + 0.4];
          }
        } else if (
          sensoryInput &&
          (sensoryInput.shuttleVel[2] >= 0 ||
            sensoryInput.shuttlePos[2] < flyZ - 0.8)
        ) {
          this.racketState = "RECOVER";
          this.cooldownTimer = 0.2;
        }
        break;
      }

      case "STRIKE": {
        this.strokeTime += dt;
        const u = Math.min(1.0, this.strokeTime / this.strokeDuration);

        // Quadratic Bézier curve: P(u) = (1-u)^2*P0 + 2(1-u)*u*P1 + u^2*P2
        const invU = 1.0 - u;
        const w0 = invU * invU;
        const w1 = 2.0 * invU * u;
        const w2 = u * u;

        const nextX =
          w0 * this.strokeP0[0] + w1 * this.strokeP1[0] + w2 * this.strokeP2[0];
        const nextY =
          w0 * this.strokeP0[1] + w1 * this.strokeP1[1] + w2 * this.strokeP2[1];
        const nextZ =
          w0 * this.strokeP0[2] + w1 * this.strokeP1[2] + w2 * this.strokeP2[2];

        // Derivative: V(u) = (2(1-u)(P1-P0) + 2u(P2-P1)) / duration
        const derivFactor = 1.0 / this.strokeDuration;
        const dvX =
          (2.0 * invU * (this.strokeP1[0] - this.strokeP0[0]) +
            2.0 * u * (this.strokeP2[0] - this.strokeP1[0])) *
          derivFactor;
        const dvY =
          (2.0 * invU * (this.strokeP1[1] - this.strokeP0[1]) +
            2.0 * u * (this.strokeP2[1] - this.strokeP1[1])) *
          derivFactor;
        const dvZ =
          (2.0 * invU * (this.strokeP1[2] - this.strokeP0[2]) +
            2.0 * u * (this.strokeP2[2] - this.strokeP1[2])) *
          derivFactor;

        this.currentRacketPos = [nextX, nextY, nextZ];
        this.currentRacketVel = [dvX, dvY, dvZ];

        // Dynamic rotation through stroke
        if (this.currentSwingType === "backhand") {
          this.racketRotationZ = -0.75 + u * 1.6;
        } else if (this.currentSwingType === "forehand") {
          this.racketRotationZ = 0.75 - u * 1.6;
        } else if (this.currentSwingType === "overhead") {
          this.racketRotationZ = -0.5 + u * 0.9;
        } else {
          this.racketRotationZ = 0.6 - u * 0.8;
        }

        if (u >= 1.0) {
          this.racketState = "RECOVER";
          this.cooldownTimer = isDemo ? 0.22 : 0.28;
        }
        break;
      }

      case "RECOVER": {
        this.cooldownTimer -= dt;
        const restTarget: [number, number, number] = [
          flyX + 0.48,
          flyY - 0.15,
          flyZ + 0.3,
        ];
        this.currentRacketPos[0] +=
          (restTarget[0] - this.currentRacketPos[0]) * Math.min(1.0, dt * 12);
        this.currentRacketPos[1] +=
          (restTarget[1] - this.currentRacketPos[1]) * Math.min(1.0, dt * 12);
        this.currentRacketPos[2] +=
          (restTarget[2] - this.currentRacketPos[2]) * Math.min(1.0, dt * 12);
        this.racketRotationZ +=
          (0.4 - this.racketRotationZ) * Math.min(1.0, dt * 8);
        this.currentRacketVel = [0, 0, 0];

        if (this.cooldownTimer <= 0) {
          this.racketState = "IDLE";
        }
        break;
      }
    }

    // 5. Virtual Opponent Flight State (For Three.js Animation / Telemetry)
    let flightState: FlyMotorCommand["flightState"] = "HOVER";
    if (this.racketState === "STRIKE" || swingTriggered) {
      flightState = "STRIKE";
    } else if (this.racketState === "PREPARE") {
      flightState = "PURSUIT";
    } else if (
      Math.abs(this.smoothedVx) > 0.35 ||
      Math.abs(this.smoothedVz) > 0.35
    ) {
      flightState = "PURSUIT";
    } else if (bio.brakingDrive > 0.4 || this.racketState === "RECOVER") {
      flightState = "RECOVER";
    }

    return {
      biological: bio,
      vx: this.smoothedVx,
      vz: this.smoothedVz,
      steerTorque: bio.steeringTorque,
      swingTriggered,
      swingType: this.currentSwingType,
      swingPower: this.currentSwingPower,
      arousal: this.smoothedArousal,
      flightState,
      racketState: this.racketState,
      targetRacketPos: [...this.currentRacketPos],
      targetRacketVel: [...this.currentRacketVel],
      racketRotationZ: this.racketRotationZ,
      timeToContact: ttc,
      estimatedContactPoint: [...contactPoint],
      strokeProgress:
        this.racketState === "STRIKE"
          ? Math.min(1.0, this.strokeTime / this.strokeDuration)
          : 0,
    };
  }

  getRacketState(): EmbodimentRacketState {
    return this.racketState;
  }

  reset() {
    this.smoothedVx = 0;
    this.smoothedVz = 0;
    this.smoothedArousal = 0.2;
    this.racketState = "IDLE";
    this.currentRacketPos = [0.55, 1.25, -3.55];
    this.currentRacketVel = [0, 0, 0];
    this.racketRotationZ = 0.4;
    this.strokeTime = 0;
    this.cooldownTimer = 0;
    this.prepareTimer = 0;
    this.hasSwungThisShot = false;
  }
}
