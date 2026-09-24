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
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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
const clangxx = join(sdk, 'bin', 'clang++');
const sysroot = join(sdk, 'share', 'wasi-sysroot');
const nodeSrc = findNodeSrc();
const zlibDir = join(nodeSrc, 'deps', 'zlib');
const histogramDir = join(nodeSrc, 'deps', 'histogram');
const brotliDir = join(nodeSrc, 'deps', 'brotli');
const zstdDir = join(nodeSrc, 'deps', 'zstd');
const opensslSrcDir = join(nodeSrc, 'deps', 'openssl', 'openssl');
/** OpenSSL must be configured+made, so it builds in a scratch dir (gitignored). */
const opensslBuildDir = join(here, '.openssl-build');

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
  wn_histogram: {
    // `native/src/wn_histogram.cc` 是薄包装（逐行移植 `src/histogram.cc` 的算法）；
    // `deps/histogram/src/hdr_histogram.c` 是**原封不动的上游 HdrHistogram**。
    // C++（libc++ 可用 std::vector/cmath），故需 `-std=c++20 -fno-exceptions -fno-rtti`。
    lang: 'c++',
    sources: [
      join(srcDir, 'wn_histogram.cc'),
      join(histogramDir, 'src', 'hdr_histogram.c'),
    ],
    include: [join(histogramDir, 'include'), join(histogramDir, 'src'), srcDir],
  },
  wn_brotli: {
    // `native/src/wn_brotli.c` 是薄封装；其余是**原封不动的上游 deps/brotli**
    // （1.2.0），清单照抄 `deps/brotli/brotli.gyp`（common + dec + enc）。
    sources: [
      join(srcDir, 'wn_brotli.c'),
      join(brotliDir, 'c/common/constants.c'),
      join(brotliDir, 'c/common/context.c'),
      join(brotliDir, 'c/common/dictionary.c'),
      join(brotliDir, 'c/common/platform.c'),
      join(brotliDir, 'c/common/shared_dictionary.c'),
      join(brotliDir, 'c/common/transform.c'),
      join(brotliDir, 'c/dec/bit_reader.c'),
      join(brotliDir, 'c/dec/decode.c'),
      join(brotliDir, 'c/dec/huffman.c'),
      join(brotliDir, 'c/dec/prefix.c'),
      join(brotliDir, 'c/dec/state.c'),
      join(brotliDir, 'c/dec/static_init.c'),
      join(brotliDir, 'c/enc/backward_references.c'),
      join(brotliDir, 'c/enc/backward_references_hq.c'),
      join(brotliDir, 'c/enc/bit_cost.c'),
      join(brotliDir, 'c/enc/block_splitter.c'),
      join(brotliDir, 'c/enc/brotli_bit_stream.c'),
      join(brotliDir, 'c/enc/cluster.c'),
      join(brotliDir, 'c/enc/command.c'),
      join(brotliDir, 'c/enc/compound_dictionary.c'),
      join(brotliDir, 'c/enc/compress_fragment.c'),
      join(brotliDir, 'c/enc/compress_fragment_two_pass.c'),
      join(brotliDir, 'c/enc/dictionary_hash.c'),
      join(brotliDir, 'c/enc/encode.c'),
      join(brotliDir, 'c/enc/encoder_dict.c'),
      join(brotliDir, 'c/enc/entropy_encode.c'),
      join(brotliDir, 'c/enc/fast_log.c'),
      join(brotliDir, 'c/enc/histogram.c'),
      join(brotliDir, 'c/enc/literal_cost.c'),
      join(brotliDir, 'c/enc/memory.c'),
      join(brotliDir, 'c/enc/metablock.c'),
      join(brotliDir, 'c/enc/static_dict.c'),
      join(brotliDir, 'c/enc/static_dict_lut.c'),
      join(brotliDir, 'c/enc/static_init.c'),
      join(brotliDir, 'c/enc/utf8_util.c'),
    ],
    include: [join(brotliDir, 'c/include'), join(brotliDir, 'c'), srcDir],
  },
  wn_zstd: {
    // `native/src/wn_zstd.c` 是薄封装；其余是**原封不动的上游 deps/zstd**
    // （1.5.7），清单照抄 `deps/zstd/zstd.gyp`。
    //
    // **故意不开 `ZSTD_MULTITHREAD`**：wasm32-wasip1 没有线程，而多线程压缩
    // 本来就是可选的（Node 的 zlib 绑定也不暴露它）。`ZSTD_DISABLE_ASM` 与
    // Node 一致（wasm 上没有 amd64 汇编变体）。
    sources: [
      join(srcDir, 'wn_zstd.c'),
      join(zstdDir, 'lib/common/debug.c'),
      join(zstdDir, 'lib/common/entropy_common.c'),
      join(zstdDir, 'lib/common/error_private.c'),
      join(zstdDir, 'lib/common/fse_decompress.c'),
      join(zstdDir, 'lib/common/pool.c'),
      join(zstdDir, 'lib/common/threading.c'),
      join(zstdDir, 'lib/common/xxhash.c'),
      join(zstdDir, 'lib/common/zstd_common.c'),
      join(zstdDir, 'lib/compress/fse_compress.c'),
      join(zstdDir, 'lib/compress/hist.c'),
      join(zstdDir, 'lib/compress/huf_compress.c'),
      join(zstdDir, 'lib/compress/zstd_compress.c'),
      join(zstdDir, 'lib/compress/zstd_compress_literals.c'),
      join(zstdDir, 'lib/compress/zstd_compress_sequences.c'),
      join(zstdDir, 'lib/compress/zstd_compress_superblock.c'),
      join(zstdDir, 'lib/compress/zstd_double_fast.c'),
      join(zstdDir, 'lib/compress/zstd_fast.c'),
      join(zstdDir, 'lib/compress/zstd_lazy.c'),
      join(zstdDir, 'lib/compress/zstd_ldm.c'),
      join(zstdDir, 'lib/compress/zstd_opt.c'),
      join(zstdDir, 'lib/compress/zstd_preSplit.c'),
      join(zstdDir, 'lib/compress/zstdmt_compress.c'),
      join(zstdDir, 'lib/decompress/huf_decompress.c'),
      join(zstdDir, 'lib/decompress/zstd_ddict.c'),
      join(zstdDir, 'lib/decompress/zstd_decompress.c'),
      join(zstdDir, 'lib/decompress/zstd_decompress_block.c'),
    ],
    include: [join(zstdDir, 'lib'), srcDir],
    defines: ['-DXXH_NAMESPACE=ZSTD_', '-DZSTD_DISABLE_ASM'],
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
  wn_openssl: {
    // OpenSSL (M119). Unlike the other modules this is not a flat source list:
    // OpenSSL ships no WASI target and must go through its own `Configure` +
    // `make build_libs`. `ensureOpensslLibs()` does that in a scratch dir
    // (`native/.openssl-build`) and hands back `libcrypto.a`, which is linked
    // with the thin `native/src/wn_openssl.c` wrapper.
    //
    // Only a subset is built (no asm/shared/threads/sockets/engines) and
    // `--gc-sections` + `-ffunction-sections` drop what the wrapper never
    // reaches. The remainder is dominated by the default provider's algorithm
    // registry — web-node's crypto surface is broad on purpose (AES/ChaCha/
    // DES/Camellia/ARIA/SM4/OCB/SIV/XTS/ML-KEM/Argon2/blake2/cmac/gmac/kmac/
    // X509/prime/DH all have to work).
    openssl: true,
    sources: [join(srcDir, 'wn_openssl.c')],
    include: [join(opensslSrcDir, 'include'), srcDir],
  },
};

/**
 * Configure + build the wasi OpenSSL subset once, into `native/.openssl-build`.
 * Cached via a marker file holding the target config's digest, so editing
 * `openssl/99-wasi.conf` invalidates the cache instead of silently reusing a
 * library built with the old settings.
 */
function ensureOpensslLibs() {
  const marker = join(opensslBuildDir, '.wn-built');
  const lib = join(opensslBuildDir, 'libcrypto.a');
  const configPath = join(here, 'openssl', '99-wasi.conf');
  const configDigest = createHash('sha256').update(readFileSync(configPath)).digest('hex');
  if (existsSync(marker) && existsSync(lib) && readFileSync(marker, 'utf8').startsWith(configDigest)) {
    return lib;
  }
  if (!existsSync(join(opensslSrcDir, 'Configure'))) {
    throw new Error(
      `OpenSSL source not found at ${opensslSrcDir}. Set NODE_SRC to a Node checkout with deps/openssl.`,
    );
  }
  process.stdout.write('· wn_openssl: configuring + building the wasi OpenSSL subset (once)\n');
  rmSync(opensslBuildDir, { recursive: true, force: true });
  mkdirSync(opensslBuildDir, { recursive: true });
  cpSync(opensslSrcDir, opensslBuildDir, { recursive: true });
  copyFileSync(configPath, join(opensslBuildDir, 'Configurations', '99-wasi.conf'));
  const env = { ...process.env, PATH: `${join(sdk, 'bin')}:${process.env.PATH ?? ''}` };
  const prefix = join(opensslBuildDir, 'out');
  execFileSync('perl', ['./Configure', 'wasm32-wasip1', `--prefix=${prefix}`], {
    cwd: opensslBuildDir,
    env,
    stdio: 'inherit',
  });
  const jobs = Math.max(2, Number(process.env.WN_JOBS ?? 0) || 8);
  execFileSync('make', [`-j${jobs}`, 'build_libs'], { cwd: opensslBuildDir, env, stdio: 'inherit' });
  writeFileSync(marker, `${configDigest} ${new Date().toISOString()}\n`);
  return lib;
}

const args = process.argv.slice(2);const inspect = args.includes('--inspect');
const only = args.filter((a) => !a.startsWith('--'));

function build(name) {
  const spec = MODULES[name];
  if (!spec) throw new Error(`unknown module "${name}" (known: ${Object.keys(MODULES).join(', ')})`);
  const out = join(outDir, `${name}.wasm`);
  mkdirSync(outDir, { recursive: true });
  if (spec.openssl) {
    const libcrypto = ensureOpensslLibs();
    process.stdout.write(`· ${name}: 1 source + libcrypto.a -> ${out}\n`);
    execFileSync(
      clang,
      [
        ...COMMON,
        ...(spec.defines ?? []),
        ...(spec.include ?? []).flatMap((d) => ['-I', d]),
        '-Wl,--gc-sections',
        '-o',
        out,
        ...spec.sources,
        libcrypto,
      ],
      { stdio: 'inherit' },
    );
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
  const cxx = spec.lang === 'c++';
  const cflags = [
    ...COMMON,
    // libc++ 在 wasm 上没有异常/RTTI；显式关掉，否则链接器找不到 __cxa_* 符号。
    ...(cxx ? ['-std=c++20', '-fno-exceptions', '-fno-rtti', '-Wno-return-type-c-linkage'] : []),
    ...(spec.defines ?? []),
    ...(spec.include ?? []).flatMap((d) => ['-I', d]),
  ];
  process.stdout.write(`· ${name}: ${spec.sources.length} source(s) -> ${out}\n`);
  execFileSync(cxx ? clangxx : clang, [...cflags, '-o', out, ...spec.sources], {
    stdio: 'inherit',
  });
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
  let brotliVersion = 'unknown';
  try {
    const header = readFileSync(join(brotliDir, 'c/common/version.h'), 'utf8');
    const major = /#define BROTLI_VERSION_MAJOR (\d+)/.exec(header)?.[1];
    const minor = /#define BROTLI_VERSION_MINOR (\d+)/.exec(header)?.[1];
    const patch = /#define BROTLI_VERSION_PATCH (\d+)/.exec(header)?.[1];
    if (major && minor && patch) brotliVersion = `${major}.${minor}.${patch}`;
  } catch {
    /* ignore */
  }
  let zstdVersion = 'unknown';
  try {
    const header = readFileSync(join(zstdDir, 'lib/zstd.h'), 'utf8');
    const major = /#define ZSTD_VERSION_MAJOR\s+(\d+)/.exec(header)?.[1];
    const minor = /#define ZSTD_VERSION_MINOR\s+(\d+)/.exec(header)?.[1];
    const release = /#define ZSTD_VERSION_RELEASE\s+(\d+)/.exec(header)?.[1];
    if (major && minor && release) zstdVersion = `${major}.${minor}.${release}`;
  } catch {
    /* ignore */
  }
  let opensslVersion = 'unknown';
  try {
    const dat = readFileSync(join(opensslSrcDir, 'VERSION.dat'), 'utf8');
    const num = (k) => new RegExp(`^${k}=(.+)$`, 'm').exec(dat)?.[1]?.trim();
    const parts = [num('MAJOR'), num('MINOR'), num('PATCH')].filter(Boolean);
    if (parts.length === 3) opensslVersion = parts.join('.');
  } catch {
    /* ignore */
  }
  const manifest = {
    toolchain: clangVersion,
    sdk: resolve(sdk),
    nodeSrc: resolve(nodeSrc),
    upstream: {
      zlib: zlibVersion,
      brotli: brotliVersion,
      zstd: zstdVersion,
      histogram: 'hdr_histogram',
      openssl: opensslVersion,
    },
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
