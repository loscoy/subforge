# ⚙️ SubForge

自托管的代理订阅转换 / 管理工具。把机场订阅或手工节点转换成 Mihomo/Clash、sing-box、Surge 配置，支持自定义分组、分流规则与 JS 转换脚本。

范围有意收窄，只做四件事：订阅转换、自定义规则 / 组、转换脚本、AI Agent 辅助。

编写脚本时的反馈链路是本项目着力的地方：编辑器挂载类型定义（`.d.ts`）提供补全与类型提示，改动后自动对真实节点跑预览、显示处理前后的节点变化与 `console` 日志，每次改动自动快照可回滚。可选的内置 Agent 能按自然语言描述修改脚本与分组规则，同一套操作也以 MCP server 暴露，可用外部 agent 驱动。

---

## 功能

- **订阅转换**：解析 `vmess / vless / trojan / ss / hysteria2 / tuic`（URI、整段 base64、**或 Clash/Mihomo YAML** 订阅），输出 **Mihomo/Clash、sing-box、Surge**（渲染器插件化，`?target=` 切换）。
- **自定义组**：`select / url-test / fallback / load-balance`，成员支持 `includeAll`、正则 `filter` / `excludeFilter`、显式 `proxies`。
- **自定义规则 / 规则集**：内联 rules + 远程 rule-providers。
- **转换脚本**：在受限沙箱里跑 JS，内置 `utils`（去重 / 正则保留剔除 / 地区打标签 / 唯一命名等）。
- **实时预览**：编辑即见处理前后节点与 `console` 日志。
- **订阅流量 / 到期**：解析 `subscription-userinfo` 头，展示已用/总量与到期时间。
- **节点测活 / 延迟**：TCP 连接测速，按延迟排序、标记失效（也作为 `test_nodes` agent 工具）。
- **版本历史 / 回滚**：脚本与配置每次改动自动快照。
- **Token 分享**：每个转换档一个短链 `/sub/:token`，转换好的订阅直接分享给别人用，无需账号。
- **AI Agent**：兼容 OpenAI 接口，带**跨会话记忆**；同一套工具还通过带独立 Bearer token 的远端 **MCP server** 暴露，可用 Claude Code、Codex 等直接驱动。

## 架构

单一仓库（npm workspaces）三个包，关键抽象均为可替换接口：

| 抽象 | 作用 | 当前实现 | 可替换为 |
|---|---|---|---|
| `Renderer` | 节点 → 输出格式 | Mihomo / sing-box / Surge | QuantumultX … |
| `Storage` | 持久化 | sqlite / 内存 / **D1** | KV … |
| `ScriptRunner` | 脚本沙箱 | node:vm / **QuickJS-wasm** | isolated-vm … |
| `AgentRunner` | agent 循环 | Vercel AI SDK | Mastra … |
| `Memory` | agent 记忆 | sqlite | 向量库（语义召回） |
| `Tool` registry | 工具集（唯一真相来源） | — | 同时供内嵌 agent 与 MCP server |

详见 [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)。

## 快速开始

### Docker（推荐）

```bash
cp .env.example .env   # 按需填 ADMIN_TOKEN / MCP_TOKEN / OPENAI_*
docker compose up -d
# 打开 http://localhost:8787
```

### 本地开发

```bash
npm install
npm run dev:server     # 后端 :8787
npm run dev:web        # 前端 :5173（开发代理到后端）
npm test               # 运行全部测试
```

### Cloudflare Workers（serverless）

D1 存储 + QuickJS-wasm 沙箱 + assets 托管前端。见 [`docs/DEPLOY_CLOUDFLARE.md`](docs/DEPLOY_CLOUDFLARE.md)。
边缘部署不支持节点测活（无原始 TCP）；脚本仅支持同步。

## 环境变量

| 变量 | 说明 |
|---|---|
| `PORT` | 服务端口（默认 8787） |
| `DB_PATH` | sqlite 路径（默认 `./data/subforge.sqlite`） |
| `ADMIN_TOKEN` | 管理接口口令（Bearer / `X-Admin-Token`）。**强烈建议设置**：未设时管理接口默认锁定（返回 503） |
| `SUBFORGE_ALLOW_NO_AUTH` | 设为 `1` 时，允许在未设 `ADMIN_TOKEN` 的情况下无鉴权提供管理接口（仅限本地自用，切勿暴露公网） |
| `MCP_TOKEN` | 远端 MCP 的 Bearer token。未设时 `/mcp` 默认锁定（返回 503） |
| `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL` | Agent 用的兼容 OpenAI 接口；不填则 Agent 禁用 |

> 安全说明：管理接口默认**失败关闭**——既未设 `ADMIN_TOKEN` 也未设 `SUBFORGE_ALLOW_NO_AUTH=1` 时，`/api/*` 一律返回 503（分享出口 `/sub/:token` 不受影响，仍公开）。远端 MCP 使用独立的 `MCP_TOKEN`，不受无鉴权模式影响。抓取订阅 URL 时会做 SSRF 防护，拒绝 `localhost`/内网/`169.254.169.254`(云元数据) 等地址。

## 用 Claude Code / Codex 驱动（MCP）

同一套工具同时支持远端 Streamable HTTP 与本地 stdio。工具具有修改脚本、配置与版本的管理权限，请把 MCP token 视同管理员凭据。

### 远端 Streamable HTTP

设置 `MCP_TOKEN` 并重启服务后，端点为 `https://你的域名/mcp`。Claude Code 可这样连接：

```bash
claude mcp add --transport http subforge "https://subforge.example.com/mcp" \
  --header "Authorization: Bearer <MCP_TOKEN>"
```

Codex 推荐从环境变量读取 token，避免把凭据直接写入 Codex 配置文件：

```bash
export SUBFORGE_MCP_TOKEN="<MCP_TOKEN>"
codex mcp add subforge --url "https://subforge.example.com/mcp" \
  --bearer-token-env-var SUBFORGE_MCP_TOKEN
```

也可以直接编辑 `~/.codex/config.toml`（受信任项目可改用 `.codex/config.toml`）：

```toml
[mcp_servers.subforge]
url = "https://subforge.example.com/mcp"
bearer_token_env_var = "SUBFORGE_MCP_TOKEN"
```

同一台主机上的 ChatGPT 桌面应用、Codex CLI 与 IDE 扩展共享这份 Codex MCP 配置。

通用 HTTP 客户端配置：

```json
{
  "mcpServers": {
    "subforge": {
      "type": "http",
      "url": "https://subforge.example.com/mcp",
      "headers": { "Authorization": "Bearer <MCP_TOKEN>" }
    }
  }
}
```

管理界面的“MCP”页面会按当前域名生成实际端点，并提供 Claude Code、Codex 与通用 JSON 配置，同时列出当前运行时可用的工具。固定 Bearer token 适用于支持自定义 HTTP header 的客户端；只接受 OAuth 的托管客户端暂不支持。`MCP_TOKEN` 与 `SUBFORGE_MCP_TOKEN` 都不要提交进仓库。

### 本地 stdio

stdio 模式直接访问同一个 sqlite 文件，不需要 `MCP_TOKEN`：

```json
{
  "mcpServers": {
    "subforge": {
      "command": "node",
      "args": ["packages/server/dist/mcp/stdio.js"],
      "env": { "DB_PATH": "/path/to/data/subforge.sqlite" }
    }
  }
}
```

## 转换脚本（两种模式，自动识别）

**1. transform（节点变换）** — 只处理节点列表，分组/规则在转换档配置里设：

```js
// 可用全局：nodes、utils、console、params（编辑器内有补全）
let ns = utils.tagRegions(nodes)
ns = utils.dedupe(ns)
ns = utils.drop(ns, /过期|剩余|官网/)
return ns
```

**2. override（覆写）** — 兼容 Sub-Store/mihomo 生态脚本：脚本定义 `main(config)`，接收完整 Clash 配置、返回完整配置（自行生成 proxy-groups / rules / dns 等）。**脚本里出现 `function main(` 即自动按 override 执行**，此时转换档里的分组/规则被忽略、以脚本产出为准。

```js
function main(config) {
  const proxies = config.proxies || []
  // ...按需生成分组与规则...
  return { proxies, 'proxy-groups': [...], rules: [...] }
}
```

> override 模式在边缘（QuickJS）仅支持同步脚本；`$arguments` 对应转换档参数。像 [powerfullz/override-rules](https://github.com/powerfullz/override-rules) 这类脚本可直接使用。

## License

MIT
