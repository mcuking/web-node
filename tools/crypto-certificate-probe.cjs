// M92.4 / M94 differential probe: the legacy crypto.Certificate (SPKAC).
//
// Runs unchanged on real Node v26.9.0 and inside web-node; both must print an
// identical `__OBS__` line. The SPKAC fixtures are the same ones Node's own
// test/parallel/test-crypto-certificate.js uses.
const crypto = require('crypto');

const SPKAC_VALID = "MIICUzCCATswggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC33FiIiiexwLe/P8DZx5HsqFlmUO7/lvJ7necJVNwqdZ3ax5jpQB0p6uxfqeOvzcN3k5V7UFb/Am+nkSNZMAZhsWzCU2Z4Pjh50QYz3f0Hour7/yIGStOLyYY3hgLK2K8TbhgjQPhdkw9+QtKlpvbL8fLgONAoGrVOFnRQGcr70iFffsm79mgZhKVMgYiHPJqJgGHvCtkGg9zMgS7p63+Q3ZWedtFS2RhMX3uCBy/mH6EOlRCNBbRmA4xxNzyf5GQaki3T+Iz9tOMjdPP+CwV2LqEdylmBuik8vrfTb3qIHLKKBAI8lXN26wWtA3kN4L7NP+cbKlCRlqctvhmylLH1AgMBAAEWE3RoaXMtaXMtYS1jaGFsbGVuZ2UwDQYJKoZIhvcNAQEEBQADggEBAIozmeW1kfDfAVwRQKileZGLRGCD7AjdHLYEe16xTBPve8Af1bDOyuWsAm4qQLYA4FAFROiKeGqxCtIErEvm87/09tCfF1My/1Uj+INjAk39DK9J9alLlTsrwSgd1lb3YlXY7TyitCmh7iXLo4pVhA2chNA3njiMq3CUpSvGbpzrESL2dv97lv590gUD988wkTDVyYsf0T8+X0Kww3AgPWGji+2f2i5/jTfD/s1lK1nqi7ZxFm0pGZoy1MJ51SCEy7Y82ajroI+5786nC02mo9ak7samca4YDZOoxN4d3tax4B/HDF5dqJSm1/31xYLDTfujCM5FkSjRc4m6hnriEkc=";
const SPKAC_INVALID = "UzCCATswggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC33FiIiiexwLe/P8DZx5HsqFlmUO7/lvJ7necJVNwqdZ3ax5jpQB0p6uxfqeOvzcN3k5V7UFb/Am+nkSNZMAZhsWzCU2Z4Pjh50QYz3f0Hour7/yIGStOLyYY3hgLK2K8TbhgjQPhdkw9+QtKlpvbL8fLgONAoGrVOFnRQGcr70iFffsm79mgZhKVMgYiHPJqJgGHvCtkGg9zMgS7p63+Q3ZWedtFS2RhMX3uCBy/mH6EOlRCNBbRmA4xxNzyf5GQaki3T+Iz9tOMjdPP+CwV2LqEdylmBuik8vrfTb3qIHLKKBAI8lXN26wWtA3kN4L7NP+cbKlCRlqctvhmylLH1AgMBAAEWE3RoaXMtaXMtYS1jaGFsbGVuZ2UwDQYJKoZIhvcNAQEEBQADggEBAIozmeW1kfDfAVwRQKileZGLRGCD7AjdHLYEe16xTBPve8Af1bDOyuWsAm4qQLYA4FAFROiKeGqxCtIErEvm87/09tCfF1My/1Uj+INjAk39DK9J9alLlTsrwSgd1lb3YlXY7TyitCmh7iXLo4pVhA2chNA3njiMq3CUpSvGbpzrESL2dv97lv590gUD988wkTDVyYsf0T8+X0Kww3AgPWGji+2f2i5/jTfD/s1lK1nqi7ZxFm0pGZoy1MJ51SCEy7Y82ajroI+5786nC02mo9ak7samca4YDZOoxN4d3tax4B/HDF5dqJSm1/31xYLDTfujCM5FkSjRc4m6hnriEkc=";
const PUB_PEM = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAt9xYiIonscC3vz/A2ceR\n7KhZZlDu/5bye53nCVTcKnWd2seY6UAdKersX6njr83Dd5OVe1BW/wJvp5EjWTAG\nYbFswlNmeD44edEGM939B6Lq+/8iBkrTi8mGN4YCytivE24YI0D4XZMPfkLSpab2\ny/Hy4DjQKBq1ThZ0UBnK+9IhX37Ju/ZoGYSlTIGIhzyaiYBh7wrZBoPczIEu6et/\nkN2VnnbRUtkYTF97ggcv5h+hDpUQjQW0ZgOMcTc8n+RkGpIt0/iM/bTjI3Tz/gsF\ndi6hHcpZgbopPL630296iByyigQCPJVzdusFrQN5DeC+zT/nGypQkZanLb4ZspSx\n9QIDAQAB\n-----END PUBLIC KEY-----\n";

const obs = {};
const strip = (s) => s.replace(/\n/g, '');

function norm(value) {
  if (Buffer.isBuffer(value)) return { buffer: value.toString('utf8') };
  return { value };
}
function call(fn) {
  try {
    return norm(fn());
  } catch (e) {
    return { error: { name: e.name, code: e.code, message: e.message } };
  }
}
function out(value) {
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return value;
}

// --- valid / invalid SPKAC --------------------------------------------------
obs.validVerify = crypto.Certificate.verifySpkac(SPKAC_VALID);
obs.validChallenge = out(crypto.Certificate.exportChallenge(SPKAC_VALID));
obs.validPublicKey = strip(out(crypto.Certificate.exportPublicKey(SPKAC_VALID)));
obs.pubMatchesFixture = strip(out(crypto.Certificate.exportPublicKey(SPKAC_VALID))) === strip(PUB_PEM);
obs.pubHead = out(crypto.Certificate.exportPublicKey(SPKAC_VALID)).split('\n')[0];
obs.pubTail = out(crypto.Certificate.exportPublicKey(SPKAC_VALID)).split('\n').pop();

obs.invalidVerify = crypto.Certificate.verifySpkac(SPKAC_INVALID);
obs.invalidChallenge = out(crypto.Certificate.exportChallenge(SPKAC_INVALID));
obs.invalidPublicKey = out(crypto.Certificate.exportPublicKey(SPKAC_INVALID));

// --- empty and malformed ----------------------------------------------------
obs.empty = {
  verify: crypto.Certificate.verifySpkac(''),
  challenge: out(crypto.Certificate.exportChallenge('')),
  publicKey: out(crypto.Certificate.exportPublicKey('')),
};
obs.badBase64 = {
  verify: crypto.Certificate.verifySpkac('!!!'),
  challenge: out(crypto.Certificate.exportChallenge('!!!')),
  publicKey: out(crypto.Certificate.exportPublicKey('!!!')),
};
obs.notBase64 = {
  verify: crypto.Certificate.verifySpkac('hello world'),
  challenge: out(crypto.Certificate.exportChallenge('hello world')),
};
obs.oddLength = {
  verify: crypto.Certificate.verifySpkac('AAA'),
  challenge: out(crypto.Certificate.exportChallenge('AAA')),
};

// --- whitespace handling (EVP_DecodeBlock is picky) ------------------------
obs.trailingNewline = crypto.Certificate.verifySpkac(SPKAC_VALID + '\n');
obs.trailingSpaces = crypto.Certificate.verifySpkac(SPKAC_VALID + '   ');
obs.trailingCRLF = crypto.Certificate.verifySpkac(SPKAC_VALID + '\r\n');
obs.leadingSpaces = crypto.Certificate.verifySpkac('   ' + SPKAC_VALID);
obs.wrappedLines = crypto.Certificate.verifySpkac(SPKAC_VALID.replace(/(.{64})/g, '$1\n'));

// --- input types ------------------------------------------------------------
{
  const buf = Buffer.from(SPKAC_VALID, 'utf8');
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  obs.types = {
    buffer: crypto.Certificate.verifySpkac(buf),
    arrayBuffer: crypto.Certificate.verifySpkac(ab),
    uint8Array: crypto.Certificate.verifySpkac(new Uint8Array(ab)),
    dataView: crypto.Certificate.verifySpkac(new DataView(ab)),
    rawDerBuffer: crypto.Certificate.verifySpkac(Buffer.from(SPKAC_VALID, 'base64')),
    encodingBase64: crypto.Certificate.verifySpkac(SPKAC_VALID, 'base64'),
    encodingUtf8: crypto.Certificate.verifySpkac(SPKAC_VALID, 'utf8'),
  };
}

// --- instance vs static -----------------------------------------------------
{
  const instance = new crypto.Certificate();
  obs.instance = {
    isInstance: instance instanceof crypto.Certificate,
    noNewIsInstance: crypto.Certificate() instanceof crypto.Certificate,
    staticIsPrototype:
      crypto.Certificate.verifySpkac === crypto.Certificate.prototype.verifySpkac &&
      crypto.Certificate.exportPublicKey === crypto.Certificate.prototype.exportPublicKey &&
      crypto.Certificate.exportChallenge === crypto.Certificate.prototype.exportChallenge,
    verify: instance.verifySpkac(SPKAC_VALID),
    challenge: out(instance.exportChallenge(SPKAC_VALID)),
  };
}

// --- bad argument types -----------------------------------------------------
obs.badArgs = {};
for (const [name, value] of [
  ['one', 1],
  ['object', {}],
  ['array', []],
  ['infinity', Infinity],
  ['boolean', true],
  ['undefined', undefined],
  ['null', null],
]) {
  obs.badArgs[name] = {
    verifySpkac: call(() => crypto.Certificate.verifySpkac(value)),
    exportPublicKey: call(() => crypto.Certificate.exportPublicKey(value)),
    exportChallenge: call(() => crypto.Certificate.exportChallenge(value)),
  };
}

console.log('__OBS__' + JSON.stringify(obs));
