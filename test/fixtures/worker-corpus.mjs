/**
 * A corpus of `worker_threads.Worker` behaviours, shared by the oracle
 * generator and the parity test.
 *
 * `tools/worker-corpus-oracle.mjs` runs this against a real Node's
 * `worker_threads` (real threads) and writes `test/fixtures/worker-corpus.json`;
 * `test/worker-corpus.test.ts` runs the identical function against the web-node
 * runtime's cooperative worker and asserts the answers are equal.
 *
 * The entries stay inside what a worker's *data semantics* cover — the message
 * round trip, `workerData` cloning, the `online`/`message`/`error`/`exit`
 * lifecycle, `terminate()`, the constructor's validation errors, and the module
 * surface. What a single realm cannot reproduce (real parallelism, per-thread
 * stdio/heap profiling) is deliberately out of scope; see docs/DEVLOG.md.
 */

/** The worker scripts the corpus needs, provisioned by whoever runs it. */
export const WORKER_FILES = {
  'plain.js': `// does nothing\n`,
  'echo.js': `
const { parentPort } = require('worker_threads');
parentPort.on('message', (m) => { parentPort.postMessage('re:' + m); parentPort.close(); });
`,
  'report.js': `
const { parentPort, workerData, isMainThread, threadId, threadName } = require('worker_threads');
parentPort.postMessage({
  data: workerData,
  isMainThread,
  threadIdPositive: threadId > 0,
  hasThreadName: typeof threadName === 'string',
  loadable: typeof require('path').join === 'function',
});
`,
  'badSync.js': `throw new Error('kaboom');\n`,
  'badAsync.js': `
const { parentPort } = require('worker_threads');
parentPort.postMessage('started');
setTimeout(() => { throw new Error('later'); }, 5);
`,
  'waiter.js': `
const { parentPort } = require('worker_threads');
parentPort.on('message', () => {});
parentPort.postMessage('waiting');
`,
};

function capture(fn) {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    return { ok: false, name: err && err.name, message: err && err.message, code: err && err.code };
  }
}

/** Drive one worker to completion and return the event names it produced. */
function runOne(vm, file, { workerData, drive, collect } = {}) {
  return new Promise((resolve) => {
    const events = [];
    const payloads = {};
    const worker = new vm.Worker(file, workerData === undefined ? {} : { workerData });
    worker.on('online', () => {
      events.push('online');
      if (drive) drive(worker);
    });
    worker.on('message', (message) => {
      events.push('message');
      if (collect) collect(message, payloads);
    });
    worker.on('error', (err) => {
      events.push('error');
      payloads.errorName = err && err.name;
      payloads.errorMessage = err && err.message;
    });
    worker.on('exit', (code) => {
      events.push('exit');
      payloads.exit = code;
      resolve({ events, payloads });
    });
  });
}

export async function runWorkerCorpus(vm, { pathFor }) {
  const file = (name) => pathFor(name);

  const sys = vm;
  const results = {};

  results.moduleKeys = [
    'Worker', 'MessageChannel', 'MessagePort', 'parentPort', 'workerData', 'threadId',
    'threadName', 'isMainThread', 'isInternalThread', 'receiveMessageOnPort', 'SHARE_ENV',
    'markAsUncloneable', 'markAsUntransferable', 'isMarkedAsUntransferable', 'BroadcastChannel',
    'getEnvironmentData', 'setEnvironmentData', 'resourceLimits', 'moveMessagePortToContext',
    'postMessageToThread',
  ].map((k) => `${k}:${k in sys}`).join(',');
  results.mainConstants = [
    sys.isMainThread,
    sys.threadId,
    sys.parentPort,
    typeof sys.SHARE_ENV,
    sys.SHARE_ENV.description,
  ].join('|');

  const plain = await runOne(sys, file('plain.js'));
  results.plainEvents = plain.events.join(',');
  results.plainExit = plain.payloads.exit;

  const echo = await runOne(sys, file('echo.js'), { drive: (w) => w.postMessage('ping') });
  results.echoEvents = echo.events.join(',');

  const echoPayloads = await runOne(sys, file('echo.js'), {
    drive: (w) => w.postMessage('ping'),
    collect: (m, out) => { out.reply = m; },
  });
  results.echoReply = echoPayloads.payloads.reply;

  const report = await runOne(sys, file('report.js'), {
    workerData: { n: 1, nested: { deep: [1, 2, 3] }, when: new Date(0) },
    collect: (m, out) => { out.report = m; },
  });
  results.reportEvents = report.events.join(',');
  results.reportData = {
    ...report.payloads.report,
    data: {
      ...report.payloads.report.data,
      when: report.payloads.report.data.when.toISOString(),
    },
  };

  const badSync = await runOne(sys, file('badSync.js'));
  results.badSync = { events: badSync.events.join(','), ...badSync.payloads };

  const badAsync = await runOne(sys, file('badAsync.js'));
  results.badAsync = { events: badAsync.events.join(','), ...badAsync.payloads };

  // `terminate()` on a worker held open by a message listener: the Promise
  // resolves with the exit code and an `exit` event lands with the same code.
  const terminated = await (async () => {
    const events = [];
    const worker = new sys.Worker(file('waiter.js'));
    worker.on('online', () => events.push('online'));
    await new Promise((res) => worker.on('message', (m) => { events.push('message:' + m); res(); }));
    const exitP = new Promise((res) => worker.on('exit', (code) => { events.push('exit:' + code); res(); }));
    const terminateCode = await worker.terminate();
    await exitP;
    return { events, terminateCode };
  })();
  results.terminateEvents = terminated.events.join(',');
  results.terminateCode = terminated.terminateCode;

  results.threadIds = await (async () => {
    const a = new sys.Worker(file('plain.js'));
    const b = new sys.Worker(file('plain.js'));
    const ids = [a.threadId > 0, b.threadId > 0, a.threadId !== b.threadId];
    await a.terminate();
    await b.terminate();
    return ids.join(',');
  })();

  results.workerSurface = [
    typeof sys.Worker.prototype.postMessage,
    typeof sys.Worker.prototype.terminate,
    typeof sys.Worker.prototype.ref,
    typeof sys.Worker.prototype.unref,
    typeof sys.Worker.prototype.hasRef,
    typeof sys.Worker.prototype.on,
    'threadId' in sys.Worker.prototype,
    'performance' in sys.Worker.prototype,
  ].join(',');

  results.constructors = {
    noArgs: capture(() => new sys.Worker()),
    bare: capture(() => new sys.Worker('w')),
    badEnv: capture(() => new sys.Worker(file('plain.js'), { env: 3 })),
    badName: capture(() => new sys.Worker(file('plain.js'), { name: 3 })),
    badArgv: capture(() => new sys.Worker(file('plain.js'), { argv: 'no' })),
  };

  return results;
}
