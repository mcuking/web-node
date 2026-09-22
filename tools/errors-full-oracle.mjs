// Full-coverage oracle for `internal/errors`.
//
// For every code Node defines, work out how many arguments its constructor
// takes (string messages assert an exact arity; function messages accept any
// and are probed until one constructs), then build that many placeholder
// arguments and record the constructed error's observable fields. The result
// is diffed against web-node's shim for every shared code.
//
//   node --expose-internals tools/errors-full-oracle.mjs > /tmp/node-all-errors.json
//
// Caveat: codes whose message is a function and whose formatter needs a
// particular *shape* (not just arity) may only construct at a higher arity;
// the probe climbs until it succeeds, so the recorded args are the first
// vector that works, mirrored exactly on both sides.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { codes } = require('internal/errors');

const PALETTE = ['__a__', 1, ['x', 'y'], { k: 1 }, true, null, '__b__', 2];

function arityFrom(nodeErr, code) {
  // The arity assert reads: "... does not match the required ones (N)."
  const m = /required ones \((\d+)\)/.exec(nodeErr.message);
  return m ? Number(m[1]) : null;
}

function build(C, args) {
  try {
    return { ok: true, err: new C(...args) };
  } catch (e) {
    return { ok: false, err: e };
  }
}

function describe(C, args) {
  const built = build(C, args);
  if (!built.ok) return { built: false, threw: `${built.err.name}: ${built.err.message}` };
  const err = built.err;
  const props = {};
  for (const k of Object.keys(err)) if (k !== 'code') props[k] = err[k];
  const extra = {};
  for (const k of ['TypeError', 'RangeError', 'SyntaxError', 'Error']) {
    if (typeof C[k] === 'function') {
      const e = build(C[k], args);
      extra[k] = e.ok
        ? { name: e.err.name, code: e.err.code, message: e.err.message }
        : { threw: String(e.err.message) };
    }
  }
  return {
    built: true,
    name: err.name,
    errorCode: err.code,
    message: err.message,
    isError: err instanceof Error,
    isTypeError: err instanceof TypeError,
    isRangeError: err instanceof RangeError,
    isSyntaxError: err instanceof SyntaxError,
    props,
    extra,
  };
}

const out = {};
for (const code of Object.keys(codes)) {
  const C = codes[code];
  if (typeof C !== 'function') continue;

  // 1) Discover the arity: 0 args; if that asserts, read N from the message.
  let arity = 0;
  const probe0 = build(C, []);
  if (!probe0.ok) {
    const n = arityFrom(probe0.err, code);
    arity = n == null ? -1 : n; // -1 => function message, climb instead
  }

  let args;
  let desc;
  if (arity >= 0) {
    args = PALETTE.slice(0, arity);
    desc = describe(C, args);
  } else {
    // Function message: climb until it constructs.
    args = null;
    desc = null;
    for (let n = 0; n <= PALETTE.length; n += 1) {
      const cand = PALETTE.slice(0, n);
      const d = describe(C, cand);
      if (d.built) {
        args = cand;
        desc = d;
        break;
      }
    }
    if (args === null) {
      args = [];
      desc = describe(C, []);
    }
  }
  out[code] = { code, args, ...desc };
}

process.stdout.write(JSON.stringify(out, null, 2) + '\n');
