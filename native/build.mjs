#!/usr/bin/env node
// web-node — native → WASM 构建脚本（M115）
//
// 用 wasi-sdk 的 clang 把 `native/src/*.c` 编成 wasm32-wasi 模块，产物写到
// `src/node-runtime/wasm/artifacts/`（提交进仓库，于是部署/CI 不需要工具链）。
//
// 工具链定位顺序：`WASI_SDK_PATH` 环境变量 → 常见安装位置。
// 用法：
//   node native/build.mjs            # 编所有模块
//   node native/build.mjs wn_stub    # 只编一个
//   node native/build.mjs --inspect  # 编完打印每个模块的 imports/exports
//
// 为什么产物体积优先：wasm 是运行时资产，不是内联进 worker bundle 的字符串
// （M107 的教训——大载荷内联会把 worker 撑大并拖慢冷启动）。

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const srcDir = join(here, 'src');
const outDir = join(repo, 'src', 'node-runtime', 'wasm', 'artifacts');

/** 找到 wasi-sdk 安装目录（含 bin/clang 与 share/wasi-sysroot）。 */
function findWasiSdk() {
  const candidates = [
    process.env.WASI_SDK_PATH,
    join(process.env.HOME ?? '', 'wasi-sdk-34.0'),
    join(process.env.HOME ?? '', 'Downloads', 'wasi-sdk-34.0'),
    join(process.env.HOME ?? '', 'Downloads', 'wasi-sdk'),
    '/opt/wasi-sdk',
  ].filter(Boolean);
  for (const c of candidates) {
    if (c && existsSync(join(c, 'bin', 'clang'))) return c;
  }
  throw new Error(
    'wasi-sdk not found. Set WASI_SDK_PATH to a wasi-sdk install (bin/clang + share/wasi-sysroot).',
  );
}

const sdk = findWasiSdk();
const clang = join(sdk, 'bin', 'clang');
const sysroot = join(sdk, 'share', 'wasi-sysroot');

const args = process.argv.slice(2);
const inspect = args.includes('--inspect');
const only = args.filter((a) => !a.startsWith('--'));

/** 每个模块的编译参数（默认对所有 .c 一致；个别模块将来可覆盖）。 */
const COMMON = [
  // wasi-sdk 34 / LLVM 23：目标名是 `wasm32-wasip1`（`wasm32-wasi` 已弃用，
  // 且会让 clang 去查不存在的 multilib 目录而找不到头文件）。
  '--target=wasm32-wasip1',
  `--sysroot=${sysroot}`,
  '-O2',
  '-mexec-model=reactor', // 无 _start：这是一个可反复调用的「反应堆」模块
  '-Wall',
  '-Wl,--no-entry',
  // 导出由源码里的 `__attribute__((export_name(...)))` 精确声明，
  // 所以这里不传 `--export-all`（那会把 libc 内部符号一起导出）。
];

function build(name) {
  const src = join(srcDir, `${name}.c`);
  const out = join(outDir, `${name}.wasm`);
  mkdirSync(outDir, { recursive: true });
  process.stdout.write(`· ${name}: ${src} -> ${out}\n`);
  execFileSync(clang, [...COMMON, '-o', out, src], { stdio: 'inherit' });
  const bytes = readFileSync(out);
  process.stdout.write(`  ${(bytes.length / 1024).toFixed(1)} KB\n`);
  if (inspect) {
    const mod = new WebAssembly.Module(bytes);
    const exports = WebAssembly.Module.exports(mod).map((i) => `${i.name}:${i.kind}`).sort();
    const imports = WebAssembly.Module.imports(mod).map((i) => `${i.module}.${i.name}:${i.kind}`).sort();
    process.stdout.write(`  exports:\n    ${exports.join('\n    ')}\n`);
    process.stdout.write(`  imports:\n    ${imports.join('\n    ') || '(none)'}\n`);
  }
  return out;
}

function main() {
  const all = readdirSync(srcDir)
    .filter((f) => f.endsWith('.c'))
    .map((f) => f.slice(0, -2));
  const targets = only.length ? only : all;
  if (!targets.length) {
    process.stdout.write('no .c sources found\n');
    return;
  }
  const built = targets.map(build);

  // 记录构建源（工具链版本 + 产物哈希），便于追溯
  let clangVersion = 'unknown';
  try {
    clangVersion = execFileSync(clang, ['--version'], { encoding: 'utf8' }).split('\n')[0].trim();
  } catch {
    /* ignore */
  }
  const manifest = {
    toolchain: clangVersion,
    sdk: resolve(sdk),
    modules: Object.fromEntries(
      built.map((p) => [
        p.slice(p.lastIndexOf('/') + 1),
        {
          bytes: statSync(p).size,
          sha256: createHash('sha256').update(readFileSync(p)).digest('hex'),
        },
      ]),
    ),
  };
  const manifestPath = join(outDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  process.stdout.write(`manifest: ${manifestPath}\n`);
}

main();
