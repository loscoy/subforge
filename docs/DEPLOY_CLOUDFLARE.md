# 部署到 Cloudflare Workers

SubForge 支持两种部署形态，共享同一套 `core` 逻辑与工具：

| | Node 自托管（Docker） | Cloudflare Workers |
|---|---|---|
| 存储 | sqlite（`SqliteStorage`） | D1（`D1Storage`） |
| 脚本沙箱 | QuickJS-wasm（`QuickJsRunner`） | QuickJS-wasm（`QuickJsRunner`） |
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

# 3. 配置引导 secret（模型 / 联网工具 / MCP 口令改在 Web「设置」页里配）
npx wrangler secret put SETTINGS_KEY   # 加密库里密钥字段的主密钥，如 openssl rand -base64 32

# 4. 在 packages/server/.cf-release.json 配置 account_id / database_id
# 5. 构建、迁移并部署（唯一推荐方式）
npm run cf:release
```

本地开发：`npm run cf:migrate:local` 后 `npm run cf:dev`。

> ⚠️ **务必用 `wrangler secret put` 设置 `SETTINGS_KEY`，不要在 dashboard 里设「明文变量(Variables)」。**
> `wrangler deploy` 会用配置文件里的 `vars` 覆盖明文变量——配置里没有的会被清空；而加密 secret 跨部署保留。
> 一键发布：`npm run cf:release`（见下）。
>
> `SETTINGS_KEY` 换掉之后，D1 里已存的密钥（模型 API Key、MCP 口令）会全部解不开，
> 需要在「设置」页重填一次。Agent 与远端 MCP 在此期间失败关闭，不会带着半截配置乱跑。

## 用 GitHub Actions 发布（推荐）

`.github/workflows/deploy.yml`：合并到 `main` 后自动跑「typecheck + test → 构建 → D1 迁移 → 部署」，也可以在 Actions 页面手动触发。

从 GitHub 的机器出网，**不受本地网络影响**——本地 wrangler 频繁报 520/522（`Received a malformed response from the API`）时基本都是本机到 `api.cloudflare.com` 的链路问题，走 CI 可以直接绕开。判断方法：

```bash
for i in 1 2 3 4 5; do curl -sS -m 15 -o /dev/null -w "%{http_code} %{time_total}s\n" https://api.cloudflare.com/client/v4/user/tokens/verify; done
```

五次都返回 `400` 才算链路正常（400 是预期的，表示打通了只是没带鉴权）；出现 5xx 或超时就说明该走 CI 或换出口节点。

在仓库 Settings → Secrets and variables → Actions 配三个 secret：

| Secret | 说明 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 权限需要 Workers Scripts:Edit + D1:Edit + Account Settings:Read |
| `CLOUDFLARE_ACCOUNT_ID` | 账号 id |
| `D1_DATABASE_ID` | `wrangler d1 create subforge` 生成的库 id |

注意：

- 这三个都不进仓库，`wrangler.jsonc` 里存的仍是占位符。工作流最后会校验占位符已还原、`git diff` 为空，防止将来改坏还原逻辑把真实 id 带进提交。
- `SETTINGS_KEY` 一类的 **Worker secret 不放 CI**，用 `wrangler secret put` 单独设置一次即可，重新部署会保留。
- 想改成「合并后等人点确认再发布」：Settings → Environments → `production` 加 required reviewers。不加则保持自动发布。

### 公开仓库的安全边界

本仓库是公开的，自动部署又持有生产环境的 token，所以触发条件是刻意选的：

**只用 `push: main` 与 `workflow_dispatch`，两者都要求仓库写权限。** 来自 fork 的 `pull_request` 按 GitHub 规则**一律不下发 secret**，所以陌生人开 PR 改工作流去偷 token 这条路是堵死的。

> ⚠️ 绝不要为了「给 PR 也跑一次部署」而加 `pull_request_target` 或 `issue_comment` 触发器。
> 这两个会**带着 secret 执行 PR 分支上的代码**，等于把 token 交给任何能开 PR 的人。这是 GitHub Actions 最经典的一类提权漏洞。

真正的风险不在陌生人，而在**你自己合并了别人的 PR**——那份代码会自动带着 token 在 CI 里跑。改 `package-lock.json` 指向一个恶意包就够了，不需要动工作流。所以：

- 接受外部贡献前，`package-lock.json` 的改动要单独看一眼
- 一旦开始收外部 PR，就该给 `production` 环境加 required reviewers
- 建议保护 `main` 分支（要求 PR、禁止 force push），否则任何拿到写权限的途径都能直接推上去触发部署

工作流内部已做的收敛：

- `permissions: contents: read`——工作流不写仓库任何东西
- `persist-credentials: false`——不把 `GITHUB_TOKEN` 落到 `.git/config`，构建期的任意代码就少一个可偷的凭据
- secret 只出现在真正需要它的发布步骤；「检查是否齐全」那步拿到的是布尔值而非明文
- `npm ci` 单独成步，运行时环境里没有 token

Cloudflare token 侧建议：设过期时间，权限只勾 Workers Scripts:Edit + D1:Edit + Account Settings:Read，并在 token 编辑页把资源范围限定到这一个账号（可能的话限定到 `subforge` 这一个 Worker 与这一个 D1）。万一泄漏，影响面就只有这个项目。

## 说明与限制

- **脚本沙箱**：Node 与边缘都用 QuickJS-wasm。支持 `async` / `await`（含 Sub-Store 风格的 `async function main(config)`），但沙箱内**没有异步 I/O**——不提供 fetch 与 timer，`await` 一个永远不会完成的 promise 会立即报错而不是挂住。`utils` 通过 host 桥调用同一实现（跨桥参数走 JSON，故正则请用字符串形式传给 `utils.keep/drop`）。
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
