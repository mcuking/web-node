# Demo 场景化改版（Vite / Webpack / rspack / Node 四场景）

- 日期：2026-09-29
- 状态：已批准（唐工确认按此实现）
- 相关里程碑：M129（情景步进器）、M110（webpack）、M125（rspack）、M18（Vue SFC）

## 背景

上一版（M129）已把 13 个平铺按钮收敛成「情景步进器」，但仍不清楚：

- 第一行把「工具」（esbuild / rollup / tsc / React / Cluster）和「场景」混在一起，概念混乱；
- 第二行还混着 `HMR JS` / `HMR CSS` 这类二级按钮；
- 文件树把所有场景的文件堆在一起，看不出「一个场景 = 一个项目」；
- 预览内容是 `index.js` 里 `page()` 函数拼出来的 HTML 字符串，新用户看不到「可改的模板」。

## 目标

改成「四个互相独立的项目，每个项目一套可直接读改的模板代码」：

| 场景 | 项目目录 | Run dev | Run build |
|---|---|---|---|
| ⚡ Vite | `/project/vite` | Vite dev server `:5173`（HMR） | `vite build` → `dist/` |
| 📦 Webpack | `/project/webpack` | webpack watch + 静态伺服 `:5174`（full reload） | webpack production build → `dist/` |
| 🔷 rspack | `/project/rspack` | rspack watch + 静态伺服 `:5175`（full reload） | rspack production build → `dist/` |
| 🟢 Node.js | `/project/node` | — | `node index.js`（原生能力演示，含 `:3000` HTTP server） |

## 布局（三层）

1. **顶栏**：品牌 + `Clear` / `Reset project`。
2. **Scenario 行**：四个 chip —— `⚡ Vite` · `📦 Webpack` · `🔷 rspack` · `🟢 Node.js`。
3. **Steps 行**：当前场景的编号步骤，右侧 `Next: click …` 实时提示。

- **文件树**：只显示当前场景项目目录下的文件（不含 `node_modules`）。
- **编辑器**：切场景时默认打开该场景的主文件（vite→`src/App.vue`、webpack→`src/index.js`、rspack→`src/main.mjs`、node→`index.js`）。
- **预览**：`Run dev` 起来后从端口下拉里预览；HMR / full-reload 自动生效，无单独按钮。

## 项目结构

```
/project/node/        package.json index.js lib/*.js lib/greeting/* tool.sh
/project/vite/        package.json index.html src/{main.js,App.vue,message.js,style.css} dev.mjs build.mjs
/project/webpack/     package.json index.html src/{index.js,message.js} webpack.config.mjs dev.mjs build.mjs
/project/rspack/      package.json index.html src/{main.mjs,message.mjs} rspack.config.mjs dev.mjs build.mjs webnode-binding.cjs
```

## 关键决定

- **每个项目各装各的 `node_modules`**（`/project/<proj>/node_modules`），`installDeps({ cwd })`；默认安装因此保持小而快，rspack 仍然最重。
- **入口 HTML 就是模板**：三个 bundler 项目的 `index.html` 是可直接编辑的普通 HTML，JS 只做交互绑定（`textContent` / `addEventListener`），不再用函数拼 HTML。
- **HMR 是默认行为**：dev 脚本自己接 Vite HMR / webpack·rspack full-reload 桥，UI 不再暴露 HMR 按钮。
- **删除 esbuild / rollup / React+Tailwind / tsc / Cluster 五个场景及其文件**：UI 与文件树里都不再出现。（Vite 内部仍用 `esbuild→esbuild-wasm`、`rollup→@rollup/wasm-node`，能力由 Vite 场景承接。）
- **rspack 适配器 `webnode-binding.cjs` 留在项目目录内**：它 `require('@napi-rs/wasm-runtime')` 必须从 `/project/rspack/node_modules` 解析，不能外移。
- **文件数据分模块**：`src/demo/{node,vite,webpack,rspack}-project.ts` 各管一个项目，`src/demo-project.ts` 只做聚合 + 元数据。
- **门禁按观测量派生**：`/project/<proj>/node_modules` 是否存在决定依赖步骤是否可点；刷新即重算，不持久化「已完成」。

## 不做的（YAGNI）

- 不改运行时语义、不新增第三方依赖。
- 不做全向导弹窗，不持久化完成态。
- 不为每个项目做 per-project 端口冲突处理（四个端口固定：5173/5174/5175/3000）。
