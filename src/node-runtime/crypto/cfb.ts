/**
 * Cipher Feedback (CFB) with a configurable feedback width, matching OpenSSL's
 * `CFB1` / `CFB8` / `CFB128` variants.
 *
 * CFB is defined for an arbitrary feedback size `s` (1..blockBits): every step
 * encrypts the feedback register `R`, XORs the top `s` bits of that keystream
 * into the plaintext, then shifts the `s` ciphertext bits back into `R`. The
 * block cipher's *forward* direction is used for both encryption and decryption.
 *
 * The feedback bit is the *output* when encrypting and the *input* (the incoming
 * ciphertext) when decrypting — that asymmetry is what makes the mode invertible.
 *
 * The common `CFB128` case (whole-block feedback) has a byte-oriented fast path
 * in the mode drivers; this module is the bit-generic version used for the
 * `cfb1` and `cfb8` names and is checked against OpenSSL byte-for-byte.
 */
export class CfbFeedback {
  readonly #register: Uint8Array;
  readonly #keystream: Uint8Array;
  readonly #block: (block: Uint8Array) => void;
  readonly #feedbackBits: number;
  readonly #encrypt: boolean;
  /** Bits consumed within the current feedback step (0 => keystream must be refreshed). */
  #step = 0;

  constructor(
    blockSize: number,
    feedbackBits: number,
    iv: Uint8Array,
    encrypt: boolean,
    encryptBlock: (block: Uint8Array) => void,
  ) {
    this.#register = new Uint8Array(blockSize);
    this.#register.set(iv.subarray(0, blockSize));
    this.#keystream = new Uint8Array(blockSize);
    this.#block = encryptBlock;
    this.#feedbackBits = feedbackBits;
    this.#encrypt = encrypt;
  }

  /** Processes a byte string, returning the same-length result. */
  process(input: Uint8Array): Uint8Array {
    const out = new Uint8Array(input.length);
    const reg = this.#register;
    const ks = this.#keystream;
    const last = reg.length - 1;
    for (let i = 0; i < input.length; i++) {
      let result = 0;
      for (let b = 7; b >= 0; b--) {
        if (this.#step === 0) {
          // Refresh the keystream from the register (the block cipher encrypts
          // its argument in place, so seed a copy).
          ks.set(reg);
          this.#block(ks);
        }
        const kbit = (ks[this.#step >> 3] >> (7 - (this.#step & 7))) & 1;
        const ibit = (input[i] >> b) & 1;
        const obit = ibit ^ kbit;
        // Encrypting feeds the output back; decrypting feeds the input back.
        const fbit = this.#encrypt ? obit : ibit;
        result = (result << 1) | obit;
        // R = (R << 1) | fbit, shifted one bit at a time.
        for (let j = 0; j < last; j++) reg[j] = ((reg[j] << 1) | (reg[j + 1] >> 7)) & 0xff;
        reg[last] = ((reg[last] << 1) | fbit) & 0xff;
        this.#step++;
        if (this.#step === this.#feedbackBits) this.#step = 0;
      }
      out[i] = result;
    }
    return out;
  }
}
