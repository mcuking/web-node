// Differential observation program for `fs`. Runs on real Node AND in web-node.
const fs = require('fs');
const os = require('os');

const out = {};

const dir = os.tmpdir() + '/wnfs-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
/** Hide the throwaway dir + pid so the oracle and web-node agree. */
const norm = (s) => String(s).split(dir).join('<d>');

function errShape(fn) {
  try {
    fn();
    return 'no-throw';
  } catch (e) {
    return { code: e.code, syscall: e.syscall, errno: e.errno, message: norm(e.message), name: e.name };
  }
}

async function main() {
  fs.mkdirSync(dir, { recursive: true });

  out.constants = {
    F_OK: fs.constants.F_OK,
    R_OK: fs.constants.R_OK,
    W_OK: fs.constants.W_OK,
    X_OK: fs.constants.X_OK,
    COPYFILE_EXCL: fs.constants.COPYFILE_EXCL,
    O_RDWR: fs.constants.O_RDWR,
    O_CREAT: fs.constants.O_CREAT,
  };

  const file = dir + '/a.txt';
  out.mkdirReturnsUndefined = fs.mkdirSync(dir + '/sub', { recursive: true }) === undefined;
  fs.writeFileSync(file, 'hello world');
  out.readUtf8 = fs.readFileSync(file, 'utf8');
  out.readIsBuffer = Buffer.isBuffer(fs.readFileSync(file));
  out.readByteLength = fs.readFileSync(file).byteLength;
  out.writeReturnsUndefined = fs.writeFileSync(dir + '/b.txt', 'v') === undefined;

  const st = fs.statSync(file);
  out.statInstanceOfStats = st instanceof fs.Stats;
  out.statIsFile = [st.isFile(), st.isDirectory(), st.isSymbolicLink()];
  out.statSize = st.size;
  out.statModes = { number: typeof st.mode, hasIsBlockDevice: typeof st.isBlockDevice };
  out.statKeys = Object.keys(st).sort();
  out.statProtoKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(st)).sort();
  out.bigintSize = typeof fs.statSync(file, { bigint: true }).size;
  out.lstatIsFile = fs.lstatSync(file).isFile();

  const dirSt = fs.statSync(dir);
  out.dirStat = [dirSt.isDirectory(), dirSt.isFile()];

  out.readdirSorted = fs.readdirSync(dir).sort();
  const dirents = fs.readdirSync(dir, { withFileTypes: true });
  out.direntInstance = dirents[0] instanceof fs.Dirent;
  out.direntFields = dirents.map((d) => [d.name, d.isFile(), d.isDirectory()]).sort((a, b) => (a[0] < b[0] ? -1 : 1));

  out.exists = [fs.existsSync(file), fs.existsSync(dir + '/nope')];

  fs.appendFileSync(file, '!');
  out.afterAppend = fs.readFileSync(file, 'utf8');

  fs.copyFileSync(file, dir + '/copy.txt');
  out.copyContent = fs.readFileSync(dir + '/copy.txt', 'utf8');
  out.copyExclError = errShape(() => fs.copyFileSync(file, dir + '/copy.txt', fs.constants.COPYFILE_EXCL)).code;

  fs.renameSync(dir + '/copy.txt', dir + '/moved.txt');
  out.renamedExists = [fs.existsSync(dir + '/copy.txt'), fs.existsSync(dir + '/moved.txt')];

  out.realpathOk = fs.realpathSync(file).endsWith('a.txt');
  out.realpathNativeType = typeof fs.realpathSync.native;

  // errors
  const miss = dir + '/missing.txt';
  out.errENOENT = errShape(() => fs.readFileSync(miss));
  out.errENOENTPath = errShape(() => fs.statSync(miss)).code;
  out.errEISDIR = errShape(() => fs.readFileSync(dir)).code;
  out.errENOTDIR = errShape(() => fs.readdirSync(file)).code;
  out.errEEXIST = errShape(() => fs.mkdirSync(dir + '/sub')).code;
  out.errEACCESShape = errShape(() => fs.readFileSync(dir + '/moved.txt', 'utf8')).code === undefined;

  // fd api
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(5);
  const n = fs.readSync(fd, buf, 0, 5, 0);
  out.fdRead = [n, buf.toString()];
  fs.closeSync(fd);
  out.fdCloseReturns = fs.closeSync(fs.openSync(file, 'r')) === undefined;

  // access
  out.accessOk = fs.accessSync(file) === undefined;
  out.accessError = errShape(() => fs.accessSync(miss)).code;

  // rm
  fs.rmSync(dir + '/sub', { recursive: true, force: true });
  out.rmGone = fs.existsSync(dir + '/sub');

  // promises
  out.promisesRead = await fs.promises.readFile(file, 'utf8');
  out.promisesStatIsStats = (await fs.promises.stat(file)) instanceof fs.Stats;
  out.promisesReaddir = (await fs.promises.readdir(dir)).sort();
  out.promisesErrorShape = await fs.promises.readFile(miss).then(
    () => 'no-throw',
    (e) => ({ code: e.code, syscall: e.syscall, message: norm(e.message) }),
  );

  // watch/writeStream presence only (no behaviour)
  out.surface = ['watch', 'createReadStream', 'createWriteStream', 'watchFile', 'unwatchFile', 'opendirSync', 'globSync'].map((k) => `${k}:${typeof fs[k]}`);

  fs.rmSync(dir, { recursive: true, force: true });

  console.log('__OBS__' + JSON.stringify(out));
}

main().catch((e) => {
  console.log('__OBS__' + JSON.stringify({ error: String((e && e.stack) || e) }));
  process.exitCode = 1;
});
