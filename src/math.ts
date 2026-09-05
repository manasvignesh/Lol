export type V3 = { x: number; y: number; z: number };
export const v = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const add = (a: V3, b: V3): V3 => v(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: V3, b: V3): V3 => v(a.x - b.x, a.y - b.y, a.z - b.z);
export const mul = (a: V3, n: number): V3 => v(a.x * n, a.y * n, a.z * n);
export const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a: V3) => Math.sqrt(dot(a, a));
export const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));
export const norm = (a: V3) => mul(a, 1 / Math.max(0.0001, len(a)));
export const mix = (a: V3, b: V3, t: number) => add(a, mul(sub(b, a), t));
/** Closest approach of two moving points over the SAME time interval. */
export function sweptDistance(a0: V3, a1: V3, b0: V3, b1: V3) {
  const r = sub(a0, b0),
    d = sub(sub(a1, a0), sub(b1, b0));
  const t = clamp(-dot(r, d) / Math.max(dot(d, d), 1e-9), 0, 1);
  return { distance: len(add(r, mul(d, t))), t };
}
export function seeded(seed = 1234) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
