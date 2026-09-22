// Differential observation program for `fs` error shapes. Runs unchanged on
// real Node v26.9.0 AND inside web-node; the emitted JSON must be equal.
//
// Every error is reduced to the tuple Node's own `UVException`/`SystemError`
// expose: code, syscall, errno, path, dest, message, name. The throwaway base
// dir is normalised away (macOS resolves /var -> /private/var, so both spellings
// are stripped) — the observation is the *shape*, not the temp path.
const fs = require('fs');
const os = require('os');
const path = require('path');

const base = path.join(os.tmpdir(), 'wnfsx-' + Date.now() + '-' + Math.floor(Math.random() * 1e6));
fs.mkdirSync(base, { recursive: true });
fs.mkdirSync(base + '/sub');

/** Replace the throwaway dir (and its /private-resolved twin) with <d>. */
const norm = (s) => String(s).split('/private' + base).join('<d>').split(base).join('<d>');

function shape(fn) {
  try {
    fn();
    return 'no-throw';
  } catch (e) {
    const out = { code: e.code, syscall: e.syscall, errno: e.errno, name: e.name };
    if ('path' in e) out.path = e.path === undefined ? undefined : norm(e.path);
    if ('dest' in e) out.dest = e.dest === undefined ? undefined : norm(e.dest);
    out.message = norm(e.message);
    return out;
  }
}

const out = {};
const file = base + '/a.txt';
const miss = base + '/missing.txt';
const sub = base + '/sub';

fs.writeFileSync(file, 'hello world');

// ---- read paths ----
out.readFileENOENT = shape(() => fs.readFileSync(miss));
out.readFileENOENTUtf8 = shape(() => fs.readFileSync(miss, 'utf8'));
out.readFileEISDIR = shape(() => fs.readFileSync(sub));
out.readFileEISDIRUtf8 = shape(() => fs.readFileSync(sub, 'utf8'));
out.readFileFdEISDIR = (() => {
  const fd = fs.openSync(sub, 'r');
  try { return shape(() => fs.readFileSync(fd)); } finally { fs.closeSync(fd); }
})();
out.openENOENT = shape(() => fs.openSync(miss, 'r'));
out.openEACCES = shape(() => fs.openSync(file, 'r+', 0o000) && undefined);
out.statENOENT = shape(() => fs.statSync(miss));
out.lstatENOENT = shape(() => fs.lstatSync(miss));
out.statNestedENOTDIR = shape(() => fs.statSync(file + '/nested'));
out.accessENOENT = shape(() => fs.accessSync(miss));
out.realpathENOENT = shape(() => fs.realpathSync(miss));
out.readlinkENOENT = shape(() => fs.readlinkSync(miss));

// ---- directory paths ----
out.readdirENOTDIR = shape(() => fs.readdirSync(file));
out.readdirENOENT = shape(() => fs.readdirSync(miss));
out.opendirENOTDIR = shape(() => fs.opendirSync(file));
out.opendirENOENT = shape(() => fs.opendirSync(miss));
out.mkdirEEXIST = shape(() => fs.mkdirSync(sub));
out.mkdirENOTDIR = shape(() => fs.mkdirSync(file + '/x'));
out.mkdirRecursiveOverFile = shape(() => fs.mkdirSync(file, { recursive: true }));
out.rmdirENOENT = shape(() => fs.rmdirSync(miss));
out.rmdirENOTDIR = shape(() => fs.rmdirSync(file));
out.rmdirNotEmpty = (() => { fs.writeFileSync(sub + '/f', 'x'); return shape(() => fs.rmdirSync(sub)); })();
fs.rmSync(sub + '/f', { force: true });

// ---- removal / mutation ----
out.unlinkENOENT = shape(() => fs.unlinkSync(miss));
out.unlinkEISDIR = shape(() => fs.unlinkSync(sub));
out.rmENOENT = shape(() => fs.rmSync(miss));
out.rmDirNoRecursive = shape(() => fs.rmSync(sub));
out.renameENOENT = shape(() => fs.renameSync(miss, base + '/x'));
out.renameENOTDIR = shape(() => fs.renameSync(file + '/y', base + '/z'));
out.copyENOENT = shape(() => fs.copyFileSync(miss, base + '/c'));
out.copyEISDIR = shape(() => fs.copyFileSync(sub, base + '/c'));
out.copyExclEEXIST = (() => {
  try { fs.copyFileSync(file, base + '/dup'); } catch (e) { return { setup: norm(e.message) }; }
  return shape(() => fs.copyFileSync(file, base + '/dup', fs.constants.COPYFILE_EXCL));
})();
out.appendEISDIR = shape(() => fs.appendFileSync(sub, 'x'));
out.chmodENOENT = shape(() => fs.chmodSync(miss, 0o644));
out.chownENOENT = shape(() => fs.chownSync(miss, 0, 0));
out.truncateENOENT = shape(() => fs.truncateSync(miss));
out.utimesENOENT = shape(() => fs.utimesSync(miss, 0, 0));
out.linkENOENT = shape(() => fs.linkSync(miss, base + '/lnk'));
out.symlinkENOTDIR = shape(() => fs.symlinkSync('t', file + '/s'));

// ---- error object shape ----
{
  let e;
  try { fs.readFileSync(miss); } catch (x) { e = x; }
  out.errIsError = e instanceof Error;
  out.errCtor = e.constructor.name;
  out.errName = e.name;
  out.errOwnProps = Object.getOwnPropertyNames(e).filter((k) => k !== 'stack').sort();
}
{
  let e;
  try { fs.rmSync(sub); } catch (x) { e = x; }
  out.sysErrIsError = e instanceof Error;
  out.sysErrCtor = e.constructor.name;
  out.sysErrOwnProps = Object.getOwnPropertyNames(e).filter((k) => k !== 'stack').sort();
}

// ---- promises: same shape, rejected ----
async function main() {
  out.pReadEISDIR = await fs.promises.readFile(sub).then(() => 'no-throw', (e) => shape(() => { throw e; }));
  out.pReadENOENT = await fs.promises.readFile(miss).then(() => 'no-throw', (e) => shape(() => { throw e; }));
  out.pReaddirENOTDIR = await fs.promises.readdir(file).then(() => 'no-throw', (e) => shape(() => { throw e; }));
  out.pMkdirEEXIST = await fs.promises.mkdir(sub).then(() => 'no-throw', (e) => shape(() => { throw e; }));
  out.pRmENOENT = await fs.promises.rm(miss).then(() => 'no-throw', (e) => shape(() => { throw e; }));

  fs.rmSync(base, { recursive: true, force: true });
  console.log('__OBS__' + JSON.stringify(out));
}

main().catch((e) => {
  console.log('__OBS__' + JSON.stringify({ error: String((e && e.stack) || e) }));
  process.exitCode = 1;
});
