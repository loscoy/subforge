# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目

SubForge：自托管的代理订阅转换 / 管理工具（订阅转换、自定义规则与分组、转换脚本、内置 AI Agent）。npm workspaces 单仓库，Node 22+。

约定：代码标识符、CLI、日志、错误信息用英文；注释与 UI 文案用简体中文。文件一律 UTF-8（无 BOM）。

## 常用命令

```bash
npm install
npm run build              # core → server → web，顺序有依赖
npm run typecheck          # tsc -b（web 需单独：npx tsc --noEmit -p packages/web/tsconfig.json）
npm test                   # vitest run，全部测试
npm run test:watch

npm run dev:server         # 后端 :8787（tsx watch）
npm run dev:web            # 前端 :5173，/api 与 /sub 代理到 :8787
```

单个测试文件 / 单个用例：

```bash
npx vitest run packages/server/src/tools/registry.test.ts
npx vitest run -t "回滚"          # 按用例名过滤
```

Cloudflare（在 `packages/server` 下）：

```bash
npm run cf:release -w packages/server   # 唯一推荐的发布方式，见下
npm run cf:migrate:remote -w packages/server
```

MCP server（同一套工具，供外部 agent 驱动）：`node packages/server/dist/mcp/stdio.js`。

## 架构

三个包，关键抽象都是可替换接口——新增实现时不要改调用方，只实现接口：

- **`packages/core`**（纯逻辑，无 I/O，边缘可移植）
  节点 IR（`model.ts`）、转换档配置（`config.ts`）、解析器（`parsers/`，URI / base64 / Clash YAML）、渲染器注册表（`renderers/`，mihomo / sing-box / surge）、声明式处理（`preprocess.ts`）、预设与模板（`presets.ts`）、脚本工具与 `.d.ts`（`script/`）、端到端管线（`pipeline.ts`）。
- **`packages/server`**（Hono，双运行时）
  路由（`routes/app.ts`）、业务编排（`service.ts`）、存储三实现（`storage/`：memory / sqlite / d1）、脚本沙箱两实现（`sandbox/`：nodeVm / quickjs）、Agent（`agent/`）、工具注册表（`tools/registry.ts`）、MCP 适配（`mcp/`）。
- **`packages/web`**（React 18 + Vite + Mantine v7 + Monaco）

核心数据流：`订阅原文 → parseSubscription → applyOperations → 脚本(transform 或 override) → expandRegionGroups → renderer → 输出配置`，统一由 `core/pipeline.ts::runPipeline` 串起来，服务端入口是 `service.ts::buildProfileOutput`。

### 双运行时（最重要的约束）

同一套代码跑 Node 与 Cloudflare Workers，入口不同：

| | Node（`src/index.ts`） | Workers（`src/worker.ts`） |
|---|---|---|
| 存储 | `SqliteStorage`（better-sqlite3） | `D1Storage` |
| 沙箱 | `NodeVmRunner`（node:vm） | `QuickJsRunner`（QuickJS-wasm） |
| 测活 | `checkNodes`（node:net） | 不注入 → 能力缺失 |

**`worker.ts` 只能 import 边缘可移植的模块**，绝不能间接引入 `better-sqlite3` / `node:vm` / `node:net`。往 `routes/app.ts` 或 `service.ts` 加依赖时要确认这一点。

能力差异通过依赖注入表达而非条件判断：`createApp({ storage, runner, config, checkNodes?, makeAgent? })`。边缘不注入 `checkNodes`，于是 `/healthcheck` 返回 501，且 `buildTools({ checkNodes: false })` 直接不注册 `test_nodes` 工具。

### 工具注册表是唯一真相来源

`tools/registry.ts::buildTools()` 定义全部工具（框架无关：name + zod schema + handler）。内嵌 Agent（`agent/aiSdk.ts`）与 MCP server（`mcp/server.ts`）都是它的薄适配层。新增能力只在这里加一次。

两条必须遵守的规则：

1. **工具 handler 抛错要在适配层被捕获并作为结果返回**（`aiSdk.ts` 里 `execute` 已 try/catch 返回 `{ error }`）。直接把异常抛给 AI SDK 会被当成致命错误、直接中断整段流式对话。
2. 部署缺失的能力用 `buildTools({ ... })` 裁剪掉，别让模型调用注定失败的工具。

### 脚本两种模式（自动识别）

`core/script/types.ts::isOverrideScript` 检测脚本里是否出现 `function main(`：

- **transform**：`return nodes`，只变换节点；分组/规则来自转换档配置。
- **override**：`main(config)` 收完整 Clash 配置、返回完整配置（兼容 Sub-Store 生态）。此时转换档里的分组/规则被忽略，但「节点处理（operations）」仍在脚本前生效，两者共存。

边缘（QuickJS）只支持同步脚本。

### 存储契约

`storage/types.ts::Storage` 全异步。三个实现必须行为一致，由 `storage/storage-contract.test.ts` 用同一组用例覆盖（其中 D1 用 better-sqlite3 伪造）。

**新增字段/列时要同步改五处**，漏一处就会线上炸：

1. `storage/types.ts` 类型
2. `storage/memory.ts`（一般无需改）
3. `storage/sqlite.ts`：`CREATE TABLE` 加列 **且** 加 `PRAGMA table_info` 守卫的 `ALTER`（兼容既有本地库）
4. `storage/d1.ts`：INSERT/SELECT（JSON 字段需自行序列化/解析）
5. 新建 `packages/server/migrations/000N_*.sql`，**并把文件名加进 `storage-contract.test.ts` 的伪造 D1 迁移列表**

版本快照里 `script` 用 `null` 哨兵表示「无脚本」——`JSON.stringify` 会丢弃 `undefined`，否则回滚无法清空脚本（见 `service.ts::saveProfileWithVersion` / `rollbackProfile`）。

### 鉴权与安全

管理接口**失败关闭**：设了 `ADMIN_TOKEN` 则校验；未设且未显式 `SUBFORGE_ALLOW_NO_AUTH=1` 时 `/api/*` 一律 503。分享出口 `/sub/:token` 始终公开，不受影响。

抓取订阅 URL 前必须过 `net.ts::assertPublicHttpUrl`（SSRF 防护：拒绝 localhost / 私网 / `169.254.169.254` 等）。任何新增的「抓取用户提供的 URL」的代码都要走这个函数。

注意 `NodeVmRunner` 不是强安全边界（`node:vm`），仅适用于单人自用；QuickJS（边缘）才是真隔离。

## Cloudflare 部署的坑

- **必须用 `npm run cf:release`**，不要直接 `wrangler deploy`。仓库里的 `wrangler.jsonc` 存的是占位符 `REPLACE_WITH_YOUR_D1_ID`；真实 account_id / database_id 放在 gitignored 的 `packages/server/.cf-release.json`（或环境变量）。该脚本临时注入 id → 构建 → 拷贝 wasm → 应用 D1 远程迁移 → 部署 → **无论成败都还原占位符**。真实 id 绝不能进仓库。
- **QuickJS wasm 必须内联进 worker**：workerd 禁止运行时从字节编译 wasm。`scripts/copy-quickjs-wasm.mjs` 把 `.wasm` 拷到 `src/quickjs.wasm`（gitignored，属生成物），`worker.ts` 以 `CompiledWasm` 形式 import 并通过 `newVariant(releaseSyncVariant, { wasmModule })` 注入。不要改回运行时加载。
- `QuickJsRunner` 实例放在 **worker 模块作用域**（非 `fetch` 内），让 WASM 模块在同一 isolate 内跨请求复用。
- 本仓库开发宿主 glibc 2.31 跑不了 workerd；需要 `wrangler dev` 时在 `node:22-bookworm` 容器内跑（见 `docs/DEPLOY_CLOUDFLARE.md`）。
- `wrangler deploy` 会覆盖不在配置里的环境变量。Agent 的 `OPENAI_*` 与 `ADMIN_TOKEN` 要用 `wrangler secret put` 设置（secret 才能在重新部署后留存），不要在 dashboard 里设成明文 Variables。

## 前端

Mantine **v7**（不是 v9：v9 要求 React 19，本项目是 React 18）。设计语言集中在 `src/theme.ts`（浅色 Linear 风 + violet 主色，浅色默认 + 暗色切换），`styles.css` 只保留聊天气泡 / Markdown / Monaco 包裹等少量全局样式，其余走 Mantine 组件与 CSS 变量。

Agent 对话面板（`components/AgentChatPanel.tsx`）走 SSE（`POST /api/agent/stream`）：注意 `height` prop **不能设默认值**——默认参数会把显式传入的 `undefined` 变成数值，导致填充模式失效。

## 文档

- `docs/IMPLEMENTATION_PLAN.md`：分阶段实现计划与抽象设计
- `docs/DEPLOY_CLOUDFLARE.md`：Cloudflare 部署步骤、限制与验证状态
