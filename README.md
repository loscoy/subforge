# ⚙️ SubForge

自托管、可编程、**Agent 友好**的代理订阅转换 / 管理工具。

比 Sub-Store 更轻，只专注四件事：**订阅转换**、**自定义规则 / 组**、**转换脚本**、**AI Agent 辅助**。

> 核心卖点：写自定义分组 / 规则脚本时，不再「盲写—保存—看结果」。
> - 编辑器挂载类型定义（`.d.ts`），**有自动补全和类型提示**；
> - 改脚本**实时对真实节点跑预览**，立刻看到前后节点变化；
> - 内置 **Agent**，直接对它说需求，它帮你改脚本 / 改分组规则，改前预览、改动可回滚。

---

## 功能

- **订阅转换**：解析 `vmess / vless / trojan / ss / hysteria2 / tuic`（URI 或整段 base64），输出 **Mihomo/Clash、sing-box、Surge**（渲染器插件化，`?target=` 切换）。
- **自定义组**：`select / url-test / fallback / load-balance`，成员支持 `includeAll`、正则 `filter` / `excludeFilter`、显式 `proxies`。
- **自定义规则 / 规则集**：内联 rules + 远程 rule-providers。
- **转换脚本**：在受限沙箱里跑 JS，内置 `utils`（去重 / 正则保留剔除 / 地区打标签 / 唯一命名等）。
- **实时预览**：编辑即见处理前后节点与 `console` 日志。
- **订阅流量 / 到期**：解析 `subscription-userinfo` 头，展示已用/总量与到期时间。
- **节点测活 / 延迟**：TCP 连接测速，按延迟排序、标记失效（也作为 `test_nodes` agent 工具）。
- **版本历史 / 回滚**：脚本与配置每次改动自动快照。
- **Token 分享**：每个转换档一个短链 `/sub/:token`，转换好的订阅直接分享给别人用，无需账号。
- **AI Agent**：兼容 OpenAI 接口，带**跨会话记忆**；同一套工具还暴露为 **MCP server**，可用 Claude Code 等直接驱动。

## 架构

单一仓库（npm workspaces）三个包，关键抽象均为可替换接口：

| 抽象 | 作用 | 当前实现 | 可替换为 |
|---|---|---|---|
| `Renderer` | 节点 → 输出格式 | Mihomo / sing-box / Surge | QuantumultX … |
| `Storage` | 持久化 | sqlite / 内存 | D1 / KV（serverless） |
| `ScriptRunner` | 脚本沙箱 | node:vm | isolated-vm / QuickJS-wasm |
| `AgentRunner` | agent 循环 | Vercel AI SDK | Mastra … |
| `Memory` | agent 记忆 | sqlite | 向量库（语义召回） |
| `Tool` registry | 工具集（唯一真相来源） | — | 同时供内嵌 agent 与 MCP server |

详见 [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)。

## 快速开始

### Docker（推荐）

```bash
cp .env.example .env   # 按需填 ADMIN_TOKEN / OPENAI_*
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

## 环境变量

| 变量 | 说明 |
|---|---|
| `PORT` | 服务端口（默认 8787） |
| `DB_PATH` | sqlite 路径（默认 `./data/subforge.sqlite`） |
| `ADMIN_TOKEN` | 管理接口口令；留空则不鉴权（仅建议本地） |
| `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL` | Agent 用的兼容 OpenAI 接口；不填则 Agent 禁用 |

## 用 Claude Code 等驱动（MCP）

同一套工具也以 MCP server 暴露。把下面加进你的 MCP 客户端配置即可用自己的 agent 操作 SubForge：

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

## 转换脚本示例

```js
// 按地区打标签、去重、剔除无用节点
let ns = utils.tagRegions(nodes)
ns = utils.dedupe(ns)
ns = utils.drop(ns, /过期|剩余|官网/)
return ns
```

可用全局：`nodes`、`utils`、`console`、`params`（编辑器内有完整补全）。

## License

MIT
