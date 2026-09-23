#!/usr/bin/env node
// web-node — native → WASM 构建脚本（M115/M116）
//
// 用 wasi-sdk 的 clang 把 `native/src/*.c`（以及 `deps/` 下的上游 C 源码）编成
// wasm32-wasi 模块，产物写到 `src/node-runtime/wasm/artifacts/`（提交进仓库，
// 于是部署/CI 不需要工具链）。
//
// 工具链定位顺序：`WASI_SDK_PATH` 环境变量 → 常见安装位置。
// 上游源码定位顺序：`NODE_SRC` 环境变量 → `~/Downloads/node`（与 tools/vendor.mjs 一致）。
//
// 用法：
//   node native/build.mjs            # 编所有模块
//   node native/build.mjs wn_zlib    # 只编一个
//   node native/build.mjs --inspect  # 编完打印每个模块的 imports/exports
//
// 为什么产物体积优先：wasm 是运行时资产，不是内联进 worker bundle 的字符串
// （M107 的教训——大载荷内联会把 worker 撑大并拖慢冷启动）。

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

/** 找到 Node.js 源码 checkout（`deps/` 所在的那一层）。 */
function findNodeSrc() {
  const candidates = [
    process.env.NODE_SRC,
    join(process.env.HOME ?? '', 'Downloads', 'node'),
  ].filter(Boolean);
  for (const c of candidates) {
    if (c && existsSync(join(c, 'deps', 'zlib', 'zlib.h'))) return c;
  }
  throw new Error(
    'Node.js source checkout not found. Set NODE_SRC to a checkout containing deps/zlib.',
  );
}

const sdk = findWasiSdk();
const clang = join(sdk, 'bin', 'clang');
const sysroot = join(sdk, 'share', 'wasi-sysroot');
const nodeSrc = findNodeSrc();
const zlibDir = join(nodeSrc, 'deps', 'zlib');

/** 编译参数（wasi-sdk 34 / LLVM 23）。 */
const COMMON = [
  // 目标名必须是 `wasm32-wasip1`：`wasm32-wasi` 已弃用，且会让 clang 去查
  // 不存在的 multilib 目录而找不到头文件。
  '--target=wasm32-wasip1',
  `--sysroot=${sysroot}`,
  '-O2',
  '-mexec-model=reactor', // 无 _start：这是一个可反复调用的「反应堆」模块
  '-Wall',
  '-Wl,--no-entry',
  // 导出由源码里的 `__attribute__((export_name(...)))` 精确声明，
  // 所以这里不传 `--export-all`（那会把 libc 内部符号一起导出）。
];

/**
 * 模块清单。每个模块 = 一组源文件 + include 目录 + 宏定义。
 * 名字即产物 `artifacts/<name>.wasm` 与 `WASM_MODULES` 里的键。
 */
const MODULES = {
  wn_stub: {
    sources: [join(srcDir, 'wn_stub.c')],
  },
  wn_zlib: {
    // `native/src/wn_zlib.c` 是薄包装；其余是**原封不动的上游 deps/zlib**。
    sources: [
      join(srcDir, 'wn_zlib.c'),
      join(zlibDir, 'adler32.c'),
      join(zlibDir, 'compress.c'),
      join(zlibDir, 'crc32.c'),
      join(zlibDir, 'deflate.c'),
      join(zlibDir, 'infback.c'),
      join(zlibDir, 'inffast.c'),
      join(zlibDir, 'inflate.c'),
      join(zlibDir, 'inftrees.c'),
      join(zlibDir, 'trees.c'),
      join(zlibDir, 'uncompr.c'),
      join(zlibDir, 'zutil.c'),
    ],
    include: [zlibDir, srcDir],
    // 运行时建 CRC 表 → 不需要 591KB 的 crc32.h；CRCs 与静态表逐值相同。
    // 架构 SIMD 变体（SSSE3/NEON/SSE42）在 wasm 上一律不启用。
    //
    // `OS_CODE=3`（Unix）：gzip 头的第 9 字节按产出平台而定（macOS 编译的 Node
    // 会写 19）。wasm 模块没有 OS 身份，就固定用 zlib 自己的默认值；探针在比对时
    // 会把这一字节归一（它是平台元数据，不是数据）。
    defines: ['-DDYNAMIC_CRC_TABLE', '-DZLIB_CONST', '-DOS_CODE=3'],
  },
};

const args = process.argv.slice(2);
const inspect = args.includes('--inspect');
const only = args.filter((a) => !a.startsWith('--'));

function build(name) {
  const spec = MODULES[name];
  if (!spec) throw new Error(`unknown module "${name}" (known: ${Object.keys(MODULES).join(', ')})`);
  const out = join(outDir, `${name}.wasm`);
  mkdirSync(outDir, { recursive: true });
  const cflags = [
    ...COMMON,
    ...(spec.defines ?? []),
    ...(spec.include ?? []).flatMap((d) => ['-I', d]),
  ];
  process.stdout.write(`· ${name}: ${spec.sources.length} source(s) -> ${out}\n`);
  execFileSync(clang, [...cflags, '-o', out, ...spec.sources], { stdio: 'inherit' });
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
  const all = Object.keys(MODULES);
  const targets = only.length ? only : all;
  if (!targets.length) {
    process.stdout.write('no modules defined\n');
    return;
  }
  const built = targets.map(build);

  // 记录构建源（工具链版本 + 产物哈希 + 上游源码哈希），便于追溯
  let clangVersion = 'unknown';
  try {
    clangVersion = execFileSync(clang, ['--version'], { encoding: 'utf8' }).split('\n')[0].trim();
  } catch {
    /* ignore */
  }
  let zlibVersion = 'unknown';
  try {
    const header = readFileSync(join(zlibDir, 'zlib.h'), 'utf8');
    zlibVersion = /#define ZLIB_VERSION "([^"]+)"/.exec(header)?.[1] ?? 'unknown';
  } catch {
    /* ignore */
  }
  const manifest = {
    toolchain: clangVersion,
    sdk: resolve(sdk),
    nodeSrc: resolve(nodeSrc),
    upstream: { zlib: zlibVersion },
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
