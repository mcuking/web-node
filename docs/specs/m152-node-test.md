# M152 · `node:test` + `node:test/reporters`

> 状态：✅ 完成（2026-10-20）
> 目标：把 Node 真实的测试框架搬进 web-node —— `require('node:test')` 能声明/运行测试、`node:test/reporters` 能输出 spec/tap/dot/junit/lcov，`run({ files })` 能在页内跑一整个测试文件。

## 1. 为什么做

M151 之前的公开模块差分里，`node:test` 是**缺失**的 8 个公共内建之一，也是唯一「纯 JS、价值高」的那个（其余 `inspector`/`dgram`/`http2`/`cluster` 都需要页面里不存在的能力）。它同时是**自证工具**：用户把项目搬进标签页后，第一件想做的事就是跑自己的测试。

## 2. 依赖面怎么定

`tools/check-test-deps.mjs` 用逐行状态机（不是正则——非贪婪体仍会跨块吞掉后面的 `require`）扫 `test.js` / `test/reporters.js` / `internal/test_runner/**`，得出：

- **纯 JS、可直接 vendor**：`harness` / `test`（测试树）/ `tests_stream` / `tag_filter` / `snapshot` / `assert` / `mock/*`（`mock` + `mock_timers` + `loader`）/ 7 个 reporter / `internal/error_serdes`（建在 M54 的真 `v8` 上）。
- **页面里必须重写**：
  - `internal/test_runner/runner` —— Node 的 CLI runner 是**按文件 spawn 子进程**；标签页不能 spawn，`run()` 改为在本 realm 里逐个 `require` 文件（`isolation: 'none'`，Node 自己支持这个值）。
  - `internal/test_runner/coverage` —— V8 的进程级 coverage collector 页面起不来，`run({ coverage: true })` 报「无覆盖率」而不是让整轮失败。
  - `internal/modules/{cjs/loader,customization_hooks,esm/loader}` / `internal/source_map/source_map_cache` —— 转发给已有的 `module` builtin（它本来就拥有加载与 hook 注册）。

## 3. 关键坑（真机踩出来的）

### 3.1 `node:test` 的报告写到了**宿主**的 stdout

现象：测试确实跑了（Vitest 控制台里出现 `✔ adds (0.5ms)`），但 web-node 的 `onStdout` 收不到任何字节 —— 差分测试只能看到自己打的哨兵。

根因：`internal/test_runner/utils.js` 在**模块求值时**把 `process.stdout` 抓进 `kBuiltinDestinations`。而 vendored 模块的 CJS 包装只注入 `exports/require/internalBinding/module/__filename/__dirname/primordials/privateSymbols/perIsolateSymbols`——`process` 是**自由变量**，解析到环境全局。浏览器 worker 里我们的沙箱全局被装到真正的 `globalThis` 上，所以没事；但在 Vitest（`installGlobals: false`，不能覆盖宿主的 process/console）下，它拿到的是**宿主 Node 的 process**。

修法：`compileCjs(src, filename, extraParams)` 支持追加参数，`Realm.setModuleGlobals({ process })` 把沙箱的 `process` 绑成 vendored 模块的形参 —— 等价于「真 Node 里它是个真全局」。`console` 早已由 `kBindStreamsLazy` 单独处理，所以只绑 `process`。

> 这里也有个通用教训：**任何 vendored 模块在模块顶层抓的全局，都必须在测试环境里同样成立**，否则「测试通过、生产正常」或反之。

### 3.2 `beforeExit` 之前必须让 async 监听器跑完

Node 的 `node:test` 在 `beforeExit` 里做收尾（等 `root.subtestsPromise`、跑 globalTeardown、关 reporter）。原来的 `drain()` 一见到「无活跃工作」就直接返回，于是**摘要和失败详情被截断**（只有每个测试的那一行）。

修法：`drain()` 现在
1. 第一次空闲时发 `beforeExit`（每次 run 最多一次）；
2. 之后要求 **8 个空闲宏任务轮**才发 `exit`；
3. 如果确实有 `beforeExit` 监听器，还要求 **60ms 静默窗口**——reporter 是流，最后一笔写入比监听器的 promise 更晚落地。

不用「等 promise」是因为监听器的返回值被丢弃（`emit` 不 await），这种工作对 `#activeWorkCount()` 不可见。

### 3.3 `ERR_TEST_FAILURE` 的两处形状

- **必须进 `ERROR_CODES`**（`codes` 只由它的键构建，漏了就是 `undefined` → "is not a constructor"）。
- 它**不是**格式化字符串码：Node 用 `new ERR_TEST_FAILURE(err, kTestCodeFailure)` 直接塞**错误对象**，约定是 `message = err.message`、`cause = err`（reporter 的 `formatError` 会 `error.code === 'ERR_TEST_FAILURE' ? error.cause : error` 去 inspect `cause`）。用 `%s` 模板会让 `cause` 缺席，输出退化成 `undefined`。
- 同时补上 `kIsNodeError` 到**所有** `codes.X` 实例上（真 Node 实测：`kIsNodeError in new codes.ERR_INVALID_ARG_TYPE(...)` 为 `true`）；`test_runner/utils.isTestFailureError` 靠它区分「自己包的错误」和「用户抛的错误」。

### 3.4 计数语义别凭直觉

真 Node v26.9.0 实测：`describe` 里 1 个 `it` + 顶层 1 个 `it` → `tests 2 / suites 1 / pass 2`（**通过的 suite 不计入 `pass`**）。原先测试里写的 `/pass 3/` 是错的，按真机值改正。

## 4. 验证

- `test/node-test.test.ts`（6）：
  1. 通过测试经 spec reporter 输出，摘要 `pass 2`；
  2. 失败断言带出用户错误原文（`Expected values to be strictly equal`）；
  3. `describe`/`it`/`before` 钩子生效且计数正确；
  4. `skip`/`todo` 不执行函数体、计数正确；
  5. `run({ files })` 触发 `test:pass` / `test:summary` 事件；
  6. `run(...).compose(tap)` 输出 TAP。
- 全量 `npx vitest run`：**158 文件 / 1333 通过、6 skip**（此前 1327 通过，净增 6）。
- `npm run build` 通过。

## 5. 边界（明确不做）

- **不 spawn**：没有子进程隔离，`run({ concurrency })` 的语义是「同一个 realm 里顺序加载」。
- **无覆盖率**：`coverage: true` 给出「无覆盖率」而不是假数字。
- **`--test-only` / `--test-name-pattern` 等 CLI 选项**：只有走 `node --test` 的 CLI 解析路径才有；页面里进程 argv 由用户程序决定，等价能力通过 `test('x', { only: true })` 与 `test('x', { skip })` 提供。
