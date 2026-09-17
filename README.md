# web-node

在浏览器里跑 Node.js 源码（WebContainer 式运行时）。

- 设计文档：`docs/superpowers/specs/2026-09-17-web-node-design.md`
- 上游源码：`/Users/tangjianghong/Downloads/node`（Node.js v26.9.1）

## 开发

```bash
npm install
npm run dev      # 打开 http://localhost:5173
npm test         # 单元测试
npm run build    # 类型检查 + 产物构建
```

## 结构

```
src/
  node-runtime/   运行时核心：realm(binding 分发) / loader / bootstrap / runner
    bindings/     TS 实现的 internalBinding
    builtins/     node:* 模块实现
    vfs/          虚拟文件系统（内存树 + OPFS 持久化）
  worker/         Dedicated Worker 入口
  client/         主线程 Runtime Client API
  ui/             Demo UI
vendor/node-lib/  从 Node.js 源码复制的真实文件（含来源记录）
tools/            依赖扫描 / vendoring 工具
```
