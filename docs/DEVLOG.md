# DEVLOG — web-node

> 开发日志 + 进度快照。**每次改动都往这里追加一条**，让下次开工能 30 秒内知道「做到哪了 / 下一步从哪开始」。
>
> - 追加规则：新条目写在最上面 `## 变更记录` 区域顶部（倒序），一条一段，包含 **改了什么 / 为什么 / 涉及文件**。
> - 每隔一段把「当前状态」和「下一步」两节更新一次，保证它始终反映最新事实。

---

## 当前状态

**阶段**：M5 真实构建工具已落地（**esbuild** WASM），M5b 接入 **rollup 的官方 WASM 构建**；M5c 把 **Vite 本体**跑了起来（`vite build` → VFS）；M5d 又把 Vite 的 **dev server** 在页内跑通（`createServer` + `listen` + 按需转换，预览真实渲染）；M5e 把 **HMR** 接通了——ServiceWorker 代理不了 WebSocket，于是 HMR 改走 **BroadcastChannel**；M5f 补齐 **CSS 热更（`css-update`）与按端口隔离通道**；M3.5d 把预览从路径前缀升级为 **子域名真源隔离**（`<port>.localhost`，仅 dev server）；M6 把 npm 客户端收尾（**lockfile + 完整性校验 + peer 自动安装**）；M7 补上了运行时的 **进程与 shell 表面**（`child_process` 全家族 + 受控 `ProcessHost` + mini-shell），并把 npm 的 **`.bin` shim 与生命周期脚本**接到这个表面上；M8 把 **stream** 的几处近似实现换成真语义（字节精确 `read(n)`、objectMode 双向分离、`autoDestroy`、暂停模式的 `readable` 驱动、chunk 一律交付 `Buffer`）；M9 让 **Buffer 的 `slice`/`subarray` 与 `from(ArrayBuffer)`** 共享底层内存（Node 同语义）；M10 开始**扩大 vendoring**（第一块真源码 `internal/streams/state.js` 接管 highWaterMark，默认值/ per-side 键 / 校验 / `read(n)` 增长全对齐）；M11 拿真源码 `Readable.from` 时反手修了两个 stream 核心 bug；M12 把流状态形状（`_readableState`/`_writableState`）对齐 Node 并接上真谓词；M13 把 **`internal/streams/destroy.js` 真源码接进来**；M14 再把 **`internal/streams/end-of-stream.js` 接进来**（`finished()` 就是真实现）；M15 换掉自研 `EventEmitter`，改用 **Node 真 `events.js`**（`_events` 形状 / `prependListener` / `errorMonitor` / `captureRejections`），并把 `stream.addAbortSignal` 接到真源码；M16 把**整个 `stream` 模块换成真源码**（`lib/stream.js` + `internal/streams/*`：Readable/Writable/Duplex/Transform/PassThrough/pipeline/finished/compose/duplexPair/operators + `stream/promises`），删掉手写 stream；M17 把 **`async_hooks` 也换成真源码**（`lib/async_hooks.js` + `internal/async_hooks.js` + `internal/async_local_storage/*`），落在自研 `async_wrap` 绑定上，并让 tick / timer 成为真 async resource——hook 会触发、`AsyncLocalStorage` 能跨异步边界传 store；M18 把**真框架**跑了起来——@vitejs/plugin-vue 在页内编译 **Vue 3 SFC**，`vite build` 产出生产 Vue bundle、`createServer` 在预览里跑真实可交互 Vue 应用（计数器可点、HMR 生效）；M19 又拉了一批量：**真 `punycode.js` / `domain.js` / `diagnostics_channel.js`**（后两者跑在真 `async_hooks` 上，`diagnostics_channel` 配一个小 JS binding）；M20 把 **`string_decoder` 也换成真源码**——把 `src/string_decoder.cc` 那个 native 状态机用 JS 逐字节重写（`bindings/string_decoder.ts`）；M21 再把 **`internal/util/types.js` 与 `src/node_types.cc`** 搬过来（`types` binding 对齐 native 表面，`util.types` 直接指向真模块）；M22 把 **真 `internal/util/inspect.js`** 整份搬来（`util.inspect` / `util.format` / `formatWithOptions` 就是真源码，并修了一个只有生产 minify 才会暴露的 `<Buffer …>` bug）；M23 把**断言栈**整体换成真源码：**`lib/assert.js` + `internal/assert/{utils,assertion_error,myers_diff}` + `internal/util/comparisons`（真 `isDeepStrictEqual`）+ `internal/util/colors` + 真 `internal/validators.js`**，并给每个编译单元打 `sourceURL` —— 从此**堆栈里有真文件名**、`assert.ok(falsy)` 能还原出触发表达式（如 `assert.ok(0)`）；M24 把 **整个 `util` 模块换成真源码**：**`lib/util.js` + `lib/internal/util.js`**（真 `promisify`/`callbackify`/`inherits`/`deprecate`/`styleText`/`stripVTControlCharacters`/`toUSVString`/`MIMEType`/`parseArgs`/`diff`/`parseEnv`），并给 `util` binding 补上 `defineLazyProperties`/`constructSharedArrayBuffer`/`parseEnv`/`privateSymbols`；M25 把 **Web EventTarget 栈换成真源码**：**`lib/internal/event_target.js` + `internal/webidl.js` + `internal/perf/utils.js`**（真 `EventTarget`/`Event`/`CustomEvent`/`NodeEventTarget`/`defineEventHandler`/`isEventTarget`），并让 `performance` binding 对齐 `node_perf_common.h` 的 milestone 枚举；M26 又把 **`AbortController`/`AbortSignal` 换成真源码**（`lib/internal/abort_controller.js`，建在刚接好的真 `EventTarget` 上，真 `AbortSignal.timeout`/`any`/`abort`/`throwIfAborted`）；M27 把 **`console` 换成真源码**（`lib/console.js` + `internal/console/*` + `internal/cli_table` + `internal/trace_events` + 真 `internal/util/debuglog`），真 `console.table`/`count`/`group`/`time`/`Console` 类上线；M28 把 **`os` 换成真源码**（`lib/os.js`，站在对齐 `src/node_os.cc` 的静态 `os` binding 上）；M29 把 **`timers` 换成真源码**（`lib/timers.js` + `internal/timers.js` + `timers/promises.js` + `internal/{linkedlist,priority_queue}.js`），真 `Timeout`/`ref`/`unref`/`refresh`/`Symbol.toPrimitive` 与真 `timers/promises` 上线，`timers` binding 内置一个代替 libuv 的驱动；M30 把 **`worker_threads` 的消息传递半边换成真源码**（`internal/worker/io.js` + `internal/per_context/messageport.js` + 真 `internal/worker/js_transferable.js`）：真 `MessageChannel`/`MessagePort`/`BroadcastChannel`/`receiveMessageOnPort`/`markAsUncloneable`，`messaging` binding 用 JS 重实现 `src/node_messaging.cc` 的可见契约（纠缠组、缓冲、关闭握手、端口转移、DataCloneError 全套）；M31 把 **`readline` 整份换成真源码**（`lib/readline.js` + `readline/promises.js` + `internal/readline/{interface,emitKeypressEvents,promises}.js` + `internal/repl/history.js`）：真行编辑器、真按键解码器、真 ANSI 光标函数与真历史环，`terminal` 只是 `{input,output}` 流对，不需要 TTY；M32 给 worker **减重**：vendored 真源码在构建时**去掉注释**再进 bundle（真实 Node 源注释占 ~23%），严格保留**行号与代码列**、保留每文件 MIT 声明，worker **1259KB → 1028KB（−18%）**、gzip **315KB → 237KB（−25%）**。M33 把 **glob 匹配换成真源码**（`lib/internal/fs/glob.js` + Node 随包的 `internal/deps/minimatch/index`）：真 glob 遍历器与真 minimatch 匹配器直接跑在自研 `fs` 上，`path.matchesGlob` 不再抛错，`fs.glob`/`fs.globSync`/`fs.promises.glob` 上线（支持 `cwd`/`exclude`/`withFileTypes`/`maxDepth`）。M34 把 **`crypto` 的同步面补齐**：WebCrypto 是 promise-only，而 Node 的 `createHash`/`createHmac`/`pbkdf2Sync`/`scryptSync` 全是同步调用，所以 **MD5 / SHA-1 / SHA-2（224/256/384/512）、HMAC、PBKDF2、HKDF、scrypt、`timingSafeEqual`、`hash()`、`randomInt`/`randomFill`** 都在 JS 里实现（`src/node-runtime/crypto/hash.ts`），逐一对照 Node v26.9.0（OpenSSL）输出；随机数仍走平台 WebCrypto。M35 把 **`perf_hooks` 整份换成真源码**（`lib/perf_hooks.js` + 整个 `internal/perf/*` 组）：真 `Performance`/`PerformanceEntry`/`PerformanceMark`（`PerformanceMeasure` 保持只由内部构造）/`PerformanceObserver`/`PerformanceObserverEntryList`/`PerformanceResourceTiming`/`PerformanceNodeTiming`/`eventLoopUtilization`/`timerify` 上线，跑在一个 JS `performance` binding 上（浏览器时钟代替 `uv_hrtime`，无 V8 GC 钩子）；直方图那一组（`createHistogram`/`importHistogram`/`monitorEventLoopDelay`）需要 native hdr_histogram，保留显式抛错。M36 把 **WHATWG streams 换真源码**（`lib/stream/web.js` + 整个 `internal/webstreams/*` 组，10 个文件 / ~8700 行）：真 `ReadableStream`/`WritableStream`/`TransformStream`/queuing strategies/`TextEncoderStream`/`TextDecoderStream` 上线，`internal/webstreams/adapters` 不再是抛错 Proxy——`Readable.toWeb`/`Writable.toWeb`/`Duplex.toWeb`（及反向）全部打通；`CompressionStream`/`DecompressionStream` 需要 native zlib，保留显式抛错。M37 把 **`Blob`/`File` 换成真源码**（`lib/internal/blob.js` + `lib/internal/file.js`）：真 `Blob`（`size`/`type`/`slice`/`arrayBuffer`/`bytes`/`text`/`stream`/`textStream`）与真 `File` 上线，`Blob`/`File` 同时是**全局**且与 `require('buffer').Blob` 身份一致；C++ 的 `DataQueue` 收敛成 JS `blob` binding（扁平 `Uint8Array` 分片，保留「reader 每 pull 出一片、按原始 source 边界切块」的可观察语义），`fs.openAsBlob` 与 `URL.createObjectURL`/`resolveObjectURL` 对象存储也就位；顺带补了一个最小 `vm` shim（只实现 `runInNewContext`，因为真 `internal/util.js` 靠它取跨 realm `RegExp`，否则 stream finalizer 会抛未捕获 `NotImplementedError`）。M38 把 **`stream/iter`（新的 iterable-streams API）与 `stream/consumers` 换成真源码**：`push`/`pull`/`from`/`fromSync`/`merge`/`broadcast`/`share`/`tap` 与同步、异步两套消费者，外加与经典 `Readable`/`Writable` 的双向互操作（`fromReadable`/`toReadable`/`fromWritable`/`toWritable`/`pipeTo`）；`stream/consumers` 的 `text`/`json`/`buffer`/`bytes`/`arrayBuffer`/`blob` 也全部上线（靠 M37 的真 `Blob` 才可能）。M39 把 **npm 安装器推进了一大截**：根级 `overrides`/`resolutions` 能把一个传递依赖钉到指定版本（扁平/嵌套/`.`/`$ref`，最长路径优先），`file:`/`link:` 说明符能直接从虚拟文件系统装包（目录拷贝 / 本地 `.tgz` 解包，`link:` 物化为拷贝），且 tarball 下载改为**有界并发**（默认 8）并**先全下载再写树**（失败不留半成品）。M40 把 **`fork()` 的 IPC 通道真正做了出来**：`fork()` 不再只是「像 `node <module>` 那样跑」，而是给父子两边一条真通道（父侧 `child.send`/`on('message')`/`disconnect`、子侧 `process.send`/`on('message')`/`disconnect`），默认 **JSON 序列化**（与 Node 一致：Buffer 拍平、`undefined` 丢弃、循环结构同步抛），`serialization: 'advanced'` 走 structuredClone；**开着的通道会让子进程留在事件循环里**（模块返回不等于退出），父侧事件序 `disconnect → exit → close`；所有预期值都先跑真 Node v26.9.0 量过。M41 把 **Buffer 的 slab 池化**补上：小于 `Buffer.poolSize>>>1`（64 KiB 的一半）的分配（`allocUnsafe`、`from(string)`、`from(Buffer/TypedArray)`、`concat`）从**一块 64 KiB slab** 切 **8 字节对齐**的槽位，`allocUnsafeSlow`/`alloc`/大请求绕过池——于是 `.byteOffset` 与 `.buffer.byteLength` 跟真 Node v26.9.0 对齐。M42 把 **`util.inspect` / ICU 的保真度**再推进一格：① `types` binding 的 `isGeneratorFunction`/`isAsyncFunction` 修正——V8 里 `async function*` **既是** generator 又是 async，之前两个谓词都返回 false，`util.inspect` 会把它印成 `[Function: x] AsyncGeneratorFunction`，现在正确输出 `[AsyncGeneratorFunction: x]`；② `icu.getStringWidth` 从 `str.length` 换成**真列宽**（东亚宽字符 2 列、emoji-presentation 2 列、控制/组合/emoji 修饰符 0 列），于是 `console.table` 的中文列宽与 `util.inspect` 的 CJK 折行都与真 Node 对齐；`getPromiseDetails`/`getProxyDetails` 与 Map/Set 迭代器预览仍是**测试里明示的近似**（V8 不同步暴露）。M43 把 **`process` 表面补齐并接上未捕获异常路由**：这是唯一手写的核心模块（无 `lib/process.js` 可 vendor），逐键对照后补上 `getBuiltinModule`/`getActiveResourcesInfo`/`loadEnvFile`/`has|set|addUncaughtExceptionCaptureCallback`/`reallyExit`/`openStdin`/`ref`/`unref`/`debugPort`/`domain`/`report`，移除真 Node 已删的 `noDeprecation`/`throwDeprecation`/`traceDeprecation`；顺带修了一个**真 bug**——timer / nextTick 回调里抛出的异常之前直接落到宿主 macrotask，**绕过 `process._fatalException`**（捕获回调与 `uncaughtException` 监听器都不响），现在统一经共享 dispatcher 路由；再把 `VfsError` 的 message 改成 Node `UVException` 的形状（`ENOENT: no such file or directory, open '/x'`，`name` 为 `Error`）。M44 把 **子进程退出判定的最后一个缺口补上**：子进程的剩余工作若是一个**宿主 promise**（in-flight `fetch`），之前退出判定看不见它、会被提前报成已退出并丢掉输出；现在 runtime 包装沙箱的 `fetch`，把在飞的宿主请求计入 `activeCount()`（`#hostRequests` + `#hostGeneration` 按 run 隔离），子进程在 fetch settle 后才判定退出；只计真正的宿主 I/O（`fetch` 底层是 ref'd socket），`crypto.subtle`/`Blob.arrayBuffer`/裸 `new Promise` 都在微任务 settle、**不**计数（真 Node v26.9.0 实测）。M45 把 **`zlib` 做成真模块**：不再是无一可用的 stub——deflate/gzip 的**流式与一次性异步形式**（`createGzip`/`createDeflate`/`createDeflateRaw`/`createUnzip` 及对应一次性 `gzip`/`deflate`/`unzip` 等）跑在平台的 `CompressionStream`/`DecompressionStream` 上（codec 由平台提供，不重写），默认选项下输出与 Node v26.9.0 **逐字节一致**；`crc32`（纯 JS 查表）、`constants`、`codes` 齐备；`unzip` 按魔数自动识别 gzip / zlib，`unzip` 对裸 deflate 报 `Z_DATA_ERROR`；解压错误按 Node 的 `genericNodeError` 形状抛（`name='Error'`、`code='Z_DATA_ERROR'`、`errno=-3`）。**不同步也不半吊子**：同步形式（`gzipSync` 等）与 `level`/`windowBits`/`memLevel`/`strategy`/`dictionary` 这些**编码参数**因平台无对应面而显式抛 `NotImplementedError`（传非默认值即抛，绝不静默忽略），brotli/zstd/zip 同理；顺带把 `stream/web` 的 `CompressionStream`/`DecompressionStream` 从抛错变成可用（`brotli` 格式仍抛）。M46 把 **宿主 WebSocket 也计入子进程退出判定**（M44 的姊妹缺口）：开着的 socket 是长生命周期的宿主句柄，之前子进程只剩一条 socket 时会被提前判退出、后续消息丢失；现在 runtime 包装沙箱 `WebSocket`（保持 `instanceof` 与静态常量），`close`/`error` 时才释放计数（`#hostSockets` + `#hostGeneration` 按 run 隔离），`proc/host.ts` 的退出判定因此能看见开着的 socket；顺带修一个被它暴露的 loader 真 bug——沙箱全局以 wrapper 参数注入，模块顶层又 `const WebSocket = websocket`（Vite chunk 里就有）会 `Identifier 'WebSocket' has already been declared`，现在用长度保持的 `codeMask` 分词器扫出顶层 `let`/`const`/`class` 绑定名，按模块从注入参数里剔除，`vite build` 不再炸。M47 把 **`crypto` 的对称密码补齐**：`createCipheriv`/`createDecipheriv` 不再是抛错 stub——**AES-128/192/256 的 ECB/CBC/CTR/CFB/OFB/GCM** 全部实现（`src/node-runtime/crypto/cipher.ts`，FIPS-197 + NIST SP 800-38A/D 纯 JS），因为 Node 的 cipher 是同步流式、WebCrypto 是 promise-only 顶不上；CTR/GCM 计数器、CBC 链、CFB/OFB 反馈、PKCS#7 补位、GCM 的 GHASH/J0（非 12 字节 IV 走 GHASH 派生）/AAD/认证标签全按 OpenSSL 语义，输出与 Node v26.9.0 **逐字节一致**；`getCiphers`/`getCipherInfo` 就位；OpenSSL 别名（`aes128`→CBC、`id-aes128-gcm`）与大小写不敏感同样支持；**不同步也不半吊子**——OpenSSL 认得但本运行时未实现的 cipher（Camellia/ARIA/SM4/DES/ChaCha20-Poly1305/CCM/OCB/SIV/XTS/wrap…）抛类型化 `NotImplementedError`，OpenSSL 也不认的名字才抛 `ERR_CRYPTO_UNKNOWN_CIPHER`；错误形状（`ERR_CRYPTO_INVALID_KEYLEN`/`ERR_CRYPTO_INVALID_IV`/`ERR_CRYPTO_INVALID_AUTH_TAG`/`ERR_OSSL_BAD_DECRYPT`/`ERR_CRYPTO_INVALID_STATE`/`ERR_INVALID_ARG_TYPE`、认证失败与「Trying to add data in unsupported state」的原文）逐一对照真 Node。已部署到 **GitHub Pages**：<https://mcuking.github.io/web-node/>。M48 把 **`Buffer` 换成真源码**：vendor 真 `lib/buffer.js` + `lib/internal/buffer.js` + `lib/internal/v8/startup_snapshot.js` + `lib/util/types.js`（MANIFEST 119 → 123），删掉自研的 `builtins/buffer.ts`；`buffer` binding 从「少量原语」扩成**完整 JS 实现**（逐字节对齐 `src/node_buffer.cc` + `src/string_bytes.cc` + `deps/nbytes`：各编码 slice/write 编解码器、`indexOfString`/`indexOfNumber`/`indexOfBuffer`、`compare`/`compareOffset`/`copy`/`fill`（含平铺）、`swap16/32/64`、`isAscii`/`isUtf8`、`atob`/`btoa`、unsafe 分配助手）；`icu` binding 补 `transcode`/`icuErrName` 并让 `transcode` 返回真 `Buffer`；新增 `mksnapshot` binding。M49 把 **Node 真 `vfs` 子系统搬了进来**（并顺带换掉 fs 基座）：vendor 真 `lib/internal/fs/utils.js`（替掉只含 `DirentFromStats` 的 shim）与整个 `lib/internal/vfs/*`（`file_system`/`provider`/`fd`/`stats`/`dir`/`file_handle`/`streams`/`watcher`/`router`/`errors` + `providers/memory`，MANIFEST 123 → 135）；新增 `vfs` 模块，`vfs.create()` 返回真 `VirtualFileSystem`，`MemoryProvider` 是一个完整的 fs 形状表面（sync/callback/promise/streams/watch 全都在，逐行为对照 `node --experimental-vfs`）——只 `RealFSProvider`/`ZipProvider` 显式不支持（前者要映射*宿主*文件系统，浏览器标签页里不存在；后者要 `internal/zip`）；同时把 `uv` binding 从空表换成**真 `UV_ERRNO_MAP`（85 条 errno）**，`internal/errors` 补上真 `UVException` 并把 `uvErrmapGet` 接上，于是 libuv 形状的错误消息、`util.getSystemErrorName`、`util.getSystemErrorMap` 全部与真 Node 一致；`constants` binding 补全 `fs`/`os` 两表（access modes、`O_SYNC`、`S_IF*`、`UV_DIRENT_*`、`os.devNull`、`os.errno`），fs binding 补 `internalModuleStat`/`readdirRecursive`。M50 把 **`fs/promises` 换成真源码**：vendor 真 `lib/fs/promises.js` 与 `lib/internal/fs/promises.js`（2304 行）；`fs` binding 补上整张 async/promise 面（`kUsePromises` 三态派发、`FileHandle`/`ReadFileJob`/`WriteFileJob`、`stat` 家族 18 槽元组、`readdir` 的 `{0:names,1:types}`），`internal/fs/rimraf` 改成 VFS 原生 shim。M51 把 **回调式 `fs` 也换成真源码**：vendor 真 `lib/fs.js`（4083 行）+ `internal/fs/read/context.js` + `internal/fs/cp/cp-sync.js` + `internal/streams/fast-utf8-stream.js`（MANIFEST 142 → 146），`fs` binding 补 `readFileUtf8`/`writeFileUtf8`/`cpSync*`/`CpDirJob`/`StatWatcher`，并把 `fs_event_wrap.FSEvent` 从抛错换成 **VFS 投影**（订阅 `Vfs.subscribe`），于是 `fs.watch`/`fs.promises.watch` 走真 watchers 代码。M51b 补上 M51 后仅剩的两个 fs 缺口：`fs_dir` binding 真实现（`opendir`/`opendirSync` + `DirHandle`，`lib/internal/fs/dir.js` 的 `Dir` 原样可跑）、`StatWatcher` 从抛错换成**轮询实现**（复刻 libuv `uv_fs_poll` 协议：首次只做基线；变化 `onchange(0,curr,prev)`；消失 `onchange(-ENOENT, zeroed, lastGood)`；重建 `prev=lastGood`）。M52 把 **fs 子系统最后一处手写 shim 也换回真源**：vendor 真 `internal/fs/streams.js`（MANIFEST 146 → 147），删掉 `builtins/fs-streams.ts`——`fs.ReadStream`/`fs.WriteStream` 现在是真类（惰性加载，首次建流时 `fs` 已完整，顶层 `require('fs')` 回环自然解除）。M53 把 **`url` 换成真源码**：vendor 真 `lib/url.js`（MANIFEST 147 → 148），删掉 116 行的手写 `builtins/url.ts`——`parse`/`format`/`resolve`/`resolveObject`/`Url` 与 `URL`/`URLSearchParams`/`URLPattern`/`pathToFileURL`/`fileURLToPath`/`domainToASCII`/`urlToHttpOptions` 现在都是真源码；WHATWG 那半边来自 `internal/url`，本运行时把它从「re-export `url`」改成**桥到宿主自身符合规范的 URL 类**（Node 那半是 native Ada，标签页自带一个等价实现），并补上 `url`/`url_pattern`/`encoding_binding` 三个 binding 与 `internal/errors` 的 `ERR_INVALID_URL` 系列码。M54 把 **`v8` 换成真源码**（最后几个 unsupported stub 之一）：vendor 真 `lib/v8.js` + `lib/internal/v8/{heap_profile,cpu_profiler}.js`（MANIFEST 148 → 151）；真正的重头是它下面的 `serdes` binding——把 **V8 的结构化克隆线格式（版本 15）用 JS 重写**（`src/node-runtime/bindings/serdes.ts`，逐标签对照 `deps/v8/src/objects/value-serializer.cc`：varint/ZigZag、两字节字符串的 16 位对齐 pad、对象 id 与 `0x5E` 反引用、dense/sparse 数组、Map/Set、Date/RegExp/Error（含 `cause`）、Boxed primitive、ArrayBuffer、以及 Node 默认把 ArrayBufferView 当 host object 的路径），`v8.serialize`/`deserialize` 与 `Serializer`/`Deserializer` 都走它；堆与 profiler 那半边（`getHeapStatistics`/`getHeapSpaceStatistics`/`getHeapCodeStatistics`/`getCppHeapStatistics`/`getHeapSnapshot`/`writeHeapSnapshot`/`queryObjects`/`GCProfiler`/CPU 与堆 profiler）在页面里本质不可达，一律**响亮抛 `ERR_WEB_NODE_NOT_IMPLEMENTED`**而不编造数字。验证方式是**差分语料**：115 条输入先在真 Node v26.9.0 上生成期望字节（`tools/v8-corpus-oracle.mjs` → `test/fixtures/v8-corpus.json`），再在 web-node 里跑同一列表逐字节对比（`test/v8-corpus.test.ts`），**115/115 一致**。M55 把 **`tty` 换成真源码**：vendor 真 `lib/tty.js` + `lib/internal/tty.js`（MANIFEST 151 → 153），新增 `tty_wrap` binding（标签页没有文件描述符，`isTTY` 恒 false、`TTY` 构造即抛），`isatty` 与 `getColorDepth`/`hasColors` 因此是真实现，而 `internal/util/colors` 在 `FORCE_COLOR` 置位时的惰性 require（之前指向一个未注册模块、会直接炸）也随之修好；同理用**差分语料**（57 条颜色深度 + 10 条 `hasColors`）与真 Node v26.9.0 逐值对齐。M56 把**最后两个 unsupported stub 之一的 `vm` 换成真源码**：vendor 真 `lib/vm.js` + `lib/internal/vm.js`（MANIFEST 153 → 155），新增 `contextify` binding——页面造不出第二个 V8 realm，于是把**沙箱对象本身**当作上下文（用 Node 的 `contextify_context_private_symbol` 标记），脚本跑在 `with (scope) { return eval(code) }` 里、`this` 绑到 scope：`createContext`/`isContext`/`Script`/`compileFunction`/`runIn*Context` 由此全是真的，且上下文对 `process`/`require`/`Buffer`/`setTimeout` 保持 `undefined`（只暴露标准内建 + `console`）；代码缓存/`timeout`/`measureMemory` 一律响亮抛错。验证同样是**差分语料**，59 条与真 Node v26.9.0 逐条一致。M57 把 **`worker_threads.Worker` 落地为“同 loop 的协作式工作器”**（`src/node-runtime/proc/worker.ts`，仿子进程的 `proc/host.ts`）：一个 worker = **第二个模块注册表**（自己的模块缓存 / 注入 globals / `process`+`worker_threads` 视图）+ 与父侧一条**真** `MessageChannel`；端口对在构造时建（启动前 `postMessage` 排队后投递）、起点 `defer` 到宏任务（父侧监听先于 worker 发送）、`online` 在脚本执行前发出（对应 Node `upAndRunning`）——事件序与 Node 一致（`online`→`error`→`exit`）；worker 的**定时器按 worker 计数**（包裹 `set*/clear*`），退出判定只看它自己的待办（entry 返回 && 自有定时器清零 && parentPort 未 ref），**不能用全局定时器增量**（浏览器 demo 实测踩到：父程序的无关定时器会把 worker 永远吊住）；`workerData` 深拷贝隔离、退出后 `threadId=-1`/`threadName=null`/`postMessage` no-op/`terminate()` 返回 `undefined` 全对齐，`process.threadId` 保持缺席（真 Node 实测）；`lib/loader` 加**每注册表内建覆盖**让 worker 里 `require('worker_threads')`/`process` 拿到 worker 侧视图；需求原生线程的东西（`eval`/worker 标准 IO/`resourceLimits`/剖析/嵌套 `Worker`）响亮抛错。验证同样是**差分语料**，15 条（真 Node v26.9.0 跑**真线程**）逐条一致。M58 把 **`internal/errors` 码表补齐**：把 vendored+src 里所有 `ERR_*` 引用与 shim 表对了一遍，发现 **9 个码被 `internal/errors` 解构引用却未定义**（`codes.X` 是 `undefined`、`new` 报 “is not a constructor”，只在罕至路径显形的潜在真 bug——其中 `ERR_INVALID_RETURN_VALUE` 已分别在 `ERROR_BASES`/`CUSTOM_FORMATTERS` 里、但漏在提供键的 `ERROR_CODES` 里）；9 码逐字（对齐 `lib/internal/errors.js` 与 `src/node_errors.h`）补齐，并新增**结构回归门禁**（`test/errors-table.test.ts`：遍历 vendored 树断言所有被引用码都存在为构造函数，扫到 76 个）与**差分语料**（`tools/errors-corpus-oracle.mjs` + `test/errors-corpus.test.ts`：真 Node `--expose-internals` 直取 `internal/errors` 逐字段比对，10/10 一致）。M59 把 **worker 标准 IO 做成真流**：`worker.stdin/stdout/stderr` 之前三个 getter 一律抛错，而真 Node 从不（`stdin` 默认 null；`stdout`/`stderr` 无条件是可读流、只是默认转发到父进程）——真 bug；现用**第二条 MessageChannel** 承载字节，worker 侧 `process.stdout/stderr/stdin` 是真流、`console` 绑到自己的 stdout/stderr、默认转发到父 stdout/stderr，未 `end()` 的 `worker.stdin` 会 ref 住 worker；顺带用静默期修了一个退出竞态（投递是 ~1ms 宏任务，旧的 0ms 退出检查会在投递前先关端口）。M60 把 **SystemError 基底的码**改正：`ERR_FS_CP_*`/`ERR_FS_EISDIR`/`ERR_SYSTEM_ERROR` 现在真的从上下文拼消息、`name='SystemError'`、带 `HideStackFramesError` 伴生类，并新增一条**消息文案差分门禁**（真 Node 逐码取原始模板，157 条）——正是它抓出 3 处真实文案错误（两个 `ERR_FS_CP_*` 文案互换）。M61 把 **`internalBinding` 表面补齐**：Node 内部只经 binding 取宿主能力，名字缺了就是 `undefined`、调用点报 “is not a function”（与 M58 同类）；扫出 5 处真缺失（`util.markPromiseAsHandled`、`uv.UV_ENOSPC` 及整张 `UV_E*` 表、`v8.kSampling*`、`constants.internal`、`process_methods.dlopenBinary`）并逐一补上——其中 **`uv` 改为从 `ERRNO` 生成整张常量表**（88 值逐值对齐真 Node，名字/值不可能漂移），并新增一条遍历 vendored 树的结构金门卫（断言所有 binding 属性路径均非 undefined，扫 >200 条）。M62 把 **`internal/errors` 的差分门禁拓宽**：M58 补了码表、M60 校了「纯字符串消息」的文案，还剩**函数型消息**（Node 里 message 是函数而非 `%s` 模板）与 **`E(code, msg, Base, ...Extra)` 的变体基底**（`.TypeError`/`.RangeError` 等静态）两类没被覆盖——这一步把两者都做成自动比对：语料 21 → **52** 例，覆盖全部 31 个函数型消息码（`ERR_OUT_OF_RANGE`/`ERR_MISSING_ARGS`/`ERR_MODULE_NOT_FOUND`/`ERR_UNSUPPORTED_ESM_URL_SCHEME`/`ERR_INTERNAL_ASSERTION`/`ERR_SOCKET_BAD_PORT`…），并新增一道**变体基底门禁**（`tools/errors-bases-oracle.mjs` → `test/errors-bases.json` + `test/errors-bases.test.ts`，对共享码逐一对齐，以后能直接报出「某码漏了 `.RangeError`」一类的潜在 “is not a constructor” 崩溃）；修复时扫出 **11 处真实偏差**（缺 `ERR_INVALID_ARG_VALUE.RangeError` 变体；`ERR_OUT_OF_RANGE` 字符串输入未加引号、句子缺 `be`；`ERR_MISSING_ARGS` 完全没处理多参数/数组；`ERR_MODULE_NOT_FOUND` 永远说 `module`（应 `package`）且不挂 `url`；`ERR_UNSUPPORTED_ESM_URL_SCHEME` 文案错误且基底错误（`TypeError`→`Error`）；`ERR_INTERNAL_ASSERTION` 丢了固定后缀；`ERR_SOCKET_BAD_PORT` 文案完全不对），全部对照 `lib/internal/errors.js` 真源改齐。M63 把 `internal/errors` 的差分做到**全表**（上一个里程碑只覆盖了手工挑的 52 例）：新增 `tools/errors-full-oracle.mjs`——对 Node 全部 316 个码先探测 arity（字符串消息从 assert 文案读所需参数数，函数消息逐个爬升参数直到能构造），再录像逐字段比对；门禁 `test/errors-full.test.ts` 对我们携带的 **85 个共享码**逐字段对齐（断言 ≥ 80，防表悄悄缩小）。最大的收获是**根因**：字符串消息在 Node 里是过 `lazyInternalUtilInspect().format(msg, ...args)` 的，我们之前的 `%[sdj]→String()` 是次等替代（`%d` 该做 `Number`）——现按 Node 同法惰性取 `internal/util/inspect`（两者加载期回环，不能 init 时 require），`ERR_OUT_OF_RANGE` 的 received 也改用真 `util.inspect`。由此再扫出 **10 处**真实偏差（两个基底错、`%d` 语义、三个函数消息漏 formatter、非数组参数的泛型兼容）。M64 把**公开模块表面**做了一次系统扫描并补齐：一条探针在页内 `require` 全部 67 个内建模块、与真 Node 逐键对比排序；据此补上四个一行重导出的别名 builtin（**`assert/strict`/`path/posix`/`path/win32`/`sys`**）与弃用的 **`constants` 伞**（之前加载即抛），把 `constants.os.errno` 改为**平台 errno 表**（与 libuv 的 `UV_ERRNO_MAP` 是两张不同的表——Node 的 `constants.os.errno` 来自宿主 `<cerrno>` 宏）并补齐 `RTLD_*`/信号/fs 常量，重写 **dns surface**（回调/异步两个命名空间从同一组描述符派生，`dns/promises` 缺口 **42→0**、`dns` **8→0**）。M65 继续往下走，收掉整个 **`net` 公开表面**：新建 `src/node-runtime/net/socket-address.ts` 作为 Node `block_list` 原生绑定的 TS 替身，实现 `net.SocketAddress` + `net.BlockList`（含与 glibc `inet_ntop` 逐行对齐的 IPv6 规范化输出——最长零串压缩 + IPv4-mapped/compatible 点分内嵌），规则序、`check` 语义（非法地址返 false 不抛）、v4 与 v4-mapped 等价均按真 Node v26.9.0 实测复刻；另补 `net.Stream` 与 `get/setDefaultAutoSelectFamily*`，并新增错误码 `ERR_INVALID_ADDRESS`。`http` 缺口 **12→0**。M68 把 **`process` 的语义深度**补齐：`process.env` 改为异质代理（写入经 `ToString`（符号值会抛）、只收可配可写可枚举数据描述符、原型 `Object.prototype`），并把剩下的 19 个内部量收尾（`_rawDebug`/`_fatalException`/`finalization`/`_preload_modules` 真实现，句柄枚举与 syscall 类响亮抛错）；`process` 缺口 **19→0**——**公开模块表面至此全部收齐**。`net` 缺口 **10→3**（仅剩三个非公开内部量）。M66 收掉整个 **`crypto` 公开表面**：工厂改为真类导出（`Hash`/`Hmac`/`Cipheriv`/`Decipheriv`，`instanceof` 成立）、新增 `subtle`（= `webcrypto.subtle`）、`randomUUIDv7`（RFC 9562 UUIDv7）、`secureHeapUsed`、`setEngine`（无引擎，抛 `ERR_CRYPTO_ENGINE_UNKNOWN`），并把不对称/引擎类与函数（`Sign`/`Verify`/`KeyObject`/`DiffieHellman`/`ECDH`/`argon2` 等）做成**存在但响亮抛错**（与 `createSign` 等既有处理一致）；`crypto` 缺口 **21→0**。M67 收掉整个 **`http` 公开表面**：新建 `OutgoingMessage` 基类（`ServerResponse`/`ClientRequest` 继承）、实现 `Agent`+`globalAgent` 并让 `ClientRequest` 支持 `agent:false`、补 `validateHeaderName`/`validateHeaderValue`（真字符正则）、`maxHeaderSize`、`_connectionListener`、`setMaxIdleHTTPParsers`/`setGlobalProxyFromEnv` 与重导出的 `MessageEvent`/`CloseEvent`/`WebSocket`；`http` 缺口 **12→0**。M69 转入 **语义深度**：新建一条**扁平化原型链**差分扫描器（比较导出类的可达原型成员/静态成员与常量值，而非仅导出键），据此补齐 `http` 客户/服务端对象语义——`STATUS_CODES` 全表（63 项，含 1xx/226/451…）、`Server` 的 `requestTimeout`/`headersTimeout`/`keepAliveTimeout`/`maxRequestsPerSocket` 真默认值与 `setTimeout`/`closeAllConnections`/`closeIdleConnections`、`ServerResponse` 的 `connection`/`chunkedEncoding`/`sendDate`/`setTimeout`/`setHeaders`/`appendHeader`/`addTrailers`/`getRawHeaderNames` 与 1xx 中间响应（`writeContinue`/`writeProcessing`/`writeEarlyHints`/`writeInformation`）、`IncomingMessage` 的 `signal`/`headersDistinct`/`trailersDistinct`/`setTimeout`、`ClientRequest` 的 `socket`/`connection`/`protocol`/`maxHeadersCount`/`clearTimeout`/`onSocket`/`setNoDelay`/`setSocketKeepAlive`/`getRawHeaderNames`；并修了客户端两个真语义缺口——**跳过 1xx 中间响应**、**解析 chunked trailer 到 `res.trailers`/`rawTrailers`**。M70 把扫描器点出的最大结构缺口收掉：**`net.Socket` 从「只继承 EventEmitter 的手写子集」改为真 `stream.Duplex`**（`super({allowHalfOpen:true})` + `_read`/`_write`/`_final`/`_destroy` 映射到底层 vsock），于是 `pipe`/`pause`/`resume`/`read`/`push`/`unshift`/`readableEnded`/`writableEnded`/HWM 等整套流表面全部到位（真 Node 默认 HWM = 65536）。M71 做 **未实现表面的保真**（stub 也要能被特性探测）：`http.Agent` 改继承 `EventEmitter`（+ `Agent.defaultMaxSockets`）；`net.SocketAddress.parse`（URL 语义，默认端口 80 被去掉）；`dns.Resolver` 补齐全部 query 方法（loopback 的 resolve4/6/reverse 真解析、其余响亮抛错）；`zlib` 的 Brotli/Zstd 桩类改为继承真 `stream.Transform`（有完整流原型/静态成员）但构造即抛。M72 把**导出函数的 `Function.length`** 对齐真 Node：新增 `alignArity`（重定义可配的 `length` 属性，观测等价）+ `BuiltinSpec.arity` 钩子，在模块物化后逐名对齐 `crypto`(46)/`http`(11)/`https`(5)/`net`(6)/`zlib`(24)/`dns`(14)/`process`(17)/`module`(2)/`child_process`(2)/`worker_threads`(2)/`perf_hooks`(1)/`v8`(1)/`console`(3) 的 arity。M73 把 **crypto 桩类的原型保真**补上：`Sign`/`Verify` 继承真 `stream.Writable`（Node 即如此），`KeyObject`/`X509Certificate`/`DiffieHellman(Group)`/`ECDH`/`Certificate` 补齐 Node 的原型与静态成员（存在但真抛错），并补 `prng`/`pseudoRandomBytes`/`rng` 非枚举别名（DEP0115）。M74 把 **crypto 的 `Hash`/`Hmac`/`Cipheriv`/`Decipheriv` 从「工厂函数返回的对象」改成真 `stream.Transform` 子类**（Node 即如此），于是 `instanceof stream.Transform`（乃至 `.pipe`/`.read`/`.write`/事件）全部成立。M75 收掉 **console / child_process / zlib / v8 / net** 残余的公开表面：新增 `BuiltinSpec.postInit` 钩子把 inspector 表面移植到 `console`（`createTask`/`context`/`profile`/`profileEnd`/`timeStamp`）与 `v8`，`net.Socket`/`net.Server` 的状态改由原型访问器派生（`readyState` 按 Node 从 connecting/readable/writable 算）。M76 收掉 **http/https 原型面**：填实 `http.OutgoingMessage` 壳体并让子类共基类访问器（Node 的 `headersSent` 是只读 getter，子类不能自带同名字段），`https` 不再整体拷贝 `http`——真 `https.Server extends http.Server` 与 `https.Agent extends http.Agent` 使二者身份不同，TLS 材料仅*记录*不用（无握手），ticket keys 存真 48 字节随机值。M77 收掉 **module 原型/静态面**：新增 `builtins/source-map.ts` **逐行移置** Node 的 `internal/source_map/source_map.js`（VLQ 解码/`sections`/`findEntry` 二分/`findOrigin`），`module` 补 `wrap`/`wrapper`/`constants`/`_pathCache`/`get|setSourceMapsSupport`/`findSourceMap`/`enableCompileCache`/`Module.prototype.parent` 访问器等，loader-owned 成员响亮抛错。M78 收掉**最后一块差分 `tls`**：`Server extends net.Server`、`TLSSocket extends net.Socket`、`SecureContext` 三类层级成立，`Server` 的 TLS 配置面（`setSecureContext`/`addContext`/`get|setTicketKeys`/`_get|_setServerData`）**记录**材料并维护真 48 字节票据密钥，`convertALPNProtocols` 按 Node 线上格式编码（零长/超 255/截断校验），握手类成员（`getCipher`/`getPeerCertificate`/`exportKeyingMaterial`…）响亮抛错——**至此全部 67 个内建模块的扫描器原型/静态/arity 差分清零**。

> 预览 UI：右侧 Output / Preview 双 tab，**自动发现监听端口**（1.5s 轻量轮询），iframe 加载子域名（dev）或 `/preview/<port>/`（构建）。

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 | 纯 JS 运行层（realm / bindings / module loader） | ✅ 完成 |
| M2 | 虚拟文件系统（内存树 + OPFS 持久化） | ✅ 完成 |
| M3 | 网络（虚拟 TCP + ServiceWorker 桥 + 预览） | ✅ 完成（基础版） |
| S | **stream 前置**（Readable/Writable/pipe/背压 + chunked） | ✅ 完成 |
| M4 | **npm client**（registry + tarball + node_modules 写入） | ✅ 完成 |
| M3.5a | **keep-alive**（持久连接 + pipelining + 客户端连接池） | ✅ 完成 |
| M3.5b | **浏览器侧真流式**（SW 直转 ReadableStream） | ✅ 完成 |
| M3.5c | **https**（http 同名壳，无 TLS） | ✅ 完成 |
| M3.5d | 子域名路由（`<port>.localhost`） | ✅ 完成（dev server） |
| M5 | **构建工具：esbuild WASM**（安装→初始化→打包→写回） | ✅ 完成 |
| M5b | **真实打包器：rollup WASM**（ESM + tree-shaking → VFS） | ✅ 完成 |
| M5c | **Vite 本体**（真实 production build → VFS） | ✅ 完成 |
| M5d | **Vite dev server**（页内编排 + 预览） | ✅ 完成 |
| M5e | **Vite HMR**（非 WebSocket 的 BroadcastChannel 通道） | ✅ 完成 |
| M5f | **HMR 收尾**（CSS `css-update` + 按端口隔离通道） | ✅ 完成 |
| M6 | **npm 收尾**（lockfile + 完整性校验 + peer 自动安装） | ✅ 完成 |
| M7 | **child_process + 受控 spawn 面**（fork/exec/spawn + mini-shell + `ProcessHost`） | ✅ 完成 |
| M7 | **npm `.bin` shim + 生命周期脚本**（JS shim + 依赖/根项目脚本） | ✅ 完成 |
| M8 | **stream 收尾**（字节精确 `read(n)` + `objectMode` 分离 + `autoDestroy` + `readable` 驱动 + chunk 交付 `Buffer`） | ✅ 完成 |
| M9 | **Buffer 共享内存**（`slice`/`subarray` + `from(ArrayBuffer)` 返回视图） | ✅ 完成 |
| M10 | **扩大 vendoring**（真源码 `internal/streams/state.js` 接管 highWaterMark） | ✅ 完成 |
| M11 | **修 stream 核心 bug**（同步 push 递归、异步迭代错误传播）+ 真源码 `Readable.from` | ✅ 完成 |
| M12 | **对齐流状态形状**（`_readableState`/`_writableState`）+ 真源码谓词 | ✅ 完成 |
| M13 | **vendor `internal/streams/destroy.js`**（真 `destroy`/`_undestroy` + `[kState]` 位域）+ `finished()` 接真谓词 | ✅ 完成 |
| M14 | **vendor `internal/streams/end-of-stream.js`**（真 `eos`/`finished`，含 options + AbortSignal）| ✅ 完成 |
| M15 | **vendor Node 真 `events.js`**（替换自研 EventEmitter）+ 真 `stream.addAbortSignal`；`internal/streams/readable.js` 已 vendor 并就绪 | ✅ 完成 |
| M16 | **整套 stream 换真源码**（`lib/stream.js` + `internal/streams/*`：Writable/Duplex/Transform/PassThrough/pipeline/compose/duplexPair/operators + `stream/promises`），删除手写 stream | ✅ 完成 |
| M17 | **真 `async_hooks`**（`lib/async_hooks.js` + `internal/async_hooks.js` + `internal/async_local_storage/*` 换成真源码，落在自研 `async_wrap` 绑定上）+ tick/timer 真实 async resource（hook 会触发、`AsyncLocalStorage` 跨异步边界传 store） | ✅ 完成 |
| M18 | **真框架跑起来**：@vitejs/plugin-vue 在页内编译 **Vue 3 单文件组件**（SFC），`vite build` 出生产 Vue bundle、`createServer` 在预览里跑真实可交互 Vue 应用（计数器可点、HMR 生效） | ✅ 完成 |
| M19 | **更多 vendored 真源码**：`punycode.js`、`domain.js`、`diagnostics_channel.js`（跑在真 `async_hooks` 上，配 JS `diagnostics_channel` binding） | ✅ 完成 |
| M20 | **真 `string_decoder`**：把 `src/string_decoder.cc` 的 native 解码状态机用 JS 逐字节重写（`bindings/string_decoder.ts`），`lib/string_decoder.js` 换真源码；删掉自研实现 | ✅ 完成 |
| M21 | **真 `internal/util/types`**：vendor `lib/internal/util/types.js`，`types` binding 对齐 `src/node_types.cc` 表面（补 `isBigIntObject`、修 boxed-primitive 语义、去掉多余的 wasm 谓词）；`util.types` 指向真模块 | ✅ 完成 |
| M22 | **真 `internal/util/inspect`**：vendor `lib/internal/util/inspect.js`（`util.inspect` / `format` / `formatWithOptions` 换真源码）；补 `util` binding 的 `constants`/`getOwnNonIndexProperties`/`previewEntries`，新增 `internal/bootstrap/realm`、`internal/url` shim；`console` 改走真 `formatWithOptions`；`Buffer` 补 `hexSlice` + `<Buffer>` 自定义 inspect | ✅ 完成 |
| M23 | **真断言栈**：vendor `lib/assert.js` + `internal/assert/{utils,assertion_error,myers_diff}` + `internal/util/comparisons`（真 `isDeepStrictEqual`）+ `internal/util/colors` + 真 `internal/validators.js`；补 `internal/errors` 的断言 code 与 `HideStackFramesError`、`constants.os`、`buffer.compare`、`url.isURL`；编译器给每个单元打 `sourceURL`（新增 `source-registry`），堆栈从此有真文件名，`assert.ok(falsy)` 能还原触发表达式 | ✅ 完成 |
| M24 | **真 `util` 模块**：vendor `lib/util.js` + `lib/internal/util.js`（+ `internal/util/parse_args/*`、`internal/mime`、`internal/util/diff`）；删手写 `builtins/util.ts`，`util.promisify`/`callbackify`/`inherits`/`deprecate`/`styleText`/`stripVTControlCharacters`/`toUSVString`/`parseEnv`/`MIMEType`/`parseArgs`/`diff` 全为真源码；补 `util` binding（`defineLazyProperties`/`constructSharedArrayBuffer`/`parseEnv`/`guessHandleType`/`privateSymbols`/真 `sleep`）与 `uv` binding 的 `getErrorMap` | ✅ 完成 |
| M25 | **真 Web EventTarget 栈**：vendor `lib/internal/event_target.js` + `internal/webidl.js` + `internal/perf/utils.js`；删 `internal/event_target` 的 stub（旧 `isEventTarget()` 恒为 false），真 `EventTarget`/`Event`/`CustomEvent`/`NodeEventTarget`/`defineEventHandler`/`isEventTarget` 上线；`performance` binding 补齐 `node_perf_common.h` 的 milestone 枚举 + `milestones`；顺带修了一个只有 worker 才暴露的启动 bug（真 `internal/util.js` 加载时读 `process`，浏览器 worker 无 `process` 全局） | ✅ 完成 |
| M26 | **真 `AbortController`/`AbortSignal`**：vendor `lib/internal/abort_controller.js`；删旧 shim（之前直接 re-export host `AbortController`/`AbortSignal`），真 `AbortSignal.timeout`/`any`/`abort`/`throwIfAborted`/`reason`（DOMException `AbortError` code 20）；顺带把 `messaging` binding 补上 `DOMException`/`structuredClone`/`setDeserializerCreateObjectFunction`，`symbols` binding 改为 memo（重复读取符号身份稳定） | ✅ 完成 |
| M27 | **真 `console`**：vendor `lib/console.js` + `internal/console/{constructor,global}.js` + `internal/cli_table.js` + `internal/trace_events.js` + 真 `internal/util/debuglog.js`（+ `internal/readline/{utils,callbacks}.js`）；删手写 `builtins/console.ts`，真 `Console` 类与 `table`/`count`/`group`/`time`/`assert`/`dir`/`createTask` 上线；`process.stdout`/`stderr` 改为真 `Writable`（lazy getter+setter），新增 `trace_events` binding（inert） | ✅ 完成 |
| M28 | **真 `os`**：vendor `lib/os.js`；删手写 `builtins/os.ts`；`os` binding 对齐 `src/node_os.cc` 表面（`getOSInformation` 元组、`getLoadAvg(out)`、`getAvailableParallelism`/`getPriority`/`setPriority`/`isBigEndian`）；新增 `credentials` binding（`getTempDir`）；`internal/errors` 补 `ERR_SYSTEM_ERROR` | ✅ 完成 |
| M29 | **真 `timers`**：vendor `lib/timers.js` + `lib/internal/timers.js` + `lib/timers/promises.js` + `internal/{linkedlist,priority_queue}.js`；删手写 `builtins/timers.ts`；`timers` binding 实现 `src/timers.cc` 表面 + 一个代替 libuv 的驱动（`scheduleTimer`/`setupTimers`/`processTimers`/`processImmediate`）；runtime 在构造时调 `getTimerCallbacks(runNextTicks)` + `setupTimers`，`activeCount` 计入真队列，reset 时用公共 `clearTimeout`/`clearImmediate` 清空 | ✅ 完成 |
| M30 | **真 `worker_threads` 消息传递**：vendor `internal/worker/io.js` + `internal/per_context/messageport.js` + `internal/worker/js_transferable.js`；`messaging` binding 用 JS 重实现 `src/node_messaging.cc` 的可见契约（纠缠组/缓冲/关闭握手/端口转移/DataCloneError）；新增 `worker` binding、`internal/deps/undici/undici`（`createFastMessageEvent`）与 `worker_threads` 模块 | ✅ 完成 |
| M31 | **真 `readline`**：vendor `lib/readline.js` + `lib/readline/promises.js` + `internal/readline/{interface,emitKeypressEvents,promises}.js` + `internal/repl/history.js`；删掉 unsupported 占位；新增 `internal/process/permission` shim（永远 disabled，对齐 `--permission` 关时的 `src/node_permission.cc`） | ✅ 完成 |
| M32 | **worker 减重：构建期去注释**：新增 `plugins/vendored-source.ts`（用 loader 的 `codeMask` 分词器找注释，删注释但保留行号/代码列/每文件 MIT 声明）；`src/node-runtime/loader/code-mask.ts` 从 `esm-transform.ts` 抽出共享；注册到 `plugins` **和** `worker.plugins`（worker 子构建不看顶层 plugins）；worker **1259KB → 1028KB**、gzip **315KB → 237KB** | ✅ 完成 |
| M33 | **真 glob**：vendor `internal/fs/glob.js` + `internal/deps/minimatch/index.js`（自 `deps/minimatch/index.js`，esbuild 随包产物）；新增 `internal/fs/utils` shim（只 `DirentFromStats`）+ `internal/url.toPathIfFileURL`；`path.matchesGlob` 不再抛错，新增 `fs.glob`/`fs.globSync`/`fs.promises.glob` | ✅ 完成 |
| M34 | **crypto 同步面**：新增 `src/node-runtime/crypto/hash.ts`（纯 JS MD5/SHA-1/SHA-224/SHA-256/SHA-384/SHA-512 + HMAC/PBKDF2/HKDF/scrypt）；`builtins/crypto.ts` 扩到 `createHash`/`createHmac`/`hash`/`getHashes`/`pbkdf2(Sync)`/`hkdf(Sync)`/`scrypt(Sync)`/`timingSafeEqual`/`randomInt`/`randomFill(Sync)`；密文/签名/密钥对象等显式抛 `NotImplementedError` | ✅ 完成 |
| M35 | **真 `perf_hooks`**：vendor `perf_hooks.js` + `internal/perf/{performance,performance_entry,observe,usertiming,nodetiming,resource_timing,timerify,event_loop_delay,event_loop_utilization}.js`（MANIFEST 83 → 93）；`performance` binding 补齐 `observerCounts`/`setupObservers`/GC 常量/`loopIdleTime`/`uvMetricsInfo`；新增 `internal/histogram` shim（构造抛 `NotImplementedError`）；删手写 `builtins/perf-hooks.ts` | ✅ 完成 |
| M36 | **真 WHATWG streams**：vendor `stream/web.js` + `internal/webstreams/{util,transfer,readablestream,writablestream,transformstream,queuingstrategies,encoding,adapters,compression}.js`（MANIFEST 93 → 103）；删 `internal/webstreams/adapters` 抛错 Proxy，`Readable.toWeb`/`toWeb` 系列打通；新增 `internal/process/task_queues` shim（`queueMicrotask`）、`stream_wrap` binding（形状）、`buffer.copyArrayBuffer`、`uv.UV_EOF`；`internal/errors` 支持多基类（`ERR_INVALID_STATE.TypeError`）| ✅ 完成 |
| M37 | **真 `Blob`/`File`**：vendor `internal/blob.js` + `internal/file.js`（MANIFEST 103 → 105）；新增 JS `blob` binding（`DataQueue` → 扁平 `Uint8Array` 分片，对齐 `src/node_blob.cc` 可见契约）；`Blob`/`File` 成为全局且与 `require('buffer').Blob` 同身份；`buffer` binding 补 `kMaxLength`、`internal/encoding` 补 `getUtf8Decoder`；`fs.openAsBlob` 上线；新增最小 `vm` shim（`runInNewContext`）| ✅ 完成 |
| M38 | **真 `stream/iter` + `stream/consumers`**：vendor `stream/iter.js` + `stream/consumers.js` + 整个 `internal/streams/iter/*`（12 文件，MANIFEST 105 → 119）；新 iterable-streams API（`push`/`pull`/`from`/`merge`/`broadcast`/`share` + 同步/异步消费者 + 与经典流双向互操作）上线；`stream/consumers`（`text`/`json`/`buffer`/`bytes`/`arrayBuffer`/`blob`，靠 M37 的真 `Blob`）上线；`internal/options` 把 `--experimental-stream-iter` 默认置 on（标签页无 flag 面）| ✅ 完成 |
| M39 | **npm 深化**：`overrides`/`resolutions`（扁平 / 嵌套 / `.` / `$ref`，最长路径优先）、`file:`/`link:` 本地说明符（VFS 目录拷贝 / 本地 `.tgz` 解包）、**有界并发下载**（默认 8，先全下载再写树） | ✅ 完成 |
| M40 | **`fork()` 的 IPC 通道**：双向 `send`/`'message'`/`disconnect`（父 `child.*` / 子 `process.*`）、默认 JSON 序列化 + `'advanced'`、开着通道保活、事件序 disconnect→exit→close、缺失脚本像真 Node 一样 exit 1（不再当 spawn 失败）| ✅ 完成 |
| M41 | **Buffer slab 池化**：小于 `Buffer.poolSize>>>1` 的分配（`allocUnsafe`、`from(string)`、`from(Buffer/TypedArray)`、`concat`）从一块 **64 KiB slab** 切 **8 字节对齐**槽位；`allocUnsafeSlow`/`alloc`/大请求绕过池；`Buffer.poolSize = 65536`，`.byteOffset`/`.buffer.byteLength` 对齐真 Node v26.9.0 | ✅ 完成 |
| M42 | **`util.inspect` / ICU 保真度**：修 `isGeneratorFunction`/`isAsyncFunction`（`async function*` 两者皆为真 → `[AsyncGeneratorFunction: x]`）；`icu.getStringWidth` 用真列宽（东亚宽/e呀 emoji 2 列、控制/组合 0 列），`console.table` 与 CJK 折行对齐；promise/proxy/迭代器预览仍为明示近似 | ✅ 完成 |
| M43 | **`process` 表面 + 未捕获异常路由**：逐键对照真 Node 补齐公共面（`getBuiltinModule`/`getActiveResourcesInfo`/`loadEnvFile`/捕获回调三件套/`reallyExit`/`openStdin`/`ref`/`unref`/`debugPort`/`domain`/`report`），删真 Node 已删的三个 deprecation 开关；修 timer/nextTick 回调抛出绕过 `process._fatalException` 的**真 bug**；`VfsError` message 改成 Node `UVException` 形状 | ✅ 完成 |
| M44 | **宿主请求计入退出判定**：runtime 包装沙箱 `fetch`，在飞的宿主请求计入 `activeCount()`（`#hostRequests` + `#hostGeneration` 按 run 隔离），子进程在 in-flight `fetch` 落地后才判定退出；纯微任务 promise（`crypto.subtle`/`Blob.arrayBuffer`/裸 `new Promise`）与真 Node 一致地不计数 | ✅ 完成 |
| M45 | **真 `zlib`**：deflate/gzip 的流式与一次性异步形式跑在平台 `CompressionStream`/`DecompressionStream` 上（codec 不重写），默认选项下输出与 Node v26.9.0 **逐字节一致**；`crc32`/`constants`/`codes` 齐备；`unzip` 按魔数自动识别；同步形式与 `level`/`windowBits`/… 编码参数显式抛 `NotImplementedError`（不静默忽略），brotli/zstd/zip 同理；顺带解锁 `stream/web` 的 `CompressionStream`/`DecompressionStream` | ✅ 完成 |
| M46 | **宿主 WebSocket 计入退出判定**：runtime 包装沙箱 `WebSocket`，开着的 socket 计入 `activeCount()`（`#hostSockets` + `#hostGeneration` 按 run 隔离），子进程在 socket close/error 后才判定退出；顺带修一个被它暴露的 loader 真 bug——模块顶层 `const`/`let`/`class` 声明与注入的沙箱全局同名会 `Identifier 'X' has already been declared` 编译失败（Vite chunk 里的 `const WebSocket = websocket`），改用长度保持的 code-mask 分词器按模块剔除冲突名 | ✅ 完成 |
| M47 | **`crypto` 对称密码**：`createCipheriv`/`createDecipheriv` 支持 AES-128/192/256 的 ECB/CBC/CTR/CFB/OFB/GCM（纯 JS，FIPS-197 + NIST SP 800-38A/D，逐字节对齐 OpenSSL）；`getCiphers`/`getCipherInfo` 就位；未实现的已知 cipher 抛类型化 `NotImplementedError`、未知 cipher 抛 `ERR_CRYPTO_UNKNOWN_CIPHER`；顺带移除 Node v26 已删的 `createCipher`/`createDecipher` | ✅ 完成 |
| M48 | **`Buffer` 换真源码**：vendor 真 `lib/buffer.js` + `lib/internal/buffer.js` + `lib/internal/v8/startup_snapshot.js` + `lib/util/types.js`（MANIFEST 119 → 123），删自研 `builtins/buffer.ts`；`buffer` binding 扩成完整 JS 实现（逐字节对齐 `src/node_buffer.cc` + `src/string_bytes.cc` + `deps/nbytes`：各编码 slice/write、`indexOf*`、`compare`/`copy`/`fill`、`swap*`、`isAscii`/`isUtf8`、`atob`/`btoa`、unsafe 分配）；`icu` binding 补 `transcode`/`icuErrName`（返回真 `Buffer`，坏编码抛 `U_ILLEGAL_ARGUMENT_ERROR`）；新增 `mksnapshot` binding；`internal/errors` 补 buffer/snapshot 错误码 | ✅ 完成 |
| M52 | **真 `internal/fs/streams.js`**：vendor 真 `lib/internal/fs/streams.js`（MANIFEST 146 → 147），删掉自写 shim `builtins/fs-streams.ts`；`fs.ReadStream`/`fs.WriteStream` 换真源码（惰性加载：首次 `createReadStream`/`createWriteStream` 时 `fs` 已完整，顶层 `require('fs')` 回环自然解除）；`{start,end}` 闭区间、`bytesWritten`、`open` 事件回 number 型 fd、200000 字节按 `highWaterMark` 分块与 pipe 副本逐字节相等均与 Node v26.9.0 一致 | ✅ 完成 |
| M53 | **真 `url`**：vendor 真 `lib/url.js`（1045 行，MANIFEST 147 → 148），删掉 116 行手写 `builtins/url.ts`；`parse`/`format`/`resolve`/`resolveObject`/`Url` 与 WHATWG 重导出全为真源码；`internal/url` 从「re-export `url`」改成**桥到宿主 URL 类**（Node 那半是 native Ada；`pathToFileURL` 用 `src/node_url.cc` 的 `EncodePathChars` 表、`fileURLToPath` 照 `getPathFromURLPosix`），新增 `url`/`url_pattern`/`encoding_binding` binding 与 `internal/errors` 的 `ERR_INVALID_URL`/`ERR_INVALID_URL_SCHEME`/`ERR_INVALID_FILE_URL_HOST`/`ERR_INVALID_FILE_URL_PATH` | ✅ 完成 |
| M54 | **真 `v8`**：vendor 真 `lib/v8.js` + `lib/internal/v8/{heap_profile,cpu_profiler}.js`（MANIFEST 148 → 151）；新增 `serdes` binding——**把 V8 结构化克隆线格式（版本 15）用 JS 重写**（逐标签对照 `deps/v8/src/objects/value-serializer.cc`：varint/ZigZag、两字节字符串对齐 pad、对象 id 与反引用、dense/sparse 数组、Map/Set、Date/RegExp/Error（含 `cause`）、Boxed primitive、ArrayBuffer、Node 默认的 ABV host-object 路径），`v8.serialize`/`deserialize`/`Serializer`/`Deserializer` 全走它；`internal/heap_utils` 用 shim，堆与 profiler 面一律响亮抛错。验证：**115 条差分语料在真 Node v26.9.0 与 web-node 之间逐字节一致** | ✅ 完成 |
| M55 | **真 `tty`**：vendor 真 `lib/tty.js` + `lib/internal/tty.js`（MANIFEST 151 → 153）；新增 `tty_wrap` binding（`isTTY` 恒 false，`TTY` 构造即抛，`UV_TTY_MODE_*` 常量）；`internal/errors` 补 `ERR_INVALID_FD`/`ERR_INVALID_CURSOR_POS`/`ERR_INVALID_FD_TYPE`/`ERR_TTY_INIT_FAILED` 与真 `SystemError` + `kIsNodeError`；`internal/util/colors` 的 `FORCE_COLOR` 惰性路径从此可用（之前会炸）。验证：**57 条颜色深度 + 10 条 `hasColors` 语料与真 Node v26.9.0 全等** | ✅ 完成 |
| M56 | **真 `vm`**：vendor 真 `lib/vm.js` + `lib/internal/vm.js`（MANIFEST 153 → 155）；新增 `contextify` binding——把沙箱对象当作上下文（标 Node 的 contextify 符号），脚本跑在 `with (scope) { return eval(code) }` 里，`createContext`/`isContext`/`Script`/`compileFunction`/`runIn*Context` 全是真的；上下文对 `process`/`require`/`Buffer`/`setTimeout` 保持 `undefined`（只暴露标准内建 + `console`）。验证：**59 条差分语料与真 Node v26.9.0 逐条一致** | ✅ 完成 |
| M57 | **真 `Worker`**：`worker_threads.Worker` 落地为“同 loop 的协作式工作器”（`proc/worker.ts`）——一个 worker = 第二个模块注册表 + 自己的 `process`/`worker_threads` 视图 + 一条真实的 `MessageChannel`；`workerData`/消息往返/`online`/`message`/`error`/`exit` 生命周期/`terminate()` 与构造校验均与真 Node 对齐（退出后 `threadId=-1`、`postMessage` no-op、`terminate()` 返回 `undefined` 也一致）。**无并行**是唯一要紧的偏离（故 `eval`/worker 标准 IO/`resourceLimits`/剖析/嵌套 `Worker` 响亮报错）。验证：**15 条差分语料与真 Node v26.9.0（真线程）逐条一致** | ✅ 完成 |
| M58 | **补齐 `internal/errors` 码表**：对比 vendored+src 的全部 `ERR_*` 引用与 shim 的表，发现 **9 个码被 `internal/errors` 解构引用却未定义**（解构得 `undefined`，`new codes.ERR_X` 报 “is not a constructor”）——只在罕至路径显形的潜在真 bug；逐字对齐 `lib/internal/errors.js`/`src/node_errors.h` 补齐，并新增**结构回归门禁**（遍历 vendored 树断言所有引用码都存在，扫到 76 个）与**差分语料**（真 Node `--expose-internals` 直取 `internal/errors` 逐字段比对，10/10 一致） | ✅ 完成 |
| M59 | **真 worker 标准 IO**：`worker.stdin/stdout/stderr` 之前三个 getter **一律抛错**，而真 Node 从不抛（`stdin` 默认 null；`stdout`/`stderr` 无条件是可读流、只是默认转发到父进程）——真 bug。改为用**第二条 MessageChannel** 承载字节：worker 侧 `process.stdout/stderr/stdin` 是真流，worker 的 `console` 重绑到自己的 stdout/stderr，默认转发到父 stdout/stderr；`stdin: true` 时 `worker.stdin` 可写，未 `end()` 会 ref 住 worker。顺带修一个退出竞态：投递是 ~1ms 宏任务、旧退出检查是 0ms 会在投递前先关端口，改为**静默期（4ms）判定** | ✅ 完成 |
| M60 | **修正 SystemError 基底错误码**：`E(code, msg, SystemError)` 声明的码（`ERR_FS_CP_*`/`ERR_FS_EISDIR`/`ERR_SYSTEM_ERROR`）本应从**上下文对象**拼消息且 `name='SystemError'`，但 shim 只登记了 `ERR_TTY_INIT_FAILED`，其余走普通基底 → `name='Error'` 且丢了 `: syscall returned code (message) path => dest` 后缀。补齐 11 个码 + `HideStackFramesError` 伴生类 + `SystemError.dest`/`toString()`；顺带全量比对抓出 **3 处真实文案错误**（`ERR_FS_CP_DIR_TO_NON_DIR`/`NON_DIR_TO_DIR` 互换、`ERR_FS_CP_SYMLINK_TO_SUBDIRECTORY` 文案错）。新增消息文案差分门禁 | ✅ 完成 |
| M68 | **`process` 语义深度**：`process.env` 改为异质代理（`ToString` 强转、符号值报错、描述符规则、原型 `Object.prototype`）；补齐剩余 19 个内部量（`_rawDebug`/`_fatalException`/`finalization`/`_preload_modules` 真实现，其他响亮抛错） | ✅ 完成 |
| M69 | **`http` 对象语义深度**：`STATUS_CODES` 全表；`Server` 真默认值 + `setTimeout`/`closeAllConnections`/`closeIdleConnections`；`ServerResponse`/`IncomingMessage`/`ClientRequest` 的对象成员（中间响应、trailers、raw header 名、socket getter、timers、signal、distinct）；客户端**跳过 1xx** + **解析 trailers** | ✅ 完成 |
| M70 | **`net.Socket` 改真 `Duplex`**：从手写子集改为 `extends stream.Duplex`（`_read`/`_write`/`_final`/`_destroy` 桥到 vsock），整套流表面（pipe/pause/resume/read/push/readableEnded/HWM…）到位 | ✅ 完成 |
| M71 | **未实现表面的保真**：`http.Agent extends EventEmitter`（+ `defaultMaxSockets`）；`net.SocketAddress.parse`；`dns.Resolver` 全 query 方法（loopback 真解析/其余真抛）；`zlib` Brotli/Zstd 桩类继承 `Transform` 但构造即抛 | ✅ 完成 |
| M72 | **导出函数 arity 对齐**：新增 `alignArity`（重定义 `length`，可配）+ `BuiltinSpec.arity` 钩子，对 `crypto`/`http`/`https`/`net`/`zlib`/`dns`/`process`/`module`/`child_process`/`worker_threads`/`perf_hooks`/`v8`/`console` 逐名对齐真 Node v26.9.0 | ✅ 完成 |
| M73 | **crypto 桩类原型保真**：`Sign`/`Verify` 改继承真 `stream.Writable`；`KeyObject`/`X509Certificate`/`DiffieHellman(Group)`/`ECDH`/`Certificate` 补齐 Node 原型/静态成员（存在但真抛）；补 `prng`/`pseudoRandomBytes`/`rng` 非枚举别名（DEP0115） | ✅ 完成 |
| M74 | **crypto 流类改真 `Transform`**：`Hash`/`Hmac`/`Cipheriv`/`Decipheriv` 改继承忠实复刻的 `LazyTransform`（`_readableState`/`_writableState` 原型访问器 + 惰性建态）→ 继承真 `stream.Transform`；`_transform`/`_flush` 可真跑管道，crypto 扫描差分清零 | ✅ 完成 |
| M67 | **`http` 公开表面补齐**：新建 `OutgoingMessage` 基类（`ServerResponse`/`ClientRequest` 继承）；实现 `Agent`+`globalAgent`（文档化 API）并让 `ClientRequest` 支持 `agent:false`；补 `validateHeaderName`/`validateHeaderValue`（真字符正则）、`maxHeaderSize`、`_connectionListener`、`setMaxIdleHTTPParsers`/`setGlobalProxyFromEnv` 与重导出的 `MessageEvent`/`CloseEvent`/`WebSocket` | ✅ 完成 |
| M66 | **`crypto` 公开表面补齐**：工厂改为真类导出（`Hash`/`Hmac`/`Cipheriv`/`Decipheriv`，`instanceof` 成立）；新增 `subtle`/`randomUUIDv7`（RFC 9562）/`secureHeapUsed`/`setEngine`；把不对称/引擎类与函数（`Sign`/`Verify`/`KeyObject`/`DiffieHellman`/`ECDH`/`argon2` 等）做成**存在但响亮抛错** | ✅ 完成 |
| M65 | **`net` 公开表面补齐**：新增 `src/node-runtime/net/socket-address.ts`（Node `block_list` 原生绑定的 TS 替身）——`SocketAddress` + `BlockList`（完整 API、glibc 级 IP 规范化输出、规则序/`check` 语义/v4-mapped 等价均按真 Node 实测复刻）；补 `net.Stream`、`get/setDefaultAutoSelectFamily*`；新增错误码 `ERR_INVALID_ADDRESS` | ✅ 完成 |
| M64 | **公开模块表面补齐**：新增四个别名 builtin（`assert/strict`、`path/posix`、`path/win32`、`sys`）与弃用的 `constants` 伞（之前加载即抛），把 `constants.os.errno` 改为**平台 errno 表**（与 libuv 表拆开）、补齐 `RTLD_*`/信号/fs 常量；重写 dns surface（回调/异步同源派生 + 全部 c-ares 错误码与 hint 标志） | ✅ 完成 |
| M63 | **`internal/errors` 全表差分**：新增全表 oracle（Node 316 码自动发现 arity + 构造）与门禁（85 个共享码逐字段对比）；字符串消息**改用真 `util.format`**（按 Node 同法惰性取 `internal/util/inspect`），`ERR_OUT_OF_RANGE` 用真 `util.inspect`；再扫出并修 **10 处**真实偏差（`ERR_FS_FILE_TOO_LARGE`→`RangeError`、`ERR_INVALID_URI`→`URIError`、`%d` 语义、3 个函数消息的 formatter、非数组参数的泛型兼容） | ✅ 完成 |
| M62 | **拓宽 `internal/errors` 差分门禁**：语料 21 → **52** 例，覆盖全部 31 个函数型消息码；新增**变体基底门禁**（`errors-bases` oracle + test，防漏 `.RangeError`/`.TypeError` 静态）；修掉 11 处真实偏差（缺 `ERR_INVALID_ARG_VALUE.RangeError` 变体，`ERR_OUT_OF_RANGE`/`ERR_MISSING_ARGS`/`ERR_MODULE_NOT_FOUND`/`ERR_UNSUPPORTED_ESM_URL_SCHEME`/`ERR_INTERNAL_ASSERTION`/`ERR_SOCKET_BAD_PORT` 的文案与基底） | ✅ 完成 |
| M61 | **补齐 `internalBinding` 表面**：Node 内部只经 `internalBinding(id)` 取宿主能力，名字没定义就 `undefined`、调用点报 “is not a function”（与 M58/M60 同类）。扫出 **5 处真缺失**（可达）：`util.markPromiseAsHandled`（`internal/streams/iter/*` 调用 → TypeError）、`uv.UV_ENOSPC` 及整张 `UV_E*` 表（`internal/fs/watchers` 比错分支）、`v8.kSampling*`（采样掩码位 undefined）、`constants.internal`（`internal/vfs/setup` 取属性即 TypeError）、`process_methods.dlopenBinary`。**`uv` 改为从 `ERRNO` 生成整张表**（88 值逐值对齐真 Node，名字/值再不可能漂移）；新增结构回归门禁遍历 vendored 树断言所有 binding 属性路径均非 undefined（扫 >200 条） | ✅ 完成 |
| M51b | **`fs.opendir`/`Dir` + `fs.watchFile`**：`fs_dir` binding 真实现（`opendir`/`opendirSync` + `DirHandle`：`read` 返回 libuv 扁平 `[name,type,…]`、穷尽 `null`；`close`；`dirfd`），`lib/internal/fs/dir.js` 的 `Dir` 原样可跑；`StatWatcher` 从抛错换成**轮询实现**（复刻 libuv `uv_fs_poll` 协议，轮询走 `ctx.timers` 参与事件循环判定） | ✅ 完成 |
| M51 | **真回调式 `fs`**：vendor 真 `lib/fs.js`（4083 行）+ `internal/fs/read/context.js` + `internal/fs/cp/cp-sync.js` + `internal/streams/fast-utf8-stream.js`（MANIFEST 142 → 146）；`fs` binding 补 `readFileUtf8`/`writeFileUtf8`（整文件 utf8 快路，写做成单次 VFS 操作使 `fs.watch` 每整写只报一个事件）/`handleToFd`/`cpSyncCheckPaths`/`cpSyncCopyDir`/`cpSyncOverrideFile`/`CpDirJob`/`StatWatcher`/`kFsStatsFieldsNumber`；`fs_event_wrap.FSEvent` 从抛错换成 **VFS 投影**（订阅 `Vfs.subscribe`，`create`/`delete`→`rename`、`change`→`change`），`fs.watch`/`fs.promises.watch` 因此走真 watchers 代码；`readSync`/`writeSync` 把 `position === -1` 按“当前位置”处理；`internal/fs/streams.js` 顶层回环不进 vendor，另写 `builtins/fs-streams.ts`（VFS 原生读写流） | ✅ 完成 |
| M50 | **真 `fs/promises`**：vendor 真 `lib/fs/promises.js` + `lib/internal/fs/promises.js`（2304 行）+ `internal/fs/{dir,watchers,recursive_watch}.js` + `internal/vfs/setup.js` + `internal/fs/cp/cp.js`（MANIFEST 135 → 142）；`fs` binding 补齐整张 async/promise 面（`kUsePromises` 三态派发：Promise / 回调 / 同步；`FileHandle`/`ReadFileJob`/`WriteFileJob`；`stat` 家族返回 18 槽元组；`readdir` 返回 `{0:names,1:types}`）；`hideStackFrames` 补 `.withoutStackTrace`；`internal/fs/rimraf` 改成 VFS 原生 shim（真 rimraf 驱动回调 fs + Buffer 路径，标签页没有）；`fs.promises` 换成 `require('fs/promises')` 同一个对象 | ✅ 完成 |
| M49 | **真 `vfs` 子系统 + fs 基座**：vendor 真 `lib/internal/fs/utils.js`（替掉 shim）与整个 `lib/internal/vfs/*`（`file_system`/`provider`/`fd`/`stats`/`dir`/`file_handle`/`streams`/`watcher`/`router`/`errors` + `providers/memory`）（MANIFEST 123 → 135）；新增 `vfs` 模块（`create`/`VirtualFileSystem`/`VirtualProvider`/`MemoryProvider`，`RealFSProvider`/`ZipProvider` 显式不支持）；`uv` binding 从空表换成**真 `UV_ERRNO_MAP`（85 条）**，`internal/errors` 补真 `UVException` 并把 `uvErrmapGet` 接上；`constants` binding 补全 `fs`/`os` 表（access modes、`O_SYNC`、`S_IF*`、`UV_DIRENT_*`、`os.devNull`、`os.errno`）；fs binding 补 `internalModuleStat`/`readdirRecursive`；顺带 `util.getSystemErrorMap()` 恢复成真表 | ✅ 完成 |
| D | **GitHub Pages 部署**（子路径站点 + gh-pages 发布） | ✅ 完成 |


**在线 demo**：<https://mcuking.github.io/web-node/>

**质量门禁**：`tsc --noEmit` 干净 · `vitest run` **978 通过 / 2 预存 skip（111 files）** · `vite build` 绿（worker **2507.07KB** / index ~10.84KB / css ~4.06KB）

### 网络层怎么走通的（M3）

```
浏览器 URL  /preview/3000/…
      │
      ▼
 ServiceWorker (public/sw.js)          ← 拦截同源 /preview/<port>/ 请求
      │  postMessage + MessageChannel
      ▼
 主线程 RuntimeClient                   ← 转发到 runtime worker
      │  postMessage
      ▼
 Runtime Worker ──► VirtualNetwork.dial(3000)   ← 虚拟端口表（纯 TS）
      │
      ▼
 用户的 http.createServer handler
```

- **虚拟 TCP**：`src/node-runtime/net/network.ts` —— 端口表 + 双工字节管道，`write` 永远异步交付，`dial()` 抛 EADDRINUSE/ECONNREFUSED。
- **`net` / `http`**：`src/node-runtime/builtins/{net,http}.ts` —— 自建 TS 等价实现（**不是** vendored 真源码，`describe()` 里 origin 标 `web-node`）。real `lib/net.js` 和 `lib/http.js` 依赖 stream / async_wrap / http_parser，全量 vendor 会牵出几十个文件。
- **SW 桥**：`public/sw.js` + `RuntimeClient.installServiceWorkerBridge()` + worker 的 `http` 消息类型。
- **预览 UI**：右侧面板 Output / Preview 双 tab，自动发现监听端口，iframe 加载 `/preview/<port>/`。

**MVP 限制**（已知）：
- **子域名路由仅在 dev server 可用**：`<port>.localhost:5199` 需要 dev 中间件与 `<port>.localhost` 的 wildcard DNS（浏览器把 `*.localhost` 解析到 loopback）。构建产物 / `vite preview` / GitHub Pages 没有这个 wildcard，自动回退到路径前缀 `/preview/<port>/`（`src/ui/preview-url.ts` 按环境选）。
- 路径前缀模式下：绝对路径资源（`/app.js`）会落在前缀外；HTML 响应会注入 `<base>` 修正**相对路径**资源。dev 子域名模式没有此限制（每个预览是真实源）。

### stream 层怎么走通的（前置）

```
fs.createReadStream(p)  ─┐
req (IncomingMessage)   ─┼─►  Readable ──pipe()──►  Writable  ─┬─►  fs.createWriteStream(p)
Readable.from(iter)     ─┘        ▲        背压: write()===false           └─►  res (ServerResponse,
                                  └────── dest 'drain' ── resume()             无 Content-Length → chunked)
```

- **`stream`**：`src/node-runtime/builtins/stream.ts`（新，纯 TS，`origin: 'web-node'`）。真 `lib/stream*.js` 是 30+ 文件的簇，所以自建可观察表面：`Readable`/`Writable`/`Duplex`/`Transform`/`PassThrough` + `pipe`/`pipeline`/`finished` + `stream/promises`。
- **背压是真的**：`write()`/`push()` 过 high-water mark 返回 `false`，Writable 排空后发 `'drain'`，`pipe()` 暂停源并在 `'drain'` 时 `resume()`。`req.pipe(res)` 因此能把背压一路传回读端，而不是把整个 body 吞进内存。
- **`fs` 流**：`fs.createReadStream`/`createWriteStream` + `fs.ReadStream`/`fs.WriteStream`。VFS 是同步的，所以 `_read()` 按需拉下一块——背压不是装饰。
- **`http`**：`IncomingMessage` 改成 `Readable`、`ServerResponse` 改成 `Writable`（没设 `Content-Length` 就用 `Transfer-Encoding: chunked` 分帧）、`ClientRequest` 改成 `Writable`。`HttpMessageReader` 新增 chunked 解码（含 `chunk-size`/`chunk-data`/`chunk-crlf` 状态机）。

**怎么跑起来**：
```bash
# 必须用 fnm 的独立 Node，不要用 ClawHive 内置 Electron Node
export PATH="/Users/tangjianghong/Library/Application Support/fnm/node-versions/v22.19.0/installation/bin:$PATH"
cd /Users/tangjianghong/Downloads/web-node
npx vite --port 5199 --strictPort    # → http://localhost:5199/
npx vitest run                        # 单测
npx tsc --noEmit                      # 类型检查
npx vite build                        # 生产构建
node tools/vendor.mjs                 # 重新 vendor 真 Node 源码
```

**验证清单**（改完运行时必跑一遍）：
1. 打开 http://localhost:5199/ → 状态栏显示 `runtime ready`
2. 点 **▶ Run** → 终端出现 `=== web-node demo ===` 全段输出，并看到 `http server  : listening on http://localhost:3000`
3. **再点 2 次 Run** → 每次都有完整输出（验证无缓存空跑）
4. 切到 **Preview** tab → iframe 渲染出绿色标题 “Hello from your in-browser Node.js server” + 6 行事实表
5. 浏览器控制台执行 `await (await fetch('/preview/3000/api/info')).text()` → 返回运行时的 JSON
6. `fetch('/preview/9999/')` → 502 + `ECONNREFUSED`（错误要正确上浮，不能静默）
7. 刷新页面 → 文件树里 `output/report.txt` 仍在（验证 OPFS 持久化）
8. 点 **Reset project** → 回到完整 demo（含 `lib/facts.js`）

**stream 附加清单**（本里程碑）：
9. Run 输出里应有 `-- stream --`、`read stream : 197 bytes in 13 chunks of <=16`、`pipeline    : facts-upper.txt written`
10. `await (await fetch('/preview/3000/download/facts.txt')).text()` → 197 字节 facts 文本（`fs.createReadStream().pipe(res)`）
11. `await (await fetch('/preview/3000/api/stream')).text()` → `tick 1;tick 2;tick 3;tick 4;tick 5;done`（5 次 `res.write()` → chunked）
12. `await fetch('/preview/3000/api/upload', { method: 'POST', body: '...' })` → `{"bytes":N}`；再查 `/api/ls?dir=/project/output` 应看到 `upload.txt`
13. `/api/ls?dir=/project/output` → `facts-upper.txt`、`facts.txt`、`report.txt`（+ 上传后 `upload.txt`）

---

## 下一步（从这里继续）

> **固定路线图在 [`docs/ROADMAP.md`](ROADMAP.md)**——正序、带编号、可勾选（当前剩余 **10** 个规划任务，主线是**阶段 H：native → WASM**——M115/M116/M117/M118 ✅，下一步 **M119**（`crypto` → OpenSSL 子集编 wasm））。下面这份是历史 backlog（多数已 ✅），保留作决策痕迹。

按优先级：

1. ~~**给 `internal/async_hooks` 一个真实实现**~~ ✅ **已解决（2026-09-20，M17）**。
2. ~~**跑一个真前端框架**~~ ✅ **已解决（2026-09-20，M18）**：@vitejs/plugin-vue 在页内编译 Vue 3 SFC，`vite build` 出生产 bundle、dev server 在预览里跑真实可交互应用（计数器可点 + HMR）。顺带修了两个真问题：**Vite 5.4 的依赖预打包（esbuild）在无文件系统下不可用**（改用 `optimizeDeps.disabled`，让 Vite 直接供 node_modules 的 ESM 源码）、**esbuild-wasm 必须钉在 Vite 5.4 驱动的 0.21 线**。
2b. ~~**继续拉 vendored 真源码**~~ ✅ **已解决（2026-09-20，M19）**：`punycode.js` / `domain.js` / `diagnostics_channel.js` 已换真源码（后两者就坐在真 `async_hooks` 上）。下面“继续 vendoring”一节给出下一步批次的候选。
2c. ~~**`string_decoder` 换真源码**~~ ✅ **已解决（2026-09-20，M20）**：把 `src/string_decoder.cc` 的 native 解码状态机用 JS 重写（`bindings/string_decoder.ts`），真 `lib/string_decoder.js` 直接跑在上面；并让 `internal/util` 的 `normalizeEncoding`/`encodingsMap` 与 Node 对齐。
2d. ~~**`internal/util/types` 换真源码**~~ ✅ **已解决（2026-09-20，M21）**：真 `lib/internal/util/types.js` + `types` binding 对齐 `src/node_types.cc`；`util.types` 直接指向真模块。
2e. ~~**`internal/util/inspect` 换真源码**~~ ✅ **已解决（2026-09-20，M22）**：真 `lib/internal/util/inspect.js`（`util.inspect`/`format`/`formatWithOptions`）；补 `util` binding 的 `constants`/`getOwnNonIndexProperties`/`previewEntries`，新增 `internal/bootstrap/realm` + `internal/url` shim，`console` 走真 `formatWithOptions`，`Buffer` 补 `hexSlice` + `<Buffer>` 自定义 inspect。剩余近似：`getPromiseDetails` 恒 pending、`getProxyDetails` 恒 undefined（V8 不同步暴露）。
2f. ~~**`assert` 与 `internal/validators` 换真源码**~~ ✅ **已解决（2026-09-20，M23）**：真 `lib/assert.js` + `internal/assert/{utils,assertion_error,myers_diff}` + `internal/util/comparisons`（真 `isDeepStrictEqual`）+ 真 `internal/validators.js`；补 `internal/errors` 的断言 code、`constants.os`、`buffer.compare`、`url.isURL`；编译器给每个单元打 `sourceURL`（新增 `source-registry`），堆栈从此有真文件名，`assert.ok(falsy)` 能还原真表达式。差异：`getErrorSourceExpression` 无 tokenizer（嵌入表达式的调用会返回整条语句）、`HideStackFramesError` 不真隐帧。
2g. ~~**`util` 换真源码**~~ ✅ **已解决（2026-09-20，M24）**：真 `lib/util.js` + `lib/internal/util.js`（+ `internal/util/parse_args/*`、`internal/mime`、`internal/util/diff`）；补 `util` binding（`defineLazyProperties`/`constructSharedArrayBuffer`/`parseEnv`/`privateSymbols`/真 `sleep`）。差异：无 libuv → `getSystemErrorMap()` 为空、`getCallSites` 仍为 `[]`。
2h. ~~**Web EventTarget 栈换真源码**~~ ✅ **已解决（2026-09-20，M25）**：真 `lib/internal/event_target.js` + `internal/webidl.js` + `internal/perf/utils.js`；删 `internal/event_target` stub（旧 `isEventTarget()` 恒为 false）；`performance` binding 补 milestone 枚举 + `milestones`。顺带修了 worker-only 启动 bug（真 `internal/util.js` 加载时读 `process`）。
2i. ~~**`internal/abort_controller` 换真源码**~~ ✅ **已解决（2026-09-20，M26）**：真 `lib/internal/abort_controller.js`（真 `AbortController`/`AbortSignal`，建在真 `EventTarget` 上）；补 `messaging` binding 的 `DOMException`/`structuredClone`，新增 `internal/worker/js_transferable` shim（`markTransferMode` inert）。剩：全局 `AbortController`/`AbortSignal` 仍镜像宿主（有意偏离）。
2j. ~~**`console` 换真源码**~~ ✅ **已解决（2026-09-20，M27）**：真 `lib/console.js` + `internal/console/*` + `internal/cli_table` + `internal/trace_events` + 真 `internal/util/debuglog`；删手写 `builtins/console.ts`；`process.stdout`/`stderr` 改真 `Writable`（lazy getter+setter），新增 `trace_events` binding。剩：`internal/readline/*` 当时只被 console 的 `clear()` 用到（M31 已把整个 `readline` 换成真源码并验证）。
2k. ~~**`os` 换真源码**~~ ✅ **已解决（2026-09-21，M28）**：真 `lib/os.js`；删手写 `builtins/os.ts`；`os` binding 对齐 `src/node_os.cc` 表面；新增 `credentials` binding（`getTempDir`）。
2l. ~~**`timers` 换真源码**~~ ✅ **已解决（2026-09-21，M29）**：真 `lib/timers.js` + `lib/internal/timers.js` + `lib/timers/promises.js` + `internal/{linkedlist,priority_queue}.js`；删手写 `builtins/timers.ts`；`timers` binding 实现 `src/timers.cc` 表面并内置一个代替 libuv 的驱动；runtime 构造时 `getTimerCallbacks(runNextTicks)` + `setupTimers`。剩：异常从 timer 回调抛出时只有一次重入（无可捕获的 uncaughtException 循环）。
2m. ~~**`worker_threads` 消息传递换真源码**~~ ✅ **已解决（2026-09-21，M30）**：真 `internal/worker/io.js` + `internal/per_context/messageport.js` + 真 `internal/worker/js_transferable.js`；`messaging` binding 用 JS 重实现 `src/node_messaging.cc` 的可见契约（纠缠组/缓冲/关闭握手/端口转移/DataCloneError 全套）；新增 `worker` binding + `internal/deps/undici/undici`（只 `createFastMessageEvent`）+ 真部分 `worker_threads` 模块。剩：端口不参与“进程存活”（有意）；`MessageEvent` 是本 realm `Event`；`JSTransferable` 的 clone/transfer 钩子未接。
2n. ~~**`readline` 换真源码**~~ ✅ **已解决（2026-09-21，M31）**：真 `lib/readline.js` + `lib/readline/promises.js` + `internal/readline/{interface,emitKeypressEvents,promises}.js` + `internal/repl/history.js`；删掉 unsupported 占位；新增 `internal/process/permission` shim（永远 disabled）。剩：无真实 TTY（`terminal:true` 只是把流当终端用，raw mode 不可用）；历史写盘走虚拟 `fs`。
2o. ~~**`perf_hooks` 换真源码**~~ ✅ **已解决（2026-09-21，M35）**：真 `lib/perf_hooks.js` + 整个 `internal/perf/*`；`performance` binding 补成完整 JS 实现（`observerCounts`/`setupObservers`/GC 常量/`loopIdleTime`/`uvMetricsInfo`，时钟用浏览器 `performance.now()`）；新增 `internal/histogram` shim。剩：`createHistogram`/`importHistogram`/`monitorEventLoopDelay` 抛 `NotImplementedError`（需 native hdr_histogram）。
2p. ~~**WHATWG streams（`stream/web`）换真源码**~~ ✅ **已解决（2026-09-21，M36）**：真 `lib/stream/web.js` + 整个 `internal/webstreams/*`（10 文件 / ~8700 行）；`internal/webstreams/adapters` 不再抛错，`Readable.toWeb`/`Writable.toWeb`/`Duplex.toWeb`（及反向 `fromWeb`）全部打通；新增 `internal/process/task_queues` shim（`queueMicrotask`）、`stream_wrap` binding（形状）、`buffer.copyArrayBuffer`、`uv.UV_EOF`；`internal/errors` 支持多基类（`ERR_INVALID_STATE.TypeError`）。剩：无——`CompressionStream`/`DecompressionStream` 已随 **M45** 的真 `zlib`（deflate/gzip 跑在平台 codec 上）上线，仅 `brotli` 格式抛错。
2q. ~~**`Blob`/`File` 换真源码**~~ ✅ **已解决（2026-09-21，M37）**：真 `lib/internal/blob.js` + `lib/internal/file.js`（MANIFEST 103 → 105）；新增 JS `blob` binding（`DataQueue` → 扁平 `Uint8Array` 分片，保留每 pull 一片/按 source 边界切块）；`Blob`/`File` 成为全局且与 `require('buffer').Blob` 同身份；`buffer` binding 补 `kMaxLength`、`internal/encoding` 补 `getUtf8Decoder`、新增 `fs.openAsBlob`；顺带补最小 `vm` shim（`runInNewContext`，真 `internal/util.js` 靠它取跨 realm `RegExp`，否则 stream finalizer 抛未捕获 `NotImplementedError`）。剩：`blob` 全部字节源都是内存驻留（无 fd-backed 增量读）；`URL.createObjectURL` 的对象存储也就位，但没做跨 worker 转移。
2r. ~~**`stream/iter` + `stream/consumers` 换真源码**~~ ✅ **已解决（2026-09-21，M38）**：真 `lib/stream/iter.js` + `lib/stream/consumers.js` + 整个 `internal/streams/iter/*`（12 文件，MANIFEST 105 → 119）；iterable-streams API（`push`/`pull`/`from`/`merge`/`broadcast`/`share`/`tap` + 同步/异步消费者 + 经典流双向互操作）与 `stream/consumers`（`text`/`json`/`buffer`/`bytes`/`arrayBuffer`/`blob`）上线；`internal/options` 将 `--experimental-stream-iter` 默认置 on（标签页无 flag 面）。剩：`internal/streams/iter/transform.js`（`lib/zlib/iter.js` 的压缩变换）未 vendor——它顶层就 `internalBinding('zlib')`（native 绑定，与 M45 的 builtin `zlib` 无关），不是平台 codec 能替代的。
3. **继续 vendoring（按 ROI 排序）**：
   - ~~**`buffer` + `internal/buffer`（Buffer 本体）**~~ ✅ **已处理（2026-09-21，M48）**：真 `lib/buffer.js` + `lib/internal/buffer.js` + `lib/internal/v8/startup_snapshot.js` + `lib/util/types.js`；`buffer` binding 扩成完整 JS 实现（编码/检索/比较/填充/交换/unsafe 分配），`icu` binding 补 `transcode`，新增 `mksnapshot` binding。剩：`setDetachKey` 是 no-op（V8 detach key 不可复刻），`markAsUntransferable` 因此只靠私有符号（对宿主 `structuredClone` 是 advisory）。
   - ~~**`stream/web`（WHATWG streams）**~~ ✅ **已处理（2026-09-21，M36）**：见上条 2p。
   - ~~**`perf_hooks`**~~ ✅ **已处理（2026-09-21，M35）**：见上条 2o。
   - ~~**`crypto`**~~ ✅ **部分处理（2026-09-21，M34）**：同步面（摘要/HMAC/PBKDF2/HKDF/scrypt/`timingSafeEqual`）已用 JS 实现并对齐 OpenSSL 输出；仍缺：密文（AES 等，需同步密码学或原生）、签名/验签、非对称密钥与 `KeyObject`、Diffie-Hellman、素数生成——它们需要原生 OpenSSL 或 keystore，保留显式抛错。
   - ~~**`internal/fs/utils`（fs 基座）**~~ ✅ **已处理（2026-09-21，M49）**：真 `lib/internal/fs/utils.js` 已 vendor，并连整个 `lib/internal/vfs/*` + `providers/memory` 一起搬进来，`vfs` 模块在运行时可用（`MemoryProvider` 全表面，对照 `node --experimental-vfs` 逐行为验证）；顺带把 `uv` errno 表做成真的（85 条）。
   - ~~**`fs/promises` 换真源码**~~ ✅ **已处理（2026-09-21，M50）**：真 `lib/internal/fs/promises.js` + `lib/fs/promises.js` 已跑起来（VFS 挂载路径走 Node 自己的派发，其余走我们的 `fs` binding，async/promise 面已补全，`fs.promises === require('fs/promises')`）。
   - ~~**callback `fs`（真 `lib/fs.js`）换真源**~~ ✅ **已处理（2026-09-21，M51）**：真 `lib/fs.js`（4083 行）+ `internal/fs/read/context.js` + `internal/fs/cp/cp-sync.js` + `internal/streams/fast-utf8-stream.js`（MANIFEST 142 → 146）；`fs` binding 补 `readFileUtf8`/`writeFileUtf8`/`handleToFd`/`cpSyncCheckPaths`/`cpSyncCopyDir`/`cpSyncOverrideFile`/`CpDirJob`/`StatWatcher`/`kFsStatsFieldsNumber`；`fs_event_wrap.FSEvent` 从抛错换成 **VFS 投影**（订阅 `Vfs.subscribe`），`fs.watch`/`fs.promises.watch` 因此走真 watchers 代码；`readSync`/`writeSync` 把 `position === -1` 按“当前位置”处理；`internal/fs/streams.js` 顶层回环不进 vendor，另写 `builtins/fs-streams.ts`（VFS 原生读写流）。剩：**M52 已把真 `internal/fs/streams.js` vendor 进来**（见下），手写 shim 已删。
   - ~~**`internal/fs/streams.js` 真源**~~ ✅ **已处理（2026-09-21，M52）**：真 `fs.ReadStream`/`fs.WriteStream` 换真源码（MANIFEST 146 → 147，删 `builtins/fs-streams.ts`）。惰性加载（`createReadStream`/`createWriteStream` 时才 `require`），那时 `fs` 已完整，顶层 `require('fs')` 回环自然解除。
   - **`url` 换真源码**：✅ **已处理（2026-09-21，M53）**：真 `lib/url.js` 已 vendor（MANIFEST 147 → 148），`internal/url` 改成宿主 URL 桥（`pathToFileURL`/`fileURLToPath`/`domainToASCII` 等自实现），补 `url`/`url_pattern`/`encoding_binding` binding；手写 `builtins/url.ts` 已删。剩：URL 解析本身仍是**宿主**的（Node 那半是 native Ada），边角行为以宿主为准并已在 DEVLOG 记录。
   - **`v8` 换真源码**：✅ **已处理（2026-09-21，M54）**：真 `lib/v8.js` 已 vendor（MANIFEST 148 → 151），`serdes` binding 用 JS 实现 V8 线格式（版本 15）并对 115 条差分语料逐字节对齐真 Node v26.9.0；堆与 profiler 面一律抛 `ERR_WEB_NODE_NOT_IMPLEMENTED`。剩：数组 elements kind 的“历史状态”、`Proxy` 识别、异常对象的 clone 错误文案是**已记录的近似**；~~`hasInspector: false` 使 `takeCoverage`/`stopCoverage` 不存在~~ ✅ **已解决（M75）**：改为存在但响亮抛（对齐出厂带 inspector 的 Node）。
   - **`tty` 换真源码**：✅ **已处理（2026-09-21，M55）**：真 `lib/tty.js` + `lib/internal/tty.js` 已 vendor（MANIFEST 151 → 153），`tty_wrap` binding 让 `isatty` 与颜色深度成为真实现，`ReadStream`/`WriteStream` 构造即抛（标签页没有 TTY 句柄）。
   - **`vm` 换真源码**：✅ **已处理（2026-09-21，M56）**：真 `lib/vm.js` + `lib/internal/vm.js` 已 vendor（MANIFEST 153 → 155），`contextify` binding 把上下文/`Script`/`compileFunction` 落实为单 realm 内的 `with`-scope 语义，59 条差分语料与真 Node v26.9.0 逐条一致。`unsupported` 现在只剩 **`tls`**。
   - **下一步（M75）候选**：扫描器剩余差分——`module`(22：`SourceMap`/`_load`/`_findPath`/`registerHooks`/`stripTypeScriptTypes`…)、`tls`(12：`TLSSocket`/`Server` 原型保真)、`http`(4：`OutgoingMessage`/`ServerResponse` 的 header 方法与 getter)、`https`(2)。~~`net`(7)、`console`(5)、`child_process`(2)、`zlib`~~ ✅ **已解决（2026-09-22，M75）**：见上条。
   - ~~**`internal/fs/glob`**~~ ✅ **已处理（2026-09-21，M33）**：真 `internal/fs/glob.js` + 随包 `internal/deps/minimatch/index`；`path.matchesGlob`、`fs.glob`/`globSync`、`fs.promises.glob` 上线。剩：`internal/fs/utils` 仍是只含 `DirentFromStats` 的 shim（真文件是 fs 基座）；`withFileTypes` 的 `Dirent.parentPath` 与我们自研 readdir 的形状一致（绝对值 vs Node 按传入路径）已对齐。
   - ~~**`stream/iter` + `stream/consumers`**~~ ✅ **已处理（2026-09-21，M38）**：真 `lib/stream/iter.js` + `lib/stream/consumers.js` + 整个 `internal/streams/iter/*`（12 文件）。`internal/streams/iter/transform.js` 不在内（它顶层 `internalBinding('zlib')`；M45 的 builtin `zlib` 不能代替 native 绑定，故仍未支持）。
   - **`internal/perf/*` 的直方图半边**：⚠️ 部分过时——M35 已把 `perf_hooks` 换成真源码；仅 `createHistogram`/`importHistogram`/`monitorEventLoopDelay` 仍抛错（真 `internal/histogram` 背后是 native hdr_histogram + 一整套统计检验，JS 移植代价大、优先级低）。
   - **`internal/fs/*` 其余部分**：我们已是自研 `fs`，其上层模块（`fs/promises`、`internal/fs/*`）可逐个尝试真源码；`internal/fs/utils.js` 是 fs 基座，替换它等于重写整个 `fs`，暂不碰。
   - **`internal/errors.js`**：仍是 shim，但 **M58 已把它对齐到 vendored 代码实际取用的每一个码**（补齐 9 个被解构引用却漏定义的码，并新增结构回归门测试兵护）。真文件是环形依赖枢纽（211 文件），全量 vendoring 不现实；继续拓宽时（`SYSTEM_ERROR_CODES`/`CUSTOM_PROPS`）优先靠那门测试报缺。
   - **`util` 里剩下的自研块**：⚠️ 已过时——M24 已把 `lib/util.js` 整份换成真源码。
   - **`lib/timers.js` + `internal/timers.js`**：⚠️ 已过时——M29 已整份换成真源码（含一个代替 libuv 的驱动）。
   - **`internal/worker/io.js`（MessagePort/MessageChannel）**：⚠️ 已过时——M30 已整份换成真源码（含一个 JS 重实现的 `messaging` binding）。
   - **`readline` / `internal/readline/*`**：⚠️ 已过时——M31 已整份换成真源码（含 `readline/promises` 与 `internal/repl/history`）。
4. **promise hooks（M17 跲尾，可选）**：`async_hooks` 现在看得见 tick/timer/AsyncResource，但 V8 promise 未插桩，`promiseResolve` 不响。**这条路在浏览器里是死的**：V8 的 `SetPromiseHooks` 只暴露给 embedder（C++），JS 层拦不住 `await`/async 函数创建的 promise；只在 `Promise.prototype.then` 上做手脚会漏一大半，故不做半吊子实现（详见设计文档第 9 节）。
5. ~~**npm 再进一步**~~ ✅ **已处理（2026-09-21，M39）**：`overrides`/`resolutions`（扁平/嵌套/`.`/`$ref`，最长路径优先）、`file:`/`link:` 本地说明符（VFS 目录拷贝 / 本地 `.tgz` 解包，`link:` 物化为拷贝）、有界并发下载（默认 8，先全下载再写树）。剩：`git+`/`git:` 仍不支持（标签页里没有 git）。
6. ~~**child_process 收尾（M7 遗留）— fork 的 IPC**~~ ✅ **已处理（2026-09-21，M40）**：`fork()` 真给两边一条通道（见下条变更记录）。~~剩：**child 剩余工作是 host promise（如 in-flight `fetch`）时退出判定不可见**~~ ✅ **已解决（2026-09-21，M44）**：runtime 现在把在飞的宿主请求计入 `activeCount()`（包装沙箱的 `fetch`），子进程只在归零后才判定退出；纯微任务 promise（`crypto.subtle`/`Blob.arrayBuffer`/裸 `new Promise`）**不**计数，与真 Node 一致（见下条变更记录）。剩：`execArgv` 传给子进程的 `process.execArgv`，但子进程不会真按它跑 flag。
7. ~~**Buffer pooling 遗留（M9 尾声）**~~ ✅ **已处理（2026-09-21，M41）**：小分配从 64 KiB slab 切 8 字节对齐槽位，`allocUnsafeSlow`/`alloc`/大请求绕过池（见下条变更记录）。
8. ~~**把 vendored 源改成按需加载 / code-split**~~ ✅ **已处理（2026-09-21，M32）**：**代码分割在这里是死路**——`require()` 是同步的，而 vendor 源是运行时用 `new Function` 编译的字符串，拆成异步 chunk 就无法同步拿到；拆成 N 个小 chunk 也只是把同一个总量分多次下载，没有净减。真正能减的是 **payload 本身**：构建期把注释删掉（真 Node 源注释占 **~23.3%**），同时**严格保留行号与代码列**、保留每文件 MIT 声明 → worker **1259KB → 1028KB（−18%）**、gzip **315KB → 237KB（−25%）**。未做：缩进未动（保留列号）；若要再减 ~100KB 可去缩进，但会牺牲堆栈列号。
9. **`console.createTask` / inspector 面**：真 console 的 `createTask` 走 `async_hooks` 的 `createTask`；真 `initializeGlobalConsole` 的 snapshot/inspector 分支在我们这里不可达（`hasInspector:false`）。
10. ~~**把 `internal/streams/duplexify` 的 `internal/blob` 从 `isBlob` stub 扩到真 `Blob`**~~ ✅ **已解决（2026-09-21，M37）**：`internal/blob` 已是真源码，`isBlob` 与全局 `Blob` 同身份，duplexify 的 Blob 分支现在对得上真实建出的 Blob。
11. ~~**`zlib`**~~ ✅ **已处理（2026-09-21，M45）**：deflate/gzip 的流式与一次性异步形式跑在平台 `CompressionStream`/`DecompressionStream` 上（默认选项字节级对齐真 Node v26.9.0），`crc32`/`constants`/`codes` 齐备，`stream/web` 的 `CompressionStream`/`DecompressionStream` 同步解锁。仍缺（有意，平台无对应面）：同步形式（`gzipSync` 等）、`level`/`windowBits`/`memLevel`/`strategy`/`dictionary` 等编码参数、`flush()`/`params()`、brotli/zstd/zip——均显式抛 `NotImplementedError`。若日后确实需要同步压缩/自定义 level，得自己写一份纯 JS deflate（代价大，优先级低）。
10b. ~~**补 `internal/util/inspect` 等 shim 的保真度**~~ ✅ **已解决（2026-09-21，M42）**：`types` binding 的 `isGeneratorFunction`/`isAsyncFunction` 修正（`async function*` 两者皆为真，`util.inspect` 因此输出 `[AsyncGeneratorFunction: x]`）；`icu.getStringWidth` 用真列宽重写。剩：`getPromiseDetails`（恒 pending）/`getProxyDetails`（恒 undefined）/Map/Set 迭代器预览 仍为近似（V8 不同步暴露内部状态）。
10c. ~~**`process` 表面补齐（M43）**~~ ✅ **已解决（2026-09-21，M43）**：逐键对照真 Node v26.9.0，补齐 `getBuiltinModule`/`getActiveResourcesInfo`/`loadEnvFile`/未捕获异常捕获回调三件套/`reallyExit`/`openStdin`/`ref`/`unref`/`debugPort`/`domain`/`report`，移除已删的 `noDeprecation`/`throwDeprecation`/`traceDeprecation`；顺带修了「timer/nextTick 回调抛出绕过 `process._fatalException`」的真 bug，并把 `VfsError` 改成 Node `UVException` 的消息形状。剩：`_*` 内部面与 Unix 原生（`dlopen`/`execve`/`seteuid` 等）/`moduleLoadList` 仍不存在（不面向用户代码）。
12. ~~**扫描器原型/静态/arity 差分**~~ ✅ **已清零（2026-09-22，M75–M78）**：全 67 个内建模块的导出函数 `length`、类原型（含继承链）成员、类静态成员与常量的差分已全部收掉。下一步的优先级转为**语义深度**（同一表面下让真调用更接近真 Node）：采用**差分语料**（同一观测程序在真 Node 与 web-node 各跑一遍，JSON 必须逐字段相等）。**M79 已用此法把 `http` 语义对齐**（80 个观测点全等）、**M80 把 `net` 对齐**（连接/事件序列/默认值全等）、**M81 把 `fs` 对齐**（错误形状/Stats/递归删、可选 surface 全等，见变更记录）；后续候选：`net` 连接生命周期与超时、`fs` 错误形状、`crypto` 非对称面、`module.registerHooks` 等。

---

## 变更记录

### 2026-09-24 · M119（第七增量）—— 全曲线 EC（OpenSSL 注册表）+ 绑定清单清理

**里程碑**：把「只有 3 条 NIST 曲线有算术」这个限制拆掉，并用一台永久门禁回答「native 迁完了吗」。

- **`crypto.getCurves()` 交给 OpenSSL**：新增 `wn_ec_curves`（`EC_get_builtin_curves` + `OBJ_nid2sn`），JS 侧再套 Node 的 `filterDuplicateStrings`（大小写不敏感去重、保留原拼写、排序）。**结果：82 条曲线、顺序与 Node 完全一致**（此前是 7 条手写名字）。这是设计文档「开放问题 §7.3（getCiphers/getHashes/getCurves 这类表面常量由 wasm 导出还是 TS 表维护）」的答复：由 wasm 导出。
- **任意曲线都能用**：`EcMaterial.curve` 从「必须带全套域参（p/a/b/Gx/Gy/n）」放宽为 `NamedCurve`（名称 + 坐标宽 + OID），加 `hasArithmetic()` 判别。无本地算术的曲线（secp256k1、prime192v1、brainpool\*、SM2、sect\*/c2\*/wtls\* …）走 `wn_ec_curve_info`（`EC_curve_nist2nid` → `OBJ_sn2nid` → `OBJ_txt2obj`，与 Node 的 `Ec::GetCurveIdFromName` 同序）解析，keygen 直接交给 OpenSSL。**secp256k1 等 80 条曲线从「报 NotImplementedError」变成完整可用**（keygen/导入/导出/签验/ECDH）。
- **RSA 任意 publicExponent**：`wn_pkey_keygen` 新增指数参数（`BN_dec2bn` + `EVP_PKEY_CTX_set1_rsa_keygen_pubexp`），不再只有 65537 走 wasm。
- **两个被测试实测出来的字节级差异（都已修）**：① EC 私钥标量 OpenSSL 按**阶的字节宽**补齐（`ossl_ec_key_simple_priv2oct` 用 `EC_GROUP_order_bits`），不是按域宽、也不是最简长度——WTLS 那类「阶短于域」的曲线会差一个 0x00；② **IEEE P1363 的半宽用阶宽而非域宽**（Node 的 `GroupOrderSize`），同样只在阶≠域的曲线上显形（wtls1 是 28 字节而域宽算出来是 30）。
- **SM2 的真相（写进文档的有意偏离）**：OpenSSL 的 EC key manager **按设计拒绝**导入 SM2 曲线的材料（`ec_kmgmt.c` 的 `common_check_sm2`），而 SM2 key manager 只收 SM3 且**没有 derive**。所以：SM2 的 keygen/导入/导出/`asymmetricKeyDetails` 我们都行（且比 Node 更好——Node 导入 SM2 后 `asymmetricKeyType` 是 `undefined`、非 SM3 一律 `ERR_OSSL_INVALID_DIGEST`、ECDH 靠“没经过 DER”才碰巧能用）；**SM3 签验我们与 Node 双向互验通过**；非 SM3 摘要与 ECDH 我们**如实报 OpenSSL 的错误**（`ERR_OSSL_INVALID_DIGEST` / `operation not supported for this keytype`），而不是笼统说“未实现”。
- **绑定清单清理（回答“native 迁完了吗”）**：`UNSUPPORTED_BINDINGS` 曾把 `crypto`、`zlib`、`inspector`、`trace_events` 同时写成“已注册”和“刻意不提供”，还混入 `vfs`（不是 Node 的 binding 名）。现在这份清单**恰好等于“Node 的 lib/ 会要、而我们不提供”的 32 个名字**，按原因分组（编译机制 / 进程控制 / socket / TLS / 无浏览器对应物）。新增夹具 `test/fixtures/node-bindings.json`（72 个名字，源出 `tools/binding-names-oracle.mjs`）与永久门禁：**清单里不能有虚构名、不能与已注册集合重叠、已注册名必须是 Node 的真实拼写、vendored 树读到的每个 binding 都必须落在两者之一**。
- **删掉一处真死代码**：`src/node-runtime/builtins/fs-promises.ts`（`fsPromisesSpec`）自 M49 之后已无人引用——`fs/promises` 现在是 vendored 真源。
- **验收**：新差分门禁 `test/crypto-openssl-curves.test.ts`（7 例）——`getCurves()` 逐项相等；12 条代表性曲线（NIST / Koblitz / 遗留 NIST / Brainpool / SM2 / 二元域 / WTLS）的 keygen→Node 导入→我们重导入**字节一致**、Node 生成的密钥我们导入后 details 一致、**双向签验 + P1363**、**跨实现 ECDH 逐字节相等**；RSA 四个 publicExponent。另有 `Oakley-EC2N-3/4` 的说明：它们**在 Node 里也无法导出**（`ERR_OSSL_MISSING_OID`，NID 没有 OID），所以只是被列出。`tsc --noEmit` 净 · `vitest run` **1051 passed / 2 skipped（125 文件）** · build（`wn_openssl-CRn2NAJj.wasm` 2481.83 kB、`runtime.worker-DefAp24J.js` 713.78 kB）。
- **M119 剩余**：非对称 keygen 的自定义 DH 参数（`group`/`prime`/`generator`）与 ml-kem。

---

### 2026-09-24 · M119（第六增量）—— X509Certificate 与 SPKAC 切到 wasm

**里程碑**：crypto 里最后两块纯 JS 表面（证书与 SPKAC）也改了道。

- **X509**：`wn_openssl` 新增 `wn_x509_*`（`new`/`free`/`to_der`/`subject`/`issuer`/`subject_alt_name`/`info_access`/`valid_time_string`/`valid_time_seconds`/`serial_number`/`signature_algorithm`/`signature_algorithm_oid`/`key_usage`/`ca`）。**关键认识**：决定 getter 字符串的是 Node 自己的打印辅助函数（`deps/ncrypto` 的 `PrintGeneralName` / `SafeX509SubjectAltNamePrint` / `SafeX509InfoAccessPrint`，以及 `X509_NAME_print_ex` + `kX509NameFlagsMultiline`、`ASN1_TIME_print`、`BN_bn2hex`、`X509_check_ca`），所以它们被**逐行搬到 C**，而不是继续在 JS 里“根据 DER 推”。`bindings/openssl.ts` 的字符串读取用“先问长度、再填缓冲”两步（C 侧传 NULL 即只返长度），避免定长限制。
- **可选扩展的"空 vs 缺失"**：`subjectAltName`/`infoAccess` 缺失时 Node 返回 `undefined`，而 C 侧对“无此扩展”返回 0 长度——绑定层把空串归一为 `null`（第一次跑差分就是在这里报 `"" vs null` 的）。
- **生命周期**：wasm 堆不回收，用 `FinalizationRegistry` 在包装对象被回收时 `wn_x509_free`（未注册就只能泄漏）。
- **SPKAC**：`wn_spkac_verify`/`public_key`/`challenge` 接 `NETSCAPE_SPKI_b64_decode` / `NETSCAPE_SPKI_verify` / `PEM_write_bio_PUBKEY` / `ASN1_STRING_to_UTF8`。base64 解码的“宽松度”是 OpenSSL `EVP_DecodeBlock` 的行为，所以也交给真身。
- **没动的部分**：`checkHost`/`checkEmail`/`checkIP`/`checkIssued`/`checkPrivateKey`/`verify`/`toLegacyObject`/`fingerprint` 仍用 DER 派生状态（指纹就是 DER 的摘要，而签名/验签经 `asym.ts` 已经走 wasm）。这样两边语义一致，也避开了 `X509_check_host` 那套 flag 在 JS 里重实现的风险。
- **验收**：`test/x509.test.ts` 新增“**开关引擎得到完全相同的 getter**”门禁（20 个字段，含 `raw`/PEM/legacy/SPKI 十六进制）；`test/crypto-certificate.test.ts` 同样加 SPKAC 的开关对比。原有差分语料（`test/fixtures/x509.json`、`test/fixtures/crypto-certificate.json`）**逐字段 0 diff**。`tsc --noEmit` 净 · `vitest run` **1043 passed / 2 skipped（124 文件）** · build（`wn_openssl-Dl_5d2Si.wasm` 2479.56 kB 独立资产、`runtime.worker-DefvwTSx.js` 711.20 kB）。
- **M119 剩余**：非对称 **keygen** 的少数场景（rsa 非默认 `publicExponent`、ec 非 NIST 曲线、自定义 DH 参数、ml-kem）。

---

### 2026-09-24 · M119（第五增量）—— DH/ECDH 与 ML-KEM 切到 wasm

**里程碑**：C 侧的 `wn_pkey_*` 上一增量已经写好（含 `derive`/`encapsulate`/`decapsulate`），这一步把 JS 侧接上。

- **`diffieHellman()`**：`ec`/`dh` 密钥都经现有 DER 编码器建 `EVP_PKEY` 后走 `wn_pkey_derive`；域参数不匹配等失败会返回 `null` 并**原地回退**，仍由 JS 抛 `ERR_OSSL_MISMATCHING_DOMAIN_PARAMETERS`。
- **ML-KEM**：`encapsulate`/`decapsulate` 走 `wn_pkey_encapsulate`/`decapsulate`（密钥经 **SPKI / PKCS#8** 导入——`[0]` seed 与 `[1]` expanded 两种 ML-KEM 私钥形式 OpenSSL 都认，所以 seed 与 dk 两条路径共用同一套导入）。密文长度不对仍是 JS 先拦、报 `ERR_CRYPTO_OPERATION_FAILED`/`Decapsulation failed`（与 Node 一致）。**keygen 暂留 JS**（输出是随机的，迁移收益只是“真上游”；且需支持自定义 DH group/prime 等参数，另开增量）。
- **裸私钥的一个细节**：ML-KEM 的 `EVP_PKEY_new_raw_private_key_ex` 期望的是 **扩展后的 `dk`**（tkem-512 1632 字节），**不是 64 字节 seed**（seed 只能过 PKCS#8）。测试里两种形式都驗了。
- **验收**：`test/crypto-openssl-pkey.test.ts` 扩到 12 例，新增：① ECDH 三条曲线的共享密钥与 **Node 逐字节相等**（且两引擎一致）；② Node 生成的 `modp14` DH 对，我们与 Node 算出的密钥相等；③ ML-KEM 三个参数集的 `encapsulate`/`decapsulate` 与 **Node 双向互验**、与纯 JS 一致、密文截断报错一致；④ 一个“**路由真的走了**”的探针：把我们 `export({format:'der'})` 产出的 PKCS#8/SPKI 直接喂 `wn_pkey_from_der`，RSA/EC/Ed25519/ML-KEM 四种都必须导入成功（若不行就是静默回退了）；⑤ 用 `wn_pkey_from_raw` 拿 `dk` 直接做 wasm 侧截装，再与**纯 JS FIPS 203 实现**对同一密文截装结果相等。
- `tsc --noEmit` 净 · `vitest run` **1041 passed / 2 skipped（124 文件）** · build（`wn_openssl-ClALQSg4.wasm` **2355.62 kB** 独立资产、`runtime.worker-Dqsd3PXF.js` 708.27 kB）。
- **剩余**：非对称的 **keygen**（rsa 非默认幂/ec 其他曲线/自定义 DH 参数/ml-kem）、**X509/SPKAC** 仍纯 JS。

---

### 2026-09-24 · M119（第三增量）—— Argon2 切到 wasm OpenSSL 的 ARGON2D/I/ID

**里程碑**：`crypto.argon2(Sync)` 之前跑纯 JS 的 RFC 9106 实现（BLAKE2b + BlaMka + 索引生成），现在优先跑 default provider 的 Argon2 KDF，未就绪/名字取不到则**原地回退**（两边逐字节一致）。

- **C 侧**：`wn_argon2(algo, …, lanes, keylen, memcost, iter, out)` —— `EVP_KDF_fetch(NULL, "ARGON2D|I|ID")` + `EVP_KDF_derive`，参数名照 `deps/ncrypto/ncrypto.cc`（`OSSL_KDF_PARAM_PASSWORD/SALT/ARGON2_LANES/ARGON2_MEMCOST/ITER/SECRET/ARGON2_AD`）。
- **刻意不传 `OSSL_KDF_PARAM_THREADS`**：ncrypto 只在 `lanes > 1` 时建私有 `OSSL_LIB_CTX` 并 `OSSL_set_max_threads` 把 lane 分给 OS 线程，而我们的 wasi 构建是 `thread_scheme=(none)`；**lane 数是独立于线程数的算法参数**，不传只是不在多 lane 上并行，输出不变。
- **验收**：`test/crypto-openssl-engine.test.ts` 的 KDF 段增加 Argon2 用例（argon2d/i/id 各一组 + 一组带 `secret`/`associatedData`/4 lanes/64 字节 tag），对 **wasm / 纯 JS / 宿主 `node:crypto.argon2Sync`** 三方逐字节比对。

---

### 2026-09-24 · M119（第四增量）—— 修好 OpenSSL 的 BIGNUM（wasm32 是用 32 位的 `long`），非对称切到 wasm

**里程碑**：把 RSA / EC / Ed25519 的**签名、验签、密钥生成**与 **RSA 加解密**迁到 wasm 的 OpenSSL。刚上手就撞到一个**一直被藏着的大雷**：整个 M119 的 OpenSSL 构建其实一直是坏的（BIGNUM 全错）。

- **抓到的真 bug（根因）**：`native/openssl/99-wasi.conf` 的 `bn_ops` 写成了 **`SIXTY_FOUR_BIT_LONG`**，它把 `BN_ULONG` 定义为 **`unsigned long`**、`BN_BITS2` 定义为 **64**。而 wasm32 是 **ILP32**（`long` 32 位、`long long` 64 位）——于是“字长 32、位数当 64”，**每一个 BIGNUM 运算都在错**。摘要/密码/KDF 不碰 BN，所以前三个增量全绿也看不出问题；一旦碰 RSA/EC（`d2i_PUBKEY` 解 INTEGER、EC 建域、keygen）就现形：`bn_div_words` 内的 `assert` 失败 → wasm `unreachable`。**改成 `SIXTY_FOUR_BIT`**（用 `unsigned long long`，即 Windows x64/LLP64 的路子）后修复。
- **顺带让缓存失效机制可信**：`native/build.mjs` 的 OpenSSL 缓存标记原本只写时间戳——改了 `99-wasi.conf` 会**静默复用旧库**。现在标记里写入配置文件内容的 **sha256**，改了配置就自动重建。
- **C 侧扩面（通用 EVP_PKEY，不按算法分开）**：新增 `wn_pkey_keygen`（按名取算法 + 可选 group + RSA bits）、`wn_pkey_from_der`（`d2i_AutoPrivateKey`/`d2i_PUBKEY`）、`wn_pkey_from_raw`、`wn_pkey_to_der`/`wn_pkey_der_size`、`wn_pkey_to_raw`/`wn_pkey_raw_size`、`wn_pkey_size`、`wn_pkey_free`，以及 `wn_pkey_sign`/`wn_pkey_verify`（空 md 名即*直接签消息*，对应 Ed25519）、`wn_pkey_encrypt`/`wn_pkey_decrypt`（PPP/OAEP+digest+label）、`wn_pkey_derive`（ECDH/DH）、`wn_pkey_encapsulate`/`wn_pkey_decapsulate`（ML-KEM，留给下一增量）。padding 值直接收 Node 的 `crypto.constants` 数值。
- **JS 侧接入（原地回退）**：`crypto/asym.ts` 在 `opensslReady()` 时优先走 wasm——`sign`/`verify`（RSA PKCS#1/PSS、ECDSA DER/**ieee-p1363**、Ed25519）、`generateKeyPairSync`（rsa/ec/ed25519）、`publicEncrypt`/`privateDecrypt`（PKCS#1/OAEP/NO_PADDING）；密钥经**现有 DER 编码器**导出再 `d2i` 进 OpenSSL（材料仍是那套 `KeyMaterial`，下游无感）。新增 `asymEngine()` 供诊断/测试。**只在 JS 也能如实覆盖的模式下路由**（如 RSA 只走 PKCS#1/PSS，其余 padding 继续走 JS），保证“翻转对调用者不可见”。
- **顺手修了一个真语义偏差（PSS 默认盐长）**：Node 把盐长交给 OpenSSL——**签名默认最大盐**（不是摘要长）、**验签默认 AUTO**（接受对方选的盐长）。我们对 `resolvedPssSaltLength` 之前默认取摘要长，于是“用默认参数签、用默认参数验”能过，但**验不了 Node/其他实现用默认参数签的 PSS 签名**（互操作 bug，旧测试只用了显式 `saltLength: 32` 所以没暴露）。现在两边都按 Node 对齐，且 JS 路径的 `emsaPssVerify` 支持 AUTO。
- **验收**：新增差分门禁 `test/crypto-openssl-pkey.test.ts`（8 例）——对 Ed25519 / RSA PKCS#1 / RSA-PSS（含默认盐长与显式 32）/ ECDSA（三条曲线 × DER 与 P1363）/ RSA 加解密（PPP、OAEP-sha1/256/384+label）做**双向互验**：我们签→Node 验、Node 签→我们验，**且在每个方向上都把 wasm 引擎关掉再跑一遍**（纯 JS 与 OpenSSL 同一标准）；另抽 PKCS#1 签名（无随机）做**两引擎 + Node 逐字节相等**。既有 `crypto-asym`/`crypto-keygen`/`crypto-enc` 等全成了回归网。`tsc --noEmit` 净 · `vitest run` **1037 passed / 2 skipped（124 文件）** · build（`wn_openssl-ClALQSg4.wasm` **2355.62 kB** 独立资产、`runtime.worker-BP0PvCge.js` 706.99 kB）。
- **剩余**：DH/ECDH 的 `diffieHellman()`、ML-KEM 的 `encapsulate`/`decapsulate`（C 侧已就位，只差接线）、X509/SPKAC 仍纯 JS。

---

### 2026-09-24 · M119（第二增量）—— OpenSSL 的**对称密码与 KDF** 切到 wasm，与纯 JS 实现逐字节等价（阶段 H P4）

**里程碑**：摘要/HMAC 已在首增量切到真 OpenSSL；这一步把**对称密码族**（AES/DES/Camellia/ARIA/SM4 的全部模式，含 CCM/OCB/SIV/GCM-SIV/XTS/CBC-CTS/wrap/des3-wrap）与**KDF**（`pbkdf2`/`hkdf`/`scrypt`）也迁过去。两者在 `crypto` 里比摘要复杂得多：它们是**流式 + 有状态**的，而且 Node 的错误语义一半来自 OpenSSL、一半来自 `src/crypto/crypto_cipher.cc` 的状态机——**只换算法、不复刻状态机**的话，字节对得上、错误对不上。

- **C 侧扩面**：`native/src/wn_openssl.c` 加 `#include <openssl/kdf.h>`；新增密码族 `wn_cipher_info`（回 **5 个 int**：key_length / iv_length / block_size / mode / flags）、`wn_cipher_new|free`、`wn_cipher_set_ivlen|set_data_len|set_key_iv|set_padding`、`wn_cipher_aad`、`wn_cipher_set_tag|set_tag_len|get_tag`、`wn_cipher_update|final`，以及 `wn_pbkdf2`/`wn_hkdf`/`wn_scrypt`。**错误分类不嗅探英文**：`wn_capture_error()` 记下 `ERR_error_string_n` 原文 + `ERR_GET_LIB` + `ERR_reason_error_string`，并用 `EVP_R_*` 宏做粗分类（`wn_openssl_error_kind()`），另加 `wn_openssl_clear_error()` 供每次调用前清队列。
- **JS 驱动**：新增 `src/node-runtime/crypto/openssl-cipher.ts`（`OpenSslCipher implements SyncCipher`）。它把 `CipherBase::Update` / `CipherBase::Final` 的**决策**照搬过来——一次性模式集（`ccm-decipher`/`siv`/`cts`/`xts`/`wrap`）、CCM/SIV 的**认证失败延后到 `final()`**、以及各分支该报哪条错。`crypto/cipher.ts` 的 `createCipher()` 在 `opensslReady()` 且名字解析得到时优先走它，否则**原地回退纯 JS**。
- **三个反直觉的 Node 语义（都靠真 Node 实测敲定，不是猜）**：
  1. **`update()` 永远不会抛出 OpenSSL 错误**。`CipherBase::Update` 在自己内部开了一个 `MarkPopErrorOnReturn`，它析构时 `ERR_pop_to_mark()` 会**把这次新增的错误全部弹掉**，于是外层 lambda 的 `peekError()` 是 0 → 一律落回 Node 自己的文案 `Trying to add data in unsupported state`（无 `code`）。**只有 `final()` 会把 OSSL 错误报出来**（如 CBC 填充错误 `ERR_OSSL_BAD_DECRYPT`、块长不对 `ERR_OSSL_WRONG_FINAL_BLOCK_LENGTH`）。首版驱动在 update 路径上抛了 OSSL 错误 → wrap 那组差分立刻红；改对后转绿。
  2. **`ERR_OSSL_*` 的码由「库名 + reason 字串」拼**（`crypto_util.cc` 的 `error::Decorate`），映射表是 **Node 自己的库名清单**——里面**没有 `PROV`**，而密码错误大多由 provider 抛（`ERR_LIB_PROV`=57）→ 库名片段为空 → `PROV_R_BAD_DECRYPT` 变成 `ERR_OSSL_BAD_DECRYPT`（不是 `ERR_OSSL_PROV_...`）。`SSL` 是唯一去掉 `OSSL_` 前缀的库。
  3. **`setAuthTag` 不是幂等的**：Node 第二次调用因 `auth_tag_state_ != kAuthTagUnknown` 返回 false → 抛 `ERR_CRYPTO_INVALID_STATE('setAuthTag')`；SIV/GCM-SIV 在其一次性 `update` 之后也一律拒绝（差分抓出这一条：`sivErr.setTagAfterUpdate`）。
- **GCM 的两个真坑**：① `EVP_CIPHER_get_mode` 是 `EVP_CIPH_GCM_MODE`（枚举值 6），**不是** flags 的 `EVP_CIPH_FLAG_AEAD_CIPHER`（0x200000）——首版拿 `mode` 去 `&` AEAD 位，`6 & 0x200000 = 0`，于是把 GCM 当成非 AEAD、`setAAD` 直接 `Invalid state for operation setAAD`；`wn_cipher_info` 因此回 **5 元组**（多带 `EVP_CIPHER_get_flags`），绑定的 handle 同时暴露 `mode` 与 `flags`。② **`update()` 要往输出缓冲多留一个块**（`EVP_EncryptUpdate` 内部按 `inl + block_size` 算容量），驱动按 `in_length + block_size + 16` 分配。
- **KDF**：`crypto/hash.ts` 的 `pbkdf2`/`hkdf`/`scrypt` 在模块就绪时走 `wn_pbkdf2`/`wn_hkdf`/`wn_scrypt`，否则回退纯 JS（`scrypt` 的**参数校验**仍留在 JS——那是 Node 自己的 `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`，与 OpenSSL 无关）。
- **验收**：新增差分门禁 `test/crypto-openssl-engine.test.ts`（7 例）——用新加的 `setOpensslEnabled()`（**仅测试用**，同一进程内切换引擎）对**同一组操作跑两遍**（wasm vs 纯 JS vs `node:crypto`）逐字节比对：模式覆盖 ecb/cbc/ctr/cfb/cfb8/ofb/gcm/chacha20-poly1305/des-ede3-cbc/camellia/aria/sm4/cbc-cts，另有「名字解析表」与「AEAD 失败文案两引擎一致」；KDF 则对 PBKDF2/HKDF/scrypt 各参数组三方对齐。`tsc --noEmit` 净 · `vitest run` **1028 passed / 2 skipped（123 文件）** · build（`wn_openssl-CPoAr2TG.wasm` **2298.46 kB** 独立资产、`runtime.worker-BwuTHExX.js` **702.62 kB**）。
- **顺带**：`plugins/node-builtins.d.ts` 补上 `createCipheriv`/`createDecipheriv`/`pbkdf2Sync`/`hkdfSync`/`scryptSync` 的声明（测试直接拿宿主 `node:crypto` 当 oracle）；清理一次性探针 `test/_openssl-probe.test.ts`。
- **剩余（后续增量）**：非对称（RSA/EC/DH/ML-KEM）、X509/SPKAC、argon2 仍在纯 JS。

---

### 2026-09-23 · M101 — `zlib/iter`（可迭代压缩）：vendor 真 `internal/streams/iter/transform.js` + `lib/zlib/iter.js`（阶段 H P1+）

**里程碑**：把 Node 新的可迭代压缩 API `zlib/iter` 在页内跑起来。它是 `lib/zlib/iter.js` 一层薄壳，底下是 `lib/internal/streams/iter/transform.js`——后者**裸调 `internalBinding('zlib')` 造 handle**（`new binding.Zlib(mode)`），再逐次 `write`/`writeSync` 驱动，从**调用方拥有的 `Uint32Array(2)`** 读回 `[availOut, availIn]` 并据此循环（`availOut === 0` 就再下发一次）。这就是 `src/node_zlib.cc` 的 `CompressionStream` 原生表面——M116 的 wasm zlib 就绪后它才可能被 vendor。

- **两个文件原样 vendor**（MANIFEST 161 → 163，零 patch）：`internal/streams/iter/transform.js`、`zlib/iter.js`（别名 `node:zlib/iter`）。
- **绑定补上 raw handle ABI**：`bindings/zlib.ts` 新增 `RawHandle` 基类与五个子类（`ZlibStreamHandle` / `makeBrotliHandleCtor` / `makeZstdHandleCtor`），暴露在**原生键名**下（`Zlib`/`BrotliEncoder`/`BrotliDecoder`/`ZstdCompress`/`ZstdDecompress`）。它们把已验证的 codec 包成「一次 `write` ↔ 一次 deflate/inflate」的语义：
  - `init(...)` 记下 `writeState` 与 `processCallback`（惰性建 codec）；`write` 是异步的（wasm 同步算完，回调走微任务，等价于 Node 的线程池完成），`writeSync` 同步；每次写完把 `writeState[0]=剩余输出空间`、`writeState[1]=剩余输入` 写回。
  - 失败经 `onerror(message, errno, code)` 报出且**不**调回调（与 C++ `EmitError` 一致）；`close` 在写进行中则推迟到回调之后；`reset` 在写进行中报错。
  - 高层 codec 改挂 **`*Codec`** 键（`ZlibCodec`/`BrotliEncoderCodec`/…），我们手写的 `builtins/zlib.ts` 改用之。
- **常量表归一**：把 `builtins/zlib.ts` 里那张 **170 项** 的 zlib/brotli/zstd 常量表抽成 `src/node-runtime/zlib-constants.ts`，`internalBinding('constants').zlib` 从**空 `{}`** 改为它——vendored `transform.js` 会读它取 `DEFLATE`/`GZIP`/`Z_BUF_ERROR`/`BROTLI_PARAM_*`/`ZSTD_c_*`，此前会全得 `undefined`。
- **解锁**：`require('zlib/iter')` 的 16 个变换（`compressGzip`/`compressDeflate`/`compressBrotli`/`compressZstd` 与 `decompress*` 及全部 `*Sync`），可经 `stream/iter` 的 `pull`/`pullSync` 组合；`chunkSize`/`level`/`windowBits`/`params`/`pledgedSrcSize` 全部生效。
- **验收**：新差分装置 `tools/zlib-iter-probe.cjs`（oracle `tools/zlib-iter-oracle.mjs`——真 Node 需 `--experimental-stream-iter` → `test/fixtures/zlib-iter.json`）真 Node v26.9.0 vs web-node **逐字段 0 diff**（同步/异步往返、压缩字节、`chunkSize` 不变性、参数矩阵、错误形状、链式 `pull`、大输入）；门禁 `test/zlib-iter.test.ts`（2 例）。`tsc --noEmit` 净 · `vitest run` **1021 passed / 2 skipped（122 文件）** · build（worker **695.82 kB**；wasm 资产不变）。
- **一处观察**：iter 变换的 deflate 输出**与 `chunkSize` 无关**（小/默认/大缓冲逐字节相同）——探针把它锁住；这正是「一次 write ↔ 一次 deflate」的语义，与 `lib/zlib.js` 的进程内循环等价。

---

### 2026-09-23 · M119（首个增量）—— OpenSSL 子集编 wasm，摘要路径切到它（阶段 H P4）

**里程碑**：把「热点 binding → wasm」里的 crypto 部分落地。先把最高风险的一步做了——**确认 OpenSSL 能编 wasm**，再交付第一个可用增量（摘要/HMAC）。

- **可行性（退险）**：OPENSSL **3.5.8**（来自 `~/Downloads/node/deps/openssl/openssl`）用 wasi-sdk 编出 `libcrypto.a` **5.75 MB** / `libssl.a` 0.85 MB，**0 error**；链接出薄模块 `wn_openssl.wasm` **2.29 MB**，SHA-256/MD5/HMAC-SHA256 与真 Node **逐字节一致**。OpenSSL 本身没有 WASI target，所以新增自包含 target `native/openssl/99-wasi.conf`：`bn_ops=SIXTY_FOUR_BIT_LONG`、`thread_scheme=(none)`、`dso_scheme=undef`、`disable=[asm async engine dso shared threads sock ui-console legacy module tests apps docs secure-memory]`。
- **构建集成**：`native/build.mjs` 新增 `wn_openssl`。它不是一个源文件清单，而是跑 OpenSSL 自己的 `Configure` + `make -j build_libs`，在 `native/.openssl-build`（gitignore）里干活并缓存（marker 文件），然后把该目录里的 `libcrypto.a` 与 `native/src/wn_openssl.c` 链在一起。
- **三个真坑（已写档在 `99-wasi.conf` 的注释里）**：① **必须 `no-secure-memory`** —— 否则 `crypto/mem_sec.c` 要 `mmap/mprotect/mlock/PROT_NONE`，WASI 没有；② **自定义 target 里不能写 `obj_extension => ".o"`** —— OpenSSL 由 `depext = $target{obj_extension} || '.d'` 推导**依赖文件**后缀，写了它就变成 `-MMD -MF x.o.tmp` + `cmp`/`mv`，**用依赖清单覆盖每一个 `.o`**（表现为 `libcrypto.a` 只有 1.2 MB、wasm-ld 报 “neither Wasm object file nor LLVM bitcode”；`file <obj>` 是 ASCII text 就是它）；③ **`getpid` WASI 没有** —— `threads_none.o`/`rand_unix.o` 会引用它，给个 `int getpid(void){return 1;}` 桩即可（OpenSSL 只拿它做 DRBG fork 检测）。
- **ABI**：`native/src/wn_openssl.c` 走**通用名**接口（`EVP_MD_fetch` 按名字取），所以 C 表面很小：`wn_openssl_version` / `wn_digest(_size|_xof)` / `wn_digest_new|update|final(|_xof)|copy|free` / `wn_hmac(_new|update|final|free)` / `wn_openssl_last_error`。句柄就是 wasm32 指针，JS 视为不透明。
- **JS 接入**：新增 `src/node-runtime/bindings/openssl.ts`（薄封装 + 能力探测）与 `src/node-runtime/wasm/lazy.ts`（**惰性**模块表）。**`wn_openssl` 刻意不进启动期 `WASM_MODULES`**：2.29 MB 会在启动时白等，直接炋掉 M107 的成果；改成 `wasmReady` 落了之后后台 `loadWasmModule('wn_openssl')`，失败也吞掉（只是性能回退，不是正确性问题）。`crypto/hash.ts` 在模块就绪后把 `md5/sha1/sha2/sha3/keccak/blake2b-512/blake2s-256/sm3/ripemd160/md5-sha1/shake128/256` 的摘要实现换成 OpenSSL（HMAC 建在摘要上，一并受益），**未就绪、名字取不到、或大小不符则原地回退纯 JS** —— 两边逐字节相同，对调用者不可见。新增 `hashEngine()` 供测试/诊断看当前走哪个引擎。
- **WASI 宿主补齐**：`wasm/wasi.ts` 补 `fd_fdstat_set_flags`（→`ENOTSUP`）、`fd_read`/`fd_readdir`（→`EBADF`）、`fd_filestat_get`、`path_open`/`path_filestat_get`（→`ENOENT`）的诚实桩（OpenSSL 只在试图读配置文件/目录时才会走到，正常加密路径不触发）。
- **验收**：新增 `test/openssl.test.ts`（8 条：版本号与宿主一致、大小表、输入长度矩阵逐字节摘要、XOF 任意长、HMAC 多密钥、未知算法必须返回 `null` 而不是错值、引擎确实切到 openssl 且字节不变、`getHashes()` 全表仍能跑）；`tsc --noEmit` 净 · `vitest run` **1019 passed / 2 skipped（121 文件）** · build（`wn_openssl-BcuQYucn.wasm` 2294.89 kB **独立资产**、`runtime.worker-D87_McF5.js` 693.10 kB）。
- **剩余（后续增量）**：cipher（AES/ChaCha/DES/Camellia/ARIA/SM4/OCB/SIV/XTS/CCM/CBC-CTS）、KDF（pbkdf2/hkdf/scrypt/argon2）、非对称（RSA/EC/DH/ML-KEM）、X509/SPKAC 仍在纯 JS。

---

### 2026-09-23 · M118 — `brotli` / `zstd` 换成**真 `deps/brotli` / `deps/zstd` 编 wasm**（阶段 H P3）

**里程碑**：把 `zlib` 的 brotli/zstd 半边从「响亮抛错」换成**真上游 C 编出的 wasm**（`deps/brotli` 1.2.0、`deps/zstd` 1.5.7），于是 `brotliCompress(Sync)`/`zstdCompress(Sync)` 与其解码器、四个流类、全部 `BROTLI_PARAM_*`/`ZSTD_c_*`/`ZSTD_d_*` 参数、字典、`pledgedSrcSize`，乃至 `stream/web` 的 `CompressionStream('brotli')` 全部解锁。设计见 `docs/superpowers/specs/2026-09-23-native-to-wasm-design.md`。

- **真上游 C → wasm**：`native/build.mjs` 新增 `wn_brotli`（36 个 `.c`：common + dec + enc，清单照抄 `deps/brotli/brotli.gyp`）与 `wn_zstd`（27 个 `.c`，照抄 `deps/zstd/zstd.gyp`）。两者都是纯 C（`clang`，非 `clang++`）。**`wn_zstd` 故意不开 `ZSTD_MULTITHREAD`**（wasm32-wasip1 没有线程；多线程压缩本来就是可选的，Node 的绑定也不暴露它），`-DZSTD_DISABLE_ASM` 与 `-DXXH_NAMESPACE=ZSTD_` 与 Node 一致。产物 `wn_brotli.wasm` **847.4 KB**（只导入 `proc_exit`）、`wn_zstd.wasm` **484.0 KB**（零导入）。
- **薄封装**：`native/src/wn_brotli.c`（照搬 `src/node_zlib.cc` 的 `BrotliEncoderContext`/`BrotliDecoderContext`：写入前后偏移、参数设置、字典装载时机、`Z_BUF_ERROR` 兜底、错误码/文案）与 `native/src/wn_zstd.c`（`ZstdCompressContext`/`ZstdDecompressContext`，含 **pledged src size 的消耗量核对** → `ZSTD_error_srcSize_wrong`、解码侧 `frame_complete_`、`ZstdStrerror` 的全张码名表）。ABI 与 wn_zlib 一致；变长输入/输出走 `wn_alloc`/`wn_dealloc` 的 wasm 内存缓冲。
- **JS 层**：`bindings/zlib.ts` 新增 `BrotliCodec`/`ZstdCodec`（与 `ZlibCodec` 同形的 `push(chunk, flush)`）；**每个 codec 用自己的 wasm 模块**（`ex('wn_brotli')` / `ex('wn_zstd')`，各自的 `memory()` 与 `readCString`）——否则会去 `wn_zlib` 里找不存在的导出。`builtins/zlib.ts` 新增 `BrotliCompress`/`BrotliDecompress`/`ZstdCompress`/`ZstdDecompress` 四个类与 `brotliCompress(Sync)`/`brotliDecompress(Sync)`/`zstdCompress(Sync)`/`zstdDecompress(Sync)`/`createBrotli*`/`createZstd*`；`collectParams`/字典装载（zstd 对非法字典静默忽略，与 Node 一致）/错误码逐条对齐 `lib/zlib.js`。`wasm/index.ts` 登记 `wn_brotli`/`wn_zstd` 两个资产（走 `?url`，按内容哈希发到 `assets/`，不内联进 worker）。
- **解锁**：`brotliCompressSync`/`brotliDecompressSync`/`zstdCompressSync`/`zstdDecompressSync`、四个 `Transform` 流类、全部参数（quality/mode/lgwin/…、compressionLevel/checksumFlag/windowLog/strategy/…）、预设字典、`pledgedSrcSize`，以及 `stream/web` 的 `CompressionStream`/`DecompressionStream('brotli')`；**仅 zip 存档助手仍响亮抛错**。
- **验收**：差分装置 `tools/zlib-probe.cjs` 扩出 brotli/zstd 观测块（真 Node oracle → `test/fixtures/zlib.json`，**56 个观测键**），真 Node v26.9.0 vs web-node **逐字段 0 diff**（含参数矩阵、字典、`file://` 流式与异步、错误形状）；`tsc --noEmit` 净 · `vitest run` **1011 passed / 2 skipped（120 文件）** · build（`wn_brotli-Bawm2DuK.wasm` 847.42 kB、`wn_zstd-B6qdSrAh.wasm` 484.03 kB、`runtime.worker-3ryhQ9rh.js` **689.29 kB**）。
- **两处无意偏离（都是与 Node 一致的观察结果，不是缺陷）**：① `zstd` 的**流式**输出与**一次性**输出不同（`zstdStream` 长度 72 vs `64`）——因为流式先以 `ZSTD_e_continue` 写、再以 `ZSTD_e_end` 收尾，帧头不带 content size；真 Node 也如此（探针把它当作 oracle 锁住）。② brotli 解压错误码形如 `ERR__ERROR_FORMAT_PADDING_2`（Node 在 brotli 自带的 `_ERROR_*` 名前面再拼一个 `ERR_`）。
- **顺带**：修了 `test/stub-fidelity.test.ts`（Brotli/Zstd 不再是抛错桩）与 `test/webstreams.test.ts`（`CompressionStream('brotli')` 现在可用，改为验一个非法格式仍被 enum 拒），以及 `vendored-builtins.ts` 里「只有 brotli 格式抛错」的注释。另：`test/histogram.test.ts` 的 ELD 用例有一个断言 `h.min >= resolution` 过定——web-node 的 ELD 用 **JS 定时器**（Node 用 libuv 定时器，从不提前触发），`min` 会略低于 `resolution`（实测 ~4.6ms/5ms），本属 M117 已写档的「环境相关偏离」，改为锁契约（`min > 0`）。

---

### 2026-09-23 · 路线图重规划——按 native→WASM 主线重排阶段（文档，无代码）

**背景**：确认走 **native → WASM**（真上游 C/C++ 编 wasm，阶段 H）后，路线图里原先按「JS 重写 native」排的**阶段 C/E/F/G** 出现三类错位：① 已由阶段 H 完成的（M99→M116、M100→M117）；② 已被阶段 H 吸收的（M106→M119/M120、M114→M120、M108/M111→M121）；③ 仅被 wasm 解锁、仍独立的（M101、M107、M109/M110/M112、M113）。结果就是同一个里程碑在两处重复计数、进度表自相矛盾（M99/M100 早已完成却仍计「剩余」）。

**本次改动**（`docs/ROADMAP.md` 重组 + `docs/superpowers/specs/2026-09-23-native-to-wasm-design.md` §4 对齐；**未动任何已完成条目的措辞/勾选**）：

- 新增「**阶段重规划说明**」：把三类错位逐条列清并给出处置。
- 新增图例 **`[⤳]`（已并入其他里程碑，保留条目、不单独计数）**；M106/M108/M111/M114 改标 `[⤳]`（注明并入对象）。
- **结清**：M99/M100 就地打 `[x]`（「经阶段 H 的 M116/M117 完成」）。
- **阶段 C 解散**（M99/M100 结清、M101 移入阶段 H）；**阶段 E 收敛为「启动与加载性能」**（只剩 M107）；**阶段 G 收敛为「预览与路由」**（只剩 M113）。
- **物理重排**：主线 **阶段 H** 提前，其后是剩余支线 **E/F/G**，最后是**已归档阶段 A/B/C/D** 与「已判定不做 / 已完成总览 / 怎么用」。
- **进度表重算**（按**叶子任务**，父项如 M90/M92/M93/M93.4/M97 不计）：M88 起共 **50** 项（+1 不做）→ 已完成 **40**、剩余 **10**（H 8/3/5 · E 1/0/1 · F 3/0/3 · G 1/0/1 · A 26/26 · B 5/5 · C 2/2 · D 4/4）。联动更新整体已完成数 123 → **127**（87 + 40）。

**涉及文件**：`docs/ROADMAP.md`、`docs/superpowers/specs/2026-09-23-native-to-wasm-design.md`。（M118 brotli/zstd 的在途改动**未提交**，见 `git status`。）

---

### 2026-09-23 · M117 — `perf_hooks` 直方图换成**真 `deps/histogram` 编 wasm**（阶段 H P2）

**里程碑**：把 `perf_hooks` 的直方图从 M35 时代的「load-only shim（一用即抛）」换成 **真 HdrHistogram**（`deps/histogram`，官方 C 实现）编出的 wasm，于是 `createHistogram`/`importHistogram`/`monitorEventLoopDelay`/`timerify({histogram})` 与 `Histogram`/`RecordableHistogram` 全量方法解锁。设计见 `docs/superpowers/specs/2026-09-23-native-to-wasm-design.md`。

- **真上游 C → wasm**：`native/build.mjs` 新增 `wn_histogram`（**首次上 C++**：`-std=c++20 -fno-exceptions -fno-rtti`，用 wasi-sdk 的 `clang++` + libc++）——编译 `deps/histogram/src/hdr_histogram.c` + `native/src/wn_histogram.cc`。后者**逐行移植 `src/histogram.cc` / `histogram-inl.h` 的算法**：标量统计（mean/stddev/skewness/kurtosis）、两样本检验（KS / Welch / Mann-Whitney / Cohen's d / Cliff's δ）、均值 CI 与分位 CI、EWMA 与 SLO 错误率、CBOR 导出/导入（稀疏 delta 编码）、linear/log/percentile 迭代，只把 V8/Node 胶水换成给 JS 的 C ABI（句柄 + scratch 缓冲）。产物 **257.7 KB**（libc++ 静态构造）。
- **新增最小 WASI 宿主** `src/node-runtime/wasm/wasi.ts`：C++/stdio 模块会带 `clock_time_get`/`random_get`/`fd_write`/`fd_seek`/`fd_close` 等导入，`loader.instantiateWasm` 现在默认把它们接到这个宿主上（时钟→`performance.now()`、随机→`crypto.getRandomValues`、写 fd 默认丢弃且仅 `debug` 时打控制台）；调用方传入的 `imports` 优先。`wn_zlib` 无 imports，不受影响。
- **JS 层**：`bindings/histogram.ts`（薄封装，把 C ABI 包成与 `internalBinding('performance').Histogram` **可观测等价**的 JS 类，接进 `performanceBinding` 的 `Histogram`/`createELDHistogram`）；**vendor 真 `lib/internal/histogram.js`**（vendored 树 160→161 文件，零 patch）；删掉 `internal/histogram` 的旧 shim。ELD 直方图用 **unref 过的** `timers` 定时器 / `setImmediate` 驱动（与 Node 一样不吊住事件循环）。
- **验收**：新差分装置 `tools/histogram-probe.cjs`（oracle `tools/histogram-oracle.mjs` → `test/fixtures/histogram.json`）真 Node v26.9.0 vs web-node **逐字段 0 diff**；`tsc` 净 · `vitest run` **1007 passed / 2 skipped（120 文件）** · build（`wn_histogram-BIhNpcFt.wasm` 257.74 kB、`runtime.worker-Cna1pydo.js` 679.75 kB）· 部署后线上资产全 200。
- **两个有意偏离（已写档）**：① **EWMA 方差的 1 ULP**——递推 `v + α·d·d` 在 arm64 宿主被编译成 **FMA**，wasm 无 FMA 指令，最后一次加法差 1 ULP（体现在 EWMA 导出 CBOR 的 `float64` 最后 1 字节）；同理 libm 的 `erfc`/`lgamma`/`exp`/`log` 也差 1 ULP。探针对**统计量**取 10 位有效数字，对 EWMA 导出只比**非 EWMA 段的字节**（framing/计数逐字节相等）。② `monitorEventLoopDelay` 的**绝对延迟值**天然依赖环境，故只锁契约与量级。

---
### 2026-09-23 · M116 — `zlib` 换成**真 `deps/zlib` 编 wasm**（阶段 H P1）

**里程碑**：把 `internalBinding('zlib')` 背后从「平台 `CompressionStream` 适配」（M45/M99）换成 **Node 自己那份 C zlib 编出的 wasm**，于是同步 API 与全部编码参数解锁。设计见 `docs/superpowers/specs/2026-09-23-native-to-wasm-design.md`。

- **真上游 C → wasm**：`npm run build:native` 把 `deps/zlib` 的 11 个 `.c`（+ `native/src/wn_zlib.c` 薄包装）编成 106.2 KB、零 imports 的模块（`-DDYNAMIC_CRC_TABLE` 免掉 591KB `crc32.h`、`-DZLIB_CONST`、`-DOS_CODE=3`）。C 侧 ABI：`wn_zlib_new/write/reset/set_params/set_reject_garbage/ensure` + 入/出缓冲区指针。
- **JS 层**：`bindings/zlib.ts`（`ZlibCodec`：mode→windowBits、字典装载时机、`Z_NEED_DICT` 重试、gzip 多成员，逐条对齐 `src/node_zlib.cc`）+ `builtins/zlib.ts`（**`lib/zlib.js` 的 zlib 半边逐条移植**：`ZlibBase`/`Zlib`/`processChunk(Sync)`/`_processChunk`/便利方法/`flush`/`params`/`crc32`，brotli/zstd/zip 仍响亮抛错）。`zlib.constants` 补到 Node 全量 **170** 项。
- **修的真 gap**：`internal/errors` 补 `ERR_TRAILING_JUNK_AFTER_STREAM_END`（`TypeError` 基底）。
- **验收**：新差分装置 `tools/zlib-probe.cjs`（oracle `tools/zlib-oracle.mjs` → `test/fixtures/zlib.json`）真 Node v26.9.0 vs web-node **逐字段 0 diff**；`tsc` 净 · `vitest run` **998 passed / 2 skipped（119 文件）** · build（`wn_zlib-ElRqH9jS.wasm` 108.78 kB、`runtime.worker-xzjeutnS.js` 674.09 kB）· 部署后线上资产全 200。
- **三个真 bug（已修）**：① `wn_init_stream()` 在已初始化时返回 `h->err`（上次的返回码）→ `Z_STREAM_END` 之后的调用被当成初始化失败而跳过写入，`avail_out` 陈旧 → 上一次的输出被**重复 push**（异步 `gunzip` 出 2× 数据）；② `ZlibBase.prototype._final` 忘了 `callback()` → writable 永不 finish（流不结束）；③ `DeflateRaw({windowBits:8})` 要按 Node 抬到 9。
- **有意偏离（已写档）**：① gzip 头 OS 字节固定用 zlib 默认 `0x03`（真 Node 在 macOS 写 `0x13`；wasm 无 OS 身份），探针把这一字节归一并有定点测试；② 未字面 vendor `lib/zlib.js`（它顶层 `require('internal/zip')`，14 文件/4271 行），以移植达到可观测等价。

---
### 2026-09-23 · M115 — wasm 工具链 + `internalBinding()` 接入缝（阶段 H 开工）

**里程碑**：native → WASM 迁移的 P0（设计见 `docs/superpowers/specs/2026-09-23-native-to-wasm-design.md`）。目标是把 `internalBinding()` 背后那层从「JS 重写」换成「真上游 C/C++ 编 wasm」；本步先把**工具链与接入缝**打通。

- **工具链**：wasi-sdk 34.0（`~/wasi-sdk-34.0`）→ `native/build.mjs`（`npm run build:native`），产物到 `src/node-runtime/wasm/artifacts/`（提交 + `manifest.json` 记工具链版本/sha256）。
- **桩模块** `native/src/wn_stub.c`：导出函数 + 线性内存 + `malloc`/`free`；`__attribute__((export_name(...)))` 精确导出。
- **加载器** `src/node-runtime/wasm/{loader,registry,index}.ts`：同步编译 + reactor `_initialize`；资产走 `?url` 按内容哈希发出（不内联 worker）。
- **接入缝**：`REGISTRY` 加 `wn_stub`；worker 启动期 `wasmReady` 与 `vendoredSourcesReady` 并列 await；`ready` 信息加 `wasmModules`，UI 显示。
- **验收**：`tsc` 净 · `vitest run` **997 passed / 2 skipped（119 文件）** · build（`wn_stub-Kli7lsuY.wasm` 46.48 kB、`runtime.worker` **666.38 kB**）· 部署后线上资产全 **200** · **真实浏览器端到端**：线上站点报告 `native→wasm modules: wn_stub`、`40 bindings · 1 wasm modules`。
- **两个坑**：① `--target=wasm32-wasip1`（`wasm32-wasi` 已弃用且 sysroot 查错目录）；② `--export-dynamic` 对非 PIE 可执行模块不导出符号，用 `export_name` 属性。
- **运行环境**：`npx vitest` 必须用 **Node v26.9.0**（vendored 源用 `using` 声明，v22 编译不过）。

---

### 2026-09-23 · 架构重定向：native → WASM（对齐 WebContainer，阶段 H）

**决策**：native 层从「JS 重写 / 平台 API 适配」转向「**真上游 C/C++ 编 wasm**」——目标 **B2（native 层全 WASM 化）+ 验收 B1（页内跑通 webpack/rspack + 差分 0 diff）**，技术路线 **甲（wasi-sdk 编真上游 C/C++；syscall 层不编 libuv，改用 SAB + `Atomics.wait` + FS-worker）**。

- **设计文档**：`docs/superpowers/specs/2026-09-23-native-to-wasm-design.md`（接入缝 = `REGISTRY`；产物 = 带内容哈希的独立资产 + 惰性实例化；纯 C ABI，不引 Rust/wasm-bindgen）。
- **阶段 H（M115–M121）**：P0 工具链/接入缝 → P1 `zlib`（取代 M99）→ P2 `histogram`（取代 M100）→ P3 `brotli`/`zstd` → P4 `crypto`（OpenSSL 子集，承接 M106）→ P5 同步 syscall（吸收 M114）→ P6 北极星（汇合 M108/M111）。
- **资产盘点**（写入 ROADMAP）：既有 ~120 个里程碑**不白做**——① 地基（Realm/loader/`REGISTRY`/VFS/虚拟 TCP+npm/UI + 全部 vendored 真 `lib/` 源）与 native 层正交，**原样保留**；② `tools/*-probe.cjs` + `test/fixtures/*.json` 差分装置**直接作为 wasm 的验收闸门**（最值钱）；③ 被取代的纯 JS native 实现**不删**，留作兜底/语义参照；④ DEVLOG/MEMORY 里的语义坑全部留用。
- **本机前置**：现无任何 wasm 编译链（无 emcc / wasi-sdk / wasm-ld / llvm / wabt；Apple clang 无 wasm backend）→ M115 首步装 wasi-sdk。
- **风险**：OpenSSL→wasm 最重（5063 文件 / 246M）；体积需独立资产 + 惰性加载；wasi 整数/浮点边角行为需逐项验；P5 需线上 COOP/COEP。

**性质**：规划/文档变更，无代码改动（未动实现）。

---

### 2026-09-23 · M93.4h AES-GCM-SIV、ARIA CCM/GCM、SM4 CCM/GCM/XTS（cipher 全表 165 对齐）

补齐最后 12 个模式名，`getCiphers()` **153 → 165**，与真 Node v26.9.0 **逐名 0 缺 0 余**（crypto 对称密码全表收官）。

- 新增 `src/node-runtime/crypto/gcm-siv.ts`：按 OpenSSL `cipher_aes_gcm_siv{,_polyval,_hw}.c` 实现 **RFC 8452 AES-GCM-SIV**。先从 nonce 用 AES-ECB 派生每消息密钥（`msg_auth_key` = `E(K,LE32(0)‖N)[0..8] ‖ E(K,LE32(1)‖N)[0..8]`，`msg_enc_key` 从 counter 2 起每 8 字节一丰）；POLYVAL 通过 GHASH 在**字节反转**操作数上算（key 字节反转后乘 x，每块输入也反转、输出再反转）；tag 再经 AES-ECB 并置 `counter[15] |= 0x80`，CTR32（前 4 字节**小端**计数器）出密文。**解密先跑 CTR，再对恢复出的明文重算 tag**。
- `ccm.ts`：`AesCcm` 改为接受任意块密码（新增 `CcmBlockCipher` 接口 + 构造末参 `block?`）；`xts.ts`：`AesXts` 改为接受块密码构造器、可选 tweak 加倍函数与是否查重键。
- 新增名称：`aes-{128,192,256}-gcm-siv`、`aria-{128,192,256}-ccm`、`aria-{128,192,256}-gcm`、`sm4-ccm`/`sm4-gcm`/`sm4-xts`（12）。

**关键坑 1（SM4-XTS ≠ AES-XTS）**：SM4-XTS 用 OpenSSL 的 **GB 变体**（`crypto/modes/xts128gb.c`，经 `cipher_sm4_xts.c` 调用）——tweak 加倍是**大端右移**、反馈常量 `0xe1` 进**最高字节**；AES-XTS 才是 IEEE 1619（小端左移、`0x87` 进最低字节）。症状：**单块对、多块从第二块起全错、且回环仍 OK**（自洽但与 OpenSSL 不符，很容易漏）。故 `xts.ts` 导出 `gbTweakDbl` 并让 sm4 分支传入。另：SM4-XTS **不做**重键检查（AES-XTS 才查）。

**关键坑 2（GCM-SIV one-shot 与 CTS/XTS 不同）**：三者的 `Final()` 在无先导 `update()` 时都报错，但消息不同——GCM-SIV 是 **AEAD**，Node `CipherBase::Final` 的 `isGcmSivMode` 返回 “Unsupported state or unable to authenticate data”；CTS/XTS 是 “Unsupported state”。另 `final()` 二次 → `ERR_CRYPTO_INVALID_STATE`/“Invalid state”；`getAuthTag()` 在 final 前 → “Invalid state for operation getAuthTag”；`setAuthTag` 非 16 字节 → `ERR_CRYPTO_INVALID_AUTH_TAG`/“Invalid authentication tag length: N”。

**差分**：`tools/crypto-gcm-siv-aead-probe.cjs` → `test/fixtures/crypto-gcm-siv-aead.json`（12 名称 info；GCM-SIV 多长度加解密+回环；ARIA/SM4 CCM/GCM 回环；SM4-XTS 5 种长度；GCM-SIV/CCM/XTS 全套错误面）——**0 diff**；`test/crypto-gcm-siv-aead.test.ts`。

**连带修正**：`test/cipher.test.ts`（原以 `aes-128-gcm-siv` 当“未实现”示例 → 改为断言 `getCiphers().length === 165`）、`test/crypto.test.ts`（移除该例）、`test/crypto-mac.test.ts`（注释更新；aria-ccm 的 CMAC 仍报 invalid mode，与真 Node 一致）。

**门禁**：`tsc --noEmit` 干净 · `vitest run` **993 通过 / 2 skip（118 files）** · `vite build` 绿（worker **664.99KB**）。

---

### 2026-09-23 · M93.4g CBC 密文窃取（NIST CTS）

补齐 AES/Camellia 的 `-cbc-cts`（真 Node 165 项，web-node 153）。

- 新增 `src/node-runtime/crypto/cbc-cts.ts`：按 OpenSSL 的 **NIST CTS**（`crypto/modes/cts128.c` 的 `CRYPTO_nistcts128_encrypt/decrypt`）逐块移植。与 RFC 2040/3962 不同：**允许输入为块大小整数倍**且**不交换最后两块**；末段明文与前一密文块异或后再加密，写回位置**偏移 `residue` 字节**——这个重叠写就是“窃取”。
- 新增 `aes-{128,192,256}-cbc-cts`、`camellia-{128,192,256}-cbc-cts`（6）→ **`getCiphers()` 147 → 153**。

**关键坑**：解密末段重建 C(n-1) 后必须用 **`decryptBlock`**（即 `D(ct_mid)`）而非 `encryptBlock`——加密方向完全匹配、密文逐字节正确，但解密方向会用错；症状是“密文完全对、明文乱掉、且只在 residue≠0 时出现”。

**语义**（与真 Node 一致）：一次性模式——`update` 至少一个块且只允许一次（第二次 → “Trying to add data in unsupported state”）；`update` 一次性吐出全部输出；`final()` 仅关闭（返回空）；无 `update` 先 `final()` → “Unsupported state”；二次 `final()` → `ERR_CRYPTO_INVALID_STATE`/“Invalid state”；`getAuthTag()` → “Invalid state for operation getAuthTag”。`CMAC` 接受 `cbc-cts`（与普通 cbc 同值，已对齐；`selectCipher` 的 cbc 分支容许 `-cbc-cts`）。

**差分**：`tools/crypto-cbc-cts-probe.cjs` → `test/fixtures/crypto-cbc-cts.json`（6 个名称 info；12 种长度含 16/17/18/20/31/32/33/47/48/49/64/1000 的加密+回环；一次性语义；全套错误面）——**0 diff**；`test/crypto-cbc-cts.test.ts`。

**门禁**：`tsc --noEmit` 干净 · `vitest run` **992 通过 / 2 skip（117 files）** · `vite build` 绿（worker **660.39KB**）。

**余缺（M93.4h+，12）**：`aes-*-gcm-siv`、`aria-*-ccm`、`aria-*-gcm`、`sm4-ccm`/`sm4-gcm`/`sm4-xts`。

---

### 2026-09-23 · M93.4f 逆 cipher 密钥包装 + DES3-CBC 包装

补齐 SP 800-38F 的逆-cipher 包装与 CMS 的 3DES 包装（真 Node 165 项，web-node 147）。

- `wrap.ts` 新增**逆 cipher** 支持：`*-wrap-inv`/`*-wrap-pad-inv` 按 SP 800-38F 把 **AES 逆 cipher**（`AES_decrypt`）指定为块函数——加密实例用 `decryptBlock`、解密实例用 `encryptBlock`（与 OpenSSL `cipher_aes_wrp.c` 的 `use_forward_transform = !enc` 一致；实例内只有一个 designated block）。
- 新增 `src/node-runtime/crypto/des3-wrap.ts`：RFC 3217 / CMS `des3-wrap`（canonical `id-smime-alg-cms3deswrap`，nid 246）。固定外层 IV `4adda22c79e82105`；内层随机 IV + SHA-1 ICV；整体 reverse 后再 CBC。**加密非确定**（随机 IV），差分只比**解密**与**回环**。
- 新增名称 14 个：`aes-{128,192,256}-wrap[-pad]-inv` 与 `aes{128,192,256}-wrap[-pad]-inv`（12，无 nid）+ `des3-wrap`/`id-smime-alg-cms3deswrap`（2）→ **`getCiphers()` 133 → 147**。

**关键坑（又一个 Buffer 别名）**：本 runtime 的 `Buffer.prototype.slice` **返回共享内存的视图**，`unwrapRaw` 里 `a = a.slice()` 实际改写了调用者的密文缓冲区。症状：“先解密再用同一密文”时密文被 XOR 掉一串计数器值（`1fa68b0a8112b447` → `...b44b`），且错误只在“解密过一次”之后出现。修正：本模块所有可能来自调用者的 `.slice()` 改为 `new Uint8Array(...)` 显式拷贝。

**语义细节**：`des3-wrap` 用 null/空 IV（非空 IV → `ERR_CRYPTO_INVALID_IV`），空输入 → 空输出，非 8 字节倍数输入 → unsupported state，解密 <24 字节 → unsupported state。

**差分**：`tools/crypto-wrap-inv-des3-probe.cjs` → `test/fixtures/crypto-wrap-inv-des3.json`（12 个 inv 名称 info + 加密/回环/与正向模式差异、des3 的录制密文解密 + 随机回环 + 全套错误面）——**0 diff**；`test/crypto-wrap-inv-des3.test.ts`。

**门禁**：`tsc --noEmit` 干净 · `vitest run` **991 通过 / 2 skip（116 files）** · `vite build` 绿（worker **658.25KB**）。

**余缺（M93.4g+，18）**：`aes-*-cbc-cts`、`aes-*-gcm-siv`、`aria-*-ccm`、`aria-*-gcm`、`camellia-*-cbc-cts`、`sm4-ccm`/`sm4-gcm`/`sm4-xts`。

---

### 2026-09-23 · M93.4e CFB 反馈位宽（cfb1/cfb8）+ SM4 128 位别名

补上 OpenSSL 的 CFB 反馈位宽变体（真 Node `getCiphers()` 165 项，web-node 原先只报已实现的 111 项）。

- 新增 `src/node-runtime/crypto/cfb.ts`：位粒度通用 CFB，按 OpenSSL `crypto/modes/cfb128.c` 的 `cfbr_encrypt_block` 逐位移植。反馈宽度取 1 / 8 / 128 位；每步 `E(R)`、取高 `s` 位异或、`R=(R<<s)|反馈位`。**加密时反馈输出位、解密时反馈输入位**——这个不对称才是可逆性来源。
- AES/ARIA/Camellia 走 `Cipheriv`（16 字节块）；DES 走 `DesCipher`（8 字节块），各自接入 `cfb1`/`cfb8`。
- 新增名称：`aes-{128,192,256}-cfb1/cfb8`、`aria-*-cfb1/cfb8`、`camellia-*-cfb1/cfb8`、`des-ede3-cfb1/cfb8`（20 个）+ `sm4-cfb128`/`sm4-ofb128`（别名，`getCipherInfo` 仍报 `sm4-cfb`/`sm4-ofb`）→ **`getCiphers()` 111 → 133**。

**两个坑（都只在罕至路径显形）**：
1. 位粒度的 keystream 必须**每步从寄存器重新加密**——初版对一块全零缓冲调用 `encryptBlock`（原地加密），得到的是 `E(K,0)` 而非 `E(R)`，首字节就错。
2. `DesEde.encrypt` **返回新数组、不改原数组**，与 AES 的 `encryptBlock`（原地修改）不同；把返回值丢弃会让 DES 的 keystream 永远等于寄存器本身，而且 `cfb1` 与 `cfb8` 会**巧合地输出一致**（因为此时两者都退化成「用寄存器字节当 keystream」）——必须 `b.set(edes.encrypt(b))`。

**差分**：`tools/crypto-cfb-feedback-probe.cjs` → `test/fixtures/crypto-cfb-feedback.json`（22 名称 × 9 种长度（含 0、非整块）× 加解密回环 + 流式分块 + `getCipherInfo` + `getCiphers` 成员）——**0 diff**；`test/crypto-cfb-feedback.test.ts`。

**仍缺**（后续 M93.4f+）：`aes-*-cbc-cts`、`aes-*-gcm-siv`、`aria-*-ccm/gcm`、`sm4-ccm/gcm/xts`、`aes-*-wrap-inv`/`-wrap-pad-inv`、`des3-wrap`/`id-smime-alg-cms3deswrap`。

**门禁**：`tsc --noEmit` 干净 · `vitest run` **990 通过 / 2 skip（115 files）** · `vite build` 绿（worker **655.59KB**）。

---

### 2026-09-23 · M107 载荷拆分（vendored 源出 worker → 预加载资源）

**问题**：worker bundle 2.5MB 里 **93%** 是 vendored Node 源文本（`import.meta.glob(..., { eager: true })` 把 160 个文件以字符串字面量内联）。浏览器必须先下载 + **按 JS 解析/编译** 这 2.3MB，才能跑第一行 runtime 代码。

**改法**：把同一批（已去注释的）源文本改为**一个纯文本资源**，从 `index.html` 预加载，worker `fetch` + `JSON.parse` 后 `installVendored()` 注入。字节差不多，但大载荷与极小的 worker 引导**并行**下载，且**不再产生 JS 解析成本**。

- `plugins/vendored-source.ts`：新增 `collectVendoredSources()` / `vendoredBundleText()` / `vendoredBundlePlugin()`（dev 中间件服务 + build `emitFile` 成 `assets/vendored-sources.txt` + `transformIndexHtml` 插入 `<link rel="preload" as="fetch">`）。文件名固定，URL 带**内容哈希**（`?v=<sha256前12位>`）以破缓存。
- `src/node-runtime/vendored-sources.ts`（真实 eager glob）与 `vendored-sources.stub.ts`（空）：靠 `vite.config.ts` 的 `resolve.alias` 按 `mode` 切换——**test 用真实 glob，其余用 stub**。
- `src/node-runtime/vendored.ts`：不再直接放 glob，新增 `installVendored()` / `vendoredLoaded()`。
- `src/worker/runtime.worker.ts`：模块求值时就发起 `fetch(__VENDORED_URL__)`，`init` 构造 realm 前 `await`（`require` 必须同步）。
- `vite.config.ts`：加 `define: { __VENDORED_URL__ }` 与 alias；`plugins/node-builtins.d.ts` 补 `node:path`/`crypto`/`readdirSync` 类型。
- 门禁 `test/vendored-bundle.test.ts`：断言**发出的 bundle 与 eager glob 文件名、内容逐字节一致**（两者不能静默分叉）。

**实测（本地 preview、冷缓存）**：

| 指标 | 拆分前 | 拆分后 |
| --- | --- | --- |
| worker 原始 | 2510.84 KB | **653.76 KB** |
| worker gzip | ~558 KB | **203 KB** |
| vendored 资源 gzip | （内联在 worker 里） | **347 KB** |
| 合计 gzip | ~558 KB | ~550 KB |
| runtime ready | 110–155 ms | **95–154 ms** |

网络时序（CDP，本地）：`vendored-sources.txt` 预加载在 **543ms** 发起，早于 worker 脚本（**594ms**）→ 确认真并行。

**质量门禁**：`tsc --noEmit` 干净 · `vitest run` **989 通过 / 2 skip（114 files）** · `vite build` 绿。

**结论**：冷启动的网络字节基本不变，但**主 bundle 从 2.5MB 降到 654KB**，JS 解析成本大幅下降，且大载荷预加载并行。后续若仍要降，只能动 2.3MB 文本本身的体积（按需子集/懒加载）或上 V8 code cache。

---

### 2026-09-23 · M107 启动基准（首个增量）

**改了什么**：把冷启动做成**可测**的，并定下热点。

- `src/ui/main.ts` / `src/client/index.ts`：新增只读启动计时 `globalThis.__wnBoot`（`moduleEvalMs`/`workerSpawnMs`/`runtimeReadyMs`/`firstRunMs`，单位 = 距导航开始的毫秒）。
- `tools/e2e-startup-bench.mjs`：CDP 基准工具，可打本地 preview 或线上 Pages，输出逐步耗时与均值。

**实测（本地 preview、禁用缓存、连跑 2 次）**：

| 阶段 | 耗时 |
| --- | --- |
| module eval | 18–51ms |
| worker spawn | 18–51ms |
| **runtime ready** | **110–155ms** |
| 导航→ready（wall） | ≈ 150ms |
| `new NodeRuntime`（建 binding 表 + Realm） | **~10ms** |
| 首次 `require('fs')` | ~2ms |

**结论**：启动已经很快；耗时几乎全在 **worker 脚本（2.5MB）的 fetch + compile**，而不是 JS 侧初始化（binding 表 + Realm 才 10ms）。下一步若要继续降，要么动 2.5MB 载荷（vendored 源拆分/懒解析——但 `require` 必须同步，纯懒加载会把源重新拉回关键路径，需先 spike），要么上 V8 code cache / 快照。

**质量门禁**：`tsc --noEmit` 干净 · `vitest run` **986 通过 / 2 skip** · `vite build` 绿（worker **2510.84KB**）。

---

### 2026-09-23 · 阶段 D 收尾（M102–M105）

**改了什么**（四个都是「用真 Node 差分验证」的小项）：

- **M102 `net.BoundSocket`**：不再整体抛错。无 OS 句柄，于是把它映射到 web-node 的**虚拟 TCP 层**——构造即 `network.listen(port)` 占住端口（冲突同步抛 `EADDRINUSE`），`address()` 返回虚拟地址、`close()` 释放、`isPipe`/`[Symbol.dispose]` 齐全。`fd()` 返回 **-1**（Node 在无 fd 的平台上也是如此，属**已知偏离**）；`{ path }`（unix-domain/pipe）无虚拟对应物，**响亮抛**。
  - 顺带修复两个从未被跑到的 shim：`internal/errors` 的 `ExceptionWithHostPort`（原来 `code = String(err)` → 会得到 `"-48"`）与 `UVExceptionWithHostPort`（原来写死 `UNKNOWN`），现都按 `uvErrmapGet(err)` 解析 errno，与真 Node 一致。
- **M103 `http.Agent` 连接方法**：`createConnection(...)` 转发 `net.createConnection`；`createSocket(req, options, cb)` 按 `lib/_http_agent.js` 移植（合并 options、`calculateServerName` 算 SNI、写 `_agentKey`/`encoding`、入池 + `totalSocketCount`、安装 free/close/timeout/agentRemove 监听）。`removeSocket`/`keepSocketAlive`/`reuseSocket` 也从空实现改为真实移植（含 `agentKeepAliveTimeoutBuffer`）。
- **M104 `url.fileURLToPath({ windows: true })`**：按 `getPathFromURLWin32` 纯字符串实现——盘符 `C:\a\b`、UNC `\\server\share`（IDN 经 `domainToUnicode`）、非绝对路径报错、`%2f`/`%5c` 一律报错。
- **M105 `console` / `v8` 面收尾**：新增 `console` 额外面 + 整个 `v8` 成员表的差分探针；修掉一处真 bug——`mksnapshot` binding 的 `isBuildingSnapshotBuffer` 应为 `Uint8Array([0])`（`[0]` 是数字 `0`，不是 `false`）。

**验证（差分硬证据）**：
- `tools/bound-socket-probe.cjs` → `test/fixtures/bound-socket.json`；门禁 `test/bound-socket.test.ts`（真 Node v26.9.0 vs web-node 逐字节 **0 diff**）。
- `tools/console-v8-surface-probe.cjs` → `test/fixtures/console-v8-surface.json`；门禁 `test/console-v8-surface.test.ts`（同样 0 diff）。
- M103/M104 直接在 vitest 里把期望值写成真 Node 实测值（`test/http-surface.test.ts`、`test/url.test.ts`）。
- 同时更新两处过期断言（`test/v8.test.ts` 的 `isBuildingSnapshot()` 现为 `0`；`test/stub-fidelity.test.ts` 的 `BoundSocket` 不再抛错）。

**质量门禁**：`tsc --noEmit` 干净 · `vitest run` **986 通过 / 2 skip（113 files）** · `vite build` 绿（worker **2510.84KB**）。

**已知偏离**：`net.BoundSocket#fd()` 在 web-node 返回 `-1`（真 Node 在 macOS 返回真实 fd）。语义上等同 Node 在无 fd 平台的文档行为，已在 probe 中排除该项。

---

### 2026-09-23 · M97.1 `stripTypeScriptTypes`（纯 JS strip-only，阶段 B 收尾）

**改了什么**：把 `module.stripTypeScriptTypes(source, options)` 真正实现出来——**纯 JS 自研 TS 剥离器**（不引 amaro/SWC wasm），只做 strip-only 模式（把类型跨度覆写成空白、保持字节偏移），不做 codegen/transform。

- 新增 `src/node-runtime/ts/strip-types.ts`（~1250 行）：词法扫描器（注释/字符串/模板串/正则 vs 除法消歧/Unicode 标识符）+ 轻量 TS 感知语法漫游器 + 跨度覆写。覆盖 `interface`/`type`/`declare`/`namespace`/`import type`、类型注解、类型参数与类型实参（含 `<` 消歧的比较回退）、`as`/`satisfies`、非空断言 `!`、可选参数/可选成员、参数属性、`Readonly`/`public`/`private` 等修饰符、类字段/抽象成员/索引签名、类型谓词（`x is T`/`asserts x`/`this is T`）。
- **关键：空档补位按 UTF-8 字节宽度**（这是让它逐字节对齐真 amaro 的核心）——1 字节 → `' '`、2 字节 → U+00A0、3 字节 → U+2002、4 字节（astral，如 emoji）→ `' ' + U+FEFF`（两个 UTF-16 单元、共 4 字节）；`\n`/`\r`/`\t`/`\f`/`\v` 原样保留。这样替换后的字符串**字节长度与原文一致**（源码映射偏移稳定）。
- 不支持的语法**响亮抛** `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`（enum/namespace 含 runtime 成员、`import =`、参数属性、角度断言 `<T>expr` 等）；非法用法抛 `ERR_INVALID_TYPESCRIPT_SYNTAX`。两个码均为 `SyntaxError` 子类，形状对齐 `internal/errors`。
- 接线：`src/node-runtime/builtins/module.ts` 导出 `Module.stripTypeScriptTypes`；`src/node-runtime/builtins/internal-shims.ts` 新增 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`/`ERR_INVALID_TYPESCRIPT_SYNTAX`/`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`。
- 参数校验对齐真 Node：`code` 必须 string（`ERR_INVALID_ARG_TYPE`）、`options` 必须 object、`mode !== 'strip'` 抛 `ERR_INVALID_ARG_VALUE`、`sourceUrl` 必须 string、`sourceMap` 只接受 false/undefined。

**为什么**：路线选定 **B（纯 JS strip-only）**——实测 WebContainer 同类场景亦为纯 JS 自实现、运行时仅 ~1.1MB；引 amaro 会把 worker 从 2.47MB 抬到 ~6.3MB，体积不划算（见 `docs/webcontainer-research.md` 第八节）。

**验证（差分语料硬证据）**：
- `tools/strip-ts-probe.cjs` 在真 Node v26.9.0 与 web-node 上跑同一语料，逐字节比对 `__OBS__` JSON：**170/170 例 0 diff**（覆盖注释/字符串/模板串/正则/JSX 里“像类型”的字符、Unicode 宽度、CRLF、谓词、union 内对象类型、索引签名等边角）。fixture：`test/fixtures/strip-ts.json`；门禁：`test/strip-ts.test.ts`。
- **全仓库 `.ts` 扫描**：对 `src/` 下 113 个 `.ts` 文件、以及全仓库 227 个 `.ts` 文件与真 Node 逐字节比对，**全部 0 diff、0 hang**。

**开发中修掉的潜在 bug（都是 parser 死循环/错位）**：`matchingParenThenArrow` 的指数级回溯、`i++`/`i--` 在语句头未被消费、`[` 下标/数组被整体跳过导致内部 `as` 漏处理、`)` 之后把 `/` 误判为正则（吞调用）、“`|` 开头 union”、“`<` 比较回退”、导出 `interface`/`namespace` 标识符、对象字面量 `get()` 方法、类索引签名成员。

**顺带修掉一个存量 flaky 测试（与 M97.1 无关，但拦门禁）**：`test/worker.test.ts` 的 “worker stdio” 用例在**全量并发**时偶挂（`messages` 为空）。
- 根因：worker 未 `start()` 时，父侧 `postMessage`/`stdin` 会 `#touch()` 排定 4ms settle；若 worker 的 `start()`（`defer` 宏任务）在负载下被推迟超 4ms，settle 先跑——此时 worker 端 port 默认 `refed:false`，于是被判定“已完成”而 `#stop(0)`，**丢掉已排队的 stdin 帧**。
- 修复：`#scheduleSettle` 在 `!this.#started` 时直接返回（首次真正检查由 `start()` 路径排定）。
- 验证：改动前干净树 stash 后跑全量 **3 次挂 1 次**（确认存量）；修复后连续跑全量 **5/5 全绿**。

**质量门禁**：`tsc --noEmit` 干净 · `vitest run` **978 通过 / 2 skip（111 files）** · `vite build` 绿（worker **2507.07KB**，+37KB）。

---

### 2026-09-22 · M98 `http`/`https` 报文级差分

**改了什么**：新增端到端差分探针（同一程序在真 Node 与 web-node 各跑一遭）——单个 runtime 内同时起服务端与客户端，走虚拟网络；覆盖 http（12 个请求）与 https（8 个）全流程，观测客户端与服务器两侧。**0 diff**。修了 4 个真 bug：
1. **客户端 `req.write()` 不分块**：以前不管怎么给 body，都在 `end()` 时算出 `Content-Length`。现按 Node：`write()` 过的 body 走 `Transfer-Encoding: chunked`（十六进制长度帧），只有 `end(data)` 才量出 `Content-Length`（`ClientRequest#userWrote`）——服务器因此能从两侧看出分块语义。
2. **HEAD 响应带了 body**：`http.Server` 以前对 HEAD 请求照常回写 body。现对齐：HEAD（以及 204/304/101）视为无体——不生 `Content-Length`/`chunked` 帧、不写任何字节；客户端也同步把 HEAD 响应当无体（`HttpMessageReader#headOnly`，keep-alive 连接上是动态的）——否则客户端会等一个不存在的 body 而挂死。
3. **客户端过早半关连接**：`#send` 在 `Connection: close` 时一写完请求就 `socket.end()`。在 web-node 的虚拟 TCP 上，服务端 `allowHalfOpen:false` 会把对端的半关当作**全关**——服务端稍后异步写回的响应被丢弃（真 Node 客户端保留写侧至响应完成）。现改为不在发送后立即关，响应读完再由 reader 的 `onEnd` 销毁非 keep-alive 连接。
4. **`https.globalAgent` 非 keep-alive**：`new HttpsAgent()` 的 `keepAlive` 默认 `false`，而 Node 是 `{ keepAlive: true, scheduling: 'lifo', timeout: 5000 }`——导致 https 默认发 `Connection: close`。已对齐。

另有：HEAD 与 204/304/101 共用同一套无体逻辑（`ServerResponse._final`/`_write`），https 不再与 http 分叉。

**验证**：`tools/http-wire-probe.cjs`（`tools/http-wire-oracle.mjs` 录成 `test/fixtures/http-wire.json`）在真 Node 与 web-node **逐字段 0 diff**；端口与 `Date` 头归一化。
**门禁**：`tsc` 干净 · vitest **977 passed / 2 skipped（108/110 文件）** · build worker **2478.71 kB**。
**已知偏离**：探针**不**观测每 socket 的连接复用次数（agent 池属 M103 `http.Agent` 范畴）；`Date` 头因随时刻变化被归一化。

**为什么**：阶段 B 第四项；报文级差分是 M69 的端到端补全，发现并修掉了 4 个只在“服务端异步响应 / HEAD / 非 keep-alive / https 默认 agent”组合下显形的 bug。

### 2026-09-22 · M97 `module` 同步 loader 语义（hooks / SourceMap / findPackageJSON / 内部 loader 面）

**改了什么**：把 `module` 的四块 loader 面从「响亮抛错 / 返回 `undefined`」落成真实现：

**① 同步 loader hooks（`module.registerHooks`）—— 本里程碑主体**
- 新增 `src/node-runtime/loader/hooks.ts`（`ModuleHooksRegistry` + `ModuleResolveContext`/`ModuleLoadContext` + CJS 路径 ↔ `file://` URL 互转），逐条对齐 `lib/internal/modules/customization_hooks.js` 的 `buildHooks`/`wrapHook`：
  - **链式语义**：每个 hook 收到 `(arg0, context, next)`；调 `next(spec, ctx)` 委托、或返回带 `shortCircuit: true` 的结果接管。**若返回结果却未置 `shortCircuit: true`，报 `ERR_INVALID_RETURN_PROPERTY_VALUE`**（文案 `Expected true to be returned for the "shortCircuit" from the "resolve" hook but got undefined.`/`… type boolean (false).`）。
  - **上下文合并**：链上共享同一个 `mergedContext`（`Object.assign`），与 Node 的 `ModuleResolveContext`（`parentURL`/`importAttributes`/`conditions`）字段一致；CJS 下 conditions = `require,node,node-addons,module-sync`。
  - **返回值形状**：`resolve` 必须给字符串 `url`（否则同样报错）；`registerHooks` 返回 `Object.freeze` 对象，**`Object.keys` 恰为 `['resolve','load']`**（`deregister` 用不可枚举的 `defineProperty` 定义，与 Node 的 getter 一致），并挂 `Symbol.dispose`。
  - **参数校验**：`registerHooks()` 无参 → V8 解构报错 `Cannot destructure property 'resolve' of 'hooks' as it is undefined.`（无 `code`）；`{resolve: 3}` → `The "hooks.resolve" property must be of type function. Received type number (3)`（注意是 **property**）。
  - loader 侧：`#hooks.hasAny` 才走 hook 路径；默认 resolve 步 = 本 loader 的 `resolve`，默认 load 步 = 读 VFS（含 `#formatOf`）；`load` hook 可给 `source`/`format` 覆盖（`format: 'module'` 强制走 ESM 变换，`'json'` 直接 `JSON.parse`）。

**② SourceMap 注册 / 查找**
- loader 新增 `#sourceMaps` 注册表 + `#maybeCacheSourceMap`（对齐 `source_map_cache.js`：`sourceMappingURL`/`sourceURL` 魔法注释、`lineLengths`（含 U+2028/2029）、`data:application/json[;base64]` 解码、`sourcesToAbsolute` 把源改成 `file://` URL、`node_modules` 门禁），模块加载时自动登记。
- `findSourceMap(sourceURL)`：非字符串/`node:` → `undefined`；无协议前缀先转 `file://`；命中才 `new SourceMap(data, {lineLengths})`（惰性、缓存）。
- `setSourceMapsSupport(enabled, options)`：**`nodeModules`/`generatedCode` 默认 `false`（不是 `enabled`）**，修正了旧实现对两者默认值的错误；非 boolean → `The "enabled" argument must be of type boolean. Received type string ('x')`。
- `SourceMap` 构造器缺参文案补齐 `Received undefined`（`ERR_INVALID_ARG_TYPE`）。

**③ `findPackageJSON`**：相对/绝对 specifier → 目录后向上找；bare → 沿祖先 `node_modules/<pkg>` 找包目录再向上找 `package.json`；找不到报 `ERR_MODULE_NOT_FOUND`（`Cannot find package 'x' imported from <base>`）；无 specifier 报 `ERR_MISSING_ARGS`。

**④ 内部 loader 面**：`_findPath`（→ `resolve`，失败 `false`）、`_load`（→ `require`）、`_readPackage`（`{type,exists,pjsonPath}`）、`_stat`（文件 `0` / 目录 `1` / 缺失 `-2`）、`_preloadModules`、`_resolveLookupPaths`（相对 → `['.']`）均接到真 loader / VFS。

**验证**：`tools/module-hooks-probe.cjs`（35 个观测，`tools/module-hooks-oracle.mjs` 录成 `test/fixtures/module-hooks.json`）在真 Node 与 web-node **逐字段 0 diff**。
**门禁**：`tsc` 干净 · vitest **976 passed / 2 skipped（107/109 文件）** · build worker **2478.15 kB**。
**拆分**：`stripTypeScriptTypes` 拆为 **M97.1**（真 Node strip-only 模式按位替换类型为空格，需真 TS 解析器；vendor `amaro` 的 wasm 会把 worker 从 2.47MB 抬到 ≈6.3MB，未定取舍前保持响亮抛错）。
**已知偏离**：web-node 没有 Node 的 `relativeResolveCache` 快路径（已缓存模块在真 Node 会跳过 resolve hooks，web-node 仍会跑）——差分探针用全新 request 规避此路径差异；`_stat`/`_findPath` 等内部面基于 VFS，不追求与真 FS 磁盘行为逐字节相同。

**为什么**：阶段 B 第三项；loader hooks 是打包器/测试框架最依赖的扩展点，差分方法同上。

### 2026-09-22 · M96 `fs` 错误形状补全

**改了什么**：把 `fs` 各失败路径抛出的错误与真 Node 逐字段对齐——`code`、`syscall`、`errno`、`path`、`dest`、`message`、`name`，以及错误对象自身的形态（`constructor.name` 与自有属性集）。新增差分探针 `tools/fs-errors-probe.cjs`（51 个观测，用 `tools/fs-errors-oracle.mjs` 录成 `test/fixtures/fs-errors.json`），真 Node 与 web-node 各跑一遍 **0 diff**。

**错误对象形态（最关键、影响面最广）**
- **`VfsError` 现在伪装成普通 `Error`**：`UVException` 在真 Node 里就是 `Error` 实例，于是把类自身的 `.name` 改成 `'Error'`（`err.constructor.name === 'Error'`），并去掉构造器里 `this.name = 'Error'` 的自有属性（`name` 回到原型上，与 Node 一致）。`path`/`dest` 改用 `declare` 字段声明，避免 TS 的 `useDefineForClassFields` 把未赋值的字段 emit 成值为 `undefined` 的自有属性。
- **`SystemError` 子类名**：`E(code, msg, SystemError)` 那批码（`ERR_FS_EISDIR` 等）生成的错误类现在也叫 `SystemError`（`err.constructor.name`），不再暴露内部的 `NodeSystemError`。

**`syscall` 名（成批修正）**
- `lstat` 绑定从 `vfs.stat` 改为 `vfs.lstat`（syscall `lstat`）——一并修好 `lstat`/`realpath`/`rm`（缺文件时 Node 用 `lstat` 探测）。
- `rmdir`/`unlink`/`rm` 现在各报自己的 syscall（`rmdir`/`unlink`/`lstat`），不再一律 `unlink`。
- `copyFile` 报 `copyfile`（不再透传 `readFile` 的 `open`）。
- `utimes`/`chown` 报 `utime`/`chown`。

**`path`/`dest`/`message` 与语义**
- **`ENOTDIR`（祖先为文件）**：新增 `#ancestorFile`，当 `file/child` 这类路径的祖先是非目录时，`stat`/`readdir`/`rename`/`copyfile` 报 `ENOTDIR` 而非 `ENOENT`。
- **`rename`/`copyFile`/`link`/`symlink` 带 `dest`**：消息形如 `syscall 'from' -> 'to'`（`VfsError` 新增 `dest` 参数）。
- **`rmdirSync` 作用在文件上不再静默删除**（此前是一枚真 bug：`unlinkSync(dir)` 会直接删目录）——现按 Node：`rmdir` 非目录→`ENOTDIR`、`unlink` 目录→`EPERM`（macOS libuv），非空且非递归→`ENOTEMPTY`。
- **读错误不带 `path`**：Node 的 `uv_fs_read` 错误无 path（异于 `open`/`stat`），所以同步读（`readFileSync`/`readFileUtf8`/`readSync`）里的 `EISDIR` 会丢掉 `path`（同步 `readFileSync(dir)` 与 promise `readFile(dir)` 的差异正在此）；`copyFile(dir)` 报 `ENOTSUP copyfile`（macOS `copyfile(2)`）。
- **`opendir` 错误不带 `path`**（消息就是 `ENOENT: no such file or directory, opendir`）。
- **`readlink` 缺文件报 `ENOENT`**（不再是 `EINVAL`）；无符号链接时非缺失路径仍 `EINVAL`。
- **`symlink`/`link`**：先复刻真 FS 上本就失败的两种情形（父目录不存在→`ENOENT`、父路径是文件→`ENOTDIR`，均带 `dest`），再响亮抛 `ENOSYS`（VFS 无链接概念，不假装成功）。

**验证**：`tools/fs-errors-probe.cjs` 覆盖读/目录/删除/改名/拷贝/元数据/链接/promise 共 51 个失败路径，真 Node 与 web-node **逐字段 0 diff**。
**门禁**：`tsc` 干净 · vitest **975 passed / 2 skipped（106/108 文件）** · build worker **2470.16 kB**。
**已知偏离**：`copyfile` 目录源报 `ENOTSUP`、`unlink` 目录报 `EPERM` 是 macOS/libuv 形状（夹具以 macOS Node v26.9.0 为准）；`symlink`/`link` 在参数合法时抛 `ENOSYS`。

**为什么**：阶段 B 第二项；错误形状是调用者最依赖的可观测面，差分方法同上。

### 2026-09-22 · M95 `net` 连接生命周期与超时（阶段 B 开张）

**改了什么**：把 `net.Socket` 的连接状态机、事件序、`setTimeout` 超时、半开连接与 `allowHalfOpen` 语义逐字对齐真 Node。新增差分探针 `tools/net-lifecycle-probe.cjs`（真 Node 与 web-node 各跑一遍，`tools/net-lifecycle-oracle.mjs` 录制成 `test/fixtures/net-lifecycle.json`），**首次修正后 0 diff**。过程中修了三个真 bug。

**`net.Socket`（`builtins/net.ts`）**：
- **`setTimeout(ms[, cb])`**：真正实现（以前只是存 `ms`，定时器从不触发）。语义全按 `setStreamTimeout` + `getTimerDuration`：先写 `this.timeout` 再校验；`destroyed` 时直接返回；`0` 取消并 `removeListener('timeout', cb)`；非 0 则创建一个 **unref'd** 定时器（不吊住事件循环）调 `_onTimeout()`，`cb` 走 `once('timeout')`。校验与 Node 逐字：非数字 `ERR_INVALID_ARG_TYPE`（`Received type string ('x')`）、负数/非有限 `ERR_OUT_OF_RANGE`、超 `2^31-1` 截断并发 `TimeoutOverflowWarning`。**I/O（读/写）会重置定时器**（libuv 语义），所以忙时不触发。
- **`connect()`**：失败时改为 `destroy(err)`（而非只 `emit('error')`）——于是 `error` 后跟 `close:true`，状态机进 `closed`；`connecting` 在本 tick 保持 `true`（错误下个 tick 才显形）；连接回调改注 `once('connect', cb)`（Node 在拨号前注册），故成功时顺序为 `callback` → `connect` → `ready`。
- **`allowHalfOpen`**：`net.connect(options)`/`createConnection` 现在把 options 传给 `Socket` 构造器（之前被丢弃，`allowHalfOpen:true` 无效）。
- **`_destroy`**：清定时器 + 置空句柄（于是 `pending` 关闭后为 `true`）；`close` 事件的 `hadError` 由重写的 `emit('close', this.#hadError)` 注入（Node 由 `lib/net.js` 的 handle 负责，基类流事件不带这个参数）；不再把 `err` 透传给虚拟 socket（那会经 `onError` 重复发一次 `error`）。
- **`#sockname`/`_read`**：EOF 时补 `this.read(0)`——net socket 持续读，故即使没有 `data` 消费者（如只 `on('end')` 的 server 端）也必然观测到 EOF 并发出 `end`。
- 误差文案：新增 `describeType`/`invalidArgType`/`outOfRange`/`validateNumber`/`validateFunction` 本地 helper，对齐 `internal/errors` + `internal/validators`。

**虚拟 TCP（`net/network.ts`）——两个真 bug**：
1. **半开语义**：`end()` 以前会把**本端** `#readableEnded=true` 并触发本端 `endCbs`（本地 FIN 不该结束自己的读侧，应只让对端看到 EOF）。已改为只 `peer._remoteEnded()`。且 `end()` 的对端通知不能以「本端已关闭」为条件（半开时本端可先 auto-destroy，导致 FIN 永不送达）；改为只看对端状态。
2. **关闭模型**：`destroy()` 以前无条件把对端也 `destroy()`。现按 TCP 语义：已发 FIN（`#finSent`）则只通知对端 EOF（对端可保持可写，配合 `allowHalfOpen`）；未发 FIN 的突发关闭才把对端拆掉（让「服务端中途断连」表现为错误而非空等）。

**`http.Server#close`（`builtins/http.ts`）**：补上 Node 的行为——close 前先 `closeIdleConnections()`（`_http_server.js#httpServerPreClose`）。否则 keep-alive 空闲连接会让新实现的「close 等到连接排空」永久悬住（以前 close 不等待才没暴露）。

**验证**：`tools/net-lifecycle-probe.cjs` 覆盖：拒绝连接的事件序/终态、idle 超时与 busy 不超时、`setTimeout(0)`/校验错误、`allowHalfOpen` 真/假、connect 回调顺序、`destroy(err)`、`server.close` 排空、`destroySoon`、`getConnections`。真 Node 与 web-node **逐字段 0 diff**。
**门禁**：`tsc` 干净 · vitest **974 passed / 2 skipped（107 文件）** · build worker **2468.39 kB**。

**为什么**：阶段 B 第一项，差分方法是本项目已固定的验证主干。

### 2026-09-22 · M91 ML-KEM（FIPS 203）后量子 KEM

**改了什么**：新增 `src/node-runtime/crypto/mlkem.ts`（纯 JS 实现的 ML-KEM），接入 `crypto.encapsulate` / `crypto.decapsulate` 以及 `ml-kem-512/768/1024` 密钥类型。阶段 A crypto 收尾。

**ML-KEM 是什么**：FIPS 203 的后量子 KEM，是 IND-CPA 的 K-PKE（公钥加密）套一层 Fujisaki–Okamoto 变换。全部基于 runtime 自带的 Keccak（SHA3/SHAKE），**无外部依赖**：

- **NTT**（Z_3329[X]/(X^256+1)）：正变换 Cooley–Tukey（Algorithm 9）、逆变换 Gentleman–Sande（Algorithm 10）；**twiddle 因子全部由 `ζ = 17` 在加载时推导**（`zetas[i] = 17^BitRev7(i)`、乘法用 `17^(2·BitRev7(i)+1)`），不手抄常量表——避免转录错误。
- **采样**：`SampleNTT`（SHAKE128 上做拒绝采样，取 12-bit 值 < 3329），`SamplePolyCBD_η`（SHAKE256 上取字节位）。
- **编码**：`ByteEncode/Decode_d`（小端 bit 打包，d ∈ {1,4,5,10,11,12}）、`Compress_d`/`Decompress_d`。
- **K-PKE**：KeyGen/Encrypt/Decrypt；ML-KEM 层：`KeyGen_internal(d,z)`、`Encaps_internal(ek,m)`、`Decaps_internal(dk,c)`；隐式拒绝（重加密比对失败则返回 `J(z‖c)`）。
- 参数：512 = (k=2,η1=3,η2=2,du=10,dv=4)、768 = (3,2,2,10,4)、1024 = (4,2,2,11,5)。

**密钥类型**（`asym.ts`）：
- `AsymType` 扩 `'ml-kem-512' | 'ml-kem-768' | 'ml-kem-1024'`；`KeyMaterial.mlkem`（存 `param`、`seed`、`publicKey`(ek)、`privateKey`(dk)）。
- **PKCS#8**：`SEQUENCE { INTEGER 0, AlgorithmIdentifier, OCTET STRING { [0] IMPLICIT OCTET STRING(64字节 seed) } }`。关键点：**seed 包在 `[0]`（tag `0x80`）里，不是普通 `0x04`**——解出 `80 40 <64>`，解析要按 `0x80`/`0x04` 处理；输出也要回写成 `80 40`。同时支持 `[1]`（tag `0x81`）的展开形式。
- **SPKI**：`SEQUENCE { AlgorithmIdentifier, BIT STRING(0x00 ‖ ek) }`，OID `2.16.840.1.101.3.4.4.{1,2,3}`。
- `createPublicKey(privateKeyObject)` 可由 seed 派生 ek；`asymmetricKeyDetails` 为 `{}`。
- `generateKeyPairSync('ml-kem-*')`：随机 `d|z`（各 32 字节）→ 展开。

**`encapsulate` / `decapsulate`**（`builtins/crypto.ts`）：签名与 Node 一致——`encapsulate(key[, callback])`（arity 2，收 public **或** private）、`decapsulate(key, ciphertext[, callback])`（arity 3，仅 private），带 callback 时异步。错误面与 Node 逐字对齐：`ERR_INVALID_ARG_TYPE`（key/ciphertext/callback 三类，含完整类型列表文案）、`ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE`（secret→“expected private or public”、public 解密封→“expected private”）、`ERR_CRYPTO_OPERATION_FAILED: Decapsulation failed`（密文长度不符）。

**顺带修复**：`KeyObject.export({ format: 'der' })` 之前返回裸 `Uint8Array`，现已按其他字节出口的约定包装成 `Buffer`（对齐真 Node；之前只有 `export` 的 der 路径漏了这一步）。

**已知偏离**（写在这里，不隐藏）：`encapsulate`/`decapsulate` 只支持 ML-KEM；其他密钥类型（如 RSA）在本 runtime 响亮抛 `NotImplementedError`，而 OpenSSL 3.5 的 `EVP_PKEY_encapsulate` 对 RSA 也能返回东西。按项目“只按实际情况声称支持、不编造”的约定处理。

**验证（差分 0 diff）**：
- `tools/crypto-mlkem-oracle.mjs` 用真 Node 生成密钥/种子/密文/共享密钥，`test/crypto-mlkem.test.ts` 验证：从 seed 派生的 ek 与 SPKI 尾字节逐字节相同；用 ML-KEM 解真 Node 的密文得到同一共享密钥；自封装回环；篡改密文 → 隐式拒绝（密钥变但长度 32）。
- `tools/crypto-kem-probe.cjs`（`tools/crypto-kem-gen.mjs` 生成，内嵌真 Node 向量）在真 Node 与 web-node 内各跑一遭，逐字段等于 `test/fixtures/crypto-kem.json`。覆盖：三种参数集的 spki/pkcs8 round-trip、从私钥派生公钥、PEM 头部、解内嵌密文、PEM 私钥解封、封装长度/Buffer、回环、从 PEM/私钥封装、异步 callback，以及 9 类错误面。**首次修正后 0 diff**。

**门禁**：`tsc` 干净 · vitest **973 passed / 2 skipped（106 文件）** · build worker **2466.50 kB**。demo 新增 ML-KEM 小段，输出对齐真 Node。

**为什么**：阶段 A crypto 最后一项，按 `docs/ROADMAP.md` 顺序（原标注“优先级最低、可砍”，但既已排在末位且可低成本实现，就完成它）。

### 2026-09-22 · M94 `crypto.Certificate`（SPKAC）

**改了什么**：新增 `src/node-runtime/crypto/spkac.ts`，把此前「响亮抛错的桁」换成真实现。

`crypto.Certificate` 是 Node 已弃用但仍广泛部署的 SPKAC（Netscape SPKI）工具。SPKAC 是 base64 编码的 `NETSCAPE_SPKI`：

```
NETSCAPE_SPKI ::= SEQUENCE {
  spkac      NETSCAPE_SPKAC,   -- SEQUENCE { pubkey SubjectPublicKeyInfo, challenge IA5String }
  sig_algor  AlgorithmIdentifier,
  signature  BIT STRING
}
```

- `verifySpkac`：解出内层 `spkac` 的 DER，用内嵌公钥校 `signature`（等价于 OpenSSL 的 `ASN1_item_verify(NETSCAPE_SPKAC, ...)`）。签名算法 OID 为 `rsaEncryption`（1.2.840.113549.1.1.1）时，从 PKCS#1 v1.5 的 DigestInfo 里反推摘要算法；也支持 `md5/sha*WithRSAEncryption` 与 `ecdsa-with-SHA*` OID。
- `exportPublicKey`：把内嵌 `SubjectPublicKeyInfo` PEM 编码（`-----BEGIN PUBLIC KEY-----`）。
- `exportChallenge`：返回 `challenge`（IA5String）内容。

**三个必须照抄的 OpenSSL 怪癖**：

1. **base64 解码用 `EVP_DecodeBlock`，不是标准 base64**：它会去掉**开头**的空格/tab，并且**在保留长度 >3 的前提下**从尾部剥掉空格/tab/`\n`/`\r`/`-`（这些在它的 `data_ascii2bin` 表里是 0xE0/0xF0/0xF1/0xF2）；但**不解尾部以外的空白**——所以行折叠（每 64 字换行）的 base64 直接解码失败。实测：`valid+\n` → true，`valid+\r\n` → true，`valid` 前置空格 → true，**每 64 字换行 → false**。
2. **末尾组永远出 3 字节**：源码里 `eof = (c=='=')+(d=='=')` 拿的是**解码后的值**（'=' 的值为 0）与裸字符 '=' 比，恒为 0，于是 padding 从不起作用——多出的尾巴字节靠 `d2i` 忽略尾部数据兼容掉。我把这个行为原样复刻。
3. **空输入返回空字符串而不是 false**：`ncrypto` 在 `input.empty()` 时提前返回 `SetEmptyString()`，所以 `verifySpkac('') === ''`、`exportChallenge('') === ''`、`exportPublicKey('') === ''`（注意 `''` 不是 `false`/空 Buffer）。

接口形态也照 Node：`Certificate` 是**普通函数**（可 `new` 也可直接调用，直接调用返回实例），三方法同时挂在原型与构造器上（`Certificate.verifySpkac === Certificate.prototype.verifySpkac`）。入参用 `getArrayBufferOrView(spkac, 'spkac', encoding)` 的语义：接受 `string | ArrayBuffer | Buffer | TypedArray | DataView`，否则报 `ERR_INVALID_ARG_TYPE`（含完整 5 类型文案）。

**验证（差分 0 diff，首次运行即过）**：`tools/crypto-certificate-probe.cjs` 在真 Node 与 web-node 内各跑一遭，逐字段等于 `test/fixtures/crypto-certificate.json`。覆盖：Node 官方 fixture（`rsa_spkac.spkac` / `rsa_spkac_invalid.spkac`）的 true/false 与 challenge、PEM 与 `rsa_public.pem` 逐字对比；空串 / 非法 base64 / 非 base64 / 畸形长度；尾部 `\n`、`\r\n`、空格与前置空格、**行折叠**；`Buffer`/`ArrayBuffer`/`Uint8Array`/`DataView`/原始 DER/`encoding='base64'`；new / 直接调用 / 静态与原型同一函数；以及 7 种非法入参在三方法上的完整错误文案。

**门禁**：`tsc` 干净 · vitest **962 passed / 2 skipped（104 文件）** · build worker **2457.01 kB**。demo 新增 SPKAC 小段，输出对齐真 Node。

**为什么**：阶段 A crypto 收尾，按 `docs/ROADMAP.md` 顺序。

### 2026-09-22 · M93.4d AES-SIV 与 AES-XTS

**改了什么**：新增 `src/node-runtime/crypto/siv.ts`（RFC 5297）与 `src/node-runtime/crypto/xts.ts`（IEEE 1619），至此 **M93.4 四个子项全部完成，阶段 A crypto 收尾 22/22 到顶**。

SIV 按 `crypto/modes/siv128.c` 写：密钥取两半（CMAC 半 + CTR 半），`d = CMAC(0^128)` 起手，每段 AAD 做 `d = dbl(d) ^ CMAC(K, aad)`；载荷 S2V 分两种（`len>=16` 用 `S || (S_last ^ d)`，否则 `pad(S) ^ dbl(d)`）；随后 `V = S2V(...)`，把 `V` 的第 31/63 位清掉做 CTR 计数器，密文 = CTR(K_ctr, V, P)，`tag = V`。tag 就是 IV（所以不允许再传 IV，`ivLength=0`）。tag 固定 16 字节。

XTS 按 `crypto/modes/xts128.c` 写：`tweak = AES(k2, iv)`，每块前后 XOR tweak、块间 tweak 做 GF 倍乘；尾部不满块用**密文窃取**（把上一块的密文前 r 字节挪到末块、原末块明文补进去）。密钥两半相等时 OpenSSL 拒绝，报 `ERR_OSSL_XTS_DUPLICATED_KEYS`。

**两个关键坑**：

1. XTS 的 tweak doubling 是**小端**方向的倍乘（进位从末字节流向首字节、归约 0x87 落到首字节），与 SIV/GCM 用的大端 `dbl` **方向相反**。最初直接复用了大端 `dbl`，导致第 0 块正确、从第 1 块起全错——正是差分语料抓出来的。
2. 本 runtime 的 `Buffer.prototype.slice` 返回**共享内存的视图**（不是拷贝）。SIV 解密时 `counter = tag.slice()` 后用 CTR 自增计数器，结果把存下来的 auth tag 末字节给改了（`…315e` 变成 `…315f`），鉴权莫名其妙失败。改用 `new Uint8Array(x)` 显式拷贝后正常。

接入：`aes-{128,192,256}-siv`（无 IV、`authTagLength` 可省略且只能是 16）与 `aes-{128,256}-xts`（IV 16 字节必填，nid 913/914；无 192 变体）。`getCipherInfo` 现按 OpenSSL 语义：当 nid / ivLength 为 0 时**省略该字段**（SIV 即如此）。SIV/XTS 都是**单次 update**：二次 update、不足一块（XTS <16 字节）报 `Error: Trying to add data in unsupported state`；SIV 未 update 就 final 报鉴权错误，XTS 报 `Error: Unsupported state`；XTS 无鉴权，`setAAD`/`getAuthTag`/`setAuthTag` 报 `ERR_CRYPTO_INVALID_STATE`。

**已知偏离**：`aes-*-siv` 的流式分块（本来也是单次语义，无影响）；`aes-*-wrap-inv` / `des3-wrap` 等仍抛 `NotImplementedError`。

**验证（差分 0 diff）**：`tools/crypto-siv-xts-probe.cjs` 在真 Node 与 web-node 内各跑一遭，逐字段等于 `test/fixtures/crypto-siv-xts.json`。覆盖：SIV 的 128/192/256 密钥、多段 AAD、空/16/32/40 字节载荷与回环；XTS 的 16/20/32/33/48/1000 字节（全块与 CTS）、两套 key/iv 与回环；以及全套错误面（`ERR_CRYPTO_INVALID_AUTH_TAG`、`ERR_CRYPTO_INVALID_IV`、`ERR_CRYPTO_INVALID_KEYLEN`、`ERR_CRYPTO_INVALID_STATE`、`ERR_OSSL_XTS_DUPLICATED_KEYS`、`Unsupported state`、`Trying to add data in unsupported state`）。

**门禁**：`tsc` 干净 · vitest **961 passed / 2 skipped（103 文件）** · build worker **2452.95 kB**。demo 新增 SIV/XTS 示例，输出对齐真 Node。

**为什么**：阶段 A crypto 收尾，按 `docs/ROADMAP.md` 的 M93.4 拆分顺序。至此阶段 A 全部完成。

### 2026-09-22 · M93.4c AES-OCB 与 key wrap

**改了什么**：新增 `src/node-runtime/crypto/ocb.ts`（RFC 7253）与 `src/node-runtime/crypto/wrap.ts`（RFC 3394/5649）。

OCB 完全照 OpenSSL 的 `crypto/modes/ocb128.c` 写。**最关键的一点：OpenSSL 的 nonce 不是 RFC 原文那套**——它把 tag 长度塞进了 nonce 头部：`nonce[0] = ((taglen*8)%128)<<1`，IV 靠右放，IV 左边一字节置 1；`Ktop` 是 `AES(nonce & …c0)`，`Stretch = Ktop ‖ (Ktop[0..7]^Ktop[1..8])`，`Offset_0` 是 Stretch 从 bit `bottom = nonce[15]&0x3f` 起的 128 位窗口。因此**密文会随 tag 长度改变**（以 taglen 16 的 12 字节 IV 为例，nonce[0]=0；taglen 12 则 nonce[0]=0xC0），必须严格按它来。此外还复刻了 OpenSSL provider 的缓冲语义：尾部不满块会被缓存，输出在 `final` 才给出（整块则在 `update` 输出）。

key wrap 照 `wrap128.c`：`wrap`（RFC 3394，6 轮、A 与 t 异或）与 `wrap-pad`（RFC 5649，AIV = `a65959a6` + 长度，含 padded 正好 8 字节时 `AIV‖P` 单块 ECB 的特例）。两者都是**单次 update**：`update` 返回全部输出，`final` 空；第二次 `update`（或长度不合法）报 `Error: Trying to add data in unsupported state`；未 `update` 就 `final` 报 `Error: Unsupported state`。

接入：`aes-{128,192,256}-ocb`（nid 958/959/960；IV 1..15字节；`authTagLength` 必填且 0..16）；wrap 组 `aes-{128,192,256}-wrap`（nid 788/789/790，`infoName` = `id-aes{bits}-wrap`）与 `aes{bits}-wrap`、`id-aes{bits}-wrap` 三种拼写同一 spec，IV 必须 8 字节；`aes-{128,192,256}-wrap-pad` / `aes{bits}-wrap-pad` / `id-aes{bits}-wrap-pad`（nid 897/900/903），IV 必须 4 字节。

**已知偏离**：`aes-*-wrap-inv`/`-wrap-pad-inv`（OpenSSL 的逆 wrap 系列）与 `des3-wrap`/`id-smime-alg-cms3deswrap` 仍抛 `NotImplementedError`。

**验证（差分 0 diff）**：`tools/crypto-ocb-wrap-probe.cjs` 在真 Node 与 web-node 内各跑一遭，逐字段等于 `test/fixtures/crypto-ocb-wrap.json`。覆盖：RFC 7253 附录 A 向量（`ct bea5e879…7663cb` / `tag 2e9bbcd2…f7f49d`）、tag 8/12/16、IV 8/12/13/15、空/16/40 字节 payload、无 AAD、**流式分块并逐步记录每段输出**（验证缓存边界一致）、RFC 3394 的 128/192/256 密钥 wrap 向量、RFC 5649 的 20/8/1 字节 wrap-pad、wrap-pad 回环，以及全套错误面（`ERR_CRYPTO_INVALID_AUTH_TAG`、`ERR_CRYPTO_INVALID_IV`、`ERR_CRYPTO_INVALID_KEYLEN`、`ERR_CRYPTO_INVALID_STATE`、`Unsupported state`、`Trying to add data in unsupported state`）。首次运行即 0 diff。

**门禁**：`tsc` 干净 · vitest **960 passed / 2 skipped（102 文件）** · build worker **2446.90 kB**。demo 新增 OCB/wrap 示例，输出对齐真 Node。

**为什么**：阶段 A crypto 收尾，按 `docs/ROADMAP.md` 的 M93.4 拆分顺序。此刻阶段 A 的 crypto 收尾任务全部完成（19/19）。

### 2026-09-22 · M93.4b ARIA / SM4

**改了什么**：新增 `src/node-runtime/crypto/aria.ts`（RFC 5794）与 `src/node-runtime/crypto/sm4.ts`（GB/T 32907）。

ARIA：`FO(D,RK)=A(SL1(D^RK))`、`FE(D,RK)=A(SL2(D^RK))`，128 位块、12/14/16 轮，末轮用 `SL2(D^ek_n)^ek_{n+1}`；密钥编排是 (KL‖KR) 上的三轮 Feistel（W0…W3 由 FO/FE 与 CK1–3 生成，CK 按密钥长度取 C1/C2/C3 的轮换）。**SB3/SB4 不手抄表**——它们是 SB1/SB2 的逆，由 `inverse()` 现算，避免与 SB1/SB2 抄错不一致。解密密钥 `dk1=ek{n+1}`、`dk{i}=A(ek{n+2-i})`、`dk{n+1}=ek1`，解密直接复用同一数据路径。

SM4：128 位块、32 轮，轮函数为字节 S 盒 `tau` + 线性 `L`（旋转 2/10/18/24），密钥编排用 `L'`（旋转 13/23），轮密钥 `rk[i]=K[i]^L'(…)`；输出为 `(X35,X34,X33,X32)`。

两者都是 128 位块，因此直接复用 M93.4a 泛化出的 `Cipheriv`（`BlockCipher` 接口）与 PKCS#7。接入 `aria-{128,192,256}` 与 `sm4` 的 ecb/cbc/cfb/ofb/ctr，加 `aria128/192/256`、`sm4`（CBC）别名；CMAC 分派扩展到 aria/sm4。

**顺手修隐患**：M93.4a 的 Camellia 误用了含 gcm 的 6 项 `modes` 表生成条目，会造出幽灵 `camellia-*-gcm`（nid undefined）。现改为专用的 5 模式表（`blockModes`），camellia/aria/sm4 共用。

**验证（差分 0 diff）**：`tools/crypto-aria-sm4-probe.cjs` 在真 Node 与 web-node 内各跑一遭，逐字段等于 `test/fixtures/crypto-aria-sm4.json`。覆盖：ARIA/SM4 全部 20 个名称的 `getCipherInfo`、20 组（算法×模式）密文与回环、流式 update 整合、setAutoPadding(false)、CMAC（aria 128/192/256 / sm4 / 块对齐 / 空）、错误面（`ERR_CRYPTO_INVALID_KEYLEN`、`ERR_CRYPTO_INVALID_IV`、`ERR_CRYPTO_UNKNOWN_CIPHER`、`ERR_OSSL_EVP_INVALID_KEY_LENGTH`、`ERR_OSSL_INVALID_MODE`）。首次运行即 0 diff。

**门禁**：`tsc` 干净 · vitest **959 passed / 2 skipped（101 文件）** · build worker **2439.06 kB**。demo 新增 ARIA/SM4 示例，输出对齐真 Node。

**为什么**：阶段 A crypto 收尾，按 `docs/ROADMAP.md` 的 M93.4 拆分顺序。

### 2026-09-22 · M93.4a Camellia

**改了什么**：新增 `src/node-runtime/crypto/camellia.ts`——按 RFC 3713 用 BigInt 实现的 128 位分组密码（128/192/256 位密钥）。密钥编排（KL/KR/KA/KB、Sigma1–6）与 Feistel 数据路径（18/24 轮 + 每 6 轮一次 FL/FLINV）基本按规范逐行写；S 盒 `s2 = s1<<<1`、`s3 = s1<<<7`、`s4 = s1[x<<<1]` 由 `s1` 推导。解密复用同一数据路径，只把子密钥逆序。

把 AES 风格的模式驱动 `Cipheriv` 泛化：新增 `BlockCipher` 接口（`encryptBlock`/`decryptBlock`），构造函数增加可选的块密码参数（默认 `AesKey`）。Camellia 因此直接复用 ECB/CBC/CFB/OFB/CTR 与 PKCS#7 全部逻辑，而不需重写一套模式代码。

接入 `camellia-{128,192,256}` 的 ecb/cbc/cfb/ofb/ctr，加上 `camellia128/192/256`（CBC 别名）。CMAC 改为按 cipher 分派：新增 `cmacForCipher(spec, key, data)`，依 `spec.family` 选择 `aesCmac`/`desCmac`/`camelliaCmac`，于是 `createMac('cmac', key, { cipher: 'camellia-128-cbc' })` 可用（16 字节 tag）。

**关键坑**：128 位密钥的 `k1..k18` **不是**连续的半字对——按 RFC，`k9 = (KA<<<45)>>64`，而 `k10 = (KL<<<60)&MASK64`（跳过了 `KA<<<45` 的低半字与 `KL<<<60` 的高半字）。初版用 `halves(X, n)` 成对生成，密文全错；改用显式 `hi()/lo()` 逐项列出后与官方向量一致。192/256 位的 `k1..k24` 则是连续半字对。

**验证（差分 0 diff）**：`tools/crypto-camellia-probe.cjs` 在真 Node 与 web-node 内各跑一遭，逐字段等于 `test/fixtures/crypto-camellia.json`。覆盖：RFC 3713 三条官方向量、15 个（bits×mode）组合的密文 + 回环、流式 update 与一次性等价、setAutoPadding(false)、CMAC（128/192/256/块对齐/空）、以及错误面（`ERR_CRYPTO_INVALID_KEYLEN`、`ERR_CRYPTO_INVALID_IV`、`ERR_CRYPTO_UNKNOWN_CIPHER`、`ERR_OSSL_EVP_INVALID_KEY_LENGTH`、`ERR_OSSL_INVALID_MODE`）。

**门禁**：`tsc` 干净 · vitest **958 passed / 2 skipped（100 文件）** · build worker **2430.89 kB**。demo 新增 Camellia 示例，输出对齐真 Node。

**为什么**：阶段 A crypto 收尾，按 `docs/ROADMAP.md` 的 M93.4 拆分顺序（M93.4a Camellia → M93.4b ARIA/SM4 → M93.4c OCB/wrap → M93.4d SIV/XTS）。

### 2026-09-22 · M93.3 AES-CCM

**改了什么**：新增 `src/node-runtime/crypto/ccm.ts`——SP 800-38C 的 CBC-MAC + 计数器模式 AEAD，包含 B0/A0 构造、AAD 的长度前缀（< 0xff00 用 2 字节，否则 0xfffe/0xffff 变长编码）、payload 块的零填充切分。CBC-MAC 覆盖 B0 ‖ AAD 块 ‖ payload 块，最后一节与 A0 的 AES 加密结果异或后截断到 tag 长度。

AES 块密码从 `cipher.ts` 抽到新模块 `src/node-runtime/crypto/aes.ts`（导出 `AesKey`），`cipher.ts` 与 `ccm.ts` 共用同一份实现，避开了模块循环。`CipherSpec` 增 `'ccm'` 模式，`createCipher` 工厂分发到 `AesCcm`。

`createCipheriv` 接入 `aes-{128,192,256}-ccm` 及其 `id-aes*-ccm` 别名。与真 Node 对齐的语义：
- `authTagLength` **必填**，缺失报 `TypeError ERR_CRYPTO_INVALID_AUTH_TAG: authTagLength required for aes-128-ccm`；合法值为 `{4,6,8,10,12,14,16}` 之外的报 `Invalid authentication tag length: N`。
- nonce 长度限 `[7,13]`，否则报 `TypeError ERR_CRYPTO_INVALID_IV: Invalid initialization vector`。
- 带 AAD 时 `plaintextLength` 必填（可在构造函数 options 或 `setAAD` 第二参给），缺失报 `TypeError ERR_MISSING_ARGS: options.plaintextLength required for CCM mode with AAD`。
- `update` 必须**一次性**给出精确 `plaintextLength` 字节；多/少都报 `Error: Trying to add data in unsupported state`（无 `code`）。
- 解密时 tag 不匹配报 `Error: Unsupported state or unable to authenticate data`（无 `code`）。

**验证（差分 0 diff）**：`tools/crypto-ccm-probe.cjs` 在真 Node 与 web-node 内各跑一遭，逐字段等于 `test/fixtures/crypto-ccm.json`。覆盖：`getCipherInfo`、SP 800-38C 附录 C 例 1（`ct e3b201a9` / `tag 9674cd22`）、128/192/256 密钥、tag 长度 4–16、nonce 长度 7–13、空 payload、无 AAD，以及全套错误面。空 payload 一例抓出“无 payload 不加块”的偏离（初版多补了一个零块）。

**门禁**：`tsc` 干净 · vitest **958 passed / 2 skipped（100 文件）** · build worker **2425.81 kB**。demo 新增 CCM 示例，执行输出与真 Node 逐字一致。

**为什么**：阶段 A crypto 收尾，按 `docs/ROADMAP.md` 的 M93 拆分顺序（M93.1 ChaCha20 → M93.2 DES/3DES → M93.3 CCM → M93.4 其余）。

### 2026-09-22 · M93.2 DES / 3DES（并让 CMAC 支持 DES）

**改了什么**：新增 `src/node-runtime/crypto/des.ts`——纯 JS DES 块密码（FIPS 46-3 的 IP/FP/E/P/PC1/PC2/S 盒/移位表）加上 EDE2（16 字节 key，K3 = K1）与 EDE3（24 字节 key）。`createCipheriv` 接入 `des-ede`/`des-ede-ecb`/`des-ede-cbc`/`des-ede-cfb`/`des-ede-ofb` 与 `des-ede3`/`des-ede3-ecb`/`des-ede3-cbc`/`des-ede3-cfb`/`des-ede3-ofb`/`des3`（ECB/CBC/CFB-128/OFB，8 字节块 + PKCS#7）。`cipher.ts` 的 `CipherSpec` 增 `family`，`createCipher` 据此分发到 `DesCipher`。

顺带把 CMAC 从「AES 专用」改为**通用块密码 CMAC**：抽出 `cmacCore(encrypt, blockSize, rb, data)`，`aesCmac`（rb=0x87、块 16）与 `desCmac`（rb=0x1B、块 8）均基于它。于是 `createMac('cmac', key, { cipher: 'des-ede3-cbc' })` 能算出 8 字节 tag，M90.3 记的「非 AES CMAC 报 `NotImplementedError`」偏离因此收窄。

**已知偏离**：`des-ede3-cfb1`/`des-ede3-cfb8`（1/8 位 CFB）与 `des3-wrap`/`id-smime-alg-cms3deswrap`（key wrap）仍抛 `NotImplementedError`。

**验证（差分 0 diff）**：`tools/crypto-des-probe.cjs` 在真 Node 与 web-node 内各跑一遭，逐字节等于 `test/fixtures/crypto-des.json`（11 个算法名 × 固定 key/IV 的密文 + 回环、多次 update、padding、全套错误面）；DES CMAC 语料并入 `test/fixtures/crypto-mac.json`。

**门禁**：`tsc` 干净 · vitest **956 passed / 2 skipped（96 文件）** · build worker **2421.63 kB**。

**为什么**：阶段 A crypto 收尾，按 `docs/ROADMAP.md` 的 M93 拆分顺序（M93.1 ChaCha20 → M93.2 DES/3DES → M93.3 CCM → M93.4 其余）。

### 2026-09-22 · M93.1 ChaCha20 / ChaCha20-Poly1305

**改了什么**：新增 `src/node-runtime/crypto/chacha20.ts`——ChaCha20 块函数（10 轮 double-round）、流式 keystream（raw `chacha20` 用 64-bit 计数器，AEAD 用 32-bit），以及 RFC 8439 §2.6–2.8 的 Poly1305 AEAD（复用 `poly1305.ts`）。

两种形态只差 key 之后四个状态字的填充（对齐 OpenSSL `cipher_chacha20_hw.c`）：`chacha20` 把 16 字节 IV 原样写进 state[12..15]（低 8 字节计数器 + 高 8 字节 nonce）；`chacha20-poly1305` 用 12 字节 nonce，state[12] 从 0 开始（block 0 是 Poly1305 一次性密钥）再到 1。

`createCipheriv` 接入两个名字；`crypto/cipher.ts` 新增 `SyncCipher` 接口、`createCipher` 工厂与 `cipherTagLengthIsValid`，AES 与 ChaCha 两套实现共用同一 surface。

**语义修正（对齐真 Node）**：
- `getCipherInfo` 对 stream 模式（ChaCha 两个）不再返回 `blockSize`，与 Node 一致。
- `setAuthTag` 改为要求长度**等于** `authTagLength`（不只查白名单）；GCM 一并修正（`authTagLength:12` 时传 16 字节 tag 现在会报错）。
- ChaCha 解密未 `setAuthTag` 时也按全零 tag 校验并报 `Unsupported state or unable to authenticate data`（无 `code`，与 Node 逐字对齐）。

**验证（差分 0 diff）**：`tools/crypto-chacha-probe.cjs` 在真 Node 与 web-node 内各跑一遭，逐字节等于 `test/fixtures/crypto-chacha.json`（含 RFC 8439 §2.4.2 / §2.8.2 官方向量、跨多次 update、截断 tag、AAD、全套错误面）。

**门禁**：`tsc` 干净 · vitest **955 passed / 2 skipped（95 文件）** · build worker **2413.00 kB**。

**为什么**：阶段 A crypto 收尾，按 `docs/ROADMAP.md`（M93 覆盖面大，开工前已拆为 M93.1–M93.4 并在路线图注明）。

### 2026-09-22 · M92.1 + M92.2 DH KeyObject + `crypto.diffieHellman`

**改了什么（M92.1）**：给 web-node 补上 DH 类型的 `KeyObject`（此前 `AsymType` 只有 `rsa|ec|ed25519`）。`KeyMaterial` 增 `dh: { prime, generator, publicKey?, privateKey? }`；`generateKeyPairSync('dh', …)` 支持 `{ group }`、`{ prime, generator }`、`{ primeLength }`；导出/解析走 PKCS#8（内层 `dhKeyAgreement` 参数 + OCTET STRING(INTEGER x)）与 SPKI（`dhKeyAgreement` 参数 + BIT STRING(INTEGER y)），PEM 标签 `PRIVATE KEY`/`PUBLIC KEY`；`equals`/`toCryptoKey`/`createPublicKey(priv)` 相应支持。

私钥指数的位数对齐 OpenSSL 的 named-group `keylength`（modp5=200、modp14=225、modp15=275、modp16=325、modp17=375、modp18=400），从 `[1, 2^bits]` 均匀取样；非 named-group（如 modp1、显式随机素数）用 `bits(p) - 2` 位（`BN_RAND_TOP_ONE`），且 `g == 2 && p % 8 == 3` 时清 bit 0。显式传入与标准组相同的 p/g 时按 `ossl_ffc_numbers_to_dh_named_group` 归到该 named group。新增 `modp.ts` 的 `modpGroupPrivateBits`/`modpGroupPrivateBitsForParams`。

**改了什么（M92.2）**：`crypto.diffieHellman({ privateKey, publicKey })` 从「抛 not implemented」改为真实现：DH 算 `y_b^{x_a} mod p` 并按 prime 字节长补齐，EC 算 `d_a · Q_b` 的 x 坐标并按曲线字节长补齐；两者密钥类型/参数不一致时报 `ERR_CRYPTO_INCOMPATIBLE_KEY`（`Incompatible key types for Diffie-Hellman: dh and rsa`）与 `ERR_OSSL_MISMATCHING_DOMAIN_PARAMETERS`。顺带修了 `export()` 的 `type` 错误分支（之前统一报 `pkcs1` 文案，现改为与 Node 一致的 `ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS` + 按公私钥列举期望值）。

**验证（差分 0 diff）**：
- `test/crypto-dh-keys.test.ts`：`tools/crypto-dh-keys-probe.cjs` 在真 Node 与 web-node 内各跑一遭，**逐字节等于** `test/fixtures/crypto-dh-keys.json`（类型/重编码/round-trip/导出错误面/DER 长度）。
- `test/crypto-dh-secret.test.ts`：`tools/crypto-dh-secret-probe.cjs` 同法对比 `test/fixtures/crypto-dh-secret.json`（DH/EC 固定夹具共享密钥 + 交叉/边界错误）。
- demo 新增 DH 段落（`dh shared secret`/`dh agreement`/`dh spki round-trip`/`ecdh shared secret`）。
- 门禁：`tsc` 干净 · vitest **954 passed / 2 skipped（94 文件）** · build worker **2408.71 kB**。

**为什么**：阶段 A crypto 收尾，按 `docs/ROADMAP.md`（M92 开工前发现 DH KeyObject 缺失，已拆为 M92.1/M92.2 并在路线图注明）。

### 2026-09-22 · M90.8 + M90.9 截断变体/复合摘要 + getHashes 全表对齐（81/81）

**改了什么（M90.8）**：
- `hash.ts` 新增 `sha512_224`/`sha512_256`（SHA-512/t，FIPS 180-4 §5.3.6 专用 IV，输出 28/32）与 `sha256_192`（SHA-256 截断到 24 字节），复用已有的 `sha2_64`/`sha2_32`（它们本就支持自定义 IV 与截断）；新增 `md5sha1`（`md5||sha1`，36 字节）。
- 注册：`sha-256/192`（别名 `sha2-256/192`/`sha256-192`）、`sha-512/224`（别名 `sha2-512/224`/`sha512-224`/`RSA-SHA512/224`/`sha512-224WithRSAEncryption`）、`sha-512/256`（同类别名）、`md5-sha1`；给 `md5`/`sha1` 补 `ssl3-md5`/`ssl3-sha1`，给 `sha224/256/384/512` 补 `sha2-*` 别名。

**改了什么（M90.9）**：新增全表差分门禁 `test/crypto-gets-hashes.test.ts`：fixture 录自真 Node（`tools/crypto-gets-hashes-probe.cjs` → `tools/crypto-gets-hashes-oracle.mjs` → `test/fixtures/crypto-gets-hashes.json`，含 **81 个名字 + 每个名字的摘要**）。测试**不依赖我方列表**：直接断言 `getHashes()` 等于真 Node 的 81 名列表，且每个名字 `createHash(name).update('abc')` 与真 Node 逐字节一致。

**结果**：`getHashes()` 从 12（M90.1 前）→ **81**，与真 Node **完全一致**（missing/extra 均为 0）。

**验证**：
- `test/fixtures/crypto-hashes.json` 扩到 **43 个名/长度组合**（含 sha-256/192、sha-512/224、sha-512/256、md5-sha1、ssl3-*） → `test/crypto-hashes.test.ts` **0 diff**；新增全表门禁 2 项全过。
- 门禁：`tsc` 干净 · vitest **950 passed / 2 skipped（94 文件）** · build worker **2402.62 kB**。

**为什么**：阶段 A crypto 收尾，按 `docs/ROADMAP.md`。M90（`createMac`/`getMacs` + `getHashes` 全表）至此全部完成（M90.1–M90.9）。

**涉及文件**：`src/node-runtime/crypto/hash.ts`、`test/crypto-gets-hashes.test.ts`（新增）、`tools/crypto-gets-hashes-probe.cjs`（新增）、`tools/crypto-gets-hashes-oracle.mjs`（新增）、`test/fixtures/crypto-gets-hashes.json`（新增）、`tools/crypto-hashes-probe.cjs`、`test/fixtures/crypto-hashes.json`、`docs/ROADMAP.md`。

### 2026-09-22 · M90.7 SM3 + RIPEMD-160

**改了什么**：两个新的纯 JS 摘要实现，并注册进 `hash.ts` 的 `DEFS`：
- `crypto/sm3.ts`（GB/T 32905-2016）：64 字节块、256 位摘要，FF/GG/P0/P1 与消息扩展按规范实现。
- `crypto/ripemd160.ts`（ISO/IEC 10118-3）：64 字节块、160 位摘要，双平行线 80 轮 + 五套轮函数/常量/消息序列/循环移位表（小端输出）。
- 注册：`sm3`（别名 `RSA-SM3`/`sm3WithRSAEncryption`）、`ripemd160`（别名 `ripemd`/`ripemd-160`/`rmd160`/`RSA-RIPEMD160`/`ripemd160WithRSA`）。

**验证**：差分语料 `test/fixtures/crypto-hashes.json` 扩到 **31 个名/长度组合**（新增 sm3/RSA-SM3/ripemd160/ripemd-160/rmd160/RSA-RIPEMD160），`test/crypto-hashes.test.ts` **0 diff**；单测加了 SM3/RIPEMD-160/BLAKE2b-512 的官方向量。`getHashes()` 52 → **58**。
- 门禁：`tsc` 干净 · vitest **948 passed / 2 skipped（93 文件）** · build worker **2401.70 kB**。

**涉及文件**：`src/node-runtime/crypto/sm3.ts`（新增）、`src/node-runtime/crypto/ripemd160.ts`（新增）、`src/node-runtime/crypto/hash.ts`、`test/crypto-hashes.test.ts`、`tools/crypto-hashes-probe.cjs`、`test/fixtures/crypto-hashes.json`、`docs/ROADMAP.md`。

### 2026-09-22 · M90.6 注册 BLAKE2b-512 / BLAKE2s-256

**改了什么**：`crypto/hash.ts` 的 `DEFS` 新增两项，复用 M90.1/M90.4 的 `blake2b.ts`/`blake2s.ts`（无 key/salt/personal 的普通摘要形式）：`blake2b512`（别名 `blake2b-512`，block 128）与 `blake2s256`（别名 `blake2s-256`，block 64）。

**验证**：差分语料 `test/fixtures/crypto-hashes.json` 扩到 **25 个名/长度组合**（新增 blake2b512/blake2b-512/blake2s256/blake2s-256）—— `test/crypto-hashes.test.ts` **0 diff**。`getHashes()` 48 → **52**。
- 门禁：`tsc` 干净 · vitest **947 passed / 2 skipped（93 文件）** · build worker **2398.11 kB**。

**涉及文件**：`src/node-runtime/crypto/hash.ts`、`tools/crypto-hashes-probe.cjs`、`test/fixtures/crypto-hashes.json`、`docs/ROADMAP.md`。

### 2026-09-22 · M90.5 SHA-3 / Keccak / SHAKE / keccak-kmac 注册（先拆路线图）

**先改路线图（按唐工要求）**：动手前实测真 Node 的 `getHashes()` 有 **81 个可用名字**（远不是原先以为的十来种），包含 SHA-3/Keccak/SHAKE/keccak-kmac/blake2/SM3/RIPEMD-160/SHA-512-t/SHA-256-192/md5-sha1 及大量 `RSA-*`/`…WithRSAEncryption` 别名。原估「中低」严重偏低 → 先将 M90.5 **拆为 M90.5–M90.9**（任务数 30 → 34），本次先完成 M90.5。

**改了什么**：
- `crypto/keccak.ts` 新增导出：`keccak224/256/384/512`（原始 Keccak 的 0x01 padding）与 `keccakKmac(bit, input, outLen)`（pad 0x04，rate 168/136）。
- `crypto/hash.ts`：`HashAlgo` 新增 `xof`/`defaultOutputLength`，`DigestFn` 改为可接 `outputLength`；`DEFS` 注册 `sha3-224/256/384/512`（别名 `RSA-SHA3-*`、`id-rsassa-pkcs1-v1_5-with-sha3-*`）、`keccak-224/256/384/512`、`shake128/256`（别名 `shake-128/256`）、`keccak-kmac-128/256`（别名 `keccak-kmac128/256`）。
- `builtins/crypto.ts` 的 `Hash`：支持 `options.outputLength`；XOF 缺省输出 **shake128=16 / shake256=32**；非 XOF 传 `outputLength` → `ERR_OSSL_EVP_NOT_XOF_OR_INVALID_LENGTH`；`createHash` 接上 `options`（arity 2，与 Node 一致）。

**关键发现**：OpenSSL 的 `keccak-kmac-128/256` 不是带密钥的 KMAC，而是**裸 Keccak sponge**（pad 0x04、rate 168/136，默认输出 32/64）——从 `deps/openssl/.../sha3_prov.c` 的 `KMAC_newctx(..., '\x04')` 确认，实测与我们的 `keccak(rate,0x04,...)` 逐字节一致。

**验证**：
- 新差分语料 `tools/crypto-hashes-probe.cjs` → `test/fixtures/crypto-hashes.json`（21 个名字×输出长度 × 5 条消息 + 错误面），`test/crypto-hashes.test.ts` 同程序跑，**0 diff**。
- demo 新增 `sha3-256` / `shake128` 演示（值已与真 Node 核对）；`getHashes()` 从 12 → **48** 个名字。
- 门禁：`tsc` 干净 · vitest **947 passed / 2 skipped（93 文件）** · build worker **2397.93 kB**。

**为什么**：阶段 A crypto 收尾，按 `docs/ROADMAP.md`。

**涉及文件**：`src/node-runtime/crypto/keccak.ts`、`src/node-runtime/crypto/hash.ts`、`src/node-runtime/builtins/crypto.ts`、`src/demo-project.ts`、`test/crypto-hashes.test.ts`（新增）、`tools/crypto-hashes-probe.cjs`（新增）、`tools/crypto-hashes-oracle.mjs`（新增）、`test/fixtures/crypto-hashes.json`（新增）、`docs/ROADMAP.md`。

### 2026-09-22 · M90.4 BLAKE2s MAC / Poly1305 / SipHash（顺带修正 M90.1 的 salt/customization 缺口）

**改了什么**：
- 新增三个原语模块：`crypto/blake2s.ts`（BLAKE2s，含完整参数块的 key/salt/personal）、`crypto/poly1305.ts`（RFC 8439 §2.5）、`crypto/siphash.ts`（SipHash-2-4；**匹配 OpenSSL 的默认 16 字节输出**，即 SipHash 论文的 128-bit 变体——v1 在 init、v2 在 final 各 ^= 0xee；`outputLength:8` 回到经典 64-bit 变体）。
- `builtins/crypto.ts` 的 `Mac` 接入 `blake2smac`/`poly1305`/`siphash`，并把「哪些选项合法、其余按什么顺序报错」抽成一张表：**固定顺序 digest → cipher → iv → customization → salt → outputLength**（实测对齐）。

**发现并修正真 bug（M90.1 遗留）**：BLAKE2b/BLAKE2s 的 `salt`/`customization`（即参数块里的 salt/personalization）**是支持的**，会改变摘要；M90.1 只做了字节类型校验却**丢弃了它们**（传 salt 时静默算错）。差分语料现在把这两个字段纳入正向用例；blake2b/blake2s 的 salt/personal 已接进参数块。

**踩坑**：BLAKE2s 的参数块里 **salt 在字 4-5、personal 在字 6-7**（字节 16-23 / 24-31）；第一版写成了字 2-3/4-5，salt 与 personal **互换了**，被差分语料当场抳出。

**关键语义（逐个实测）**：blake2s 输出/密钥 ≤ 32、salt/customization ≤ 8（超长 → `ERR_OSSL_INVALID_SALT_LENGTH` / `INVALID_CUSTOM_LENGTH`）；blake2b 同理 ≤ 64 / ≤ 16；poly1305 密钥必须 32 字节；siphash 密钥必须 16 字节、输出只能是 8 或 16（其他 → `ERR_CRYPTO_OPERATION_FAILED`；`outputLength:0` → `... was not honored by MAC siphash`）。`hmac` 只收 `digest`，`kmac` 只收 `customization`/`outputLength`。

**验证**：
- `test/fixtures/crypto-mac.json` 扩到 **78 个错误项**（含所有 provider 的选项组合）+ blake2b/blake2s 的 salt/custom 正向向量 + poly1305（RFC 8439 §2.5.2）+ siphash（含标准键的 16 字节输出）—— `test/crypto-mac.test.ts` 同程序跑，**0 diff**。
- demo 新增 blake2smac/poly1305/siphash 演示段（值已在真 Node 核对一致）。
- 门禁：`tsc` 干净 · vitest **942 passed / 2 skipped（92 文件）** · build worker **2395.53 kB**。
  - 注：并发跑全套时 `test/worker.test.ts` 的 stdio 用例偶发 flake（计时敏感，单跑必过）；与本次改动无关，已记待整治。

**为什么**：阶段 A crypto 收尾，按 `docs/ROADMAP.md`。M90.1–M90.4 全部完成（`createMac`/`getMacs` 的全部 11 个 provider）。只剩 M90.5（把 sha3/blake2b512/blake2s256 接进 `getHashes` + SM3/RIPEMD-160）。

**涉及文件**：`src/node-runtime/crypto/blake2s.ts`（新增）、`src/node-runtime/crypto/blake2b.ts`、`src/node-runtime/crypto/poly1305.ts`（新增）、`src/node-runtime/crypto/siphash.ts`（新增）、`src/node-runtime/builtins/crypto.ts`、`src/demo-project.ts`、`test/crypto-mac.test.ts`、`tools/crypto-mac-probe.cjs`、`test/fixtures/crypto-mac.json`、`docs/ROADMAP.md`。

### 2026-09-22 · M90.3 CMAC / GMAC（复用纯 JS AES）

**改了什么**：
- `src/node-runtime/crypto/cipher.ts` 新增两个原语：`aesCmac`（NIST SP 800-38B，子密钥 K1/K2 + CBC-MAC）与 `aesGmac`（NIST SP 800-38D，对 AAD 做 GHASH 后 XOR E(J0)）；二者直接复用文件内已有的 `AesKey`/`Ghash`/`computeJ0`。
- `builtins/crypto.ts` 的 `Mac` 接入 `cmac`/`gmac`（新增 `#iv`）：`options.cipher` 必填；CMAC 要求 CBC 模式、key 长度必须等于 cipher 密钥长；GMAC 要求 iv 非空、GCM 模式、key 长度对齐。

**校验顺序（逐个实测对齐 Node）**：
1. `cipher` 缺失 → `The property 'options.cipher' is required for CMAC/GMAC`（优先于其他选项，也优先于 cipher 合法性）。
2. CMAC：`iv` → `customization` → `salt` → `outputLength` 逐项报 `... is not supported by MAC cmac`。
3. GMAC：先判 `iv` 非空（`... must be non-empty for GMAC`，**先于** cipher 合法性），再 `customization` → `salt` → `outputLength` 报不支持。
4. 未知 cipher → `ERR_OSSL_EVP_UNSUPPORTED`；模式不对（如 cmac+aes-128-gcm、cmac+aes-128-ecb、gmac+aes-128-cbc）→ `ERR_OSSL_INVALID_MODE`。
5. key 长度不对：CMAC → `ERR_OSSL_EVP_INVALID_KEY_LENGTH`（`error:03000082…`）；GMAC → `ERR_OSSL_INVALID_KEY_LENGTH`（`error:1C800069…`）。

**已知偏离**：非 AES 的 CBC 块密码（`des-ede3-cbc`/`camellia-128-cbc`/`aria-128-gcm` …）Node 能算，web-node 响亮抛 `NotImplementedError`（本运行时的 cipher 只到 AES）。

**验证**：
- `test/fixtures/crypto-mac.json` 扩 cmac/gmac（aes-128/192/256、空消息、块对齐 16/32/64、大写 cipher、secret KeyObject、iv 7/16 字节、错误面共 51 项）—— `test/crypto-mac.test.ts` 内跑同程序，**0 diff**。
- demo 新增 cmac/gmac 演示段（值已在真 Node 核对一致）。
- 门禁：`tsc` 干净 · vitest 全绿（新增单元断言） · build worker 约 2.39 MB。

**为什么**：阶段 A crypto 收尾，按 `docs/ROADMAP.md`。剩 M90.4（BLAKE2s MAC / Poly1305 / SipHash）与 M90.5（getHashes）。

**涉及文件**：`src/node-runtime/crypto/cipher.ts`、`src/node-runtime/builtins/crypto.ts`、`src/demo-project.ts`、`test/crypto-mac.test.ts`、`tools/crypto-mac-probe.cjs`、`test/fixtures/crypto-mac.json`、`docs/ROADMAP.md`。

### 2026-09-22 · M90.2 KMAC128 / KMAC256（Keccak / SHA-3 / cSHAKE 落地）

**改了什么**：
- 新建 `src/node-runtime/crypto/keccak.ts`：单个 Keccak-f[1600] 置换 + sponge，向上提供 **SHA3-224/256/384/512**、**SHAKE128/256**，以及 NIST SP 800-185 的 **cSHAKE128/256**（`left_encode`/`right_encode`/`encode_string`/`bytepad`）与 **KMAC128/256**。
- `builtins/crypto.ts` 的 `Mac` 接入 `kmac-128`/`kmac-256`（新增 `#customization`）：默认输出 32/64 字节、`customization` 映射到 `S`、key 长度 < 4 → `ERR_OSSL_INVALID_KEY_LENGTH`、`options.digest` 不支持 → `The property 'options.digest' is not supported by MAC <name>`。

**踩坑（重要）**：KMAC 的尾部是 `right_encode(L)`，L 是**输出比特长度**（KMACXOF 才用 `right_encode(0)`）。第一版写成 0，导致 SP 800-185 sample#1 完全对不上（`31a4…` vs `3b1f…`）；改回 `right_encode(outputLen*8)` 后逐字节对齐 OpenSSL。

**关键语义**：OpenSSL 对 KMAC key 的**最小长度是 4 字节**（1/2/3 报 `ERR_OSSL_INVALID_KEY_LENGTH`，4 起正常）；`outputLength: 0` 合法（输出空）。

**验证**：
- 差分语料 `test/fixtures/crypto-mac.json` 已扩 KMAC：sample#1/#2/#4/#5/#6、默认/自定义长度、customization、空消息、key 长度扫描（1–64）、错误面 32 项 —— `test/crypto-mac.test.ts` 内跑同程序，**0 diff**。
- 新增 `test/keccak.test.ts`：FIPS 202 的 SHA3-224/256/384/512（空串+“abc”）、SHAKE128/256、SP 800-185 cSHAKE128 sample#1、KMAC sample#1/#4 官方向量 **全中**。
- 门禁：`tsc` 干净 · vitest **940 passed / 2 skipped（92 文件）** · build worker **2387.44 kB** · demo 新增 KMAC 演示段跑通。

**为什么**：阶段 A crypto 收尾，按 `docs/ROADMAP.md`。KMAC 依赖的 Keccak/SHA-3/cSHAKE 一并落地，**为 M90.5 补 `getHashes` 铺好了 SHA-3 的一半**（只剩接 `DEFS` + SM3/RIPEMD-160/BLAKE2b-512/BLAKE2s-256）。

**涉及文件**：`src/node-runtime/crypto/keccak.ts`（新增）、`src/node-runtime/builtins/crypto.ts`、`src/demo-project.ts`、`test/keccak.test.ts`（新增）、`test/crypto-mac.test.ts`、`tools/crypto-mac-probe.cjs`、`test/fixtures/crypto-mac.json`、`docs/ROADMAP.md`。

### 2026-09-22 · M90.1 MAC 前端 + HMAC / BLAKE2b MAC（差分语料驱动）

**改了什么**：`crypto.createMac` / `crypto.getMacs` 从响亮抛错的桩换成真实实现（第一阶段）。
- `builtins/crypto.ts` 新增 `Mac` 类（extends 本地 `LazyTransformBase`）、`createMac`、`getMacs`，校验链逐个复刻 Node `internal/crypto/provider_mac.js`：`algorithm` 的 `validateName`（字符串/非空/无 NUL）、`options` 对象、`options.digest`/`cipher`（name）、`iv`/`customization`/`salt`（字节源）、`outputLength`（uint32）、`key`（KeyObject 限 secret，或 ArrayBuffer/view）、未知算法 → `ERR_CRYPTO_INVALID_MAC`。
- 已支持：**HMAC**（复用 `hash.ts` 的 hmac）与 **BLAKE2b MAC**（复用 M89 新增的 keyed `blake2b.ts`，已实测与 OpenSSL blake2bmac 逐字节一致）。
- 其余 provider（`blake2smac`/`cmac`/`gmac`/`kmac-128`/`kmac-256`/`poly1305`/`siphash`）响亮抛 `NotImplementedError`（按 M90.2–M90.4 推进）；但 `cmac`/`gmac` 缺 `options.cipher` 时仍与 Node 一致报 `The property 'options.cipher' is required for ...`。

**关键语义**：
- `getMacs()` 返回 11 项（与 Node 排序一致）；`createMac` arity = 3、`getMacs` arity = 0。
- `Mac` 是 `Transform` 流（`write`/`end` → `data` 事件），同时有 `update`/`final`；`final('hex'|'base64'|'buffer')`。
- `ERR_CRYPTO_MAC_FINALIZED`（`MAC already finalized`）、`ERR_CRYPTO_MAC_UPDATE_FAILED`、`outputEncoding`/`inputEncoding` 非法 → `ERR_INVALID_ARG_VALUE`。
- HMAC 缺 digest → `The property 'options.digest' is required for HMAC`；未知 digest → `ERR_OSSL_EVP_UNSUPPORTED`；blake2bmac 传 digest → `not supported by MAC blake2bmac`；key 长度 ∉[1,64] → `ERR_OSSL_INVALID_KEY_LENGTH`；outputLength ∉[1,64] → `ERR_OSSL_NOT_XOF_OR_INVALID_LENGTH`。

**为什么**：阶段 A crypto 收尾（`docs/ROADMAP.md`）。**发现并修正路线图问题**：`getMacs()` 实际暴露 11 个 provider，原估「低–中」偏乐观 → 已将 M90 拆为 M90.1–M90.4，并新增 **M90.5（补齐 `getHashes` 面）**：web-node 的 `getHashes()` 只覆盖 md5/sha1/sha224/256/384/512，缺 sha3-\*/blake2b512/blake2s256/sm3/ripemd160（因此 `createHmac('ripemd160')` 目前也会响亮抛错）；任务数 26 → 30。

**验证**：
- 差分语料 `tools/crypto-mac-probe.cjs` → `test/fixtures/crypto-mac.json`（真 Node v26.9.0 录制）：`getMacs` 列表、HMAC×5 digest、BLAKE2b MAC×6 组、编解码、secret KeyObject、流接口、28 个错误 —— `test/crypto-mac.test.ts` 内跑同程序，**0 diff**。
- 门禁：`tsc` 干净 · vitest **934 passed / 2 skipped（91 files）** · build worker **2384.29 KB**（`dist/assets/index-BfWupA7d.js`）。
- demo 新增 M90.1 演示段，跑通。

**涉及文件**：`src/node-runtime/builtins/crypto.ts`、`src/demo-project.ts`、`test/crypto-mac.test.ts`（新增）、`test/fixtures/crypto-mac.json`（新增）、`tools/crypto-mac-probe.cjs`（新增）、`tools/crypto-mac-oracle.mjs`（新增）、`test/crypto-surface.test.ts`、`docs/ROADMAP.md`。

### 2026-09-22 · M89 Argon2（差分语料驱动）

**改了什么**：`crypto.argon2(Sync)` 从响亮抛错的桩换成真实实现。新增两个纯 JS 模块：
- `src/node-runtime/crypto/blake2b.ts`——BLAKE2b（RFC 7693），64 位字用 BigInt，支持变长摘要与 keyed 参数块。
- `src/node-runtime/crypto/argon2.ts`——Argon2（RFC 9106）：H0 / H'（`blake2b_long`）、BlaMka 压缩函数 G（先对 8 个 16 字组做列轮，再对交错行做行轮）、数据相关（d）/无关（i）/混合（id）三种索引生成（`index_alpha` 的平方映射、四段 slice、`ARGON2_SYNC_POINTS=4`、每 128 块重算地址）。

`builtins/crypto.ts` 逐个复刻 Node `internal/crypto/argon2.js` 的 `check()`：algorithm 字符串+`oneOf`（`ERR_INVALID_ARG_VALUE`）、`parameters` 对象、`message`/`nonce` 的字节源（含 string→UTF-8）、`byteLength` 边界、`parallelism`（1..2^24-1）、`tagLength`（>=4）、`memory`（>= 8*parallelism）、`passes`（>=1）、可选 `secret`/`associatedData`。

**关键语义**：
- 返回 **`Buffer`**（异步经 callback 回传）；`argon2` 必传 callback，否则 `The "callback" argument must be of type function`。
- `memory` 单位为 KiB，`segment_length = max(floor(m/(4p)), 2)`，`m' = segment_length*4*lanes`。
- 版本固定 `0x13`（19），因此 pass>0 的块填充为 XOR 模式。
- `ERR_INVALID_ARG_TYPE` 对**带点**名字（如 `parameters.parallelism`、`options.checks`）用 “property”措辞（已修正 primes/argon2 两处校验助手）。

**为什么**：接续阶段 A crypto 收尾（`docs/ROADMAP.md` 阶段 A / M89），纯 JS 可自洽、可用 RFC 官方向量硬验证。

**验证**：
- 差分语料 `tools/crypto-argon2-probe.cjs` → `test/fixtures/crypto-argon2.json`（真 Node v26.9.0 录制）：**RFC 9106 §5 三条官方向量**（argon2d/i/id）逐字节一致；7 组参数组合、完整错误面、arity、异步形式——`test/crypto-argon2.test.ts` 内跑同程序，**0 diff**。
- 原始件单测：BLAKE2b RFC 7693 向量、Argon2 三变体 RFC 9106 向量直测纯 JS 核心。
- 门禁：`tsc` 干净 · vitest **930 passed / 2 skipped（90 files）** · build worker **2378.26 KB**（`dist/assets/index-C3ZoHUWF.js`）。
- demo `src/demo-project.ts` 新增 M89 演示段（打印 RFC 9106 argon2id 向量），跑通且与真 Node 一致。

**涉及文件**：`src/node-runtime/crypto/blake2b.ts`（新增）、`src/node-runtime/crypto/argon2.ts`（新增）、`src/node-runtime/builtins/crypto.ts`、`src/demo-project.ts`、`test/crypto-argon2.test.ts`（新增）、`test/fixtures/crypto-argon2.json`（新增）、`tools/crypto-argon2-probe.cjs`（新增）、`tools/crypto-argon2-oracle.mjs`（新增）、`test/crypto-surface.test.ts`、`docs/ROADMAP.md`。

### 2026-09-22 · M88 素数生成与素性检验（差分语料驱动）

**改了什么**：`crypto.generatePrime(Sync)` / `checkPrime(Sync)` 从响亮抛错的桩换成真实实现。新增 `src/node-runtime/crypto/primes.ts`（纯 JS：小素数试除 + Miller-Rabin，前 13 个素数作基在 n < 3.3e24 下确定；n 更大用前 64 个素数作基；`modPow` 用 BigInt 模幂）。`builtins/crypto.ts` 里逐个复刻 Node `internal/crypto/random.js` 的校验与 `crypto_random.cc` 的 `AdditionalConfig`：`size` 的 `validateInt32(>=1)`、`options` 对象校验、`safe`/`bigint` 布尔、`add`/`rem` 的 bigint/字节源转换与负值范围错、`add` 位数超 `size` → `ERR_OUT_OF_RANGE('invalid options.add')`、`add <= rem` → `('invalid options.rem')`。

**关键语义**：
- **默认返回 `ArrayBuffer`**（不是 Buffer），`{bigint:true}` 才返回 bigint；长度 = `BN_num_bytes`（即 `ceil(size/8)`）。
- **无 `add`**：候选为奇数且**最高两位**置位（`BN_RAND_TOP_TWO`）。**有 `add`**：只置**最高一位**（`BN_RAND_TOP_ONE`，对应 `probable_prime_dh`），并满足 `p ≡ rem (mod add)`（`rem` 缺省为 1）。
- **`checks` 被忽略**：OpenSSL 3 provider 下 Node 走 `BN_check_prime`（自行选轮数），与 `checks` 无关，故本实现也不依赖它（仍校验）。
- **`size <= 1`**：与 Node 一致报 `ERR_OSSL_BN_BITS_TOO_SMALL`（`error:01800076:bignum routines::bits too small`）。

**为什么**：接续 M83–M87 的 crypto 非对称线（见 `docs/ROADMAP.md` 阶段 A），零依赖、纯 JS 可实现且完全可差分验证。

**验证**：
- 差分语料 `tools/crypto-primes-probe.cjs` → `test/fixtures/crypto-primes.json`（真 Node v26.9.0 录制）：确定性素性答案（含 2^61-1 / 2^127-1 / 2^256-189 / 2^521-1）、完整错误面、arity、异步形式、以及随机输出的结构不变量（字节/比特长度、top 位、同余）——`test/crypto-primes.test.ts` 内跑同程序，**0 diff**。
- 门禁：`tsc` 干净 · vitest **922 passed / 2 skipped（89 files）** · build worker **2369.58 KB**（`dist/assets/index-CyTrCQZJ.js`）。
- demo `src/demo-project.ts` 新增 M88 演示段，跑通并打印正确结果。

**涉及文件**：`src/node-runtime/crypto/primes.ts`（新增）、`src/node-runtime/builtins/crypto.ts`、`src/demo-project.ts`、`test/crypto-primes.test.ts`（新增）、`test/fixtures/crypto-primes.json`（新增）、`tools/crypto-primes-probe.cjs`（新增）、`tools/crypto-primes-oracle.mjs`（新增）、`docs/ROADMAP.md`。

### 2026-09-22 · 文档 · 新增 `docs/ROADMAP.md`（固定任务清单）

**改了什么**：新建 `docs/ROADMAP.md`——把原先散在 DEVLOG「下一步」里的滚动 backlog 固化成一份**正序、可勾选、带编号**的路线图。

**为什么**：此前只有「5 个 MVP 里程碑 + 4 个方向」的初始规划，其余 80 多个里程碑是边做边排、不可追溯。ROADMAP 明确回答「现在坐到哪、还剩多少」，并把用户的**构建工具链愿景（webpack/rspack）拍到最后**。

**内容**：进度总览（6 阶段 / 26 任务，剩 25 + 1 不做）+ 阶段 A–F（A crypto 收尾 M88–M94、B 语义深度 M95–M98、C 平台无对应物 M99–M101、D 常量小项 M102–M105、E 性能 M106–M107、F 构建工具链 M108–M112）+ 「已判定不做」（promise hooks）+ 「已完成总览（M1–M87）」。每条含实现要点/差分语料路径/依赖/风险。

**与 DEVLOG 的分工**：DEVLOG 记已发生的变更（倒序），ROADMAP 记还没做的事（正序）。

**涉及文件**：`docs/ROADMAP.md`（新增）。

### 2026-09-22 · M87 `crypto.X509Certificate` 真解析（差分语料驱动）

**实现**：新建 `src/node-runtime/crypto/x509.ts`（~810 行）——`crypto.X509Certificate` 从「存在但抛错」改为**真 DER/PEM 解析器**，站在 M83 已落地的纯 JS ASN.1（`der.ts`）之上，复刻 Node 的**可观测表面**（Node 那层是 OpenSSL `X509View`，页面里没有，只能按 OpenSSL 的打印助手逐字重建）。

**覆盖**：全部 getter（`subject`/`issuer`/`subjectAltName`/`infoAccess`/`validFrom`(ASN1_TIME 形 `MMM DD HH:MM:SS YYYY GMT`)/`validTo`/`validFromDate`/`validToDate`/`fingerprint`/`fingerprint256`/`fingerprint512`/`keyUsage`/`serialNumber`（大写冒号十六进制）/`signatureAlgorithm`/`signatureAlgorithmOid`/`raw`/`publicKey`（真 `KeyObject`）/`ca`/`issuerCertificate`）与方法（`toString`/`toJSON`/`checkHost`/`checkEmail`/`checkIP`/`checkIssued`/`checkPrivateKey`/`verify`/`toLegacyObject`），格式来自 OpenSSL 的 `X509_NAME_print_ex`（`kX509NameFlagsMultiline`）、`ASN1_TIME_print`、`PrintGeneralName`、`SafeX509InfoAccessPrint`、`BIGNUM` 与 DER/SKI 的十六进制打印。

**顺带补齐**：① `asym.ts` 给非对称 `KeyObject.export()` 加 **JWK 导出**（RSA `kty/n/e`+私钥 `d/p/q/dp/dq/qi`；EC `kty/crv/x/y`(+`d`)；Ed25519 `kty:'OKP'`——RSA 字段用**最小无符号**大端、EC 坐标定长到曲线字节数，均 base64url 无 padding，对齐 `SetEncodedValue`/`crypto_ec.cc` 真源）；② `checkPrivateKey`/`verify` 的报错改成 Node 的 `ERR_INVALID_ARG_VALUE('pkey', key)` 形状（`The argument 'pkey' is invalid. Received PublicKeyObject [KeyObject] {}`）。

**已知偏离/取舍**：`issuerCertificate` 恒 `undefined`（不回溯签发者，与 Node 未解析时一致）；链验证只做签名数学、不复刻 OpenSSL 的 CA/用途策略。

**验证**：新差分语料 `tools/x509-probe.cjs` → `test/fixtures/x509.json`（自签 leaf/CA 证书，含 PEM/DER 两种输入）逐字段 **0 diff**。门禁全绿：tsc 干净 · vitest **911 通过 / 2 预存 skip（88 文件）** · build worker **2364.15KB**。浏览器端到端：demo 新增 milestone 87 段（内嵌自签 leaf 证书），实测打印 `subject`（多 RDN 行）/`serialNumber`/SHA-256 指纹/SAN/有效期与 `checkHost` 通配匹配；**顺带修掉该段一处 demo 转义 bug**——`[ … ].join('\n')` 里的 `\n` 会被 demo-project 的外层模板串提前解码成真换行，生成的 `/project/index.js` 里单引号字符串因此断裂、编译报 `Invalid or unexpected token`（应写 `'\\n'`），修复后页内 Run 正常。（线上 worker = 本地 `runtime.worker-CWuHksWY.js`，2364256 字节，sha `edabf13885454f28`。）

### 2026-09-22 · M86 对称密钥生成 + FIPS 开关（差分语料驱动）

**实现**：`crypto.generateKeySync(type, options)` / `crypto.generateKey(type, options, callback)`（仅 `'hmac'` 与 `'aes'`，与 Node 一致），`crypto.getFips()`/`setFips()`。

**语义对齐**：
- `hmac` 的 `length` 为位数（`validateInteger(length, 'options.length', 8, 2**31-1)`），字节数 = `length >> 3`（100→12、257→32）；`aes` 的 `length` 必须为 128/192/256。
- 错误形状逐字对齐（`ERR_INVALID_ARG_TYPE`/`ERR_INVALID_ARG_VALUE`/`ERR_OUT_OF_RANGE`，含 `Received type string ('256')` 的引号形式与 aes 分支的 `Received '128'` 形式）；异步形式缺 callback → `The "callback" argument must be of type function.`。
- **顺带修两个历史 bug**（此次差分才暴露）：① `KeyObject.export()` 对 **secret** key 默认返回 PEM（应为裸字节 Buffer），`{format:'jwk'}` 返回裸 Uint8Array（应为 `{kty:'oct',k}`），非法 format 报文也对不上（应为 `must be one of: undefined, 'buffer', 'jwk'`）；② `KeyObject.equals()` 对 secret key 走 DER 比较导致永远 false（应比字节）。
- 新增 `bufferedClass(Base, factory, overrides?)` 的 `overrides` 支持，并把 `KeyObject` 也接上字节工厂（含 `KeyObject.from`），使 `createPrivateKey`/`createPublicKey`/`createSecretKey`/`new KeyObject()` 的 `export()` 返回运行时 `Buffer`。

**已知偏离**：本机 Node 构建的 `setFips(true)` 会真正启用 FIPS（`getFips()` 变 1）；web-node 无此能力，`setFips` 为 no-op、`getFips` 恒为 0（已在 DEVLOG 记录）。

**验证**：新差分语料 `tools/crypto-keygen-probe.cjs` → `test/fixtures/crypto-keygen.json` 逐字段 0 diff。门禁全绿：tsc 干净 · vitest **904 通过 / 2 预存 skip（87 文件）** · build worker **2346.66KB**。

### 2026-09-22 · M85 Diffie-Hellman（MODP 组 + 显式素数，差分语料驱动）

**实现**（`src/node-runtime/crypto/dh.ts`、`src/node-runtime/crypto/modp.ts`）：`createDiffieHellman`（两种重载）、`getDiffieHellman`/`createDiffieHellmanGroup`（Node 中同一函数对象）、`DiffieHellman`、`DiffieHellmanGroup`（纯 JS 大数模幂）。

**语义对齐（差分探测抓出的细节）**：
- 私钥大小取决于 OpenSSL 走的路径：**具名组**用推荐指数位并用 `TOP_ONE`（字节长度固定：modp5→25、modp14→29、modp15→35、modp16→41、modp17→47、modp18→50），**等于标准组的显式素数**同样用推荐位但 `TOP_ANY`（长度可变，如 modp14 28/29），**其余**从 `[2, p-2]` 均匀取（modp1/modp2 因此是整长 96/128）。
- `getPrime`/`getGenerator`/`getPublicKey`/`getPrivateKey` 返回**最短**大端字节；**共享密钥补齐到素数长度**。
- `setPrivateKey` **只存私钥**（不会推导公钥，这一点与 ECDH 不同）；`setPublicKey` 同理。
- `computeSecret` 先校验对端：`<= 1` → “Supplied key is too small”、`>= p-1` → “too large”（均 `ERR_CRYPTO_INVALID_KEYLEN`，`RangeError`）。
- 两个类不是继承关系（`group instanceof crypto.DiffieHellman === false`），且 `DiffieHellmanGroup` **没有** `setPublicKey`/`setPrivateKey`；`verifyError` 为实例自身不可写属性。

**顺带修复**：之前 ECDH/DH 方法返回裸 `Uint8Array`，而 Node 返回 `Buffer`。新增 `src/node-runtime/crypto/byte-out.ts` 的 `bufferedClass`（**用 `Proxy` 而非子类**，以保持 `prototype` 与 `instanceof` 与 Node 一致），由 builtin 层注入运行时 `Buffer` 工厂；ECDH 的 `convertKey` 静态方法也已返回 `Buffer`。

**验证**：新差分语料 `tools/crypto-dh-probe.cjs` → `test/fixtures/crypto-dh.json`（8 个组、显式素数固定向量、原型/arity/错误形状）逐字段 0 diff；crypto-enc 语料增补 Buffer 断言。门禁全绿：tsc 干净 · vitest **898 通过 / 2 预存 skip（86 文件）** · build worker **2344.68KB**。

**已知偏离**：`crypto.diffieHellman({ privateKey, publicKey })`（基于 DH KeyObject 的派生）仍未实现，继续响亮抛错。

### 2026-09-22 · M84 非对称加解密 + ECDH（差分语料驱动）

**RSA 加解密**（`src/node-runtime/crypto/asym.ts`）：
- `publicEncrypt`/`privateDecrypt`：**OAEP**（默认，支持 `oaepHash`/`oaepLabel`）与 **PKCS#1 v1.5**（含非零随机 PS、PS 长度 ≥ 8 校验）；`RSA_NO_PADDING` 直通。
- `privateEncrypt`/`publicDecrypt`：EME-PKCS1-v1_5 原始私钥/公钥运算对。
- 解密失败按 Node 报错形状：`ERR_OSSL_RSA_PKCS_DECODING_ERROR`。

**ECDH 密钥协商**（`src/node-runtime/crypto/ecdh.ts`）：`createECDH`/`ECDH` 类（`generateKeys`/`computeSecret`/`get|setPrivateKey`/`get|setPublicKey`）与 `ECDH.convertKey`；支持未压缩与压缩（0x02/0x03）SEC1 点编码（`ec.ts` 新增 `decodePublicKey`/`encodePublicKey`，NIST 素数均 ≡ 3 mod 4，用 `y^((p+1)/4)` 开方）。共享密钥为 x 坐标补齐到域长。

**与 Node 的细节对齐（被语料/探测抓出）**：`createECDH` **只接受 OpenSSL 曲线名**（`prime256v1` 可以、`P-256` 报 `ERR_CRYPTO_INVALID_CURVE`），与 `generateKeyPairSync('ec',{namedCurve})` 的宽容别名不同；且 v26 的 `crypto.ECDH` **没有 `getCurves` 静态方法**（已不暴露）。

**验证**：新差分语料 `tools/crypto-enc-probe.cjs` → `test/fixtures/crypto-enc.json`（固定密钥 + 真 Node 预生成 OAEP/PKCS1 密文与 ECDH 共享密钥），逐字段一致（0 diff）。门禁全绿：tsc 干净 · vitest **891 通过 / 2 预存 skip（85 文件）** · build worker **2330.50KB**。

### 2026-09-22 · M83 crypto 非对称面（RSA / EC / Ed25519，差分语料驱动）

**能力补齐**：`crypto` 的非对称部分此前全是 `unsupportedApi` 抛错，现在在浏览器里**真跑**：

- **纯 JS ASN.1 DER 编解码**（`src/node-runtime/crypto/der.ts`）：PKCS#1 / PKCS#8 / SPKI / SEC1、PEM 读写、`INTEGER`/`OID`/`BIT STRING` 等。
- **纯 JS 曲线数学**（`src/node-runtime/crypto/ec.ts`）：NIST **P-256/P-384/P-521**（仿射 + BigInt）与 **Ed25519**（扩展坐标）；ECDSA sign/verify（DER 与 IEEE-P1363）、Ed25519（确定性签）。
- **密钥与签名**（`src/node-runtime/crypto/asym.ts`）：`KeyObject`（`type`/`asymmetricKeyType`/`asymmetricKeyDetails`/`export`/`equals`）、`createPrivateKey`/`createPublicKey`/`createSecretKey`、`sign`/`verify`（含 `algorithm`/`key` 两种 options 形式）、`createSign`/`createVerify`（`stream.Writable` 子类）、`generateKeyPairSync`/`generateKeyPair`（rsa/ec/ed25519）、`getCurves`、`crypto.constants` 的 RSA padding/saltLength 常量。
- **算法**：RSA **PKCS#1 v1.5** 与 **PSS**（MGF1，saltLength 含 `DIGEST`/`MAX_SIGN` 负数语义）、SHA-1/224/256/384/512；**Ed25519 签名与 OpenSSL 逐字节一致**（确定性），RSA PKCS#1 v1.5 同样逐字节一致。
- 为什么纯 JS：WebCrypto 只有异步 API，而 Node 的 `sign`/`generateKeyPairSync` 是同步的，所以原语自实现、异步形式只是包裹。

**差分语料**（`tools/crypto-asym-probe.cjs` → `test/fixtures/crypto-asym.json`）：固定密钥（RSA/EC/Ed25519、PKCS#1/#8/SPKI/SEC1、PEM/DER）+ 真 Node 预生成的固定签名（RSA-PSS、ECDSA-DER、ECDSA-P1363）；比较 key 属性/导出 DER/签名字节/验证布尔/错误码/密钥生成往返。与真 Node v26.9.0 **逐字段一致**。

**被语料/复现抓出的两个真 bug**：

1. **P-384 素数写错**：常量 `p` 多了一段 `ffffffff`（长度 104 vs 96），`p` 可被 11 整除 → `pointAdd` 报 `modInverse: not invertible`。现改为 `a = p - 3` 推导，并用“G 在曲线上”自检。
2. **`Uint8Array.prototype.slice` 在 Node `Buffer` 上是视图**（不是拷贝！）━━ Ed25519 解码器里 `sub256()` 对签名做 `slice(0,32)` 后清符号位，**直接改掉了调用者的签名字节**，导致自己的合法签名被自己拒掉（~50% 概率，取决于 R 的符号位）。修为 `Uint8Array.from(subarray(...))`，并审查所有存密钥材料的拷贝点（`parseEdPrivate`/`parseSubjectPublicKeyInfo`/`createSecretKey`）。新增回归测试。

另：`crypto.constants` 不再为空（RSA padding / saltLength 常量），`generateKeyPairSync` 支持 `publicKeyEncoding`/`privateKeyEncoding`。门禁全绿：tsc 干净 · vitest **884 通过 / 2 预存 skip（84 文件）** · build worker **2324.62KB**。

### 2026-09-22 · M82 buffer 语义 + loader 注入全局遮蔽（差分语料驱动）

**方法**：新增 `tools/buffer-semantics-probe.cjs` / `tools/buffer-semantics-oracle.mjs` → `test/fixtures/buffer-semantics.json`，永久回归 `test/buffer-semantics.test.ts`。

**buffer 本体**：编码/解码（hex/base64/base64url/latin1/utf16le/ascii/binary）、`from`/`alloc`/`concat`/`compare`/`equals`/`isEncoding`/`byteLength`、slice/subarray 视图语义与写共享、整数/浮点/BigInt 读写、`copy`/`fill`/`swap*`、`toJSON`/迭代器、`poolSize`、错误码（`ERR_OUT_OF_RANGE`/`ERR_UNKNOWN_ENCODING`）……**逐字段与真 Node v26.9.0 一致，无需改动**。

**真正被语料抓出的 bug 在 loader**：观测程序第一行就是 `const { Buffer } = require('buffer')`，web-node 直接报 `Identifier 'Buffer' has already been declared`。原因是注入的全局（`Buffer`/`process`/`setTimeout`…）作为 CJS wrapper **形参**注入，而 `topLevelLexicalBindings` 只扫 `const <ident>` 的**浅层**形式，**漏掉解构**（`const { Buffer } = …`、`let WebSocket = class WebSocket …`）→ 与形参重名即编译失败。

- `topLevelLexicalBindings` 保持浅扫（避免手写完整 JS 解析器、误判 ASI），新增 `redeclaredIdentifier(message)`：**从 V8 的 `Identifier 'X' has already been declared` 报错里取名字**，丢掉该形参、重建参数表、**重试编译**（有界收敛）。
- 这是**真实世界级**修复：Vite 打包 chunk 里就有 `const { Buffer } = require('buffer')`（`dep-BK3b2jBa.js`）与 `let WebSocket = class WebSocket`——之前 M18（Vue SFC through Vite）会直接编译失败。

**验证**：buffer 差分逐字段一致；`test/loader-globals.test.ts` 新增 3 例（解构遮蔽 / class 遮蔽 / 无关语法错仍抛）。门禁全绿：tsc 干净 · vitest **874 通过 / 2 预存 skip（83 文件）** · build worker **2298.20KB**。

### 2026-09-22 · M81 fs 语义深度（差分语料驱动）

**方法**：同 M79/M80。新增 `tools/fs-semantics-probe.cjs`（只用公开 API，将临时目录名规范化后比较）、`tools/fs-semantics-oracle.mjs` → `test/fixtures/fs-semantics.json`、永久回归 `test/fs-semantics.test.ts`。

**修什么（全部由语料抓出）**

- **`fs.rmSync(dir, {recursive:true})` 报 `ENOTEMPTY`**：vendored `lib/fs.js` 以**位置参数**调 `binding.rmSync(path, maxRetries, recursive, retryDelay)`，而我们的 binding 写的是 `(path, opts)` → `recursive` 永远是 `undefined`，递归删目录失败。改为位置参数签名，并让缺失路径成为 no-op（`validateRmOptionsSync` 已在前置处理 `force`/`EISDIR`）。
- **`fs.mkdirSync(path, {recursive:true})` 返回值不对**：Node 返回**本次真正创建的第一个目录**（全链已存在则 `undefined`），旧实现总是 `undefined`。`MemoryVfs.mkdir` 现在返回 `firstCreated` 并沿 `binding.mkdir` 传回。
- **`fs.copyFileSync` 忽略 mode**：`COPYFILE_EXCL`(1) 不生效（目标已存在也不报错）。binding 改为传 `mode`，`MemoryVfs.copyFile` 在 `mode & 1` 且目标存在时抛 `EEXIST`。
- 顺带修正 `binding.mkdirSync`/`mkdir` 的签名对齐。

**验证**：差分语料（constants、Stats/Dirent 形状、错误 code/syscall/errno/message、fd API、promises、realpath、可选 surface…）**逐字段与真 Node v26.9.0 一致**；`test/fs-semantics.test.ts` 另加 2 个单测。门禁全绿：tsc 干净 · vitest **870 通过 / 2 预存 skip（81 文件）** · build worker **2297.88KB**。

### 2026-09-22 · M80 net 语义深度（差分语料驱动）

**方法**：同 M79。新增 `tools/net-semantics-probe.cjs`（只用公开 API）、`tools/net-semantics-oracle.mjs` → `test/fixtures/net-semantics.json`、永久回归 `test/net-semantics.test.ts`（web-node 跑同一程序，JSON 逐字段相等）。

**修什么（全部由语料抓出）**

- **`net.connect(options[, cb])` / `createConnection(options[, cb])` 不被支持**：旧代码只认 `(port, host, cb)`，传 options 对象会把端口当对象传给 `network.dial` → 连接失败。改为走 `normalizeArgs`（与 Node 同），两种调用形式都支持。
- **Socket 的可读侧没接真 Readable**：旧 `_attach` 直接 `emit('data')` 并手发 `'end'`，从未 `push()`，因此**永远不触发 `'close'`**（流永远不会被 autoDestroy）。改为 `this.push(buffer)` + `vsock.onEnd → push(null)`，并在 `vsock.onClose` 时 `destroy()`；现 `'connect'→'ready'→'data'→'end'→'close'` 全序列与 Node 一致。
- **`setEncoding` 接流自身**（`super.setEncoding`），不再另做手解（避免双重解码；`push` 的缓冲由 Readable 解码）。
- **默认值对齐**：`allowHalfOpen` 默认 `false`（旧为 true）；`timeout` 属性不再预设（Node 未调 `setTimeout` 时为 `undefined`）；`server.maxConnections` 不再预设为 `Infinity`（Node 默认为 `undefined`）。
- **`connect` 后补发 `'ready'`**（Node 在 `'connect'` 后紧跟 `'ready'`）。

**验证**：差分语料与真 Node v26.9.0 **逐字段一致**（含客户端/服务端事件序列、echo、字节计数、`readyState`、地址、`getConnections`、`close` 后 `address()===null`）；`test/net-semantics.test.ts` 另加 2 个单测（默认值/options 连接）。门禁全绿：tsc 干净 · vitest **867 通过 / 2 预存 skip（80 文件）** · build worker **2297.75KB**。

### 2026-09-22 · M79 http 语义深度（差分语料驱动）

**背景**：扫描器差分全清零后转入**语义深度**——让同一表面下的真调用与真 Node 观测等价。第一个目标选 `http`。

**方法（差分语料）**：新增 `tools/http-semantics-probe.cjs` ——**只用公开 API** 的观测程序（80 个观测点：模块静态、header API、连接/框架、报错码、客户端/服务端双方）。它在真 Node 上跑出 `test/fixtures/http-semantics.json`（`tools/http-semantics-oracle.mjs` 生成，已验证两次输出一致），再在 web-node 里跑同一程序，**两个 JSON 必须逐字段相等**（新增永久回归 `test/http-semantics.test.ts`）。

**修什么（全部由语料抓出）**

- **`http.METHODS` 缺 `QUERY`**（34→35）。
- **默认 `Content-Type` 不应存在**：旧 `#flush` 在用户没设时强加 `text/plain; charset=utf-8`，Node 不会。删除。
- **响应框架按 Node `_storeHeader` 重写**：不再“headers 非空就 keep-alive / 无 content-length 就 chunked”的一把抓，而是按 Node 逻辑：先发用户头 → 补 `Date` → `Connection: keep-alive` + `Keep-Alive: timeout=N`（或 `close`）→ 框架头（`Content-Length` 优先，否则 `Transfer-Encoding: chunked`）。
- **`Content-Length` 自动计算**：`res.end(body)` 在头未发时记录 `_contentLength`（`end()` 无体则为 `0`），与 Node 的 `write_`/`end` 一致；`res.write()` 流式则 chunked。
- **`Keep-Alive: timeout=5`**：`Server` 把 `keepAliveTimeout` 注入响应，`#flush` 据此发出（默认 5s）。
- **header 规范校验**：`setHeader`/`removeHeader`/`addTrailers` 现在跑 `validateHeaderName`/`validateHeaderValue`（`ERR_INVALID_HTTP_TOKEN`/`ERR_INVALID_CHAR`/`ERR_INVALID_HTTP_VALUE`）；headers 已发时抛带 `code` 的 `ERR_HTTP_HEADERS_SENT`（旧代码抛的是无 `code` 的裸 Error）。
- **`writeHead` 校验**：状态码 `| 0` 后越界抛 `ERR_HTTP_INVALID_STATUS_CODE`；二次调用抛 `ERR_HTTP_HEADERS_SENT('write')`。新增码 `ERR_HTTP_HEADERS_SENT`/`ERR_HTTP_INVALID_STATUS_CODE`/`ERR_HTTP_CONTENT_LENGTH_MISMATCH` 进 `internal-shims.ts` 的 `ERROR_CODES`。
- **`getHeaders()` 返回 null 原型对象**（`OutgoingMessage`/`ServerResponse`/`ClientRequest` 统一）；`IncomingMessage.headers`/`trailers` 也改为 null 原型（Node 如此，`__proto__` 才能当普通头名）。
- **单一 header 存储**：`OutgoingMessage` 的私有 `#headers` 改为子类共享的 `_headers`（lower-case 键）；`ServerResponse`/`ClientRequest` 删掉各自那份重复实现，杜绝「`getHeaderNames` 看得到、`getHeader` 查不到」的双头账。
- **`ClientRequest` 主机头**：构造时就设 `Host`（默认端口省略），`getRawHeaderNames()` 与 Node 一样以 `['Host', ...]` 开头。
- **请求框架**：GET/HEAD/DELETE/OPTIONS/TRACE/CONNECT 不带 `Content-Length`（旧代码无条件加 `content-length: 0`）；有实体方法按实体长度算。
- **`https` 默认端口 443**：`https.request` 合并 `{ protocol:'https:', _defaultPort:443 }`，`Host` 头与真 Node 一致。
- **响应完成后 `res.socket = null`**（客户端 `IncomingMessage`），与 Node `_http_client` 一致。

**验证**：差分语料 **80/80 与真 Node v26.9.0 逐字段一致**；`test/http-deep.test.ts` 增 2 例（header 存储/框架 + METHOD/prototype）、更新 2 处过时预期（Host 领先于用户头、流式才带 trailers）；门禁全绿：tsc 干净 · vitest **864 通过 / 2 预存 skip（79 文件）** · build worker **2297.73KB**。

### 2026-09-22 · M78 tls 原型/静态差分清零（扫描器差分全清零）

**目标**：收掉扫描器最后一块差分 `tls`(12)。

**改了什么**

- 新增 `src/node-runtime/builtins/tls.ts` 并把它从 `unsupported` 名单移出（`unsupported.ts` 现导出空 `unsupportedSpecs`，`unsupported()` 改为具名导出供 tls 复用）。
- 真实提供的面：
  - **类层级**：`SecureContext`、`Server extends net.Server`、`TLSSocket extends net.Socket`——`instanceof` 与特性检测与 Node 一致。
  - **`Server` 的 TLS 配置面**（无握手，照 `https.Server` 的做法**记录**材料）：`setSecureContext`/`addContext`（servername 必填）/`get|setTicketKeys`（真实 48 字节票据密钥存储，长度校验）/`_get|_setServerData`（十六进制往返）。
  - **`convertALPNProtocols(protocols, out)`**：纯线上格式编码（`<len><proto>` 前缀），带 Node 的零长/超 255/截断校验；array / Uint8Array / ArrayBufferView 三种输入都支持。
  - `TLSSocket` 原型上的 TLS 专属成员全部存在（`getCipher`/`getProtocol`/`getPeerCertificate`/`setServername`/`exportKeyingMaterial`/`renegotiate`…），其中 `isSessionReused()` 真返回 `false`、`disableRenegotiation`/`enableTrace` 为 noop。
- **响亮抛**（需真 TLS 引擎，浏览器里不可能）：`SecureContext`/`TLSSocket` 构造、`connect`/`checkServerIdentity`/`createSecureContext`/`getCACertificates`/`getCiphers`/`getCertificateCompressionAlgorithms`/`setDefaultCACertificates`，以及 `TLSSocket` 上取会话/证书/密钥材料的成员。未列出的属性仍走模块的「用到即抛」代理。
- `arity` 表按 oracle 对齐（`SecureContext:4`、`Server:2`、`TLSSocket:2`、`convertALPNProtocols:2`…）。
- `test/runtime.test.ts` 的 stub-import 用例更新：`tls` 已不是纯桩，改为验证 `createServer` 存在 + `getCiphers()` 抛 `ERR_WEB_NODE_NOT_IMPLEMENTED`。

**验证**：`test/stub-fidelity.test.ts` 再扩 3 例（tls 层级/Server 票据/ALPN+抛错）。扫描器：`tls` 12→0，**全模块差分清零**。门禁全绿：tsc 干净 · vitest **861 通过 / 2 预存 skip（78 文件）** · build worker **2297.26KB**。

### 2026-09-22 · M77 module 原型 / 静态差分清零

**目标**：收掉扫描器剩余差分中的 `module`(22)。

**改了什么**

- 新增 `src/node-runtime/builtins/source-map.ts`：**逐行移置** Node 的 `lib/internal/source_map/source_map.js`（源出 V8）——VLQ 解码、`sections` 处理、`findEntry` 二分、`findOrigin`、`payload`/`lineLengths`，私有方法全用 `#`（不在原型上），与 Node 可观测面一致。
- `module` 内建补全 Node 的成员：
  - **真实实现**：`wrap`/`wrapper`（CJS 包裹）、`constants.compileCacheStatus`、`_pathCache`、`getSourceMapsSupport`/`setSourceMapsSupport`（自洽标志位）、`findSourceMap`（无注册 → `undefined`）、`getCompileCacheDir`/`flushCompileCache`（`undefined`）、`enableCompileCache`（返回 `FAILED` 状态，诚实告知不可用）、`_initPaths`（`globalPaths=[]`）、`_resolveLookupPaths`、`Module.prototype.isPreloading`（`false`）、`Module.prototype.parent`（改原型访问器）、`SourceMap`。
  - **响亮抛**（这些需要 Node 自己的 CJS 加载器 / amaro TS 转换 / loader hooks，我们没有）：`_findPath`/`_load`/`_preloadModules`/`_readPackage`/`_stat`/`runMain`/`registerHooks`/`stripTypeScriptTypes`/`findPackageJSON`、`Module.prototype._compile`/`load`。
- `arity` 表按 oracle 对齐（如 `_load:3`、`_findPath:3`、`stripTypeScriptTypes:1`、`SourceMap:1`…）。

**验证**：`test/stub-fidelity.test.ts` 再扩 3 例（module 面/标志位/SourceMap 可用）。扫描器：`module` 22→0。门禁全绿：tsc 干净 · vitest **858 通过 / 2 预存 skip（78 文件）** · build worker **2292.19KB**。

> 剩余差分：`tls`(12)。

### 2026-09-22 · M76 http / https 原型差分清零

**目标**：收掉扫描器剩余差分中的 `http`(4)、`https`(2)。

**改了什么**

- **`http.OutgoingMessage`**（先前是空壳）补全 Node 的共享面：头操作 `setHeader`/`getHeader(s)`/`getHeaderNames`/`getRawHeaderNames`/`hasHeader`/`removeHeader`/`setHeaders`/`appendHeader`/`addTrailers`/`flushHeaders`/`setTimeout`；访问器 `socket`/`connection`/`headersSent`（`headersSent` 与 Node 一致为 `!!this._header`、getter-only）；内部管线 `_send`/`_writeRaw`/`_storeHeader`/`_renderHeaders`（`_header` 已置时抛 `ERR_HTTP_HEADERS_SENT`）/`_flush`/`_flushOutput`/`_finish`/`_isLenientHeaderValidation`/`_implicitHeader`（基类抛 `ERR_METHOD_NOT_IMPLEMENTED`，同 Node）。
- **`ServerResponse`**：`statusCode`/`statusMessage` 改为原型访问器（私有字段）；去掉自有 `socket`/`headersSent`/`connection`（改用基类访问器，避免 TS 「accessor vs property」冲突）；补 `_implicitHeader()` → `writeHead(statusCode)`。
- **`ClientRequest`**：`path` 改访问器；去掉自有 `#socket`（改用基类访问器）；补 `_renderHeaders`/`_implicitHeader`/`_deferToConnect`；`#send` 里把请求头写进 `_header`，让 `headersSent` 变真。
- **`IncomingMessage`**：`headers`/`trailers` 改为**惰性访问器**（首次读从 `rawHeaders`/`rawTrailers` 构建，可赋值）、`connection` 改访问器；移植 Node 的 `matchKnownFields`（大小写保留 + 去重标志）、`_addHeaderLine`（`', '` / `'; '` / Set-Cookie 数组 / 丢弃重复）、`_addHeaderLineDistinct`、`_addHeaderLines`、`_dump`、`_dumpAndCloseReadable`。
- **`https`**：不再把 `http` 整个照搬 —— 新增 **`https.Server`**（继承 `http.Server`，补 `setSecureContext`/`addContext`/`getTicketKeys`/`setTicketKeys`/`_getServerData`/`_setServerData`；TLS 物料只记录不参与握手；ticket keys 是一份 48 字节真随机密钥，可 get/set/集群往返）与 **`https.Agent`**（继承 `http.Agent`，带 Node 的 `_sessionCache` LRU：`_getSession`/`_cacheSession`/`_evictSession`）；`https.createServer` 返回 `HttpsServer`，`https.request`/`get` 默认 agent 为 `https.globalAgent`。

**验证**：`test/stub-fidelity.test.ts` 再扩 4 例（OutgoingMessage 面、IncomingMessage 折叠、https.Server、https.Agent）。扫描器：`http` 4→0、`https` 2→0。门禁全绿：`npm run typecheck` 干净 · `npx vitest run` **855 通过 / 2 预存 skip（78 文件）** · `npm run build` 绿（worker **2286.94KB**）。

> 注：`test/worker.test.ts` 的 worker stdio 子用例在并行负载下偶发（单跑稳定通过）——属既有计时敏感用例，与本轮改动无关。
> 剩余差分：`module`(22)、`tls`(12)。

### 2026-09-22 · M75 扫描器剩余差分第一批：console / child_process / zlib / v8 / net(+tty)

**目标**：扁平化原型链扫描器点出的「公开模块表面」剩余差分，先做便宜的那几块（`console`、`child_process`、`zlib`、`v8`、`net`/`tty`）。

**改了什么**

1. **`console` 的 inspector 扩展**：Node 在 bootstrap 时由 `internal/util/inspector.wrapConsole()` 把 V8 的 `context`/`createTask`/`profile`/`profileEnd`/`timeStamp` graft 到全局 console 上。我们无 inspector，改为在模块物化后经新的 **`BuiltinSpec.postInit` 钩子**装入（`builtins/console-extras.ts`）：`context(name)` 返回**非 Console 实例**的绑定命名空间（自带 `log`/`dirXml`…、无 `context`/`createTask`），`createTask(name)` 返回 `{ run }`（`run` 真执行函数），三个 profile/timeStamp 为 no-op；参数校验文案与 V8 逐字一致（`"First argument must be a non-empty string."` / `"First argument must be a function."`），`createTask`/`run` 的 `length` 都对齐 0。
2. **`child_process`**：补 `_forkChild(fd, serializationMode)`（无 OS IPC 通道 → 响亮抛，`length` 2）与 `ChildProcess.prototype.spawn`（真启动由宿主驱动 → 响亮抛，`length` 1）。
3. **`zlib`**：把 `ZlibBase` 的原型面补到真编解码类上——`_closed`（真状态）、`reset`、`flush(kind, cb)`（只支持 full flush / `Z_NO_FLUSH`，其余响亮抛）、`close(cb)`（结束并 `destroy`，回调在 `close`/`error` 上触发）、`params`（平台 codec 无对应面 → 响亮抛）、`_processChunk`（同步路径 → 响亮抛）；三个 Zip 类（`ZipBuffer`/`ZipEntry`/`ZipFile`）按 Node 补齐完整成员/静态面（全部响亮抛，无归档后端）。另修一个 spec 笔误（`ZipEntry`/`ZipFile` 的 arity 从 1 改 0）。
4. **`v8`**：`takeCoverage`/`stopCoverage` 改为**存在但响亮抛**（对齐出厂带 inspector 的 Node v26.9.0）——同样经 `postInit` 装入，`hasInspector:false` 不再让它们凭空消失。
5. **`net`**：`net.Socket` 把 `pending`/`readyState`/`bufferSize`/`bytesRead`/`bytesWritten`/`local*`/`remote*` 从**实例自有字段改成原型访问器**（`readyState` 按 Node 由 `connecting`/`readable`/`writable` 派生），补 `_handle`/`_connecting`/`_bytesDispatched`/`_getpeername`/`_getsockname`/`_onTimeout`/`_reset`/`_unrefTimer`/`_writeGeneric`/`destroySoon`/`resetAndDestroy`/`get|setTypeOfService`；`net.Server` 的 `listening` 改原型访问器、把绑定逻辑抽到 `_listen2`，补 `_setupWorker`（cluster 不可用 → 抛）/`_emitCloseIfDrained`；新增 `net.BoundSocket`（要真 OS 绑定 → 构造即抛）、`net._normalizeArgs`（真实现）、`net._createServerHandle`（抛）。

**验证**：`test/stub-fidelity.test.ts` 扩 8 例、`test/v8.test.ts` 更新 takeCoverage 期望。扫描器差分：`net` 7→0（连带 `tty` 4→0，tty 流即 net.Socket）、`console` 5→0、`child_process` 2→0、`zlib`/`v8` 清零。门禁全绿：`npm run typecheck` 干净 · `npx vitest run` **851 通过 / 2 预存 skip（78 文件）** · `npm run build` 绿（worker **2278.24KB**）。

> 剩余差分（下一批）：`module`(22)、`tls`(12)、`http`(4)、`https`(2)。

### 2026-09-22 · M74 crypto 流类改真 Transform（LazyTransform）

**目标**：`crypto.Hash`/`Hmac`/`Cipheriv`/`Decipheriv` 在 Node 是 `Transform` 子类（经 `internal/streams/lazy_transform.js`）。我们之前是手写子集（方法在实例上，原型链上没有流表面），特性探测与管道行为不符。

**改了什么**

1. **忠实复刻 `LazyTransform`**：继承真 `stream.Transform`，把 `_readableState`/`_writableState` 做成**原型访问器**（首次访问时才 `Transform.call(this, this._options)` 建态，并设 `decodeStrings=false`）。
2. `Hash`/`Hmac`/`Cipheriv`/`Decipheriv` 改继承 `LazyTransform`，把 AES/哈希状态放进**私有字段**、方法放回**原型**；补 `_transform`/`_flush`，于是**真能当流用**（`hash.write/end` + `'data'`/`'end'`、`cipher.pipe()` 都通）。
3. `createCipheriv`/`createDecipheriv` 直接返回真实例；校验逻辑抽成 `createCipherState`（错误码与消息不变）。
4. crypto spec `deps: ['stream']`。

> **关键坑**：`LazyTransform` 把 `_writableState.decodeStrings` 设为 `false`，于是 `_transform` 收到的是**原始字符串（不是 Buffer）**——必须 `this.update(chunk, encoding)`，不能假 `chunk.buffer`。我第一版就因此把 digest 算成了空串哈希（`e3b0c442…`）。

**验证**：`test/crypto-classes.test.ts` 扩到 7 例（含 `instanceof Transform`、hash/cipher 真管道）。扫描器 crypto 差分**清零**。门禁全绿：`tsc` 干净 · `npx vitest run` **843 通过 / 2 预存 skip（78 文件）** · `npm run build` 绿（worker **2271.58KB**）。

### 2026-09-22 · M73 crypto 桩类的原型保真

**目标**：M71 让“裸函数/匿名类”看起来像 Node；M73 沿同一思路，把 crypto 里**有类形状但没实现**的东西也补齐原型——特性探测（`instanceof`、`'sign' in x`）不再误判，但真调用仍**响亮抛错**。

**改了什么**

1. **`Sign`/`Verify` 改继承真 `stream.Writable`**（Node 里就是 `Writable` 子类）；补 `Sign.prototype.update`/`sign`、`Verify.prototype.update`/`verify`。构造仍抛（无后端）。
2. **`KeyObject`**：原型 `type`(getter)/`equals`/`toCryptoKey` + 静态 `from`。
3. **`X509Certificate`**：补齐 Node 的 28 个原型成员（`checkHost`/`fingerprint`/`publicKey`/`raw`/`subject`/`toJSON`/`verify`…）——从之前的裸抛函数改为具名类。
4. **`DiffieHellman`/`DiffieHellmanGroup`/`ECDH`** 补各自方法（`computeSecret`/`generateKeys`/`get|setPublicKey`…），`ECDH.convertKey` 静态。
5. **`Certificate`**：静态 + 原型三件套 `exportChallenge`/`exportPublicKey`/`verifySpkac`。
6. **`prng`/`pseudoRandomBytes`/`rng`**：按 DEP0115 补为 `randomBytes` 的**非枚举**别名（Node 如此）。
7. crypto spec 新增 `deps: ['stream']`（`Sign`/`Verify` 需 `Writable`）。

> **说明**：`Hash`/`Hmac`/`Cipheriv`/`Decipheriv` 在 Node 是 `Transform` 子类，我们暂仍是手写子集（方法在实例上而非原型）——列入 M74。

**验证**：新增 `test/crypto-classes.test.ts`（4 例）。门禁全绿：`npm run typecheck` 干净 · `npx vitest run` **840 通过 / 2 预存 skip（78 文件）** · `npm run build` 绿（worker **2270.14KB**）。

### 2026-09-22 · M72 导出函数 arity 对齐（`Function.length`）

**目标**：全模块扫描器点出各模块导出函数 `fn.length` 与 Node 不一致（我们多用 rest 参数 → 报 0，Node 报 1..5）。特性探测会读 `fn.length`（可选参数探测），所以要逐名对齐。

**改了什么**

1. 新增 `src/node-runtime/builtins/arity.ts`：`alignArity(target, arity)` 对每个名字若解析为函数，就**重定义其 `length` 属性**（`length` 是可配 own property，观测等价），返回自 `target` 便于直接包 `return {...}`。
2. `BuiltinSpec` 新增 `arity?: Record<string, number>`；`realm.ts` 在模块物化（export 装好后）调用 `alignArity`。
3. 逐模块填入真 Node v26.9.0 的 arity：`crypto`(46)/`http`(11)/`https`(5)/`net`(6)/`zlib`(24)/`dns`(14)/`process`(17)/`module`(2)/`child_process`(2)/`worker_threads`(2)/`perf_hooks`(1)/`v8`(1)/`console`(3)。

**验证**：新增 `test/arity.test.ts`（13 例，逐模块断言 `fn.length` 与真 Node 一致）。门禁全绿：`npm run typecheck` 干净 · `npx vitest run` **836 通过 / 2 预存 skip（77 文件）** · `npm run build` 绿（worker **2267.91KB**）。

### 2026-09-22 · M71 未实现表面的保真（stub 可被特性探测）

**目标**：全模块扁平化扫描器揭示，我们“故意不实现”的东西很多是**裸函数/无原型**的，特性探测（`instanceof`、`'m' in obj`、`fn.length`）会误判。这一里程碑让那些东西**看起来像 Node**，但真调用仍**响亮抛错**。

**改了什么**

1. **`http.Agent` 改继承 `EventEmitter`**（真 Node 的 `Agent` 就是 EventEmitter），补 `Agent.defaultMaxSockets = Infinity`。`agent instanceof require('events').EventEmitter` 成立，`on`/`emit`/`once`… 全套到位。
2. **`net.SocketAddress.parse(input)`**：忠实复刻 Node（用 `new URL('http://' + input)`）：hostname 带方括号 → IPv6（去括号），否则默认 IPv4；`port` 走 `Number(u.port) | 0`（**:`80` 是 http 默认端口，被 URL 解析器去掉 → 0**，与 Node 一致）；主机名非法/无法解析时返回 `undefined`（内部构造抛错被吞）；非字符串抛 `ERR_INVALID_ARG_TYPE`。
3. **`dns.Resolver` 补齐整套 query 方法**（`resolve*` 14 个 + `reverse` + `setLocalAddress`）：loopback 类型（`resolve4`/`resolve6`/`reverse`）真解析，其余保留“存在但抛 `NotImplementedError`”。
4. **`zlib` 的 Brotli/Zstd 桩类**从匿名裸类改为**继承真 `stream.Transform`** 的具名类（类名用 `defineProperty` 固定），于是原型/静态面（`pipe`/`read`/`write`/`Duplex`…）齐备、`Ctor.prototype instanceof Transform` 成立，但构造即抛；Zip 类保持普通类（无 codec）但仍具名。

**验证**：`test/stub-fidelity.test.ts`（4 例，**注意跨 realm `instanceof` 陷阱**：每次 `boot()` 会新建一个 runtime realm，类的 `instanceof` 必须用**同一个** runtime 里的构造函数——测试已修正）。门禁全绿：`npm run typecheck` 干净 · `npx vitest run` **823 通过 / 2 预存 skip（76 文件）** · `npm run build` 绿（worker **2265.66KB**）。

### 2026-09-22 · M70 `net.Socket` 改真 `stream.Duplex`

**目标**：M69 的扁平化原型链扫描器点出最大结构缺口——`net.Socket` 只继承 `EventEmitter`，缺整套流方法（`pipe`/`pause`/`resume`/`read`/`push`/`unshift`/`readableEnded`/HWM…）。手写补这些不如直接继承真 `stream.Duplex`。

**改了什么**（`src/node-runtime/builtins/net.ts`）

- `Socket extends stream.Duplex`（`super({ allowHalfOpen: true })`，保留半开语义），把所有流入数据/写出/结束/销毁桥到内部 `VirtualSocket`：
  - `_read()` —— 空实现（数据由 vsock 直推）。
  - `_write(chunk, enc, cb)` —— 写 vsock、累加 `bytesWritten`；无 vsock 时以 `EPIPE` 回调。
  - `_final(cb)` —— vsock.end()，`readyState='readOnly'`。
  - `_destroy(err, cb)` —— vsock.destroy(err)，`readyState='closed'`。
- 删除自实现的 `write`/`end`/`destroy`/`setEncoding`/`readableLength`/`writableLength` 与自有的 `#onClose`（改由流机制发 `close`）；**不再声明 `destroyed` 字段**（否则会遮蔽 `Duplex.destroyed` getter）。
- 保留 `connect`/`setNoDelay`/`setKeepAlive`/`setTimeout`/`ref`/`unref`/`address` 与状态字段（`readyState`/`remotePort`/`bytesRead`…）。
- `net` 的 `deps` 仍为 `['events']`；`stream` 在 init 顶部 `ctx.require` 取得（stream 不反向 require net，无循环）。

**验证**：`test/net-socket-stream.test.ts`（2 例）——`new net.Socket() instanceof stream.Duplex`、整套流方法/HWM（真 Node 默认 **65536**）、`net.Stream === net.Socket`，以及一个真回环 echo：服务端 `socket.pipe(socket)`、客户端 `setEncoding('utf8')` 收 `ping`、`bytesWritten/bytesRead` 计数正确。门禁全绿：`npm run typecheck` 干净 · `npx vitest run` **819 通过 / 2 预存 skip（75 文件）** · `npm run build` 绿（worker **2265.08KB**）。

### 2026-09-22 · M69 `http` 对象语义深度（1xx 中间响应 / trailers / 成员补齐）

**目标**：公开导出面收齐后，转入**语义深度**。先做一条更细的差分扫描器，再按它补齐 `http` 的客户/服务端对象语义。

**扫描器**：临时探针（跑完即删）逐模块比较 ① 导出函数的 arity、② 导出类的**扁平化原型链**可达成员与静态成员、③ `constants` 表的值。关键教训：**比较「原型 own 名单」会因继承产生假阳性**（例：`net.Socket` 继承 `Duplex` 时 `read`/`pause` 在父原型上），也把「类方法 vs 实例属性」误报为缺——因此又补了**运行时实测**（真跑一次 `http` 服务+请求，逐属性 `typeof`）才拿到真实缺口。

**改了什么**

1. **`STATUS_CODES` 全表**：从 34 项补到 Node 完整的 **63 项**（补上 102/103/203/205/207/208/226/300/305/402/406/407/411/412/414/416/417/421/423/424/425/426/428/431/451/505–511）。
2. **`http.Server`**：真默认值（`requestTimeout=300000`/`headersTimeout=60000`/`keepAliveTimeout=5000`/`maxRequestsPerSocket=0`/`timeout=0`）+ `setTimeout(msecs, cb)` + `closeAllConnections()` + `closeIdleConnections()`（后者只杀无在飞请求的 keep-alive 连接，靠 `Server` 侧 `#active` 集区分）；`net.Server` 加 `_sockets` 集合以便按策略关连接。
3. **`http.ServerResponse`**：`connection` getter（= socket）、`chunkedEncoding` getter、`setTimeout`、`setHeaders`（对象/键值对数组）、`appendHeader`、`addTrailers`（chunked 尾帧写入 `0\r\n<trailers>\r\n`）、`getRawHeaderNames`（保留原始大小写）、`assignSocket`/`detachSocket`，以及 **1xx 中间响应**：`writeInformation(statusCode, headers, cb)`（校验 100–199）/`writeContinue`(100)/`writeProcessing`(102)/`writeEarlyHints({link,…})`(103)。
4. **`http.IncomingMessage`**：`signal`（惰性 `AbortController`，destroy/abort 时 abort）、`headersDistinct`/`trailersDistinct`（值一律为数组，不 join）、`setTimeout`。
5. **`http.ClientRequest`**：`socket`/`connection` getter、`protocol`（`'http:'`）、`maxHeadersCount`（`null`）、`clearTimeout`、`onSocket`、`setNoDelay`、`setSocketKeepAlive`、`getRawHeaderNames`；`agent:false` 按 Node 改为**新建一次性 `Agent`**（`req.agent` 是 Agent 实例、keep-alive 关闭）。
6. **客户端两个真语义缺口**：① **跳过 1xx 中间响应**（reader 遇 100–199（非 101）直接继续读下一个 head，不再把它当最终响应）；② **解析 chunked trailer** 到 `res.trailers`/`rawTrailers`（reader 新增 `onTrailer` 回调，重复值按 Node 逗号连接）。

**验证**：`test/http-deep.test.ts`（7 例）——`STATUS_CODES` 全表、`Server` 默认值与关连接、`ServerResponse` 成员 + 1xx + trailer 端到端、`writeInformation` 参数校验、`IncomingMessage` 的 signal/distinct/timeout、`ClientRequest` 的 socket getter/header 名/timers。门禁全绿：`npm run typecheck` 干净 · `npx vitest run` **817 通过 / 2 预存 skip（74 文件）** · `npm run build` 绿（worker **2265.53KB**）。

### 2026-09-22 · M68 `process` 语义深度（`env` 异质代理 + 剩余内部量）

**目标**：扫描器排出的公开面缺口只剩 `process` 的 19 个下划线内部量，这次一并收尾，并把 `process.env` 的语义做成真的一致。

**改了什么**

1. **`process.env` 改为异质代理**（`src/node_env_var.cc` 语义）：写入经 `ToString` 强转（**符号值会抛** `Cannot convert a Symbol value to a string`，而不是变成 `Symbol(x)`）；`delete`/`in` 正常；原型是 `Object.prototype`；只接受可配置/可写/可枚举的数据描述符（否则报 `'process.env' only accepts a configurable, writable, and enumerable data descriptor`）；符号键直通。
2. **内部量补齐**（19 个全到位）：
   - 真实实现：`_rawDebug`（`util.format` 后写 stderr 并补换行）、`_fatalException`（按 Node 顺序分发：捕获回调 → `uncaughtException` 监听器 → 辅助回调，返回是否被接管）、`_preload_modules`（空数组，属实）、`finalization`（直译 `internal/process/finalization.js`，用 `WeakRef`+`FinalizationRegistry`）。
   - 存在但响亮抛错：`_getActiveHandles`/`_getActiveRequests`/`_tickCallback`（这些在 Node 是 C++ 侧的句柄枚举与同步 tick 渡，我们既不追踪句柄对象也不暴露同步渡，所以不编造列表；`getActiveResourcesInfo()` 是公开且真实的替代）、`_kill`/`_debugProcess`/`_debugEnd`/`_startProfilerIdleNotifier`/`_stopProfilerIdleNotifier`/`dlopen`/`execve`/`initgroups`/`setegid`/`seteuid`/`setgroups`。
   - **`moduleLoadList` 返回空数组**（唯一一处文档化近似：Node 是 C++ 模块登记日志，我们不保留；不做抛错 getter，否则 `util.inspect(process)` 会炸）。

**验证**：新增 `test/process-internals.test.ts`（7 例）——env 强转/符号报错/描述符规则、`_rawDebug` 输出、`_fatalException` 返回与接管、`finalization`、全部“存在但抛错”符号。门禁全绿：`npm run typecheck` 干净 · `npx vitest run` **810 通过 / 2 预存 skip（73 文件）** · `npm run build` 绿（worker **2260.68KB**）。扫描后 `process` 缺口 **19→0**（仅余宿主环境自带的 IPC 相关键，与本运行时无关）。

### 2026-09-22 · M67 `http` 公开表面补齐（Agent / OutgoingMessage / 头校验器）

**目标**：收掉 `http` 的公开表面（之前缺 12 个）。https 只有 37 行的薄层，不涉。

**改了什么**

1. **`OutgoingMessage`**：把 `ServerResponse` / `ClientRequest` 改为继承新建的 `OutgoingMessage`（基类仍是 Writable），`res instanceof http.OutgoingMessage` 成立。
2. **`Agent` + `globalAgent`**：实现文档化 API（`options`/`maxSockets`/`maxFreeSockets`/`keepAlive`/`scheduling`/`timeout`/`getName`/`addRequest`/`removeSocket`/`keepSocketAlive`/`reuseSocket`/`destroy`）。`getName` 按 Node 格式 `${host}:${port}:${localAddress}`（默认 `localhost::`）；`globalAgent = new Agent({keepAlive:true, scheduling:'lifo', timeout:5000})`。`createConnection`/`createSocket` 抛 `NotImplementedError`（底层 dial 走运行时自己的连接缓存）。
3. **`ClientRequest` 支持 `agent` 选项**：`agent:false` → 关闭 keep-alive（真行为差异），`agent` 为 `Agent` 实例时继承其 `keepAlive`。
4. **头校验器**：`validateHeaderName` / `validateHeaderValue` 按 `lib/_http_common.js` 的 `checkIsHttpToken`/`checkInvalidHeaderChar` 与 `lib/_http_outgoing.js` 的包装逐字复刻（含 strict/lenient 两套字符正则）；`maxHeaderSize = 16384`。
5. **`_connectionListener`**：把 `Server` 每连接 HTTP 循环提为具名函数（Node 同名导出）。另补 `setMaxIdleHTTPParsers`（校验并存储）、`setGlobalProxyFromEnv`（无代理支持；仅当环境实际配了代理时才响亮抛错）、以及 `MessageEvent`/`CloseEvent`/`WebSocket`（重导出宿主全局）。
6. **新增错误码** `ERR_INVALID_HTTP_TOKEN`（TypeError）、`ERR_HTTP_INVALID_HEADER_VALUE`（TypeError）、`ERR_INVALID_CHAR`（TypeError，函数型消息）。

**验证**：新增 `test/http-surface.test.ts`（5 例）——含真服务器+客户端 `agent:false` 回环。扫描后 `http` 缺口 **12→0**。门禁全绿：`npm run typecheck` 干净 · `npx vitest run` **803 通过 / 2 预存 skip（72 文件）** · `npm run build` 绿（worker **2258.11KB**）。

### 2026-09-22 · M66 `crypto` 公开表面补齐（类导出 + subtle + randomUUIDv7）

**目标**：接着扫描器缺口名单，收掉整个 `crypto` 模块的公开表面（之前缺 21 个）。

**改了什么**

1. **类导出**：把 `createHash`/`createHmac`/`createCipheriv`/`createDecipheriv` 重构成真类（`Hash`/`Hmac`/`Cipheriv`/`Decipheriv`），返回值就是这些类的实例——`createHash('sha256') instanceof crypto.Hash` 成立（与 Node 一致）。`new Hash('sha256')` 等弃用构造器也照 Node 可用。`Cipheriv`/`Decipheriv` 通过在工厂里 `Object.setPrototypeOf` 到对应类的 prototype 达成 `instanceof`，避免子类化 native 类的签名冲突。
2. **新真实能力**：`subtle`（= `webcrypto.subtle`）、`randomUUIDv7`（RFC 9562 UUIDv7，48 位时间戳 + version 7 + variant）、`secureHeapUsed`（未开 `--secure-heap` 时 Node 报 `{total:0,used:0,utilization:null,min:2}`）、`setEngine`（无 OpenSSL 引擎，对任何 id 报 `ERR_CRYPTO_ENGINE_UNKNOWN`，与 Node 对未知引擎的行为一致）。
3. **存在但抛错**（与 `createSign` 等既有处理一致，保持可特性探测但不静默）：类 `Sign`/`Verify`/`KeyObject`/`DiffieHellman`/`DiffieHellmanGroup`/`ECDH`（构造函数抛 `NotImplementedError`，并保留 Node 同名），函数 `createECDH`/`argon2`/`argon2Sync`/`createMac`/`getMacs`/`encapsulate`/`decapsulate`。
4. **新增错误码** `ERR_CRYPTO_ENGINE_UNKNOWN`（`Engine "%s" was not found`）。

**验证**：新增 `test/crypto-surface.test.ts`（9 例）——类同一性/`instanceof`、CBC 回环比对、`new Hash()` 等价、`subtle` 摘要、v7 UUID 格式与时间戳、`secureHeapUsed` 形状、`setEngine` 报错、以及全部“存在但抛错”符号。扫描后 `crypto` 缺口 **21→0**。门禁全绿：`npm run typecheck` 干净 · `npx vitest run` **798 通过 / 2 预存 skip（71 文件）** · `npm run build` 绿（worker **2255.42KB**）。

### 2026-09-22 · M65 `net` 公开表面补齐（`SocketAddress` + `BlockList`）

**目标**：接着扫描器排出的缺口名单往下走，这次收掉整个 `net` 模块的公开表面（之前缺 10 个）。

**改了什么**

1. **新增 `src/node-runtime/net/socket-address.ts`**（新建，TS 手写）：`net.SocketAddress` / `net.BlockList` 的完整实现，作为 Node `block_list` 原生绑定（`src/node_sockaddr.cc`）的替身。
   - **为何不 vendor**：Node 的 `internal/socketaddress.js` / `internal/blocklist.js` 只为 `markTransferMode` 就拖进 `internal/worker/js_transferable`（连带整个 worker 传输机制），代价不划算。改为在 net 里重实现可观察面。
   - **IP 解析/格式化**：`inet_pton` 等价的 IPv4/IPv6 解析（含 `::` 展开、内嵌 IPv4）与 `inet_ntop` 等价的**规范化输出**——逐行复刻 glibc 的「最长零串、左对齐」压缩算法，含 IPv4-mapped（`::ffff:a.b.c.d`）/ IPv4-compatible（`::a.b.c.d`）的**点分四段内嵌**渲染。
   - **`SocketAddress`**：`address`/`port`/`family`/`flowlabel` getter、`toJSON`、`isSocketAddress`、`[util.inspect.custom]`；family 大小写不敏感，默认值/报错码与文案逐字对齐（`ERR_INVALID_ARG_VALUE`/`ERR_SOCKET_BAD_PORT`/`ERR_INVALID_ADDRESS`）。
   - **`BlockList`**：`addAddress`/`addAddresses`/`addRange`/`addSubnet`/`addCIDR`/`addCIDRs`/`remove*`/`check`/`clear`/`toJSON`/`fromJSON`/`rules`/`size`/`PRIVATE_RANGES`/`isBlockList`。**规则序**按 Node 实测复刻：地址（新在前）+ 子网 + 区间；`check` 对无法解析的地址返回 `false`（不是抛错），且 v4 与 v4-mapped v6 视为同一主机。
2. **`net` 其余导出**：`Stream`（≡`Socket` 旧别名）、`getDefaultAutoSelectFamily`/`setDefaultAutoSelectFamily`（默认 `true`）、`getDefaultAutoSelectFamilyAttemptTimeout`/`set…`（默认 `500`）。`SocketAddress`/`BlockList` 用 getter 惰性解析（首次访问才 require `internal/errors` 与 `internal/util/inspect`），`require('net')` 不因此变重。
3. **新增错误码** `ERR_INVALID_ADDRESS`（`'Invalid socket address'`；Node 只在 C++ `node_errors.h` 定义，JS 表里没有）。

**验证**：新增 `test/net-address.test.ts`（9 例）——所有期望值先跑真 Node v26.9.0 读出，包括规范化输出、规则序、`check` 语义、`fromJSON` 往返与全部错误码/文案。门禁全绿：`npm run typecheck` 干净 · `npx vitest run` **789 通过 / 2 预存 skip（70 文件）** · `npm run build` 绿（worker **2253.24KB**）。扫描后 `net` 缺口 **10→3**（仅剩 `BoundSocket`/`_createServerHandle`/`_normalizeArgs` 三个非公开内部量，刻意不伪造）。

### 2026-09-22 · M64 公开模块表面补齐（别名 builtin + `constants` + dns）

**目标**：用一次系统扫描找出「Node 有、我们没有」的公开模块/导出。写了个探针在 web-node 里 `require` 全部 67 个内建模块，与真 Node 的导出面逐键对比，按缺口大小排优先级。

**改了什么**

1. **四个一行重导出的别名 builtin**（直接 vendor 真源）：`assert/strict`（`require('assert').strict`）、`path/posix`、`path/win32`（`require('path').posix|win32`）、`sys`（已弃用的 `util` 别名，加载时发 DEP0025）。这四个在 Node 里都是独立模块 id，`import x from 'node:assert/strict'` 很常见，缺了就是真的兼容性黑洞。
2. **`constants` 模块**（之前 `require('constants')` 直接抛 `ERR_WEB_NODE_NOT_IMPLEMENTED`）：vendor 真 `lib/constants.js`，它只是把 `internalBinding('constants')` 的 `os.dlopen`/`os.errno`/`os.priority`/`os.signals` + `fs` + `crypto` 拼成一个冻结对象。顺带把 binding 补齐：`os.dlopen` 的 `RTLD_*`（之前是空对象）、以及 `os.signals`/`fs` 的几个别名（`SIGINFO`/`SIGIOT`/`S_I*GRP|OTH`/`O_NOFOLLOW`/`UV_FS_COPYFILE_*`/`UV_FS_O_*`）。
3. **`constants.os.errno` 改成平台 errno 表**。Node 的 `constants.os.errno` 来自 `src/node_constants.cc` 的 `DefineErrnoConstants`（直接取宿主 `<cerrno>` 宏），**与 libuv 的 `UV_ERRNO_MAP` 不是同一张表**——libuv 表多出 `EOF`/`ECHARSET` 等伪码、又含平台别名的差异。之前我们把两者混作一谈，现按 Node 语义拆开：`constants` 用平台表（darwin 值，如 `EWOULDBLOCK`=`EAGAIN`=35），VFS 继续用 libuv 表。
4. **dns surface 重写**：`dns` 与 `dns/promises` 现在**从同一组描述符派生**（回调/具名两套不可能漂移）；补上 `ADDRCONFIG`/`V4MAPPED`/`ALL` 三个 hint 标志与全部 24 个 c-ares 错误码（两个命名空间都有）；`Resolver` 实例自有 server 列表、可校验；`getDefaultResultOrder`/`setDefaultResultOrder`/`getServers`/`setServers`/`lookupService` 均就位。无解析器支撑的查询类 API（`resolveMx` 等）继续**响亮抛错**，不静默返回空表。

**验证**：新增 `test/module-aliases.test.ts`（8 例）——别名与目标模块对象**同一性**、`constants` 关键键值（含平台 errno 与 `Object.isFrozen`）、dns 回调/异步/Resolver。全量扫描后：`dns`/`dns/promises` 缺口 **42→0**、`constants` 从加载即抛变为可加载（剩余 57 个缺口全为 OpenSSL/TLS 常量，属宿主环境专有）。门禁全绿：`npm run typecheck` 干净 · `npx vitest run` **780 通过 / 2 预存 skip（69 文件）** · `npm run build` 绿（worker **2244.46KB**）。

### 2026-09-22 · M63 `internal/errors` 全表差分（并改用真 `util.format`）

**目标**：M62 把语料扩到 52 例、覆盖了全部函数型消息码，但那是**手工挑的**参数。这一步做**全表自动差分**：Node 全部 316 个码逐个发现 arity、构造、逐字段比对，看还有多少偏差。

**改了什么**

1. **新增全表 oracle** `tools/errors-full-oracle.mjs` → `test/fixtures/errors-full.json`（316 条）：对每个码先用 0 参探测——字符串消息会断报 arity（从 assert 文案里读到），函数消息则逐个爬升参数直到构造成功；再固定参数向量记录 `name`/`code`/`message`/错误类别/自有属性/变体基底。
2. **新增全表门禁** `test/errors-full.test.ts`：对我们携带的 **85 个共享码**逐字段对比（并断言共享码数 ≥ 80，防表悄悄缩小）。与 `errors-corpus`（真实调用点参数）互补：一个保真、一个保广。
3. **根因修复：字符串消息改用真 `util.format`**。Node 的 `makeNodeErrorWithCode` 对字符串消息调 `lazyInternalUtilInspect().format(msg, ...args)`，之前我们只有个 `%[sdj]` → `String()` 的次等替代（`%d` 该是 `Number`）。现按 Node 同法：在 `internal/errors` 物化时记下一个 `internal/util/inspect` 的惰性解析器（两者有加载期回环，不能 init 时 require），格式化时用真 `format`；万一未就绪再退回旧逻辑。`ERR_OUT_OF_RANGE` 的 received 值也从自写 `inspectArg` 改成真 `util.inspect`（数组现在印成 `[ 'x', 'y' ]`）。

**全表扫出的真实偏差（10 处）**：
- 基底错：`ERR_FS_FILE_TOO_LARGE` 应为 `RangeError`（之前默认 `Error`）、`ERR_INVALID_URI` 应为 `URIError`（之前 `TypeError`）。
- 模板语义错：`ERR_FS_WATCH_QUEUE_OVERFLOW`、`ERR_PERFORMANCE_INVALID_TIMESTAMP` 的 `%d` 应做 `Number()`（`'__a__'` → `NaN`）。
- 函数消息漏了 formatter（会被真 `format` 追加多余参数）：`ERR_INVALID_URL`、`ERR_FALSY_VALUE_REJECTION`、`ERR_INVALID_FILE_URL_PATH`。
- 非数组参数的泛型兼容：`formatList` / `ERR_WORKER_INVALID_EXEC_ARGV` 需像 Node 那样经 `Array.prototype.*.call`（非数组也能跑）。

**验证**：`test/errors-full.test.ts` **85/85 全字段一致** · `errors-corpus` 52/52 · `errors-bases`/`errors-messages`/`errors-table` 不回归。门禁全绿：`npm run typecheck` 干净 · `npx vitest run` **772 通过 / 2 预存 skip（68 文件）** · `npm run build` 绿（worker **2238.47KB**）。

### 2026-09-21 · M62 拓宽 `internal/errors` 差分门禁（函数型消息 + 变体基底）

**目标**：M58 补了码表、M60 校了「纯字符串消息」的文案。还剩两类没被任何门禁覆盖：**函数型消息**（Node 里 message 是函数，不是 `%s` 模板）与 `E(..., Base, ...Extra)` 的**变体基底**（`.TypeError`/`.RangeError` 等静态）。这一步把两者都做成自动比对，并修掉扫出的偏差。

**改了什么**

1. **语料扩到函数型消息**：`tools/errors-corpus-oracle.mjs` 从 21 例扩到 **52 例**，新增覆盖全部 31 个函数型消息码（`ERR_OUT_OF_RANGE`/`ERR_MISSING_ARGS`/`ERR_MODULE_NOT_FOUND`/`ERR_UNSUPPORTED_ESM_URL_SCHEME`/`ERR_INTERNAL_ASSERTION`/`ERR_SOCKET_BAD_PORT`/`ERR_INVALID_ARG_VALUE` …），每个码给贴近真实调用点的参数向量。
2. **新增变体基底门禁**：`tools/errors-bases-oracle.mjs` → `test/fixtures/errors-bases.json`（真 Node 逐码导出四个变体基底）+ `test/errors-bases.test.ts`（对共享码逐一对齐）。这道结构性门禁以后能直接报出「某个码漏了 `.RangeError`」一类的潜在 “is not a constructor” 崩溃。
3. **`internal-shims.ts` 修复**（全部对照 `lib/internal/errors.js` 真源）：
   - 补 `CUSTOM_FORMATTERS`：`ERR_OUT_OF_RANGE`（`inspect` 引号 + `addNumericalSeparator` + `replaceDefaultBoolean`）、`ERR_MISSING_ARGS`（逐项引号、数组作 “或” 连接、复数）、`ERR_MODULE_NOT_FOUND`（`package`/`module` 取决于 `exactUrl`）、`ERR_UNSUPPORTED_ESM_URL_SCHEME`、`ERR_INTERNAL_ASSERTION`（拼固定两行建议后缀）；重写 `ERR_SOCKET_BAD_PORT`（小写名 + `and` + `< 65536` + `determineSpecificType` + 句点）。
   - 补 `CUSTOM_PROPS`：`ERR_MODULE_NOT_FOUND` 在 `exactUrl` 为真时挂 `url` 自有属性。
   - 补 `ERROR_EXTRA_BASES`：`ERR_INVALID_ARG_VALUE: [RangeError]`。
   - 修基底：`ERR_UNSUPPORTED_ESM_URL_SCHEME` 从 `TypeError` 改回 `Error`（与真 Node 一致）。
   - 新增 `addNumericalSeparator` 助手。

**扫出的真实偏差（11 处）**：`ERR_INVALID_ARG_VALUE` 缺 `.RangeError` 变体；`ERR_OUT_OF_RANGE` 字符串输入未加引号、句子缺 `be`；`ERR_MISSING_ARGS` 完全没处理多参数/数组；`ERR_MODULE_NOT_FOUND` 永远说 `module`（应 `package`）且不挂 `url`；`ERR_UNSUPPORTED_ESM_URL_SCHEME` 文案错误且基底错误（`TypeError`→`Error`）；`ERR_INTERNAL_ASSERTION` 丢了固定后缀；`ERR_SOCKET_BAD_PORT` 文案完全不对。

**验证**：`test/errors-corpus.test.ts` **52/52** · `test/errors-bases.test.ts` 全绿 · 原 `errors-table`/`errors-messages` 不回归。门禁全绿：`npm run typecheck` 干净 · `npx vitest run` **770 通过 / 2 预存 skip（67 文件）** · `npm run build` 绿（worker **2237.94KB**）。

### 2026-09-22 · M61 补齐 `internalBinding` 表面（并修 5 处真·undefined）

**动机**：Node 内部代码访问宿主只走 `internalBinding(id)`，然后从它上面取具名属性。**名字没定义就是 `undefined`，调用点第一次跑到就报 “is not a function”**——与 M58 `internal/errors` 同类。把 vendored 树里所有 binding 解构（含 `{ codes: {...} }` 嵌套与 `internalBinding('x').a.b` 内联读取）与运行时逐一对了一遍，扫出 **5 处真缺失**（均可达）：

| 缺失 | 引用点 | 后果 |
|---|---|---|
| `util.markPromiseAsHandled` | `internal/streams/iter/{from,utils,consumers}.js` | 抛弃 promise 时 **TypeError**（`stream/iter` 可达） |
| `uv.UV_ENOSPC`（及整张 `UV_E*` 表） | `internal/fs/watchers.js` | `err === UV_ENOSPC` 永为假，错误消息走错分支 |
| `v8.kSampling*`（4 个） | `internal/v8/heap_profile.js` | 采样掩码位是 `undefined` |
| `constants.internal` | `internal/vfs/setup.js` | `EXTENSIONLESS_FORMAT_*` 解构后取属性即 **TypeError** |
| `process_methods.dlopenBinary` | `internal/vfs/setup.js` | 同（原生依赖加载路径） |

**改了什么**

1. **`uv` binding 改为从 `ERRNO` 生成整张 `UV_*` 常量表**（`ERRNO` 就是构造 `getErrorMap` 用的同一张 `deps/uv/include/uv.h` 表，88 个值与真 Node 逐值一致，含 `UV_UNKNOWN`/`UV_EAI_*`/`UV_EOF`），删掉手列的 12 个——名字与值再也不可能彼此漂移。
2. **`util.markPromiseAsHandled`**：Node 是置 V8 内部 handled 标志，JS 取不到；改用**挂一个 no-op 拒绝处理器**——可观测效果相同且不会产生漂浮 rejection（两臂都处理）。
3. **`v8`** 补 `kSamplingNoFlags/ForceGC/IncludeObjectsCollectedBy{Major,Minor}GC`（真值 0/1/2/4）。
4. **`constants.internal`** 补 `EXTENSIONLESS_FORMAT_JAVASCRIPT: 0` / `EXTENSIONLESS_FORMAT_WASM: 1`。
5. **`process_methods`** 补 `dlopen` / `dlopenBinary`——页面无法加载动态库，**响亮抛 `NotImplementedError`**。
6. 顺带把 `profiler` binding 补全到真 Node 的 5 个键（`setCoverageDirectory`/`setSourceMapCacheGetter`/`takeCoverage`/`stopCoverage`/`endCoverage`，前两个在 `process.features.inspector` 为假时不可达，但形状要诚实）。

**验证**

- 新增结构回归门禁 **`test/bindings-surface.test.ts`**：遍历整个 vendored 树，收集每个 binding 的属性路径（解构 + 内联），断言**无一为 `undefined`**（扫描 >200 条）；另逐值钉死 `uv` 全表（vs `test/fixtures/bind-real.json`，真 Node dump）、`v8` 采样标志、`constants.internal`；行为上验证 `markPromiseAsHandled` 确实吞掉 rejection、`dlopenBinary` 确实抛错。
- `test/stream-iter.test.ts` 新增一条：`toAsyncStreamable` 协议返回 rejected promise 时 `from()` 不抛、不产生未处理 rejection（**修前会 TypeError**）。
- 门禁：`tsc` 干净 · vitest **733 → 740（738 passed / 2 skipped，66 files）** · build 绿（worker 2234.27 → **2236.73 kB**）。
- 浏览器端到端：demo milestone 61 → **`libuv errnos : 85 (e.g. -28 = "ENOSPC")`** + **`markPromiseAsHandled: ok (stream/iter tolerated object from a rejected protocol)`**。

**已知边界**：`util` binding 仍有真 Node 暴露但 vendored 从未引用的类型谓词（`isMap`/`isPromise`/…，走 `util.types`），`v8.getHashSeed` 同——不凭空造值，故未补；`bindings-surface.test.ts` 会在它们被引用时立刻报缺。

**涉及文件**
新增：`test/bindings-surface.test.ts`、`test/fixtures/bind-real.json`。修改：`src/node-runtime/bindings/{util,uv/misc,v8,constants}.ts`、`test/stream-iter.test.ts`、`src/demo-project.ts`、`README.md`、`README_zh.md`。

### 2026-09-22 · M60 修正 SystemError 基底错误码（并抓出 3 处文案错误）

**动机**：`internal/errors` 里 `E(code, msg, SystemError)` 声明的码是**另一种类**——`makeSystemErrorWithCode` 从**上下文对象**拼消息（`${prefix}: ${syscall} returned ${code} (${message}) ${path} => ${dest}`）且 `name='SystemError'`；而 shim 只把 `ERR_TTY_INIT_FAILED` 归入这种基底，其余十个（`ERR_FS_CP_*`、`ERR_FS_EISDIR`、`ERR_SYSTEM_ERROR`）走普通 `makeErrorClass`，于是 `name` 是 `Error`、`%s` 模板拼出的消息丢了后缀。这些码在 `fs.cpSync` 冲突、`os.getPriority` 失败等**可达路径**上抛出。

**改了什么**

1. `SYSTEM_ERROR_CODES` 补齐到 11 个（`lib/internal/errors.js` 全量：`ERR_FS_CP_DIR_TO_NON_DIR`/`NON_DIR_TO_DIR`/`EEXIST`/`EINVAL`/`FIFO_PIPE`/`SOCKET`/`SYMLINK_TO_SUBDIRECTORY`/`UNKNOWN`、`ERR_FS_EISDIR`、`ERR_SYSTEM_ERROR`、`ERR_TTY_INIT_FAILED`）。
2. `makeSystemErrorWithCode` 也挂上 `HideStackFramesError` 伴生类（`os.js` 会 `new ERR_SYSTEM_ERROR.HideStackFramesError(...)`）。
3. `SystemError` 补 `dest` getter 与 `toString()`（`` `${name} [${code}]: ${message}` ``），对齐 `lib/internal/errors.js`。
4. **顺带修 3 处真实文案错误**（自动全量比对发现）：`ERR_FS_CP_DIR_TO_NON_DIR` 与 `ERR_FS_CP_NON_DIR_TO_DIR` 的文案**互换了**；`ERR_FS_CP_SYMLINK_TO_SUBDIRECTORY` 写成了不存在的句子。

**验证**

- 差分语料 `test/fixtures/errors-corpus.json` 扩到 **21 条**（含全部 11 个 SystemError 码，逐字段对比 `name`/`code`/`message`/`props`）→ 21/21 一致。
- 新增**消息文案差分门禁**：`tools/errors-messages-oracle.mjs`（真 Node `--expose-internals` 取每个无占位符字符串码的原始模板）+ `test/fixtures/errors-messages.json`（157 条）+ `test/errors-messages.test.ts`——**这是抓出那 3 处互换的关键**。
- `test/errors-table.test.ts` 新增两个用例：11 个 SystemError 码的 `name`/上下文消息/`info`/`errno`/`path`/`dest`/`toString`，以及 `HideStackFramesError` 伴生类。
- 门禁：`tsc` 干净 · vitest **718 → 733（731 passed / 2 skipped，65 files）** · build 绿（worker 2233.75 → **2234.27 kB**）。
- 浏览器端到端：demo milestone 60 → **`system-error    : SystemError [ERR_FS_CP_EINVAL] Invalid src or dest: cp returned EINVAL (src and dest cannot be the same) /a => /b`**。

**已知边界**：`fs.cpSync` 在 web-node 里走 vendored（v26.9.1-dev）的 `internal/fs/cp/cp.js`，而实测的 Node v26.9.0 把 cp 下移到了 C++（故其 `cpSync` 报的是另一种形状）—— 这是 vendored 源与安装版的既有版本偏差，不在本里程碑范围。`internal/errors` 本身已与 v26.9.0 逐字段对齐。

**涉及文件**
新增：`tools/errors-messages-oracle.mjs`、`test/fixtures/errors-messages.json`、`test/errors-messages.test.ts`。修改：`src/node-runtime/builtins/internal-shims.ts`、`test/errors-table.test.ts`、`tools/errors-corpus-oracle.mjs`、`test/fixtures/errors-corpus.json`、`src/demo-project.ts`、`README.md`、`README_zh.md`。

### 2026-09-22 · M59 真 worker 标准 IO（并修一个真 bug：getter 直接抛错）

**动机**：`worker.stdin/stdout/stderr` 三个 getter **一律抛 `ERR_WEB_NODE_NOT_IMPLEMENTED`**，但真 Node **从不抛**。照 `lib/internal/worker.js`（v26.9.0）：`stdin` 默认 `null`（仅 `stdin: true` 时是 Writable）；`stdout`/`stderr` **无条件创建** Readable，`!options.stdout` 时只是 `pipeWithoutWarning(stdout, process.stdout)` 转发到父进程（文档里“otherwise null”的说法已过时）。所以 `if (worker.stdout) worker.stdout.on('data', …)` 这类写法在旧实现下直接崩——真实的 load-bearing bug。

**改了什么**

1. **`proc/worker.ts`：真实 stdio 流，用第二条 `MessageChannel` 承载**（不污染用户消息通道）。父侧 `worker.stdout`/`stderr` 是可读流，`stdin: true` 时 `worker.stdin` 是可写流；worker 侧 `process.stdout`/`stderr` 是可写流、`process.stdin` 是可读流，字节在 stdio 端口上以 `{ __wnStdio, data }` 帧传输。默认把 worker 的 stdout/stderr 转发到主进程的 stdout/stderr（等同 Node 的 pipe）。
2. **worker 的 `console` 重绑到它自己的 stdout/stderr**（`new Console({ stdout, stderr })`）——与 Node 一致，`console.log` 现在落在 `worker.stdout` 上而非直接进宿主 console；配合默认转发，仍会显示在父输出里。
3. **打开 stdin 会 ref 住 worker**（与 Node 的管道语义一致）：`worker.stdin` 未 `end()` 时 worker 不退出，`end()` 后释放。
4. **修退出竞态**：port 消息投递是 ~1ms 的宿主宏任务（`timers.setTimeout` 钳到 1ms），而旧的退出检查是 0ms，会在投递到达前先关闭端口、丢掉在途消息。改成 **静默期判定**（`SETTLE_GRACE_MS = 4`）：任何 port/stdin 活动都把退出检查推后一个 grace，无活动才退出。`#settleTimer` 现在可取消，`#deliver`/`#onStdio`/`#toWorker` 统一走 `#touch()`。
5. `worker_threads.ts`：去掉对 `stdin`/`stdout`/`stderr` 选项的拒绝（只留 `resourceLimits`/`eval`），getter 改为返回 handle 的流。

**验证**

- `test/worker.test.ts` 新增一条覆盖三件事：默认为 Readable/null（同 Node）、`console.log` 既转发到父 stdout 也出现在 `worker.stdout`、`stdout: true` 时**只**给 `worker.stdout`、`stdin` 往返。另更新了「响亮报错」用例（不再把 stdio 列入）。
- 门禁：`tsc` 干净 · vitest **717 → 718（716 passed / 2 skipped，62 files）** · build 绿（worker 2230.33 → **2233.75 kB**）。
- 浏览器端到端：demo 新增 milestone 59 段，实测 **`worker: hi over stdout`**（console.log 经 worker.stdout 转发）+ **`stdio       : stdin:ping to the worker end`**。

**已知边界**：stdio 的“管道”在标签页里是第二条 `MessageChannel`，所以它是同一事件循环上的协作式传输（带 ~1ms 宏任务时延），不是 OS 管道；`resourceLimits`/`eval`/剖析仍响亮报错。

**涉及文件**
修改：`src/node-runtime/proc/worker.ts`、`src/node-runtime/builtins/worker-threads.ts`、`test/worker.test.ts`、`src/demo-project.ts`、`README.md`、`README_zh.md`。

### 2026-09-22 · M58 补齐 `internal/errors` 错误码表（+ 一条结构回归门禁）

**动机（证据驱动）**：把 `vendor/node-lib` + `src/node-runtime` 里所有 `ERR_*` 引用与 shim 的表对了一遍，发现 **9 个码被 `internal/errors` 解构引用、但表里没有定义** —— 解构拿到 `undefined`，调用点 `new codes.ERR_X(...)` 就报 "is not a constructor"。这是**只在罕至路径上才显形的潜在真 bug**：

| 码 | 谁在用 | 触发路径 |
|---|---|---|
| `ERR_ACCESS_DENIED` | `fs.js`、`internal/fs/promises.js` | Permission Model 拦截 fs 调用 |
| `ERR_ARG_NOT_ITERABLE` | `internal/webstreams/readablestream.js` | `ReadableStream.from(非可迭代)` |
| `ERR_FEATURE_UNAVAILABLE_ON_PLATFORM` | `internal/fs/streams.js` | Windows 专属句柄 |
| `ERR_FS_WATCH_QUEUE_OVERFLOW` | `internal/fs/watchers.js` | `fs.watch` 队列溢出 |
| `ERR_INVALID_RETURN_VALUE` | `assert.js`、`streams/iter/*`、`streams/duplexify.js` 等 6 处 | pipeline/transform 回调返回非法值 |
| `ERR_NO_TEMPORAL` | `internal/fs/utils.js` | Temporal 缺失分支 |
| `ERR_PERFORMANCE_INVALID_TIMESTAMP` | `internal/perf/usertiming.js` | `performance.measure` 非法时间戳 |
| `ERR_PERFORMANCE_MEASURE_INVALID_OPTIONS` | `internal/perf/usertiming.js` | `performance.measure` 非法选项 |
| `ERR_USE_AFTER_CLOSE` | `internal/readline/interface.js` | `rl` 关闭后再调用 |

奇怪的是 `ERR_INVALID_RETURN_VALUE` 已在 `ERROR_BASES`/`CUSTOM_FORMATTERS` 里，却漏在 `ERROR_CODES` 里——而 `codes` 只由 `ERROR_CODES` 的键构建，所以它依然是 `undefined`。这正是“两个地方都要加”的典型坑。

**改了什么**

1. `src/node-runtime/builtins/internal-shims.ts`：把上述 9 个码补进 `ERROR_CODES`（文案与 `lib/internal/errors.js` / `src/node_errors.h` 逐字对齐）；`ERROR_BASES` 给 `ERR_ARG_NOT_ITERABLE`/`ERR_FEATURE_UNAVAILABLE_ON_PLATFORM`/`ERR_PERFORMANCE_INVALID_TIMESTAMP`/`ERR_PERFORMANCE_MEASURE_INVALID_OPTIONS` 标 `TypeError`；新增 `ERR_ACCESS_DENIED` 的自定义格式化器（返回调用方自己的句子）与 `CUSTOM_PROPS`（挂上 `permission`/`resource`）；`ERROR_EXTRA_BASES` 给 `ERR_INVALID_RETURN_VALUE` 补 `RangeError` 变体（`E(code, msg, TypeError, RangeError)`）。
2. **新增结构回归门禁** `test/errors-table.test.ts`：遍历整个 vendored 树，收集每个文件从 `internal/errors` 解构/内联引用的码，断言全部在表里存在为构造函数。**当前扫描到 76 个码**；修复前这 9 个都会让它失败。
3. **新增差分语料** `tools/errors-corpus-oracle.mjs` + `test/fixtures/errors-corpus.json` + `test/errors-corpus.test.ts`：真 Node `--expose-internals` 下直接 `require('internal/errors')`，逐码记录 `name`/`code`/`message`/`instanceof` 各基类/额外自有属性/`E(...Extra)` 静态变体，再在 web-node 跑同一调用逐字段比对。
4. 把两个 `_m5c`/`_m5d` 可行性 spike 改成**夹具缺失时跳过**：它们靠 `/tmp` 下的磁盘夹具（已被系统清理），夹具不在时本无可测，不应报模块解析失败（环境性失效，与本次改动无关）。

**验证**

- 差分语料 **10/10 一致**（涵盖 9 个新码；含 `ERR_ACCESS_DENIED` 的 `permission`/`resource` 与 `ERR_INVALID_RETURN_VALUE` 的两种具体类型文案）。
- 门禁：`tsc` 干净 · vitest **717 用例（715 passed / 2 skipped）** · build 绿（worker 2229.19 → **2230.33 kB**）。
- 浏览器端到端：demo 新增 milestone 58 段，实测 **`use-after-close : Error ERR_USE_AFTER_CLOSE - readline was closed`** / **`not-iterable : TypeError ERR_ARG_NOT_ITERABLE - value must be iterable`**。

**已知边界**：`ERR_CRYPTO_*`与`ERR_OSSL_*`不走`internal/errors`，由 `crypto.ts`/`cipher.ts` 的本地 `coded(...)` helper 构造 Node 形状错误（`name` 为基类名 + `.code`），无需入表；`ERR_WEB_NODE_SYNC_SPAWN` 是 web-node 自己的 `SpawnError`。

**涉及文件**
新增：`test/errors-corpus.test.ts`、`test/errors-table.test.ts`、`test/fixtures/errors-corpus.json`、`tools/errors-corpus-oracle.mjs`。修改：`src/node-runtime/builtins/internal-shims.ts`、`src/demo-project.ts`、`test/_m5c.test.ts`、`test/_m5d.test.ts`、`README.md`、`README_zh.md`。

### 2026-09-21 · M57 真 `Worker`（`worker_threads.Worker` 落地为“同 loop 的协作式工作器”）

**目标**：`worker_threads` 此前只有消息传递那一半（`MessageChannel`/`MessagePort`/`BroadcastChannel`/`receiveMessageOnPort`），`Worker` 直接抛错。浏览器标签页起不了线程，但 worker 的**数据语义**可以在单一事件循环上复刻——和 `proc/host.ts` 复刻子进程是同一手法。

**改了什么**

1. **新增 worker 宿主**（`src/node-runtime/proc/worker.ts`，仿 `proc/host.ts`）：
   - 一个 worker = **第二个模块注册表**（自己的模块缓存、自己的注入 globals、自己的 `process`/`worker_threads` 视图），与父侧用一条真实的 `MessageChannel` 端口对通信。
   - `Worker` 构造时即建好端口对（因此启动前的 `postMessage` 会排队并在 worker 启动后投递，和 Node 一致）。
   - **起点延到下一个宏任务**（`defer`），所以父侧的 `worker.on('message', …)` 一定先于 worker 的第一次发送；`online` 在 worker 脚本执行前发出（对应 Node 的 `upAndRunning`），顺序与 Node 一致（`online` → `error` → `exit`）。
   - worker 的**定时器按 worker 计数**：`setTimeout`/`setInterval`/`setImmediate`/`clear*` 被包裹，既能把它回调里的异常路由到该 worker（`error` + `exit 1`），又能让退出判定只看**它自己**的待办（`entry 返回 && 自有定时器清零 && parentPort 未被引用`）——**不能用全局定时器增量**，否则父程序里无关的定时器会把 worker 永远吊住（浏览器 demo 里踩到的一个真 bug）。
   - worker 侧 `worker_threads` 视图：`isMainThread:false`、`threadId`、`threadName`、`parentPort`、`workerData`、`SHARE_ENV`、`get/setEnvironmentData`（与主线程共享一张表），以及消息传递内建。嵌套 `Worker` 响亮报错。
   - worker 侧 `process` 视图：自己的 `argv`（execPath、脚本、`...options.argv`）、自己的 `env`（默认拷贝，`SHARE_ENV` 则共享）、`execArgv`，`process.exit()` 退出的是 worker 而非整个程序；`process.threadId` 保持缺席（与真 Node 实测一致）。
2. **`lib/loader` 增加每注册表的内建覆盖**（`setBuiltinOverrides`）：worker 里 `require('worker_threads')`/`require('process')` 必须拿到 worker 侧视图，而不是主线程的单例；`require` 门面在 realm 内建之前先查这张表。
3. **`worker_threads.ts` 重写**：`Worker` 是运行时自己的实现，构造/校验与 Node 逐字对齐（`filename` 非字符串/非 URL、裸标识符、`options.env`/`name`/`argv` 的校验文案与 `code` 全部一致），`threadId`/`threadName` 在退出后分别报 `-1`/`null`、`postMessage` 退出后是 no-op、`terminate()` 退出后返回 `undefined`——这些都是真 Node v26.9.0 实测行为。
4. **`internal/errors` shim** 补 `ERR_WORKER_PATH`（含条件化的 URL 提示）、`ERR_WORKER_INVALID_EXEC_ARGV`、`ERR_WORKER_NOT_RUNNING`。
5. `BindingContext` 增加 `workers: WorkerHost`；`runtime.ts` 构造并把它计入 `#activeWorkCount`（被 ref 的活跃 worker 会吊住运行，与 Node 的 ref 语义一致），`resetRunState` 里一并 `reset()`。

**验证**

- **差分语料**：`test/fixtures/worker-corpus.mjs`（15 条：模块键与主线程常量 / `plain` 的 `online,exit` / `echo` 往返 / `workerData` 结构化克隆（含 `Date`）/ 同步抛错 → `online,error,exit:1` / 异步抛错 → `online,message,error,exit:1` / `terminate()` → `online,message:waiting,exit:1` + 返回 1 / 两个 worker 的 `threadId` / `Worker.prototype` 表面 / 四个构造校验的 name+code+message）+ `tools/worker-corpus-oracle.mjs`（真 Node v26.9.0 跑真线程生成 `test/fixtures/worker-corpus.json`）+ `test/worker-corpus.test.ts` → **15/15 一致**。
- 另增 `test/worker.test.ts`（14 条）：模块表面、worker 自己的 `process`/`worker_threads` 视图（`process.argv`、`'threadId' in process === false`）、`workerData` 是隔离的深拷贝、worker 之间 globals 不串、双向消息与 `parentPort.close()`、退出后 `threadId=-1`/`postMessage` no-op/`terminate()` 返回 `undefined`、`terminate()` 返回 1 并发 `exit`、未捕获异常 → `online,error,exit:1`、`environmentData` 主/worker 共享、显式 `env` 与 `SHARE_ENV`、构造校验、以及“响亮报错”清单（`eval`/`resourceLimits`/worker 标准 IO/`getHeapSnapshot`/`cpuUsage`/嵌套 `Worker`）。
- 门禁：`tsc` 干净 · vitest **691 → 705/705**（62 files）· build 绿（worker 2217.17 → **2229.19 kB**）。
- 浏览器端到端：demo 新增 milestone 57 段（`lib/worker-demo.js` 发出 `workerData`/`isMainThread`/`threadId`，父侧回 `ping`，worker 回 `re:ping` 后 `close`），实测 **`events : online message:{…} message:"re:ping" exit:0`**。

**已知偏离**（写进注释与本文）

- **无并行**：worker 与主线程共用一个事件循环，不会真的并发；一个不让出的 worker 会阻塞父程序（反之亦然），`Atomics.wait` 式阻塞不可用。这是本 milestone 唯一要紧的偏离，是刻意的而非隐藏的。
- **无独立 isolate/管道/资源上限**：`eval`、worker 标准 IO（`stdin`/`stdout`/`stderr` 选项与其 getter）、`resourceLimits`、堆/CPU 剖析、以及嵌套 `Worker` 一律抛 `ERR_WEB_NODE_NOT_IMPLEMENTED`。
- **threadId 编号**：父侧 `worker.threadId` 与 worker 侧 `require('worker_threads').threadId` 用同一个计数（真 Node 两侧可能不同）；都保证 > 0。
- **启动前 `terminate()`**：真 Node v26.9.0 对尚未启动的 worker 返回 0；本运行时返回 1（该分支本身在 Node 侧也带竞态，故不纳入语料）。
- `worker.workerData` 不对外暴露（真 Node v26.9.0 也不暴露，实测为 `undefined`）。

**涉及文件**
新增：`src/node-runtime/proc/worker.ts`、`test/worker.test.ts`、`test/worker-corpus.test.ts`、`test/fixtures/worker-corpus.mjs`、`test/fixtures/worker-corpus.json`、`tools/worker-corpus-oracle.mjs`。修改：`src/node-runtime/bindings/context.ts`、`src/node-runtime/runtime.ts`、`src/node-runtime/loader/index.ts`、`src/node-runtime/builtins/worker-threads.ts`、`src/node-runtime/builtins/internal-shims.ts`、`src/demo-project.ts`、`README.md`、`README_zh.md`。

### 2026-09-21 · M56 真 `vm`（`lib/vm.js` + `lib/internal/vm.js` 换真源，新增 `contextify` binding）

**目标**：`vm` 是最后一个（与 `tls` 一起）unsupported stub，而它最初只为了一个功能而被保留：`lib/internal/util.js` 的 `getInternalGlobal()` 用 `vm.runInNewContext('this')` 拿一个“跨 realm”的 RegExp（供 WHATWG 流 finalizer 走到）。真 `lib/vm.js` 是纯 JS，native 半边是 `contextify`（V8 上下文 + `ScriptCompiler`）。页面造不出第二个 realm，但**上下文的数据语义**可以复刻。

**改了什么**

1. **vendor 真 `lib/vm.js` + `lib/internal/vm.js`**（MANIFEST 153 → 155）。
2. **新增 `contextify` binding**（`src/node-runtime/bindings/contextify.ts`）：
   - `ContextifyScript`：构造时用 `new Function(code)` 做一次语法检查（对齐 Node “构造即报 SyntaxError”）；`runInContext(sandbox, timeout, displayErrors, breakOnSigint, breakFirstLine)` 按 sandbox 分派——`null` → 在当前上下文跑（不带 `with`，`this` 为宿主 global）；否则在新的 scope 上跑。
   - `makeContext(contextObject, name, origin, strings, wasm, microtaskQueue, hostDefinedOptionId)`：**把沙箱对象本身当作上下文**（用 Node 的 `contextify_context_private_symbol` 标记），因此 `createContext(o) === o`、`vm.isContext` 都是真的；`DONT_CONTEXTIFY` 返回 `globalThis`。
   - 脚本执行在一个 **`with (scope) { return eval(code) }`** 里，`this` 绑到 scope：读命中沙箱→再命中标准内建；写落到沙箱；`var` 声明经 set 陷阱也落到沙箱；返回完成值。
   - scope 的 `has` 对所有非保留名返回 `true`（这样裸赋值会落到沙箱而不是污染宿主全局），`get` 的兼容回退只给**标准内建 + `console` 白名单**（对照真 Node 探测出来的 vm 上下文全局表）——所以 `process`/`require`/`Buffer`/`setTimeout`/`global` 在上下文里都是 `undefined`，与 Node 一致。
   - `compileFunction`：参数优先于 scope，contextExtensions 内层于 parsingContext。
   - **真 `constants`**（`measureMemory.mode/execution`）；`measureMemory` 与 `cachedData`/`produceCachedData` 一律响亮抛 `ERR_WEB_NODE_NOT_IMPLEMENTED`。
3. `symbols` binding 补 `vm_dynamic_import_{default_internal,main_context_default,no_callback,missing_flag}` 与 `vm_context_no_contextify`；`util` binding 的 `privateSymbols` 补 `contextify_context_private_symbol`（描述 `node:contextify:context`）与 `host_defined_option_symbol`；`internal/errors` 补 `ERR_CONTEXT_NOT_INITIALIZED`；`internal/options` 补 `--experimental-vm-modules: false`（否则传自定义 `importModuleDynamically` 时 `getOptionValue` 会抛）。
4. `unsupported.ts` 删掉 `vm` stub；bindings 注册 `contextify` 并从 `UNSUPPORTED_BINDINGS` 移除。

**验证**

- 新增**差分语料**：`test/fixtures/vm-corpus.mjs`（59 条：表达式/完成值/`this` 与 `globalThis` 同一性/沙箱读写与 `var`/新上下文对外部全局的存在性（process、require、Buffer、setTimeout、global 均 undefined；console、Math、JSON、Array、Date 均在）/`isContext` 与 `createContext` 幂等/`DONT_CONTEXTIFY`/`Script` 三种运行/`compileFunction`/`constants` 与模块键/语法错与运行错的 name+message/一堆 validators 错误码与文案）+ `tools/vm-corpus-oracle.mjs`（真 Node v26.9.0 生成 `test/fixtures/vm-corpus.json`）+ `test/vm-corpus.test.ts`（web-node 跑同一函数逐条对比）→ **59/59 一致**。
- 另增 `test/vm.test.ts`（9 条）：模块表面、`runInThisContext` 看得到宿主全局但看不到调用方局部变量、沙箱即全局作用域与不泄露 `process`、`isContext` 追踪、**`internal/util.js` 的 `SideEffectFreeRegExpPrototypeSymbolReplace` 真的能用**（这正是 vm 不能是 stub 的原因）、`Script` 构造即报语法错、非 context 报 `ERR_INVALID_ARG_TYPE`、`compileFunction` 的 parsingContext/extensions、以及 `timeout`/`breakOnSigint`/`createCachedData`/`produceCachedData`/`measureMemory` 五个响亮报错。
- 门禁：`tsc` 干净 · vitest **680 → 691/691**（60 files）· build 绿（worker 2196.34 → **2217.17 kB**）。
- 浏览器端到端：`runInNewContext` 表达式、沙箱写回、`typeof process` 隔离、`this===globalThis`、`isContext`、`Script`、`compileFunction`（含 parsingContext）、`timeout` 招错 —— 全对。

**已知偏离**（写进注释与本文）

- **无 realm 隔离**：上下文里的 `Array`/`RegExp`/… 是宿主的对象，不是第二个 realm 的；`vm.createContext(DONT_CONTEXTIFY) === globalThis` 为 `true`（Node 为 `false`）。
- **`globalThis` 的可枚举面**：内建不以自有属性形式挂在上下文对象上（`Object.keys(globalThis)` 不列内建）；`with` 的 `has=>true` 使 `'任意名' in globalThis` 恒 `true`。
- **语法检查**：用 `new Function` 预解析，所以顶层 `return` 在构造时不报（Node 会在构造时报）——运行时由 `eval` 报 `SyntaxError`。
- **代码缓存与计时**：`cachedData`/`produceCachedData`/`createCachedData`/`timeout`/`breakOnSigint` 一律抛 `ERR_WEB_NODE_NOT_IMPLEMENTED`（需要可中断的 isolate 或 V8 代码缓存）；`measureMemory` 同样。
- `importModuleDynamically` 自定义回调会 require `internal/vm/module` 与 `internal/modules/esm/utils`，这两者未 vendor，会响亮报错。

**涉及文件**
新增：`vendor/node-lib/vm.js`、`vendor/node-lib/internal/vm.js`（+ `MANIFEST.json`）、`src/node-runtime/bindings/contextify.ts`、`test/vm.test.ts`、`test/vm-corpus.test.ts`、`test/fixtures/vm-corpus.mjs`、`test/fixtures/vm-corpus.json`、`tools/vm-corpus-oracle.mjs`。修改：`tools/vendor.mjs`、`src/node-runtime/bindings/{index,misc,util}.ts`、`src/node-runtime/builtins/{vendored-builtins,unsupported,internal-shims}.ts`、`src/demo-project.ts`、`README.md`、`README_zh.md`。

### 2026-09-21 · M55 真 `tty`（`lib/tty.js` + `lib/internal/tty.js` 换真源，新增 `tty_wrap` binding）

**目标**：`tty` 一直是 unsupported stub（只造了 `isatty: () => false` 和两个空类）。真 `lib/tty.js` 是纯 JS，可直接 vendor；它的 native 半边是 `tty_wrap`（TTY 句柄 + `uv_guess_handle`）。同时 `lib/internal/tty.js`（颜色深度表，移植自 supports-color）也是纯 JS，而且 `internal/util/colors` 在 `FORCE_COLOR` 置位时会**惰性 require 它**——这个模块之前根本没注册，所以只要设了 `FORCE_COLOR` 就会直接炸。

**改了什么**

1. **vendor 真 `lib/tty.js` + `lib/internal/tty.js`**（MANIFEST 151 → 153）。
2. **新增 `tty_wrap` binding**（`src/node-runtime/bindings/misc.ts`）：`isTTY(fd)` 恒为 `false`（标签页没有文件描述符、没有控制终端，对管道/重定向流 Node 也给出这个答案）；`TTY` 句柄没有任何东西可代表，构造即招 `NotImplementedError`；`UV_TTY_MODE_NORMAL/IO/RAW_VT` = 0/2/3（对齐 `deps/uv/include/uv.h`）。`lib/tty.js` 照常加载：`isatty` 是真实现，`ReadStream`/`WriteStream` 一碰到建句柄就抛。
3. **`internal/errors` 补齐 tty 相关码**：`ERR_INVALID_FD`（RangeError）、`ERR_INVALID_CURSOR_POS`/`ERR_INVALID_FD_TYPE`（TypeError）、`ERR_TTY_INIT_FAILED`（`SystemError` 基类）。新增真 `SystemError` 类（message 从 context 拼：`<prefix>: <syscall> returned <code> (<message>)`，`errno`/`syscall` 为 context 上的 getter/setter，`info` 就是 context）与 `kIsNodeError`，并导出 `SystemError`。
4. `internal/util/colors` 的注释改为「`internal/tty` 已注册为独立 builtin、靠惰性 require 取」（不进 `deps`）；`unsupported.ts` 删掉 `tty` stub；bindings 注册 `tty_wrap` 并从 `UNSUPPORTED_BINDINGS` 移除。

**验证**

- 新增**差分语料**：`test/fixtures/tty-corpus.mjs`（57 个环境样例 + 10 个 `hasColors` 参数组，覆盖 `FORCE_COLOR` 全档、`NO_COLOR`/`NODE_DISABLE_COLORS`/`TERM=dumb`、tmux、各 CI 变量表、TeamCity 版本正则、`TERM_PROGRAM`、`COLORTERM`、`TERM` 表与正则、空环境）+ `tools/tty-corpus-oracle.mjs`（用真 Node 生成 `test/fixtures/tty-corpus.json`）+ `test/tty-corpus.test.ts`（两边都通过 `WriteStream.prototype.getColorDepth`/`hasColors` 调用，无需真终端）→ **57/57 + 10/10 一致**。
- 另增 `test/tty.test.ts`（7 条）：模块表面（`['isatty','ReadStream','WriteStream']`）、`isatty` 十三组输入全为 false、`new WriteStream/ReadStream(1)` 招 `ERR_WEB_NODE_NOT_IMPLEMENTED`、坏 fd 在碰句柄之前就抛 `ERR_INVALID_FD`、默认 `getColorDepth()` 读环境 `process.env`、`FORCE_COLOR` 驱动下 `util.styleText` 真的输出 ANSI（这是库可见的实际收益，之前设 `FORCE_COLOR` 会炸）、四个 tty 错误码形状（含 `SystemError` 的 message 拼装）。
- 门禁：`tsc` 干净 · vitest **670 → 680/680**（58 files）· build 绿（worker 2183.70 → **2195.24 kB**）。
- 浏览器端到端：`isatty` 三个 fd、`getColorDepth`（plain/force3/xterm/dumb）、`hasColors(256)`、`new WriteStream(1)` 招错 —— 全部正确。

**已知偏离**

- 真 Node 对非 tty 的 fd 构造 `WriteStream` 会抛 `ERR_TTY_INIT_FAILED`（libuv `uv_tty_init` 失败，但行为随环境变）；本运行时**根本造不出 TTY 句柄**，所以抛的是 `ERR_WEB_NODE_NOT_IMPLEMENTED`。`isatty` 与颜色深度不受影响。

**涉及文件**
新增：`vendor/node-lib/tty.js`、`vendor/node-lib/internal/tty.js`（+ `MANIFEST.json`）、`test/tty.test.ts`、`test/tty-corpus.test.ts`、`test/fixtures/tty-corpus.mjs`、`test/fixtures/tty-corpus.json`、`tools/tty-corpus-oracle.mjs`。修改：`tools/vendor.mjs`、`src/node-runtime/bindings/{index,misc}.ts`、`src/node-runtime/builtins/{vendored-builtins,unsupported,internal-shims}.ts`、`src/demo-project.ts`、`README.md`、`README_zh.md`。

### 2026-09-21 · M54 真 `v8`（`lib/v8.js` 换真源，`serdes` 用 JS 实现 V8 序列化线格式）

**目标**：`v8` 一直是 unsupported stub。真 `lib/v8.js` 是纯 JS，可以直接 vendor；它下面的 `serdes` binding（`Serializer`/`Deserializer`）才是 native。其中唯一真正能实现且有用的一半是 `serialize`/`deserialize` 的 **V8 结构化克隆线格式**——标签表、varint、对齐 pad、对象 id 全在 `deps/v8/src/objects/value-serializer.cc` 里写死了，可以逐字节复刻。

**改了什么**

1. **vendor 真 `lib/v8.js`** + `lib/internal/v8/{heap_profile,cpu_profiler}.js`（`MANIFEST` 148 → 151；`internal/v8/startup_snapshot.js` 在 M48 已收）。
2. **新增 `src/node-runtime/bindings/serdes.ts`**：按 `deps/v8/src/objects/value-serializer.cc` 实现 V8 线格式（版本 15）——
   - 头部 `0xFF` + varint 版本；整数 base-128 varint，有符号值 ZigZag；
   - 字符串：`0x22` Latin-1 或 `0x63` UTF-16LE，后者在会破坏对齐时前置一个 `0x00` pad（`(buffer_size + 1 + varintLen(byteLength)) & 1`）；
   - 对象首次访问分配递增 id，重复出现发 `0x5E` + id；数组分 dense/sparse；Map/Set、Date、RegExp、Error（含 `cause`）、primitive wrapper、ArrayBuffer、BigInt 全支持；
   - host object（`0x5C` + 类型索引 + 长度 + 原始字节）用于 ArrayBufferView——Node 的 `DefaultSerializer` 默认把 view 当 host object（唯一的例外是 `Constructor === Buffer` 时索引 10）。
3. **新增 `src/node-runtime/bindings/v8.ts`**（`v8`/`heap_utils`/`profiler` 三个 binding）：
   - 能诚实地回答的：`cachedDataVersionTag`（按引擎版本号算稳定 tag）、`isStringOneByteRepresentation`、`setFlagsFromString`（空操作）、索引常量、`kHeapSpaces`、三个 `Float64Array` 统计缓冲；
   - **不能的：一律响亮招错**——`getHeapStatistics`/`getHeapSpaceStatistics`/`getHeapCodeStatistics`/`getCppHeapStatistics`（页面看不到 V8 堆内部）、`getHeapSnapshot`/`writeHeapSnapshot`/`queryObjects`（堆遍历）、`GCProfiler`、CPU/堆 profiler。
4. **`internal/heap_utils` 用 shim**（真文件要 `internal_only_v8` + `stream_base_commons`）：`getHeapSnapshotOptions` 是真的（`lib/v8.js` 在调 native 前先跑它），`HeapSnapshotStream`/`queryObjects` 调用即招错。
5. `unsupported.ts` 删掉 `v8` stub；bindings 注册 `serdes`/`v8`/`heap_utils`/`profiler`。

**验证**（把 V8 线格式当成可对照的规范）

- 新增 **差分语料**：`test/fixtures/v8-corpus.mjs`（115 条，覆盖每个标签与边角）、`tools/v8-corpus-oracle.mjs`（用真 Node 生成 `test/fixtures/v8-corpus.json` 期望字节）、`test/v8-corpus.test.ts`（在 web-node 里跑同一列表逐字节对比 + 定点回环）。**115/115 逐字节一致**。
- 另增 `test/v8.test.ts`（18 条）：primitive/对象/数组/Map/Set/Date/RegExp/Error/ABV host-object 路径/对象引用/transferArrayBuffer/低阶 `Serializer` 的真 view 路径/错误消息/低阶接口失败语义。
- 过程中抓到并修掉两个真 bug：BigInt 的 bitfield 编码（`byteLength*2|sign`，不是 `digits<<1`）、两字节字符串用 `TextDecoder('utf-16le')` 会把孤立代理对替成 U+FFFD（改为逐 code unit 手解）。另发现 V8 反序列化出的 Error **不携带新 stack**（`Factory::NewError` 不采集）；改用 `Object.create(Ctor.prototype)` + 按需 `defineProperty`，否则“无 stack 的 error”回环会多出一段 stack。
- 门禁：`tsc` 干净 · vitest **649 → 670/670**（56 files）· build 绿（worker 2142.20 → **2183.70 kB**）。
- 浏览器端到端：`serialize` 出的字节、`deserialize` 回值、对象引用同一性、Buffer → `5c0a`、`getWireFormatVersion()=15`、`getHeapStatistics()` 招 `ERR_WEB_NODE_NOT_IMPLEMENTED` 全对。

**已知偏离**（写进注释与本文）

- 数组的 elements kind（`PACKED_SMI`/`PACKED_DOUBLE`）由“是否全为 int32 整数”推断；V8 会记住“曾是 double 数组”的历史，JS 看不到，故 `a=[1,2]; a[0]=1.5` 这类历史状态可能与真 Node 分叉（字节层面）。
- `Proxy` 在 JS 里不可识别，代理普通对象会当成普通对象序列化（V8 会招 `#<Object> could not be cloned.`）；迭代器/生成器/Symbol 包装对象的 clone 错误文案已覆盖，其余奇怪对象的文案为近似。
- `config.hasInspector === false`，所以 `v8.takeCoverage`/`stopCoverage` 不存在（等同于不带 inspector 的 Node 构建），`promiseHooks` 能注册但 V8 不会向 JS 回报 promise 事件。

**涉及文件**
新增：`vendor/node-lib/v8.js`、`vendor/node-lib/internal/v8/{heap_profile,cpu_profiler}.js`（+ `MANIFEST.json`）、`src/node-runtime/bindings/serdes.ts`、`src/node-runtime/bindings/v8.ts`、`test/v8.test.ts`、`test/v8-corpus.test.ts`、`test/fixtures/v8-corpus.mjs`、`test/fixtures/v8-corpus.json`、`tools/v8-corpus-oracle.mjs`。修改：`tools/vendor.mjs`、`src/node-runtime/bindings/index.ts`、`src/node-runtime/builtins/{index,vendored-builtins,unsupported,internal-shims}.ts`、`src/demo-project.ts`、`README.md`、`README_zh.md`。

### 2026-09-21 · M53 真 `url`（`lib/url.js` 换真源，`internal/url` 改为宿主 URL 桥）

**目标**：`url` 一直是 116 行的手写近似。Node 的 `lib/url.js`（1045 行）是纯 JS，可以直接 vendor；真正需要自实现的只有它依赖的 `internal/url`，而那半边的 WHATWG 实现建在 native Ada 解析器上。

**改了什么**

1. **vendor 真 `lib/url.js`**（MANIFEST 147 → 148）并注册为 `url` builtin（别名 `node:url`）：`parse` / `format` / `resolve` / `resolveObject` / `Url` 类，加上它从 `internal/url` 重导出的 `URL` / `URLSearchParams` / `URLPattern` / `pathToFileURL` / `fileURLToPath` / `fileURLToPathBuffer` / `urlToHttpOptions` / `domainToASCII` / `domainToUnicode`。
2. **删掉手写 `src/node-runtime/builtins/url.ts`**（116 行）。
3. **`internal/url` 从「re-export `url`」改成自含的宿主 URL 桥**（原来 re-export 会和 vendored `lib/url.js` 形成回环）：
   - `URL`/`URLSearchParams`/`URLPattern` = 宿主同名类（浏览器自带规范实现，与 Node 的 Ada 解等价）；
   - `pathToFileURL` 用 `src/node_url.cc` 的 `EncodePathChars` 表（RFC 1738 unsafe 集：`% # ? " [ \ ] ^ | ~` 与空白/控制字符）编码后交给宿主解析器；相对路径按**运行时的 VFS cwd** 解析（显式把 `process.cwd()` 传给 `path.resolve`，避免走到宿主的 cwd）；
   - `fileURLToPath` 照 `getPathFromURLPosix`（非空 host → `ERR_INVALID_FILE_URL_HOST`、`%2f` → `ERR_INVALID_FILE_URL_PATH`、其余 `decodeURIComponent`）；`toPathIfFileURL`、`fileURLToPathBuffer`、`urlToHttpOptions`、`domainToASCII`/`domainToUnicode` 一并补上；
   - 补上 `lib/url.js` 需要的 `unsafeProtocol`/`hostlessProtocol`/`slashedProtocol` 三个集合。
4. **三个 binding**：`url`（`format(href,hash,unicode,search,auth)`，用宿主 URL 重序列化来复刻 `BindingData::Format`）、`url_pattern`（宿主 `URLPattern`）、`encoding_binding`（`toASCII`/`toUnicode`，hostname 归一化走宿主解析器、`xn--` 解码走 vendored `punycode`）。
5. **`internal/errors`** 补 `ERR_INVALID_URL`（带 `.input`/`.base`）、`ERR_INVALID_URL_SCHEME`（`scheme %s` 复数处理）、`ERR_INVALID_FILE_URL_HOST`、`ERR_INVALID_FILE_URL_PATH`。
6. 修 `test/vendored-strip.test.ts` 的硬编码文件数：改成从 `MANIFEST.json` 推导，vendor 新文件不会再静默漏进 bundle。

**为什么** 手写 `url.parse`/`format` 会在边角持续发散（`slashesDenoteHost`、`host`/`auth` 拆分、query 对象、WHATWG ↔ legacy 互转、IDNA）。vendored 真源一次对齐，上层（`http`/`https`/`fs`/工具链）坐的底座也变成 Node 自己的。

**验证**（逐条对照真 Node v26.9.0）
- 导出面一致：`URL,URLPattern,URLSearchParams,Url,domainToASCII,domainToUnicode,fileURLToPath,fileURLToPathBuffer,format,parse,pathToFileURL,resolve,resolveObject,urlToHttpOptions`。
- `pathToFileURL`（含 `# ? % ~ ( )` 与相对路径）、`fileURLToPath`（含三类错误码）、`domainToASCII/Unicode`、`urlToHttpOptions`（含 port/auth 条件键）、legacy `parse`（含 `true`/`slashesDenoteHost`）、`format`（legacy 对象 + WHATWG URL + options）、`resolve`/`resolveObject` ——输出与真 Node **逐字节一致**。
- 新增 `test/url.test.ts`（9 条）；单测 **640 → 649**；`tsc` 干净；`build` 绿（worker 2141.15 kB）。

**涉及文件**
新增：`vendor/node-lib/url.js`（+ MANIFEST）、`src/node-runtime/bindings/url.ts`、`test/url.test.ts`。删除：`src/node-runtime/builtins/url.ts`。修改：`tools/vendor.mjs`、`src/node-runtime/builtins/{index,vendored-builtins,internal-shims}.ts`、`src/node-runtime/bindings/index.ts`、`test/vendored-strip.test.ts`、`src/demo-project.ts`、`README.md`、`README_zh.md`。

### 2026-09-21 · M52 真 `internal/fs/streams.js`（`fs.ReadStream`/`fs.WriteStream` 换真源）

**目标**：M51 时因顶层 `require('fs')` 回环，`internal/fs/streams.js` 只能用自写 shim `builtins/fs-streams.ts` 顶替。这步把那处**最后的 fs 手写 shim**换成 Node 真源。

**回环为什么能解**

`internal/fs/streams.js` 在顶层 `require('fs')`，而 `lib/fs.js` 只在 `createReadStream`/`createWriteStream`（第 3833 行）与 `internal/fs/promises.js` 的一个惰性 getter 里才 `require('internal/fs/streams')`——真实 Node 也是惰性加载。所以只要把该模块注册成**惰性** builtin（不写进 `fs` 的 `deps`），等第一次建流时 `fs` 已完全求值，顶层 `require('fs')` 拿到的是完整 exports，回环自然消失（此前报错是因为它被当成 `fs` 的静态 dep，被提前实例化）。

**改了什么**

1. `tools/vendor.mjs` 清单加 `internal/fs/streams.js`；`npm run vendor` 生成 `vendor/node-lib/internal/fs/streams.js`（16666 字节），MANIFEST **146 → 147**。
2. `vendored-builtins.ts` 新增 `internal/fs/streams` spec（`origin: node-source`，deps = load-time 真正需要的：`buffer`/`stream`/`fs`/`internal/errors`/`internal/fs/promises`/`internal/fs/utils`/`internal/url`/`internal/util`/`internal/validators`/`internal/streams/destroy`/`internal/constants`）。
3. 删 `src/node-runtime/builtins/fs-streams.ts`，从 `builtins/index.ts` 摘掉 `internalFsStreamsSpec`。
4. `test/vendored-strip.test.ts` 计数 **146 → 147**。

**验证**（`test/fs.test.ts` 扩成 10 例；先跑探针与真 Node oracle 对齐后固化）

- `ws instanceof fs.WriteStream` / `rs instanceof fs.ReadStream`；`bytesWritten === 14`、`path`、`open` 事件回 **number** 型 fd、`{start,end}` 区间为**闭区间**（`start:7,end:11` → `"line-"`、`bytesRead === 5`）——与 node v26.9.0 逐项一致。
- 200000 字节大文件按 `highWaterMark: 65536` 分块读（`total === 200000`、单块 ≤ 65536），`createReadStream().pipe(createWriteStream())` 的副本与源**逐字节相等**。
- 门禁全绿：`npm run typecheck` 干净 · `npx vitest run` **640/640（53 文件）** · `npm run build` 绿（worker **2113.99KB**）。

### 2026-09-21 · M51b 补全 `fs.opendir`/`Dir` 与 `fs.watchFile` 的两个缺口

**目标**：M51 后真 `lib/fs.js` 上还剩两个未实现面——`fs.opendir`/`fs.Dir`（`fs_dir` binding 还是抛错 shape）与 `fs.watchFile`（`StatWatcher.start` 抛错）。这一步按真 `src/node_dir.cc` / `src/node_stat_watcher.cc` 把它们补齐。

**改了什么**

1. **`fs_dir` binding 真实现**（`bindings/misc.ts`）：打开时从 VFS 快照目录项，新增 `DirHandle`（`read(encoding, bufferSize[, req])` 返回 libuv 的扁平 `[name, type, …]` 数组、穷尽返回 `null`；`close([req])`；`dirfd` 返回 -1），以及 `opendir`/`opendirSync`。`internal/fs/dir.js` 的 `Dir` 类因此可以直接跑（sync/回调/异步迭代/`Symbol.dispose` 全通）。错误形状对齐：不存在 `ENOENT`、非目录 `ENOTDIR`。
2. **`StatWatcher` 从抛错换成轮询实现**（`bindings/fs.ts`）：标签页无 inotify，但 libuv 的 `uv_fs_poll` 本身就是一个 stat 轮询器，所以逐行复刻它可观察的协议——首次成功 stat 只做基线（不发事件）；后续 stat 变化时 `onchange(0, [curr…, prev…])`；路径消失时 `onchange(-ENOENT, [zeroed…, lastGood…])`，重现时 `onchange(0, [curr…, lastGood…])`；`onchange` 以 `this === handle` 调用。轮询器用 `ctx.timers.setInterval`（参与事件循环判定，与 libuv 句柄一致），`close()` 释放。

**验证**

- `test/fs.test.ts` 新增 2 例：`opendirSync` + `readSync` 逐个取 Dirent（`isFile`/`isDirectory` 正确、关闭后 `readSync` 抛 `ERR_DIR_CLOSED`）与 `fs.opendir` 的 `for await … of` 异步迭代；`watchFile` 驱动 VFS 写入/删除/重建，事件序列 `['5<-1','0<-5','4<-5']`（与 Node v26.9.0 oracle 的 `['2<-1','0<-2','3<-2']` 同构：change、删除报 0 且 prev=lastGood、重建 prev=lastGood）。
- 门禁全绿：`npm run typecheck` 干净 · `npx vitest run` **639/639（53 文件）** · `npm run build` 绿（worker **2102.07KB**）。

### 2026-09-21 · M51 callback `fs` 换真源码（`lib/fs.js`）

**目标**：M48–M50 依次真源化了 Buffer、Node 真 `vfs` 子系统、`fs/promises`。这一步把**回调式 `fs`** 也从自研 shim 换成 Node 真 `lib/fs.js`（4083 行）——它与 promise 版共用 `internal/fs/utils.js` 的 `vfsState` 派发（挂载了 VFS 的路径走 Node 自己的 handlers，其余落到我们的 `fs` binding）。

**改了什么**

1. **vendor 真源码**（`tools/vendor.mjs`，MANIFEST 142 → 146）：`fs.js`、`internal/fs/read/context.js`（`fs.readFile` 的流式路径）、`internal/fs/cp/cp-sync.js`（`fs.cpSync`）、`internal/streams/fast-utf8-stream.js`（`fs.openAsBlob` 的字节源）。`internal/fs/streams.js` 反之**不进 vendor**（它顶层 `require('fs')` 回环，是预实例化加载顺序解不了的环），另写 `builtins/fs-streams.ts`（VFS 原生 `ReadStream`/`WriteStream`）顶上。`internal/fs/{cp/cp,glob,promises,read/context,recursive_watch,rimraf,watchers,streams,fast-utf8-stream}` 在真 `fs.js` 里都是**惰性** `require`（回到 `fs` 时 `fs` 已求值完），因此 `fs` 的 `deps` 只列加载期真正需要的 12 个模块。
2. **`fs` binding 补齐 `lib/fs.js` 需要的面**（`bindings/fs.ts`）：新增 `readFileUtf8`/`writeFileUtf8`（整文件 utf8 快路）、`handleToFd`、`cpSyncCheckPaths`/`cpSyncCopyDir`/`cpSyncOverrideFile`（对照 `src/node_file.cc` 的顺序/消息/`code`）、`CpDirJob`（`fs.cp` 的异步目录拷贝）、`StatWatcher`（`fs.watchFile` 的轮询器——标签页无 inotify，`start()` 显式抛错而不静默）、`kFsStatsFieldsNumber`。`writeFileUtf8` 做成**单次 VFS 操作**（不是 open+write+close），于是 `fs.watch` 对整文件写入只报一个事件、与 native 路径一致。
3. **`fs_event_wrap.FSEvent` 从抛错换成 VFS 投影**（`bindings/misc.ts`）：真 `internal/fs/watchers.js` 的 `FSWatcher` 直接用 `new FSEvent()` + `handle.onchange(status, eventType, filename)`；现在 `FSEvent.start()` 订阅 `Vfs.subscribe`，按目录/文件给出相对文件名，`create`/`delete` → `rename`、`change` → `change`，`close()` 退订。`fs.watch`/`fs.promises.watch` 因此走真 watchers 代码。
4. **`readSync`/`writeSync` 的 `position === -1`**：真 `lib/fs.js`/`read/context.js` 传 `-1` 表示“当前位置”，之前 `position ?? entry.position` 会把 `-1` 算成偏移，改为 `-1` 与 `null` 同义。

**验证**

- 新增 `test/fs.test.ts`（7 例）：全表面 + `fs.promises === require('fs/promises')`；sync 往返 + `stat`/`readdir({withFileTypes})`；回调 `(err, result)` 形态；`cpSync` 目录树 + 无 `recursive` 时 `ERR_FS_EISDIR`；`createReadStream`/`createWriteStream` 字节往返；`watch` 每个整文件写入/删除各一个 `rename`（跨目录递归、过滤外部路径）；libuv 形状 `ENOENT`（`name='Error'`、`errno=-2`、`syscall='open'`、`ENOENT: no such file or directory, open '/project/nope'`，与本地 Node v26.9.0 oracle 逐字一致）。
- `test/vendored-strip.test.ts` 计数 142 → 146。
- 门禁全绿：`npm run typecheck` 干净 · `npx vitest run` **636/636（53 文件）** · `npm run build` 绿（worker 1990.35 → **2100.56KB**）。

### 2026-09-21 · M50 `fs/promises` 换真源码（`lib/internal/fs/promises.js`）

**目标**：M49 把 Node 自己的 VFS 子系统搬进来后，这一步把 `fs/promises` 也换成真源码——即 Node 的 `lib/internal/fs/promises.js` + `lib/fs/promises.js`，而不是 web-node 手写的转发层。挂载了 VFS 的路径走 Node 自己的派发（`vfsState.handlers`），其余路径落到我们的 `fs` binding。

**改了什么**

1. **vendor 真源码**（`tools/vendor.mjs`，MANIFEST 135 → 142）：`fs/promises.js`、`internal/fs/promises.js`、`internal/fs/{dir,watchers,recursive_watch}.js`、`internal/fs/cp/cp.js`、`internal/vfs/setup.js`。在 `vendored-builtins.ts` 注册（含 `deps`）；`internal/fs/promises` 进 `deps` 的 `internal/fs/glob`、`internal/readline/interface`、`internal/worker/js_transferable` 都已在 M30/M31/M33 就位。
2. **`fs` binding 补齐 async/promise 面**（`bindings/fs.ts`）：真 `src/node_file.cc` 的方法都带一个尾随的 “request wrap” 参数——`kUsePromises` 令牌（返回 Promise）/ 回调函数 / 都没有（同步），`internal/fs/promises` 三种都用。新增 `kUsePromises` 令牌 + `wrap()` 三态派发，并实现：`read`/`readBuffers`/`writeBuffer`/`writeBuffers`/`writeString`、`stat`/`lstat`/`fstat`（返回 `getStatsFromBinding` 预期的 18 槽元组，bigint 同名 BigInt64Array）、`statfs`、`access`/`copyFile`/`rename`/`unlink`/`rmdir`/`mkdir`/`readdir`（`{0:names,1:types}`）/`mkdtemp`/`realpath`/`openFileHandle`/`ftruncate`/`truncate`/`fsync`/`fdatasync`/`chmod`/`chown` 家族/`utimes` 家族；`FileHandle`（fd 包装，带 `getAsyncId`/`close`/`closeSync`）、`ReadFileJob`（open+fstat+read；≤一 chunk 整体返回 fd=-1，大文件返回 fd+size）、`WriteFileJob`。复制文件类都走 VFS；VFS 没有符号链接，因此 `symlink`/`link`/`readlink` 显式报错（不静默）。
3. **`hideStackFrames` 补 `.withoutStackTrace`**（`bindings` 的 `errors` 上下文）：真 `internal/validators` 用 `validateX.withoutStackTrace(...)` 绕过推栈隐藏，之前是个空包装，属性不存在就 `is not a function`。
4. **`internal/fs/rimraf` 改为 VFS 原生 shim**（`internal-shims.ts`）：Node 真 rimraf 用回调 `fs` + `Buffer` 路径 + 线程池，浏览器标签页三样都没有；改成同样契约（`{ rimraf, rimrafPromises }`）的 VFS 递归删除，`internal/fs/promises` 的 `rm` 只用到 `rimrafPromises`。
5. **`fs.promises` 指向同一个对象**：`fs.promises === require('fs/promises')`（惰性 getter，避开 `internal/fs/promises` ↔ `fs` 的加载环）。

**验证**

- 新增 `test/fs-promises.test.ts`（8 例）：`fs/promises === fs.promises`、写读往返（string/Buffer）、`stat`/`lstat` 类型 + bigint、递归 `mkdir`/`readdir`（含 withFileTypes）/`rm`、`rename`/`copyFile`/`unlink`、`appendFile`/`access`、`FileHandle` 读写关、libuv 形状的 `ENOENT`（`errno=-2` + `no such file or directory, open '<path>'`，与本地 Node v26.9.0 oracle 逐字一致）。
- `test/util.test.ts`、`test/vendored-strip.test.ts` 计数随 vendor 清单更新。
- 门禁全绿：`npm run typecheck` 干净 · `npx vitest run` **630/630（52 文件，+8 例）** · `npm run build` 绿（worker 1853.49 → **1990.35KB**）。

### 2026-09-21 · M49 Node 真 `vfs` 子系统 + fs 基座（`lib/internal/fs/utils.js` + `lib/internal/vfs/*`）

**目标**：让运行时拥有 Node 自己的虚拟文件系统管线。本地 Node checkout（`v26.x`）带一个官方 **VFS** 特性（`lib/vfs.js` + `lib/internal/vfs/*`）：一个可挂载多个 `VirtualProvider` 的 `VirtualFileSystem`，`fs`/`fs/promises` 在方法体内把调用**派发**给 `vfsState.handlers`。这是把 `fs` 层真源化的天然入口，所以先把地基搬进来。

**改了什么**

1. **vendor 真源码**（`tools/vendor.mjs`，MANIFEST 123 → 135）：新增 `internal/fs/utils.js`（fs 基座）+ `internal/vfs/{errors,router,fd,stats,provider,dir,file_handle,streams,watcher,file_system}.js` + `internal/vfs/providers/memory.js`。在 `vendored-builtins.ts` 逐个注册 spec（含 `deps`）；删掉 `internalShims` 里那个只导出 `DirentFromStats` 的 `internalFsUtilsSpec`。
2. **新增 `vfs` 模块**（`builtins/vfs.ts`，`origin: 'web-node'`）：镜像 `lib/vfs.js` 的 `create`（首参数为普通对象时视为 options）+ `VirtualFileSystem`/`VirtualProvider`/`MemoryProvider`；`RealFSProvider`（要映射宿主文件系统，浏览器标签页里不存在）与 `ZipProvider`（要 `internal/zip`）导出为构造即抛的类，保持形状而不静默为 `undefined`。
3. **`uv` binding 换成真 errno 表**：`deps/uv/include/uv.h` 的 `UV_ERRNO_MAP`（85 条）生成到 `vfs/types.ts` 的 `ERRNO`/`ERRNO_DESC`，`uv` binding 据此提供 `getErrorMap`/`getErrorMessage`/`errname`；`internal/errors` 补上真 `UVException` 类并把 `uvErrmapGet` 接到同一张表（之前 `uvErrmapGet` 恒 undefined、`uv` 表为空）。
4. **`constants` binding 补全 `fs`/`os` 表**：access modes（`F_OK`/`W_OK`/`R_OK`/`X_OK`）、`O_SYNC`/`O_DSYNC`/`O_NONBLOCK`/`O_NOCTTY`/`O_SYMLINK`、`S_IFBLK`/`S_IFCHR`/`S_IFIFO`/`S_IFSOCK`、`UV_FS_SYMLINK_*`、`UV_DIRENT_*`、`os.devNull`、`os.errno`（真 `internal/fs/utils.js` 与 `internal/vfs/*` 都需要）。
5. **fs binding 补两个方法**：`internalModuleStat`（模块类型探测，供递归 readdir 用）与 `readdirRecursive`（返回 `{0:names,1:types,2:counts,3:dirs}`，`getRecursiveDirents` 消费的形状）。

**验证**

- 新增 `test/vfs.test.ts`（9 例）：模块导出键、`RealFSProvider`/`ZipProvider` 显式抛错、读写/stat/lstat、递归 readdir（扁平 + Dirents）、fd 往返、copy/rename/unlink/append、realpath/mkdtemp/rm -r、`ENOENT`/`EEXIST` 的 libuv 形状（含 `errno=-2` 与原始 message）、promise API、utf8 字节长度——**逐值对照真 Node v26.9.0（`node --experimental-vfs`）**。
- `test/util.test.ts` 更新：`getSystemErrorMap()` 从「空表」改为真表（85 条，`-2 → ['ENOENT','no such file or directory']`）。
- 门禁全绿：`npm run typecheck` 干净 · `npx vitest run` **622/622（51 文件，+10 例）** · `npm run build` 绿（worker 1716.13 → **1853.49KB**）。

### 2026-09-21 · M48 `Buffer` 换真源码（`lib/buffer.js` + `lib/internal/buffer.js`）

**目标**：`Buffer` 一直是自研 TS（`builtins/buffer.ts`，内含编码与 `indexOf*`）。Node 有一份完整的 JS 实现（`lib/buffer.js` 1539 行 + `lib/internal/buffer.js` 1154 行），跑在 `buffer` binding 上。把它 vendor 进来，`Buffer` 的可见语义（编码、`indexOf` 负偏移、`fill` 平铺、池化、`transcode`、`Blob` 身份…）就整体与真 Node 对齐，不必再逐个对拍。

**改了什么**

1. **vendor 真源码**（`tools/vendor.mjs`）：新增 `buffer.js`、`internal/buffer.js`、`internal/v8/startup_snapshot.js`、`util/types.js`（MANIFEST 119 → 123）。在 `vendored-builtins.ts` 注册四个 spec（含 `deps`）：`util/types` ← `internal/util/types`；`internal/buffer` ← `internal/errors`/`internal/validators`/`util/types`；`buffer` ← `internal/util`/`internal/util/types`/`internal/util/inspect`/`internal/assert`/`internal/errors`/`internal/validators`/`internal/buffer`/`internal/v8/startup_snapshot`。删除自研 `builtins/buffer.ts`（680 行）与 `internalShims` 里的 `internalBufferSpec`。
2. **`buffer` binding 重写**（`src/node-runtime/bindings/buffer.ts`，逐字节移植 `src/node_buffer.cc` + `src/string_bytes.cc` + `deps/nbytes`）：
   - slice：`asciiSlice`（每字节 &0x7f）/`latin1Slice`/`hexSlice`/`ucs2Slice`/`utf8Slice`（WHATWG 解码、留 BOM、坏序列 → U+FFFD）/`base64Slice`/`base64urlSlice`。
   - write：`asciiWriteStatic`/`latin1WriteStatic`/`utf8WriteStatic`（截断不切字符）/`ucs2Write`/`hexWrite`/`base64Write`/`base64urlWrite`，共享 `keepInRange`。
   - search：`indexOfString`/`indexOfBuffer`/`indexOfNumber`，实现 `IndexOfOffset` 的负偏移与 clamp 语义、UCS2 按码元对齐、`nbytes::SearchString` 前后向。
   - 其它：`compare`/`compareOffset`（`normalizeCompareVal`）、`copy`、`fill`（含 `base_fill` 平铺算法）、`swap16/32/64`、`byteLengthUtf8`、`isAscii`（>0x7f 即 false）、`isUtf8`（fatal 解码探测）、`atob`/`btoa`（非法字符/长度返回 -1/-2）、`copyArrayBuffer`、`createUnsafeArrayBuffer`/`arrayBufferAlignedOffset`/`setDetachKey`。
3. **`icu` binding 补 `transcode`/`icuErrName`**（`bindings/misc.ts`）：UTF-8/UCS2/Latin1/ASCII 互转（不可表示字符 → `?`/U+FFFD），坏编码返回 ICU 状态码 `1`——真 `lib/buffer.js` 据此抛 `Unable to transcode Buffer [U_ILLEGAL_ARGUMENT_ERROR]`；并按 `node::Buffer::New` 让返回值为真 `Buffer`（借用 `ctx.requireBuiltin('buffer')` 惰性拿到 `Buffer`，避免循环）。
4. **新增 `mksnapshot` binding**（`bindings/misc.ts` + `bindings/index.ts`）：`isBuildingSnapshotBuffer:[false]` + 三个 no-op，真 `internal/v8/startup_snapshot.js` 只在 `isBuildingSnapshot()` 为真时才做事，故本运行时它是 inert 的。
5. **`util` binding 的 `privateSymbols` 补 `untransferable_object_private_symbol`**（真 `internal/buffer.js` 的 `markAsUntransferable` 需要；`worker_threads` 也读它）。
6. **`internal/errors` 补 code**：`ERR_BUFFER_OUT_OF_BOUNDS`（含自定义 message：带名字时 `"x" is outside of buffer bounds`）/`ERR_BUFFER_TOO_LARGE`/`ERR_INVALID_BUFFER_SIZE`/`ERR_DUPLICATE_STARTUP_SNAPSHOT_MAIN_FUNCTION`/`ERR_NOT_BUILDING_SNAPSHOT`/`ERR_NOT_SUPPORTED_IN_SNAPSHOT`。

**验证**

- 新增 `test/buffer-codec.test.ts`（14 例）：模块导出键、`constants`、各编码 slice、ascii/latin1 不对称解码、hex 奇数位、UCS2 检索、Buffer 检索、三种 `swap`、hex/多字节 utf8/latin1 的 `fill`、`isAscii`/`isUtf8`、`transcode` 往返与错误、`btoa`/`atob`、`allocUnsafeSlow` 尺寸——**逐值对照真 Node v26.9.0 的实测输出**。
- 门禁全绿：`npm run typecheck` 干净 · `npx vitest run` **626/626（51 文件，+14 例）** · `npm run build` 绿（worker 1642.64 → **1716.13KB**）。

### 2026-09-21 · M47 `crypto` 对称密码（`createCipheriv`/`createDecipheriv`，AES ECB/CBC/CTR/CFB/OFB/GCM）

**目标**：补上 M34 留下的另一半——摘要/MAC/KDF 已经是真实现，但 `createCipheriv`/`createDecipheriv` 一直是抛错 stub。Node 的 cipher 是 **同步、流式** 的（`update()`/`final()`），而 WebCrypto 是 **promise-only**，顶不上；所以 AES 直接在 JS 里按 **FIPS-197 + NIST SP 800-38A/D** 实现，逐字节对齐 OpenSSL。

**改了什么**

1. **新增 `src/node-runtime/crypto/cipher.ts`**（`origin: web-node`，Node 没有 JS cipher 可 vendor）：
   - AES 核心：S-box 由 GF(2^8) 乘法逆 + 仿射变换生成，`AesKey` 密钥扩展（128/192/256 → 10/12/14 轮），字节级 `encryptBlock`/`decryptBlock`（SubBytes/ShiftRows/MixColumns 及其逆）。
   - 模式：ECB、CBC（链值）、CTR（128 位计数器）、CFB128（反馈寄存器，部分块按 OpenSSL 语义续用同一 keystream）、OFB（keystream 自反馈）、GCM（CTR + GHASH + 认证标签）。
   - GCM：`Ghash` 流式吸收（AAD 与密文**各自**补零到块边界，最后接 64 位长度块）；`computeJ0` 对 12 字节 IV 用 `IV||0x00000001`、其余长度走 GHASH 派生；标签 = `E(K,J0) ^ GHASH(...)`。
   - PKCS#7 补位（ECB/CBC 默认开，`setAutoPadding(false)` 关）；解密在 `final` 剥补位并校验；解密时保留最后一个整块到 `final`。
   - 元数据：`listCiphers()`（本运行时实现的子集，排序）、`resolveCipher()`、`isKnownCipherName()`（OpenSSL v26.9.0 的 165 个名字，用于分类错误）、`getCipherInfo()`（实现子集的完整信息，含 `nid`）。
2. **`src/node-runtime/builtins/crypto.ts` 接线**：新增 `createCipheriv`/`createDecipheriv`/`getCiphers`/`getCipherInfo`；key/iv/data/tag 的强制转换与校验（错误码/消息对齐真 Node）；cipher 对象只在 encrypt 侧暴露 `getAuthTag`、只在 decrypt 侧暴露 `setAuthTag`（未暴露的方法在 Node 里也是 `undefined`）；从 unsupported 表里**移除 `createCipher`/`createDecipher`**（Node v26 已删，两者在真 Node 里就是 `undefined`）。
3. **测试**：新增 `test/cipher.test.ts`（127 例，向量由 `/tmp/cipher-oracle.cjs` 从真 Node v26.9.0 导出）：18 种 AES 组合 × 三种明文（43 字节需补位 / 64 字节整块 / 空）的加密+解密往返、FIPS-197 与 NIST SP 800-38A/D 公开向量、GCM+AAD、分块流式与一次性一致、别名与大小写、`getCiphers`/`getCipherInfo`、以及错误矩阵（未知 cipher、未实现 cipher、key/iv/data 校验、坏标签、坏补位、状态机）。
4. `test/crypto.test.ts` 的「unsupported surface」用例更新：`createCipheriv` 不再是未实现面（改用 `chacha20-poly1305` + `createSign`），`getCiphers` 不再抛错。
5. `src/demo-project.ts` 加 `-- AES ciphers (milestone 47) --` 演示段（CBC 往返、GCM 标签、`getCiphers`）。

**为什么**：这是 DEVLOG「下一步」里明列的剩余缺口之一，且是**纯 JS 可自洽实现、可逐字节验证**的。同为 `crypto` 的对称半边，补齐后服务器类代码（JWT/cookie 加密等）才真能跑。

**涉及文件**：`src/node-runtime/crypto/cipher.ts`（新）、`src/node-runtime/builtins/crypto.ts`、`test/cipher.test.ts`（新）、`test/crypto.test.ts`、`src/demo-project.ts`。

**验证**：`tsc --noEmit` 干净 · `vitest run` **612/612**（50 文件，+127） · `vite build` 绿（worker 1626.66 → **1642.64KB**）。demo 段实跑输出：`cbc ct : 1da882ff7d81c19260aa4a07fd2fbef87961fcc2...`、`cbc pt : The quick brown fox jumps over the lazy dog`、`gcm ciphers : 18 aes entries`。

### 2026-09-21 · M46 宿主 WebSocket 计入退出判定（+ loader 顶层词法声明冲突修复）

**目标**：补上 M44 的同类缺口——宿主 **`WebSocket`** 是一条**长生命周期的宿主句柄**（不是微任务 promise），之前完全不计入退出判定：子进程只剩一条开着的 socket 时会被提前报成已退出，socket 之后投递的消息直接丢失。真 Node v26.9.0 实测确认：`new WebSocket(...)`（服务器只接不接受握手）会把事件循环吊住、进程不退出，直到 socket close/error。

**改了什么**

1. **runtime 包装沙箱 `WebSocket` 并计入 `activeCount()`**（`src/node-runtime/runtime.ts`）。新增 `#hostSockets` 计数与 `#trackHostSocket(socket)`：`#wrapHostSocket` 返回一个真 socket（构造器返回值覆盖 `this`），共享原型保持 `instanceof`，复制静态 `CONNECTING`/`OPEN`/`CLOSING`/`CLOSED`，并在 `close`/`error` 上释放计数（两者会依次触发，释放加锁只生效一次）；计数并入 `#activeWorkCount()`。`proc/host.ts` 的 `#checkSettle`/`syncSettled` 因此能看到开着的 socket。
2. **按 run 隔离计数**（`resetRunState`）：`#hostSockets` 随 `#hostGeneration` 一起重置，上一次 run 遗留的 socket 之后 close 时不会改动新 run 的计数（也不会减成负数）。
3. **顺带修一个被它暴露的 loader 真 bug**（`src/node-runtime/loader/index.ts`）。沙箱全局是以 **wrapper 参数**注入每个模块的，所以模块顶层又 `const WebSocket = websocket;`（Vite 的 chunk 里就有这行）时会 `Identifier 'WebSocket' has already been declared`、整个 `vite build` 编译失败。新增 `topLevelLexicalBindings(code)`：用**长度保持的 `codeMask` 分词器**（字符串/模板/注释/正则先掩成空格）扫出模块顶层被 `let`/`const`/`class` 绑定的名字，`#injectedGlobals(code)` 把这些名字从**该模块自己的** wrapper 参数里剔除（只影响这一个模块，别的模块照常拿到全局）。顺带把 `#paramNames` 的重算拆开（CJS 参数在调用点拼），无注入冲突时零拷贝走原数组。
4. `proc/host.ts` 头部文档同步：把「唯一诚实缺口」从「in-flight fetch」扩到「宿主句柄（fetch / 开着的 socket）」。

**为什么**：这是 M44 同类问题的姊妹缺口（宿主句柄 vs 宿主 promise），同为**静默数据丢失**。而修它才暴露出 loader 的注入冲突——那是一个**只要模块顶层声明了任一注入名就会炸**的通用 bug，与 WebSocket 无关（`btoa`/`performance` 等触发同一个错误）。

**涉及文件**：`src/node-runtime/runtime.ts`、`src/node-runtime/proc/host.ts`、`src/node-runtime/loader/index.ts`、`test/host-socket.test.ts`（新）。

**验证**：`tsc --noEmit` 干净 · `vitest run` **485/485**（49 文件，+6） · `vite build` 绿（worker 1625.03 → **1626.66KB**）。`test/host-socket.test.ts` 用宿主 `FakeWebSocket`（`EventTarget` 子类）钉住：开着的 socket 计入 `activeCount`、`close`/`error` 释放计数、`resetRunState` 后陈旧 socket 的释放不影响新 run、`instanceof` 与静态常量保持；另用真宿主 `WebSocket`（连 `127.0.0.1:1` 被拒）验证包装后确实 +1 并在 `error`/`close` 后归零。`test/_m5c`/`_m5d`/`_m18`（页内 `vite build`/dev server/Vue SFC）此前因注入冲突失败，修复后全绿。

### 2026-09-21 · M45 真 `zlib`（deflate/gzip 跑在平台 codec 上）

**目标**：把 `zlib` 从「无一可用」的 stub 变成真模块。Node 的 zlib 是原生绑定，但浏览器里有一个同源 codec：WHATWG Compression Streams（`CompressionStream`/`DecompressionStream`）。拿它当后端，就能在不重写压缩器的前提下把 deflate/gzip 做到**字节级对齐**。

**改了什么**

1. **新增 `src/node-runtime/builtins/zlib.ts`**（`origin: web-node`，不是 vendored——Node 没有 JS zlib 可 vendor）。提供流式面（`createDeflate`/`createInflate`/`createDeflateRaw`/`createInflateRaw`/`createGzip`/`createGunzip`/`createUnzip` + 对应类）、一次性异步面（`deflate`/`inflate`/`deflateRaw`/`inflateRaw`/`gzip`/`gunzip`/`unzip`）、`crc32`、`constants`、`codes`。流变换是个 `Transform`，在 `_transform` 里把块写进平台的 `writable`，同时异步地把 `readable` 的产出 `push` 出来；`_flush` 关 writable 并等 drain 完成。
2. **`unzip` 按魔数自动识别**：先缓冲头两个字节，`1f 8b` → gunzip，否则 zlib deflate（与 Node 一致）；裸 deflate 报 `Z_DATA_ERROR`。逐字节喂入也能正确识别。
3. **错误形状对齐 Node**：解压失败包成 `genericNodeError(message, { errno, code })` 的形状（`name='Error'`、`code='Z_DATA_ERROR'`、`errno=-3`）；平台不带文案时用 per-code 默认文案（`Z_DATA_ERROR` → `incorrect header check`，与真 Node 同）。
4. **不同步也不半吊子**：同步形式（`gzipSync` 等）与 `level`/`windowBits`/`memLevel`/`strategy`/`flush`/`finishFlush`/`dictionary`/`params` 这些**编码参数**，平台 codec 无对应面，传非默认值即抛 `NotImplementedError`（宁可报错也不静默产出错尺寸的流）；brotli/zstd/zip 全组抛错。`chunkSize`/`maxOutputLength` 是结构参数、可献。
5. **注册与解锁**：`builtins/index.ts` 注册 `zlibSpec`，从 `unsupported.ts` 删掉 `zlib` stub；`internal/webstreams/compression.js` 的 `lazyZlib()` 现在拿得到 `createDeflate` 等，于是 `stream/web` 的 `CompressionStream`/`DecompressionStream` 从抛错变成**可用**（`brotli` 格式仍抛）。

**为什么**：`zlib` 是少数还整个缺位的核心模块之一，且它与 M36/M38 两个已标记的「剩」直接相关（`CompressionStream` 与 future `zlib/iter`），而且是真构建工具会 `require` 的模块。用平台 codec 而非重写，契合项目「能用平台原语就不自己造」的一贯做法（同 M34 的随机数走 WebCrypto）。

**涉及文件**：`src/node-runtime/builtins/zlib.ts`（新）、`src/node-runtime/builtins/index.ts`、`src/node-runtime/builtins/unsupported.ts`、`src/node-runtime/builtins/vendored-builtins.ts`（改注释）、`src/demo-project.ts`（新增 `-- zlib (milestone 45) --` 演示段）、`test/zlib.test.ts`（新）、`test/webstreams.test.ts`、`test/runtime.test.ts`、`test/child-process.test.ts`（顺手修一个既有的计时 flake：`keeps stderr separate...` 用裸 `tick()` 等子进程输出，改为该文件已有的 `waitForOutput`）。

**验证**：`tsc --noEmit` 干净 · `vitest run` **479/479**（48 文件，+12） · `vite build` 绿（worker 1615.25 → **1625.03KB**）。`test/zlib.test.ts` 的每个字节期望都来自真 Node v26.9.0（探针：`gzip('hello hello hello hello')` → `1f8b0800...17000000`；13500 字节 fox 段 → gzip 119B / deflate 107B / deflateRaw 101B，三段 hex 前缀逐字对齐；空输入 gzip → `1f8b080000000000001303000000000000000000`；`gunzip('')` → `Z_BUF_ERROR`/`-5`/`unexpected end of file`；`crc32('hello')` → 907060870，带种子 0xFFFFFFFF → 265137764）。`test/webstreams.test.ts` 把「zlib codec 抛错」改成「gzip/deflate/deflate-raw 三种格式 round-trip 成功、仅 brotli 抛错」。

### 2026-09-21 · M44 宿主请求计入退出判定（child_process M7 遗留收尾）

**目标**：修掉 child_process 遗留的最后一个缺口——子进程的剩余工作是**宿主 promise**（in-flight `fetch`）时，退出判定看不见它，子进程会被提前报成已退出、它的输出直接丢掉。

**改了什么**

1. **runtime 把在飞的宿主请求计入 `activeCount()`**（`src/node-runtime/runtime.ts`）。新增 `#hostRequests` 计数与 `#trackHostRequest(promise)`：包装沙箱局部的 `fetch`，调用时 +1、settle 时 -1（成败都释放），并把计数并入 `#activeWorkCount()`。`proc/host.ts` 的 `#checkSettle`/`syncSettled` 用同一计数，所以子进程会在 fetch 落地后才判定退出。
2. **只计真正的宿主 I/O，不计纯微任务 promise**。根因是拿真 Node v26.9.0 实测定的：in-flight `fetch` **会**把事件循环吊住（底层 socket 是 ref'd 句柄），而 `crypto.subtle.digest()`、`Blob.prototype.arrayBuffer()`、裸 `new Promise(() => {})` 都是微任务，**不**吊循环。因此只包装 `fetch`，后者一律不计数——计数错了会让纯 JS 项目永不退出。
3. **按 run 隔离计数**（`resetRunState`）。加 `#hostGeneration`：上一次 run 遗留的 fetch settle 时不再减当前 run 的计数，避免计数泄漏或减成负数。
4. 顺带更新 `proc/host.ts` 头部文档：把那段「唯一诚实缺口」改成说明已覆盖。

**为什么**：这是 M40 遗留的最后一个「已知不正确」，且属于**静默数据丢失**（子进程的下载结果在打印前就没了）。修复后子进程的退出判定与真 Node 的「句柄/请求存活则循环不退出」语义对齐。

**涉及文件**：`src/node-runtime/runtime.ts`、`src/node-runtime/proc/host.ts`、`test/host-request.test.ts`（新）。

**验证**：`tsc --noEmit` 干净 · `vitest run` **467/467**（47 文件，+4）· `vite build` 绿（worker 1614.99 → 1615.25KB）。四条新测试均为 A/B 验证过：无修复时子进程输出为空（`done|""`），修复后拿到 `done|"fetched|..."`；反向测试（纯 pending promise 子进程仍立即退出、父进程自己的 in-flight fetch 不吊住子进程）防止计数过度。

**仍缺（有意）**：沙箱的 `WebSocket` 是其构造出来的一个长命句柄，`fetch` 那样能等一个 promise，它需要包装构造函数才能追（同属「宿主请求」类）。实际构建脚本极少开 WS，且它的生命周期不像 fetch 有一个可挂的 promise，本轮暂不处理。

### 2026-09-21 · M43 `process` 表面补齐 + 未捕获异常路由 + VfsError 形状

**目标**：把 `process`（我们唯一手写的核心模块，没有 `lib/process.js` 可 vendor）与真 Node v26.9.0 做一次逐键对照，补掉缺的 API；顺带修掉对照时挖出的两处真差异（错误消息格式、回调里抛异常被吞）。

**改了什么**

1. **`process` 缺的 API 补齐**（`src/node-runtime/builtins/process.ts`）。新增：`getBuiltinModule`（只解析公开核心模块，`internal/*` 与未知 id 返回 `undefined`，非字符串抛 `ERR_INVALID_ARG_TYPE`）；`getActiveResourcesInfo`（定时器句柄按 Node 只列 refed 项——每个 refed timeout/interval 一个 `Timeout`、每个 refed immediate 一个 `Immediate`，监听中的 socket 由 `net/network.ts` 的 `activeResources()` 补）；`hasUncaughtExceptionCaptureCallback`/`setUncaughtExceptionCaptureCallback`/`addUncaughtExceptionCaptureCallback`（二次安装抛 `ERR_UNCAUGHT_EXCEPTION_CAPTURE_ALREADY_SET`，`add` 与主回调并存但不算「已装」）；`loadEnvFile`（按 `util.parseEnv` 解析 `.env`，已存在的环境变量不覆盖，缺文件抛 `ENOENT`）；`reallyExit`/`openStdin`/`ref`/`unref`（主线程 no-op，返回值与 Node 一致）/`debugPort`（9229）/`domain`（null）`_exiting`；`report`（`getReport`/`writeReport` 的最小实现，键集与真 Node 对齐）。移除 `noDeprecation`/`throwDeprecation`/`traceDeprecation`（真 Node 已删）。
2. **`uncaughtCapture` + `activeResources` 收进 binding 上下文**（`src/node-runtime/bindings/context.ts`、新建 `src/node-runtime/bindings/uncaught.ts`）。`triggerUncaughtException` 走共享 dispatcher：先问捕获回调，再发 `uncaughtException` 事件（`misc.ts` 的 `errors` binding 与 `internal/promise_hooks` 都汇到同一处）。`timers` binding 的 `setupTimers` 加 `__activeResources()`。
3. **回调里抛出的异常不再被吞（真 bug）**。`timers` binding 的驱动是**宿主**定时器（`hostSetTimeout`），回调里抛出会直接成为宿主 macrotask 的未捕获异常，绕过 `process._fatalException` —— 于是 `setUncaughtExceptionCaptureCallback` / `process.on('uncaughtException')` 完全不响。现在 `armTimer` / `ensureCheck` 都包一层 `try/catch` → `triggerUncaughtException`；`runtime.ts` 的 `#drainNextTicks` 同样逐条包 `try/catch`（Node 里一个 tick 抛出不会中断其余 tick）。对照真 Node：三条探针（timer 抛出 → 捕获回调 / timer 抛出 → 监听器 / nextTick 抛出 → 监听器）输出逐字节一致。
4. **`VfsError` 的形状改成 Node 的 `UVException`**（`src/node-runtime/vfs/types.ts`）。之前是 `ENOENT: open, '/project/nope.env'`，真 Node 是 `ENOENT: no such file or directory, open '/project/nope.env'`。现在按 `lib/internal/errors.js` 的 `UVException` 拼：`` `${code}: ${libuv 描述}, ${syscall} '${path}'` ``，描述取自 libuv 的 `UV_ERRNO_MAP`（`deps/uv/include/uv.h`，即 `uv_strerror` 的返回值），`name` 也改回 `Error`（Node 的 fs 错误不是自定义类），`errno` 按 `ERRNO` 表。显式传 `message` 的调用点（如 open flag 非法）保持原样。

**为什么**：`process` 是任何 Node 程序的入口面，缺键会被 `in`/`typeof` 检查、库启动逻辑、诊断工具直接踩到；错误消息格式被大量测试逐字节断言；回调抛异常被吞则是**静默错误丢失**，属于必须修的一类。

**涉及文件**：`src/node-runtime/builtins/process.ts`、`src/node-runtime/bindings/context.ts`、`src/node-runtime/bindings/uncaught.ts`（新）、`src/node-runtime/bindings/timers.ts`、`src/node-runtime/bindings/misc.ts`、`src/node-runtime/bindings/util.ts`、`src/node-runtime/builtins/internal-shims.ts`、`src/node-runtime/net/network.ts`、`src/node-runtime/runtime.ts`、`src/node-runtime/vfs/types.ts`、`test/process-surface.test.ts`（新）、`test/vfs.test.ts`。

**验证**：`tsc --noEmit` 干净 · `vitest run` **463/463**（46 文件，+9）· `vite build` 绿（worker 1609.23 → 1614.99KB）。真 Node v26.9.0 oracle 对照：`getBuiltinModule` 身份相等、`getActiveResourcesInfo` 的 refed 计数、捕获回调的状态机与三条错误 code/message、`.env` 解析、三条未捕获异常探针——全部逐字节一致。

**仍缺（有意）**：`process` 上 `_debugEnd`/`_debugProcess`/`_eval`/`_fatalException`/`_getActiveHandles`/`_getActiveRequests`/`_kill`/`_preload_modules`/`_rawDebug`/`_startProfilerIdleNotifier`/`_stopProfilerIdleNotifier`/`_tickCallback`（全是有 `_` 前缀的内部/调试面）与 `dlopen`/`execve`/`initgroups`/`setegid`/`seteuid`/`setgroups`（Unix 原生）/`moduleLoadList`（需 `--expose-internals`）仍是**不存在**，即与真 Node 的 `in` 结果不同；这些不面向用户代码，暂不提供。

### 2026-09-21 · M42 `util.inspect` / ICU 列宽保真度（清单 10b）

**目标**：把清单第 10b 项收尾——`internal/util/inspect` 的保真度。先照着惯例跑真 Node v26.9.0 逐一对照，发现两处**可修**的差异（其余是 V8 内部状态，JS 看不见，只能近似）。

**改了什么**

1. **`types` binding：`isGeneratorFunction` / `isAsyncFunction`（真 bug）**（`src/node-runtime/bindings/types.ts`）。V8 的 `SharedFunctionInfo::is_generator()` 对 **sync 与 async** 生成器都为真，`IsAsyncFunction` 对 `async function*` 也为真——所以 `async function*` **同时**满足两个谓词。之前两个谓词都只认单一 tag（`GeneratorFunction` / `AsyncFunction`），于是 `async function*` 两个都返回 `false`，真 inspect 里 `type` 停在 `Function`，只在后附加 `AsyncGeneratorFunction`，得到 `[Function: asyncGenFn] AsyncGeneratorFunction`。现在两个谓词都补上 `AsyncGeneratorFunction` tag，输出 `[AsyncGeneratorFunction: asyncGenFn]`。顺带 `isGeneratorObject` 也补上 `[object AsyncGenerator]`。
2. **`icu.getStringWidth` 用真列宽重写**（`src/node-runtime/bindings/misc.ts`）。之前是 `str.length`（CJK 只算 1 列），而 `util.inspect`（`breakLength` 折行）、`console.table`（列宽）、readline 都依赖它。现在按 `src/node_i18n.cc` 的 `GetColumnWidth` 规则重写：东亚宽/全宽码点 2 列、emoji-presentation 2 列、控制/格式/组合/包围标记与 emoji 修饰符 0 列（U+00AD soft hyphen 例外，占 1 列），其余 1 列。宽/全宽集合用真 Node **无 ICU 回退分支**（`lib/internal/util/inspect.js`）的同一份 EastAsianWidth 区间；emoji / 零宽判定用 V8 支持的 `\p{Emoji_Presentation}` / `\p{Emoji_Modifier}` / `\p{Cc}\p{Cf}\p{Me}\p{Mn}` Unicode 属性转义。`expand_emoji_sequence`（ZWJ 序列折叠）语义也复刻。`ambiguousAsFullWidth` 无法在 JS 侧还原（需要 East_Asian_Width Ambiguous 集），**改为显式抛 `NotImplementedError`** 而不是静默忽略。`util` binding 的 `getStringWidth` 改为指向同一函数（避免两处定义漂移；真实 Node 只把它放在 `icu` 上）。
3. **保留的近似（明示）**：`getPromiseDetails` 恒 `kPending`、`getProxyDetails` 恒 `undefined`（V8 不同步暴露 promise 状态 / 代理目标，从 JS 不可达）；Map/Set **迭代器**的内部 next-index JS 读不到，故迭代器预览为空（集合本体 `Map(n){...}`/`Set(n){...}` 正常）。这三条在 `test/util-inspect.test.ts` / `bindings/util.ts` 头部都有文档化说明。

**为什么**：inspect 是调试/日志的主出口，输出被**逐字节**断言。`async function*` 的标签和 CJK 列宽都是普通用户代码会踩到的可观测行为，属于能修就修的那一类；修不了的三处则明确标注，不假装支持。

**涉及文件**：`src/node-runtime/bindings/types.ts`、`src/node-runtime/bindings/misc.ts`、`src/node-runtime/bindings/util.ts`、`test/internal-util-types.test.ts`、`test/util-inspect.test.ts`、`test/console.test.ts`、`test/icu-width.test.ts`（新）。

**验证**：`tsc --noEmit` 干净 · `vitest run` **454/454**（45 文件，+7）· `vite build` 绿（worker 1608.21 → 1609.23KB）。真 Node v26.9.0 oracle 对照：`getStringWidth` 14 例全等、`console.table([{name:'中文'…}])` 与 `inspect({k:'中'×50},{breakLength:60})` 输出逐字节一致。

### 2026-09-21 · M41 Buffer slab 池化（M9 尾声）

**目标**：补上 M9 留的尾巴。`Buffer.allocUnsafe` / `from(string)` / `concat` 之前每个都 `new Buffer(n)`——即每次分配一块**恰好大小**的 ArrayBuffer（`.byteOffset` 恒为 0、`.buffer.byteLength === length`）。真 Node 不是这样：小于 `Buffer.poolSize >>> 1` 的分配会从**一块大 slab** 里切槽，于是 `.buffer` 被多个 Buffer 共享、`.byteOffset` 有意义、`.buffer.byteLength` 是一整个 slab 大小。这不影响字节语义，但**是可观测的**（`buf.buffer.byteLength`、`buf.byteOffset`、以及“两个小 Buffer 是否共享内存”），所以按项目的「不半执行」原则对齐。

**改了什么**（`src/node-runtime/builtins/buffer.ts`）

1. `Buffer.poolSize` 从 `8192` 改为 **`64 * 1024`**（注意：真 Node v26.9.0 实测 `poolSize = 65536`，不是老版本文档里的 8192）。
2. 新增池状态与三个 helper，逐行镜像真 `lib/buffer.js` 的 `createPool`/`alignPool`/`allocate`/`createUnsafeBuffer`：
   - `createPool()`：`allocPool = new ArrayBuffer(poolSize + 64)`，`poolBase = 0`，`poolOffset = 0`。多出的 64 字节对应 Node `createUnsafeAlignedBuffer` 的 cache-line 对齐余量；**浏览器的 ArrayBuffer 真实地址不可观测**，所以取 `poolBase = 0`（即“slab 恰好对齐”），这样 `.buffer.byteLength` 保真而 `.byteOffset` 仍然确定。
   - `alignPool()`：把 `poolOffset` 向上取到 8 的倍数（`8-byte aligned`）。
   - `allocate(size)`：`<= 0` → 空 Buffer；`< poolSize>>>1` → 从 slab 切一块视图（不够就 `createPool()`），`poolOffset += size` 后 `alignPool()`；否则 `new Buffer(size)`（自有精确底层）。
3. 分配路径接入：`allocUnsafe` → `allocate`；`from(string)` → `bufferFromString`（镜像 `fromStringFast`，**池决策先用字符数**：`str.length >= maxLength` 或 `str.length*4 >= maxLength && bytes.length >= maxLength` 则绕过池——所以一条超长 base64 串即使解得字节很少，也**不**入池）；`from(Buffer/TypedArray/ArrayLike)` → `bufferFromArrayLike`；`concat` → `allocate(total)` 并对剩余尾巴 `fill(0)`（真 Node 同行为）。`allocUnsafeSlow` / `alloc` 保持**不入池**（自有精确底层）。
4. 删掉旧的 `#copyFrom`（它固定 `new Buffer(len)` + `set`，不池化）。

**改完顺手排查了所有 `.buffer` 消费点**：`fs`/`http`/`net`/`crypto`/`blob`/`string_decoder`/`npm` 等处的 `new Uint8Array(x.buffer, x.byteOffset, x.byteLength)` 都已经是 offset-aware 的，池化后继续正确；`crypto/hash.ts` 里 `new DataView(buf.buffer)` 的 `buf` 是**本地新建**的 `Uint8Array`（非池化），安全；`bindings/blob.ts` 的 `part.slice()` 中 `part` 是 `internal/blob.js` 里 `new Uint8Array(...)` 造的精确视图，安全。结论：**无需改动任何消费方**。

**验证**：`tsc --noEmit` 干净 · `vitest run` **447/447（44 files，+8）** · `vite build` 绿（worker 1607 → **1608.21KB**，池化只加了约 0.8KB）。`test/buffer.test.ts` 新增 8 条池化用例（slab 共享 + `byteLength = poolSize+64` + 8 字节对齐/不重叠；`alloc`/`allocUnsafeSlow` 自有精确底层且 `alloc` 零填充；`from(string)`/`from(Buffer)`/`from(TypedArray)` 入池且仍是内容拷贝；`concat` 入池 + 超额 `totalLength` 补零；半池大小请求绕池；零长不分配底层；池化 buffer 的 `subarray` 仍共享池）。**先跑真 Node v26.9.0 量定基准**（oracle `/tmp/pool-oracle.mjs`，另写一个运行时探针逐条对照）：除了不可观测的 slab 基址（Node 2496 vs 我们 0），**相对偏移逐步完全一致**（0→16→32→48→56→4152 对 2496→2512→2528→2544→2552→6648），`alloc(10)`/`allocUnsafeSlow(10)`/零长/半池阈值全部对齐。

**涉及文件**：`src/node-runtime/builtins/buffer.ts`、`test/buffer.test.ts`、`src/demo-project.ts`（buffer 段加一行池可观测性 + 从 Not-yet 删掉 pooling）、`docs/DEVLOG.md`、`docs/superpowers/specs/2026-09-17-web-node-design.md`、`README.md`、`README_zh.md`。

### 2026-09-21 · M40 `fork()` 的 IPC 通道

**目标**：`child_process.fork()` 之前只把子模块当普通子程序跑，`child.send`/`child.on('message')`/`process.send` 全部显式抛 `notImplemented`——因为「假装有通道」比没有更危险（调用方会永远等回复）。这一轮把通道真正做出来。真 Node 里 fork 的 IPC 是一条 `Pipe`（不是 MessagePort），默认 `serialization` 是 **JSON**，还有一条容易被忽略的规则：**开着的 IPC 通道会把子进程留在事件循环里**（模块返回不等于进程退出）。

**改了什么**

1. **通道本体**（新增 `src/node-runtime/proc/ipc.ts`）：`createIpcChannelPair()` 返回两端 `IpcEndpoint`（`send`/`disconnect`/`onMessage`/`onDisconnect`/`onError`/`ref`/`unref`/`connected`）。两端在同一个 realm，所以「序列化」就体现在过桥时的变换上——而这恰好足够忠实，因为真 Node 的 fork 只有两种模式：`'json'`（默认，`JSON.parse(JSON.stringify(v))`，Buffer 拍平成 `{type:'Buffer',data:[…]}`、`Date` → ISO 串、`undefined` 属性丢弃、循环结构**从 `send()` 同步抛**）与 `'advanced'`（`structuredClone`）。投递走**宿主 macrotask**：消息绝不会在发送方 `send()` 返回前到达，所以「先 send 再挂 `on('message')`」不会输掉竞态。未挂监听时的消息会像 Node 一样缓冲。
2. **子进程侧**（`proc/host.ts`）：`SpawnRequest.ipc` 一给，`#childProcess` 构造的 `process` 就多出 `send`/`disconnect`/`channel`（`ref`/`unref`）与活的 `connected`（getter）；`'message'`/`'disconnect'`/`'error'` 从通道桥到 `process.emit`。没给 `ipc` 的普通 spawn 一律不得到这四个东西（真 Node 那里 `process.send` 就是 `undefined`）。**关键规则**：`#checkSettle` 里加了一条——通道开着且处于 ref 态就是「活的工作」，子进程停在那里等消息，而不是一轮计时器清空就退出；`process.channel.unref()` 或 disconnect 解除。活动由 IPC 事件重新触发一轮 settle 检查，不做忙轮询。
3. **父进程侧**（`builtins/child_process.ts`）：`ChildProcess` 新增 `connected`（getter，仅 fork 为 true）、`channel`（无通道 `undefined`、开着是 `{ref,unref}`、断开后 `null`——三者都与真 Node 一致）、`send(message[, sendHandle][, callback])`、`disconnect()`。**事件序**：`#finish` 先发 `disconnect` 再发 `exit`/`close`（子进程带着开着的通道死掉时，真 Node 就是这个顺序）。`fork()` 自己重建：`spawnfile`/`spawnargs` = `process.execPath` + 模块路径（不再字面的 `"node"`）；默认 **继承**子进程 stdout/stderr（对应真 Node 的 `silent:false`，会写进运行时的 stdout），`silent:true` 时只在管道上。
4. **`resolveNodeArgs` 修正**（`proc/command.ts`）：脚本不存在时不再返回 `{kind:'missing'}`（那会被当成 spawn 失败、发 `'error'` 事件），而是返回 `{kind:'node', script, args}`——于是 `node nope.js` 像真 Node 一样**先启动、再加载失败、然后 exit 1**，`fork()` 才能拿到退出码。

**有意保留的差异**：
- `'advanced'` 用 `structuredClone`：`Map`/`Set`/`Date`/类型化数组保留，但 **Buffer 子类不保留**（真 Node 走 V8 serializer，会保留 Buffer）。
- **send handle**（socket/server）显式拒绝：这里没有 OS fd 可传（真 Node 能传）。
- 无监听者的 `'error'`（如对已断开的通道 `send`）不抛不崩——真 Node 会因未处理 `error` 事件而崩；在标签页里那会连整个 worker 一起带走，所以只通过 send 回调报错。
- `cwd` 不隔离：子进程与父进程共享同一个 VFS（`process.chdir()` 会互相看得见）。

**验证**：`tsc --noEmit` 干净 · `vitest run` **439/439（44 files，+10）** · `vite build` 绿。`test/child-process.test.ts` 把旧的「抛 IPC 未实现」换成 1 条「普通 spawn 无通道」+ 9 条 fork 用例：双向传消息 + 退出码/事件序（`disconnect` < `exit` < `close`）、默认继承 vs `silent` 管道、JSON 序列化（Buffer 拍平、`undefined` 消失、`null`/`Date` 保真）、`advanced`（Map/Date/类型化数组保真、Buffer 变 Uint8Array）、**开着通道不退出**、双向 `disconnect` + 子侧 re-send 返回 `false`、已关闭通道 `send` 返回 `false` 并发 `ERR_IPC_CHANNEL_CLOSED`、循环结构/`undefined` 同步抛、argv/execArgv/send 回调、缺失模块→exit 1 且无 `'error'`。所有断言的预期值都先跑真 Node v26.9.0 量过（`/tmp/fork-oracle{,2,3}.mjs`）。

**涉及文件**：`src/node-runtime/proc/ipc.ts`（新）、`src/node-runtime/proc/host.ts`、`src/node-runtime/proc/command.ts`、`src/node-runtime/builtins/child_process.ts`、`test/child-process.test.ts`、`src/demo-project.ts`（新增 `-- fork IPC (milestone 40) --` 段 + `lib/ipc-child.js`）、`docs/DEVLOG.md`、`docs/superpowers/specs/2026-09-17-web-node-design.md`、`README.md`、`README_zh.md`。

### 2026-09-21 · M39 npm 深化：`overrides`/`resolutions` + `file:`/`link:` + 有界并发下载

**目标**：把 npm 安装器从「只会跟注册表打交道」推到「能像真项目那样管依赖树」。真实项目几乎都会用到根级的 `overrides`（或 yarn 的 `resolutions`）来钉住一个传递依赖的版本；monorepo 则大量用 `file:`/`link:` 引用本地包。之前的安装器把这两类说明符直接当「不支持」跳过（`skipped ... unsupported specifier`），并且 tarball 是**串行**下载的。

**改了什么**

1. **`overrides` / `resolutions`**（新增 `src/node-runtime/npm/overrides.ts`）：把根 package.json 的 `overrides`（无则 Yarn 的 `resolutions`）编译成一组「包名路径 → 范围」的规则，支持扁平（`"foo": "1.2.3"`）、嵌套（`"bar": { "foo": "1.2.3" }`）、`"."`（管包自己）、`$ref`（`"foo": "$foo"` 引用根依赖）四种形态；匹配时**最长路径优先**、等长后定义者胜（与 npm 一致）。解析每个依赖时按当前包在树中的祖先链（`ancestors`）求出生效的 override，命中时打一条 `override ...` 日志。带版本范围的键（如 `"foo@^1.0.0"`）不支持，**写入 `warnings`（`override ignored: ...`）而不静默误钉**。
2. **`file:` / `link:` 说明符**：`resolve()` 先识别 `file:`/`link:`，把目标按「依赖包所在目录」解析（绝对路径直用），支持**目录**（读其 `package.json` 当清单，写盘时递归拷贝，跳过 `node_modules`/`.git`）与**本地 `.tgz`**（读字节→`extractTarball`→取清单）。`link:` 因 VFS 无符号链接而**物化为拷贝**（已在文件头与 DEVLOG 标注这一有意偏离）；锁文件里记为 `resolved: "file:..."/"link:..."` + `link: true`。锁定条目**只有 `http(s)` 的 `resolved` 才会被复用**（本地依赖每次重新从磁盘解析）。
3. **有界并发下载**：解析阶段仍然串行（便宜且对顺序敏感），下载阶段改为最多 `concurrency`（默认 8，可 `--` 选项传入）个 tarball 同时进行；**先全部下载/校验/解包，再写树**，所以任何下载失败或完整性不匹配都会让 `node_modules` **保持原样**（旧实现会边下边写、留下半成品）。去重按 `name@version`。
4. `runtime.installDependencies()` 透传 `concurrency`；demo 项目新增一个 `file:` 依赖（`@demo/greeting` ← `file:lib/greeting`）与一个安全的 `overrides`（`nanoid`），index.js 新增 `-- npm resolution (milestone 39) --` 段。

**验证**：`tsc --noEmit` 干净 · `vitest run` **429/429（44 files，+12）** · `vite build` 绿（worker 1595 → 1601KB）。`test/npm.test.ts` 新增 12 条：扁平 override、嵌套 override（带根级同包对照，证明作用域）、`$ref`、`resolutions`、版本范围键被拒并告警；`file:` 目录（含跳过 `node_modules`）、`file:` tarball、`link:` 目录 + 锁文件 `link:true`、缺失目标告警、本地说明符**不发注册表请求**；并发上限实测 `peak <= concurrency && peak > 1`，以及同一版本只下唯一一次。

**涉及文件**：`src/node-runtime/npm/overrides.ts`（新）、`src/node-runtime/npm/install.ts`、`src/node-runtime/npm/lockfile.ts`、`src/node-runtime/npm/index.ts`、`src/node-runtime/runtime.ts`、`test/npm.test.ts`、`src/demo-project.ts`、`docs/DEVLOG.md`、`docs/superpowers/specs/2026-09-17-web-node-design.md`、`README.md`、`README_zh.md`。

### 2026-09-21 · M38 真 `stream/iter` + `stream/consumers`（`internal/streams/iter/*`）

**目标**：Node v26 给流加了一套新的 **iterable-streams API**（`stream/iter`）以及一个 `stream/consumers` 子模块。前者以前完全不存在（`require('stream/iter')` 直接找不到模块），而 `stream/consumers`（`text`/`json`/`buffer`/`bytes`/`arrayBuffer`/`blob`）在 M37 之前做不了——它需要一个真的 `Blob`。真实工具链（vite-node、vitest、rollup、typescript 的 bundle 等）在若干路径上 `require('stream/consumers')`，缺了就会在那些路径上直接报错。

**为什么能搬**：`internal/streams/iter/*` 是纯 JS，依赖只剩 `internal/errors`/`internal/validators`/`internal/util`/`internal/util/types`/`internal/encoding`/`internal/abort_controller`/`internal/webidl`/`buffer` 以及已入货的 `internal/streams/{readable,writable,destroy,end-of-stream,add-abort-signal}`/`internal/process/task_queues`——全部就绪。组内自身无环（`webidl` → `types`/`ringbuffer` → `utils`/`from` → `pull`/`consumers`/`push`/`duplex`/`broadcast`/`share`/`classic`）。`stream/consumers.js` 只依赖 `internal/encoding` + `internal/blob` + `buffer`。

**改了什么**

1. **vendor 14 个文件（MANIFEST 105 → 119）**：`stream/iter.js`、`stream/consumers.js` + `internal/streams/iter/{types,utils,webidl,ringbuffer,from,consumers,pull,push,duplex,broadcast,share,classic}.js`。**故意排除** `internal/streams/iter/transform.js`：它是新的 zlib 流变换面（`lib/zlib/iter.js` 专用），顶层就 `internalBinding('zlib')`，本运行时没有 native zlib。`stream/iter` 本身不依赖它。
2. **`vendored-builtins.ts` 注册两张表并按 eager require 图排序**：iter 组 12 个模块 + `stream/iter`（别名 `node:stream/iter`）+ `stream/consumers`（别名 `node:stream/consumers`）。
3. **`internal/options` 把 `--experimental-stream-iter` 默认置 on**：上游把整个 `stream/iter` API 锁在 `--experimental-stream-iter` 后面（`lib/internal/streams/readable.js` 在安装 `toAsyncStreamable` 前会查这个 flag，经典流↔iter 互操作靠它）。标签页没有 flag 面，所以运行时常开——并在 DEVLOG 标注这处有意偏离。

**验证**：`tsc --noEmit` 干净 · `vitest run` **417/417（44 files，+13）** · `vite build` 绿（worker 1436 → **1595KB**）。`test/stream-iter.test.ts` 对着 Node v26.9.0 校验（探针 `/tmp/iter-oracle.mjs`、`/tmp/iter-oracle2.mjs`、`/tmp/iter-oracle3.mjs`）：38 个导出、两个模块 id 与 `node:` 别名同身份、`Stream` 命名空间冻结、全局协议 symbol；`push()`+`text`/`bytes`；`from`/`fromSync`+`text`/`textSync`/`bytesSync`；`pull` 无状态变换；`merge`；经典流双向互操作（`fromReadable`/`toReadable`/`fromWritable`/`pipeTo`）；`stream/consumers` 的 `text`/`json`/`buffer`/`bytes`/`arrayBuffer`/`blob` + 非法 JSON 报 `SyntaxError`；`from(42)` 报 `ERR_INVALID_ARG_TYPE`。demo 新增 `-- stream/iter (milestone 38) --` 段。

**涉及文件**：`tools/vendor.mjs`、`vendor/node-lib/MANIFEST.json`、`vendor/node-lib/stream/{iter,consumers}.js`、`vendor/node-lib/internal/streams/iter/*.js`、`src/node-runtime/builtins/vendored-builtins.ts`、`src/node-runtime/builtins/internal-shims.ts`、`src/demo-project.ts`、`test/stream-iter.test.ts`（新）、`test/vendored-strip.test.ts`、`docs/DEVLOG.md`、`docs/superpowers/specs/2026-09-17-web-node-design.md`、`README.md`、`README_zh.md`。

### 2026-09-21 · M37 真 `Blob`/`File`（`lib/internal/blob.js` + `lib/internal/file.js`）

**目标**：`Blob` 之前不是 Node 的——`internal/blob` 只有一个 `isBlob` 桩（认的是**宿主 realm** 的 `Blob`），`Blob` binding 在 `UNSUPPORTED_BINDINGS` 里没随运行时发布，`buffer.Blob` 直接把宿主 `Blob` 转出去。于是 `blob.stream()` 拿不到 Node 的分块语义、`internal/streams/duplexify` 的 Blob 分支也跟真实建出的 Blob 对不上。改成真源码后，用户拿到的是 Node 自己的 `Blob`/`File`。

**为什么能搬**：`internal/blob.js`/`internal/file.js` 是纯 JS，只坐在一个 `internalBinding('blob')` + `internalBinding('buffer').kMaxLength` 上，其余依赖（`internal/encoding`/`internal/url`/`internal/util`/`internal/util/inspect`/`internal/util/types`/`internal/validators`/`internal/webidl`/`internal/worker/js_transferable`/`internal/process/task_queues`）都已就绪。C++ 那侧（`src/node_blob.cc`）的全部重量都在 `DataQueue`（`src/dataqueue/queue.cc`）——因为一个 blob 可以是 **fd-backed**、按需增量读、不必把字节全读进内存。本运行时的每个 byte source 都在内存里，所以这个队列塌缩成一个扁平分片列表即可。

**改了什么**

1. **vendor 2 个文件（MANIFEST 103 → 105）**：`lib/internal/blob.js` + `lib/internal/file.js`。
2. **新增 `src/node-runtime/bindings/blob.ts`（JS `blob` binding）**：把 `DataQueue` 的可见契约用扁平 `Uint8Array` 分片重实现——`createBlob`（接受 ArrayBuffer / view / 其它 blob 的 handle，后者由 JS 侧 `getSource` 传进来）、`concat`、`createBlobFromFilePath`（走 VFS，缺失时抛同步 `ENOENT`，与真 Node 一致）、`storeDataObject`/`getDataObject`/`revokeObjectURL`（`URL.createObjectURL` 的 `blob:nodedata:` 存储）。关键保真点：**reader 每次 `pull` 只交出一片、然后 EOS**（对应 C++ `InMemoryReader` 的 `STATUS_CONTINUE` + 单片、再 `STATUS_EOS`），这正是 `blob.stream()` 按**原始 source 边界**切块的原因（`new Blob(['abc','def']).stream()` → 两块，而不是一块）。传给回调的是**拷贝**（对齐 C++ 重新拼一个 ArrayBuffer 的行为，调用方观察不到 blob 存储的后续变化）。
3. **`internal/blob` 从桩升级为 vendored**：删掉 `internal-shims.ts` 里的 `internalBlobSpec`，改在 `vendored-builtins.ts` 注册 `internal/blob` + `internal/file` 的 BuiltinSpec（带 `deps`）；`builtins/index.ts` 的 shim 列表移除 `internalBlobSpec`。
4. **Blob/File 成为全局，且与 `buffer` 同身份**：真 `internal/streams/duplexify` 的 Blob 分支以**真 `isBlob`** 为门，若用户建的是宿主 `Blob` 就会漏判——所以 `runtime.ts` 在构建 sandbox global 时用 `internal/blob` 的 `Blob` + `internal/file` 的 `File` **覆盖**宿主全局；`buffer.ts` 的 `Blob`/`File`/`resolveObjectURL` 改为**惰性 getter**（`internal/blob` 会拉进 `internal/util/inspect`，而后者又要 `buffer`——惰性化才不会拿到半成品 exports）。
5. **`buffer` binding 补 `kMaxLength`**（真 Node 64 位是 `Number.MAX_SAFE_INTEGER`，`internal/blob.js` 用它卡 Blob 总长）；**`internal/encoding` shim 补 `getUtf8Decoder`/`getEncodingFromLabel`**（blob 用它做共享解码器）。
6. **新增 `fs.openAsBlob`**（我们的 `fs`）：`Promise.resolve(createBlobFromFilePath(vfs.resolve(p), { type }))`，缺失文件同步抛 `ENOENT`（与真 Node 一致）。
7. **新增最小 `vm` shim（只实现 `runInNewContext`）**：真 `internal/util.js` 的 `getInternalGlobal()` 会 `require('vm').runInNewContext('this', ...)` 取一个**跨 realm** 的 `RegExp`（`SideEffectFreeRegExpPrototypeSymbolReplace`）。M36 引入的 WHATWG streams 在 finalizer 里会走到这条路，一旦 `require('vm')` 抛 `NotImplementedError` 就成**未捕获 rejection**（GC 时炸）。`runInNewContext` 用 `new Function` + `with` + 直接 `eval` 实现（`runInNewContext('this')` 默认返回 `Object.create(globalThis)`，保证标准 intrinsics 可取），`vm` 其余全部照旧抛错。

**验证**：`tsc --noEmit` 干净 · `vitest run` **404/404（43 files，+14）** · `vite build` 绿（worker 1415 → **1436KB**）。`test/blob.test.ts` 对着 Node v26.9.0 校验（探针 `/tmp/blob-oracle.mjs`、`/tmp/blob-fs.mjs`）：`Blob`/`File` 从 `buffer` 导出且是全局（身份一致、且**不是**宿主 `Blob`）、`size`/`type`（非法 type 字符整串归零、显式 type 小写化）、`endings` 非法报 `ERR_INVALID_ARG_VALUE`、嵌套 blob 展平、`arrayBuffer`/`text`/`bytes`、`stream()` 按 source 边界分块（`['abc','def']` → 两块）、大 blob 单块、`textStream`、`slice` 的 clamp 与负索引、`fs.openAsBlob` 读文件与缺失抛 `ENOENT`。demo 新增 `-- Blob (milestone 37) --` 段。

**涉及文件**：`tools/vendor.mjs`、`vendor/node-lib/MANIFEST.json`、`vendor/node-lib/internal/blob.js`、`vendor/node-lib/internal/file.js`、`src/node-runtime/bindings/blob.ts`（新）、`src/node-runtime/bindings/index.ts`、`src/node-runtime/bindings/buffer.ts`、`src/node-runtime/builtins/vendored-builtins.ts`、`src/node-runtime/builtins/internal-shims.ts`、`src/node-runtime/builtins/index.ts`、`src/node-runtime/builtins/buffer.ts`、`src/node-runtime/builtins/fs.ts`、`src/node-runtime/builtins/unsupported.ts`、`src/node-runtime/runtime.ts`、`src/demo-project.ts`、`test/blob.test.ts`（新）、`test/vendored-strip.test.ts`、`docs/DEVLOG.md`、`docs/superpowers/specs/2026-09-17-web-node-design.md`、`README.md`、`README_zh.md`。

### 2026-09-21 · M36 真 WHATWG streams（`lib/stream/web.js` + 整个 `internal/webstreams/*` 组）

**目标**：`stream/web` 之前**完全不存在**（`require('stream/web')` 直接抛），`internal/webstreams/adapters` 是一个“一访问就抛”的 Proxy——于是 `Readable.toWeb` / `Writable.toWeb` / `Duplex.toWeb` 都无法使用，WHATWG `ReadableStream`/`WritableStream`/`TransformStream` 也拿不到。改成真源码后，用户拿到的是 Node 自己的整套 WHATWG streams 语义。

**为什么能搬**：`internal/webstreams/*` 是纯 JS，只坐在 `messaging`（取 `DOMException`）、`buffer`、`util`、`stream_wrap`（仅形状）四个 binding 上，其余依赖（`buffer`/`stream`/`internal/encoding`/`internal/worker/io`/`internal/abort_controller`/`internal/webidl`/`internal/streams/*`）都已就绪。

**改了什么**

1. **vendor 10 个文件（MANIFEST 93 → 103）**：`lib/stream/web.js` + `internal/webstreams/{util,transfer,readablestream,writablestream,transformstream,queuingstrategies,encoding,adapters,compression}.js`。`util.js` 对 `transfer` 是**惰性** require，所以 `util` 在组内没有 eager 依赖，不会成环（`stream/web` → transformstream/readablestream → util）。
2. **删掉 `internal/webstreams/adapters` 的抛错 Proxy**，`adapters.js` 改注册为 vendored；`Readable.toWeb`/`Writable.toWeb`/`Duplex.toWeb`（及 `fromWeb` 反向）从 M16 起就一直挂在 `internal/streams/{readable,writable,duplex}` 里的惰性 require 上，现在终于接通。
3. **新增 `internal/process/task_queues` shim**：真模块掌握 tick 队列并从 C++ 跑 V8 microtask；本运行时已自己调度 tick，而 vendored webstreams 只用到 `queueMicrotask`（把按规范排序的后续推离 tick 队列），所以 shim 只暴露这一个函数。
4. **新增 `stream_wrap` binding（形状）**：`adapters.js` 在 load 时要 `WriteWrap`/`ShutdownWrap`/`kReadBytesOrError`/`kLastWriteWasAsync`/`streamBaseState`，但它们只在 `newWritableStreamFromStreamBase`/`newReadableStreamFromStreamBase`（把一个 libuv `stream_base` 套接字变成 web 流）里被用到；本运行时网络是自研的、从不产生 `stream_base`，所以这里是拓扑对齐 `src/stream_base.h` 的最小形状（`streamBaseState` 为 `Int32Array(4)`，字段序 `kReadBytesOrError=0`/`kArrayBufferOffset=1`/`kBytesWritten=2`/`kLastWriteWasAsync=3`）。
5. **`buffer` binding 补 `copyArrayBuffer`**（`src/node_buffer.cc`）：byte-stream controller 从队列填充 pull-into 描述符时用它按 offset 拷贝整块 ArrayBuffer。**`uv` binding 补 `UV_EOF=-4095`**（`uv.h`）。
6. **`internal/errors` 支持多基类**：Node 的 `E('ERR_INVALID_STATE', ..., Error, TypeError, RangeError)` 会把额外基类挂成 `ERR_INVALID_STATE.TypeError`/`.RangeError`；readablestream 在“reader 已激活”时用的正是 `new ERR_INVALID_STATE.TypeError(...)`。新增 `ERROR_EXTRA_BASES` 并让 `makeErrorClass` 递归挂载变体（带 `attachExtraBases=false` 防自递归）；顺手补上 `ERR_OPERATION_FAILED` 模板。

**验证**：`tsc --noEmit` 干净 · `vitest run` **390/390（42 files，+16）** · `vite build` 绿（worker 1201 → **1415KB**）。`test/webstreams.test.ts` 对着 Node v26.9.0 校验（探针 `/tmp/ws-oracle.mjs`、`/tmp/ws-byob2.mjs`）：17 个导出构造器、`node:stream/web` 别名、读 default source 到完成 + `locked` 语义 + reader 类名、`new ReadableStream(null)` 的 `ERR_INVALID_ARG_TYPE` 文案、source error 传播、`tee()` 双分支、`TransformStream` 转换、`WritableStream` 写入顺序、`CountQueuingStrategy`/`ByteLengthQueuingStrategy` 的 `highWaterMark`/`size`、`TextEncoderStream` UTF-8 编码（`hé` → `68c3a9`）、`TextDecoderStream` 解码、BYOB 字节流从队列填充、字节流 default 读回 `Uint8Array`、`Readable.toWeb`/`Writable.toWeb` 桥接、`CompressionStream`/`DecompressionStream` 抛 `NotImplementedError`。demo 新增 `-- stream/web (milestone 36) --` 段。

**涉及文件**：`tools/vendor.mjs`、`vendor/node-lib/MANIFEST.json`、`vendor/node-lib/stream/web.js`、`vendor/node-lib/internal/webstreams/*.js`、`src/node-runtime/builtins/vendored-builtins.ts`、`src/node-runtime/builtins/internal-shims.ts`、`src/node-runtime/builtins/index.ts`、`src/node-runtime/bindings/buffer.ts`、`src/node-runtime/bindings/index.ts`、`src/node-runtime/bindings/misc.ts`、`src/demo-project.ts`、`test/webstreams.test.ts`（新）、`test/vendored-strip.test.ts`、`docs/DEVLOG.md`、`docs/superpowers/specs/2026-09-17-web-node-design.md`、`README.md`、`README_zh.md`。

### 2026-09-21 · M35 真 `perf_hooks`（`lib/perf_hooks.js` + 整个 `internal/perf/*` 组）

**目标**：`perf_hooks` 之前是手写桩——它把**宿主**的 `performance` 全局原样转出去，`PerformanceMark`/`PerformanceMeasure`/`PerformanceEntry` 全是 `undefined`，所以 `new PerformanceMark(...)` 会抛 `TypeError`，`PerformanceObserver` 也是浏览器那个而不是 Node 的。改成真源码后，用户拿到的是 Node 自己的整套 user-timing / observer / node-timing 语义。

**为什么能搬**：`internal/perf/*` 是纯 JS，只坐在一个 `internalBinding('performance')` 上（里程碑、时钟、观察者计数、GC 跟踪、直方图句柄）。这个 binding 我们在 M25 已经开了一个头（`now`/`timeOrigin`/`milestones`/`constants`），本轮把它补全成一个完整的 JS 实现——**时钟用浏览器的 `performance.now()`**（对应 Node 的 `uv_hrtime`），**没有 V8 GC 钩子可挂**，所以 `installGarbageCollectionTracking` 之类是 inert。

**改了什么**

1. **vendor 10 个文件（MANIFEST 83 → 93）**：`lib/perf_hooks.js` + `internal/perf/{performance_entry,observe,usertiming,nodetiming,resource_timing,timerify,event_loop_delay,event_loop_utilization}.js`（`internal/perf/utils.js` M25 已在）。它们彼此无环（`performance.js` 是唯一的汇聚点，没人反 require 它），所以 `deps` 按顶层 require 列出即可。
2. **`performance` binding 补全**：新增 `observerCounts` 向量、`setupObservers(cb)`（`observe.js` 在加载时调用它注册回调度）、`installGarbageCollectionTracking`/`removeGarbageCollectionTracking`（inert）、`loopIdleTime()`（0）、`uvMetricsInfo()`（`[0,0,0]`）、`createELDHistogram()`（抛）；`constants` 补齐 entry-type 枚举（GC/HTTP/HTTP2/NET/DNS/QUIC）与 GC kind/flags（值取自 `src/node_perf.h`，并用真 Node 校验：`GC_MAJOR=4`、`GC_MINOR=1`、`GC_MINOR_MARK_SWEEP=2`、`GC_INCREMENTAL=8`、`GC_WEAKCB=16`）；milestones 把 `ENVIRONMENT`/`NODE_START`/`V8_START`/`BOOTSTRAP_COMPLETE` 都落在 origin（→ 相对 0），`LOOP_START`/`LOOP_EXIT` 保持 -1 —— **和真 Node 顶层一致**（真 Node 那时 `loopStart` 也是 -1，`eventLoopUtilization()` 全 0）。
3. **新增 `internal/histogram` shim**：真 `internal/histogram.js` 背后是 native `Histogram`（一个可 CBOR 导出的 hdr_histogram，外加一堆统计检验），浏览器里没有对应物。所以这个模块**能加载**（`perf_hooks.js` 与 `internal/perf/timerify.js` 在顶层会 destructure 它），但 `Histogram` 构造即抛 `NotImplementedError`。
4. **删掉手写 `builtins/perf-hooks.ts`**，`perf_hooks` 改注册为 vendored 模块（`vendorPath: 'perf_hooks.js'`）。

**验证**：`tsc --noEmit` 干净 · `vitest run` **374/374（41 files，+11）** · `vite build` 绿（worker 1145 → **1201KB**）。`test/perf-hooks.test.ts` 对着 Node v26.9.0 校验（探针 `/tmp/perf-oracle.mjs`）：11 个常量值、mark/measure 的 entry 形状与 `instanceof PerformanceMark/PerformanceEntry`、直接 `new PerformanceMark` 可用而 `new PerformanceMeasure` 报 `Illegal constructor`（与 Node 一致）、`PerformanceObserver`（`entryTypes:['mark']`）能收到 entry、`nodeTiming` 各字段（`nodeStart=0`/`loopStart=-1`/`uvMetricsInfo`）、`eventLoopUtilization()` 全 0、`createHistogram`/`importHistogram`/`monitorEventLoopDelay` 抛 `NotImplementedError`、`timerify` 不带直方图可用且会校验直方图参数。demo 新增 `-- perf_hooks (milestone 35) --` 段。

**涉及文件**：`tools/vendor.mjs`、`vendor/node-lib/MANIFEST.json`、`vendor/node-lib/perf_hooks.js`、`vendor/node-lib/internal/perf/*.js`、`src/node-runtime/bindings/misc.ts`、`src/node-runtime/builtins/internal-shims.ts`、`src/node-runtime/builtins/vendored-builtins.ts`、`src/node-runtime/builtins/index.ts`（删除 `perf-hooks.ts`）、`src/demo-project.ts`、`test/perf-hooks.test.ts`（新）、`test/vendored-strip.test.ts`、`docs/DEVLOG.md`、`docs/superpowers/specs/2026-09-17-web-node-design.md`、`README.md`、`README_zh.md`。

### 2026-09-21 · M34 crypto 的同步面（JS 实现，对齐 OpenSSL 输出）

**目标**：`crypto` 之前只有 MD5/SHA-1/SHA-256 三种 `createHash` + WebCrypto 随机数；`createHmac`、`pbkdf2Sync`、`scryptSync`、`timingSafeEqual` 都没有，`createHash('sha512')` 直接抛。而这些正是真实工具链（`ssri`/`cacache` 的 sha512、`jsonwebtoken`/`cookie-signature` 的 HMAC、密码散列的 pbkdf2/scrypt）会调的。

**为什么不能靠 WebCrypto**：`crypto.subtle.digest`/`deriveBits` 是 **promise-only**，而 Node 的这套 API 绝大多数是**同步**调用（`createHash().digest()`、`pbkdf2Sync`…），在同步代码路径里用一个 promise 垫不了。所以算法直接在 JS 里实现（与 M20 把 `src/string_decoder.cc` 的状态机用 JS 重写同一思路），只有**随机数**继续用平台 WebCrypto（Node 底层也是 OpenSSL 的 RAND）。

**改了什么**

1. **新增 `src/node-runtime/crypto/hash.ts`**（纯 TS，无依赖）：
   - MD5、SHA-1、SHA-224/256（32 位核，共用一份 `sha2_32`，仅 IV/输出长度不同）、SHA-384/512（64 位核，用 BigInt 实现——比双 32 位 limb 短得多且更易对照规范，性能对标签页的负载无所谓）；
   - HMAC（RFC 2104）、PBKDF2（RFC 8018）、HKDF（RFC 5869）、scrypt（RFC 7914，含 Salsa20/8 核与 BlockMix/ROMix）；
   - `resolveHash()`：把 OpenSSL 的各种拼法归一（`sha256` / `sha-256` / `RSA-SHA256` / `sha256WithRSAEncryption`），`listHashes()` 返回我们真能算的清单。
2. **`src/node-runtime/builtins/crypto.ts` 扩面**：`createHash`（6 种摘要 + `.copy()` + 重复 `digest()` 报 `ERR_CRYPTO_HASH_FINALIZED`）、`createHmac`、`hash()`、`getHashes()`、`pbkdf2`/`pbkdf2Sync`、`hkdf`/`hkdfSync`（按 Node 返回 `ArrayBuffer`）、`scrypt`/`scryptSync`、`timingSafeEqual`、`randomInt`/`randomFill`/`randomFillSync`。`digest()`/`randomBytes()` 现在返回真 **Buffer**（惰性 `require('buffer')`，不引起 init 循环）。
   - 密文/签名/非对称密钥/Diffie-Hellman/素数等（需要 OpenSSL 或原生 keystore）保留为**显式抛 `NotImplementedError`**，不返回 `undefined`。
3. **错误码对齐 Node**：`ERR_CRYPTO_INVALID_DIGEST`（`createHmac`/`pbkdf2` 的非法 digest）、`ERR_CRYPTO_HASH_FINALIZED`、`ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH`、`ERR_CRYPTO_INVALID_SCRYPT_PARAMS`、`ERR_OUT_OF_RANGE`（`iterations`/`randomInt` 越界）、`ERR_INVALID_ARG_TYPE`；`createHash('nope')` 与 Node 一样是**无 code 的** `Error: Digest method not supported`。

**验证**：`tsc --noEmit` 干净 · `vitest run` **363/363（40 files，+22）** · `vite build` 绿（worker 1130 → **1144.78KB**，多出 6 种摘要 + MAC/KDF）。`test/crypto.test.ts` 全部期望值先由 Node v26.9.0（OpenSSL）跑出（探针 `/tmp/crypto-oracle.mjs`、`/tmp/crypto-oracle2.mjs`、`/tmp/crypto-oracle3.mjs`）：6 种摘要 × 4 输入、6 种 HMAC、PBKDF2（sha1/sha256/sha512）、HKDF（sha1/sha256/sha512）、scrypt（默认参数 + `N=1024,r=8,p=1` + `N=16,r=1,p=1`），以及错误路径与 `copy()`/重复 finalize 语义。demo 新增 `-- crypto (milestone 34) --` 段。

**涉及文件**：`src/node-runtime/crypto/hash.ts`（新）、`src/node-runtime/builtins/crypto.ts`（重写）、`test/crypto.test.ts`（新）、`src/demo-project.ts`、`docs/DEVLOG.md`、`docs/superpowers/specs/2026-09-17-web-node-design.md`、`README.md`、`README_zh.md`。

### 2026-09-21 · M33 真 glob（`internal/fs/glob.js` + 随包 minimatch）

**目标**：把「glob 未实现」这个已知限制去掉。之前 `path.matchesGlob`、`fs.glob`、`fs.globSync` 都抛 `NotImplementedError`（`internal/fs/glob` 是个 shim）。

**为什么能搬**：`lib/internal/fs/glob.js` 是纯 JS 的**遍历器 + 匹配器**，它要的东西我们已经有了：`fs`/`fs/promises`（lstat/stat/readdir/realpath）、`path`、`internal/util`、`internal/validators`、`internal/errors`、`internal/assert`、`internal/url`。唯一“缺失”的是 `internal/fs/utils` 的 `DirentFromStats`（真 `internal/fs/utils.js` 是 1200 行的 fs 基座，我们的 `fs` 是自研 VFS，用不上它）。

**改了什么**

1. **vendor 两个文件（MANIFEST 81 → 83）**：
   - `lib/internal/fs/glob.js`（真遍历器 + `createMatcher`/`matchGlobPattern`/`Glob`）；
   - `internal/deps/minimatch/index`——注意它在源码树里是 **`deps/minimatch/index.js`**（Node 用 esbuild 从 `deps/minimatch` 打的**自包含单文件 CJS**，`node.gyp` 把它当 `internal/deps/minimatch/index` 内建）。`tools/vendor.mjs` 新增 `SOURCE_OVERRIDES` 把内建 id 映射到真正的磁盘位置。
2. **新增 `internal/fs/utils` shim**：只导出 `DirentFromStats`（`Dirent` 的“类型谓词委托给 stat 结果”变体），这是 glob 从该模块唯一读的导出。我们的 `fs` 自有 Dirent 形状。
3. **`internal/url` shim 补 `toPathIfFileURL`**：`internal/url` 是 re-export 我们的 `url` 内建，glob 要的文件-URL 助手不在里面，于是合并时补上（`isURL(x) ? fileURLToPath(x) : x`）。
4. **`internal/fs/glob` 从 shim 列表移除，改注册到 `vendored-builtins.ts`**（deps 写全）；`path.js` 早就 `getLazy()` 依赖它，所以 `path.matchesGlob` 自动就活了。
5. **`fs` 内建补上 `glob`/`globSync`，`fs.promises` 补上 `glob`**（对齐 `lib/fs.js` / `lib/internal/fs/promises.js`：`globSync` → `new Glob(...).globSync()`；`glob` → 消费 `new Glob(...).glob()` 异步迭代器后回调；`promises.glob` 直接 `yield*`）。懒加载（在函数体里 `ctx.require`）避免与 `fs` 开局时的循环。

**三个关键坑（已记清楚）**

- **`withFileTypes` 的 `parentPath` 取决于 `root` 是不是 `.`**：`Glob` 构造默认 `root = options.cwd ?? '.'`；结果集最后用 `join(root, path)` 取缓存（命中 readdir 存下的 Dirent）还是 `getDirentSync`（新造 `DirentFromStats`，`parentPath = dirname(path)`）。所以**不传 `cwd` 得相对 `parentPath`（`.`），传了绝对 `cwd` 得绝对 `parentPath`**——Node v26.9.0 实测两种都如此（`/tmp/wprobe/g4.js`），我们完全对齐。
- **`deps` 里写了 `internal/fs/glob` 会让 `path` 在半成品状态下拉起 `glob`**：我们原来把 `internal/fs/glob` 列为 `path` 的依赖（当时 glob 还是个抛错的 shim）。加上真 glob 后就出事了：`path` 一被加载 → 先拉 deps → 拉起 `glob` → glob 顶层 `const { ..., isAbsolute, ... } = require('path')` → 此时 path 还是 `loading`，拿到的是**半成品 exports**（没有 `isAbsolute`）→ 这个坏掉的 glob 被缓存。**只在 `path` 先于 `fs` 被加载时暴露**，所以单测（先 `req('fs')`）全绿，而 demo（第 12 行就 `require('path')`）一跑就 `isAbsolute is not a function`。修法：把 `internal/fs/glob` 从 `path` 的 deps 里删掉（`path.js` 只在 `matchesGlob` 里 `getLazy` 地用它，本来就不需要声明），改由 `glob` 声明 `path` 为 dep——这样无论从哪边开始加载，顺序都对。`test/glob.test.ts` 的 globSync 用例里特意先 `req('path')` 再 `req('fs')` 当回归。
- **不要给 glob 注入 sandbox `cwd`**：我曾把 `cwd` 默认为 sandbox `process.cwd()`（想让嵌入场景也正确），但那样 root 从 `.` 变成绝对路径，`withFileTypes` 的 `parentPath` 也跟着变，反而偏离 Node。正确做法是**保持原样**——生产（浏览器）里全局 `process` 就是 sandbox 的，默认 `cwd` 天然正确；测试因为 `installGlobals: false`，显式传 `cwd`（`test/glob.test.ts` 顶部有说明）。

**验证**：`tsc --noEmit` 干净 · `vitest run` **341/341（39 files，+4）** · `vite build` 绿（worker 1028 → **1129.59KB**，glob + minimatch 两份真源码；gzip 257KB）。`test/glob.test.ts` 10 个 `matchesGlob` 用例 + `globSync`（cwd/exclude/withFileTypes）+ `fs.glob` 回调 + `fs.promises.glob` 异步迭代器，期望全部对齐真 Node v26.9.0（探针 `/tmp/wprobe/g1/g2/g4.js`）。demo 新增 `-- glob (milestone 33) --` 段；真浏览器（dev + 线上）实跑 `matchesGlob : true false` / `globSync : ["index.js","src/a.js","src/deep/c.js"]` / `exclude : ["index.js","src/a.js"]` / `async glob : ["src/a.js"]`。

**涉及文件**：`tools/vendor.mjs`（`SOURCE_OVERRIDES` + 2 个文件）、`vendor/node-lib/internal/fs/glob.js`、`vendor/node-lib/internal/deps/minimatch/index.js`、`vendor/node-lib/MANIFEST.json`、`src/node-runtime/builtins/{vendored-builtins.ts,internal-shims.ts,index.ts,fs.ts}`、`src/demo-project.ts`、`test/glob.test.ts`（新）、`test/vendored-strip.test.ts`（81→83）。

### 2026-09-21 · M32 worker 减重：构建期去掉 vendored 注释（行号/列号保真）

**目标**：M31 后 worker 已到 **1259KB**，其中 **98% 是 vendored 真源码的原始文本**（`vendor/node-lib/**` 共 81 文件、~1.02MB）。这些文本经 `?raw` 以字符串形式进 bundle，打包器的 minifier **碰不到它们**——于是真 Node 源里那 ~23% 的注释就白白发给了每个访客，还要被浏览器解析一遍。

**为什么不做 code-split（原待办给的方案）**：`require()` 是同步的，而 vendored 源是运行时用 `new Function` 编译的**字符串**；拆成异步 chunk 就没法同步取到，除非在跑用户代码前把所有 chunk 都预取回来——那等于总量不变、请求数变多。拆成 81 个小 chunk 只是把同一个总量分多次下载。所以这个方向直接否掉，改成减 **payload**。

**改了什么**

1. **抽出共享分词器**：新增 `src/node-runtime/loader/code-mask.ts`（`codeMask` 从 `esm-transform.ts` 搬过来，行为不变），并加一个可选 `{ comments }` 参数把 `//` 与 `/* */` 的区间收出来。**绝不用正则找注释**——`//`、`/*` 出现在字符串/模板/正则里必须原样保留（这正是 M5e 那个 `import.meta` 教训）。
2. **新增构建期插件** `plugins/vendored-source.ts`：拦下 `vendor/node-lib/**.js?raw` 的 `load`，返回去注释后的 `export default`。真源码在磁盘上**一字未动**（`MANIFEST.json` 的 provenance 保持精确），只有 bundle 里那份变了。
3. **保真规则（这是重点）**：
   - **行号严格不变**：注释里的每个换行都保留，所以**第 N 行还是第 N 行**，堆栈行号仍指向真文件（M23 的 `sourceURL` 成果不被破坏）。
   - **代码列号不变**：只删注释文本，且注释总是行尾部分，所以没有代码字符移位。
   - **保留每文件 MIT 声明**：文件开头的 `// Copyright …` / `// Permission is hereby granted …` 块不删（它属于版权声明）。
   - **不可能粘连 token**：无换行的注释换成**一个空格**（`a/**/b` 不能变成 `ab`）；多行注释换成**它与原来一样多个的换行**，与空白等价（ASI 看到的 line terminator 和原来一致）。
   - 只额外清掉「注释独占行」残留的缩进与行尾空白（那行本来就没代码，不影响列号）。
4. **注册两处**：`plugins` 与 **`worker.plugins`**。worker 是 Vite 的**子构建**，实测顶层 `plugins` 里的钩子在 worker 子构建里**不会被调用**（debug 日志里 `load` 只收到主构建的模块）——所以必须显式写进 `worker.plugins`，否则 worker bundle 仍带注释。
5. **`plugins/node-builtins.d.ts`**：项目 `tsconfig` 是 `types: []`（没有 `@types/node`，因为运行时是浏览器）；只把插件用到的那两个 Node 全局（`node:fs.readFileSync`、`node:url.fileURLToPath`）就地声明，不把整套 Node 类型放进来。
6. **新增 `test/vendored-strip.test.ts`（11 条）**：单测覆盖逐行注释/块注释/字符串与正则里的真假注释/`a/**/b` 不粘连/保留 MIT 块/不动点；集成断言**每个 vendored 文件** ①`VENDORED[rel] === stripVendoredSource(磁盘原文)`（证明插件真的生效）、②行数与原文**完全相等**、③去注释后仍能被 `new Function` 解析、④总量减去比例在 15%–35% 之间。

**验证**：`tsc --noEmit` 干净 · `vitest run` **337/337（38 files，+11）** · `vite build` 绿：worker **1259.38KB → 1027.78KB（−231.6KB，−18.4%）**，**gzip 315,435 → 236,673 字节（−25%）**。

**有意偏离 / 保留**：缩进未动（保列号）；已注释掉的行仍占一个换行；`Function.prototype.toString()` 看到的 vendored 源码不再带注释（无代码依赖它）。

**涉及文件**：`plugins/vendored-source.ts`（新）、`plugins/node-builtins.d.ts`（新）、`src/node-runtime/loader/code-mask.ts`（新，自 `esm-transform.ts` 抽出）、`src/node-runtime/loader/esm-transform.ts`、`vite.config.ts`、`test/vendored-strip.test.ts`（新）。

### 2026-09-21 · M31 真 `readline`（`lib/readline.js` + `internal/readline/*`）

**目标**：`readline` 一直是 unsupported 占位（访问任何属性都抛 `NotImplementedError`），但它的依赖面全部是纯 JS：`events` / `string_decoder` / `timers` / `internal/validators` / `internal/util` / `internal/util/inspect` / `internal/readline/{utils,callbacks}`（前两者已 vendor）。更关键的是，它需要的“终端”只是一个 `{ input, output }` 流对——线编辑器、按键解码器、ANSI 光标函数、历史环全是流上的普通代码，标签页里没有 TTY 也能全程跑通。于是整份换成真源码。

**改了什么**

1. **vendor 6 个文件**（MANIFEST 75 → **81**，均 0 patch）：`lib/readline.js`、`lib/readline/promises.js`、`lib/internal/readline/interface.js`、`lib/internal/readline/emitKeypressEvents.js`、`lib/internal/readline/promises.js`、`lib/internal/repl/history.js`（`interface.js` 顶层 require 它，仅终端模式的 `_addHistory` 用到）。
2. **`readline` 从 `unsupported` 切到 vendored**：`readline`（+ `node:readline`）与 `readline/promises`（+ `node:readline/promises`）现在是真模块；`readline/promises` 是独立的 `Interface`（不是 `readline.Interface` 的子类，实测 Node 如此）。
3. **新增 `internal/process/permission` shim**：这是 `internal/repl/history.js` 写历史文件前要问的“权限模型”。标签页没有这玩意儿，且 `src/node_permission.cc` 在 `--permission` 关时也报告“未启用、所有 scope 都允许”。于是 `isEnabled()` 恒 false、`isAuditMode()` 恒 false、`has()` 恒 true、`drop()` 空操作、`availableFlags()` 返回真实清单；`internal/options` 补 `--permission`/`--permission-audit` 两个默认值。
4. **demo 加一段 `-- readline --`**：用捕获式 Writable 展示 ANSI 光标串，用 `emitKeypressEvents` 解码 `a` / `↑` / `Ctrl-C`，再用一个 `Readable.from` 跑一遍行拆分。
5. **新增 `test/readline.test.ts`（9 条）**：期望值全部先跑真 Node v26.9.0 取——导出面（含 `readline/promises` 与 `readline.promises` 同一对象、且两个 `Interface` 不同类）、跨 chunk 的行拆分与 close 时冲尾行、`question()` 写提示并回答案、`for await` 逐行、四个光标函数的逐字节 ANSI、非终端下 `prompt()`/`write()` 只写提示、5 串转义序列的按键解码（含 `sequence` 为 `undefined` 而非 `null` 这个细节）、`readline/promises` 两次 `question()` 与提示回显、终端模式的行回显与有界历史（最近在前）。

**有意偏离 / 局限**：
- 没存真实 TTY：`terminal: true` 只是“把流当终端用”。`process.stdin.isTTY` 仍为 false（与已记录的全局偏离一致）；真正需要 raw mode 的交互（`process.stdin.setRawMode`）仍不可用。
- 历史写盘走我们的虚拟 `fs`（服务的是 OPFS/VFS），不是宿主磁盘。
- 未验证 REPL 本身（`repl` 仍是 unsupported）：`internal/repl/history.js` 只是为了满足 `interface.js` 的顶层 require。

**验证**：`tsc --noEmit` 干净 · `vitest run` **326/326（37 files，+9）** · `vite build` 绿（worker 1173 → **1259.32KB**，readline 家族约 86KB）；demo 本地跑出 `-- readline --` / `cursor : "\u001b[3;4H\u001b[2K"` / `keypress : a, up, c+ctrl` / `edit lines : ["first","second"]`。

**涉及文件**：`tools/vendor.mjs`、`vendor/node-lib/{readline.js,readline/promises.js,internal/readline/*,internal/repl/history.js}` + MANIFEST、`src/node-runtime/builtins/{vendored-builtins.ts,unsupported.ts,internal-shims.ts,index.ts}`、`src/demo-project.ts`、`test/readline.test.ts`（新）、README/README_zh、设计文档。

### 2026-09-21 · M30 真 `worker_threads` 消息传递（`internal/worker/io.js`）

**目标**：`worker_threads` 一直是 unsupported spec（只有 `isMainThread`/`parentPort` 几个常量）。但 Node 的 `MessagePort`/`MessageChannel`/`BroadcastChannel` 的 JS 半边（`lib/internal/worker/io.js`）本来就是**纯 JS 跑在 native 端口句柄上**的，依赖面早已齐备（真 `stream`、真 `internal/event_target`、真 `internal/util`）。于是这轮把它整份换成真源码，并用 JS 重实现 `src/node_messaging.cc` 的可见契约。

**改了什么**

1. **vendor 3 个文件**（MANIFEST 73 → **75**）：`lib/internal/worker/io.js`、`lib/internal/per_context/messageport.js`、`lib/internal/worker/js_transferable.js`（后者替换旧 shim）。新增 `internal/deps/undici/undici` 小 shim：vendored 图里只用到 `createFastMessageEvent`，不值得打进 600KB 的 undici。
2. **`messaging` binding 重写**（`src/node-runtime/bindings/messaging.ts`，把原来写在 `misc.ts` 里的 DOM 面一起搬过去），对齐 `src/node_messaging.cc` 的**可观察契约**：
   - **纠缠组**：`MessageChannel` 是一个匿名两成员 `SiblingGroup`；`BroadcastChannel` 加入按名字共享的命名组（同名频道互相广播）；
   - **缓冲**：`receiving_messages_` 门（未 `start()` 的消息先留在队列里，加监听/调 `start()` 再投）；
   - **关闭握手**：`close()` 把该端口从组里摘除，匿名组只剩 1 个成员时向它补一条 Node 的“空消息”，它也跟着关（两边都发 `close`）；
   - **端口转移**：transfer list 里的端口“关闭发送端句柄 + 把端点交给消息”，接收端拿到**新建的句柄**，且消息图里对它的引用（递归替换为 token 再还原）会指向同一个新句柄；
   - **`DataCloneError` 全套**：`Found invalid value in transferList.` / `MessagePort in transfer list is already detached` / 重复 ArrayBuffer / 重复 MessagePort / source port / 消息里出现但未列入 transferList；
   - `receiveMessageOnPort`（同步取，不 start）、`stopMessagePort`、`drainMessagePort`、`moveMessagePortToContext`（单 context，即恒等）、`ref`/`unref`/`hasRef`。
3. **消息体走真 structured clone**：`postMessage` 先用“端口感知”的替换把端口换成 token 字符串，再把其余可转移对象交给宿主 `structuredClone({transfer})`，收到后还原 token。ArrayBuffer 转移后发送端真 detached（与 Node 一致）。
4. **`symbols` binding 补 6 个符号**（`oninit` / `no_message_symbol` / `messaging_{clone,transfer,deserialize,transfer_list}_symbol`）；`util` binding 补 `privateSymbols.transfer_mode_private_symbol` 与 `kDisallowCloneAndTransfer/kTransferable/kCloneable`；新增 `worker` binding（`isMainThread`/`threadId`/`getEnvMessagePort`）；`internal/buffer` 补 `markAsUntransferable`/`isMarkedAsUntransferable`。
5. **`binding.factory` 拿到 binding 表**（`BindingFactory(ctx, table)`）：Node 的 binding 是各自独立的 C++ 对象，而我们这边 `messaging` 必须拿到 `symbols` 里那几个符号才能按 `src/node_messaging.cc` 的方式驱动端口。注册表顺序不变，读取一律惰性。
6. **`worker_threads` 变真部分**（`builtins/worker-threads.ts`）：`MessageChannel`/`MessagePort`/`BroadcastChannel`/`receiveMessageOnPort`/`markAsUncloneable`/`markAsUntransferable`/`moveMessagePortToContext` 都来自真 io.js；`Worker`/`postMessageToThread` 明确抛 notImplemented（标签页里开不了线程）。demo 也加了一段 `-- worker_threads --`。
7. **新增 `test/message-channel.test.ts`（9 条）**：期望值全部先跑真 Node v26.9.0 取——导出面与端口形状（`instanceof`、`[object EventTarget]`、`hasRef`）、构造器/无 new/无参/非法 transferList 的**逐字符错误**、structured clone 与缓冲、投递顺序、`receiveMessageOnPort` 同步且不 start、`close` 双向传播、端口转移（接收端拿到端口、发送端句柄变 stale、再次转移报 detached）、ArrayBuffer 转移、整个 `DataCloneError` 面、`BroadcastChannel` 同名广播。

**有意偏离 / 局限**：
- **端口不参与“进程存活”**：Node 里一个 refed 且带监听的空闲端口会让进程活着不退出（实测确认）；这里 `ref`/`unref` 只做 `hasRef()` 所需的记账，不把空闲端口算进“还有活干”，否则任何建了 channel 的脚本都会永久挂住。有未投递消息时当然仍然算活。
- **`MessageEvent` 是本 realm 的 `Event` 子类**（不是宿主/undici 的 `MessageEvent`）：宿主那个 `MessageEventInit` 只接受宿主自己的 `MessagePort`，拿我们转过来的端口会在 `ports` 校验上抛错，而 `BroadcastChannel` 的 `dispatchEvent` 又要求事件是本 realm `Event` 的实例。代价：sandbox 里 `event instanceof MessageEvent` 不成立（这个 runtime 本来就没装全局 `MessageEvent`；把 realm 的类塞进全局会让 Vite bundle 里的 `class MessageEvent` 撞名——已实测）。`e.data`/`e.ports`/`e.type`/`e.target` 都是真的。
- **`JSTransferable` 的 clone/transfer 钩子未接**：`markTransferMode`（`AbortSignal` 用它声明可转移）现在真的会盖章，但宿主 `structuredClone` 不读它，所以 `structuredClone(signal)`/转移 `AbortSignal` 仍会抛 DataCloneError（与 M26 之前的行为一致，非回归）。
- timer 回调抛异常、`setImmediate` 与 `setTimeout(0)` 的相对顺序等 M29 已记录的偏离不变。

**验证**：`tsc --noEmit` 干净 · `vitest run` **317/317（36 files，+9）** · `vite build` 绿；本地与线上（真浏览器）跑 demo 都能看到 `-- worker_threads --` / `sync receive` / `channel msg`（`ports=1`）/ `transferred`。

**涉及文件**：`tools/vendor.mjs`、`vendor/node-lib/{internal/worker/io.js,internal/worker/js_transferable.js}` + MANIFEST、`src/node-runtime/binding*`（`context.ts`/`index.ts`/`misc.ts`/`util.ts`/`messaging.ts` 新增）、`src/node-runtime/builtins/{vendored-builtins.ts,internal-shims.ts,index.ts,undici.ts,worker-threads.ts,unsupported.ts}`、`src/node-runtime/runtime.ts`、`src/demo-project.ts`、`test/message-channel.test.ts`（新）、README/README_zh、设计文档。

### 2026-09-21 · M29 真 `timers`（`lib/timers.js` + `internal/timers.js`）

**目标**：手写的 `builtins/timers.ts` 只实现了 `setTimeout`/`setInterval`/`setImmediate` 与清除，`Timeout.ref()`/`unref()`/`hasRef()`/`refresh()` 全是空函数，`clearTimeout(number)`（原始 id）不符合规范，`timers/promises` 是近似品。真 `lib/timers.js` 的依赖面也已齐（`internal/validators`/`internal/util`/`internal/util/debuglog`/`internal/async_hooks`/`internal/linkedlist`），于是整份换成真源码。

**改了什么**

1. **vendor 5 个文件**（MANIFEST 68 → **73**）：`lib/timers.js`、`lib/internal/timers.js`、`lib/timers/promises.js`、`internal/linkedlist.js`、`internal/priority_queue.js`。
2. **删掉手写 `builtins/timers.ts`**，换成 vendored 条目（`timers`、`timers/promises`）。真 `Timeout` 类（`ref`/`unref`/`hasRef`/`refresh`/`close`/`[Symbol.toPrimitive]`/`[Symbol.dispose]`）、真 `knownTimersById`（支持 `clearTimeout(数字)`）、真 `Immediate`、真 `insert`/`unenroll`/`active`/`unrefActive`、真 `TimersList`/PriorityQueue、真 `timers/promises`（含 `scheduler.wait/yield` 与 `setInterval` 异步迭代器）。
3. **`timers` binding 重写为真 `src/timers.cc` 的表面 + 一个代替 libuv 的驱动**：
   - 提供 `immediateInfo`（`Int32Array(3)`，`[kCount,kRefCount,kHasOutstanding]`）与 `timeoutInfo`（`Int32Array(1)`）——`internal/timers.js` 直接往它们里写，必须是 TypedArray；
   - `getLibuvNow` 对齐 `Environment::GetNowUint64`（自 binding 创建起算的**整数毫秒**）；
   - `scheduleTimer(ms)` 武装一个宿主 timer 代表 “下一个到期时间”的 uv_timer；`setupTimers(processImmediate, processTimers)` 收起 JS 回调；`toggleTimerRef`/`toggleImmediateRef` 跟踪 ref 状态（`toggleImmediateRef(true)` 会安排一次 check）。
   - **`runTimers()` 复现 `Environment::RunTimers`**：调 JS `processTimers(getLibuvNow())`，再按返回值 `±expiry` 重新武装（`0` = 队列空、`>0` = 还剩 refed、`<0` = 只剩 unrefed）；回调用抛异常时按 `src/env.cc` 的 `ret.IsEmpty()` 循环重入队列（重新武装后重抛）。
   - **`runCheck()` 复现 `Environment::CheckImmediate`**：一个宿主 macrotask 代表“事件循环转了一圈”，`do { processImmediate() } while (kHasOutstanding)`；批结束后若还有待处理的 immediate 就再排一次。
4. **runtime 构造时装上 timer 回调**（对齐 `internal/bootstrap/node.js`）：`getTimerCallbacks(() => this.#runNextTicks())` 取得 `processImmediate`/`processTimers`，再 `setupTimers(...)`。为此把 `nextTick` 的排空逻辑抽成 `#scheduleNextTickDrain`/`#drainNextTicks`，新增 `#runNextTicks()`（`internal/timers.js` 在列表之间调它）。
5. **`activeCount` 计入真队列**：新增 `#activeWorkCount()` = 运行时自身宿主 timer 数 + binding 的 `__liveCount()`（已武装的 refed 到期 / refed timeout / 任一代未决 immediate）。`proc/host.ts` 用它判定子进程是否结束，所以子程序里的 `setTimeout` 必须被看见（否则 “cannot be run synchronously” 的判定会漏）。
6. **每轮 run 清空定时器队列**：`#clearAllTimers` 除清宿主句柄外，还通过**公共 `clearTimeout`/`clearImmediate`** 逐个清掉真队列里的条目（同时维护链表、优先队列与 ref 计数），再 `binding.__reset()` 丢掉驱动句柄。**为什么不用直接清空内部表**：`timerListQueue` 是带私有字段的 PriorityQueue，直接清 `timerListMap` 会留下队列里的悬空节点，让 `processTimers` 死循环；走公共路径才一致。
7. **新增 `test/timers.test.ts`（8 条）**：期望值先跑真 Node v26.9.0 取——导出表、`Timeout` 状态（`hasRef`/`_idleTimeout`/`_repeat`/`unref`/`ref`/`close`）、`+t` 原始强转 + `clearTimeout(数字)`、`setImmediate` 的 `Immediate` 形状、到期顺序、透传额外参数、interval 重复直到清除、`timers/promises`（含 `scheduler.wait/yield` 与异步迭代器、与 `require('timers/promises')` 同一对象）、以及“pending timer 抬高 `activeTimers`、下次 run 被清空”。

**有意偏离 / 局限**：异常从 timer 回调抛出时，驱动会重新武装一次并让异常上浮（Node 有可捕获的 `uncaughtException` 循环，这里没有）；`setImmediate` 与 `setTimeout(0)` 的相对顺序与 Node 一样不确定。

**验证**：`tsc --noEmit` 干净 · `vitest run` **308/308（35 files，+8）** · `vite build` 绿（worker 1104 → **1145.47KB**）；本地 `vite preview`（`?v=m29a`）真浏览器跑：`keys: ...` / `ctor/hasRef/idle/repeat: Timeout true 20 null` / `unref/ref: true false true true` / `primitive: number true` / `cleared: true` / `args: x 3` / `interval: 3 true` / `p1: v` / `p2: w` / `wait: ok` / `yield: true` / `p-interval: i,i,i` / `same: true` / `DONE`，无 `SHOULD-NOT-PRINT`，**exit 0**。

**涉及文件**：`tools/vendor.mjs`、`vendor/node-lib/{timers.js,internal/timers.js,timers/promises.js,internal/linkedlist.js,internal/priority_queue.js}` + MANIFEST、`src/node-runtime/builtins/{vendored-builtins.ts,index.ts}`（删 `timers.ts`）、`src/node-runtime/bindings/timers.ts`（重写）、`src/node-runtime/runtime.ts`、`test/timers.test.ts`（新）、`README.md`/`README_zh.md`、`docs/superpowers/specs/2026-09-17-web-node-design.md`。

### 2026-09-21 · M28 真 `os`（`lib/os.js`）

**目标**：手写的 `builtins/os.ts` 是一堆直接返回常量的函数（没有 `constants`、没有 `Symbol.toPrimitive` 强制转换、`networkInterfaces` 恒为 `{}`、`userInfo` 不看 options、根本没有 `getPriority`/`setPriority`/`machine`）。真 `lib/os.js` 依赖面很小（`internal/errors` + `internal/util` + `internal/validators`，都是已有的），于是整份换成真源码。

**改了什么**

1. **vendor `lib/os.js`**（MANIFEST 67 → **68**）。
2. **删掉手写 `builtins/os.ts`**，换成 vendored 条目（`id: 'os'`、`aliases: ['node:os']`、`deps: ['internal/errors','internal/util','internal/validators']`）。现在 `os.arch()`/`os.platform()` 读 **sandbox `process`**，`os.constants` 走真 `internalBinding('constants').os` 并 `ObjectFreeze(constants.signals)`，`os.tmpdir()` 走真 `getTempDir()`；`module.exports` 上的 `EOL`/`devNull` 改为不可写的 `ObjectDefineProperties`，并补上真源码安装的 `[Symbol.toPrimitive]` 强制转换 hook。
3. **`os` binding 对齐 `src/node_os.cc` 表面**：新增 `getOSInformation()`（真源码拆一个 `[type, version, release, machine]` 元组）、`getLoadAvg(out)`（真源码传一个 `Float64Array` 要填）、`getAvailableParallelism`、`getPriority`/`setPriority`（真源码读 `0` / 返回 `0` 表示成功）、`isBigEndian`（是值不是函数，模块顶层就读）；删掉旧的多余函数（`getOSType`/`getOSRelease`/`getOSVersion`/`getMachine`/`getTmpdir`）；`getInterfaceAddresses` 由 `{}` 改为 `[]`（真源码按 7 元组步长遍历，数组才是对的空值）。
4. **新增 `credentials` binding**（`getTempDir: () => '/tmp'`，`cacheDir: '/tmp'`）：真 `os.tmpdir()` 直接 `internalBinding('credentials').getTempDir()`；把 `credentials` 从 `UNSUPPORTED_BINDINGS` 移到 `REGISTRY`。
5. **`internal/errors` 补 `ERR_SYSTEM_ERROR`**（`'A system error occurred'`）：真源码的 `getCheckedFunction` 包装器在 binding 返回 `undefined` 时抛它。我们的 binding 从不失败，故只在错误分支可达，仅为形状忠实。
6. **新增 `test/os.test.ts`（7 条）**：把真源码比旧 shim 多出来的行为钉住——`Symbol.toPrimitive` 强制转换、`constants.signals` 冻结/`constants` 本身不冻结、`loadavg` 的 `Float64Array` 解码、`userInfo()` 字段、`networkInterfaces()` 空对象、`setPriority` 的 `ERR_OUT_OF_RANGE` 校验。期望值先跑真 Node v26.9.0 确认结构，数值用 sandbox 自身的。

**一个测试技巧（重要）**：vendored 模块是硬编码参数编译的，`process` 对它们是**自由变量**（即 embedder 的全局），不是注入的参数。worker 里 `globalThis.process` 就是 sandbox process（`installGlobals` 默认 true），所以线上 `os.platform()` 得到 `linux`；但 vitest 里测试都传 `installGlobals:false`，宿主 `globalThis.process` 是真 Node 的，会得到 `darwin`。因此 os 测试在运行期间临时把 `globalThis.process` 换成 `runtime.sandboxGlobals.process`，结束后还原——这是复现 worker 真实环境，不是绕过。

**为什么**：`os` 是 npm 包和库常用的环境探测面；旧 shim 缺 `constants`/`machine`/优先级，会让用户代码走错分支。

**验证**：`tsc --noEmit` 干净 · `vitest run` **300/300（34 files，+7）** · `vite build` 绿（worker 1096 → **1104.38KB**）；本地 `vite preview`（`?v=m28a`）真浏览器（worker 内）跑：`Browser web-node browser wasm32` / `platform/arch: linux wasm32` / `/home/web-node /tmp web-node` / `LE "\n" /dev/null` / `total/free: 1073741824 536870912` / `parallelism/loadavg/priority: 11 [0,0,0] 0` / `signalsFrozen: true UV_UDP_REUSEADDR: 4` / `coerce: Browser linux wasm32 web-node`，**exit 0**。

**涉及文件**：`tools/vendor.mjs`、`vendor/node-lib/os.js` + MANIFEST、`src/node-runtime/builtins/{vendored-builtins.ts,index.ts,internal-shims.ts}`（删 `os.ts`）、`src/node-runtime/bindings/{misc.ts,index.ts}`、`test/os.test.ts`（新）、`README.md`/`README_zh.md`、`docs/superpowers/specs/2026-09-17-web-node-design.md`。

### 2026-09-20 · M27 真 `console`（`lib/console.js` + `internal/console/*`）

**目标**：手写的 `builtins/console.ts` 里 `count`/`countReset`/`group`/`groupEnd`/`table`/`time`/`timeEnd` 全是假的（恒输出 `label: 1` / `0ms` / 直接 `inspect`），`Console` 类也不完整。真 `lib/console.js` + `internal/console/*` 的依赖面已经齐了（inspect / debuglog / cli_table / trace_events / colors 都能搞定），于是整份换成真源码。

**改了什么**

1. **vendor 9 个文件**（MANIFEST 59 → **67**）：`console.js`、`internal/console/constructor.js`、`internal/console/global.js`、`internal/cli_table.js`、`internal/trace_events.js`、`internal/util/debuglog.js`、`internal/readline/utils.js`、`internal/readline/callbacks.js`（后两个只在 `clear()` 且 stdout 是 TTY 时可达，保持忠实备着）。
2. **删掉手写 `builtins/console.ts`**：真 `Console` 类 + 真 `console.table`（ASCII 框线）/`count`/`countReset`/`group`（真缩进）/`groupCollapsed`/`time`/`timeLog`/`timeEnd`/`assert`/`dir`/`dirxml`/`Console` 构造器，以及 `console instanceof Console` 的 `Symbol.hasInstance`。
3. **`internal/util/debuglog` 从 shim 换成真源码**：真 `debuglog()`（按 `NODE_DEBUG` 订阅）、真 `time`/`timeLog`/`timeEnd`/`kNone`（console.time 就是它们）。为此在 runtime 构造时调一次 `initializeDebugEnv(process.env.NODE_DEBUG)`（对齐 Node 在 `internal/process/pre_execution.js` 里的初始化）——否则第一次 `debug(...)` 会因 `debugImpls` 未初始化而抛错。
4. **`process.stdout`/`stderr` 改为真 `Writable`**（lazy getter + setter，`_write` 同步排空到 binding 的 stdout/stderr 汇）：真 console 写的是 `stream.write(string, cb)` 并探测 `listenerCount('error')`/`once`/`removeListener`，裸对象不够。setter 是必需的——spawn host 会把子进程的管道流 `proc.stdout = ...` 赋上去。
5. **绑定全局 console 的流**：在 runtime 里调 `internal/console/constructor` 的 `kBindStreamsLazy(process)`（Node 在 `initializeGlobalConsole` 里做同一件事）。**关键：传我们的 sandbox `process`**，不能依赖模块里的自由变量 `process`——vendored 模块经硬编码参数编译，自由 `process` 在 Node/Vitest 下是**宿主** process（测试都传 `installGlobals:false`），让它自己取会把 console 输出写到宿主而非 runtime 的 stdout 汇。`initializeGlobalConsole` 剩下的 snapshot/inspector 部分在我们这里恒为 no-op（`hasInspector` 为 false），故只复现绑定流这一步。
6. **新增 `trace_events` binding**（inert：`usePerfetto:false`、`trace:()=>{}`、`getCategoryEnabledBuffer:()=>new Uint8Array(1)`）与 `inspector` binding 毂（仅在不可达分支被引用）。`internal/trace_events.js` 换真源码，依赖 `internal/constants` 的 `CHAR_*`。
7. **`internal/errors` 再补两个 code**：`ERR_CONSOLE_WRITABLE_STREAM`、`ERR_INCOMPATIBLE_OPTION_PAIR`（`isStackOverflowError` 已有）。
8. **spawn host 的管道流**补上 `listenerCount`/`removeListener`/`addListener`，使子进程里的真 console 也能写入。
9. **新增 `test/console.test.ts`（8 条）**：期望值先跑真 Node v26.9.0 取（分 stdout/stderr）——`log/info/debug`→stdout、`warn/error`→stderr、`%s/%d/%o` 插值、`count/countReset/group` 序列、`table` 框线表、`assert` 只输失败且在 stderr、`dir` 带 options、`time` 格式、`console instanceof Console`。

**为什么**：`console` 是最常用的调试面，之前的假 `table`/`count`/`group`/`time` 会误导用户。换真源码后其行为与 Node 一一对应。

**验证**：`tsc --noEmit` 干净 · `vitest run` **293/293（33 files，+8）** · `vite build` 绿（worker 1037 → **1096.46KB**）；本地 `vite preview`（`?v=m27a`）真浏览器跑：`count` 序列、`group` 缩进、真 `┌─┬─┐` 框线表、`Assertion failed: boom x`、`str=x num=3 obj={ a: 1 }`、`t: 0.035ms`，**exit 0**。

**保留的偏离（有意）**：全局 console 的流在 runtime 构造时就绑好（Node 在 pre_execution 里绑）；我们不做 snapshot/inspector 那半段。

**涉及文件**：`tools/vendor.mjs`、`vendor/node-lib/{console.js,internal/console/*,internal/cli_table.js,internal/trace_events.js,internal/util/debuglog.js,internal/readline/*}` + MANIFEST、`src/node-runtime/builtins/{vendored-builtins.ts,index.ts,process.ts,internal-shims.ts}`（删 `console.ts`/`internalDebuglogSpec`）、`src/node-runtime/bindings/{misc.ts,index.ts}`、`src/node-runtime/proc/host.ts`、`src/node-runtime/runtime.ts`、`test/console.test.ts`（新）、`README.md`/`README_zh.md`、`docs/superpowers/specs/2026-09-17-web-node-design.md`。

### 2026-09-20 · M26 真 `AbortController`/`AbortSignal`（`lib/internal/abort_controller.js`）

**目标**：`internal/abort_controller` 之前是 shim，直接 re-export 宿主环境的 `AbortController`/`AbortSignal`。M25 把真 `EventTarget` 接上之后，真 `lib/internal/abort_controller.js` 的依赖面已经齐了（它就建在 `internal/event_target` + `internal/webidl` + `internal/validators` 上），于是整份换成真源码。

**改了什么**

1. **vendor `lib/internal/abort_controller.js`**（MANIFEST 58 → **59**）。
2. **删掉 `internalAbortControllerSpec` shim**，换真源码：真 `AbortController`/`AbortSignal`（`AbortSignal` 直接继承真 `EventTarget`），真 `AbortSignal.timeout()` / `any()` / `abort()` / `throwIfAborted()` / `reason`（默认 DOMException `AbortError`，`code 20`），以及 `aborted()` / `transferableAbortSignal()` / `transferableAbortController()`。
3. **新增 `internal/worker/js_transferable` shim**（`origin: 'web-node'`）：给 `markTransferMode`/`setup`/`structuredClone` + `kClone`/`kDeserialize`/`kTransfer`/`kTransferList` 符号。传输机制本身是 inert 的——这个运行时没有 message port 可传，所以 `markTransferMode` 是 no-op，而不是假装序列化能用。
4. **`messaging` binding 长大**：补上 `DOMException`（`internal/abort_controller` 用它构造 `AbortError`）、`structuredClone`、`setDeserializerCreateObjectFunction`、`exposeLazyDOMExceptionProperty`。
5. **`symbols` binding 改为 memo**：之前 `symbolsBinding` 每次调用都 `Symbol(name)` 新造，重复读取同一名字会得到不同身份；改为缓存后，`internal/per_context/domexception.js` 与将来的 `internal/worker/io.js` 看到的是同一批符号。
6. **依赖声明顺序很关键**：`internal/abort_controller` 的 eager deps 把 `events` 放第一位——Node 的文件在顶层就要 `events` 的 `kMaxEventTargetListeners`，而 `internal/event_target` 顶层也要 `events`；先物化 `events` 才不会把它们接到半成品 `module.exports` 上。`internal/worker/io`（MessageChannel）只在 `[kTransferList]` 里 lazy 取，而我们不做 postMessage，因此故意不注册。
7. **新增 `test/abort-controller.test.ts`（6 条）**：期望值先跑真 Node v26.9.0 取——`AbortSignal` 继承真 `EventTarget`、默认 reason 是 `AbortError`(code 20) 且 `throwIfAborted` 抛之、abort 监听器只触发一次、`timeout()`/`any()`/`abort()` 静态方法、`AbortSignal.any` 传播 reason、transfer 辅助导出。

**为什么**：AbortController/AbortSignal 已被 stream / events / pipeline 广泛用作取消通道。之前 re-export 宿主实现，意味着取消失效、事件相关行为可能与 Node 不一致；现在它站在真 `EventTarget` 上，语义与 Node 对齐。

**保留的偏离（有意）**：全局 `AbortController`/`AbortSignal` 仍镜像宿主全局（Node 会把内部实现装为全局）。原因：本运行时的 `fetch` 是宿主 `fetch`，互换全局可能引入宿主/Node 信号互操作问题；内部模块（stream/events）已统一用真源码那一份。

**验证**：`tsc --noEmit` 干净 · `vitest run` **285/285（32 files，+6）** · `vite build` 绿（worker 1018 → **1037.37KB**）；本地 `vite preview`（`?v=m26a`）真浏览器跑：`proto=EventTarget`、`reason=AbortError:20`、`once=AbortError`、`stream=xy`、`addAbortSignal=AbortError`、`timed out=TimeoutError`，**exit 0**。

**涉及文件**：`tools/vendor.mjs`、`vendor/node-lib/internal/abort_controller.js` + MANIFEST、`src/node-runtime/builtins/{vendored-builtins.ts,internal-shims.ts,index.ts}`、`src/node-runtime/bindings/misc.ts`、`test/abort-controller.test.ts`（新）、`README.md`/`README_zh.md`、`docs/superpowers/specs/2026-09-17-web-node-design.md`。

### 2026-09-20 · M25 真 Web EventTarget 栈（`internal/event_target` + `internal/webidl`）

**目标**：`internal/event_target` 一直是个 stub——`isEventTarget()` 恒为 `false`，只有一个 `kEvents`/`kWeakHandler`/`kResistStopPropagation` 符号。真 `lib/internal/event_target.js` 依赖面可控（`internal/errors`/`internal/validators`/`internal/util`/`util`/`internal/webidl`/`events`/`internal/perf/utils`），于是把整条 Web EventTarget 栈换成真源码。

**改了什么**

1. **vendor 3 个文件**（MANIFEST 55 → **58**）：`internal/event_target.js`、`internal/webidl.js`、`internal/perf/utils.js`。
2. **删掉 `internal/event_target` stub**，改用真源码：真 `EventTarget`/`Event`/`CustomEvent`/`NodeEventTarget`/`defineEventHandler`/`initEventTarget`/`isEventTarget`，以及 `kEvents`/`kWeakHandler`/`kResistStopPropagation`（现在与 `events.js`/`internal/streams/operators` 看到的是同一批真符号）。
3. **`events.js` 的 `internal/event_target` 从 eager deps 里摘掉**：真 `event_target.js` 顶部会 eager `require('events')`，而 `events.js` 只在其函数体内 lazy require `event_target`（对齐 Node）。两边都 eager 会让循环加载时 `events` 处于 `loading`，把空的 `module.exports` 交出去（`kMaxEventTargetListeners` 变 undefined）。摘要后按需物化，不再死锁。
4. **`performance` binding 对齐 `src/node_perf_common.h`**：补 `constants`（`NODE_PERFORMANCE_MILESTONE_*`，`TIME_ORIGIN_TIMESTAMP=0`/`TIME_ORIGIN=1`/…/`BOOTSTRAP_COMPLETE=7`/`INVALID=8`）与 `milestones` 数组；milestone 由 `performance.timeOrigin` 推出（ns/μs，对应 `PerformanceState::Initialize`）。`internal/perf/utils.js` 因此拿到真 `now`/`getTimeOriginTimestamp`。
5. **新增 `test/event-target.test.ts`（6 条）**：期望值先跑真 Node v26.9.0 取——真类导出、`NodeEventTarget` 派发、`isEventTarget` 对普通对象为假（真实现返回 `obj?.constructor?.[kIsEventTarget]`，即 `undefined`）、重入派发报 `ERR_EVENT_RECURSION`、`events.on(target, …)` 真能迭代、`internal/webidl` 的 `converters.DOMString`/`convertToInt`/`requiredArguments`/`type`。
6. **顺带修一个 worker-only 启动 bug**：真 `lib/internal/util.js` 在**加载时**读 `process.versions/platform`，而它在 `process` 自身的构建链里（`process → events → internal/util`）。Node/Vitest 下有真 `process` 全局所以测试全绿，浏览器 worker 没有 → `new NodeRuntime()` 抛 `ReferenceError: process is not defined`，页面显示 “runtime not initialised”。修法：物化任何模块前先给 `globalThis.process` 播种一个最小 stand-in（`platform`/空 `versions` 与真对象一致），`#installGlobals()` 后换成真 process。提交 `e21f69a`。

**为什么**：这是一直以来 “vendoring 真源码” 的延续，且 event_target 是 `events` / stream operators / abort 系列的共享底座。真的 `EventTarget` 让将来接 `AbortSignal`、Web streams 互操作都有真实基础，不再是恒假的 stub。

**验证**：`tsc --noEmit` 干净 · `vitest run` **279/279（31 files，+6）** · `vite build` 绿（worker 943.38 → **1018.09KB**）；本地 `vite preview`（`?v=m25a`）真浏览器跑 `/project/index.js`：`events.on` 异步迭代器得到 `["hello"]`、`stream.Readable.from` 得到 `abc`、`events.once({signal})` abort 后抛 `AbortError`、**exit 0**。

**涉及文件**：`tools/vendor.mjs`、`vendor/node-lib/{internal/event_target.js,internal/webidl.js,internal/perf/utils.js}` + MANIFEST、`src/node-runtime/builtins/{vendored-builtins.ts,internal-shims.ts,index.ts}`、`src/node-runtime/bindings/misc.ts`、`src/node-runtime/runtime.ts`、`test/event-target.test.ts`（新）、`README.md`/`README_zh.md`、`docs/superpowers/specs/2026-09-17-web-node-design.md`。

### 2026-09-20 · M24 真 `util` 模块（`lib/util.js` + `lib/internal/util.js`）

**目标**：`util` 还一直是手写的 112 行壳（`promisify`/`callbackify`/`inherits`/`deprecate`/`styleText` 都是简化版，`parseArgs` 直接抛错）。真 `lib/util.js` 与 `lib/internal/util.js` 均为纯 JS，于是把整个模块换掉。

**改了什么**

1. **vendor 6 个文件**（MANIFEST 49 → **55**）：`util.js`、`internal/util.js`、`internal/util/diff.js`、`internal/util/parse_args/{parse_args,utils}.js`、`internal/mime.js`。
2. **`util` builtin 换成真源码**：删掉手写 `src/node-runtime/builtins/util.ts`。`util.format`/`inspect`/`types`/`isDeepStrictEqual` 继续走真源码；新增真 `promisify`（含 `util.promisify.custom`）、`callbackify`、`inherits`、`deprecate`、`styleText`、`stripVTControlCharacters`、`toUSVString`、`getSystemErrorName/Map/Message`、`parseEnv`、`MIMEType`/`MIMEParams`、`parseArgs`、`diff`、`transferableAbort*`/`aborted`、`TextEncoder/TextDecoder`。
3. **`util` binding 补齐** `internal/util.js` 需要的东西：`defineLazyProperties`（照 `src/node_util.cc` 实现——每键一个懒取值的 getter，首次访问时 `require(id)[key]` 并缓存）、`constructSharedArrayBuffer`、`guessHandleType`、`privateSymbols`（`arrow_message_private_symbol`/`decorated_private_symbol`）、`parseEnv`（**逐行移植 `src/node_dotenv.cc` 的 `ParseContent`**）、真 `sleep`（`Atomics.wait`）。
4. **新 `uv` binding 函数**：`getErrorMap`/`getErrorMessage`/`errname`（本环境无 libuv errno 表，返回空 Map / `Unknown system error <n>`，已在测试里写明这一差异）。
5. **BindingContext 新增 `requireBuiltin`**（由 runtime 懒指向 `realm.require`），供 `defineLazyProperties` 这种需要反向 require 的 binding 使用。
6. **两个新 shim**：`internal/encoding`（把 native `TextEncoder`/`TextDecoder` 导出去）与 `internal/util/trace_sigint`（`setTraceSigInt` no-op）；`internal/abort_controller` 已有 shim 直接满足 `lib/util.js` 的懒加载。
7. **`internal/errors` shim 再拓宽**：补 `ERR_NO_CRYPTO`/`ERR_NO_TYPESCRIPT`/`ERR_WEBASSEMBLY_NOT_SUPPORTED`/`ERR_FALSY_VALUE_REJECTION`（带 `reason` 属性）/`ERR_INVALID_MIME_SYNTAX`/`ERR_PARSE_ARGS_*`，新增 `ErrnoException`/`ExceptionWithHostPort`/`UVExceptionWithHostPort`/`overrideStackTrace`/`uvErrmapGet`。
8. **新测试 `test/util.test.ts`（6 条）**：期望值全部先跑真 Node v26.9.0 取；覆盖 format/inspect/types/isDeepStrictEqual、真 `promisify`（含 `.custom`）/`callbackify`/`inherits`/`deprecate`、string 助手、**`parseEnv` 的 dotenv 解析**、真 `MIMEType`/`parseArgs`/`diff`，以及 errno 表的差异。
9. **与 Node 的差异（已注明）**：无 libuv，所以 `getSystemErrorMap()` 为空、`getSystemErrorName(-2)` 返回 `Unknown system error -2`（Node 是 `ENOENT`）；`getCallSites` 仍返回 `[]`；`parseEnv` 已逐行移植。

**验证**：`tsc --noEmit` 干净 · `vitest run` **273/273**（+6）· `vite build` 绿（worker 860.74 → **943.06KB**）。

**涉及文件**：`tools/vendor.mjs`、`vendor/node-lib/{util.js,internal/util.js,internal/util/diff.js,internal/util/parse_args/*,internal/mime.js}` + MANIFEST、`src/node-runtime/bindings/{util.ts,misc.ts,context.ts}`、`src/node-runtime/runtime.ts`、`src/node-runtime/builtins/{index.ts,internal-shims.ts,vendored-builtins.ts}`、删除 `src/node-runtime/builtins/util.ts`、`test/util.test.ts`（新）、`README.md`/`README_zh.md`、`docs/superpowers/specs/2026-09-17-web-node-design.md`。

### 2026-09-20 · M23 真 `assert` 全家桶（+ 真 `internal/validators`，+ 真 `isDeepStrictEqual`，+ 堆栈真文件名）

**目标**：`assert` 一直是我们手写的 112 行简化版，`internal/validators` 也只是一堆 no-op 占位。真 `lib/assert.js` 是纯 JS，于是按惯例把整条断言栈搬过来。

**改了什么**

1. **vendor 8 个文件**（MANIFEST 41 → **49**）：`assert.js`、`internal/assert.js`、`internal/assert/utils.js`、`internal/assert/assertion_error.js`、`internal/assert/myers_diff.js`、`internal/util/comparisons.js`、`internal/util/colors.js`、`internal/validators.js`。
2. **`assert` builtin 换成真源码**：删掉手写 `assert-impl.ts`，`assert` / `assert.ok` / `strict` / `deepStrictEqual` / `partialDeepStrictEqual` / `throws` / `match` / Myers 彩色 diff / `AssertionError` 全是 Node 的。
3. **`internal/validators` 换成真源码**：删掉 no-op shim；`validateString` / `validateObject`（位域）/ `validateInteger` / `validateOneOf` … 现在是真的会报错的，报错文案也与 Node 一致。
4. **`util.isDeepStrictEqual` 换成真 `internal/util/comparisons`**（手写版只比较可枚举自属性；真版处理 Map/Set/typed array/循环引用/prototype）。
5. **`internal/errors` shim 补齐断言用到的 code**：`ERR_AMBIGUOUS_ARGUMENT` / `ERR_ASSERTION` / `ERR_CONSTRUCT_CALL_REQUIRED` / `ERR_INVALID_THIS` / `ERR_UNKNOWN_SIGNAL` / `ERR_SOCKET_BAD_PORT`，并给每个 code 类挂上 `HideStackFramesError` 静态属性（validators 会解构它）。
6. **`internal/util` shim 补 `setOwnProperty`**；新增 `internal/errors/error_source` shim。
7. **`constants` binding 改成 Node 命名空间形状**：补 `os: { signals, errno, priority, dlopen, UV_UDP_REUSEADDR }`（validators 读 `internalBinding('constants').os.signals`），并把 unix 信号表补全。
8. **`buffer` binding 补 `compare`**（comparisons 用它短路 buffer 相等），**`url` builtin 补 `isURL` / `isURLInstance`**。
9. **编译器给每个单元打 `sourceURL` + 新增 `source-registry`**（新文件 `src/node-runtime/source-registry.ts`）：loader 给用户/依赖模块、`compileCjs` 给 vendored 模块都登记源码并追加 `//# sourceURL=…`。收益：① **堆栈里出现真文件名**（不再是 `<anonymous>`）；② `internal/errors/error_source` 能从 CallSite 找回源码行，`assert.ok(falsy)` 于是能打印真表达式。
   - 同时把编译路径从 `new Function(...params, body)` 换成 **`compileTagged`——单行 `(function(...params){ body\n//# sourceURL=url\n})` 的间接 `eval`**。原因：V8 的 `Function` 包装会吃掉两行，导致所有帧报 `line+2`（实测 `/project/index.js:3:26` 其实是第 1 行），而单行 eval 包装的偏移为 **0**，堆栈行号与源码一一对应（已加回归测试）。
10. **新测试 `test/assert.test.ts`（7 条）**：期望值全部先跑真 Node v26.9.0 取得；覆盖相等/不等/深度 diff（逐字节 Myers 输出）/throws/match/fail/自定义消息、`assert.ok(falsy)` 的表达式还原、`util.isDeepStrictEqual` 的结构比较，以及真 validators 的报错文案。
11. **与 Node 的差异（已在代码注释与测试里写明）**：
    - `getErrorSourceExpression` 走的是「CallSite + sourceURL + 源码登记」这条路，而非 V8 内部的 `getErrorSourcePositions`；它没有真的 tokenizer，所以**嵌在表达式中间**的调用会返回整条语句（到 `;` / 匹配 `)` 为止），而 Node 会精确到子表达式。
    - `HideStackFramesError` 只是别名同一个类，**不会真的隐藏栈帧**（我们无法改写已捕获的 stack）。

**验证**：`tsc --noEmit` 干净 · `vitest run` **267/267**（+8）· `vite build` 绿（worker 757 → **860.74KB**）。

**涉及文件**：`tools/vendor.mjs`、`vendor/node-lib/{assert.js,internal/assert.js,internal/assert/*,internal/util/comparisons.js,internal/util/colors.js,internal/validators.js}` + MANIFEST、`src/node-runtime/source-registry.ts`（新）、`src/node-runtime/vm.ts`、`src/node-runtime/loader/index.ts`、`src/node-runtime/bindings/{constants.ts,buffer.ts}`、`src/node-runtime/builtins/{index.ts,internal-shims.ts,util.ts,url.ts,vendored-builtins.ts}`、删除 `src/node-runtime/builtins/assert-impl.ts`、`test/assert.test.ts`（新）、`README.md`/`README_zh.md`、`docs/superpowers/specs/2026-09-17-web-node-design.md`。

### 2026-09-20 · M22 真 `internal/util/inspect`（`util.inspect` / `util.format` 换成真源码）

**目标**：`util.inspect` 一直是自研的极简版（只处理标量/数组/对象）。真文件 `lib/internal/util/inspect.js`（3067 行）是纯 JS，所以按惯例把它整份搬过来，只补它脚下缺的 native/shim。

**改了什么**

1. **vendor `lib/internal/util/inspect.js`**（MANIFEST 40 → **41**）。
2. **`util` builtin**：`inspect`/`format`/`formatWithOptions` 直接指向真模块（连同 `inspect.custom`、`inspect.defaultOptions`、`inspect.colors`），删掉自研格式化/遍历实现。
3. **`util` binding 对齐 `src/node_util.cc`**：新增 `constants`（V8 promise 状态 kPending/kFulfilled/kRejected、exit-info 字段、property filters ALL_PROPERTIES/ONLY_ENUMERABLE/SKIP_STRINGS/SKIP_SYMBOLS，值照 `v8-promise.h`/`v8-object.h`）；`getOwnNonIndexProperties` 按 filter 位（ONLY_ENUMERABLE/SKIP_STRINGS/SKIP_SYMBOLS）取值；`previewEntries` 实现 Map/Set/Array 条目预览与 `[entries, isKeyValue]` 慢路径。
4. **新增两个 shim spec**：`internal/bootstrap/realm`（真源码只用到 `BuiltinModule.exists(id)`，对着 realm 的公开模块表判定）、`internal/url`（`url` builtin 已含 WHATWG + file-URL 助手，直接 re-export）。
5. **`internal/util` shim 补**：`isError`（native error 或 `Error[Symbol.hasInstance]`）、`join`、`removeColors`。
6. **`internal/errors` 补 `isStackOverflowError`**（真实实现，缓存本 realm 的栈溢出 name/message）。
7. **`internal/validators` 对齐 Node**：新增 `kValidateObjectAllowNullable/Array/Function`（1/2/4），`validateObject` 改按位域判定（旧对象参数仍兼容）。
8. **`buffer` 补两样**：`Buffer.prototype.hexSlice(start,end)`（真 inspect 渲染 `[Uint8Contents]` 需要）与 `Buffer.prototype[inspect.custom]`（复刻 `lib/buffer.js`，得到 `<Buffer 01 02>`）。
9. **`console` 改走真 `util.formatWithOptions({}, …)`**（对齐 `lib/internal/console/constructor.js`）——修了 `console.log('%o', x)` 直出占位符的 bug。
10. **新测试 `test/util-inspect.test.ts`**（9 条）：期望值全部先跑真 Node v26.9.0 取得；覆盖 depth/sorted/showHidden/maxStringLength、Map/Set/WeakMap/typed/Buffer/Date/RegExp、ArrayBuffer 内容转储、循环引用 `<ref *1>`、`format`/`formatWithOptions`、`inspect.custom` 与 `colors`、无栈错误 `[Error: x]`，以及 console.log 端到端。
11. **两处 JS 无法复刻的差异，已在测试里显式断言为近似**：`getProxyDetails` 恒 `undefined`（Proxy 不可探测）→ 代理打印成普通对象；`getPromiseDetails` 恒 `kPending`（V8 不同步暴露 promise 状态）→ 已 settle 的 promise 仍打 `<pending>`。真 Node 分别为 `Proxy({ a: 1 })` 与 `Promise { 1 }`。

**验证**：`tsc --noEmit` 干净 · `vitest run` **258/258**（+9）· `vite build` 绿（worker 653 → 757KB，inspect.js ~100KB 已计入；改按需加载是待办）。

**涉及文件**：`tools/vendor.mjs`、`vendor/node-lib/internal/util/inspect.js` + MANIFEST、`src/node-runtime/bindings/util.ts`、`src/node-runtime/builtins/{util.ts,console.ts,internal-shims.ts,vendored-builtins.ts,index.ts,buffer.ts}`、`test/util-inspect.test.ts`、`README.md`/`README_zh.md`、`docs/superpowers/specs/2026-09-17-web-node-design.md`。

### 2026-09-20 · M21 真 `internal/util/types`（+ `src/node_types.cc` 对齐）

**目标**：`internal/util/types` 一直是自研。真文件很小（`lib/internal/util/types.js` 约 120 行，纯 JS），只靠 `internalBinding('types')` 与 `internal/` 原始值。这轮把它搬过来，顺便把上次为了它临时校过的 binding 对齐 native。

**改了什么**

1. **vendor `lib/internal/util/types.js`**（MANIFEST 39 → **40**）：真文件 `module.exports = { ...internalBinding('types'), isArrayBufferView, isDataView, isTypedArray, isUint8Array, ... }`，并用 `ObjectDefineProperties` 挂上惰性 `isKeyObject` / `isCryptoKey`（无 OpenSSL 时直接 `return false`，永远不会 require `internal/crypto/keys`）。
2. **`types` binding 对齐 `src/node_types.cc`**：把它减到 native 真实暴露的表面（`VALUE_METHOD_MAP` + `isAnyArrayBuffer` + `isBoxedPrimitive`），删掉多余的类型数组/`isWasm*`（那些应由 JS 层或别的 binding 提供）；补上漏掉的 `isBigIntObject`；修 `isBoxedPrimitive`（原实现把 `1n` `Symbol()` 这些**原始值**也算作 boxed，错了）、`isSymbolObject`（同理）。
3. **`util.types` 指向真模块**：`builtins/util.ts` 不再维护局部 `types` 字面量，改为 `ctx.require('internal/util/types')`。
4. **新测试 `test/internal-util-types.test.ts`**（5 条）：导出面与真 Node `util.types` 逐字对齐（43 个键）；view/typedarray/dataview 区分；**原始值不是 boxed**；promise/date/regexp/集合/asynfunction/generator；`isKeyObject`/`isCryptoKey` 无 OpenSSL 时 false。

**一个测试环境的坑（已处理并写进测试注释）**：realm 在测试里跑在**宿主 global** 上（`installGlobals` 仅在 worker 里为 true），所以模块内未限定的 `process` 在测试中是**宿主的 process**（有 openssl）；真实 Worker 里 `process` 就是 realm 自己的 shim（无 openssl）。测试里就一次临时把 `globalThis.process` 换成 shim 来跑真短路径，`finally` 还原。

**验证**：`tsc --noEmit` 干净 · `vitest run` **249/249**（+5）· `vite build` 绿（worker 652KB → ~653KB）。

**涉及文件**：`tools/vendor.mjs`、`vendor/node-lib/internal/util/types.js` + MANIFEST、`src/node-runtime/bindings/types.ts`、`src/node-runtime/builtins/{util.ts,internal-shims.ts,vendored-builtins.ts,index.ts}`、`test/internal-util-types.test.ts`、`README.md`/`README_zh.md`、`docs/superpowers/specs/2026-09-17-web-node-design.md`。

### 2026-09-20 · M20 真 `string_decoder`（把 `src/string_decoder.cc` 搬成 JS）

**目标**：上一轮的“继续 vendoring”把 `string_decoder` 标为“差一个 native decoder binding”。这轮把它做掉：真 `lib/string_decoder.js` 直接跑，删自研实现。

**改了什么**

1. **新 `src/node-runtime/bindings/string_decoder.ts`**：`src/string_decoder.cc` 的逐字节移植。它维护一段小 native 状态 buffer（`state[0..4)` 不完整字符缓冲 / `state[4]` missingBytes / `state[5]` bufferedBytes / `state[6]` encodingField），导出 `encodings`（顺序 = encoding 码）、字段偏移常量、`kSize`、`decode(state, view)`、`flush(state)`。字段布局照 `src/string_decoder.h`，encoding 码照 `InitializeStringDecoder`。
2. **换真源码**：`lib/string_decoder.js` vendor（MANIFEST 38 → **39**），删掉自研 `src/node-runtime/builtins/string_decoder.ts`（及其在 `builtins/index.ts` 的注册）。
3. **`internal/util` 对齐 Node**：`normalizeEncoding` 从“nginx 式 toLowerCase”改成 Node 真的 `slowCases` 分支；新增 `encodingsMap`（从 `internalBinding('string_decoder').encodings` 构建）。真 `string_decoder.js` 靠这两个把 encoding 名归一到 canonical 再存数字码。
4. **新测试 `test/string-decoder.test.ts`**（12 条）：覆盖所有编码、跨 chunk 多字节 UTF-8（€ 拆 2+1、emoji 拆 2+2 与 1+3）、U+FFFD 回退、base64/base64url 回吐 1–2 字节、utf16le 奇数字节、任意 ArrayBuffer view、`ERR_UNKNOWN_ENCODING` / `ERR_INVALID_ARG_TYPE`、以及遗留的 `lastChar`/`lastNeed`/`lastTotal`/`text()`。期望值全部先跑真 Node v26.9.0 取。

**为什么**：`string_decoder` 是“纯 JS 层靠 native 层”的又一范式——真 `lib/string_decoder.js` 只是薄薄一层，native 部分（一个状态机）换 JS 重写后，真源码就能原样拉过来。

**验证**：`tsc --noEmit` 干净 · `vitest run` **244/244**（+12）· `vite build` 绿（worker 645KB → ~652KB）。

**涉及文件**：`tools/vendor.mjs`、`vendor/node-lib/string_decoder.js` + MANIFEST、`src/node-runtime/bindings/{string_decoder.ts,index.ts,misc.ts}`、`src/node-runtime/builtins/{internal-shims.ts,vendored-builtins.ts,index.ts}`、`test/string-decoder.test.ts`、`README.md`/`README_zh.md`、`docs/superpowers/specs/2026-09-17-web-node-design.md`。

### 2026-09-20 · M19 再拉一批 vendored 真源码（`punycode` / `domain` / `diagnostics_channel`）

**目标**：继续拉闸——把那些“纯 JS、只坐在我们已经提供的 shim 上”的顶层模块换成 Node 真源码，而不是自研近似实现。

**改了什么**

1. **新 vendor 三个文件**：`lib/punycode.js`（**零 native 依赖**，只读 `internalBinding('util').isInsideNodeModules`）、`lib/domain.js`（坐在 `events` + 真 `async_hooks` + `internal/async_hooks` 的 `useDomainTrampoline` 上）、`lib/diagnostics_channel.js`（坐在真 `async_hooks` 上；`TracingChannel` 直接用 `AsyncLocalStorage`）。MANIFEST 35 → **38**。
2. **新 `diagnostics_channel` binding**（`bindings/misc.ts`）：只做 native 层真正提供的那点东西——一个可写的 `subscribers` 数组（JS 侧按 index 增减）、`notifyChannelActive/Inactive`（个 Set 记账）、`linkNativeChannel`（本 tab 无 native addon，接受回调但不链接任何东西）。
3. **补 shim**：`internal/util` 加 `WeakReference`（`domain` 用它做 ref-counted 弱引用）；`internal/util/types` 加 `isPromise`（`diagnostics_channel` 判断订阅结果是否要 await）。
4. **新增 `test/vendored-modules.test.ts`**（5 条）：punycode 编解码 + 导出面；domain `run` 错误路由 + 方法/导出面；diagnostics_channel 订阅发布 + `hasSubscribers` + **`tracingChannel` 的 start/end**（这条需要真 async_hooks 才能过）。期望值全部先跑真 Node v26.9.0 取得。

**为什么**：M17 把真 `async_hooks` 接进来后，`domain` 和 `diagnostics_channel` 这两个一直“望而却步”的模块突然只需一个小 binding。M19 正好验证了这条路径：**先拉真 native 层（async_wrap），依赖它的纯 JS 模块就一个个能原样拉过来**。

**验证**：`tsc --noEmit` 干净 · `vitest run` **232/232**（+5）· `vite build` 绿（worker 597KB → ~645KB）。

**涉及文件**：`tools/vendor.mjs`、`vendor/node-lib/{punycode,domain,diagnostics_channel}.js` + MANIFEST、`src/node-runtime/bindings/{misc,index}.ts`、`src/node-runtime/builtins/{internal-shims,vendored-builtins}.ts`、`test/vendored-modules.test.ts`、`README.md`/`README_zh.md`（新增“Vendored 真源码现状”一节）、`docs/superpowers/specs/2026-09-17-web-node-design.md`。

### 2026-09-20 · M18 真框架跑起来（Vue 3 SFC，Vite 在页内编译）

**目标**：把 DEVLOG「下一步」里的“前端生态验证”做成真东西——不再只是“能跑 Vite”，而是让页内 Vite 真的编译并驱动一个 **Vue 3 单文件组件**应用。

**改了什么**

1. **demo 的站点换成真 Vue SFC**：`site/src/App.vue` 是 `script setup` + `template`（一个 `ref` 计数器 + `defineProps`），`site/src/main.js` 用 `createApp(App, { greeting })` 挂载，并保留 `import.meta.hot.accept('./message.js', ...)` 一段——改 `message.js` 会**重挂载**拿到新 greeding，而不是整页刷新。
2. **Vite 构建 / dev 都挂上 `@vitejs/plugin-vue`**：`Vite build` → 真 Vue 生产 bundle（产物含 Vue 运行时 + 编译后的渲染函数）；`Vite dev` → 在预览里跑真实可交互的 Vue 应用（计数器可点）、且 HMR 生效。
3. **demo 依赖表加 `vue` / `@vitejs/plugin-vue` / `vite` / `esbuild-wasm` 等**，npm 安装后即可用。
4. **两个真坑的修复**（都写进了注释）：
   - **Vite 5.4 的依赖预打包（`optimizeDeps`）走 esbuild，而 esbuild-wasm 没有文件系统**（读文件直接 `not implemented on js`）。有框架在场时预打包是必需的，于是 `optimizeDeps: { disabled: true }`，让 Vite 跳过预打包，直接从 node_modules 供各依赖**自己的 ESM 源码**。
   - **esbuild-wasm 必须钉在 0.21 线**（`^0.21.5`）：Vite 5.4 按 esbuild 0.21 的 API 驱动它，版本不匹配会在转换时直接抛错。
5. **新增 `test/_m18.test.ts`**（可行性回归）：把 `/tmp/v18` 的 `node_modules`（vue + vite + plugin-vue + esbuild-wasm + rollup wasm）灌进 VFS，跑两条路径并断言：生产构建产物含 Vue 渲染代码（`createElementBlock`）与模板文案；dev server 把 `/src/App.vue` 按需编成 JS（响应体无 `<template>` 标签）、把 bare import 重写成 `/node_modules/vue/...`。

**为什么**：前序里程碑把 Vite 本体、dev server、HMR 一个个跑通了，但“真框架”是另一道关——SFC 编译要插件链、`<template>` 要模板编译器、运行时要有响应式。它能跑起来，才说明 vendoring / VFS / ESM loader / HMR 这一整套组合是真的够用。

**验证**：`vitest run` **227/227**（+1）· 浏览器端到端（本地 dev server + 跨源预览 iframe）：预览里 Vue 应用渲染、点按钮 `count is 0 → 3` 响应式生效、`__vue_app__` 挂载、改 `message.js` 触发 HMR 重挂载、`Vite build` 出 Vue bundle + CSS。截图已存。

**顺带**：把 `test/child-process.test.ts` 里 4 处固定 `await tick(20)` 换成“等到输出稳定”的辅助函数——固定 sleep 在并行满载时会偶发超时（本轮就偶发了一次）；断言不变，只是把等待变稳。

### 2026-09-20 · M17 真 `async_hooks`（+ 真实 async resource 的 tick / timer）

**背景**：之前在 `internal-shims.ts` 里手写了一个 `internal/async_hooks`，只有个空壳 `AsyncResource`，且 `enabledHooksExist()` 恒为 `false`。而 `async_hooks` 正好是之前一直跳过的那块——end-of-stream 里的 `AsyncContextFrame.current() || enabledHooksExist()` 分支永远只能走 false 那条。

**改了什么**

1. **新增 `async_wrap` 绑定**（`bindings/async_wrap.ts`）：把我们之前在 C++ 的那一层（`Environment::AsyncHooks`）用 JS 做出来——`async_hook_fields`/`async_id_fields`/`async_ids_stack`（typed array）、`execution_async_resources`、`constants`（`kInit/kBefore/...`，索引逐个对齐 `src/env.h`）、`Providers`（70 个 provider 名→id，照 `src/async_wrap.h` 顺序）、以及 `setupHooks`/`setCallbackTrampoline`/`setPromiseHooks`/`queueDestroyAsyncId`/`registerDestroyHook`/`pushAsyncContext`/`popAsyncContext`/`clearAsyncIdStack`。初始值对齐真 `AsyncHooks()`：`executionAsyncId=1`、`trigger=0`、`counter=1`、`defaultTrigger=-1`、`kCheck=1`。
2. **换成真源码**：`internal/async_hooks.js`、`async_hooks.js`（公开模块）、`internal/async_context_frame.js`、`internal/promise_hooks.js`、`internal/async_local_storage/{async_hooks,run_scope}.js` 全部 vendor（MANIFEST 现在 35 个文件）。删掉手写的 `internalAsyncHooksSpec` / `internalAsyncContextFrameSpec`。
3. **CJS 模块现在能拿到 `internalBinding`**：`vm.ts` 的 `CJS_PARAMS` 加上 `internalBinding`，`realm.ts` 注入 `(name) => this.internalBinding(name)`。没有这个，真 `internal/async_hooks.js` 一加载就 `internalBinding is not defined`。
4. **bootstrap 接 hook**：仿 Node 的 `lib/internal/bootstrap/node.js`，realm 一建好就 `internalBinding('async_wrap').setupHooks(require('internal/async_hooks').nativeHooks)`，这样排队的 `destroy` 能回到 JS 语义。
5. **tick / timer 变成真的 async resource**：`process.nextTick` 建 `TickObject`，`timers.setTimeout/setInterval/setImmediate` 建 `Timeout`/`Immediate`，都在排程时 `emitInit`、回调外裹 `emitBefore/emitAfter`、触发后 `emitDestroy`（tick/timer 都在 Node 的 `internal/process/task_queues.js` / `internal/timers.js` 里干这个）。这是让 `createHook` 真的能看到 tick/timer、让 `AsyncLocalStorage` 真能跨 `nextTick`/`setTimeout` 传 store 的关键。
6. **error codes**：补 `ERR_ASYNC_CALLBACK`(TypeError) / `ERR_ASYNC_TYPE`(TypeError) / `ERR_INVALID_ASYNC_ID`(RangeError)；`errors` 绑定补 `exitCodes`（`internal/async_hooks` 拿 `kGenericUserError`）。symbols 绑定补 `resource_symbol` / `trigger_async_id_symbol`。`internal/options` 的默认值补 `--async-context-frame: false`（我们走 async_hooks 版的 ALS，不开 AsyncContextFrame）。

**已知限制**（写进 README 的 Not yet）：本 tab 不插桩 V8 promise，所以 promise hooks 不触发（`promiseResolve` 不会响）；`setPromiseHooks` 会给一个可用的 stop 函数，但注册后不会真的看到 promise。

**为什么**：逻辑上这是 vendoring 的“最后一块拼图”——流、事件都换真源码后，剩下能拉的就是 async_hooks；而且真 async_hooks 带一个真 `AsyncLocalStorage`（在浏览器里跑 Node 代码时，跨异步边界的上下文本就是硬需求）。做法上也对得上 web-node 的约定：**能原样跑的 Node 源码就原样跑**，跑不了的 native 层（这里叫 `async_wrap`）自己用 JS 补，并在 MANIFEST 里溯源。

**涉及文件**

新增：`src/node-runtime/bindings/async_wrap.ts`、`vendor/node-lib/{async_hooks.js,internal/async_hooks.js,internal/promise_hooks.js,internal/async_context_frame.js,internal/async_local_storage/*}`、`test/async-hooks.test.ts`（6 条，期望值先跑真 Node v26 取得）。修改：`tools/vendor.mjs`、`src/node-runtime/bindings/{index,misc}.ts`、`src/node-runtime/vm.ts`、`src/node-runtime/realm.ts`、`src/node-runtime/runtime.ts`、`src/node-runtime/builtins/{index,internal-shims,timers,process,vendored-builtins}.ts`、`src/demo-project.ts`。

**验证**：`tsc --noEmit` 干净 · `vitest run` **226/226**（+6）· 浏览器端到端 demo：`async_hooks: init:TickObject / init:Timeout / tick={"user":"tang"} / timer={"user":"tang"}`、`als outside : undefined`。

### 2026-09-20 · oracle 切到 fnm Node v26.9.0

**目标**：M16 发现 vendored 真源码是 **Node v26.9.1-dev**，而旧实测基准是 fnm **v22.19.0**（非同一版本）。统一基准。

**做了什么**
- `fnm install 26.9.0`（最新发行版；距 vendored checkout 的 `v26.9.0-1-g7a3437d` 只差一个 commit）。
- 实测比对 v26.9.0 vs v22.19.0 vs vendored：
  - **EOF `readable` 事件次数**：v26 = `1` / v22 = `2` / vendored = `1` ✅
  - HWM 背压 `write` 返回值：v26 `true,true,false,false, needDrain=true` — 与测试期望一致
  - `getDefaultHighWaterMark()` = 65536 / obj = 16；`_readableState.readable` = `undefined`；`finished()` 无 callback → `ERR_INVALID_ARG_TYPE`；`Readable.from(array).toArray()` 保类型
- 结论：**vendored 源对 Node 26 忠实**，v26.9.0 可当新基准。

**为什么** 基准与真源码版本不一致会让「断言对齐」变得含糊（到底对不对得上 Node）。现统一到 v26.9.0。

**涉及文件**：`docs/DEVLOG.md`、`README.md`、`README_zh.md`（开发说明改用 v26.9.0 路径；附注 v22.19.0 仍保留）。测试无需改动（断言本就是 v26 行为）。


### 2026-09-20 · M16 整套 stream 换成真 Node 源码

**目标**：把 M15「下一步」第 1 项做完——不再手写 stream，整个 `stream` 模块直接用 Node 的源码。

**改了什么**

1. **新 vendor 11 个文件**：`stream.js`、`stream/promises.js`、`internal/streams/{writable,duplex,transform,passthrough,pipeline,compose,operators,duplexpair,duplexify}.js`（manifest 18 → **29** 个文件）。
2. **删除自写 `src/node-runtime/builtins/stream.ts`**（~1650 行）：公开 `stream` / `node:stream` / `stream/promises` / `node:stream/promises` 现在就是真源码。
3. **补齐 shim**：`internal/abort_controller`（转发全局 `AbortController`/`AbortSignal`）、`internal/buffer`（`FastBuffer` = 本运行时的 `Buffer`，保 `Buffer.isBuffer()` 不变）、`internal/util/types`（`isArrayBufferView`/`isUint8Array` 等）、`internal/assert`、`internal/blob`（`isBlob`）；`internal/util` 补 `assignFunctionName` + `promisify.custom`；`internal/event_target` 补 `kWeakHandler`；`internal/errors` 补 `ERR_ILLEGAL_CONSTRUCTOR` / `ERR_STREAM_ALREADY_FINISHED` / `ERR_STREAM_{CANNOT_PIPE,DESTROYED,UNABLE_TO_PIPE,WRITE_AFTER_END}` / `ERR_INTERNAL_ASSERTION` / `ERR_INVALID_RETURN_VALUE`（含 formatter）。
4. **模块加载器修一个循环依赖 bug**：`stream.js` 中途会把 `module.exports` 换成 `Stream`（legacy 的 Stream），而 `duplexpair.js` / `stream/promises.js` 又反向 `require('stream')`。`realm.ts` 的 `require` 之前只回一个快照值，看不到中途重赋值；改为保留 live 的 `module.exports` 引用（`ModuleRecord.moduleObj`），循环 require 就能拿到已赋值的部分。
5. **`process.nextTick` 改成真正独立的队列**：原来直接用 `queueMicrotask`，导致嵌套 nextTick 被排到已有 promise 微任务之后（`a,b,m,c`）；现按 Node 语义排空到尽才跑微任务（`a,b,c,m`）。
6. **child_process 生命周期事件延一个 macrotask**：虚拟 child 在 `spawn()` 里同步跑完，stdout 是订阅时回放；同步回放会落在调用方 `stdout.on('data')` 之前（此时 `resume_` 未跑、`kSync` 未清）→ 输出被缓到 `exit` 之后。改为延一个 macrotask 再订阅，顺序对齐真 Node：**spawn → data → exit → close**。
7. **http 的 outgoing 关闭 autoDestroy**：`ClientRequest` / `ServerResponse` 都是 `Writable` 子类，真 Writable 在 `finish` 后会自动 destroy → 触发 `_destroy` → 提前断开 socket（`socket hang up`）。Node 的 `OutgoingMessage` 本就是 `autoDestroy:false`，照此设。

**发现（写进下一节）**：真源码来自 `/Users/tangjianghong/Downloads/node`，而它是 **Node v26.9.1-dev**，与断言基准 fnm **v22.19.0** 不是同一版本。多数语义一致，但有可观测差异，例：v26 在没人监听时跳过 EOF 处的空 `readable` 事件（`end signals=1`，v22 为 2）。测试已按 vendored 源的真实行为写并加了版本注释。

**为什么** 自己维护一份 stream 会持续跟 Node 行为发散（增量、背压、`afterFinished`、`pipe` 错误传播……）；换成真源码后这些语义与 `stream/promises`、`operators`、`compose` 一次性对齐，也让上层（`fs`/`http`/`net`）坐的底座变成 Node 自己的。

**验证**（先跑真 Node v22.19.0 实测，v26 差异处已注明）
- 单测：**210 → 220**（新增 `test/stream-vendored.test.ts` 10 条；之前基于旧行为的断言同步修正：`stream.finished` 需 callback（promise 用 `stream.promises`）、`state.readable/writable` 为 `undefined`、HWM 边界 `write` 返回 false、EOF `readable` 次数）。
- 浏览器端到端：`stream fam : transform=DUPLEX compose=compose!`、`events : prepend then on (maxListeners=10)`、`abortsignal: AbortError / ABORT_ERR`、`pipeline : facts-upper.txt written`、`premature : ERR_STREAM_PREMATURE_CLOSE (Premature close)`。

**代价 / 取舍**：`vendored.ts` 是 eager 加载，worker **468KB → ~550KB**（整套 stream 真源码）。已在「下一步」记了改按需加载。

**涉及文件**
新增：`vendor/node-lib/{stream.js,stream/promises.js,internal/streams/{writable,duplex,transform,passthrough,pipeline,compose,operators,duplexpair,duplexify}.js}`（+ MANIFEST）；`test/stream-vendored.test.ts`。删除：`src/node-runtime/builtins/stream.ts`。修改：`tools/vendor.mjs`、`src/node-runtime/builtins/{index,vendored-builtins,internal-shims,http,child_process}.ts`、`src/node-runtime/{realm,runtime}.ts`、`test/{stream,stream-state,stream-eos,stream-destroy}.test.ts`、`src/demo-project.ts`、`README.md`、`README_zh.md`。

### 2026-09-20 · M15 换成真 `events.js`（并探清 stream 整模块替换的完整依赖）

**目标**：继续把 stream 家族换成真 Node 源码。原计划直接 vendor `internal/streams/readable.js`，而实测发现一个关键前置：

> **readable.js 直接写 `this._events = {...}` 并调 `Stream.call(this, options)`**（legacy.js → `EE.call(this)`）。它用的是 Node 真 EventEmitter 的 `_events` 存储，而我们自研的 EventEmitter 是 Map + 私有字段（`#events`）——用 `.call()` 调用会直接报 `Class constructor EventEmitter cannot be invoked without 'new'`，而 `_events` 也根本不存在。

所以这条路只能从地基开始：**先换 EventEmitter**。

**改了什么**

1. **新增真源码 `events.js`，删掉自研 `src/node-runtime/builtins/events.ts`**。公开 `events` / `node:events` 现在就是 Node 的 EventEmitter：真的 `_events` / `_eventsCount` 形状、`prependListener` 顺序、`errorMonitor`、`captureRejections`、`newListener`/`removeListener` 时序、`once`/`on` 静态辅助、`setMaxListeners`/`eventNames` 等。
2. **新增真源码 `internal/streams/add-abort-signal.js`**，并把 `stream.addAbortSignal`（之前直接抛 `not implemented`）接到它。现在：已 aborted → 立即 `AbortError/ABORT_ERR` destroy；飞行中 abort → 同样；非 signal / 非 stream 参数报真 `ERR_INVALID_ARG_TYPE`。
3. **新增 vendored 前置**：`internal/streams/legacy.js`、`internal/fixed_queue.js`、`internal/streams/readable.js`。其中 **`readable.js` 已 vendor 并实测可在本运行时运行**（`new Readable()`、精确 `read(n)`、`data`/`end` 事件全对），距“成为 `stream.Readable`”只差把它所在的整块一起换掉（见下一步）。
4. **新增/补齐 shim**：`internal/options`（`getOptionValue`）、`internal/util/debuglog`（恒返回禁用态的 logger，**不调用回调**，与 Node 一致）、`internal/util/inspect`、`internal/event_target`、`internal/events/symbols`、`internal/streams/compose`（显式抛未实现）、`internal/webstreams/adapters`、`internal/streams/iter/*`；`internal/util` 补 `spliceOne`；`internal/errors` 补 `ERR_UNHANDLED_ERROR`、`ERR_METHOD_NOT_IMPLEMENTED`、`ERR_UNKNOWN_ENCODING`、`ERR_STREAM_PUSH_AFTER_EOF`、`ERR_STREAM_UNSHIFT_AFTER_END_EVENT`、`ERR_STREAM_ITER_MISSING_FLAG` 与 `genericNodeError` / `kEnhanceStackBeforeInspector`。

**为什么**

- 自研 EventEmitter 是底座：`fs`/`http`/`net`/`child_process`/`stream` 全都坐在它上面。换成真源码后，所有事件语义（包括 `captureRejections` 这类微妙的）自动对齐 Node，且是后续 vendor `readable.js`/`writable.js`/`net.js` 的硬前置。

**代价 / 取舍**

- `vendored.ts` 用 eager `import.meta.glob`，所以每个 vendor 文件都进 bundle。M15 后 worker 从 ~357KB 长到 **~468KB**（events.js 36KB + readable.js 62KB + 几个小文件）。readable.js 目前是“已就绪未接入”，這 62KB 暂时是预付成本；已在「下一步」里记了把它改按需加载的选项。

**验证**（期望值全部先跑真 Node v22.19.0 实测）

- 单测：193 → **210**（新增 `test/events.test.ts` 10 条、`test/stream-add-abort-signal.test.ts` 4 条、`test/vendored-readable.test.ts` 3 条）。
- 浏览器端到端（本机 5199 + Chrome CDP）打印：`events     : prepend then on (maxListeners=10)`、`abortsignal: AbortError / ABORT_ERR`。

**踩坑**

- 又踩了「模板字面量内禁反引号」：给 `src/demo-project.ts` 的 `index.js` 模板加注释时写了 `` `events` ``，导致 TS 把后面的模板全解析错（报一串 `';' expected`）。已记入 MEMORY。

**涉及文件**

新增：`vendor/node-lib/events.js`、`vendor/node-lib/internal/streams/legacy.js`、`internal/streams/add-abort-signal.js`、`internal/streams/readable.js`、`internal/fixed_queue.js`（+ MANIFEST）；`test/events.test.ts`、`test/stream-add-abort-signal.test.ts`、`test/vendored-readable.test.ts`。删除：`src/node-runtime/builtins/events.ts`。修改：`tools/vendor.mjs`、`src/node-runtime/builtins/vendored-builtins.ts`、`src/node-runtime/builtins/internal-shims.ts`、`src/node-runtime/builtins/index.ts`、`src/node-runtime/builtins/stream.ts`、`src/demo-project.ts`。

### 2026-09-20 · M14 接真源码 `internal/streams/end-of-stream.js`

**目标**：把 DEVLOG「下一步」第 1 项做完——`finished()` 手写版换成 Node 的真实现。同时把 `destroy.js` 留下来的三块 shim 缺口（`async_hooks` / `async_context_frame` / `events/abort_listener`）补上。

**改了什么**

1. **新增真源码 `internal/streams/end-of-stream.js`**（`npm run vendor`，manifest 12 → **13** 个文件）。它导出 `eos` / `finished` / `kEosNodeSynchronousCallback`。
2. **`finished()` 直接委派给 vendored `eos`/`finished`**（`stream.ts`）。公共签名改成 Node 的 `finished(stream[, options], callback)`：带回调返回 `cleanup()`，否则返回 Promise；`stream/promises.finished` 也接受 `options`。
   - 于是现在真支持 **options 对象**：`readable:false` / `writable:false` / `error:false` / `signal`。
   - `signal` → 用 **真 AbortSignal**：已 aborted 立即报错，飞行中 abort 也报错，错误都是 `AbortError` / `ABORT_ERR`。
3. **新增三块 internal shim**（`internal-shims.ts`）：
   - `internal/async_hooks`：`enabledHooksExist()` 永远 false，`AsyncResource` 退化为同步直调（正是真源码在 hooks 关闭时走的那条分支）。
   - `internal/async_context_frame`：`current()` 永远 undefined。
   - `internal/events/abort_listener`：按 Node 契约写（针对宿主原生 `AbortSignal`），返回带 `Symbol.dispose` 的对象。
4. **接回 pipeline**：`pipeline()` 本来就调 `finished(last)`；现在这条路径也走真源码（源出错→目的端被 destroy 的语义保持）。
5. 删掉 `stream.ts` 里手写的 `finished` 及其辅助 `prematureClose`/`erroredOf`。

**为什么**

- 手写版有个真 bug：`finished(stream, opts)` 会把 `opts` 丢掉（只收 `cb`），导致 `signal`/`readable:false` 完全不生效。接真源码后这个类问题一次性消失。
- end-of-stream 是 `pipeline`/`stream/promises` 的公共地基，换成真实现后错误传播、半关闭判定、中止语义全部对齐 Node。

**验证**（期望值全部先跑真 Node v22.19.0 实测）

- 单测：183 → **193**（新增 `test/stream-eos.test.ts` 10 条：已结束/已 end、`readable:false`、premature-close、destroy-error、飞行中/已完成 abort、cleanup、干净结束、pipeline 源错传播）。
- 浏览器端到端（本机 5199 + Chrome CDP）打印：`end-of-strm: AbortError / ABORT_ERR`、`end-of-strm: readable:false waited for the writable half`。

**涉及文件**

新增：`vendor/node-lib/internal/streams/end-of-stream.js`（+ MANIFEST）、`test/stream-eos.test.ts`。修改：`tools/vendor.mjs`、`src/node-runtime/builtins/vendored-builtins.ts`、`src/node-runtime/builtins/internal-shims.ts`、`src/node-runtime/builtins/index.ts`、`src/node-runtime/builtins/stream.ts`、`src/demo-project.ts`。

### 2026-09-20 · M13 接真源码 `internal/streams/destroy.js` + `finished()` 用真谓词

**目标**：把 DEVLOG「下一步」里的第 1 项做完——流的状态形状（M12）已经对齐，现在把**真实的 destroy 链**接进来。

**改了什么**

1. **新增真源码 `internal/streams/destroy.js`**（`npm run vendor`，manifest 现有 12 个文件）。它导出 `destroy` / `undestroy` / `errorOrDestroy`，是 Node 自己生命周期管理的实现。
2. **`[kState]` 位域适配层**（`stream.ts`）：vendored destroy 不再藏在 `#private`，而是把 `_readableState`/`_writableState` 上那个 symbol 键控的位域（`kDestroyed`/`kClosed`/`kCloseEmitted`/`kErrorEmitted`…）做成**读写视图**：读时由实时字段重算，写时把生命周期位折回字段。这样 `w[kState] |= kDestroyed` 这种真源码写法能直接驱动我们的流，不需要第二份事实源；构造期常量（`kObjectMode`/`kAutoDestroy`/`kEmitClose`/`kConstructed`）和错误对象本身仍归我们所有。
   - 为此给两个 state 视图补上必要的**可写属性**（Node 的 state 是可变对象）：`errored`/`destroyed`/`closed`/`closeEmitted`/`errorEmitted`/`constructed`，以及 `undestroy` 会重置的 `reading`/`ended`/`endEmitted`（readable）与 `ending`/`finished`/`finalCalled`/`prefinished`（writable）。
3. **`destroy()` 改走真源码**：`Readable`/`Writable`/`Duplex` 的 `destroy()` 不再是手写的“置位 + defer 发射”，而是 `streamDestroy.destroy.call(this, err)`。顺序仍严格是 **nextTick 里先 `error` 后 `close`**（`emitErrorCloseNT`），且 `destroy()` 同步就把 `destroyed`/`closed`/`errored` 置好、但一帧不发射——与真 Node 逐条对上。
4. **`_undestroy()`**：`destroy.js` 的重置函数落在 `Readable.prototype`/`Writable.prototype`（Node 的受保护名，`net.js` 会调），可把已销毁的流重新置活。
5. **`finished()` 用真谓词重写**：不再只是听到 `end`/`finish`/`close` 就 resolve。现在它：
   - 用 `isReadableFinished`/`isWritableFinished`/`isDestroyed`/`willEmitClose` 判断“已完成”；
   - 已完成的流在**下一 tick** 异步回调（对齐 Node 的 immediate result）；
   - `close` 早于两半完成时，报真 `ERR_STREAM_PREMATURE_CLOSE`（除非是带错误的 destroy，那就报那个错误）；
   - **回调形式返回真正能用的 `cleanup()`**（移除自己挂的监听器）——修掉 DEVLOG 里记的“返回 no-op”遗留。
6. **公开谓词补齐**：`stream.isDestroyed` 现在与 Node 一致地导出（公开谓词就是 `isDestroyed`/`isDisturbed`/`isErrored`/`isReadable`/`isWritable` 五个）。
7. **`internal/errors` 补码**：`ERR_MULTIPLE_CALLBACK`、`ERR_STREAM_PREMATURE_CLOSE`（destroy.js/end-of-stream.js 需要）。

**为什么**

- destroy 是流生命周期里最容易写错的部分（重入、错误聚合、close 只发一次、半关闭）；用真源码能一次性把这些边界拉齐。
- `finished()` 之前把“提前关闭”当正常结束，会把真错误吞掉；现在能区分“正常结束”与“被提前关掉”。

**验证**（期望值全部先跑真 Node v22.19.0 实测）

- 单测：173 → **183**（新增 `test/stream-destroy.test.ts` 10 条：destroy 顺序/幂等/同步标志、`isDestroyed`、`_undestroy` 重置、`finished` 的 premature-close / destroy-error / cleanup / 干净结束）。
- 浏览器端到端（本机 5199 + Chrome CDP）打印：`destroy sync: destroyed=true closed=true errored=boom`、`destroy async: error:boom then close (isDestroyed=true)`、`premature  : ERR_STREAM_PREMATURE_CLOSE (Premature close)`。

**涉及文件**

新增：`vendor/node-lib/internal/streams/destroy.js`（+ MANIFEST）、`test/stream-destroy.test.ts`。修改：`tools/vendor.mjs`、`src/node-runtime/builtins/vendored-builtins.ts`、`src/node-runtime/builtins/internal-shims.ts`、`src/node-runtime/builtins/stream.ts`、`src/demo-project.ts`。

### 2026-09-20 · M12 对齐流状态形状 + 接真源码谓词

**背景**：`Readable.from` 用的是真源码，但它只是冰山一角。Node 的 `internal/streams/utils.js`（`isReadable`/`isWritable`/`isDisturbed`/`isErrored`/`isDestroyed`…）全部建立在 `_readableState`/`_writableState` 之上；我们的流把这些状态藏在 `#private` 字段里，外界看不到，所以只能自己手写鸭子类型谓词。这一步先把状态形状对齐 Node，再接真谓词。

**改了什么**

1. **流状态对外可见**（`stream.ts`）：`Readable` 新增 `_readableState`，`Writable` 新增 `_writableState`，两者都是**身份稳定**的视图对象，属性用 getter 实时读内部状态（与 Node 一致：`r._readableState === r._readableState`）。字段包括 `objectMode`/`highWaterMark`/`buffer`/`length`/`ended`/`endEmitted`/`destroyed`/`closed`/`errored`/`errorEmitted`/`autoDestroy`/`emitClose`/`readable`/`dataEmitted` 等。
2. **公开 getter 对齐 Node**：`readable`（改为访问器：destroy/error/end 后为 false）、`readableEnded`、`readableAborted`、`readableDidRead`、`readableEncoding`、`readableBuffer`、`errored`、`closed`、`writableEnded`（Node 语义是 **end() 已调用**，即 kEnding，非 finish）、`writableFinished`、`writableCorked`、`writableAborted`、`writableBuffer`、`writableErrored`。`destroyed` 补上 setter（`http`/`net` 会手动置位）。
3. **新增错误/数据追踪**：`#dataEmitted`（`readableDidRead`/`isDisturbed` 依赖）、`#errored`/`#errorEmitted`、writable 的 `errorEmitted`、`finishEmitted`（`writableFinished` 真义是 finish 已发射）。`destroy()` 现在会记下错误并置 `closed`。
4. **vendoring `internal/streams/utils.js`**（11 个文件）：`stream.isReadable/isWritable/isDisturbed/isErrored` 不再是自己写的鸭子类型，而是 Node 官方谓词。

**为什么**

- 之前 `stream.isReadable(x)` 只是 `typeof x.read === 'function'`：已结束的流仍报 `true`，没有 `isDisturbed`/`isErrored`，与 Node 差异大。
- 状态形状是后续接真 `readable.js`/`writable.js`（需 kState 位域）的先决条件；先把外部可见契约（`_readableState`）立对。
- `writableEnded`/`writableFinished` 语义错位（之前 `writableEnded` 返回的是 finish 后的值）已修正。

**涉及文件**

新增：`vendor/node-lib/internal/streams/utils.js`（+ MANIFEST）、`test/stream-state.test.ts`（9 条，期望值全部来自真 Node v22 实测）。修改：`tools/vendor.mjs`、`src/node-runtime/builtins/vendored-builtins.ts`、`src/node-runtime/builtins/stream.ts`、`src/demo-project.ts`。

**验证**：`tsc --noEmit` 干净 · `vitest run` **173/173** · 浏览器端到端：`predicates : live isReadable=true / ended isReadable=false isDisturbed=true`。

### 2026-09-20 · M11 修两个 stream 核心 bug + `Readable.from` 改用真源码

**背景**：继续扩大 vendoring，目标是 `Readable.from`。量真 Node 基准时反而搜出两个真 bug（用手写实现时的实现缺陷），先修 bug 再接真源码。

**改了什么**

1. **修：`_read()` 里同步 `push()` 会无限递归 / 重复发块（runaway）**。
   - 复现：`new Readable({ read(){ this.push('x'); this.push(null); } })`。旧实现 `push() -> #drain() -> #maybeRead() -> _read() -> push() ...` 自递归，`on('data')` 收到上百个块（`Maximum call stack size exceeded`），`for await` 永不结束。
   - 修法：给 `#drain()` 加**重入锁 `#draining`** + 内层进度循环（`stream.ts`）：同步 push 只把数据放回 buffer，由外层同一趟循环读取；旧代码靠 `#reading` 标志防重入，但 `push()` 会在调 `#drain()` 前清掉它，所以拦不住。
   - 现在是：该源只产出 **1 个块**，`end` 正常触发。

2. **修：异步迭代器不在 `error` 时 reject（会变成未捕获异常）**。
   - 旧 `[Symbol.asyncIterator]` 只监听了 `data`/`end`。`destroy(err)` 经 `defer` 发射 `'error'` 时无监听者 → EventEmitter 直接抛出 → 变成 uncaught（在 `for await` 里表现为挂死）。
   - 修法：加 `once('error')` 监听，把挂起的 `next()` reject，并让后续 `next()` 也 reject。这正是 `for await` 的错误通道。

3. **`Readable.from` 改用 Node 真源码**（`vendor/node-lib/internal/streams/from.js`，`npm run vendor` 生成，manifest 现有 10 个文件）。它只用 `Readable` 公开 API，所以能直接落位。相比旧手写版：
   - **字符串 / Buffer 是整个一块**（旧版把 `'abc'` 拆成 `'a','b','c'`、把 Buffer 拆成逐字节数字）。
   - **`null` 值抛 `ERR_STREAM_NULL_VALUES`**（旧版把 `null` 当 EOF 静默结束）。
   - **`destroy()` 会调 `iterator.return()`**：async generator 的 `finally` 会跑，资源能释放（旧版不调）。
   - **非可迭代入参抛 Node 原文案**：`The "iterable" argument must be an instance of Iterable. Received null / type number (42)`。

4. **`internal/errors` 保真度**（`internal-shims.ts`）：
   - `ERR_INVALID_ARG_TYPE` 改用 Node 的完整构造算法（`type`/`an instance of`/`one of ...`/Received 描述），新增 `ERR_STREAM_NULL_VALUES`。
   - validators 改为传**原始值**（而非 `typeof` 字符串），于是报错与 Node 一致（如 `must be of type string. Received type number (5)`）。
   - `AbortError` 对齐 Node：`name = 'AbortError'`、默认 message `The operation was aborted`。

**为什么**

- 第 1、2 个是真 bug：`read(){ push(x); push(null) }` 是最常见的自定义 Readable 写法；流内错误不可捕获会让任何 `for await` 崩。
- `Readable.from` 是高使用率 API，且旧实现有多个可观测差异（分块数、null、generator 清理）。
- 错误文案/类型是对外契约，用真源码后必须把 errors 层对齐。

**涉及文件**

新增：`vendor/node-lib/internal/streams/from.js`（+ MANIFEST）、`test/readable-from.test.ts`（8 条）。修改：`tools/vendor.mjs`、`src/node-runtime/builtins/vendored-builtins.ts`、`src/node-runtime/builtins/internal-shims.ts`、`src/node-runtime/builtins/stream.ts`、`src/demo-project.ts`。

**验证**：`tsc --noEmit` 干净 · `vitest run` **164/164** · 浏览器端到端：`hwm default : 65536 bytes / 16 objects`、`from(string): 1 chunk(s) -> ["abc"]`。

### 2026-09-20 · M10 扩大 vendoring：真源码 `internal/streams/state.js` 接管 highWaterMark

**目标**：开始把手工 TS 实现换成 **Node 真源码 + shim**（DEVLOG「下一步」第 1 项）。选 `internal/streams/state.js` 作第一个，因为它是纯 JS（零 `internalBinding`、零外部依赖，只需 `internal/errors`/`internal/validators`/`primordials`）且语义可观测。

**改了什么**

- **vendor `internal/streams/state.js`**（`tools/vendor.mjs` 新增一项，`npm run vendor` 重生成，manifest 现有 9 个文件）。注册为 builtin `internal/streams/state`（`origin: 'node-source'`），依赖 `internal/errors` + `internal/validators`。
- **`stream` 的 highWaterMark 改由真源码计算**：删掉手写的 `DEFAULT_HWM = 16*1024` / `OBJECT_HWM = 16`，改用 vendored 的 `getHighWaterMark(state, options, duplexKey, isDuplex)`。因此：
  - **默认值对齐 Node v22**：byte 模式 **65536**（之前写死 16384）、object 模式 **16**。
  - **支持 Duplex 的 per-side 键**：`readableHighWaterMark` / `writableHighWaterMark`，以及 `readableObjectMode` / `writableObjectMode`（普通 `Readable`/`Writable` 会忽略对面那个键，与 Node 一致）。
  - **校验对齐**：非法 hwm（负数/小数）抛 `ERR_INVALID_ARG_VALUE`。
- **公开 `stream.getDefaultHighWaterMark` / `stream.setDefaultHighWaterMark`**（真 Node 22 已有）。
- **`read(n)` 的 hwm 增长**（关闭 M8 遗留项）：`read(n)` 当 `n > hwm` 时把 hwm 提升到 **下一个 2 的幂**（`computeNewHighWaterMark`，上限 1 GiB 否则 `ERR_OUT_OF_RANGE`）。例：`read(100000)` → hwm 变 131072。
- **错误类的类型对齐**（`internal-shims.ts`）：Node 的 `ERR_*` 类继承对应的内建类型并保留其 `name`，code 只在 `.code` 上。现在 `new Readable({highWaterMark:-1})` 抛的是 **`TypeError`**（`instanceof TypeError` 成立，`constructor.name === 'TypeError'`，`.code === 'ERR_INVALID_ARG_VALUE'`），消息为 Node 原样的 `The property 'options.highWaterMark' is invalid. Received -1`（带点路径叫 `property`，否则叫 `argument`）。

**为什么**

- 默认 hwm 16384 vs 真 Node 65536 是真差异：会直接影响背压时机与吞吐，任何依赖“默认 hwm”的库都会算错。
- Duplex 的 per-side 键目前完全不生效（静默忽略），是常见写法（`new Duplex({ readableObjectMode: true })`）。
- 错误类型/文案也是对外契约（`instanceof TypeError`、`.code`、文案）。
- 用真源码而不是继续手写，是 vendoring 路线的第一块试金石：证明「纯 JS 模块直接 vendor + 注册」的管道通了。

**涉及文件**

新增：`vendor/node-lib/internal/streams/state.js`（+ MANIFEST 更新）、`test/stream-hwm.test.ts`（6 条）。修改：`tools/vendor.mjs`、`src/node-runtime/builtins/vendored-builtins.ts`、`src/node-runtime/builtins/stream.ts`、`src/node-runtime/builtins/internal-shims.ts`、`src/demo-project.ts`。

**验证**：`tsc --noEmit` 干净 · `vitest run` **156/156** · `vite build` 绿（worker ~313KB）· 浏览器端到端：`hwm default : 65536 bytes / 16 objects`。

### 2026-09-20 · M9 Buffer 共享内存：`slice`/`subarray` 与 `from(ArrayBuffer)` 不再拷贝

**目标**：把 Buffer 的视图语义对齐真 Node（v22 实测），这是 DEVLOG「下一步」第 2 项。

**改了什么**

- **`slice` / `subarray` 返回共享内存的视图**：改为 `new Buffer(this.buffer, byteOffset, length)`（即在底层 ArrayBuffer 上开窗口），而不是之前的拷贝。写入视图会回写到原 Buffer，反之亦然；`slice` 与 `subarray` 行为一致（与 Node 相同，两者都是 view）。越界/负索引的夹取仍由 `Uint8Array.prototype.subarray` 负责。
- **`Buffer.from(ArrayBuffer[, offset[, length]])` 返回视图**：不再拷贝，与 Node 一致（`Buffer.from(ab)` 改动会反映到原 ArrayBuffer）。
- **`Buffer.from(string | Buffer | Uint8Array)` 仍为拷贝**（Node 同此，保持不变）。
- **demo**：buffer 段落新增 `view shares : true`（通过 `subarray` 写回原 Buffer 验证）。

**为什么**

- 真 Node 基准（`/tmp/m9/buf.js`）逐条量出：`slice>writeThrough true` / `slice>readThrough true` / `slice>byteOffsetDelta 1` / `fromAB>shares true` / `fromAB2>shares true`，而 `fromBuf>copies true` / `fromU8>copies true`。
- 这是解析器/协议实现的核心假设：从读缓冲里切出一帧、之后复用该缓冲。若 `slice` 是拷贝，帧数据会在缓冲被覆写后“神秘地”变对/变错；若 `from(ArrayBuffer)` 是拷贝，对视图的改动会静默丢失。
- **副作用审查**：`http.ts` 的帧切分用的是原生 `Uint8Array`（`concat` 每次新建），不受影响；VFS 存的是 `Uint8Array` 并按 `.slice()` 拷贝，也不受影响。已在改动后全量回归确认。

**涉及文件**

修改：`src/node-runtime/builtins/buffer.ts`、`src/demo-project.ts`；新增：`test/buffer.test.ts`（5 条回归）。

**验证**：`tsc --noEmit` 干净 · `vitest run` **150/150**（新增 buffer 5 条）· `vite build` 绿 · 浏览器端到端：`view shares : true`。

### 2026-09-20 · M8 stream 收尾：字节精确 `read(n)` + `objectMode` 分离 + `autoDestroy`

**目标**：把 stream 里几处「近似 Node 行为」换成真语义。这些都是真 Node 与 web-node **可观测差异**，不是内部实现洁癖。

**改了什么**

- **`read(n)` 字节精确**：字节模式下 `read(3)` 从缓冲里精确切出 3 字节（需要时切碎一个 chunk 并把尾巴 `subarray` 留下），而不是交出整个缓冲 chunk。objectMode 仍然一次一个值；无参 `read()` 取走全部。
- **暂停模式由 `readable` 驱动**：新增 `#emittedReadable` / `#needReadable` 与合并延迟的 `#emitReadable()`（Node 语义：只在事件真正发出后才清标记，故一串 `push()` 只产生一个 `readable`）。`on('readable')` 现在会启动 `_read`（之前完全不会，paused 消费者永远拿不到数据）。
- **`readableObjectMode` / `writableObjectMode` 成为真实 getter**（之前是 `undefined`）。`Readable.from` 仍默认 objectMode，并且按 Node 把 `highWaterMark` 默认设为 **1**（惰性，不被无界 source 撑爆）。
- **objectMode 的 writable 不再把字符串重编码成 Buffer**：`decodeStrings` 在 objectMode 下强制为 false（Node 同此），所以 `w.write('str')` 交到 `_write` 的是字符串本身。
- **`autoDestroy`（默认开）**：`end`/`finish` 之后关闭流，且 `close` 触发时 `destroyed === true`（`end` 触发时仍为 `false`——与 Node 顺序一致）。用一个 `WeakMap` 注册表记录「读端/写端是否已完成」，**Duplex 要两端都完成才关**，避免半关（这是之前直接 `emit('close')` 的旧行为会踩的坑）。关闭走「软关闭」：置位 `destroyed` + 发 `close`，**不重入 `_destroy`**（否则 `http.ClientRequest` 会把 socket abort 掉）；这也与旧的 `emit('close')` 行为等价。
- **字节 chunk 一律交付 `Buffer`**：真 Node v22 下 `push('ab')` / `push(Uint8Array)` 到达 `data` / `read()` 时都是 `Buffer`，所以 `chunk.toString()` 应该是「解码」而不是「列出字节」。新增 `toBuffer()`，在 `#decode` 的字节-无编码分支包装。
- **文件头过时说明更新**：原先写着「`read(n)` 不精确切分、无 objectMode 分离、无 autoDestroy」，现已不成立。
- **demo**：stream 段落新增 pull API 展示（`readable` + `read(32)` 精确读 + `autoDestroy: closed, destroyed=true`）。

**为什么**

- 一条一条都是拿真 Node 当基准量出来的：`Readable.from(...).read(3)`、`read()` 无参同步 push、`data` 的 chunk 类型（`Buffer.isBuffer`）、`w.write('str')` 在 objectMode 下到底交什么、`end`/`close` 时的 `destroyed`、`Readable.from` 的 hwm。基准程序在 `/tmp/m8/` 下跑，输出逐条对齐。
- `read(n)` 不准、paused 模式完全不工作、objectMode 把字符串转 Buffer——这些会让任何真 Node 库（解析器、协议实现、流式压缩）在页内静默算错。

**涉及文件**

修改：`src/node-runtime/builtins/stream.ts`、`test/stream.test.ts`（+9 条回归）、`src/demo-project.ts`。

**验证**：`tsc --noEmit` 干净 · `vitest run` **145/145**（stream 从 18 → 26 条）· `vite build` 绿 · 浏览器端到端：`read stream : 197 bytes in 13 chunks of <=16` / `read(32) : 197 bytes in 7 exact reads` / `autoDestroy : closed, destroyed=true`。

### 2026-09-20 · M7 进程表面：`child_process` + mini-shell + npm `.bin`/生命周期脚本

**目标**：让运行时不仅能跑「一个」程序，还能跑一个「进程树」——并让 npm 的安装钩子（postinstall 等）真正有地方可跑。

**改了什么**

- **新增 `child_process` 真实实现**（原先只是 stub）：`exec` / `execFile` / `spawn` / `spawnSync` / `execSync` / `execFileSync`。派生的一切都走受控 `ProcessHost`，不存在真 OS 进程——每个 child 是同一事件循环上的**第二个模块注册表**，有自己的 `process` 视图（argv/env/cwd/pid/stdout/stderr）与自己的管道。
- **新增 mini-shell**（`src/node-runtime/shell/sh.ts`）：支持引号、`$VAR`/`${VAR}`、`;` `&&` `||`、`|`、`>` `>>` `<` `2>`、前导 `VAR=value`、`#` 注释与内建 `cd pwd echo true false exit`。**明确拒绝**（抛 `ShellUnsupportedError`，不静默降级）`$(…)`/反引号、子 shell、进程替换、glob、后台 `&`、here-doc、`export`/`unset`。管道按阶段串行传字节。
- **新增 `ProcessHost`**（`src/node-runtime/proc/`）：`spawn`/`run`/`runSync`/`activeChildren`/`reset`，负责 pid 分配、受控环境、stdout/stderr 缓冲与重放、stdin 泵、退出结算。
- **child 生命周期判定**：入口同步返回且 spawn 前后未在 timer 队列留下工作 → 结束；或 `process.exit()`/`process.kill()`；或被 kill/超时。child 的 `setTimeout`/`setInterval`/`queueMicrotask`/`process.nextTick` 被包装，抛错归因到该 child（栈进 child stderr + 非零退出），不会拖垮整个 worker。
- **npm `.bin` shim**（`src/node-runtime/npm/bin.ts`）：把包声明的 bin 以 **JavaScript shim** 写入 `node_modules/.bin/<name>`（`chmod 0o755`）。用 JS 而非 POSIX shell，是因为 mini-shell 无法执行 shell 脚本；shim 带 `SHIM_MARKER`，`proc/command.ts` 解析时跟随 marker 指向真实入口，保证 `process.argv[1]` 是真实入口而非 shim。同名冲突保留首个并 warn。
- **npm 生命周期脚本**（`src/node-runtime/npm/scripts.ts`）：`preinstall`/`install`/`postinstall`（依赖）+ `prepare`（根项目），复用同一 spawn 面，带全套 `npm_*` 生命周期环境变量（`npm_lifecycle_event`、`npm_package_json` 等）。脚本失败记为 warning 并继续（**有意偏离** npm），`ignoreScripts` 可整体关闭。无 `host` 时跳过并 warn。
- **loader 剥离 shebang**（`src/node-runtime/loader/index.ts` 新增 `stripShebang`）：`.bin` 入口以 `#!/usr/bin/env node` 开头，直接交给 `new Function` 是语法错误——Node 对主模块会剥离，这里必须同样处理。修掉 `Failed to compile /project/node_modules/hello/cli.js: Invalid or unexpected token`。
- **`fork` 的 IPC 明确抛错**：`fork` 可启动模块，但 `send()`/`disconnect()`/`'message'` 抛 `notImplemented('api', …)`，绝不静默 no-op。
- **接线**：worker 把安装期生命周期脚本的 stdout/stderr 转发到同一个终端（`onOutput`）；UI 展示 `[lifecycle] …` 与 `[bin] node_modules/.bin: …`；demo 新增 `child_process` 段落（同步 execFileSync → 嵌套 child → 拒绝 shell 脚本 → 管道）。

**为什么**

- M6 留下的 npm 缺口正是「安装钩子」，而钩子需要一个受控的进程表面。与其零散补丁，不如把 `child_process` 一次性做成真实实现：子程序继承同一别名表（`rollup`/`esbuild` 仍指 WASM 版）、同一 VFS、同一虚拟网络，于是「node 脚本调 node 脚本」在页内天然可嵌套。
- 能做什么就明说什么：**只有 JS 能被派生**（VFS 里能的，就是能跑的）；shell 脚本按名拒绝（`ENOEXEC`），不半执行。这既诚实，也解释了为什么 npm 的 `.bin` 必须写成 JS shim。

**涉及文件**

新增：`src/node-runtime/builtins/child_process.ts`、`src/node-runtime/proc/{command,host}.ts`、`src/node-runtime/shell/sh.ts`、`src/node-runtime/npm/{bin,scripts}.ts`、`test/child-process.test.ts`。
修改：`src/node-runtime/{runtime,loader/index,errors}.ts`、`src/node-runtime/builtins/{index,unsupported}.ts`、`src/node-runtime/npm/{install,index}.ts`、`src/worker/runtime.worker.ts`、`src/client/index.ts`、`src/ui/main.ts`、`src/demo-project.ts`、`test/runtime.test.ts`。

**验证**：`tsc --noEmit` 干净 · `vitest run` **136/136**（新增 29 条 child_process 测试）· `vite build` 绿 · 浏览器端到端：`child out : spawned pid 100 in /project; its own child said 42`、`sh script : ENOEXEC`、`shell pipe : 42 (via pipe)`。

### 2026-09-17 · M6 npm 收尾：lockfile + 完整性校验 + peer 自动安装

**目标**：把 M4 留下的 npm 缺口补齐到实用程度。

**1. `package-lock.json`（lockfileVersion 3）** —— `src/node-runtime/npm/lockfile.ts`（新）
- 安装结束写入 lockfile（根条目 + 每个包的 `node_modules/<name>` 条目）；条目自带 `version / resolved / integrity / dependencies / optionalDependencies / peerDependencies(+Meta) / bin / os / cpu`，**不依赖 packument 就能重装**。
- 二次安装：已锁版本若仍满足声明范围则直接复用（跳过解析与网络）；`lockedByName()` 取“最浅路径优先”。读不到/坏 lockfile 一律忽略，不影响安装。
- 实测：二次安装日志出现 `[lock] reused 16 package(s) from package-lock.json`。

**2. 完整性校验** —— `src/node-runtime/npm/integrity.ts`（新）
- 下载后用 WebCrypto（`crypto.subtle`）校验 registry 的 `dist.integrity`（SRI，通常 sha512）；老包只有 `dist.shasum`（sha1 hex）则校 sha1。**校验在写入 VFS 之前**，不匹配直接报错。
- 任一处失败都是致命错误（不静默）；无可计算算法时返回 `undefined` 放行（兼容极老的私有 registry）。

**3. peer 依赖自动安装**（npm 7+ 行为）
- 解析时收集每个已放置包的必选 `peerDependencies`（`peerDependenciesMeta.optional` 跳过），主图完成后把**任何层级都没满足**的 peer 装到根 `node_modules`。

**4. ️ 顺带修的真问题：optionalDependencies + 平台过滤**
- 一开始把 `optionalDependencies` 全部安装，结果把 esbuild 的**全平台原生二进制全装了（61 个包）**，还把 OPFS 快照撞到很大（下次启动变慢）。
- 按 npm 语义补上 **`os`/`cpu` 过滤**：不匹配目标平台（默认 `linux`/`wasm32`，即运行时自报的平台）的可选依赖**静默跳过**（`fsevents`、`@esbuild/darwin-*` 等）。安装数回到 11。

**测试**：100 → **107**。新增：lockfile 写入形状 + 二次安装零解析（计数 packument 调用）；SRI 匹配/不匹配、shasum 回退；registry integrity 不匹配则不写入；peer 缺失自动装到根并能 `require`；可选依赖解析失败静默；跨平台可选依赖静默跳过。

**仍不在范围**（需外部能力）：生命周期脚本与 `.bin` shim（二者都要能 spawn 进程，而运行时没有 `child_process`）；`file:`/`git+`/`link:` 说明符。

**浏览器实测**：Reset → Install deps → `installed 11 package(s)`，文件树出现 `package-lock.json`；再点一次 → `[lock] reused 16 package(s)`。

**涉及文件**：`src/node-runtime/npm/{integrity,lockfile,install,registry,index}.ts`、`src/client/index.ts`、`src/ui/main.ts`、`src/demo-project.ts`、`test/npm.test.ts`

### 2026-09-17 · M5f HMR 收尾：CSS 更新 + 通道按端口隔离

**目标**：把 M5e 的 HMR 补齐两处——CSS 热更（`css-update` 路径）与多端口隔离（两个 dev server 不能串台）。

**1. CSS HMR**
- site 新增 `src/style.css` 并在 `main.js` 里 `import './style.css'`；新增 **🎨 HMR CSS** 按钮（`hmrCssEdit()`）按调色板循环改写 `style.css`。
- 验证：`getComputedStyle(#app).color` 从 `rgb(94,241,165)` 原地变为 `rgb(124,196,255)`（`#7cc4ff`），**无 reload**（marker 存活）。Vite 直接走 `css-update` / `updateStyle` 路径，运行时照搬即可。

**2. 多端口隔离**
- 通道名从固定 `web-node-hmr` 改为 **按端口** `web-node-hmr:<port>`。SW 注入 shim 时已知预览端口，因此把 `PORT` 写进 shim；运行时桥用同一规则拼名（两边必须保持一致）。
- 子域名预览是**跨源**，shim 无法用 BroadcastChannel，仍经 `window.top` 中继；帧里新增 `port` 字段，主页面的 `installHmrRelay` 据此**按端口选通道**（`channelFor(port)`），且只把 runtime 的回复推给当前显示该端口的 iframe。
- 验证：活预览在 5173 时，在页面里同时监听 `web-node-hmr:5173` 与 `web-node-hmr:5174`，触发一次编辑 → **`{5173:1, 5174:0}`**。

**3. 顺手修的 UX/真实 bug**
- **端口自动发现**：`listen()` 启动的服务器会让 `client.run` 永不 resolve（不退回），以前端口下拉要手动 Refresh。新增 `startPortWatch()`（每 1.5s 轻量 `describe()`），端口集合变化才刷新 → 启动 dev server 后预览自动出现（也顺便保证 `hmrRelay.follow(port)` 被调用）。
- **`hmred` 反引号陷阱又中一次**（在 `demo-project.ts` 内嵌的 `vite-dev.mjs` 注释里）。同一条约定再现：内嵌源码字符串禁用反引号 / `${` / 反斜杠。

**测试**：仍 **100/100**（本里程碑为集成行为，主要靠 `tools/e2e-subdomain-hmr.mjs` 端到端验证）。

**线上验证（GitHub Pages / 路径前缀模式）**：`npm run deploy` 后跑 `tools/e2e-pages-hmr.mjs`——预览 src 为 `https://mcuking.github.io/web-node/preview/5173/`；JS HMR 原地变 `#1`、CSS 颜色 `rgb(94,241,165)` → `rgb(124,196,255)`，两次 marker 均存活。同源模式下 shim 直接用 BroadcastChannel（不经中继），验证了两条路径。

**新增验证工具**：`tools/e2e-subdomain-hmr.mjs` 扩到 JS+CSS 两阶段（含端口发现、每步超时、SW 重注册）；`tools/probe-hmr-ports.mjs`（端口隔离计数）；`tools/e2e-pages-hmr.mjs`（线上路径前缀模式）。

**涉及文件**：`public/sw.js`、`src/demo-project.ts`、`src/ui/main.ts`、`index.html`、`README.md`、`README_zh.md`、`tools/e2e-subdomain-hmr.mjs`、`tools/probe-hmr-ports.mjs`（新）

### 2026-09-17 · M3.5d 子域名路由：每个预览一个真实源（`<port>.localhost`）

**目标**：把 M3 长期挂账的「预览走路径前缀」换成 WebContainer 形态的真源隔离——`<port>.localhost:<devport>`（浏览器把 `*.localhost` 解析到 loopback），这样绝对路径、cookie、storage 都按真实站点行为。

**方案**：runtime/VFS/OPFS 仍单例住在主源（`localhost:5199`）；子域名只托一个 bootstrap 壳，经 `postMessage` 把请求中继回主源页面。
- **dev 中间件**（`plugins/dev-subdomains.ts`，新）：拦 `<port>.localhost` 上的 `/__webnode__/`，回一个 bootstrap 壳：注册子域名 SW → 把 SW 的每个虚拟请求 `window.top.postMessage(data, '*', ports)`（MessagePort 跨源转移）→ 同源子帧 `src='/'` 加载真应用（由 worker 从 VFS 供给）。其余路径一律放行给应用。
- **`public/sw.js` 新增 SUBDOMAIN_MODE**：shell 路径（`SUBDOMAIN_SHELL_PATH`）直接放行，不当作预览资源；按 `event.clientId → port` 记账 + referrer 兜底的路由保持。
- **HMR 跨源中继**：子域名是别的源，`BroadcastChannel` 听不到。上行：app 帧 → `window.top`（=主页面）→ 主页面的 `installHmrRelay` 进 BroadcastChannel；下行：runtime → 主页面 → 壳（`previewFrame.contentWindow`）→ app 帧（壳里新增一个 `__wnHmr` 监听转发）。
- **`src/ui/preview-url.ts`**（新，纯函数）：`previewUrl()` 按环境选——dev + `base==='/'` + loopback → 子域名壳；否则回退路径前缀。`prefixPreviewUrl()` 专供 pop-out 链接。

**踩过的坑（重要，别重犯）**：
1. **被 iframe 嵌入的文档必须自带 COEP，光有 CORP 不够**。主壳是 `COEP: require-corp`，子域名壳文档必须自己也发 `Cross-Origin-Embedder-Policy: require-corp`，否则 Chrome 直接拒加载（`coep-frame-resource-needs-coep-header`，而不仅是空白）。
2. **导航请求不能被预览路由劫持**。按 `clientId→port` 兜底的路由会把主壳的**导航**抢成预览（出现 `base href=/preview/3000/` 的错页）。修复：`request.mode === 'navigate'` 直接放行。
3. **`demo-project.ts` 的反引号陷阱又中一次**（这次在 `plugins/dev-subdomains.ts` 的 bootstrap 字符串里）：注释里写 `window.top` 用了反引号，直接让模板字面量提前闭合 → dev server 编译报 `Expected ";" but found "window"`。约定重申：内嵌源码字符串里禁用反引号 / `${` / 反斜杠。
4. 调试时注意：`Runtime.evaluate` 的 **isolated world 与主世界不共享 `window`**（共享 DOM）；用 `createIsolatedWorld` 插桩，通过 script 元素跑在主世界的计数器要写到 DOM 上才能从 isolated world 读回。

**演示**：dev server 下预览 URL 变为 `http://<port>.localhost:5199/__webnode__/`。已验：3000（demo 服务器，含 `/api/info`）与 5173（Vite dev + **HMR 原地热更、marker 存活不刷新**）。构建 / Pages 仍走路径前缀（已 Regression 验证）。

**测试**：95 → **100**。新增 `test/preview-url.test.ts`（5：dev 子域名、非 loopback 回退、子路径构建回退、带 devport 原样拼接、`prefixPreviewUrl`）。

**涉及文件**：`plugins/dev-subdomains.ts`（新）、`src/ui/preview-url.ts`（新）、`test/preview-url.test.ts`（新）、`public/sw.js`、`src/client/index.ts`、`src/ui/main.ts`、`vite.config.ts`、`tsconfig.json`、`tools/e2e-subdomain-hmr.mjs`、`tools/probe-hmr-relay.mjs`

### 2026-09-17 · M5e HMR 走非 WebSocket 通道（+ 一个把 HMR 静默搞坏的 loader bug）

**目标**：在标签页里跑**真正的 Vite HMR**。障碍：HMR 跑在 WebSocket 上，而 **ServiceWorker 代理不了 WebSocket**（`fetch` 拦截不到 upgrade），浏览器经预览桥永远到不了 dev server 的 HMR 端口。

**方案：BroadcastChannel**（预览 iframe 与 runtime worker 同源）：
- **预览侧垫片**（`public/sw.js`）：SW 在注入 `<base>` 时顺带注入一段 `WebSocket` 垫片。识别信号以 **`vite-hmr` 子协议**为准（Vite 的 HMR 客户端总带它；https 页面上它还可能把首个目标设成**页面源**而非 loopback），loopback 主机名作兵兵补充；命中的改道到 `BroadcastChannel('web-node-hmr')`，其余原样交给浏览器。
- **runtime 侧桥**（`/project/vite-dev.mjs`）：造一个与 `createWebSocketServer` 返回形状一致的对象（`send/on/off/clients/close`），赋给 `server.hot` / `server.ws`。**Vite 照常计算更新，我们只负责搬运**（协议仍是 Vite 的 `connected` / `ping`-`pong` / `update` / `full-reload`）。
- **文件监听**：Vite 原生用 chokidar（要 `fs.watch` + inotify，标签页里没有）。新增 **VFS 变更订阅** + `fs.watch`，demo 里一个小插件把 VFS 事件转发进 Vite 的（noop）watcher，接入 HMR 管线。

**顺带修掉一个真 bug（不止影响 HMR）**：loader 的 ESM 转换用**全局正则**改写 `import.meta`，结果连**字符串数据**一起改了。Vite 的 dist 里有 `rawUrl === "import.meta"`，被改成了 `rawUrl === "({ url: __mod_url })"`（恒 false），于是 HMR 的 hot-context 注入被静默跳过。**修复**：新增长度保持的 `codeMask`（把字符串/模板原文/注释/正则的**字符内容**抹成空格），改写只落在**代码**上——任何把字面量 `"import.meta"` 当数据用的打包产物都不再被破坏。文件：`src/node-runtime/loader/esm-transform.ts`

**新增能力**：VFS `subscribe()`（`create/change/delete`）+ `fs.watch(path, opts, cb)`（目录监听给 basename，create/delete 映射为 Node 的 `rename`、编辑映射为 `change`）。文件：`src/node-runtime/vfs/{types,memory}.ts`、`src/node-runtime/builtins/fs.ts`

**演示**：「🛠 Vite dev」现以 HMR 开启启动；新增「✏️ HMR edit」按钮写入 `site/src/message.js`，预览**原地热更新**（不整页刷新）。验证：在预览窗口挂一个变量，热更后它仍在 → 确属模块热替换而非 reload；HMR 载荷为 `js-update`（`acceptedPath:/src/message.js`）；终端可见 `vfs-change : change src/message.js`（即 VFS 事件→HMR 的全链路）。本地（dev 与 build 产物）与线上 GitHub Pages 均已验证。

**测试**：95/95（10 个文件）。新增：VFS 订阅事件序列；`fs.watch` 递归/停用；esm-transform「改写只碰代码」5 例（字符串/注释/正则/模板插值/动态 import）。

**已知限制**：HMR 客户端仍按 Vite 默认目标连接（本地为 loopback，https 下可能是页面源）；垫片按 `vite-hmr` 子协议识别并改道，对所有目标都适用。

### 2026-09-17 · M5d Vite **dev server** 在页内跑通（+ 预览路由修正绝对路径）

**目标**：不只是 `vite build`，而是 Vite 的 **dev server 编排层**——在标签页里 `createServer()` + `listen()`，按需转换模块。

**结果**：dev server 真的在运行时里起来了：`createServer({ root })` → `server.listen(5173)`，`/` 返回 200 并注入 `/@vite/client`，`/src/main.js`、`/src/message.js` 按需转换，`/@vite/client` 返回 137KB。预览 iframe 真实渲染出 `Hello from vite, bundled in the browser`。

**为什么能跑**：Vite dev server 只是「一个用到 `http`/`net`/`fs`/`dns` 的 Node 程序」。之前只有 build 路径通，dev 路径多了三处：
- **`dns` builtin（新）**：Vite 的 `buildStart` 会 `dns.promises.lookup('localhost')` 判断能否广播 `127.0.0.1`。虚拟网络里一切都在本机，所以诚实语义就是**所有主机名解析到 loopback**（`dns` / `dns/promises` 两个 spec；`lookup` 支持 callback / `all` / `family` / `verbatim`，无 callback 同步抛 `ERR_INVALID_ARG_TYPE`，查询类 API 抛 `NotImplementedError`）。文件：`src/node-runtime/builtins/dns.ts`
- **`process.stdin` 改成真 EventEmitter**：Vite `close()` 会 `stdin.off('SIGTERM'…)` 卸载监听，以前的裸对象没有 `.off` → 直接崩。文件：`src/node-runtime/builtins/process.ts`
- **移除 stub `dns`**（被真实现取代）。文件：`src/node-runtime/builtins/unsupported.ts`

**顺带修好预览路由的「绝对路径」根病**（也是 M3 遗留的已知限制）：
- Vite dev server 输出**绝对路径**资源（`/@vite/client`），还有**链式 import**（`main.js` 再 import `/src/message.js`），它们都不在 `/preview/<port>/` 前缀下，旧 SW 直接放行 → 404。
- SW 新增：**按客户端记住预览端口**（`clientId → port`）。预览文档与其所有子资源共享同一个 client id，所以导航预览时记账，之后该客户端的绝对路径请求（含链式 import）就能回路由到正确端口；referrer 作为兜底。这同时修复了 M3 长期记录的「绝对路径资源落在前缀外」。
- 修正 `resolveClient`：原直接的 `clientId` 分支会把**预览 iframe 自己**当成 runtime host（它是 Vite 页面，没有 runtime 监听器）→ 消息石沉大海 → `502 virtual server timed out`。现在两条分支都拒绝预览客户端。文件：`public/sw.js`

**演示**：「🛠 Vite dev」按钮 → `/project/vite-dev.mjs`（动态 `import('vite')` → 初始化 esbuild-wasm → `createServer` → `listen(5173)` → 常驻）。UI 新增按钮：`index.html`、`src/ui/main.ts`、`src/demo-project.ts`

**测试**：85 → **87**。新增：`process.stdin` 具备 EventEmitter 表面；`dns`/`dns/promises` 主机名解析到 loopback。把旧的「stub 模块被调用即抛」用例从 `dns` 改为 `child_process`（`dns` 已真实现）。

**已知限制 / 暂缓：HMR**。HMR 靠 WebSocket，而 **ServiceWorker 无法代理 WebSocket**（`fetch` 拦截不到 upgrade 连接），所以浏览器永远到不了 dev server 的 HMR 通道。故 demo 以 `hmr: false` 启动。要真做 HMR，需绕开 SW：让 Vite 的 HMR 走自定义通道（如 `MessageChannel`），属架构改动，暂缓。

### 2026-09-17 · GitHub Pages 部署：子路径站点 + `gh-pages` 发布

**目标**：把已实现的功能部署成在线 demo，链接写进仓库描述。

**子路径适配**（Pages 的 project site 跑在 `/web-node/`）：之前 SW 与预览路由写死 origin 根路径，搬到子路径会全挂。
- `vite.config.ts`：新增 `base`，由 `BASE_PATH` 环境变量控制（默认 `/`，部署时 `/web-node/`）。HTML 里的 script/link 与 worker 引用自动带上前缀。
- `public/sw.js`：`PREVIEW_PREFIX` 从写死 `/preview/` 改为由 `new URL('./', self.location).pathname` 推导（dev=`/`，Pages=`/web-node/`），`<base>` 注入与 client 归属判断同步。
- `src/client/index.ts`：SW 注册路径/作用域改为 `import.meta.env.BASE_URL`（`/web-node/sw.js`，scope `/web-node/`）。
- `src/ui/main.ts`：预览 URL 用 `BASE_URL` 拼。

**发布**：新增 `tools/deploy-pages.sh`（+ `npm run deploy`）——`BASE_PATH=/web-node/` 构建 → `dist/` 推到 `gh-pages` 分支（带 `.nojekyll`，临时 repo，不动主仓库）。不用 Actions。

**Pages**：仓库已设 Source = gh-pages / (root)，push 后自动重建，站点 `https://mcuking.github.io/web-node/`（强制 HTTPS）。仓库描述与 Website 字段已指向该链接。

**线上实测**：`/web-node/` 200；runtime ready（16 bindings / 8 vendored / OPFS on）；SW scope = `https://mcuking.github.io/web-node/`；Run → `/web-node/preview/3000/` 200（`<base href="/web-node/preview/3000/">`）；Install deps 11 包 8.3s；⚡ Vite build → `vite v5.4.21 (running in the tab)` · `built in 197ms`。

**注**：`vite preview` 不发送 dev 的 COOP/COEP 头，与 Pages 一致——实测证明运行时并不依赖 SharedArrayBuffer。

### 2026-09-17 · M5c 真实构建工具链：Vite 本体在页内完成 production build

**目标**：把 **Vite 本体**（不是 esbuild、不是 rollup，而是 Vite 自己）在标签页里跑起来，完整做一次 `vite build`。

**为什么难**：Vite 是纯 ESM，且 `import esbuild from 'esbuild'`（原生 addon）。两边都要处理：① 我们的 ESM→CJS 转换器必须能啃下 Vite 那种 6.7 万行的 bundle；② `esbuild`/`rollup` 需要别名到 WASM 构建（运行时已设）。

**核心改动：重写 ESM→CJS 转换器**（`src/node-runtime/loader/esm-transform.ts`）
- 从**逐行**改成**基于扫描器的顶层语句切分**（`splitStatements`）：跟踪字符串/模板字面量（含嵌套 `${…}`）/注释/正则/括号深度，只在真正的顶层 `;` 或块结束处切分。多行 `import` 和多行模板字面量是 Vite bundle 的常态，逐行处理必崩。
- **token 级关键字判断**决定 `/` 是正则还是除号（`return /re/` vs `a / b`）。判断错会让括号深度从那一刻起漂移（实测漂了 +3，末尾的 `export` 因深度不为 0 被漏掉）。
- **顶层 `export`/`import` 关键字**作为语句边界（前一条函数声明可能没有分号，会吞掉后面的 `export`）。
- ESM 包装形参改用 **`__wn_*` 前缀绑定**（`__wn_exports`/`__wn_require`），且 **不注入 `require`/`exports`/`__filename`/`__dirname`**——Vite chunk 会自己写 `const require = createRequire(import.meta.url)`、`const __filename = …`，注入同名形参会直接 `Identifier already declared`。
- 修好的真实 bug：① `export { a as b } from 'm'` 之前错误地读局部变量（应从被 require 的模块取值）；② `import.meta.url` 未转换（`new Function` 里是硬语法错误）；③ 前导 license 块注释导致 `startsWith('import')` 失效（新增 `leadTrim`）；④ **动态 `import()`** 在 `new Function` 里 V8 直接报 “A dynamic import callback was not specified” → 重写为 `__wn_import`（loader 提供的异步加载，按 `import` 条件解析）。

**其余修复（都是 Vite 真实踩到的）**
- **PathLike**：`fs.readFileSync(new URL(...))` / Buffer 路径 → 在 VFS 唯一漏斗 `resolve()` 统一归一化（`posix.toPathValue`）。文件：`vfs/posix.ts`、`vfs/memory.ts`、`vfs/types.ts`
- **`createRequire(...).resolve`**：Vite 用它把 id 映射成路径而不加载 → `userRequire` 挂上 `.resolve`。文件：`runtime.ts`、`realm.ts`、`builtins/module.ts`、`builtins/types.ts`
- **`events` 语义**：Node 里 `module.exports === EventEmitter`（构造器本身带命名导出），之前返回的是普通对象，导致 `import EventEmitter from 'events'; class X extends EventEmitter` 报 “Class extends value #<Object> is not a constructor”。文件：`builtins/events.ts`
- **`unsupported` stub 的 interop**：`has()` 恒真 + `__esModule` 返回“抛错的函数”（真值），使 `__wnDefault` 误判成 ES 命名空间并取 `.default`，`import tty from 'tty'` 拿到的是 stub 函数 → interop 键改为返回 `undefined`。文件：`builtins/unsupported.ts`
- **`fs.realpathSync.native`**：Vite 做特性探测（`fs.realpathSync.native ?? fs.realpathSync`）→ 补上 `.native`。文件：`builtins/fs.ts`
- **新增 `crypto` builtin**（纯 JS SHA-1/SHA-256/MD5 + WebCrypto 随机数）+ **`unsupported` stub 模块**（`tty`/`child_process`/`dns`/`v8`/`worker_threads`/`readline`/`tls`/`zlib`：**加载不抛**，仅“使用”才抛 `NotImplementedError`，因为 `import 'node:tty'` 这类副作用导入不能炸）。文件：`builtins/crypto.ts`、`builtins/unsupported.ts`

**演示**：新增「⚡ Vite build」按钮 → 跑 `/project/vite-build.mjs`（动态 `import('vite')` → 初始化 esbuild-wasm → `vite.build()` → 写回 `/project/site/dist/`）。新增站点源码 `/project/site/{index.html,src/main.js,src/message.js}`；`package.json` 新增 `vite`/`postcss`/`picocolors`/`source-map-js`/`nanoid`。文件：`index.html`、`src/ui/main.ts`、`src/demo-project.ts`

**测试**：82 → **85**。新增 Vite 未安装时的提示用例；把旧的「`crypto` 未实现即抛」改为「白名单外模块抛」并新增 stub 行为用例（`tty.isatty()` 返回 false、`dns.lookup()` 抛）。另：`tsconfig.json` 排除 `test/_*.test.ts`（一次性可行性验证脚本读真实磁盘，不参与 `tsc` 门禁；vitest 仍会跑）。

**浏览器实测**：Reset → Install deps（11 个包，含 `vite@5.4.21`）→ ⚡ Vite build：`vite v5.4.21 (running in the tab)` · `esbuild wasm started in 33ms` · `built in 148ms` · 产物 `site/dist/assets/index-*.js` + `site/dist/index.html`（真实 Vite production 输出，含 modulepreload polyfill）。重载后产物仍在 OPFS 里。

### 2026-09-17 · M5b 真实打包器：rollup（官方 WASM 构建）在页内做 tree-shaking

**目标**：把真正的打包器跑起来。选了 **rollup**——它是 Vite 的底层打包器，官方提供 `@rollup/wasm-node`（用 WASM 代替 napi 原生二进制，浏览器可用）。

- **新增 builtins**：
  - `fs/promises`（= `fs.promises`，rollup 直接 `require('node:fs/promises')`）
  - `perf_hooks`（直接用浏览器的 `performance`）
  - `url`（原生 `URL`/`URLSearchParams` + `pathToFileURL`/`fileURLToPath`/`urlToHttpOptions` + 简单 legacy `parse`/`format`）。文件：`src/node-runtime/builtins/{fs-promises,perf-hooks,url}.ts`、`builtins/index.ts`
  - `child_process` **不提供**：不需要，且保持“require 即抛明确错误”的诚实行为。
- **Loader 修复 1：`main` 先于 `module`**。之前 `#packageEntry` 把 `module`（ESM）排在 `main`（CJS）前，rollup 因此被解析到 ESM 构建后编译失败。Node 的 `require` 语义应先看 `main`（`module` 只是打包器字段）。修正后 rollup 正确走到 CJS 入口。
- **Loader 修复 2：不再注入“宿主同名”全局**。CJS 包装把沙箱里的每个全局都做成形参，而沙箱镜像的宿主全局（`btoa`/`performance`/`TextEncoder`…）与模块自己的顶层 `const btoa = …` 冲突（`Identifier 'btoa' has already been declared`，rollup 真实踩到）。现在**只在沙箱值与宿主不同时才注入**（同名的一致值本就能通过真实全局作用域拿到）。沙箱特有的 `process`/`Buffer`/`console`/timers/`globalThis` 仍照旧注入。
- **演示**：新增「⧉ Bundle」按钮 → 跑 `/project/bundle.js`：`require('@rollup/wasm-node')` → `rollup.rollup({input})` 直接读 VFS 源码（我们的 `fs` 就是 VFS，无需插件）→ `generate({format:'es'})` → 写回 `/project/dist/app.esm.js`。演示新增 `/project/app/main.js`、`app/text.js`（含死代码 `explode` 用于展示 tree-shaking）；`package.json` 新增 `@rollup/wasm-node` 依赖。文件：`index.html`、`src/ui/main.ts`、`src/demo-project.ts`
- **测试**：78 → **82**。新增：`fs/promises` 与 `fs.promises` 同源、`perf_hooks`/`url` 基本接口、`const btoa` 不再冲突、rollup 未安装时 build.js/bundle.js 给提示。
- **浏览器实测**：Reset → Install deps（`ms` + `esbuild-wasm` + `@rollup/wasm-node` + `@types/estree`，scoped 包正常）→ Bundle：`rollup v4.63.3 (official WASM build)` · `bundle: 339 bytes in 13ms` · `tree-shaken: yes (dead export dropped)` · `written: /project/dist/app.esm.js`。**重载后不重装**直接再 Bundle/Build 均成功（OPFS base64 持久化对 577KB 与 13.3MB wasm 都完好）。

### 2026-09-17 · M5 真实构建工具：esbuild WASM 在页内打包 + OPFS 二进制持久化修复

**目标**：把一个真实构建工具跑起来。选了 **esbuild**，因为它是 Vite 内部的转换/预打包器，且官方提供 **WASM 构建**（浏览器原生，零依赖）。

- **`browser` 字段支持**（loader）—— 关键前置。`esbuild-wasm` 的 `main` 是 Node 构建（需 `child_process`/`worker_threads`/`tty`），必须按 npm 约定解析到 `browser` 指向的自包含浏览器构建。实现了字符串形式（重定向入口）和对象形式（`{"fs": false, "...": "..."}`），`false` 映射为空模块；作用于入口解析与包内相对/裸说明符重映射。文件：`src/node-runtime/loader/index.ts`
- **`require.resolve`**：新增模块级 `require.resolve(request[, {paths}])`，与 Node 签名一致；esbuild 插件用它做 `node_modules` 解析。文件：同上
- **沙箱浏览器全局**：用户模块里的 `globalThis` 是沙箱对象，因此把标签页真正拥有的全局（`WebAssembly`/`crypto`/`performance`/`TextEncoder`/`TextDecoder`/`Blob`/`Worker`/`fetch`/`self`…）镜像到沙箱上；宿主没有的（Node 下）跳过，`self` 回退到真实全局。没有这步 esbuild 会在 `globalThis.crypto` 上报错。文件：`src/node-runtime/runtime.ts`
- **演示**：新增「▦ Build」按钮 → 跑 `/project/build.js`：从 VFS 读 `esbuild.wasm` → `WebAssembly.compile` → `esbuild.initialize({worker:false})` → 用 VFS 插件 `build()` 打包 `src/app.ts`（TS + 真实 `node_modules` 依赖 `ms`）→ 写回 `/project/dist/app.js`。演示还新增 `src/app.ts`/`src/greet.ts`。文件：`index.html`、`src/ui/main.ts`（`runEntry` 重构）、`src/demo-project.ts`
- **OPFS 二进制持久化 bug（M5 暴露）**：`MemoryVfs.snapshot()` 用 `TextDecoder()`（UTF-8）解码文件字节，非文本内容被破坏并膨胀（13.3MB 的 wasm 变 17.2MB，重载后 `WebAssembly.compile` 报 `length overflow`）。改为 **base64**（新增 `src/node-runtime/vfs/base64.ts`，零依赖），`fromSnapshot` 支持 `base64`/`text` 两种编码；OPFS 快照加 `{v:2}` 标记，旧格式（v1 纯文本）仍可读。文件：`src/node-runtime/vfs/{memory,opfs,base64}.ts`、`src/worker/runtime.worker.ts`（恢复逻辑改用 `fromSnapshot`）
- **测试**：69 → **78**。新增 `test/browser-field.test.ts`（4：字符串入口、对象重映射、`false`→空模块、无 browser 字段回退 main）、`test/build.test.ts`（3：`require.resolve` 相对/裸/子路径、browser 字段参与解析、未安装 esbuild-wasm 时 build.js 给提示）、`test/vfs.test.ts`（+2：二进制快照往返、旧文本快照兼容）
- **浏览器实测**：Reset → Install deps（`ms@2.1.3` + `esbuild-wasm@0.28.2`）→ Build：`tool: esbuild-wasm v0.28.2 (13.3 MB wasm)` · `wasm: compiled + service started in 37ms` · `bundle: 5138 bytes in 116ms` · `written: /project/dist/app.js`；再运行产物得到 `hello, world! | hello, web-node! | hello, browser!  (ms: 7200000ms)`。

### 2026-09-17 · http 健壮性：handler 抛异常不再卡死 keep-alive 连接

验收 M4/M3.5 时发现：请求 handler **同步抛异常**（如 `fs.readdirSync('/nope')` 抛 ENOENT）时，异常穿透 `emit('request')`，连接被卡死 —— 客户端等 15s 才超时，且该池化连接后续请求全部失效。

- **handler 抛异常**：`Server.#serveConnection` 用 try/catch 包住 `emit('request')`。若响应还没刷出（`#flushed=false`）→ 用 `ServerResponse._fail()` 把状态行/头换成 **500** 并发回，连接保持可用；若已经写了字节（响应中途抛）→ 销毁 socket。
- **客户端感知断链**：`Connection` 的 `socket.onClose` 之前只 `destroy()` 不通知等待中的响应，而 `_stream`/`_request` 只认 `onError`。现在 close 时若仍有 pending 响应，向上报 `socket hang up`，SW 立即返回 502 而不是挂到 15s。
- **测试**：68 → **69**（net-http 18 → 19）。新增：handler 同步抛 → 500 且同连接后续请求仍可用；响应中途抛（已 flush）→ 客户端收到 error（hang up）而非挂起，新连接仍正常。
- **文件**：`src/node-runtime/builtins/http.ts`、`test/net-http.test.ts`
- **浏览器实测**：`/preview/3000/api/ls?dir=<不存在>` 从 502/15s 超时 → **500 Internal Server Error / 1ms**，之后 `/api/info` 仍 200。

### 2026-09-17 · M3.5 网络收敛：keep-alive + 浏览器侧真流式 + https（子域名路由暂缓）

四项做了三项：

- **keep-alive（HTTP/1.1 持久连接）**
  - `HttpMessageReader` 可复用：读完一条消息后置 `done` 但继续缓冲，`rest()` 把下一条（pipelined）消息的字节交回，便于连接重新武装。顺便补上了 **chunked trailer 段的消费**（之前 `0\r\n` 后的结尾 CRLF 会泄漏到下一条消息，导致 keep-alive 下第二条请求解析失败）。
  - `Server.#serveConnection` 改为连接循环：每个 reader 局部持有自己的 `req`/`res`，响应结束时（延迟一个 tick，因为 handler 可能在 `onHead` 里同步 `res.end()`）重新武装，并回放抢先到达的字节。
  - **客户端连接池**：新增内部 `Connection`（socket 数据回调只注册一次，永远喂给「当前」reader，避免监听器堆积）+ 按端口的 idle 池；`http._request` 默认发 `Connection: keep-alive` 并复用连接。`IncomingMessage._destroy` 不再在正常完成时销毁 socket（之前会把待复用的连接杀掉）。
  - `ServerResponse` 根据请求/响应头决定 `Connection`，不再无条件写 `close`。
  - 文件：`src/node-runtime/builtins/http.ts`
- **浏览器侧真流式**
  - `http._stream(port, init, handlers)`：先回调 head，再逐块回调 body；`_request` 改为基于它实现。
  - worker 新增 `httpStream` 消息，把 head/chunk/end 分别 `postMessage`。
  - `RuntimeClient` 新增 `#serveViaStream`：把每个 chunk 经 MessagePort 转发给 SW。
  - `public/sw.js`：用 `ReadableStream` 组装 Response，`res.write()` / SSE / 大文件**边产生边到达**浏览器。HTML 是唯一例外（为注入 `<base>` 先缓冲）。
  - 文件：`src/node-runtime/builtins/http.ts`、`src/worker/runtime.worker.ts`、`src/client/index.ts`、`public/sw.js`
- **https**：`http` 的同名壳（虚拟网络里没有 TLS，浏览器也开不了裸 TCP 口）；真 TLS 选项接受但忽略，不假装安全。文件：`src/node-runtime/builtins/https.ts`、`builtins/index.ts`
- **子域名路由暂缓**：`<port>.localhost:5199` 是**另一个源**，而 runtime/VFS/OPFS（按源隔离）都在 `localhost:5199`。强做会导致「每个子域名一份 runtime（看不到主源 OPFS）」或需要新增跨源中继层。见「已知限制」与「下一步」。
- **测试**：61 → **67**。新增：keep-alive 单连接复用 3 次请求、`Connection: close` 后重连、单 socket 写入两条 pipelined 请求、`_stream` 的 head/chunk 顺序与增量交付、`_stream` 连接失败 `ECONNREFUSED`、https 往返。
- **浏览器实测**：`/preview/3000/api/stream` 从「最后一次性返回」变为 **6 个 chunk，间隔 ~30ms**（与 `setInterval(30)` 一致）；HTML `<base>` 注入、JSON、下载（197B）、目录列举均无回归；console 无报错。

### 2026-09-17 · M4 npm client：registry 解析 + tarball 解包 + node_modules 写入 VFS

- **交付**：点 **Install deps** 会读项目 `package.json`，向 npm registry 解析版本、下载 tarball、gunzip+untar 后写入虚拟 `node_modules`；之后 `require('ms')` 直接可用。
  - `src/node-runtime/npm/semver.ts`（新）—— 极简 semver：`^ ~ = > >= < <= *`、部分版本、通配符、hyphen range、`||` 并集、prerelease 门控；导出 `parseVersion`/`compare`/`satisfies`/`maxSatisfying`/`minSatisfying`。
  - `src/node-runtime/npm/tarball.ts`（新）—— `gunzip`（平台 `DecompressionStream('gzip')`，零 zlib 依赖）+ `untar`（ustar + pax `path`/`size` 扩展 + GNU longname；剥掉 npm 的 `package/` 前缀；忽略 symlink/device）。
  - `src/node-runtime/npm/registry.ts`（新）—— `createRegistry(fetch, baseUrl)`：packument（用 `application/vnd.npm.install-v1+json` 精简文档）+ tarball 下载，均按实例 memoize。`fetch` 以 **FetchLike** 注入，测试无需网络。
  - `src/node-runtime/npm/install.ts`（新）—— `installProject(vfs, opts)`：解析依赖→**npm 式 hoisting**（能复用祖先已装的兼容版本就复用，否则放最浅的空位，冲突则嵌到依赖者自己的 `node_modules`）→ 每个 `name@version` 只下载解包一次 → 写 VFS。
  - `src/node-runtime/runtime.ts` —— 新增 `installDependencies({ cwd, includeDev, onLog, fetch })`，默认取宿主 `fetch`。
  - `src/worker/runtime.worker.ts` —— 新增 `npmInstall` 消息；安装日志逐行走 `stdout`；完成后调度 OPFS 持久化。
  - `src/client/index.ts` —— `installDeps({ cwd, includeDev })`。
  - `index.html` + `src/ui/main.ts` —— 顶栏新增 **⬇ Install deps** 按钮；文件树过滤 `node_modules`（保持可读）。
  - `src/demo-project.ts` —— demo `package.json` 声明 `dependencies: { ms: '^2.1.3' }`；`index.js` 加 `-- npm --` 段（`require('ms')`，未装时给提示）；`notes.md` 勾掉 M4。
  - `test/npm.test.ts`（新，11 条）—— semver 语义；gunzip+untar（含 pax 长路径）；离线假 registry 端到端：安装+hoisting+`require`、版本冲突嵌套、范围无解告警。
- **为什么**：npm client 是 WebContainer 形态的核心能力，也是 M5（跑真实构建工具）的硬前置；resolver 的 `node_modules` 逐级向上解析早已就绪，正好接上。
- **踩过的坑（重要，别重犯）**：
  1. **TS 5.6 + DOM lib 下 `new Blob([uint8])` 编译报错**：`Uint8Array<ArrayBufferLike>` 不满足 `BlobPart`（要求 `ArrayBufferView<ArrayBuffer>`）。**修复**：用 `bytes.buffer.slice(byteOffset, byteOffset+byteLength) as ArrayBuffer` 传 `Blob`。
  2. **不要为了 gzip 去实现 inflate**：浏览器与 Node 18+ 都有 `DecompressionStream('gzip')`，直接 `new Blob([...]).stream().pipeThrough(ds)` 即可。
  3. **npm tarball 的长路径走 pax 扩展头**（`typeflag='x'`，记录 `path=`），不是 ustar 的 prefix 字段；只按 100 字节 name 截断会写错文件。解析 pax 时记录长度要**含长度前缀自身**（迭代到不动点）。
- **验证**：`tsc --noEmit` 干净 · `vitest run` **61/61** · `vite build` 绿。浏览器实测：Reset 项目 → Install deps → `+ ms@2.1.3` / `↓ ms@2.1.3` / `[installed 1 package(s) in 521ms]` → Run 输出 `require(ms) : 1m | 7200000ms`；`/preview/3000/api/info` 仍 200（无回归）；文件树不含 `node_modules`。
- **限制**（记入 demo notes）：不跑生命周期脚本、不建 `.bin`、不自动装 peer、不读写 lockfile、不校验 integrity、不支持 `file:`/`git+`/`link:` 说明符；根级同名版本冲突按声明顺序保留第一个。

### 2026-09-17 · README 英文化 + 仓库转公开

- **改了什么**：
  - 中文 README 改为 `README_zh.md`（`git mv` 保留历史），新建英文 `README.md` 作为默认首页。
  - 英文 README 新增「How it works」架构图、「Networking」/「Streams」/「Roadmap」/「Contributing」等章节，顶部加语言切换（English · 简体中文）。
  - 顶部两份 README 互相链接；中文版同样补充语言切换行。
- **为什么**：对外公开仓库需要英文门面；中文内容保留给团队。
- **涉及文件**：`README.md`（新，英文）、`README_zh.md`（由 `README.md` 改名）。
- **另**：GitHub 仓库由 private 转为 public（仓库设置，不改代码）。

### 2026-09-17 · stream 前置：`stream` 模块 + `fs`/`http` 流 + chunked

- **交付**：`req.pipe(res)`、`fs.createReadStream(...).pipe(...)`、`res.write()` 流式响应都能用了；响应无 `Content-Length` 时按 `Transfer-Encoding: chunked` 分帧，客户端会再解码回来。
  - `src/node-runtime/builtins/stream.ts`（新）—— `Readable`/`Writable`/`Duplex`/`Transform`/`PassThrough` + `pipe`/`unpipe`/`read`/`push`/`unshift`/`cork`/`uncork` + `pipeline`/`finished`/`Readable.from` + `stream/promises`。**真背压**（hwm → `false` → `'drain'` → `resume()`）。`origin: 'web-node'`。
  - `src/node-runtime/builtins/fs.ts` —— `createReadStream`/`createWriteStream` + `ReadStream`/`WriteStream`（`open`/`ready`/`data`/`end`/`close`/`finish`/`bytesRead`/`bytesWritten`，支持 `start`/`end`/`highWaterMark`/`flags`/`autoClose`）。删掉了原来两个「streams milestone pending」的抛错桩。
  - `src/node-runtime/builtins/http.ts` —— `IncomingMessage` → `Readable`、`ServerResponse` → `Writable`（chunked 分帧 + `flushHeaders`）、`ClientRequest` → `Writable`；`HttpMessageReader` 新增 chunked 解码状态机。
  - `public/sw.js` —— 响应头过滤扩成完整的 hop-by-hop 列表（新增 `transfer-encoding`/`keep-alive`/`te`/`trailer`/`upgrade`）。**这条是必须的**：body 在 worker 里已经被解码成平铺字节，再把 `transfer-encoding: chunked` 转给浏览器会让它二次解帧、直接损坏响应。
  - `src/demo-project.ts` —— 新增 `-- stream --` 段落（`createReadStream` 16 字节分块读 + `pipeline` 大写写出 `facts-upper.txt`）和 4 个端点：`/download/facts.txt`（`createReadStream().pipe(res)`）、`/api/stream`（5 次 `res.write()`）、`/api/upload`（`req.pipe(createWriteStream)`）、`/api/ls?dir=`（回读 VFS）。
  - `test/stream.test.ts`（新，17 条）—— 基类语义（顺序/背压/pipe/drain/Transform/pipeline/promises/finished）+ 集成（fs 流、文件拷贝、chunked 响应、多段 `res.write()`、上传落盘、用 Transform 流式改请求体）。
  - `test/net-http.test.ts` —— GET 往返改成断言 chunked 分帧；另加一条「显式 `Content-Length` 时不 chunked」。
- **接线**：`streamSpec` + `streamPromisesSpec` 进 `ALL_BUILTINS`（排在 `fs`/`http` 之前）；`fsSpec.deps` 加 `stream`，`httpSpec.deps` 加 `stream`。
- **踩过的坑（重要，别重犯）**：
  1. **`pipe()` 里监听器的挂载顺序有坑**。挂 `'data'` 监听器会立刻把流切成 flowing 并**同步**排空已缓冲的数据；如果此时 `'end'` 回调还没挂上，就直接错过收尾（表现为 dest 永远不 `end()`、socket 不关、客户端挂死）。**修复**：`pipe()` 先挂 `'end'`/`'error'`，再挂 `'data'`。
  2. **`'end'`/`'finish'` 不能同步发射**。Node 是异步发射的；同步发射会导致「先 `end()` 再挂 `'finish'` 监听器」这种极常见写法收不到事件。**修复**：`Readable.#drain()` 的 `'end'`/`'close'` 和 `Writable.afterFlush()` 的 `'finish'`/`'close'` 一律 `defer()`（`ctx.binding.nextTick`）。
  3. **Writable 的状态不能放 `#private` 字段**。`Duplex`/`Transform`/`PassThrough` 是靠把 Writable 的 API 混入 Readable 子类实现的（Node 结构上也如此），私有字段是 per-constructor、混入后取不到。**修复**：Writable 状态放 `WeakMap`，配模块级 `doWrite()/afterFlush()` 函数。
  4. **`demo-project.ts` 的反引号陷阱又踩了一次**。往 `notes.md` 里写 markdown 反引号（如 `` `Content-Length` ``）会直接让模板字面量提前闭合 → 编译报 `Module declaration names may only use ' or " quoted strings`。**约定重申**：内嵌源码（含 `notes.md`）里禁用反引号 / `${` / 反斜杠。
  5. **`Buffer` 是沙箱全局**（`runtime.ts` 的 `sandboxGlobal` 里注入了 `Buffer`），用户代码里再写 `const { Buffer } = require('buffer')` 会撞上 prologue 的声明 → `Identifier 'Buffer' has already been declared`。写测试时别重复声明。
- **验证**：`tsc --noEmit` 干净 · `vitest run` **50/50** · `vite build` 绿。浏览器实测：Run 输出 `read stream : 197 bytes in 13 chunks of <=16` + `pipeline : facts-upper.txt written`；`/download/facts.txt` → 197 字节；`/api/stream` → `tick 1;…;done`；POST `/api/upload` → `{"bytes":21}`；`/api/ls?dir=/project/output` → `facts-upper.txt, facts.txt, report.txt, upload.txt`；`crossOriginIsolated: true`。

### 2026-09-17 · M3 网络：虚拟 TCP + ServiceWorker 桥 + 预览面板

- **交付**：`http.createServer().listen(3000)` 现在可以从浏览器 URL 访问。
  - `src/node-runtime/net/network.ts`（新）—— `VirtualNetwork` + `VirtualSocket`：端口表 + 双工字节管道。`write()` 始终异步交付；`dial()` 在未绑定端口上抛 ECONNREFUSED，重复 `listen` 抛 EADDRINUSE。这是将来替换为 SharedArrayBuffer/wasm transport 的接缝。
  - `src/node-runtime/builtins/net.ts`（新）—— `net` builtin（`Server`/`Socket`/`createServer`/`connect`），基于 VirtualSocket 的 EventEmitter 风格封装。
  - `src/node-runtime/builtins/http.ts`（新）—— `http` builtin：增量 HTTP/1.1 解析器（`HttpMessageReader`）、`IncomingMessage`、`ServerResponse`、`Server`、`ClientRequest`/`request`/`get`、`STATUS_CODES`，外加 `_request()` Promise 助手（供 SW 桥复用）。
  - `public/sw.js`（新）—— ServiceWorker：拦截同源 `/preview/<port>/…`，postMessage 给页面，再转发进 runtime worker。HTML 响应注入 `<base href="/preview/<port>/">` 让相对路径资源仍落在前缀内。
  - `src/client/index.ts` —— `installServiceWorkerBridge()` + `#serveViaBridge()`；`describe()` 现在返回 `ports`。
  - `src/worker/runtime.worker.ts` —— 新增 `http` 消息类型 + `serveVirtualRequest()`。
  - `src/ui/` —— 右面板 Output / Preview 双 tab、端口下拉、iframe 预览；`index.html` + `style.css` 相应调整。
  - `src/demo-project.ts` —— demo 现在起一个真 HTTP server（HTML 页面 + `/api/info` + `/api/fib`），新增 `lib/facts.js`。
- **接线**：`BindingContext.network`（新字段）；`NodeRuntime.network`；`resetRunState()` 会清空所有端口绑定（每次 Run = 全新进程，端口不残留）。`net`/`http` 进 `ALL_BUILTINS`，`PUBLIC_BUILTIN_IDS` 自动包含。
- **测试**：`test/net-http.test.ts`（新，10 条）—— echo 回声、ECONNREFUSED、EADDRINUSE、reset 清端口、GET/POST 往返、404、headers、沙箱内 `http.get`。共 **32/32 通过**。
- **踩过的坑（重要，别重犯）**：
  1. **SW 里 `event.clientId` 对导航请求是空的**。iframe 预览加载是 navigation，`clients.get('')` → undefined → 一律 503、iframe 空白。**修复**：`resolveClient()` 先试 `event.clientId`，失败则 `clients.matchAll({type:'window'})` 里挑第一个非 `/preview/` 的页面。
  2. **COOP/COEP + iframe**。dev server 带 `Cross-Origin-Embedder-Policy: require-corp`（为了 SharedArrayBuffer），被嵌入的文档必须显式声明才能渲染，否则 Chrome 静默给个空白框（无报错）。**修复**：SW 响应加 `Cross-Origin-Resource-Policy: cross-origin` + `Cross-Origin-Embedder-Policy: require-corp` + `Cross-Origin-Opener-Policy: same-origin`。
  3. **`demo-project.ts` 的转义陷阱**。嵌入代码是 TS 模板字面量，反引号 / `${` / 反斜杠都要转义，用 `edit` 工具改很容易对不上。**约定**：demo 代码里禁用这三者（换行用独立的 `console.log('')`）。
  4. 不要用 `timeout npx vite` 之类的组合——会把后台 dev server 一起带走（SIGTERM）。
- **验证**：浏览器实测 `/preview/3000/` → 200 HTML、`/api/info` → 运行时 JSON、`/api/fib?n=20` → `6765`、`/preview/9999/` → 502 ECONNREFUSED；iframe 实际渲染出绿色标题页面。

### 2026-09-17 · 修复「重复点击 Run 空跑」

- **现象**：第一次 Run 正常输出，之后每次点 Run 只打印 `[process exited 1ms]`，无任何程序输出。
- **根因**：`ModuleLoader.#cache` 按绝对路径永久缓存。`runMain()` 第二次调用直接返回缓存的入口模块 exports，**没有重新执行**，于是运行层无事可做、立刻以 exit 0 收尾，UI 就只打了一行退出信息。
- **修复**：确立「每次 Run = 一个全新进程」语义。
  - `src/node-runtime/loader/index.ts`：新增 `ModuleLoader.reset()`，清空用户模块缓存（**不动** realm 里的 builtin，那是"进程自身已加载的核心模块"，不是用户模块图）。
  - `src/node-runtime/runtime.ts`：新增 `NodeRuntime.resetRunState()`（清模块缓存 + 清所有 pending timer + `#exitCode = null`），`runMain()` 每次先调用它。
  - `src/ui/main.ts`：每次运行前打一行 `$ node /project/index.js` 表头，结束打 `[exit 0 · Nms]`，让连续运行在视觉上可区分。
- **测试**：`test/runtime.test.ts` 新增 2 条 —— 「连续 3 次 runMain 输出 3 次」「exitCode 在两次运行间重置」。共 22/22 通过。
- **验证**：浏览器连点 3 次 Run → 3 段完整输出（`demoHeaders: 3` / `exitLines: 3`）。

### 2026-09-17 · MVP 落地（M1 + M2）

- **交付**：
  - `Realm` 作为唯一「引擎替换点」，`internalBinding()` 分发表 + 16 个 binding 白名单
  - 用户代码跑在 Dedicated Worker，主线程只通过 `RuntimeClient` 通信（`src/client/index.ts`）
  - 内存 inode VFS（权威）+ OPFS 持久化（write-behind，debounce 400ms）
  - CJS 完整支持 + ESM 静态 import/export 子集（`loader/esm-transform.ts`）
  - Demo UI：文件树 / 编辑器 / 终端三栏（`src/ui/`）
- **Vendored 真 Node 源码 8 个**（`tools/vendor.mjs`，记录上游 commit + 双向 sha256 + 补丁说明）：
  `primordials.js`、`domexception.js`、`messageport.js`、`internal/constants.js`、`internal/encoding/util.js`、`internal/querystring.js`、`path.js`、`querystring.js`
- **关键决策**：
  - `internal/errors.js` **不 vendored** —— 它是 errors↔util↔inspect↔validators 环形依赖枢纽，全量 vendor 会牵出 231 个文件；改为自建最小等价 shim（`internal-shims.ts`）
  - 引擎缺 `Float16Array`/`Iterator` → 只对 `primordials.js` 打 3 处 guard 补丁（语义等价，记录在 MANIFEST）
  - 沙箱全局用**参数注入**而非污染宿主 `globalThis`（`installGlobals` 可关，Vitest 下必需）
  - Buffer 重写为真 `Uint8Array` 子类（原 `#wrap` 设计有无限递归 bug）
- **踩过的坑（防止重犯）**：
  1. `installGlobals` 覆盖全局 `setTimeout` → binding 层自我递归爆栈。**修复**：模块顶层捕获原生引用 `nativeSetTimeout = globalThis.setTimeout.bind(globalThis)`，在 installGlobals 之前。
  2. binding 契约漏了 `timers` → `binding.setTimeout is not a function`。
  3. `RuntimeClient` 最初收到 `ready`/`exit` 时只通知监听器、不 settle 对应 Promise → `init()` 永久挂起，页面停在 "booting runtime…"。
  4. 用 ClawHive 内置 Electron Node 装依赖 → `@rollup/rollup-darwin-arm64` dlopen 代码签名不匹配。**必须用 fnm 的 Node v22.19.0**。
- **测试**：`test/vfs.test.ts`(9) + `test/runtime.test.ts`(11) 起步 → 现 22 条。
- **设计文档**：`docs/superpowers/specs/2026-09-17-web-node-design.md`

### 2026-09-17 · 前期调研

- 结论：WebContainer **不是**「把 Node 编译成 WASM」。真实做法是 JS 层跑浏览器自带 JS 引擎（不搬 V8），只把原生/syscall 层换成 wasm，`internalBinding()` 是唯一替换点；再加虚拟 FS + ServiceWorker 虚拟 TCP + 自研 npm client。
- 据此确定本项目路线（见设计文档第 1 节）。
