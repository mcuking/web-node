'use strict';
// Differential probe for `module.stripTypeScriptTypes` (strip-only).
// Run under real Node (v26.9.0) and under web-node; compare the __OBS__ JSON.
//
// Usage: node tools/strip-ts-probe.cjs
//
// Observation format (per case):
//   { id, kind: 'ok'|'err', out? , err?: { name, code, message } }
// `out` is the raw stripped string; the compare harness compares byte-for-byte.

const cases = [];
let n = 0;
function C(label, code, options) {
  cases.push({ id: `c${String(++n).padStart(2, '0')}-${label}`, code, options });
}

// ---- 1. baseline: type annotations blanked, column-preserving ----
C('var-annotation', 'const x: number = 1;');
C('as-cast', 'const x = 1 as number;');
C('satisfies', 'const v = 1 satisfies number;');
C('return-type', 'function f(a: number): string { return String(a); }');
C('generic-fn', 'function f<X>(x: X): X { return x; }');
C('generic-call', 'const y = f<string>("a");');
C('interface-decl', 'interface A { x: number; y?: string }');
C('type-alias', 'type T<U> = U[] | null;');
C('class-field', 'class C { x: number = 1; y?: string }');
C('class-method', 'class C { m(a: number): void {} }');
C('access-modifiers', 'class C { private x: number = 1; public y = 2; readonly z = 3; }');
C('import-type', "import type { A } from './a';");
C('import-named', "import { A, type B } from './a';");
C('export-type', 'export type { A };');
C('array-annotation', 'let a: Array<string> = [];');
C('union-annotation', 'let u: string | number = 1;');
C('tuple-annotation', 'let t: [number, string] = [1, "a"];');
C('object-annotation', 'let o: { a: number; b: string } = { a: 1, b: "x" };');
C('fn-type-annotation', 'let cb: (a: number) => void;');
C('assertion-angle', 'const e = <number>value;');
C('non-null', 'const v = obj!.x;');
C('optional-param', 'function g(a?: number) {}');
C('default-param', 'function h(a: number = 1) {}');
C('rest-param', 'function r(...a: number[]) {}');
C('type-param-constraint', 'function tc<T extends object>(x: T) {}');
C('declare-stmt', 'declare const x: number;');
C('declare-fn', 'declare function d(a: number): void;');
C('abstract-class', 'abstract class A { abstract m(): void; }');
C('as-const', 'const a = [1, 2] as const;');
C('export-default-type', 'export default interface I { x: number }');
C('comment-preserve', 'const x /* keep */ : number = 1;');
C('string-like-type', 'const s = "a: number";');
C('template-like-type', 'const t = `x: number = 1`;');
C('regex-like-type', 'const r = /a: number/g;');
C('multiline', 'const x: number =\n  1;\nconst y: string = "z";\n');
C('generic-arrow', 'const f = <T,>(x: T): T => x;');
C('nested-generics', 'let m: Map<string, Array<number>> = new Map();');
C('index-signature', 'interface I { [k: string]: number }');
C('call-signature', 'interface I { (a: number): void }');
C('constructor-sig', 'interface I { new (a: number): I }');
C('enum-in-strip', 'enum E { A, B }');
C('namespace-in-strip', 'namespace N { export const x = 1; }');
C('import-equals', "import A = require('./a');");
C('param-property', 'class C { constructor(private x: number) {} }');
C('module-stmt', 'module M { }');
C('decorator', 'class C { @dec m() {} }');
C('type-only-export-eq', 'export = 1;');
C('this-param', 'function f(this: void, a: number) {}');
C('instantiation-expr', 'const z = f<string>;');
C('ts-syntax-jsx-like', 'const a = b < c > d;');
C('readonly-array', 'let ra: readonly number[] = [];');
C('keyof-type', 'let k: keyof A = "x";');
C('conditional-type', 'type X<T> = T extends string ? 1 : 2;');
C('mapped-type', 'type M<T> = { [K in keyof T]: T[K] };');
C('template-literal-type', 'type S = `a${string}b`;');
C('typeof-type', 'let v: typeof window = 1;');
C('import-meta', 'const u = import.meta.url;');
C('global-augmentation', 'declare global { interface Window { x: number } }');
C('overload-sig', 'function f(a: number): void;\nfunction f(a: string): void;\nfunction f(a: any): void {}');

// ---- 2. options / argument validation ----
C('opt-mode-strip', 'let x = 1;', { mode: 'strip' });
C('opt-mode-transform', 'let x = 1;', { mode: 'transform' });
C('opt-mode-bogus', 'let x = 1;', { mode: 'bogus' });
C('opt-sourceurl', 'let x = 1;', { sourceUrl: 'file:///x.ts' });
C('opt-sourceurl-empty', 'let x = 1;', { sourceUrl: '' });
C('opt-sourcemap-false', 'let x = 1;', { sourceMap: false });
C('opt-sourcemap-true', 'let x = 1;', { sourceMap: true });
C('opt-empty-file', '');
C('opt-whitespace-only', '   \n\t  ');
C('opt-comment-only', '// just a comment\n');

// ---- 3. extended / stress corpus ----
C('x-comment-before-type', 'let a /* c1 */ : /* c2 */ number = 1;');
C('x-string-type-like', 'const s = "interface A { x: number }";');
C('x-tpl-type-like', 'const s = `a: number = 1`;');
C('x-regex-slash', 'const r = a / b / c;');
C('x-div-chain', 'const r = (a + b) / c;');
C('x-regex-after-return', 'function f() { return /x: number/; }');
C('x-tpl-sub-1', 'const t = `a${b as number}c`;');
C('x-tpl-sub-2', 'const t = `x${fn<string>("a")}y`;');
C('x-tpl-sub-3', 'const t = `a${ {x:1} }b`;');
C('x-conditional-type', 'type X<T> = T extends Array<infer U> ? U : never;');
C('x-mapped-modifiers', 'type M<T> = { readonly [K in keyof T]?: T[K] };');
C('x-tpl-literal-type', 'type S = `on${Capitalize<string>}`;');
C('x-indexed-access', 'type A = B["key"][number];');
C('x-fn-type-rest', 'type F = (...args: number[]) => void;');
C('x-ctor-type', 'type C = new (a: number) => object;');
C('x-union-fn', 'type U = (() => void) | null;');
C('x-arrow-async', 'const f = async (a: number): Promise<void> => {};');
C('x-arrow-single', 'const f = (x: number) => x + 1;');
C('x-arrow-noparen', 'const f = x => x;');
C('x-arrow-tpl', 'const f = <T,>(x: T): T => x;');
C('x-arrow-nested', 'const f = (cb: (a: number) => void) => {};');
C('x-arrow-obj-param', 'const f = ({a, b}: {a: number, b: number}) => a + b;');
C('x-class-static', 'class C { static x: number = 1; static m(): void {} }');
C('x-class-private', 'class C { #x: number = 1; #m(): void {} }');
C('x-class-computed', 'class C { ["a"]: number = 1; }');
C('x-class-getset', 'class C { get a(): number { return 1 } set a(v: number) {} }');
C('x-class-optional-method', 'class C { m?(): void; }');
C('x-class-overloads', 'class C { m(a: number): void; m(a: string): void; m(a: any) {} }');
C('x-class-seq', 'class C { a = 1\n; b: number = 2\n; }');
C('x-class-implements', 'class C implements I, J { }');
C('x-class-extends-generic', 'class C extends B<number> { }');
C('x-class-expr-generic', 'const C = class<T> extends B<T> {};');
C('x-declare-global', 'declare global { interface Window { x: number } }');
C('x-declare-module', 'declare module "foo" { export const x: number; }');
C('x-declare-const', 'declare const a: number, b: string;');
C('x-namespace-empty', 'namespace N {}');
C('x-namespace-types', 'namespace N { export type T = number }');
C('x-overload-fn', 'function f(a: number): void;\nfunction f(a: string): void;\nfunction f(a: any): void {}');
C('x-destructure-default', 'const { a = 1, b }: { a?: number, b: string } = o;');
C('x-array-destructure-type', 'const [a, b]: [number, string] = t;');
C('x-forof-type', 'for (const x: number of xs) {}');
C('x-catch-type', 'try {} catch (e: unknown) {}');
C('x-switch', 'switch (x) { case 1: break; default: break; }');
C('x-optional-chain', 'const v = a?.b?.c;');
C('x-nonnull-chain', 'const v = a!.b!.c!;');
C('x-as-const-arr', 'const a = [1, 2, 3] as const;');
C('x-satisfies-obj', 'const c = { a: 1 } satisfies Record<string, number>;');
C('x-double-cast', 'const z = (x as any) as string;');
C('x-generic-call-complex', 'const m = new Map<string, Array<number>>();');
C('x-call-typeargs-two', 'f<A, B>(x);');
C('x-instantiation-only', 'const g = f<string>;');
C('x-comparison-not-typeargs', 'const b = x < y > z;');
C('x-import-default', 'import def from "./m";');
C('x-import-ns', 'import * as ns from "./m";');
C('x-import-named-mixed', 'import def, { a, type B as C } from "./m";');
C('x-import-mixed-real', 'import { A, type B } from "./m";');
C('x-export-named', 'export { a, b };');
C('x-export-type-named', 'export { type A, B };');
C('x-export-star-from', 'export * from "./m";');
C('x-export-star-as', 'export * as ns from "./m";');
C('x-export-decl', 'export const x: number = 1;');
C('x-export-fn', 'export function f(a: number): void {}');
C('x-export-class-generic', 'export class C<T> {}');
C('x-export-default-fn', 'export default function f(a: number): void {}');
C('x-export-default-class', 'export default class C<T> {}');
C('x-decorator-class', '@dec class C {}');
C('x-decorator-member', 'class C { @dec x: number = 1; @m() m2() {} }');
C('x-multiline-real', 'export interface Options {\n  readonly root: string;\n  verbose?: boolean;\n}\nexport function run(opts: Options): Promise<void> {\n  return Promise.resolve();\n}\n');
C('x-this-void', 'function f(this: void, a: number) {}');
C('x-typeof-import', 'let x: typeof import("./m") = y;');
C('x-keyof-typeof', 'let k: keyof typeof obj = "a";');
C('x-type-in-call', 'tag<string>`hello ${x as number}`;');
C('x-nested-obj-type-line', 'const o: {\n  a: number;\n  b: string;\n} = { a: 1, b: "x" };');
C('x-class-field-fn-type', 'class C { cb: (a: number) => void = () => {}; }');
C('x-abstract-full', 'abstract class A { abstract m(): void; abstract x: number; }');
C('x-optional-arrow-ret', 'const f = (a?: number): string | undefined => undefined;');
C('x-type-predicate', 'function is(v: unknown): v is string { return true }');
C('x-asserts-pred', 'function a(v: unknown): asserts v is string {}');
C('x-asserts-only', 'function a(v: unknown): asserts v {}');
C('x-this-predicate', 'function f(): this is C { return true }');
C('x-unicode-2byte', 'const x: "é" = 1;');
C('x-unicode-3byte', 'interface A { x: "—" }');
C('x-unicode-4byte', 'const x: "😀" = 1;');
C('x-unicode-mixed', 'interface A { x: "aé—😀" }');
C('x-unicode-in-comment', 'const s = 1; interface A { /* — 😀 é */ }');
C('x-tab-in-blank', 'const x:\tnumber = 1;');
C('x-crlf-blank', 'interface A {\r\n  x: number;\r\n}');
C('x-leading-union', 'type X = | A | B;');
C('x-leading-union-obj', 'let x:\n      | {\n          a: number;\n          b(c: string): void;\n        }\n      | null = null;');
C('x-class-index-sig', 'class C { pid: number; [key: string]: unknown; }');
C('x-arrow-ret-fn-type', 'const f = (a: number): ((b: string) => void) => () => {};');
C('x-obj-getter-method', 'const o = { get(): unknown { return 1 } };');
C('x-obj-getter', 'const o = { get x(): number { return 1 } };');
C('x-namespace-ident', 'namespace[key] = bound;');
C('x-div-after-paren', 'const y = modPow(rhs, (p + 1n) / 4n, p);');
C('x-as-in-array', 'const a = [view(source as ArrayBuffer)];');
C('x-as-in-index', 'const v = arr[key as number];');
C('x-paren-fn-type-in-union', 'type Z = ((this: A, b: number) => void) | null;');
C('x-objtype-in-union', 'type Y = { a?: (b: string, ...c: unknown[]) => boolean; d?: boolean };');
C('x-optional-fn-field', 'class C { cb?: (a: number) => void; }');
C('x-generic-static-arrow', 'class C { static make = <T>(x: T): T => x; }');

function runCase(mod, c) {
  let out;
  try {
    if (c.options === undefined) out = mod.stripTypeScriptTypes(c.code);
    else out = mod.stripTypeScriptTypes(c.code, c.options);
    return { id: c.id, kind: 'ok', out };
  } catch (e) {
    return {
      id: c.id,
      kind: 'err',
      err: {
        name: e && e.name,
        code: e && e.code,
        message: e && e.message,
        // constructor name matters for structural comparisons
        ctor: e && e.constructor && e.constructor.name,
      },
    };
  }
}

function main() {
  // The impl can be injected (used by the differential harness to run this
  // corpus against an alternative implementation); defaults to real `module`.
  const injected = globalThis.__STRIP_TS_IMPL__;
  const mod = injected ? { stripTypeScriptTypes: injected } : require('module');
  // Silence the ExperimentalWarning on stderr so stdout stays parseable.
  const origEmit = process.emitWarning;
  process.emitWarning = () => {};
  const results = cases.map((c) => runCase(mod, c));
  process.emitWarning = origEmit;
  process.stdout.write('__OBS__' + JSON.stringify({ results }) + '\n');
}

main();
