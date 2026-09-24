#include <stdio.h>
#include <stdlib.h>
#include <string.h>
__attribute__((export_name("probe_add"), used))
int probe_add(int a, int b) { return a + b + 1000; }
__attribute__((export_name("wasi_hello"), used))
int wasi_hello(void) { printf("WASI-HELLO from wasm\n"); return 42; }
__attribute__((export_name("wasi_env"), used))
int wasi_env(void) { const char* v = getenv("WC_PROBE"); return v ? (int)strlen(v) : -1; }
