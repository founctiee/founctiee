/**
 * Valve'ın CUniformRandomStream'i (Numerical Recipes ran1) — Source SDK'daki ile aynı
 * algoritma. Recoil desenleri ve spread bu üreteçle seed'lenerek deterministik üretilir;
 * istemci ve sunucu aynı sonucu bulur.
 */
const IA = 16807;
const IM = 2147483647;
const IQ = 127773;
const IR = 2836;
const NTAB = 32;
const NDIV = 1 + Math.floor((IM - 1) / NTAB);
const AM = 1.0 / IM;
const EPS = 1.2e-7;
const RNMX = 1.0 - EPS;

export class UniformRandomStream {
  private idum = 0;
  private iy = 0;
  private readonly iv = new Int32Array(NTAB);

  constructor(seed = 0) {
    this.setSeed(seed);
  }

  setSeed(seed: number): void {
    seed |= 0;
    this.idum = seed < 0 ? seed : -seed;
    this.iy = 0;
  }

  private generate(): number {
    let j: number;
    let k: number;
    if (this.idum <= 0 || !this.iy) {
      if (-this.idum < 1) this.idum = 1;
      else this.idum = -this.idum;
      for (j = NTAB + 7; j >= 0; j--) {
        k = Math.trunc(this.idum / IQ);
        this.idum = IA * (this.idum - k * IQ) - IR * k;
        if (this.idum < 0) this.idum += IM;
        if (j < NTAB) this.iv[j] = this.idum;
      }
      this.iy = this.iv[0]!;
    }
    k = Math.trunc(this.idum / IQ);
    this.idum = IA * (this.idum - k * IQ) - IR * k;
    if (this.idum < 0) this.idum += IM;
    j = Math.trunc(this.iy / NDIV);
    if (j >= NTAB || j < 0) j = (j % NTAB) & 0x7fffffff;
    this.iy = this.iv[j]!;
    this.iv[j] = this.idum;
    return this.iy;
  }

  /** [low, high) aralığında float (32-bit hassasiyetle, Source ile aynı). */
  randomFloat(low = 0, high = 1): number {
    let fl = Math.fround(AM * this.generate());
    if (fl > RNMX) fl = Math.fround(RNMX);
    return Math.fround(fl * (high - low) + low);
  }

  randomInt(low: number, high: number): number {
    const x = high - low + 1;
    if (x <= 1) return low;
    const MAX = 0x7fffffff;
    const maxAcceptable = MAX - ((MAX + 1) % x);
    let n: number;
    do {
      n = this.generate();
    } while (n > maxAcceptable);
    return low + (n % x);
  }
}

/** Basit 32-bit karıştırma (seed türetmek için). */
export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5 | 0;
  for (const p of parts) {
    h ^= p | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 13;
  }
  return h & 0x7fffffff;
}
