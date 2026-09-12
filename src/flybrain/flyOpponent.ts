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
  racketRotationZ = 0.4;
  hoverTime = 0;

  constructor() {
    this.bridge = new NeuralBridge();
  }

  async init(preferWorker = true, baseUrl = "/data/connectome") {
    await this.bridge.init(preferWorker, baseUrl);
  }

  reset() {
    this.x = 0;
    this.y = 1.4;
    this.z = -3.9;
    this.heading = 0;
    this.swingAttempted = false;
    this.hoverTime = 0;
    this.racketPos = v(0.55, 1.25, -3.55);
    this.bridge.reset();
  }

  update(
    dt: number,
    shuttle: Shuttle,
    gameTime: number,
    settings: Settings,
  ): FlyMotorCommand {
    this.hoverTime += dt;

    // Prepare optical sensory input for the connectome
    const sensoryInput: FlySensoryInput = {
      shuttlePos: [shuttle.p.x, shuttle.p.y, shuttle.p.z],
      shuttleVel: [shuttle.velocity.x, shuttle.velocity.y, shuttle.velocity.z],
      flyPos: [this.x, this.y, this.z],
      flyHeading: this.heading,
      time: gameTime,
    };

    // Update connectome neural dynamics
    const motor = this.bridge.update(dt, sensoryInput);
    this.lastMotorCommand = motor;

    // Apply lateral & longitudinal velocity decoded from DNa02 & DNp01 descending neurons
    const difficultyMultiplier = settings.difficulty === "normal" ? 1.3 : 1.0;
    const effectiveVx = motor.vx * difficultyMultiplier;
    const effectiveVz = motor.vz * difficultyMultiplier;

    this.x += effectiveVx * dt;
    this.z += effectiveVz * dt;

    // Constrain to fly's court boundaries
    this.x = clamp(this.x, -2.5, 2.5);
    this.z = clamp(this.z, -6.1, -0.8);

    // Natural flight hover oscillation modulated by wing arousal
    const hoverFreq = 4.0 + motor.arousal * 6.0;
    const hoverAmp = 0.05 + (1.0 - motor.arousal) * 0.04;
    this.y = 1.4 + Math.sin(this.hoverTime * hoverFreq) * hoverAmp;

    // Update heading based on steer torque
    this.heading = clamp(motor.steerTorque * 0.25, -0.4, 0.4);

    // Update fly racket position based on strike state
    const isStriking = motor.swingTriggered || motor.flightState === "STRIKE";
    const targetRacketX =
      this.x + (motor.swingType === "backhand" ? -0.45 : 0.55);
    const targetRacketY = isStriking ? this.y + 0.4 : this.y - 0.15;
    const targetRacketZ = this.z + 0.35;

    this.racketPos.x +=
      (targetRacketX - this.racketPos.x) * Math.min(1.0, dt * 18);
    this.racketPos.y +=
      (targetRacketY - this.racketPos.y) * Math.min(1.0, dt * 18);
    this.racketPos.z +=
      (targetRacketZ - this.racketPos.z) * Math.min(1.0, dt * 18);
    this.racketRotationZ = isStriking
      ? motor.swingType === "backhand"
        ? 0.9
        : -0.9
      : 0.4;

    return motor;
  }

  getTelemetry(): NeuralTelemetrySnapshot | null {
    return this.bridge.getTelemetry();
  }
}
