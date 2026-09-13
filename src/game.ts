import { C, type Settings } from "./config";
import {
  clamp,
  len,
  v,
  mix,
  sweptDistance,
  type V3,
  add,
  sub,
  mul,
} from "./math";
import {
  integrate,
  inCourt,
  netCrossing,
  predictInterception,
  shotVelocity,
  MatchManager,
  type Shuttle,
} from "./physics";
import { neutralMotion, type Motion, type Intent } from "./motion";
import { FlyOpponent } from "./flybrain/flyOpponent";
import type {
  FlyContactDiagnostic,
  FlyMissReason,
  HumanContactDiagnostic,
  HumanHitRejectedReason,
} from "./flybrain/types";

export type GameEvent = {
  type: "hit" | "point" | "net" | "serve" | "swing";
  text: string;
  position?: V3;
  speed?: number;
};

export class OpponentAI {
  x = 0;
  z = -3.9;
  state: "WAIT" | "MOVE" | "SWING" | "RECOVER" = "WAIT";
  timer = 0;
  target = v(0, 1.4, -3.9);
  attempted = false;

  incoming(s: Shuttle, settings: Settings) {
    const interception = predictInterception(s, false);
    this.target = interception.target;
    this.timer = C.ai[settings.difficulty].reaction;
    this.state = "WAIT";
    this.attempted = false;
  }

  update(dt: number, settings: Settings) {
    this.timer -= dt;
    if (this.state === "WAIT" && this.timer <= 0) this.state = "MOVE";
    if (this.state === "MOVE" || this.state === "RECOVER") {
      const target = this.state === "RECOVER" ? v(0, 0, -3.9) : this.target;
      let speedMult = 1.0;
      if (this.state === "RECOVER") {
        speedMult = settings.difficulty === "easy" ? 0.35 : 0.75;
      }
      const speed = C.ai[settings.difficulty].speed * speedMult * dt;
      this.x += clamp(target.x - this.x, -speed, speed);
      this.z += clamp(target.z - this.z, -speed, speed);
      this.x = clamp(this.x, -2.4, 2.4);
      this.z = clamp(this.z, -6.0, -0.8);
    }
  }
}

export class Game {
  match = new MatchManager();
  ai = new OpponentAI();
  fly = new FlyOpponent();
  shuttle: Shuttle = {
    p: v(0.5, 1.3, 3.2),
    prev: v(0.5, 1.3, 3.2),
    velocity: v(),
    lastHit: 0,
  };
  state: "ready" | "rally" | "point" | "over" = "ready";
  timer = 0;
  time = 0;
  hits = 0;
  bestRally = 0;
  totalHits = 0;

  // Auto-footwork player positioning
  playerPos: V3 = v(0, 0, C.playerBase.z);
  targetPos: V3 = v(0, 0, C.playerBase.z);
  footworkState: "READY" | "INTERCEPTING" | "RECOVERING" = "READY";
  playerX = 0;

  racket = v(0.5, 1.5, 3.4);
  previousRacket = { ...this.racket };
  motion = neutralMotion();
  usedSwing = -1;
  primedSwing: {
    id: number;
    intent: Intent;
    time: number;
    swingStart: number;
  } | null = null;
  armedPrediction: {
    id: number;
    intent: Intent;
    time: number;
    swingStart: number;
  } | null = null;
  lastHumanDiagnostic: HumanContactDiagnostic | null = null;
  lastContact = -10;
  events: GameEvent[] = [];
  lastShot = "READY";
  history: {
    time: number;
    racket: V3;
    prevRacket: V3;
    shuttleP: V3;
    shuttlePrev: V3;
  }[] = [];

  constructor(
    public settings: Settings,
    public random = Math.random,
  ) {
    if (this.settings.flyEmbodimentMode) {
      this.fly.setEmbodimentMode(this.settings.flyEmbodimentMode);
    }
  }

  setMotion(m: Motion) {
    this.motion = m;
  }

  get opponentX(): number {
    return this.settings.opponentType === "fruitfly" ? this.fly.x : this.ai.x;
  }

  get opponentY(): number {
    return this.settings.opponentType === "fruitfly" ? this.fly.y : 1.4;
  }

  get opponentZ(): number {
    return this.settings.opponentType === "fruitfly" ? this.fly.z : this.ai.z;
  }

  reset() {
    this.match = new MatchManager();
    this.ai = new OpponentAI();
    this.fly.reset();
    this.hits = 0;
    this.bestRally = 0;
    this.totalHits = 0;
    this.playerPos = v(0, 0, C.playerBase.z);
    this.targetPos = v(0, 0, C.playerBase.z);
    this.footworkState = "READY";
    this.ready();
  }

  ready() {
    this.state = "ready";
    this.timer = 0;
    this.usedSwing = this.motion.swingId;
    this.primedSwing = null;
    this.shuttle.velocity = v();
    this.hits = 0;
    this.footworkState = "READY";
    this.targetPos = v(0, 0, C.playerBase.z);
    this.fly.swingAttempted = false;
    this.lastShot =
      this.match.server === 0 ? "SWING TO SERVE" : "OPPONENT SERVING";
    this.history = [];
  }

  step(dt: number) {
    this.time += dt;
    this.timer += dt;
    this.previousRacket = { ...this.racket };

    // --- Auto Footwork & Intent Blending ---
    if (
      this.state === "rally" &&
      this.shuttle.lastHit === 1 &&
      this.shuttle.p.z > -0.5
    ) {
      const interception = predictInterception(this.shuttle, true);
      let targetX = interception.target.x;
      let targetZ = interception.target.z;

      // Small intent adjustments to target positioning
      if (this.motion.intentDirection === "front") targetZ -= 0.35;
      else if (this.motion.intentDirection === "back") targetZ += 0.35;

      this.targetPos = v(
        clamp(targetX - 0.35, -2.4, 2.4),
        0,
        clamp(targetZ + 0.4, 1.8, 5.6),
      );
      this.footworkState = "INTERCEPTING";
    } else if (this.state === "rally" && this.shuttle.lastHit === 0) {
      this.footworkState = "RECOVERING";
      this.targetPos = v(0, 0, C.playerBase.z);
    } else if (this.state === "ready" || this.state === "point") {
      this.footworkState = "READY";
      this.targetPos = v(0, 0, C.playerBase.z);
    }

    // Determine movement speed according to state and intent
    let moveSpeed =
      this.footworkState === "INTERCEPTING"
        ? C.playerSpeed[this.settings.assist] * this.settings.movement
        : C.recoverySpeed[this.settings.assist] * this.settings.movement;

    if (this.footworkState === "INTERCEPTING") {
      const dx = this.targetPos.x - this.playerPos.x;
      const intentDir = this.motion.intentDirection;

      // Intent boost when player intent agrees with shuttle direction
      if (
        (intentDir === "right" && dx > 0.15) ||
        (intentDir === "left" && dx < -0.15)
      ) {
        moveSpeed *= C.intentBoost;
      }
      // Intent penalty if player leans in the opposite direction
      else if (
        (intentDir === "right" && dx < -0.3) ||
        (intentDir === "left" && dx > 0.3)
      ) {
        moveSpeed *= C.intentPenalty[this.settings.assist];
      }
    }

    const maxStep = moveSpeed * dt;
    this.playerPos.x += clamp(
      this.targetPos.x - this.playerPos.x,
      -maxStep,
      maxStep,
    );
    this.playerPos.z += clamp(
      this.targetPos.z - this.playerPos.z,
      -maxStep,
      maxStep,
    );
    this.playerPos.x = clamp(this.playerPos.x, -2.4, 2.4);
    this.playerPos.z = clamp(this.playerPos.z, 1.8, 5.8);
    this.playerX = this.playerPos.x;

    // Attach racket smoothly to moving avatar position
    const armRel = v(
      this.motion.racket.x - this.motion.playerX,
      this.motion.racket.y,
      this.motion.racket.z - 3.45,
    );
    const targetRacket = v(
      this.playerPos.x + armRel.x,
      clamp(armRel.y, 0.25, 3.5),
      this.playerPos.z - 0.4 + armRel.z,
    );
    this.racket = mix(this.racket, targetRacket, 1 - Math.exp(-dt * 35));

    this.ai.update(dt, this.settings);
    let flyMotor: any = null;
    if (this.settings.opponentType === "fruitfly") {
      flyMotor = this.fly.update(dt, this.shuttle, this.time, this.settings);
    }

    if (this.state === "over") return;

    if (this.state === "point") {
      if (this.timer > 1.7) {
        if (this.match.winner !== null) this.state = "over";
        else this.ready();
      }
      return;
    }

    if (this.state === "ready") {
      const side = this.match.server;
      const oppX =
        this.settings.opponentType === "fruitfly" ? this.fly.x : this.ai.x;
      const oppZ =
        this.settings.opponentType === "fruitfly" ? this.fly.z : this.ai.z;
      const heldPos =
        side === 0
          ? v(this.playerPos.x + 0.35, 1.05, this.playerPos.z - 0.5)
          : v(oppX, 1.15, oppZ);

      this.shuttle.p = { ...heldPos };
      this.shuttle.prev = { ...this.shuttle.p };

      if (side === 0) {
        // Human serve: Requires confirmed physical swing AND swept racket head intersection with held shuttle
        const isConfirmedSwing =
          this.motion.swing &&
          this.motion.confidence > C.confidence &&
          this.motion.swingId !== this.usedSwing;

        if (isConfirmedSwing) {
          const visualRadius =
            C.racketBladeRadius[this.settings.assist] || 0.42;
          const gameplayRadiusMult =
            this.settings.assist === "beginner" ? 2.0 : 1.2;
          const racketRadius = visualRadius * gameplayRadiusMult;

          const depthScale = this.settings.assist === "beginner" ? 2.0 : 1.4;
          const scaleP = (p: V3) => v(p.x, p.y, p.z * depthScale);

          let closestDistance = Infinity;
          if (!this.history || this.history.length === 0) {
            closestDistance = sweptDistance(
              scaleP(this.previousRacket),
              scaleP(this.racket),
              scaleP(heldPos),
              scaleP(heldPos),
            ).distance;
          } else {
            for (let i = 0; i < this.history.length; i++) {
              const frame = this.history[i];
              if (this.time - frame.time > 0.15) continue;
              // Ensure we only look at frames after the current swing started (approximated by swingId or simply allowing recent frames)
              const d = sweptDistance(
                scaleP(frame.prevRacket),
                scaleP(frame.racket),
                scaleP(heldPos),
                scaleP(heldPos),
              ).distance;
              if (d < closestDistance) closestDistance = d;
            }
          }

          if (closestDistance < racketRadius) {
            this.usedSwing = this.motion.swingId;
            this.hit(0, "serve");
          }
        }
      } else if (side === 1 && this.timer > 1.5) {
        this.hit(1, "serve");
      }
      return;
    }

    // --- Shuttle Flight & Faults ---
    integrate(this.shuttle, dt);
    const s = this.shuttle;

    if (netCrossing(s.prev, s.p)) {
      this.events.push({ type: "net", text: "Net", position: { ...s.p } });
      this.point((1 - s.lastHit) as 0 | 1, "NET");
      return;
    }

    if (s.p.y <= 0.03) {
      this.point(
        inCourt(s.p) ? (s.p.z > 0 ? 1 : 0) : ((1 - s.lastHit) as 0 | 1),
        inCourt(s.p) ? "SHUTTLE DOWN" : "OUT",
      );
      return;
    }

    if (Math.abs(s.p.z) > 10 || Math.abs(s.p.x) > 7) {
      this.point((1 - s.lastHit) as 0 | 1, "OUT");
      return;
    }

    // --- Swing Confirmation & Continuous Physical Swept Racket Contact ---
    // Confirmed swing authorization (predictedSwing alone NEVER authorizes hits)
    const isConfirmedSwing =
      this.motion.swing &&
      this.motion.confidence > C.confidence &&
      this.motion.swingId !== this.usedSwing;

    if (isConfirmedSwing) {
      this.primedSwing = {
        id: this.motion.swingId,
        intent: this.motion.intent,
        time: this.time,
        swingStart: this.time, // Add swing start time to use for history buffer constraint
      };
      this.armedPrediction = null;
    } else if (
      this.motion.predictedSwing &&
      this.motion.confidence > C.confidence &&
      this.motion.swingId !== this.usedSwing
    ) {
      // Latency tolerance: armed prediction prepares intent, but does NOT authorize hits on its own
      this.armedPrediction = {
        id: this.motion.swingId,
        intent: this.motion.intent,
        time: this.time,
        swingStart: this.time,
      };
    }

    // Check if armed prediction expires
    if (this.armedPrediction && this.time - this.armedPrediction.time > 0.14) {
      this.armedPrediction = null;
    }

    // Check if primed swing is still valid inside timing window
    if (
      this.primedSwing &&
      this.time - this.primedSwing.time > C.timingWindow[this.settings.assist]
    ) {
      this.primedSwing = null;
    }

    // Keep history of racket and shuttle positions for latency tolerance
    if (!this.history) this.history = [];
    this.history.push({
      time: this.time,
      racket: { ...this.racket },
      prevRacket: { ...this.previousRacket },
      shuttleP: { ...s.p },
      shuttlePrev: { ...s.prev },
    });
    if (this.history.length > 20) this.history.shift();

    if (s.lastHit === 1 && s.p.z > -0.5) {
      // 1. EXPAND EFFECTIVE HIT ZONE
      const visualRadius = C.racketBladeRadius[this.settings.assist] || 0.42;
      const gameplayRadiusMult =
        this.settings.assist === "beginner" ? 2.0 : 1.2;
      const racketRadius = visualRadius * gameplayRadiusMult;

      const depthScale = this.settings.assist === "beginner" ? 2.0 : 1.4;
      const scaleP = (p: V3) => v(p.x, p.y, p.z * depthScale);

      // 2. SHORT BUFFER LATENCY TOLERANCE
      // We check if the racket and shuttle intersected at ANY point in our recent ~150ms buffer
      let closestDistance = Infinity;

      const allowedHistoryTime = this.primedSwing
        ? this.primedSwing.swingStart - 0.15
        : this.time - 0.15;

      for (let i = 0; i < this.history.length; i++) {
        const frame = this.history[i];
        if (frame.time < allowedHistoryTime) continue; // Only evaluate up to 150ms before swing start

        const d = sweptDistance(
          scaleP(frame.prevRacket),
          scaleP(frame.racket),
          scaleP(frame.shuttlePrev),
          scaleP(frame.shuttleP),
        ).distance;

        if (d < closestDistance) closestDistance = d;
      }

      // Best distance is closest historical distance
      let hitAccepted = false;
      let hitRejectedReason: HumanHitRejectedReason = "NONE";

      if (!this.primedSwing) {
        hitRejectedReason = "NO_CONFIRMED_SWING";
      } else if (this.primedSwing.id === this.usedSwing) {
        hitRejectedReason = "SWING_ALREADY_USED";
      } else if (this.time - this.lastContact <= 0.18) {
        hitRejectedReason = "STALE_SWING";
      } else if (s.p.y < 0.15 || s.p.y > 3.8) {
        hitRejectedReason = "SHUTTLE_WRONG_SIDE";
      } else if (closestDistance >= racketRadius) {
        hitRejectedReason = "NO_PHYSICAL_CONTACT";
      } else {
        hitAccepted = true;
        this.usedSwing = this.primedSwing.id;
        const hitIntent = this.primedSwing.intent;
        this.primedSwing = null;
        this.armedPrediction = null;
        this.lastContact = this.time;

        // Ensure visual effect for contact
        this.events.push({
          type: "swing", // Use a generic event or we can rely on "hit" which pushes event anyway
          text: "CONTACT",
          position: { ...s.p },
        });

        this.hit(0, hitIntent);
        this.footworkState = "RECOVERING";
      }

      this.lastHumanDiagnostic = {
        time: this.time,
        humanSwingId: this.motion.swingId,
        predictedSwing: this.motion.predictedSwing,
        confirmedSwing: this.motion.swing,
        motionState: this.motion.state,
        racketPrev: [
          this.previousRacket.x,
          this.previousRacket.y,
          this.previousRacket.z,
        ],
        racketCurrent: [this.racket.x, this.racket.y, this.racket.z],
        shuttlePrev: [s.prev.x, s.prev.y, s.prev.z],
        shuttleCurrent: [s.p.x, s.p.y, s.p.z],
        sweptDistance: closestDistance,
        contactRadius: racketRadius,
        contactTime: this.time,
        hitAccepted,
        hitRejectedReason,
      };
    }

    // --- Opponent Return Logic ---
    if (this.settings.opponentType === "fruitfly") {
      const flyMotor = this.fly.lastMotorCommand;
      const rPos = this.fly.racketPos;
      const prevRPos = this.fly.previousRacket;

      // Track diagnostic telemetry during incoming shot
      if (s.lastHit === 0) {
        const dX = s.p.x - rPos.x;
        const dY = s.p.y - rPos.y;
        const dZ = s.p.z - rPos.z;
        const instDist = Math.sqrt(dX * dX + dY * dY + dZ * dZ);

        if (
          this.currentShotDiagnostic &&
          instDist < this.currentShotDiagnostic.closestDistance
        ) {
          this.currentShotDiagnostic.closestDistance = instDist;
          this.currentShotDiagnostic.closestTime = this.time;
          this.currentShotDiagnostic.racketAtClosest = [rPos.x, rPos.y, rPos.z];
          this.currentShotDiagnostic.shuttleAtClosest = [s.p.x, s.p.y, s.p.z];
          this.currentShotDiagnostic.flyAtClosest = [
            this.fly.x,
            this.fly.y,
            this.fly.z,
          ];
          this.currentShotDiagnostic.racketStateAtClosest =
            flyMotor?.racketState ?? "IDLE";
          this.currentShotDiagnostic.neuralReadiness = flyMotor?.arousal ?? 0.2;
        }

        if (this.currentShotDiagnostic) {
          if (
            this.currentShotDiagnostic.visualOnsetTime === 0 &&
            s.velocity.z < -0.2
          ) {
            this.currentShotDiagnostic.visualOnsetTime = this.time;
          }
          if (
            flyMotor?.arousal &&
            flyMotor.arousal > 0.25 &&
            this.currentShotDiagnostic.motorOnsetTime === 0
          ) {
            this.currentShotDiagnostic.motorOnsetTime = this.time;
          }
          if (flyMotor?.estimatedContactPoint) {
            this.currentShotDiagnostic.predictedContactZ =
              flyMotor.estimatedContactPoint[2];
            if (!this.currentShotDiagnostic.flyZAtPrediction) {
              this.currentShotDiagnostic.flyZAtPrediction = this.fly.z;
            }
            this.currentShotDiagnostic.depthError =
              flyMotor.estimatedContactPoint[2] - (this.fly.z + 0.25);
          }
          if (flyMotor) {
            this.currentShotDiagnostic.targetVz = flyMotor.vz;
            this.currentShotDiagnostic.actualVz = flyMotor.vz;
            this.currentShotDiagnostic.neuralLocomotorDrive =
              flyMotor.biological?.locomotorDrive;
            if (
              flyMotor.vz < -0.2 &&
              (!this.currentShotDiagnostic.retreatStartedTime ||
                this.currentShotDiagnostic.retreatStartedTime === 0)
            ) {
              this.currentShotDiagnostic.retreatStartedTime = this.time;
            }
          }
          if (
            flyMotor?.racketState === "PREPARE" &&
            this.currentShotDiagnostic.prepareTime === 0
          ) {
            this.currentShotDiagnostic.prepareTime = this.time;
            if (
              flyMotor?.timeToContact !== undefined &&
              flyMotor.timeToContact > 0 &&
              flyMotor.timeToContact < 4.0
            ) {
              const predTime = this.time + flyMotor.timeToContact;
              this.currentShotDiagnostic.predictedContactTime = predTime;
              this.currentShotDiagnostic.predictedContactTimeAtPrepare =
                predTime;
            }
          }
          if (
            (flyMotor?.racketState === "STRIKE" || flyMotor?.swingTriggered) &&
            this.currentShotDiagnostic.strikeTime === 0
          ) {
            this.currentShotDiagnostic.strikeTime = this.time;
          }
        }
      }

      if (
        s.lastHit === 0 &&
        s.p.z < -0.2 &&
        s.p.y < 3.4 &&
        s.p.y > 0.2 &&
        !this.fly.swingAttempted
      ) {
        // Physical continuous swept distance between racket trajectory and shuttle trajectory
        const racketContact = sweptDistance(prevRPos, rPos, s.prev, s.p);

        // Fly must have an active strike stroke or preparatory swing state AND physical blade contact
        const isSwinging =
          (flyMotor &&
            (flyMotor.swingTriggered ||
              flyMotor.racketState === "STRIKE" ||
              flyMotor.flightState === "STRIKE")) ||
          this.fly.swingActiveTime > 0;

        const racketBladeRadius =
          this.settings.flyEmbodimentMode === "scientific" ? 0.65 : 0.82;

        if (isSwinging && racketContact.distance < racketBladeRadius) {
          this.fly.swingAttempted = true;

          // Fly contact quality
          let quality = 1.0;

          // Penalty for off-center contact
          if (racketContact.distance > 0.2) {
            quality -=
              ((racketContact.distance - 0.2) / racketBladeRadius) * 0.4;
          }

          // Penalty for low neural arousal (not ready)
          if (flyMotor && flyMotor.arousal < 0.5) {
            quality -= (0.5 - flyMotor.arousal) * 0.5;
          }

          // Penalty for late/early strike
          if (
            this.currentShotDiagnostic &&
            this.currentShotDiagnostic.closestTime > 0
          ) {
            const timingError = Math.abs(
              this.time - this.currentShotDiagnostic.closestTime,
            );
            if (timingError > 0.1) {
              quality -= (timingError - 0.1) * 2.0; // Rapidly drops off if highly mistimed
            }
          }

          quality = clamp(quality, 0.1, 1);

          if (this.currentShotDiagnostic) {
            this.currentShotDiagnostic.result = "HIT";
            this.currentShotDiagnostic.closestDistance = Math.min(
              this.currentShotDiagnostic.closestDistance,
              racketContact.distance,
            );
            if (
              this.currentShotDiagnostic.strikeTime > 0 &&
              this.currentShotDiagnostic.closestTime > 0
            ) {
              this.currentShotDiagnostic.actualStrikeTimingError = Math.abs(
                this.currentShotDiagnostic.strikeTime -
                  this.currentShotDiagnostic.closestTime,
              );
            }
            if (
              this.currentShotDiagnostic.predictedContactTimeAtPrepare &&
              this.currentShotDiagnostic.closestTime > 0
            ) {
              this.currentShotDiagnostic.predictionErrorAtPrepare = Math.abs(
                this.currentShotDiagnostic.predictedContactTimeAtPrepare -
                  this.currentShotDiagnostic.closestTime,
              );
            }
            this.diagnosticHistory.push({ ...this.currentShotDiagnostic });
            if (this.diagnosticHistory.length > 50) {
              this.diagnosticHistory.shift();
            }
          }

          // Calculate explicit physical outgoing velocity from racket state
          const isScientific = this.settings.flyEmbodimentMode === "scientific";
          const racketVel = flyMotor.targetRacketVel || [0, 0, 0];
          const powerLevel = flyMotor.swingPower || 0.5;
          const baseVz = 10 + powerLevel * 14;

          const contactOffset = (s.p.x - rPos.x) * 3.5;
          let vx =
            racketVel[0] * 0.45 +
            this.fly.x * -1.2 +
            contactOffset * (1 - quality);
          let vy = 3.8 + racketVel[1] * 0.4 + powerLevel * 5.5;
          let vz = Math.max(8, baseVz * quality + racketVel[2] * 0.3);

          if (!isScientific) {
            // Slight organic variation in demo-assist if off-center contact
            vx += (this.random() - 0.5) * (1 - quality) * 1.5;
            vz += (this.random() - 0.5) * (1 - quality) * 1.5;
          }

          if (this.settings.assist === "beginner" && this.totalHits < 6) {
            vz *= 0.8;
            vy += 2.0;
          }

          const outVelocity = v(vx, vy, vz);
          this.hit(1, outVelocity, quality);
        }
      }
    } else {
      if (
        s.lastHit === 0 &&
        s.p.z < -0.6 &&
        s.velocity.y < 0 &&
        s.p.y < 2.2 &&
        s.p.y > 0.2 &&
        this.ai.state === "MOVE" &&
        !this.ai.attempted
      ) {
        // Physical geometry of the contact
        const latDist = Math.abs(s.p.x - this.ai.x);
        const depthDist = Math.abs(s.p.z - this.ai.z);
        const reachDist = Math.hypot(latDist, depthDist);

        if (reachDist < 1.8) {
          this.ai.attempted = true;
          this.ai.state = "SWING";

          // Compute contact quality (0 to 1)
          let quality = 1.0;

          // Penalty for reaching far (beyond 0.6m)
          if (reachDist > 0.6) quality -= ((reachDist - 0.6) / 1.2) * 0.4;

          // Penalty for very low contact
          if (s.p.y < 0.8) quality -= (0.8 - s.p.y) * 0.5;

          // Penalty for fast incoming shot
          const incomingSpeed = len(s.velocity);
          if (incomingSpeed > 10) quality -= (incomingSpeed - 10) * 0.03;

          quality = clamp(quality, 0.1, 1);

          // Return probability based on difficulty and quality
          let missChance = C.ai[this.settings.difficulty].miss;
          if (this.settings.difficulty === "easy") {
            missChance += (1 - quality) * 0.55;
          } else {
            missChance += (1 - quality) * 0.3;
          }

          if (this.random() > missChance) {
            const intents: Intent[] = ["clear", "drive", "drop", "lift"];
            this.hit(
              1,
              intents[Math.floor(this.random() * intents.length)],
              quality,
            );
          } else {
            // Register a visual miss for diagnostics if needed, or simply let it fall
          }
          this.ai.state = "RECOVER";
        }
      }
    }
  }

  hit(
    side: 0 | 1,
    intentOrVelocity: Intent | "serve" | V3,
    quality: number = 1.0,
  ) {
    const s = this.shuttle;
    const incomingSpeed = len(s.velocity);
    let velocity: V3;
    let intentStr = "HIT";
    let intent: Intent | "serve" = "clear";

    if (typeof intentOrVelocity === "object") {
      // Direct physics-driven hit (Fruit-Fly)
      velocity = intentOrVelocity;
    } else {
      // Heuristic aim (Classic AI & Human)
      intent = intentOrVelocity as Intent | "serve";
      intentStr = intent.toUpperCase();
      const timing =
        side === 0 ? clamp((this.racket.z - s.p.z) / 1.1, -1, 1) : 0;
      let power = 0.55;
      const sign = side === 0 ? -1 : 1;

      const depth = intent === "drop" ? 2.8 : intent === "smash" ? 4.2 : 5.1;

      let aim = 0;
      if (side === 0) {
        aim =
          this.motion.direction.x * 2.2 +
          this.playerPos.x * 0.15 +
          timing * 0.2;
        if (this.motion.intentDirection === "left") aim -= 0.6;
        else if (this.motion.intentDirection === "right") aim += 0.6;

        aim = clamp(aim, -2.5, 2.5);

        if (this.settings.assist === "beginner") {
          if (aim > 1.5) aim = 1.5 + (aim - 1.5) * 0.3;
          if (aim < -1.5) aim = -1.5 + (aim + 1.5) * 0.3;
        }

        power = clamp(
          this.motion.power * 0.95 +
            incomingSpeed / 130 -
            Math.abs(timing) * 0.05,
          0.18,
          1,
        );
        this.fly.swingAttempted = false;

        this.shotCount++;
        this.currentShotDiagnostic = {
          shotId: this.shotCount,
          scenario: intent === "serve" ? "SERVE" : intent.toUpperCase(),
          visualOnsetTime: 0,
          motorOnsetTime: 0,
          prepareTime: 0,
          strikeTime: 0,
          predictedContactTime: 0,
          closestDistance: 999,
          closestTime: 0,
          racketAtClosest: [
            this.fly.racketPos.x,
            this.fly.racketPos.y,
            this.fly.racketPos.z,
          ],
          shuttleAtClosest: [s.p.x, s.p.y, s.p.z],
          flyAtClosest: [this.fly.x, this.fly.y, this.fly.z],
          result: "MISS",
          racketStateAtClosest: "IDLE",
          neuralReadiness: this.fly.lastMotorCommand?.arousal ?? 0.2,
          mode: this.settings.flyEmbodimentMode,
        };
      } else {
        // Classic AI heuristic aiming
        aim = clamp(
          -this.playerPos.x * 0.25 + (this.random() - 0.5) * 2.5,
          -1.8,
          1.8,
        );
        power = 0.55;
        if (this.settings.assist === "beginner" && this.totalHits < 6) {
          const handicap = 0.75 + (1.0 - 0.75) * (this.totalHits / 6);
          power *= handicap;
        }
      }

      if (side === 1) {
        power *= 0.65 + 0.35 * quality;
      }

      const error =
        side === 0
          ? 0
          : C.ai[this.settings.difficulty].error *
            (this.random() - 0.5) *
            (1 + (1 - quality) * 3);
      const target = v(aim + error, 0.03, sign * depth);

      if (intent === "smash" && s.p.y < 2.3) intent = "drive";
      velocity = shotVelocity(s.p, target, intent, power);

      // Assisted net clearance
      if (
        side === 0 ||
        (side === 1 && quality > 0.75 && this.settings.difficulty === "normal")
      ) {
        const trial: Shuttle = {
          p: { ...s.p },
          prev: { ...s.p },
          velocity: { ...velocity },
          lastHit: side,
        };
        for (let i = 0; i < 300; i++) {
          integrate(trial, C.dt);
          if (trial.prev.z * trial.p.z <= 0) {
            if (trial.p.y < C.netHeight + 0.15) {
              intent = "clear";
              velocity = shotVelocity(s.p, target, intent, power);
            }
            break;
          }
          if (trial.p.y < 0) break;
        }
      }
    }

    s.velocity = velocity;
    s.lastHit = side;
    this.state = "rally";
    this.lastContact = this.time;
    this.hits++;
    this.totalHits++;
    this.bestRally = Math.max(this.bestRally, this.hits);
    this.lastShot = intentStr;
    this.events.push({
      type: intent === "serve" ? "serve" : "hit",
      text: this.lastShot,
      position: { ...s.p },
      speed: len(velocity) * 3.6,
    });

    if (side === 0) {
      this.ai.incoming(s, this.settings);
    } else {
      const interception = predictInterception(s, true);
      this.targetPos = v(
        clamp(interception.target.x - 0.35, -2.4, 2.4),
        0,
        clamp(interception.target.z + 0.4, 1.8, 5.6),
      );
      this.footworkState = "INTERCEPTING";
    }
  }

  shotCount = 0;
  currentShotDiagnostic: FlyContactDiagnostic | null = null;
  diagnosticHistory: FlyContactDiagnostic[] = [];
  lastMissReason: FlyMissReason | string = "";
  lastContactMoment: { time: number; power: number; type: string } | null =
    null;

  diagnoseFlyMiss(): FlyMissReason {
    const s = this.shuttle;
    const bridge = this.fly.bridge;
    const engine = bridge.getEngine();
    const interventions = engine?.interventions;

    if (
      interventions?.isTypeSilenced("LC4") ||
      interventions?.isTypeSilenced("LC6") ||
      interventions?.isTypeSilenced("DNa02") ||
      interventions?.isTypeSilenced("DNa01") ||
      interventions?.isTypeSilenced("DNb01") ||
      interventions?.isTypeSilenced("DNp01")
    ) {
      return "PATHWAY SILENCED";
    }

    const latOffset = Math.abs(s.p.x - this.fly.x);
    if (latOffset > 1.25) {
      return "BODY MISS";
    }

    const diag = this.currentShotDiagnostic;
    const flyMotor = this.fly.lastMotorCommand;

    if (diag && diag.visualOnsetTime === 0 && flyMotor.arousal < 0.18) {
      return "NEURAL MISS";
    }

    if (diag && diag.strikeTime > 0) {
      if (diag.strikeTime > diag.closestTime + 0.05) {
        return "LATE STRIKE";
      }
      if (diag.strikeTime + 0.28 < diag.closestTime - 0.05) {
        return "EARLY STRIKE";
      }
    }

    if (diag) {
      const predZ = diag.predictedContactZ ?? s.p.z;
      const isDeepShot =
        predZ < -4.2 ||
        (diag.depthError !== undefined && diag.depthError < -0.25);
      if (isDeepShot) {
        if (predZ < -6.5) {
          diag.deepMissClassification = "UNREACHABLE_DEEP_SHOT";
        } else if (!diag.retreatStartedTime || diag.retreatStartedTime === 0) {
          diag.deepMissClassification = "NO_RETREAT";
        } else if (
          diag.retreatStartedTime -
            (diag.visualOnsetTime || diag.motorOnsetTime || 0) >
          0.45
        ) {
          diag.deepMissClassification = "RETREAT_TOO_LATE";
        } else {
          const flyZAtClosest = diag.flyAtClosest
            ? diag.flyAtClosest[2]
            : this.fly.z;
          const remainingZGap = flyZAtClosest - (predZ + 0.35);
          if (remainingZGap > 0.45) {
            diag.deepMissClassification = "RETREAT_TOO_SLOW";
          } else {
            diag.deepMissClassification = "RACKET_MISS";
          }
        }
      } else {
        diag.deepMissClassification = "NONE";
      }

      const vertDist = Math.abs(
        diag.racketAtClosest[1] - diag.shuttleAtClosest[1],
      );
      if (vertDist > 0.8) {
        return "VERTICAL MISS";
      }
      const latDist = Math.abs(
        diag.racketAtClosest[0] - diag.shuttleAtClosest[0],
      );
      if (latDist > 0.9) {
        return "LATERAL MISS";
      }
    }

    return "RACKET MISS";
  }

  feedSyntheticShot(
    scenario: "left" | "right" | "center" | "high" | "fast" | "drop" | "deep",
    params?: {
      originOffset?: { x?: number; y?: number; z?: number };
      speedMultiplier?: number;
      anglePerturbation?: { yaw?: number; pitch?: number };
      targetOffset?: { x?: number; y?: number; z?: number };
    },
  ) {
    this.ready();
    this.ai.x = 0;
    this.ai.z = -3.9;
    this.ai.state = "WAIT";
    this.ai.attempted = false;
    this.fly.x = 0;
    this.fly.y = 1.4;
    this.fly.z = -3.9;
    this.fly.bridge.reset();
    const startPos = scenario === "fast" ? v(0, 2.4, 3.8) : v(0, 1.2, 3.8);
    if (params?.originOffset) {
      startPos.x += params.originOffset.x ?? 0;
      startPos.y += params.originOffset.y ?? 0;
      startPos.z += params.originOffset.z ?? 0;
    }
    this.playerPos = v(startPos.x, 0, C.playerBase.z);
    this.racket = v(startPos.x + 0.3, startPos.y + 0.2, startPos.z - 0.4);
    this.shuttle.p = { ...startPos };
    this.shuttle.prev = { ...startPos };
    this.fly.swingAttempted = false;

    let target = v(0, 0.05, -4.2);
    let intent: Intent = "clear";
    let power = 0.6;

    if (scenario === "left") {
      target = v(-1.8, 0.05, -3.8);
      intent = "drive";
      power = 0.65;
    } else if (scenario === "right") {
      target = v(1.8, 0.05, -3.8);
      intent = "drive";
      power = 0.65;
    } else if (scenario === "center") {
      target = v(0, 0.05, -4.0);
      intent = "drive";
      power = 0.6;
    } else if (scenario === "high") {
      target = v(0.4, 0.05, -5.4);
      intent = "clear";
      power = 0.75;
    } else if (scenario === "fast") {
      target = v(-0.8, 0.05, -3.2);
      intent = "smash";
      power = 0.95;
    } else if (scenario === "drop") {
      target = v(0.6, 0.05, -1.8);
      intent = "drop";
      power = 0.45;
    } else if (scenario === "deep") {
      target = v(0, 0.05, -5.6);
      intent = "clear";
      power = 0.85;
    }

    if (params?.targetOffset) {
      target.x += params.targetOffset.x ?? 0;
      target.y += params.targetOffset.y ?? 0;
      target.z += params.targetOffset.z ?? 0;
    }

    this.shuttle.velocity = shotVelocity(this.shuttle.p, target, intent, power);

    if (params?.anglePerturbation) {
      const { yaw = 0, pitch = 0 } = params.anglePerturbation;
      const cosP = Math.cos(pitch);
      const sinP = Math.sin(pitch);
      const vy1 =
        this.shuttle.velocity.y * cosP - this.shuttle.velocity.z * sinP;
      const vz1 =
        this.shuttle.velocity.y * sinP + this.shuttle.velocity.z * cosP;
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      const vx2 = this.shuttle.velocity.x * cosY + vz1 * sinY;
      const vz2 = -this.shuttle.velocity.x * sinY + vz1 * cosY;
      this.shuttle.velocity.x = vx2;
      this.shuttle.velocity.y = vy1;
      this.shuttle.velocity.z = vz2;
    }

    if (params?.speedMultiplier) {
      this.shuttle.velocity.x *= params.speedMultiplier;
      this.shuttle.velocity.y *= params.speedMultiplier;
      this.shuttle.velocity.z *= params.speedMultiplier;
    }
    this.shuttle.lastHit = 0;
    this.state = "rally";
    this.lastContact = this.time;
    this.hits = 1;
    this.totalHits++;
    this.lastShot = `TEST: ${scenario.toUpperCase()}`;
    this.events.push({
      type: "hit",
      text: `TEST: ${scenario.toUpperCase()}`,
      position: { ...this.shuttle.p },
      speed: len(this.shuttle.velocity) * 3.6,
    });

    this.shotCount++;
    this.currentShotDiagnostic = {
      shotId: this.shotCount,
      scenario: scenario.toUpperCase(),
      visualOnsetTime: 0,
      motorOnsetTime: 0,
      prepareTime: 0,
      strikeTime: 0,
      predictedContactTime: 0,
      closestDistance: 999,
      closestTime: 0,
      racketAtClosest: [
        this.fly.racketPos.x,
        this.fly.racketPos.y,
        this.fly.racketPos.z,
      ],
      shuttleAtClosest: [this.shuttle.p.x, this.shuttle.p.y, this.shuttle.p.z],
      flyAtClosest: [this.fly.x, this.fly.y, this.fly.z],
      result: "MISS",
      racketStateAtClosest: "IDLE",
      neuralReadiness: this.fly.lastMotorCommand?.arousal ?? 0.2,
      mode: this.settings.flyEmbodimentMode,
    };
  }

  point(side: 0 | 1, reason: string) {
    if (side === 0 && this.settings.opponentType === "fruitfly") {
      this.lastMissReason = this.diagnoseFlyMiss();
      reason = `${reason} (${this.lastMissReason})`;

      if (this.currentShotDiagnostic) {
        this.currentShotDiagnostic.result = "MISS";
        this.currentShotDiagnostic.missReason = this
          .lastMissReason as FlyMissReason;
        if (
          this.currentShotDiagnostic.strikeTime > 0 &&
          this.currentShotDiagnostic.closestTime > 0
        ) {
          this.currentShotDiagnostic.actualStrikeTimingError = Math.abs(
            this.currentShotDiagnostic.strikeTime -
              this.currentShotDiagnostic.closestTime,
          );
        }
        if (
          this.currentShotDiagnostic.predictedContactTimeAtPrepare &&
          this.currentShotDiagnostic.closestTime > 0
        ) {
          this.currentShotDiagnostic.predictionErrorAtPrepare = Math.abs(
            this.currentShotDiagnostic.predictedContactTimeAtPrepare -
              this.currentShotDiagnostic.closestTime,
          );
        }
        this.diagnosticHistory.push({ ...this.currentShotDiagnostic });
        if (this.diagnosticHistory.length > 50) {
          this.diagnosticHistory.shift();
        }
      }
    }

    this.match.point(side);
    this.state = "point";
    this.timer = 0;
    this.lastShot = reason;
    this.primedSwing = null;
    this.events.push({
      type: "point",
      text: `${side === 0 ? "YOUR" : "OPPONENT"} POINT · ${reason}`,
    });
  }
}
