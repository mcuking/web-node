// `crypto.generatePrime(Sync)` / `crypto.checkPrime(Sync)` — pure JS.
//
// Node backs all four with OpenSSL: `BN_generate_prime_ex2` for generation and
// `BN_check_prime` (OpenSSL 3 provider) for testing. The browser has neither,
// so this module reproduces the *observable* surface with BigInt maths:
//
//   * primality: small-prime trial division + Miller-Rabin. The bases are the
//     first 13 primes for n < 3.3e24 (a proven deterministic set) and the first
//     64 primes above that (whose smallest strong pseudoprime is far beyond any
//     number this runtime will ever see). OpenSSL's `BN_check_prime` ignores the
//     `checks` argument — it picks its own round count from the bit size — so
//     primality here does not depend on `checks` either.
//   * generation: the same candidate shapes OpenSSL produces. Without `add`,
//     candidates are odd with the top *two* bits set (`BN_RAND_TOP_TWO`);
//     with `add`, the top bit only (`BN_RAND_TOP_ONE`, matching
//     `probable_prime_dh`) and the number is congruent to `rem` (or 1) mod
//     `add`. `safe` additionally requires `(p - 1) / 2` to be prime.

const SMALL_PRIME_LIMIT = 1000;

function sieve(limit: number): number[] {
  const composite = new Uint8Array(limit + 1);
  const primes: number[] = [];
  for (let i = 2; i <= limit; i++) {
    if (composite[i]) continue;
    primes.push(i);
    for (let j = i * i; j <= limit; j += i) composite[j] = 1;
  }
  return primes;
}

const SMALL_PRIMES = sieve(SMALL_PRIME_LIMIT);
const SMALL_PRIMES_BIG = SMALL_PRIMES.map((p) => BigInt(p));
const MAX_TRIAL = BigInt(SMALL_PRIME_LIMIT);

// First 13 primes: deterministic Miller-Rabin for n < 3,317,044,064,679,887,385,961,981.
const BASES_13 = SMALL_PRIMES_BIG.slice(0, 13);

// First 64 primes: used above the deterministic range. No strong pseudoprime to
// all of these is known anywhere near sizes this runtime can reach.
function basesFor(n: bigint): bigint[] {
  return n < 3317044064679887385961981n ? BASES_13 : SMALL_PRIMES_BIG.slice(0, 64);
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

export function isPrime(n: bigint): boolean {
  if (n < 2n) return false;
  for (const p of SMALL_PRIMES_BIG) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }

  // n is odd and shares no factor with any prime <= 1000. Write n - 1 = d * 2^s.
  const nMinus1 = n - 1n;
  let d = nMinus1;
  let s = 0;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    s++;
  }

  for (const a of basesFor(n)) {
    if (a >= n) continue;
    let x = modPow(a, d, n);
    if (x === 1n || x === nMinus1) continue;
    let witness = true;
    for (let i = 1; i < s; i++) {
      x = (x * x) % n;
      if (x === nMinus1) {
        witness = false;
        break;
      }
    }
    if (witness) return false;
  }
  return true;
}

export function toUnsignedBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function bitLength(value: bigint): number {
  return value === 0n ? 0 : value.toString(2).length;
}

function randomBigInt(bytes: number): bigint {
  const buffer = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buffer);
  return toUnsignedBigInt(buffer);
}

// A random odd `bits`-bit integer with the top bit (and, when `twoBits`, the
// top two bits) set — `BN_rand(bits, TOP_ONE|TOP_TWO, BOTTOM_ODD)`.
function randomCandidate(bits: number, twoBits: boolean): bigint {
  const bytes = Math.ceil(bits / 8);
  let value = randomBigInt(bytes);
  // Trim to exactly `bits` bits.
  const excess = BigInt(bytes * 8 - bits);
  value >>= excess;
  value |= 1n << BigInt(bits - 1);
  if (twoBits && bits >= 2) value |= 1n << BigInt(bits - 2);
  value |= 1n;
  return value;
}

export interface PrimeOptions {
  safe: boolean;
  add?: bigint;
  rem?: bigint;
}

// Cap on the walk that hunts for a prime in one arithmetic progression before
// drawing a fresh base. The interval [2^(bits-1), 2^bits) holds far more than
// this for every sane configuration, so the cap only guards degenerate inputs.
const MAX_STEPS = 1 << 20;

function accept(p: bigint, sizeBits: number, safe: boolean): boolean {
  if (bitLength(p) !== sizeBits) return false;
  if ((p & 1n) === 0n) return false;
  if (!isPrime(p)) return false;
  if (safe && !isPrime((p - 1n) / 2n)) return false;
  return true;
}

export function generatePrimeBigInt(sizeBits: number, options: PrimeOptions): bigint {
  const { safe, add } = options;

  if (add === undefined) {
    for (;;) {
      const candidate = randomCandidate(sizeBits, true);
      if (accept(candidate, sizeBits, safe)) return candidate;
    }
  }

  const rem = options.rem ?? 1n;
  const step = add === 0n ? 0n : add;
  for (;;) {
    let p = randomCandidate(sizeBits, false);
    // Snap onto the congruence class p === rem (mod add).
    const remainder = p % add;
    p = p - remainder + rem;
    if (p < 2n || bitLength(p) !== sizeBits) continue;
    // Adding `add` repeatedly preserves parity; nudge once so an odd `add`
    // starts on an odd candidate.
    if ((p & 1n) === 0n && (add & 1n) === 1n) p += add;
    if (bitLength(p) !== sizeBits) continue;

    for (let stepIndex = 0; stepIndex < MAX_STEPS; stepIndex++) {
      if (accept(p, sizeBits, safe)) return p;
      if (step === 0n) break;
      p += step;
      if (bitLength(p) !== sizeBits) break;
    }
  }
}

export { bitLength as primeBitLength, MAX_TRIAL };
