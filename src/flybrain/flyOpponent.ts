import type { Settings } from "../config";
import { clamp, v, type V3 } from "../math";
import type { Shuttle } from "../physics";
import type {
  FlyMotorCommand,
  FlySensoryInput,
  NeuralTelemetrySnapshot,
} from "./types";
import { NeuralBridge } from "./neuralBridge";

export class FlyOpponent {
  x = 0;
  y = 1.4; // Hover altitude in meters
  z = -3.9;
  heading = 0; // facing +Z towards human court
  bridge: NeuralBridge;
  lastMotorCommand: FlyMotorCommand = {
    vx: 0,
    vz: 0,
    steerTorque: 0,
    swingTriggered: false,
    swingType: "forehand",
    swingPower: 0.5,
    arousal: 0.2,
    flightState: "HOVER",
  };
  swingAttempted = false;
  racketPos: V3 = v(0.55, 1.25, -3.55);
  previousRacket: V3 = v(0.55, 1.25, -3.55);
  racketRotationZ = 0.4;
  hoverTime = 0;
  swingActiveTime = 0;

  constructor() {
    this.bridge = new NeuralBridge();
  }

  async init(preferWorker = true, baseUrl = "/data/connectome", seed?: number) {
    await this.bridge.init(preferWorker, baseUrl, seed);
  }

  reset() {
    this.x = 0;
    this.y = 1.4;
    this.z = -3.9;
    this.heading = 0;
    this.swingAttempted = false;
    this.swingActiveTime = 0;
    this.hoverTime = 0;
    this.racketPos = v(0.55, 1.25, -3.55);
    this.previousRacket = v(0.55, 1.25, -3.55);
    this.bridge.reset();
  }

  setEmbodimentMode(mode: "demo-assist" | "scientific") {
    this.bridge.setEmbodimentMode(mode);
  }

  update(
    dt: number,
    shuttle: Shuttle,
    gameTime: number,
    settings: Settings,
  ): FlyMotorCommand {
    this.hoverTime += dt;
    this.previousRacket = { ...this.racketPos };

    // Prepare optical sensory input for the connectome
    const sensoryInput: FlySensoryInput = {
      shuttlePos: [shuttle.p.x, shuttle.p.y, shuttle.p.z],
      shuttleVel: [shuttle.velocity.x, shuttle.velocity.y, shuttle.velocity.z],
      flyPos: [this.x, this.y, this.z],
      flyHeading: this.heading,
      time: gameTime,
    };

    // Update connectome neural dynamics
    const motor = this.bridge.update(
      dt,
      sensoryInput,
      settings.flyEmbodimentMode,
    );
    this.lastMotorCommand = motor;

    if (motor.swingTriggered) {
      this.swingActiveTime = 0.28; // Swing stroke active for 280ms
    } else {
      this.swingActiveTime = Math.max(0, this.swingActiveTime - dt);
    }

    // Apply lateral & longitudinal velocity decoded from DNa02 & DNp01 descending neurons
    const difficultyMultiplier = settings.difficulty === "normal" ? 1.35 : 1.05;
    const effectiveVx = motor.vx * difficultyMultiplier;
    const effectiveVz = motor.vz * difficultyMultiplier;

    this.x += effectiveVx * dt;
    this.z += effectiveVz * dt;

    // Constrain to fly's court boundaries
    this.x = clamp(this.x, -2.6, 2.6);
    this.z = clamp(this.z, -6.1, -0.8);

    // Natural flight hover oscillation modulated by wing arousal
    const hoverFreq = 4.0 + motor.arousal * 6.0;
    const hoverAmp = 0.05 + (1.0 - motor.arousal) * 0.04;
    this.y = 1.4 + Math.sin(this.hoverTime * hoverFreq) * hoverAmp;

    // Update heading based on steer torque
    this.heading = clamp(motor.steerTorque * 0.25, -0.4, 0.4);

    // Update fly racket position and rotation from EmbodimentAdapter
    if (motor.targetRacketPos) {
      this.racketPos = v(
        motor.targetRacketPos[0],
        motor.targetRacketPos[1],
        motor.targetRacketPos[2],
      );
      this.racketRotationZ = motor.racketRotationZ ?? 0.4;
    } else {
      const isStriking =
        this.swingActiveTime > 0 || motor.flightState === "STRIKE";
      const isBackhand = motor.swingType === "backhand" || this.x > shuttle.p.x;
      const targetRacketX = this.x + (isBackhand ? -0.45 : 0.45);
      const targetRacketY = isStriking ? this.y + 0.35 : this.y - 0.15;
      const targetRacketZ = this.z + (isStriking ? 0.65 : 0.3);

      const lerpSpeed = isStriking ? 32 : 16;
      this.racketPos.x +=
        (targetRacketX - this.racketPos.x) * Math.min(1.0, dt * lerpSpeed);
      this.racketPos.y +=
        (targetRacketY - this.racketPos.y) * Math.min(1.0, dt * lerpSpeed);
      this.racketPos.z +=
        (targetRacketZ - this.racketPos.z) * Math.min(1.0, dt * lerpSpeed);
      this.racketRotationZ = isStriking ? (isBackhand ? 0.95 : -0.95) : 0.4;
    }

    if (motor.racketState === "STRIKE" || motor.swingTriggered) {
      this.swingActiveTime = 0.26;
    } else {
      this.swingActiveTime = Math.max(0, this.swingActiveTime - dt);
    }

    return motor;
  }

  getTelemetry(): NeuralTelemetrySnapshot | null {
    return this.bridge.getTelemetry();
  }
}
