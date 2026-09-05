export class AudioManager {
  context: AudioContext | null = null;
  volume = 0.45;
  unlock() {
    this.context ??= new AudioContext();
    void this.context.resume();
  }
  play(kind: string) {
    if (!this.context || this.volume === 0) return;
    const c = this.context,
      o = c.createOscillator(),
      g = c.createGain();
    o.connect(g);
    g.connect(c.destination);
    const now = c.currentTime;
    const frequency =
      kind === "point"
        ? 660
        : kind === "net"
          ? 90
          : kind === "swing"
            ? 180
            : 1000;
    o.type = kind === "net" ? "triangle" : "sine";
    o.frequency.setValueAtTime(frequency, now);
    o.frequency.exponentialRampToValueAtTime(frequency * 0.45, now + 0.12);
    g.gain.setValueAtTime(this.volume * 0.18, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    o.start(now);
    o.stop(now + 0.2);
  }
}
