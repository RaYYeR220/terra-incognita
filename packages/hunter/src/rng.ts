/** Deterministic random source, so a hunt can be replayed from its seed. */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** An independent generator derived from this one. */
  fork(): Rng;
}

/** sfc32 seeded through splitmix32. */
export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const mix = (): number => {
    s = (s + 0x9e3779b9) >>> 0;
    let t = s ^ (s >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
  let a = mix();
  let b = mix();
  let c = mix();
  let d = 1;

  const u32 = (): number => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return t;
  };
  for (let i = 0; i < 12; i += 1) u32();

  return {
    next: () => u32() / 4294967296,
    int: (n: number) => Math.floor((u32() / 4294967296) * n),
    fork: () => createRng(u32()),
  };
}

/** Stable 32-bit hash of a string, for turning names into seeds. */
export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
