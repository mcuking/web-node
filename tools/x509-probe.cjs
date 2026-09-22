// Differential observation program for crypto.X509Certificate.
// Runs unchanged on real Node (oracle -> test/fixtures/x509.json) and inside
// web-node; the two JSON blobs must match. Certificate/\nkey material is
// embedded so the program needs no filesystem.
const crypto = require("crypto");

const LEAF_PEM = "-----BEGIN CERTIFICATE-----\nMIIEfTCCA2WgAwIBAgITA+BF231Dy7XYHGVb7KOu6ZLDfjANBgkqhkiG9w0BAQsF\nADBgMQswCQYDVQQGEwJDTjERMA8GA1UECAwIWmhlamlhbmcxEDAOBgNVBAoMB05l\ndGVhc2UxETAPBgNVBAsMCENvZGVXYXZlMRkwFwYDVQQDDBBXZWItTm9kZSBUZXN0\nIENBMB4XDTI2MDkyMjA2MDIzMloXDTI4MTIyNTA2MDIzMlowbjELMAkGA1UEBhMC\nQ04xETAPBgNVBAgMCFpoZWppYW5nMREwDwYDVQQHDAhIYW5nemhvdTEQMA4GA1UE\nCgwHTmV0ZWFzZTERMA8GA1UECwwIQ29kZVdhdmUxFDASBgNVBAMMC2V4YW1wbGUu\nY29tMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArjsOg8MVAkA1E+rM\ng+W/rwW+nIhx4TlBw1gG4VHSiUbTDtc3IVej+S7ohdURypGKZE7SjF9ibxLrCJ4C\nT9+UjCzjsQqZ23lkOJqYjv79juxgwvHTX9u6UtwHHKhIjk8dBV4lpNJKCXmr3ULn\nlAx6JeB76Kbos4hU/4Oe/+/LfRbAUDY7lJY7CwkqUXgy+H9O0hdFTB2w1fA47Fl/\nPCyZS7np+FEr5YNIK4FuH9ayBc3dgNbe4GdEx1Jaf9Tx7WhO75dM+zUCOU+FydcM\nLVs6AK9uVVnJSlLbgRY3u5ZK2lPDNpOmqBEshvPlKRRvSV2omP1c4ru69pKFgFZ1\nPvrWewIDAQABo4IBIDCCARwwPgYDVR0RBDcwNYILZXhhbXBsZS5jb22CDSouZXhh\nbXBsZS5jb22HBH8AAAGBEWFkbWluQGV4YW1wbGUuY29tMAwGA1UdEwEB/wQCMAAw\nDgYDVR0PAQH/BAQDAgWgMB0GA1UdJQQWMBQGCCsGAQUFBwMBBggrBgEFBQcDAjBd\nBggrBgEFBQcBAQRRME8wIwYIKwYBBQUHMAGGF2h0dHA6Ly9vY3NwLmV4YW1wbGUu\nY29tMCgGCCsGAQUFBzAChhxodHRwOi8vY2EuZXhhbXBsZS5jb20vY2EuY3J0MB0G\nA1UdDgQWBBRA8/GtIvkOSDs/w2hkWok31yzwczAfBgNVHSMEGDAWgBQSG/yS6cGd\nLhRBAgG44KVorj6icjANBgkqhkiG9w0BAQsFAAOCAQEAAE6A9A74GLTPipCHroxi\nARKVr60qebZBoGTvNfa+j+XsC4+Lne+eJJX+8rAhLdz4Wx3xt8ImPMt83W84kF4b\nGeOmnv9jCyvWASzpLWhpplXFKmmgpbAlap8bLaNyZrk4/EqtBY6ptN7Er5LBDlbF\ny+4PScCQZ3DgAr2bXPjivtHj9KbXDXwPzFM0xfdFpx9Da1WYnEQ9z3N8mRNWCWDC\nrfPVAfbM5beH+s9ShE7mBo6AsKIcNPl+QgvvgXL30jFzOYW7b2e14gv21lABXVBF\nD28VLxZR1iZXsoBG1RsVUnaNkRIzIbIowbK5/M2VYco56zXzCWAQ2L5QYmFfu+Ad\nng==\n-----END CERTIFICATE-----\n";
const CA_PEM = "-----BEGIN CERTIFICATE-----\nMIIDsTCCApmgAwIBAgIUY8oOQORM1Am80IbdaH+OqEFwIQcwDQYJKoZIhvcNAQEL\nBQAwYDELMAkGA1UEBhMCQ04xETAPBgNVBAgMCFpoZWppYW5nMRAwDgYDVQQKDAdO\nZXRlYXNlMREwDwYDVQQLDAhDb2RlV2F2ZTEZMBcGA1UEAwwQV2ViLU5vZGUgVGVz\ndCBDQTAeFw0yNjA5MjIwNjAyMzJaFw0zNjA5MTkwNjAyMzJaMGAxCzAJBgNVBAYT\nAkNOMREwDwYDVQQIDAhaaGVqaWFuZzEQMA4GA1UECgwHTmV0ZWFzZTERMA8GA1UE\nCwwIQ29kZVdhdmUxGTAXBgNVBAMMEFdlYi1Ob2RlIFRlc3QgQ0EwggEiMA0GCSqG\nSIb3DQEBAQUAA4IBDwAwggEKAoIBAQD9l3Cq5CuvcbxFzJLeKNK66KhHr05s2kl3\nzip3mU3G5e2EPJ3/voU2mncvGulZbWqmRQ9FsQ2foeQcLcGA91V7mqsRunf7KAWd\nQoxyUFF0jjb9+FUQMwNOaXCNGAvOVa5j/lTNQxwVo9uCKy3j34NU6BeUUh91Zy5k\ntRReHcBGhxpvlZcgdlItYySV0pde7jLD36O792p787dAcc4pLId0gxPXom6sfC0S\n/MKZ+qDw6wzXPiAOR/wNUWornTE1l6N3KNRycylc/enKss0KcwDVw8QycINj+9bN\nXrzTpw3gb5lrOsS9RKTPEPrOP/mtkvsIc9VfIFmGktOsE1QOvah/AgMBAAGjYzBh\nMB0GA1UdDgQWBBQSG/yS6cGdLhRBAgG44KVorj6icjAfBgNVHSMEGDAWgBQSG/yS\n6cGdLhRBAgG44KVorj6icjAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIB\nBjANBgkqhkiG9w0BAQsFAAOCAQEA5iojhCRu9d+woW730joo7OrU+T00VmnpXxdl\ndywa0f1h65fXGx1qomjhVmpYEX/Hn9bDZjiuN9qzsvBm4UfoM7+Uerv8ZkpwniBG\npuBwMd0tXeE9EGD4nBT1Wkp+HtDrb0M9TDDiEjK+AosiW9VyOBoae+RXkJnZCaJO\noEMocOsL4UHxknurmzQvulQigPlEKzBCxwfcy2UC71uvkWTuupkR8ebnoQF+qnbd\n0Aa0d3Z2JycOEdq+zg8CPV3SfcAXNXTITDSJ3TLI91fkfGKH7gUiPc39x6YFTZbN\nbPTswFWwpN7eHWvlmhD61B0MxyMyXbGsXlCe/YDB+XRMr2hLxg==\n-----END CERTIFICATE-----\n";
const LEAF_KEY_PEM = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCuOw6DwxUCQDUT\n6syD5b+vBb6ciHHhOUHDWAbhUdKJRtMO1zchV6P5LuiF1RHKkYpkTtKMX2JvEusI\nngJP35SMLOOxCpnbeWQ4mpiO/v2O7GDC8dNf27pS3AccqEiOTx0FXiWk0koJeavd\nQueUDHol4HvopuiziFT/g57/78t9FsBQNjuUljsLCSpReDL4f07SF0VMHbDV8Djs\nWX88LJlLuen4USvlg0grgW4f1rIFzd2A1t7gZ0THUlp/1PHtaE7vl0z7NQI5T4XJ\n1wwtWzoAr25VWclKUtuBFje7lkraU8M2k6aoESyG8+UpFG9JXaiY/Vziu7r2koWA\nVnU++tZ7AgMBAAECggEAEib9ACVXDwD5hrWz0Roium1yyoQ8uSZp/5wwO1F3Ce5j\nFuy9RbAH2XJVr3vfeqdnL8Q2k4Fsk/34ltE/lGrK4z/aCRv9o6wmEO+qbVuLt1RR\nUH45c4dFBlT+OLIfvRPpBiIk8eMm643NpiPOVNJn94JH5pldLTdLA8QG0Mt+++0y\nXuVxJrKUCdejBsiriy3Ay8pBiSbBfH5DLflKDCy8cUKDc2Qjm46eAsqX+cmODWle\nZnsq1jcXjQO2L7nZRTTzmpQn0XjZ0uvRDZUErYTzSNx+Z5jQKfOWlagspTqeyOO0\nqn+jfGISKwlPUBmPJ6g3lWRUjUrJ6d2MkUZ8RXw3gQKBgQD2AK7/MDQUvTBPD2Wh\n8MMFFZ6Y1/e0av3xf8hxpGGKSb8AEUJ6yf+cBlVr/nA+tsv3NEVmtpfzvzTQRGGi\nrD6yDS4kEQwzMNlKimgD8U043wEQwtYHWq1ywlLy0yjjcMzyhSTGgaZL0qcYiN0J\nOzceoc3IazV/JqWrmiBm6wgsSwKBgQC1T69tIJtV+qAijatMpjS3KC+WlIf3y/yj\npbAYoslixDs5dzHSj/VKnIajCOXIFLDFwtYbR5TpZd/ulW55IbxA+FDGUqn1u+pP\nSpqWwveg7rMKyPu+O7DJbfmfSaLLAtpwx3emQrQeJpjld9dyAeBhkCjCJapBovRC\nLEhxwnVAkQKBgFEOZJrc7SwwMiy6rAgx5nBUcU93Sbz+y/G44vje6uy/49lH1pnS\n2RA13guZaK6hWI95f6yaWXMM+3/sKCeLjZTpVty3aUesvswa0q8J4SHuCNHXAOKn\ndCMt+FreTMi0MDNwv29Q5NRy8m/ZGMuj4UOMmNuCx7u/pjLms+p1YtoFAoGAHGmW\nVgWMEhcqTP/iXiqVjDYx7ujrvbsrpgFq7RFleaLCnSi+l/6TM9P/jUDxsT78zKDR\nqIi5HzIlu1+TZkwREiVXkxyVIbsG5tIME6AN6hw91mzUdmUoOQiQ25NQfXu++3lm\nmJlPXIIz55G2I1mD7gYHPRVl7s84c744xArzEOECgYEAofYT5YJGJIxInVjS0a0h\nuLABpzIcUQmsUO7tpAs3WuRyk+RcwPB2yPl88GhhfxdMcXyMbha+9UP9s+wfCjtf\nqpt+l/owfR6t2POk7ea2KMw0Xj0et1etHwEsbFwuANmTmKhQIc1jz2Icc7xDDYje\nHqKjA9LI2afLiiQ1gxvsHuQ=\n-----END PRIVATE KEY-----\n";
const LEAF_DER = Buffer.from("MIIEfTCCA2WgAwIBAgITA+BF231Dy7XYHGVb7KOu6ZLDfjANBgkqhkiG9w0BAQsFADBgMQswCQYDVQQGEwJDTjERMA8GA1UECAwIWmhlamlhbmcxEDAOBgNVBAoMB05ldGVhc2UxETAPBgNVBAsMCENvZGVXYXZlMRkwFwYDVQQDDBBXZWItTm9kZSBUZXN0IENBMB4XDTI2MDkyMjA2MDIzMloXDTI4MTIyNTA2MDIzMlowbjELMAkGA1UEBhMCQ04xETAPBgNVBAgMCFpoZWppYW5nMREwDwYDVQQHDAhIYW5nemhvdTEQMA4GA1UECgwHTmV0ZWFzZTERMA8GA1UECwwIQ29kZVdhdmUxFDASBgNVBAMMC2V4YW1wbGUuY29tMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArjsOg8MVAkA1E+rMg+W/rwW+nIhx4TlBw1gG4VHSiUbTDtc3IVej+S7ohdURypGKZE7SjF9ibxLrCJ4CT9+UjCzjsQqZ23lkOJqYjv79juxgwvHTX9u6UtwHHKhIjk8dBV4lpNJKCXmr3ULnlAx6JeB76Kbos4hU/4Oe/+/LfRbAUDY7lJY7CwkqUXgy+H9O0hdFTB2w1fA47Fl/PCyZS7np+FEr5YNIK4FuH9ayBc3dgNbe4GdEx1Jaf9Tx7WhO75dM+zUCOU+FydcMLVs6AK9uVVnJSlLbgRY3u5ZK2lPDNpOmqBEshvPlKRRvSV2omP1c4ru69pKFgFZ1PvrWewIDAQABo4IBIDCCARwwPgYDVR0RBDcwNYILZXhhbXBsZS5jb22CDSouZXhhbXBsZS5jb22HBH8AAAGBEWFkbWluQGV4YW1wbGUuY29tMAwGA1UdEwEB/wQCMAAwDgYDVR0PAQH/BAQDAgWgMB0GA1UdJQQWMBQGCCsGAQUFBwMBBggrBgEFBQcDAjBdBggrBgEFBQcBAQRRME8wIwYIKwYBBQUHMAGGF2h0dHA6Ly9vY3NwLmV4YW1wbGUuY29tMCgGCCsGAQUFBzAChhxodHRwOi8vY2EuZXhhbXBsZS5jb20vY2EuY3J0MB0GA1UdDgQWBBRA8/GtIvkOSDs/w2hkWok31yzwczAfBgNVHSMEGDAWgBQSG/yS6cGdLhRBAgG44KVorj6icjANBgkqhkiG9w0BAQsFAAOCAQEAAE6A9A74GLTPipCHroxiARKVr60qebZBoGTvNfa+j+XsC4+Lne+eJJX+8rAhLdz4Wx3xt8ImPMt83W84kF4bGeOmnv9jCyvWASzpLWhpplXFKmmgpbAlap8bLaNyZrk4/EqtBY6ptN7Er5LBDlbFy+4PScCQZ3DgAr2bXPjivtHj9KbXDXwPzFM0xfdFpx9Da1WYnEQ9z3N8mRNWCWDCrfPVAfbM5beH+s9ShE7mBo6AsKIcNPl+QgvvgXL30jFzOYW7b2e14gv21lABXVBFD28VLxZR1iZXsoBG1RsVUnaNkRIzIbIowbK5/M2VYco56zXzCWAQ2L5QYmFfu+Adng==", "base64");
const CA_DER = Buffer.from("MIIDsTCCApmgAwIBAgIUY8oOQORM1Am80IbdaH+OqEFwIQcwDQYJKoZIhvcNAQELBQAwYDELMAkGA1UEBhMCQ04xETAPBgNVBAgMCFpoZWppYW5nMRAwDgYDVQQKDAdOZXRlYXNlMREwDwYDVQQLDAhDb2RlV2F2ZTEZMBcGA1UEAwwQV2ViLU5vZGUgVGVzdCBDQTAeFw0yNjA5MjIwNjAyMzJaFw0zNjA5MTkwNjAyMzJaMGAxCzAJBgNVBAYTAkNOMREwDwYDVQQIDAhaaGVqaWFuZzEQMA4GA1UECgwHTmV0ZWFzZTERMA8GA1UECwwIQ29kZVdhdmUxGTAXBgNVBAMMEFdlYi1Ob2RlIFRlc3QgQ0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQD9l3Cq5CuvcbxFzJLeKNK66KhHr05s2kl3zip3mU3G5e2EPJ3/voU2mncvGulZbWqmRQ9FsQ2foeQcLcGA91V7mqsRunf7KAWdQoxyUFF0jjb9+FUQMwNOaXCNGAvOVa5j/lTNQxwVo9uCKy3j34NU6BeUUh91Zy5ktRReHcBGhxpvlZcgdlItYySV0pde7jLD36O792p787dAcc4pLId0gxPXom6sfC0S/MKZ+qDw6wzXPiAOR/wNUWornTE1l6N3KNRycylc/enKss0KcwDVw8QycINj+9bNXrzTpw3gb5lrOsS9RKTPEPrOP/mtkvsIc9VfIFmGktOsE1QOvah/AgMBAAGjYzBhMB0GA1UdDgQWBBQSG/yS6cGdLhRBAgG44KVorj6icjAfBgNVHSMEGDAWgBQSG/yS6cGdLhRBAgG44KVorj6icjAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBBjANBgkqhkiG9w0BAQsFAAOCAQEA5iojhCRu9d+woW730joo7OrU+T00VmnpXxdldywa0f1h65fXGx1qomjhVmpYEX/Hn9bDZjiuN9qzsvBm4UfoM7+Uerv8ZkpwniBGpuBwMd0tXeE9EGD4nBT1Wkp+HtDrb0M9TDDiEjK+AosiW9VyOBoae+RXkJnZCaJOoEMocOsL4UHxknurmzQvulQigPlEKzBCxwfcy2UC71uvkWTuupkR8ebnoQF+qnbd0Aa0d3Z2JycOEdq+zg8CPV3SfcAXNXTITDSJ3TLI91fkfGKH7gUiPc39x6YFTZbNbPTswFWwpN7eHWvlmhD61B0MxyMyXbGsXlCe/YDB+XRMr2hLxg==", "base64");

const hex = (b) => Buffer.from(b).toString("hex");
const codeOf = (fn) => { try { return { ok: fn() }; } catch (e) { return { code: e.code }; } };
const safe = (fn) => { try { return fn(); } catch (e) { return { __error: e.code || e.name, message: e.message }; } };
const iso = (x) => (x instanceof Date ? x.toISOString() : String(x));

function keyInfo(key) {
  const out = { type: key.type, symmetricKeySize: key.symmetricKeySize ?? null };
  if (key.asymmetricKeyType) {
    out.asymmetricKeyType = key.asymmetricKeyType;
    out.details = key.asymmetricKeyDetails ?? null;
    out.jwk = safe(() => key.export({ format: "jwk" }));
    out.spkiHex = safe(() => hex(key.export({ type: "spki", format: "der" })));
  }
  return out;
}

function report(cert, leafKey) {
  const o = {};
  o.subject = cert.subject;
  o.issuer = cert.issuer;
  o.serialNumber = cert.serialNumber;
  o.fingerprint = cert.fingerprint;
  o.fingerprint256 = cert.fingerprint256;
  o.fingerprint512 = cert.fingerprint512;
  o.validFrom = cert.validFrom;
  o.validTo = cert.validTo;
  o.validFromDate = iso(cert.validFromDate);
  o.validToDate = iso(cert.validToDate);
  o.keyUsage = cert.keyUsage ?? null;
  o.subjectAltName = cert.subjectAltName ?? null;
  o.infoAccess = cert.infoAccess ?? null;
  o.ca = cert.ca;
  o.rawHex = hex(cert.raw);
  o.rawIsBuffer = Buffer.isBuffer(cert.raw);
  o.publicKey = keyInfo(cert.publicKey);
  o.toString = cert.toString();
  o.toJSON = cert.toJSON();
  o.signatureAlgorithm = cert.signatureAlgorithm ?? null;
  o.signatureAlgorithmOid = cert.signatureAlgorithmOid ?? null;
  o.checkHost_ok = cert.checkHost("example.com");
  o.checkHost_wild = cert.checkHost("www.example.com");
  o.checkHost_bad = cert.checkHost("bad.example.org");
  o.checkHost_opts = cert.checkHost("example.com", { wildcards: false });
  o.checkHost_badopts = safe(() => cert.checkHost("example.com", "ignore"));
  o.checkEmail_ok = cert.checkEmail("admin@example.com");
  o.checkEmail_bad = cert.checkEmail("nope@example.com");
  o.checkIP_ok = cert.checkIP("127.0.0.1");
  o.checkIP_bad = cert.checkIP("10.0.0.1");
  o.checkIP_v6 = safe(() => cert.checkIP("::1"));
  if (leafKey) {
    o.checkPrivateKey_yes = cert.checkPrivateKey(leafKey);
    o.checkPrivateKey_rsa = codeOf(() => cert.checkPrivateKey(ca.publicKey));
  }
  return o;
}

const leaf = new crypto.X509Certificate(LEAF_PEM);
const ca = new crypto.X509Certificate(CA_PEM);
const leafKey = crypto.createPrivateKey({ key: LEAF_KEY_PEM, format: "pem", type: "pkcs1" });

const out = {};
out.leafPem = report(leaf, leafKey);
out.caPem = report(ca);
out.leafDer = report(new crypto.X509Certificate(LEAF_DER));
out.caDer = report(new crypto.X509Certificate(CA_DER));
out.leafLegacy = leaf.toLegacyObject();
out.caLegacy = ca.toLegacyObject();
out.verify_leaf_by_ca = leaf.verify(ca.publicKey);
out.verify_ca_by_ca = ca.verify(ca.publicKey);
out.verify_ca_by_leaf = safe(() => ca.verify(leaf.publicKey));
out.leaf_checkIssued_ca = leaf.checkIssued(ca);
out.ca_checkIssued_leaf = ca.checkIssued(leaf);
out.issuerCert_leaf = leaf.issuerCertificate === undefined ? "undefined" : "cert";
out.issuerCert_ca = ca.issuerCertificate === undefined ? "undefined" : "cert";
out.badNumber = safe(() => new crypto.X509Certificate(42));
out.badArray = safe(() => new crypto.X509Certificate([1, 2, 3]));
out.badString = safe(() => new crypto.X509Certificate("not a cert"));
out.emptyBuffer = safe(() => new crypto.X509Certificate(Buffer.alloc(0)));

process.stdout.write("__OBS__" + JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) + "\n");
