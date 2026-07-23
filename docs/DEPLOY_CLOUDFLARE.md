# 部署到 Cloudflare Workers

SubForge 支持两种部署形态，共享同一套 `core` 逻辑与工具：

| | Node 自托管（Docker） | Cloudflare Workers |
|---|---|---|
| 存储 | sqlite（`SqliteStorage`） | D1（`D1Storage`） |
| 脚本沙箱 | node:vm（`NodeVmRunner`） | QuickJS-wasm（`QuickJsRunner`，仅同步脚本） |
| 前端 | 后端托管 dist | `assets` 绑定托管 dist（SPA） |
| 节点测活 | ✅（node:net） | ❌ 不支持（边缘无原始 TCP），端点返回 501 |
| Agent | ✅ | ✅（同 OpenAI 兼容接口） |
| 远端 MCP | ✅（Streamable HTTP） | ✅（Streamable HTTP，不含 `test_nodes`） |

## 步骤

```bash
# 1. 构建 core 与前端
npm run build -w @subforge/core
npm run build -w @subforge/web

cd packages/server

# 2. 创建 D1，把输出的 database_id 填进 wrangler.jsonc
npx wrangler d1 create subforge

# 3. 配置两个引导 secret（模型 / 联网工具 / MCP 口令改在 Web「设置」页里配）
npx wrangler secret put ADMIN_TOKEN    # 管理接口口令
npx wrangler secret put SETTINGS_KEY   # 加密库里密钥字段的主密钥，如 openssl rand -base64 32

# 4. 在 packages/server/.cf-release.json 配置 account_id / database_id
# 5. 构建、迁移并部署（唯一推荐方式）
npm run cf:release
```

本地开发：`npm run cf:migrate:local` 后 `npm run cf:dev`。

> ⚠️ **务必用 `wrangler secret put` 设置 `ADMIN_TOKEN` / `SETTINGS_KEY`，不要在 dashboard 里设「明文变量(Variables)」。**
> `wrangler deploy` 会用配置文件里的 `vars` 覆盖明文变量——配置里没有的会被清空；而加密 secret 跨部署保留。
> 一键发布：`npm run cf:release`（见下）。
>
> `SETTINGS_KEY` 换掉之后，D1 里已存的密钥（模型 API Key、MCP 口令）会全部解不开，
> 需要在「设置」页重填一次。Agent 与远端 MCP 在此期间失败关闭，不会带着半截配置乱跑。

## 说明与限制

- **脚本沙箱**：边缘用 QuickJS-wasm，**仅支持同步脚本**（不支持 `await`）；`utils` 通过 host 桥调用与 Node 端完全相同的实现（跨桥参数走 JSON，故正则请用字符串形式传给 `utils.keep/drop`）。
- **测活**：`/api/profiles/:id/healthcheck` 与 `test_nodes` 工具依赖原始 TCP（node:net），边缘不可用（返回 501）；需要测活请用 Node 部署。
- **远端 MCP**：在「设置」页填好 MCP 口令后通过 `/mcp` 提供 Streamable HTTP（即时生效，不用重新部署）；边缘部署会从工具列表中移除 `test_nodes`。token 仅通过 `Authorization: Bearer` 传递。
- **运行时设置**：模型、联网工具、MCP 口令存在 D1 的 `kv` 表里（密钥经 AES-GCM 加密），每个请求现读，所以多 isolate 之间不会出现配置不一致。
- **wasm 载入**：workerd 禁止运行时从字节编译 wasm，故构建时把 QuickJS 的 `.wasm` 作为 CompiledWasm 模块 `import` 进来（启动期编译），再经 `newVariant({ wasmModule })` 注入。`.wasm` 需位于 worker 包内，`npm run cf:dev` / `cf:deploy` 会用 `precf:*` 钩子自动把它从 node_modules 拷到 `src/quickjs.wasm`（已 gitignore）。

## 验证状态

已在 **workerd（`node:22-bookworm` 容器内 `wrangler dev`）实测通过**：
- ✅ D1 建表迁移 + 订阅/转换档的写入与读取
- ✅ QuickJS-wasm 沙箱在 workerd 内执行转换脚本（脚本剔除节点后 `/sub/:token` 输出正确的 Mihomo 配置）
- ✅ 管理 API / 分享出口 / 静态资源路由

（本仓库开发宿主 glibc 2.31 无法直接跑 workerd，故用 bookworm 容器验证；D1 逻辑另有「sqlite 伪造 D1」的存储契约单测。）
