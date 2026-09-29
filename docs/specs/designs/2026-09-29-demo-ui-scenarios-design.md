# Demo UI 情景化改造（导航栏场景按钮 + 点击顺序引导）

- 日期：2026-09-29
- 状态：已批准（唐工选择方案 B）
- 相关里程碑：M113、M121、M125（rspack 接入）

## 问题

demo 顶部平铺 13 个按钮，没有分组、没有顺序、没有前置提示：

- **依赖链是隐形的**：除 `Run` 外的多数按钮（Build / Bundle / Vite* / Webpack dev / tsc）都需要先 `Install deps`，否则 `MODULE_NOT_FOUND`；
- **HMR 按钮有二级前置**：`HMR JS`/`HMR CSS` 必须先跑起 `Vite dev`；
- **缺 rspack 场景**：`examples/rspack/webnode-binding.cjs` 与 `public/wasi-thread-child.js` 已就绪（M125 页内已跑通 rspack 2.2.7 生产构建），但没有接进 demo UI；
- 结论——「很杂乱、不知道怎么用、乱点必报错」。

## 方案（B：情景步进器）

把「平铺一行」改成「**情景选择 + 编号步骤 + 渐进门禁**」三层：

1. **全局区**（顶栏，始终可见）：`⬇ Install deps`、`▶ Run`（primary）、`Clear`、`Reset project`。
2. **情景栏**（chips）：`Playground / esbuild / rollup / Vite / Webpack / React / tsc / rspack / Cluster`。选中一个只显示该情景的步骤。
3. **步骤栏**：按编号列出该情景的步骤按钮，并给出实时「下一步」提示。

### 情景与步骤

| 情景 | 步骤（顺序） |
|---|---|
| Playground | Install deps → Run |
| esbuild | Install deps → Build |
| rollup | Install deps → Bundle |
| Vite | Install deps → Vite build → Vite dev → HMR JS → HMR CSS |
| Webpack | Install deps → Webpack dev |
| React | Install deps → Vite React |
| tsc | Install deps → tsc build |
| rspack | Install rspack deps → rspack build |
| Cluster | Cluster（无前置） |

### 门禁（gating）

- `needs: 'deps'` 的步骤：`/project/node_modules` 不存在 → **禁用**（tooltip：先点 Install deps）。
- `needs: 'viteDev'` 的步骤（HMR JS/CSS）：端口 5173 未监听 → **禁用**。
- rspack 的 `rspack build` 步骤：`/project/rspack/node_modules` 不存在 → **禁用**。
- 判定「已满足」的观测量：`files` 里存在 `node_modules` 路径 / 端口列表含 5173 / 存在 `/project/rspack/node_modules/...`。

### 视觉状态

- **blocked**（灰、禁用）
- **ready**（可点）
- **next**（高亮 + 步骤栏下方提示「下一步：点击 X」）
- **done**（✓，绿色）

## 设计决定

- **rspack 依赖单独按需安装**（143 包 / ~80s / 30MB wasm），不进默认 `Install deps`；放在 `/project/rspack/` 子目录，用 `installDeps({ cwd: '/project/rspack' })`。
- rspack 场景的文件（`webnode-binding.cjs` 适配器 / `rspack.config.cjs` / `src/index.js` / `build.cjs`）随 demo 项目写进 VFS；适配器由 `examples/rspack/webnode-binding.cjs` 生成（去反引号以便内嵌进 demo-project.ts 的模板串）。
- build 脚本用 **refed `setInterval` 保活**，直到 rspack 回调返回（M125 已证：真 worker 不在 web-node 活跃句柄计数里，不保活会被判 idle 提前退出）。
- 运行时零改动，改动集中在 `index.html` + `src/ui/main.ts` + `src/ui/style.css` + `src/demo-project.ts`。

## 不做的（YAGNI）

- 不做全向导弹窗、不做持久化「已完成」状态（按观测量派生，刷新即重算）。
- 不改运行时语义、不新增第三方依赖。
