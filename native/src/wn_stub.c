/*
 * web-node — native → WASM 迁移的冒烟桩（M115）
 *
 * 这不是任何真实 Node binding 的实现，只用来验证 M115 的接入缝：
 *   1. 真 C 源码（wasi-sdk clang，`--target=wasm32-wasip1`）能编出 wasm32-wasi 模块；
 *   2. 模块导出函数 + 线性内存，宿主侧能 `WebAssembly.instantiate` 后调用；
 *   3. `malloc`/`free`（wasi-libc）可用，宿主能透过线性内存读回数据。
 *
 * 导出用 `__attribute__((export_name(...)))` 精确声明——这样不必给链接器传
 * `--export-all`，libc 内部符号（malloc/free/…）不会泄进导出表。
 *
 * M116 起，真实 binding（zlib、histogram、crypto…）会把 `deps/` 里的上游
 * C/C++ 源码编成同类模块，并经同一个加载器接入 `internalBinding()`。
 */
#include <stdint.h>
#include <stdlib.h>

/* 最简调用链：验证「导出函数 → 宿主调用」通。 */
__attribute__((export_name("wn_stub_add"), used))
int32_t wn_stub_add(int32_t a, int32_t b) {
  return a + b;
}

/*
 * 分配 `len` 字节并写入 `seed, seed+1, …`（uint8 回绕），返回指针。
 * 宿主读回线性内存即可验证 malloc 与内存 ABI。
 */
__attribute__((export_name("wn_stub_alloc_fill"), used))
uint8_t *wn_stub_alloc_fill(int32_t len, uint8_t seed) {
  uint8_t *p = (uint8_t *)malloc((size_t)len);
  if (p == NULL) {
    return NULL;
  }
  for (int32_t i = 0; i < len; i++) {
    p[i] = (uint8_t)(seed + i);
  }
  return p;
}

/* 释放 `wn_stub_alloc_fill` 返回的指针。 */
__attribute__((export_name("wn_stub_free"), used))
void wn_stub_free(void *p) {
  free(p);
}

/*
 * 返回指向只读数据段的静态字符串。宿主用 `TextDecoder` 读回，
 * 验证「数据段 + 指针 → 字符串」这条往返。
 */
__attribute__((export_name("wn_stub_version"), used))
const char *wn_stub_version(void) {
  return "web-node wasm stub 1";
}
