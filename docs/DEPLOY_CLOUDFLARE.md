# 部署到 Cloudflare Workers

SubForge 支持两种部署形态，共享同一套 `core` 逻辑与工具：

| | Node 自托管（Docker） | Cloudflare Workers |
|---|---|---|
| 存储 | sqlite（`SqliteStorage`） | D1（`D1Storage`） |
| 脚本沙箱 | node:vm（`NodeVmRunner`） | QuickJS-wasm（`QuickJsRunner`，仅同步脚本） |
| 前端 | 后端托管 dist | `assets` 绑定托管 dist（SPA） |
| 节点测活 | ✅（node:net） | ❌ 不支持（边缘无原始 TCP），端点返回 501 |
| Agent | ✅ | ✅（同 OpenAI 兼容接口） |

## 步骤

```bash
# 1. 构建 core 与前端
npm run build -w @subforge/core
npm run build -w @subforge/web

cd packages/server

# 2. 创建 D1，把输出的 database_id 填进 wrangler.jsonc
npx wrangler d1 create subforge

# 3. 建表
npm run cf:migrate:remote      # = wrangler d1 migrations apply subforge --remote

# 4.（可选）配置 Agent 与管理口令
npx wrangler secret put OPENAI_BASE_URL
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put OPENAI_MODEL
npx wrangler secret put ADMIN_TOKEN

# 5. 部署
npm run cf:deploy              # = wrangler deploy
```

本地开发：`npm run cf:migrate:local` 后 `npm run cf:dev`。

> ⚠️ **务必用 `wrangler secret put` 设置 `OPENAI_*` / `ADMIN_TOKEN`，不要在 dashboard 里设「明文变量(Variables)」。**
> `wrangler deploy` 会用配置文件里的 `vars` 覆盖明文变量——配置里没有的会被清空；而加密 secret 跨部署保留。
> 一键发布：`npm run cf:release`（见下）。

## 说明与限制

- **脚本沙箱**：边缘用 QuickJS-wasm，**仅支持同步脚本**（不支持 `await`）；`utils` 通过 host 桥调用与 Node 端完全相同的实现（跨桥参数走 JSON，故正则请用字符串形式传给 `utils.keep/drop`）。
- **测活**：`/api/profiles/:id/healthcheck` 与 `test_nodes` 工具依赖原始 TCP（node:net），边缘不可用（返回 501）；需要测活请用 Node 部署。
- **wasm 载入**：workerd 禁止运行时从字节编译 wasm，故构建时把 QuickJS 的 `.wasm` 作为 CompiledWasm 模块 `import` 进来（启动期编译），再经 `newVariant({ wasmModule })` 注入。`.wasm` 需位于 worker 包内，`npm run cf:dev` / `cf:deploy` 会用 `precf:*` 钩子自动把它从 node_modules 拷到 `src/quickjs.wasm`（已 gitignore）。

## 验证状态

已在 **workerd（`node:22-bookworm` 容器内 `wrangler dev`）实测通过**：
- ✅ D1 建表迁移 + 订阅/转换档的写入与读取
- ✅ QuickJS-wasm 沙箱在 workerd 内执行转换脚本（脚本剔除节点后 `/sub/:token` 输出正确的 Mihomo 配置）
- ✅ 管理 API / 分享出口 / 静态资源路由

（本仓库开发宿主 glibc 2.31 无法直接跑 workerd，故用 bookworm 容器验证；D1 逻辑另有「sqlite 伪造 D1」的存储契约单测。）
