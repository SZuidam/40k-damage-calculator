/** A source of uniform random numbers in [0, 1). */
export type Rng = () => number;

export const defaultRng: Rng = Math.random;

/** Small, fast, seedable PRNG. Good enough for dice; not for cryptography. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Roll one die with the given number of sides (1..sides). */
export function rollDie(sides: number, rng: Rng): number {
  return 1 + Math.floor(rng() * sides);
}

export function d6(rng: Rng): number {
  return rollDie(6, rng);
}
