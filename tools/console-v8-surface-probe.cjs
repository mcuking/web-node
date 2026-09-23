'use strict';
/** Surface diff probe for console + v8 (M105). */
const v8 = require('node:v8');
const safe = (fn) => {
  try {
    return fn();
  } catch (e) {
    return `throw:${e.code || e.name}`;
  }
};
const obs = {
  v8: Object.getOwnPropertyNames(v8).sort(),
  consoleExtras: ['Console', 'context', 'createTask', 'profile', 'profileEnd', 'timeStamp', 'timeLog']
    .map((k) => `${k}:${typeof console[k]}`),
  createTaskLength: console.createTask.length,
  taskRun: (() => {
    try {
      const t = console.createTask('t');
      return typeof t.run === 'function' ? t.run(() => 'ok') : 'no-run';
    } catch (e) {
      return `throw:${e.code || e.name}`;
    }
  })(),
  serializeRoundtrip: safe(() => {
    const buf = v8.serialize({ a: [1, 'x', null, true], b: { c: 3.5 } });
    return { isBuffer: Buffer.isBuffer(buf), back: v8.deserialize(buf) };
  }),
  cachedDataVersionTag: safe(() => typeof v8.cachedDataVersionTag()),
  oneByte: safe(() => ['a', '\u4e2d', '\u00e9'].map((s) => v8.isStringOneByteRepresentation(s))),
  startupSnapshot: safe(() => ({
    isBuildingSnapshot: v8.startupSnapshot.isBuildingSnapshot(),
    addSerializeCallback: typeof v8.startupSnapshot.addSerializeCallback,
  })),
  setFlagsFromString: safe(() => {
    v8.setFlagsFromString('--max-old-space-size=2048');
    return 'ok';
  }),
};
console.log('__OBS__ ' + JSON.stringify(obs));
