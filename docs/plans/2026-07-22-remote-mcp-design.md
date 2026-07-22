# 远端 MCP 设计

## 目标

在保留本地 stdio MCP 的同时，为 Node 与 Cloudflare Workers 部署提供同一套带口令的远端 MCP，并在管理界面中提供清晰的连接信息。

## 方案选择

采用独立的预共享口令 `MCP_TOKEN` 和 MCP Streamable HTTP 传输。相比复用 `ADMIN_TOKEN`，独立口令可以单独吊销和轮换，避免把浏览器管理凭据交给外部 Agent；相比首版直接实现 OAuth 2.1，预共享 Bearer token 更适合当前单用户、自托管定位，部署和维护成本也更低。

OAuth 2.1 不在本次范围内。需要自定义请求头的客户端可以直接使用远端 MCP；只接受 OAuth 的托管客户端暂不支持。

## 服务端架构

- 新增 `/mcp`，使用 `WebStandardStreamableHTTPServerTransport`。
- 采用无状态模式，每个 HTTP 请求创建新的 transport 和 `McpServer`。现有工具状态均存储在 SQLite/D1 中，不需要内存会话或 Durable Object。
- `/mcp` 仅在配置 `MCP_TOKEN` 后启用。缺少口令时返回 503，错误或缺失 Bearer token 时返回 401，并携带 `WWW-Authenticate: Bearer`。
- 无状态端点只接受 POST；GET 与 DELETE 返回 405，避免建立无法接收后续消息的空 SSE 流。
- `SUBFORGE_ALLOW_NO_AUTH` 只影响 `/api/*`，绝不放开 `/mcp`。
- 只接受 `Authorization: Bearer <MCP_TOKEN>`，不在查询参数中接受 token，避免口令进入 URL、日志和历史记录。
- stdio MCP 保持现状，不要求 `MCP_TOKEN`。

`createMcpServer` 根据注入能力调用 `buildTools({ checkNodes })`。Node 远端 MCP 包含 `test_nodes`；Workers 因未注入 `checkNodes` 而不注册该工具。

## Cloudflare Workers

MCP SDK 的 Web Standard transport 直接处理 Fetch API 的 `Request`/`Response`，因此同一个 Hono 路由可同时用于 Node 22 与 Workers。Wrangler 静态资源配置需要把 `/mcp` 加入 `run_worker_first`，确保请求进入 Worker 而不是 SPA fallback。

`MCP_TOKEN` 作为 Worker secret 配置，不写入 `wrangler.jsonc` 或仓库文件。

## 管理界面

新增“MCP”导航页。页面从已鉴权的 `/api/meta` 获取远端 MCP 是否启用、固定路径 `/mcp`，以及当前运行时可用的工具名称与说明。

页面根据 `window.location.origin` 生成完整端点，展示 Streamable HTTP、Bearer 鉴权要求、Claude Code 配置命令和通用 JSON 示例。服务端只返回启用状态，不返回 `MCP_TOKEN`；示例中保留占位符。

## 错误处理与安全

- MCP handler 内的工具异常继续转换为 `isError` 结果，避免终止客户端会话。
- 认证在解析 MCP 请求体之前执行。
- token 先散列为固定长度，再使用 Workers 原生常量时间比较或 Node 固定长度回退比较。
- 不为 `/mcp` 开启通配 CORS；远端 MCP 主要为服务端客户端使用。
- 工具具有读取订阅 URL、修改脚本、回滚配置等管理权限，因此 MCP token 视同高权限秘密。

## 测试

- 路由测试覆盖未配置 token、缺失/错误 token、正确 token、初始化、`tools/list` 和 Workers 能力裁剪。
- 配置测试覆盖 Node 环境变量。
- 前端配置生成逻辑由单元测试覆盖，界面通过 TypeScript、生产构建和桌面/移动视口截图验证。
