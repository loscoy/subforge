# SubForge 实现计划

> 一个自托管、可编程、Agent 友好的代理订阅转换/管理工具。
> 目标：比 Sub-Store 更轻，专注「订阅转换 + 自定义规则/组 + 转换脚本 + AI Agent」，其余不做。

## 实现状态（v0.1.0）

- **Phase 1 端到端闭环** ✅ 已完成（解析 6 协议 → Mihomo 渲染 → sqlite → 抓取/缓存 → `/sub/:token`，含 Docker）
- **Phase 2 可编程** ✅ 已完成（node:vm 沙箱 + 脚本 API/`.d.ts` + Monaco 编辑器 + 实时预览 + 组/规则 + 版本历史/回滚）
- **Phase 3 Agent** ✅ 已完成（框架无关工具 registry → 内嵌 AI SDK agent + 记忆 + MCP server）
- **Phase 4 增强** ⏳ 部分（serverless 适配器 / sing-box 等渲染器 / 节点测活 留作后续）
- **测试**：37 个用例全绿（解析 / 渲染 / 沙箱 / 工具 / 路由 / agent-mock）；含端到端冒烟验证。

## 0. 设计基调（已确定的决策）

| 决策点 | 结论 | 理由 |
|---|---|---|
| 运行时 | **TypeScript + Node** | 一份类型喂给运行时校验 / 编辑器补全 / Agent 上下文 |
| 部署 | **MVP 主打 Node 自托管**，serverless 作后续适配器 | 沙箱/存储先做 Node 实现，接口抽象好，不阻塞 MVP |
| 输出格式 | **仅 Mihomo/Clash**，渲染器插件化留坑 | 只做真实使用的格式，加格式=加一个 `Renderer` 文件 |
| Agent 模型 | **兼容 OpenAI 接口**（自定义 baseURL/model/key） | 模型无关，谁都能换 |
| 用户模型 | **单部署者 + Token 分享**，无账号体系 | 开源自部署；转换好的订阅凭 token 短链分享给别人直接用 |
| 前端 | **React** | 已确认 |
| 内嵌 Agent 框架 | **Vercel AI SDK**（主选），封装在 `AgentRunner` 接口后，后续可零成本切 Mastra 等 | 见 §4 |
| Agent 记忆 | **自建 `Memory` 接口 + sqlite 实现**（不绑框架） | 存储层本就有 sqlite，记忆可回退/可迁移 |
| 打包分发 | **Docker**（多阶段构建，一条 `docker run` 起服务） | 自部署首要交付形态 |

## 1. 架构总览

```
packages/
├── core/                  # 纯逻辑，运行时无关，两端复用
│   ├── model.ts           # 统一节点 IR（ProxyNode）
│   ├── parsers/           # 各协议 URI/订阅 → IR
│   ├── renderers/         # IR → 输出格式（先只有 mihomo）
│   ├── script/            # 脚本 API 定义 + 类型（.d.ts 来源）
│   └── pipeline.ts        # 抓取→解析→脚本→组→规则→渲染
├── server/                # Node 后端 (Hono/Fastify)
│   ├── storage/           # Storage 接口 + sqlite 实现
│   ├── sandbox/           # ScriptRunner 接口 + isolated-vm 实现
│   ├── tools/             # ★ 工具注册表（唯一真相来源）
│   ├── agent/             # 内嵌 agent（消费 tools） + MCP server（消费 tools）
│   └── routes/            # 管理 API + /sub/:token 分享出口
└── web/                   # 前端 + Monaco 编辑器 + 预览 + Agent 面板
```

### 核心抽象接口（一开始就定好，保证可扩展 + Agent 友好）

- `Renderer`：`render(ctx: RenderContext): string` —— 加输出格式=实现一个。
- `Storage`：订阅/脚本/组/规则/版本历史的读写 —— Node 用 sqlite，serverless 后续换 KV/D1。
- `ScriptRunner`：`run(code, input): Promise<Result>` —— Node 用 isolated-vm，serverless 后续换 QuickJS-wasm/原生 isolate。
- `Tool`：`{ name, description, schema, handler }` —— **工具注册表**，MCP server 和内嵌 agent 都是它的适配器。
- `AgentRunner`：`run(input, { tools, memory, model }): AsyncIterable<Step>` —— **agent 循环抽象**，AI SDK 是其一个实现，将来可换 Mastra 等，业务层不动。
- `Memory`：`load(threadId)` / `append(threadId, msgs)` / `getWorkingMemory()` / `updateWorkingMemory()` —— **框架无关记忆**，sqlite 实现；换 SDK/存储都不丢记忆。

## 2. 统一节点模型（core/model.ts）

内部 IR `ProxyNode`，所有协议解析成它、所有渲染从它出发。至少覆盖：
`vmess / vless / trojan / ss / hysteria2 / tuic`。字段含通用（name, type, server, port, udp, tls, sni, network...）+ 各协议特有字段 + `_meta`（地区、倍率等打标签用）。

## 3. 分阶段路线图

### Phase 1 — 端到端最小闭环 ⬅️ 先做
- [ ] monorepo 工程化（pnpm workspace + tsconfig + eslint + vitest）
- [ ] `ProxyNode` 模型 + 主流协议 parser
- [ ] Mihomo 渲染器
- [ ] `Storage` 接口 + sqlite 实现（订阅表）
- [ ] 订阅抓取 + 缓存 + 定时刷新
- [ ] `pipeline`：抓取→解析→渲染
- [ ] server：管理 API（增删订阅）+ `/sub/:token` 分享出口
- [ ] **Docker**：多阶段 `Dockerfile`（构建→精简运行镜像）+ `docker-compose.yml`，数据卷挂 sqlite，一条命令起服务
- [ ] 冒烟：加一个真实订阅，`/sub/:token` 输出可用的 Mihomo 配置
- **验收**：Mihomo 客户端能直接吃 `/sub/:token` 的输出并连通。

### Phase 2 — 可编程（直接解决「写脚本没提示、要保存才知道对错」的痛点）
- [ ] `ScriptRunner`（isolated-vm）+ 脚本 API（filter/rename/dedup/add/map 字段）
- [ ] 脚本 API 的 `.d.ts` 生成，供 Monaco 挂载
- [ ] 前端 Monaco 编辑器 + 类型补全 + 悬浮文档
- [ ] **实时预览/Dry-run 面板**：改脚本→对真实节点跑→显示前后节点 + diff
- [ ] 自定义组（手选 / 正则 / 地区自动分组）
- [ ] 自定义规则 + rule-set 引用
- [ ] 版本历史 + 一键回滚（脚本/配置每次改动留快照）
- **验收**：不重启、不猜结果，编辑脚本即时看到节点变化。

### Phase 3 — Agent（分层，工具只定义一次）
- [ ] **工具注册表**（最有价值、最难）：`read/write_config`、`read/write_script`、`run_preview`、`get_nodes`、`list_subscriptions` 等；写操作全部走版本历史，可回滚。
- [ ] **MCP server**：`@modelcontextprotocol/sdk` 包一层注册表 → 你用 Claude Code 即可驱动。
- [ ] **`AgentRunner` 接口 + AI SDK 实现**（见 §4）：消费同一工具注册表 → 网页对话面板，填 OpenAI 兼容 baseURL/key 即用。
- [ ] **`Memory` 接口 + sqlite 实现**：会话历史（线程持久化）+ 工作记忆（跨会话记住用户偏好/项目事实）。AgentRunner 从 Memory 读上下文、写回。语义召回作可选后续。
- [ ] 前端 Agent 面板：展示中间步骤、run_preview 结果、diff、可撤销。
- **验收**：对 agent 说「帮我把香港节点单独分一组并按延迟排序」，它能改脚本/配置、预览、给出可回滚的结果。

### Phase 4 — 增强
- [ ] 节点测活 / 延迟测试（过滤失效、按延迟排序）
- [ ] 订阅流量/到期展示（解析 `subscription-userinfo` 响应头）
- [ ] serverless 适配器（Storage→KV/D1，ScriptRunner→QuickJS-wasm）
- [ ] 更多渲染器（sing-box / Surge / QuantumultX）

## 4. 内嵌 Agent 框架选型

> 架构原则：**工具注册表是唯一真相来源**，MCP server 与内嵌 agent 都只是其适配器，二者共享同一套 `Tool` 定义，无 harness 重复代码。
>
### 结论：主选 Vercel AI SDK，封装在 `AgentRunner` 接口后（可换 Mastra 等）

> 决策：**主选 AI SDK**（最轻、Apache-2.0、`createOpenAICompatible` 原生满足 OpenAI 兼容、streaming 中间步骤最好展示）。为「后续方便切其他 SDK」，**agent 循环本身也抽象成 `AgentRunner` 接口**，AI SDK 只是它的一个实现。
>
> 记忆不依赖框架：记忆分三层——①会话历史 ②**工作记忆**（跨会话记住用户偏好/项目事实，最有价值）③语义召回（非必需）。我们把①②做成**自建 `Memory` 接口 + sqlite 实现**（存储层本就有 sqlite），AgentRunner 从 Memory 读上下文、写回摘要。这样记忆与框架解耦：换 SDK 不丢记忆，换存储不丢记忆。③语义召回作可选后续（接向量库时再加一个 Memory 实现）。
>
> 若将来嫌自建记忆/循环维护成本高，Mastra 是首选升级路径（同 Apache-2.0、构建于 AI SDK，原生记忆 + MCP 暴露）；因 `AgentRunner` 与工具 registry 均框架无关，迁移面很小。下表对比保留供参考。

| 框架 | License | OpenAI 兼容 | tool loop | streaming | 内置 memory | MCP | 活跃度 | 重量 |
|---|---|---|---|---|---|---|---|---|
| **Vercel AI SDK** (v6/v7) | Apache-2.0 | ✅ `createOpenAICompatible` | ✅ `ToolLoopAgent` | ✅ 一流 | ⚠️ 自管 messages | ✅ 双向 | 极高 | 轻 |
| **Mastra** | Apache-2.0 | ✅ | ✅ | ✅ | ✅ 强项 | ✅ 原生暴露 MCP | 高 | 中偏重 |
| OpenAI Agents SDK JS | MIT | ✅ | ✅ | ✅ | ⚠️ 无 | ✅ | 高 | 轻 |
| LangGraph.js | MIT | ✅ | ✅ 图式 | ✅ | ✅ | ✅ | 高 | 重（门槛高） |
| LlamaIndex.TS | MIT | ✅ | ✅ | ✅ | ⚠️ 偏 RAG | ✅ | 中高 | 中 |
| Pydantic AI | — | — | — | — | — | — | **无 TS 版，淘汰** | — |

**主选 Vercel AI SDK**：最轻、Apache-2.0、`createOpenAICompatible` 原生满足「OpenAI 兼容 + 模型无关」硬约束；`ToolLoopAgent` 开箱多步循环；streaming 是看家本领，最容易把工具调用/`run_preview` 结果作为流式中间步骤推给 UI。唯一短板 memory 需自管——但改配置/脚本这种场景上下文简单，自管 messages 反而更可控。

**次选 Mastra**：同 Apache-2.0、纯 TS。当需要**内置对话/语义记忆**、可视化调试、以及**框架原生把工具/agent 暴露成 MCP server**时再上。底层仍复用 AI SDK provider，"先 AI SDK，复杂了再升 Mastra"是平滑演进路径。

**淘汰/不推荐**：Pydantic AI（无 TS 版）；LangGraph.js（图式编排对「改配置的简单多步 agent」过重）；LlamaIndex.TS（重心 RAG）。OpenAI Agents SDK 为合格第三选择。

### 工具复用的关键实现（本项目架构核心）

**无论用哪个框架，工具定义都抽象成框架无关的 registry**，framework 只是薄适配层：

```ts
// tools/registry.ts —— 唯一真相来源
interface Tool<I> {
  name: string
  description: string
  schema: ZodType<I>          // zod，可转 JSON Schema 供 MCP
  handler: (input: I) => Promise<unknown>
}
```

- **内嵌 agent 侧**：`map` 成 AI SDK 的 `tool({ description, inputSchema, execute })`，喂给 `ToolLoopAgent`。
- **MCP server 侧**：用 `@modelcontextprotocol/sdk` 的 `server.tool(name, schema, handler)` 注册同一批；zod schema 经 `zod-to-json-schema` 转换。

一份 handler + 一份 zod schema，两处薄封装注册。将来即使从 AI SDK 迁到 Mastra，**工具层零改动**。写操作（`write_config`/`write_script`）在 handler 内统一走版本历史，两个入口自动都可回滚。

## 5. 部署形态

- **Docker 为首要交付**：多阶段构建（builder 装依赖/编译 → runner 只带产物 + 生产依赖，基于 `node:22-alpine`），前端静态资源由后端托管，单容器单端口。
- `docker-compose.yml`：挂 `./data:/app/data` 持久化 sqlite；环境变量注入 OpenAI 兼容 `baseURL/model/key` 与管理口令。
- 非 Docker 用户仍可 `pnpm build && node` 直跑。
- serverless 适配器（Storage→D1/KV、ScriptRunner→QuickJS-wasm）为 Phase 4，不影响 Docker 主线。

## 6. 待确认

1. 项目名 `subforge` 是否可接受（可改）。
