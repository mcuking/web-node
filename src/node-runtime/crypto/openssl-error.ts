/**
 * Rebuilding the exception Node raises for an OpenSSL failure.
 *
 * `ThrowCryptoError` in `src/crypto/crypto_util.cc` sets the message to the long
 * `error:...` string and the code to `ERR_OSSL_<LIBRARY>_<REASON>`, where the
 * library fragment comes from a fixed list of `ERR_LIB_*` names and the reason
 * is OpenSSL's own reason string, upper-cased with spaces turned into `_`.
 *
 * A library Node does not name contributes nothing: the `PROV` provider library
 * raises most modern errors (`PROV_R_BAD_DECRYPT` → `ERR_OSSL_BAD_DECRYPT`), and
 * when OpenSSL queued no reason at all Node sets no code.
 */
import { opensslErrorLib, opensslErrorReason } from '../bindings/openssl';

/**
 * `ERR_LIB_*` → the fragment Node inserts. The list is Node's, verbatim (see
 * `OSSL_ERROR_CODES_MAP` in `src/crypto/crypto_util.cc`).
 */
const ERR_LIB_NAMES: Record<number, string> = {
  2: 'SYS', 3: 'BN', 4: 'RSA', 5: 'DH', 6: 'EVP', 7: 'BUF', 8: 'OBJ', 9: 'PEM',
  10: 'DSA', 11: 'X509', 13: 'ASN1', 14: 'CONF', 15: 'CRYPTO', 16: 'EC', 32: 'BIO',
  33: 'PKCS7', 34: 'X509V3', 35: 'PKCS12', 36: 'RAND', 37: 'DSO', 38: 'ENGINE',
  39: 'OCSP', 40: 'UI', 41: 'COMP', 42: 'ECDSA', 43: 'ECDH', 44: 'OSSL_STORE',
  45: 'FIPS', 46: 'CMS', 47: 'TS', 48: 'HMAC', 50: 'CT', 51: 'ASYNC', 52: 'KDF',
  53: 'SM2', 128: 'USER',
};

/** `ERR_LIB_SSL` is the one library Node spells without the `OSSL_` prefix. */
const ERR_LIB_SSL = 20;

/** The `ERR_OSSL_*` code Node would give the last failure, or `null`. */
export function opensslErrorCode(): string | null {
  const reason = opensslErrorReason();
  if (!reason) return null;
  const lib = opensslErrorLib();
  const library = ERR_LIB_NAMES[lib] ?? '';
  const prefix = lib === ERR_LIB_SSL ? '' : 'OSSL_';
  return `ERR_${prefix}${library ? `${library}_` : ''}${reason.replace(/ /g, '_').toUpperCase()}`;
}
