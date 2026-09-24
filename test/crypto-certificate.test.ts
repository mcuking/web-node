import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { setOpensslEnabled } from '../src/node-runtime/bindings/openssl';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * M94: the legacy `crypto.Certificate` SPKAC helper.
 * `tools/crypto-certificate-probe.cjs` runs unchanged on real Node and inside
 * web-node; the observation must match `test/fixtures/crypto-certificate.json`
 * (recorded via `tools/crypto-certificate-oracle.mjs`).
 */
async function runProbe(program: string): Promise<Record<string, unknown>> {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', new TextEncoder().encode(program));
  const out: string[] = [];
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: (c) => out.push(c),
    onStderr: () => {},
  });
  runtime.runMain('/project/index.js');

  let stdout = out.join('');
  for (let i = 0; i < 600 && !stdout.includes('__OBS__'); i++) {
    await new Promise((r) => setTimeout(r, 25));
    stdout = out.join('');
  }
  const line = stdout.split('\n').find((l) => l.startsWith('__OBS__'));
  expect(line, 'probe produced no observation line').toBeTruthy();
  return JSON.parse(line!.slice('__OBS__'.length)) as Record<string, unknown>;
}

describe('crypto.Certificate (differential vs real Node)', () => {
  it('matches the oracle exactly', async () => {
    const program = fs.readFileSync('tools/crypto-certificate-probe.cjs', 'utf8');
    const expected = JSON.parse(fs.readFileSync('test/fixtures/crypto-certificate.json', 'utf8'));
    const observed = await runProbe(program);
    expect(observed).toEqual(expected);
  }, 60000);
});

describe('crypto.Certificate engine parity', () => {
  /** The valid SPKAC fixture, same one `tools/crypto-certificate-probe.cjs` uses. */
  const SPKAC_VALID =
    'MIICUzCCATswggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC33FiIiiexwLe/P8DZx5HsqFlmUO7/lvJ7necJVNwqdZ3ax5jpQB0p6uxfqeOvzcN3k5V7UFb/Am+nkSNZMAZhsWzCU2Z4Pjh50QYz3f0Hour7/yIGStOLyYY3hgLK2K8TbhgjQPhdkw9+QtKlpvbL8fLgONAoGrVOFnRQGcr70iFffsm79mgZhKVMgYiHPJqJgGHvCtkGg9zMgS7p63+Q3ZWedtFS2RhMX3uCBy/mH6EOlRCNBbRmA4xxNzyf5GQaki3T+Iz9tOMjdPP+CwV2LqEdylmBuik8vrfTb3qIHLKKBAI8lXN26wWtA3kN4L7NP+cbKlCRlqctvhmylLH1AgMBAAEWE3RoaXMtaXMtYS1jaGFsbGVuZ2UwDQYJKoZIhvcNAQEEBQADggEBAIozmeW1kfDfAVwRQKileZGLRGCD7AjdHLYEe16xTBPve8Af1bDOyuWsAm4qQLYA4FAFROiKeGqxCtIErEvm87/09tCfF1My/1Uj+INjAk39DK9J9alLlTsrwSgd1lb3YlXY7TyitCmh7iXLo4pVhA2chNA3njiMq3CUpSvGbpzrESL2dv97lv590gUD988wkTDVyYsf0T8+X0Kww3AgPWGji+2f2i5/jTfD/s1lK1nqi7ZxFm0pGZoy1MJ51SCEy7Y82ajroI+5786nC02mo9ak7samca4YDZOoxN4d3tax4B/HDF5dqJSm1/31xYLDTfujCM5FkSjRc4m6hnriEkc=';

  function boot(): any {
    const vfs = new MemoryVfs({ cwd: '/project' });
    vfs.mkdir('/project', { recursive: true });
    const runtime = new NodeRuntime({
      vfs,
      argv: ['/project/index.js'],
      installGlobals: false,
      onStdout: () => {},
      onStderr: () => {},
    });
    return runtime.realm.require('crypto');
  }

  const utf8 = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

  function snapshot(Certificate: any): Record<string, unknown> {
    const cert = new Certificate();
    return {
      verify: cert.verifySpkac(SPKAC_VALID),
      challenge: utf8(cert.exportChallenge(SPKAC_VALID)),
      publicKey: utf8(cert.exportPublicKey(SPKAC_VALID)),
      // Whitespace handling is part of OpenSSL's decoder, so exercise it too.
      trailingNewline: cert.verifySpkac(`${SPKAC_VALID}\n`),
      leadingSpaces: cert.verifySpkac(`  ${SPKAC_VALID}`),
      wrappedLines: cert.verifySpkac(SPKAC_VALID.slice(0, 40) + '\n' + SPKAC_VALID.slice(40)),
      badBase64: cert.verifySpkac('!!!not base64!!!'),
    };
  }

  it('produces identical results with the wasm engine on and off', () => {
    const crypto = boot();
    setOpensslEnabled(true);
    const withWasm = snapshot(crypto.Certificate);
    setOpensslEnabled(false);
    const withoutWasm = snapshot(crypto.Certificate);
    setOpensslEnabled(true);
    expect(withoutWasm).toEqual(withWasm);
  });
});
