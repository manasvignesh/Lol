import { C, type Settings } from "./config";
import { clamp, len, v, mix, sweptDistance, type V3 } from "./math";
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
      const speed = C.ai[settings.difficulty].speed * dt;
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
  primedSwing: { id: number; intent: Intent; time: number } | null = null;
  lastContact = -10;
  events: GameEvent[] = [];
  lastShot = "READY";

  constructor(
    public settings: Settings,
    public random = Math.random,
  ) {}

  setMotion(m: Motion) {
    this.motion = m;
  }

  reset() {
    this.match = new MatchManager();
    this.ai = new OpponentAI();
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
    this.lastShot =
      this.match.server === 0 ? "SWING TO SERVE" : "OPPONENT SERVING";
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
        clamp(targetX, -2.4, 2.4),
        0,
        clamp(targetZ, 1.8, 5.6),
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
      this.shuttle.p =
        side === 0
          ? v(this.playerPos.x + 0.3, 1.15, this.playerPos.z - 0.85)
          : v(this.ai.x, 1.15, this.ai.z);
      this.shuttle.prev = { ...this.shuttle.p };

      if (
        side === 0 &&
        (this.motion.swing || this.motion.predictedSwing) &&
        this.motion.confidence > C.confidence &&
        this.motion.swingId !== this.usedSwing
      ) {
        this.usedSwing = this.motion.swingId;
        this.hit(0, "serve");
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

    // --- Swing Priming & Assisted Contact Envelope ---
    const isSwinging =
      (this.motion.swing || this.motion.predictedSwing) &&
      this.motion.confidence > C.confidence &&
      this.motion.swingId !== this.usedSwing;

    if (isSwinging) {
      this.primedSwing = {
        id: this.motion.swingId,
        intent: this.motion.intent,
        time: this.time,
      };
    }

    // Check if primed swing is still valid inside timing window
    if (
      this.primedSwing &&
      this.time - this.primedSwing.time > C.timingWindow[this.settings.assist]
    ) {
      this.primedSwing = null;
    }

    if (
      s.lastHit === 1 &&
      s.p.z > 0.2 &&
      this.primedSwing &&
      this.primedSwing.id !== this.usedSwing &&
      this.time - this.lastContact > 0.18
    ) {
      const radius =
        C.contactEnvelope[this.settings.assist] *
        (0.75 + 0.25 * this.motion.confidence);

      const contact = sweptDistance(
        this.previousRacket,
        this.racket,
        s.prev,
        s.p,
      );
      const playerDist = Math.hypot(
        s.p.x - this.playerPos.x,
        s.p.z - this.playerPos.z,
      );

      // Contact succeeds if shuttle enters reachable envelope around avatar or racket
      if (
        contact.distance < radius ||
        (playerDist < radius && s.p.y > 0.25 && s.p.y < 3.3)
      ) {
        this.usedSwing = this.primedSwing.id;
        const hitIntent = this.primedSwing.intent;
        this.primedSwing = null;
        this.hit(0, hitIntent);
        this.footworkState = "RECOVERING";
      }
    }

    // --- Opponent Return Logic ---
    if (
      s.lastHit === 0 &&
      s.p.z < -0.6 &&
      s.velocity.y < 0 &&
      s.p.y < 2.1 &&
      s.p.y > 0.3 &&
      this.ai.state === "MOVE" &&
      !this.ai.attempted &&
      Math.hypot(s.p.x - this.ai.x, s.p.z - this.ai.z) < 1.1
    ) {
      this.ai.attempted = true;
      this.ai.state = "SWING";
      if (this.random() > C.ai[this.settings.difficulty].miss) {
        const intents: Intent[] = ["clear", "drive", "drop", "lift"];
        this.hit(1, intents[Math.floor(this.random() * intents.length)]);
      }
      this.ai.state = "RECOVER";
    }
  }

  hit(side: 0 | 1, intent: Intent | "serve") {
    const s = this.shuttle;
    const incomingSpeed = len(s.velocity);
    const timing = side === 0 ? clamp((this.racket.z - s.p.z) / 1.1, -1, 1) : 0;
    const power =
      side === 0
        ? clamp(
            this.motion.power * 0.92 +
              incomingSpeed / 140 -
              Math.abs(timing) * 0.06,
            0.15,
            1,
          )
        : 0.55;
    const sign = side === 0 ? -1 : 1;

    const depth = intent === "drop" ? 2.8 : intent === "smash" ? 4.2 : 5.1;

    // Directional aim from swing direction and body intent
    let aim = 0;
    if (side === 0) {
      aim =
        this.motion.direction.x * 1.8 + this.playerPos.x * 0.12 + timing * 0.18;
      if (this.motion.intentDirection === "left") aim -= 0.5;
      else if (this.motion.intentDirection === "right") aim += 0.5;
      aim = clamp(aim, -2.2, 2.2);
    } else {
      aim = clamp(
        -this.playerPos.x * 0.25 + (this.random() - 0.5) * 2.5,
        -1.8,
        1.8,
      );
    }

    const error =
      side === 0
        ? 0
        : C.ai[this.settings.difficulty].error * (this.random() - 0.5);
    const target = v(aim + error, 0.03, sign * depth);

    if (intent === "smash" && s.p.y < 2.3) intent = "drive";
    let velocity = shotVelocity(s.p, target, intent, power);

    // Assisted net clearance
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

    s.velocity = velocity;
    s.lastHit = side;
    this.state = "rally";
    this.lastContact = this.time;
    this.hits++;
    this.totalHits++;
    this.bestRally = Math.max(this.bestRally, this.hits);
    this.lastShot = intent.toUpperCase();
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
      this.targetPos = interception.target;
      this.footworkState = "INTERCEPTING";
    }
  }

  point(side: 0 | 1, reason: string) {
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
