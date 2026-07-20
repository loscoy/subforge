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

## 说明与限制

- **脚本沙箱**：边缘用 QuickJS-wasm，**仅支持同步脚本**（不支持 `await`）；`utils` 通过 host 桥调用与 Node 端完全相同的实现，行为一致。绝大多数转换脚本是同步的。
- **测活**：`/api/profiles/:id/healthcheck` 与 `test_nodes` 工具依赖原始 TCP（node:net），边缘不可用；需要测活请用 Node 部署。
- **验证状态**：D1 适配器已用「better-sqlite3 伪造 D1」跑通存储契约测试；Worker 入口已通过 `wrangler deploy --dry-run` 打包验证（含 QuickJS wasm）。在 workerd 上的运行时验证需实际 `wrangler dev`/部署（本仓库开发环境 glibc 过旧无法本地跑 workerd）。
