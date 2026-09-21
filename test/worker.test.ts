import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `worker_threads.Worker` — the cooperative worker.
 *
 * The corpus test (`worker-corpus.test.ts`) checks the lifecycle against a real
 * Node. This file covers the surface and the deliberate deviations: what the
 * worker's own globals look like, that modules/messages are isolated, and that
 * everything a single realm cannot honestly do (per-thread stdio, profiling,
 * nested workers, `eval`) refuses loudly rather than pretending.
 */
function boot(files: Record<string, string>): { require: (id: string) => any; runtime: NodeRuntime } {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', new TextEncoder().encode(''));
  for (const [name, contents] of Object.entries(files)) {
    vfs.writeFile(`/project/${name}`, new TextEncoder().encode(contents));
  }
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: () => {},
    onStderr: () => {},
  });
  return { require: (id: string) => runtime.realm.require(id), runtime };
}

const tick = (ms = 250): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Resolve once a freshly-created worker has exited, collecting its messages. */
function collect(worker: any): Promise<{ messages: unknown[]; code: number }> {
  return new Promise((resolve) => {
    const messages: unknown[] = [];
    worker.on('message', (m: unknown) => messages.push(m));
    worker.on('error', () => {});
    worker.on('exit', (code: number) => resolve({ messages, code }));
  });
}

describe('worker_threads.Worker', () => {
  it('exposes the module surface and the main-thread constants', () => {
    const { require: req } = boot({});
    const wt = req('worker_threads');
    expect(wt.isMainThread).toBe(true);
    expect(wt.threadId).toBe(0);
    expect(wt.threadName).toBe('main');
    expect(wt.parentPort).toBeNull();
    expect(wt.workerData).toBeNull();
    expect(wt.SHARE_ENV).toBe(Symbol.for('nodejs.worker_threads.SHARE_ENV'));
    expect(typeof wt.Worker).toBe('function');
    expect(typeof wt.MessageChannel).toBe('function');
    expect(typeof wt.markAsUntransferable).toBe('function');
    for (const m of ['postMessage', 'terminate', 'ref', 'unref', 'on']) {
      expect(typeof wt.Worker.prototype[m], m).toBe('function');
    }
    // Node's Worker has no `hasRef` on the prototype; neither does ours.
    expect(wt.Worker.prototype.hasRef).toBeUndefined();
  });

  it('runs a worker with its own process/worker_threads views', async () => {
    const { require: req } = boot({
      'views.js': `
const { parentPort, workerData, isMainThread, threadId, threadName } = require('worker_threads');
const proc = require('process');
parentPort.postMessage({
  wtMain: isMainThread,
  hasProcThreadId: 'threadId' in proc,
  threadIdPositive: threadId > 0,
  threadName,
  argv: proc.argv,
  envCopy: typeof proc.env === 'object',
  workerData,
});
`,
    });
    const { Worker } = req('worker_threads') as any;
    const worker = new Worker('/project/views.js', { workerData: { hello: 'world' } });
    const { messages } = await collect(worker);
    expect(messages[0]).toEqual({
      wtMain: false,
      hasProcThreadId: false,
      threadIdPositive: true,
      threadName: 'WorkerThread',
      argv: [String(req('process').execPath), '/project/views.js'],
      envCopy: true,
      workerData: { hello: 'world' },
    });
  });

  it('gives workerData as an isolated structured clone', async () => {
    const { require: req } = boot({
      'mutate.js': `
const { parentPort, workerData } = require('worker_threads');
workerData.nested.push('from worker');
parentPort.postMessage({ seen: workerData });
`,
    });
    const { Worker } = req('worker_threads') as any;
    const input = { nested: ['from parent'], when: new Date(0) };
    const worker = new Worker('/project/mutate.js', { workerData: input });
    const { messages } = await collect(worker);
    // The worker's copy is independent: the parent's object is untouched, and
    // complex types survive the clone.
    expect(input.nested).toEqual(['from parent']);
    expect((messages[0] as any).seen.nested).toEqual(['from parent', 'from worker']);
    expect((messages[0] as any).seen.when).toBeInstanceOf(Date);
  });

  it('keeps each worker\'s globals to itself', async () => {
    const { require: req } = boot({
      'setter.js': `globalThis.__leak = 'set'; require('worker_threads').parentPort.postMessage('set');\n`,
      'reader.js': `require('worker_threads').parentPort.postMessage(typeof globalThis.__leak);\n`,
    });
    const { Worker } = req('worker_threads') as any;
    const setter = await collect(new Worker('/project/setter.js'));
    expect(setter.messages).toEqual(['set']);
    const reader = await collect(new Worker('/project/reader.js'));
    expect(reader.messages).toEqual(['undefined']);
  });

  it('delivers messages both ways and lets the worker close its port', async () => {
    const { require: req } = boot({
      'echo.js': `
const { parentPort } = require('worker_threads');
parentPort.on('message', (m) => { parentPort.postMessage(m * 2); parentPort.close(); });
`,
    });
    const { Worker } = req('worker_threads') as any;
    const worker = new Worker('/project/echo.js');
    worker.on('online', () => worker.postMessage(21));
    const { messages, code } = await collect(worker);
    expect(messages).toEqual([42]);
    expect(code).toBe(0);
  });

  it('treats sends after exit as no-ops, like Node', async () => {
    const { require: req } = boot({ 'plain.js': `// nothing\n` });
    const { Worker } = req('worker_threads') as any;
    const worker = new Worker('/project/plain.js');
    await collect(worker);
    expect(worker.threadId).toBe(-1);
    expect(worker.threadName).toBeNull();
    expect(() => worker.postMessage('late')).not.toThrow();
    expect(worker.terminate()).toBeUndefined();
  });

  it('terminate() resolves with the exit code and emits exit', async () => {
    const { require: req } = boot({
      'waiter.js': `require('worker_threads').parentPort.on('message', () => {});\n`,
    });
    const { Worker } = req('worker_threads') as any;
    const worker = new Worker('/project/waiter.js');
    const exits: number[] = [];
    worker.on('exit', (c: number) => exits.push(c));
    await tick(30);
    const code = await worker.terminate();
    expect(code).toBe(1);
    expect(exits).toEqual([1]);
  });

  it('reports an uncaught throw as error then exit 1', async () => {
    const { require: req } = boot({ 'bad.js': `throw new Error('boom');\n` });
    const { Worker } = req('worker_threads') as any;
    const worker = new Worker('/project/bad.js');
    const seen: string[] = [];
    worker.on('online', () => seen.push('online'));
    worker.on('error', (e: Error) => seen.push(`error:${e.message}`));
    worker.on('exit', (c: number) => seen.push(`exit:${c}`));
    await tick(60);
    expect(seen).toEqual(['online', 'error:boom', 'exit:1']);
  });

  it('shares environment data between the main thread and workers', async () => {
    const { require: req } = boot({
      'envdata.js': `
const { parentPort, getEnvironmentData, setEnvironmentData } = require('worker_threads');
parentPort.postMessage(getEnvironmentData('answer'));
setEnvironmentData('fromWorker', 7);
`,
    });
    const wt = req('worker_threads') as any;
    wt.setEnvironmentData('answer', 42);
    const worker = new wt.Worker('/project/envdata.js');
    await collect(worker);
    expect(wt.getEnvironmentData('fromWorker')).toBe(7);
  });

  it('honours explicit env and SHARE_ENV', async () => {
    const { require: req } = boot({
      'env.js': `require('worker_threads').parentPort.postMessage(String(process.env.K));\n`,
    });
    const wt = req('worker_threads') as any;
    const explicit = await collect(new wt.Worker('/project/env.js', { env: { K: 'explicit' } }));
    expect(explicit.messages).toEqual(['explicit']);
    const shared = await collect(new wt.Worker('/project/env.js', { env: wt.SHARE_ENV }));
    expect(shared.messages).toEqual(['undefined']);
    (req('process') as any).env.K = 'from-shared';
    const shared2 = await collect(new wt.Worker('/project/env.js', { env: wt.SHARE_ENV }));
    expect(shared2.messages).toEqual(['from-shared']);
  });

  it('validates the constructor like Node', () => {
    const { require: req } = boot({ 'plain.js': '' });
    const { Worker } = req('worker_threads') as any;
    const bad = (fn: () => unknown): any => {
      try {
        fn();
      } catch (err) {
        return err as any;
      }
      return null;
    };
    expect(bad(() => new Worker())!.message).toMatch(/"filename" argument must be of type string or an instance of URL/);
    expect(bad(() => new Worker('bare'))!.code).toBe('ERR_WORKER_PATH');
    expect(bad(() => new Worker('/project/plain.js', { env: 3 }))!.code).toBe('ERR_INVALID_ARG_TYPE');
    expect(bad(() => new Worker('/project/plain.js', { name: 3 }))!.code).toBe('ERR_INVALID_ARG_TYPE');
    expect(bad(() => new Worker('/project/plain.js', { argv: 'no' }))!.code).toBe('ERR_INVALID_ARG_TYPE');
  });

  it('refuses, loudly, what one realm cannot do', async () => {
    const { require: req } = boot({
      'plain.js': `// nothing\n`,
      'nested.js': `
const { parentPort, Worker } = require('worker_threads');
try { new Worker('x'); parentPort.postMessage('built'); }
catch (e) { parentPort.postMessage(e.code); }
`,
    });
    const wt = req('worker_threads') as any;
    const opt = (options: Record<string, unknown>, fragment: string): void => {
      let thrown: any;
      try {
        new wt.Worker('/project/plain.js', options);
      } catch (err) {
        thrown = err;
      }
      expect(thrown?.code, fragment).toBe('ERR_WEB_NODE_NOT_IMPLEMENTED');
      expect(thrown?.message).toMatch(new RegExp(fragment));
    };
    opt({ eval: true }, 'eval');
    opt({ resourceLimits: { maxOldGenerationSizeMb: 1 } }, 'resourceLimits');
    opt({ stdout: true }, 'stdout');
    opt({ stdin: true }, 'stdin');

    const worker = new wt.Worker('/project/plain.js');
    expect(() => worker.stdout).toThrow(/ERR_WEB_NODE_NOT_IMPLEMENTED|not implemented/);
    await expect(worker.getHeapSnapshot()).rejects.toThrow(/not implemented/);
    await expect(worker.cpuUsage()).rejects.toThrow(/not implemented/);

    // A worker cannot start another worker (no second thread to give it).
    const nested = await collect(new wt.Worker('/project/nested.js'));
    expect(nested.messages).toEqual(['ERR_WEB_NODE_NOT_IMPLEMENTED']);
  });

  it('still provides the message-passing classes', () => {
    const { require: req } = boot({});
    const { MessageChannel, receiveMessageOnPort } = req('worker_threads');
    const channel = new MessageChannel();
    channel.port1.postMessage({ ok: true });
    expect(receiveMessageOnPort(channel.port2).message).toEqual({ ok: true });
  });
});
