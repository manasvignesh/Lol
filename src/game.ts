import { C, type Settings } from "./config";
import { clamp, len, sub, v, mix, sweptDistance, type V3 } from "./math";
import {
  integrate,
  inCourt,
  netCrossing,
  predict,
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
    const pts = predict(s);
    this.target =
      pts.find((p) => p.z < -1.0 && p.y < 1.8 && p.y > 0.4) ??
      pts[pts.length - 1] ??
      s.p;
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
  playerX = 0;
  racket = v(0.5, 1.5, 3.4);
  previousRacket = { ...this.racket };
  motion = neutralMotion();
  usedSwing = -1;
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
    this.ready();
  }
  ready() {
    this.state = "ready";
    this.timer = 0;
    this.usedSwing = this.motion.swingId;
    this.shuttle.velocity = v();
    this.hits = 0;
    this.lastShot =
      this.match.server === 0 ? "SWING TO SERVE" : "OPPONENT SERVING";
  }
  step(dt: number) {
    this.time += dt;
    this.timer += dt;
    this.previousRacket = { ...this.racket };
    this.playerX +=
      (this.motion.playerX - this.playerX) * (1 - Math.exp(-dt * 18));
    this.racket = mix(this.racket, this.motion.racket, 1 - Math.exp(-dt * 35));
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
          ? v(this.playerX + 0.3, 1.15, 3.15)
          : v(this.ai.x, 1.15, this.ai.z);
      this.shuttle.prev = { ...this.shuttle.p };
      if (
        side === 0 &&
        this.motion.swing &&
        this.motion.confidence > C.confidence &&
        this.motion.swingId !== this.usedSwing
      ) {
        this.usedSwing = this.motion.swingId;
        this.hit(0, "serve");
      } else if (side === 1 && this.timer > 1.5) this.hit(1, "serve");
      return;
    }
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
    if (
      s.lastHit === 1 &&
      s.p.z > 0.2 &&
      this.motion.swing &&
      this.motion.confidence > C.confidence &&
      this.motion.swingId !== this.usedSwing &&
      this.time - this.lastContact > 0.18
    ) {
      const assistance =
        C.assist[this.settings.assist] * (0.7 + 0.3 * this.motion.confidence);
      const radius = 0.3 + assistance + Math.min(0.15, len(s.velocity) * 0.006);
      const contact = sweptDistance(
        this.previousRacket,
        this.racket,
        s.prev,
        s.p,
      );
      if (contact.distance < radius) {
        this.usedSwing = this.motion.swingId;
        this.hit(0, this.motion.intent);
      }
    }
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
            this.motion.power * 0.9 +
              incomingSpeed / 150 -
              Math.abs(timing) * 0.08,
            0.12,
            1,
          )
        : 0.55;
    const sign = side === 0 ? -1 : 1;
    // Beginner AI aims within the player's reachable depth. Lateral placement still requires movement.
    const depth = intent === "drop" ? 2.8 : intent === "smash" ? 4.2 : 5.1;
    const aim =
      side === 0
        ? clamp(
            this.motion.direction.x * 1.7 + this.playerX * 0.15 + timing * 0.22,
            -2.2,
            2.2,
          )
        : clamp(-this.playerX * 0.25 + (this.random() - 0.5) * 2.5, -1.8, 1.8);
    const error =
      side === 0
        ? 0
        : C.ai[this.settings.difficulty].error * (this.random() - 0.5);
    const target = v(aim + error, 0.03, sign * depth);
    // Low contact cannot support a real downward smash; lift it over the net.
    if (intent === "smash" && s.p.y < 2.3) intent = "drive";
    let velocity = shotVelocity(s.p, target, intent, power);
    // Ensure nominal assisted trajectories clear the net; collision remains active for real faults.
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
    if (side === 0) this.ai.incoming(s, this.settings);
  }
  point(side: 0 | 1, reason: string) {
    this.match.point(side);
    this.state = "point";
    this.timer = 0;
    this.lastShot = reason;
    this.events.push({
      type: "point",
      text: `${side === 0 ? "YOUR" : "OPPONENT"} POINT · ${reason}`,
    });
  }
}
