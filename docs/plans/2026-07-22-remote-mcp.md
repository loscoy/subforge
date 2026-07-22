# Remote MCP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a token-protected Streamable HTTP MCP endpoint for Node and Cloudflare Workers, plus an MCP connection page in the web UI.

**Architecture:** Mount a stateless Web Standard MCP transport on the existing Hono app so both runtimes share one route and tool registry. Enable it only with a dedicated `MCP_TOKEN`, expose non-secret capability metadata through the authenticated management API, and retain stdio MCP unchanged.

**Tech Stack:** TypeScript, Hono, MCP TypeScript SDK, Vitest, React 18, Mantine v7, Cloudflare Workers

---

### Task 1: Specify remote MCP authentication and protocol behavior

**Files:**
- Modify: `packages/server/src/routes/app.test.ts`
- Modify: `packages/server/src/config.ts`
- Modify: `packages/server/src/routes/app.ts`
- Create: `packages/server/src/security.test.ts`
- Create: `packages/server/src/security.ts`

1. Add failing route tests for disabled MCP, missing/wrong Bearer token, successful initialization, and `tools/list`.
2. Run the focused test and confirm the new assertions fail because `/mcp` is absent.
3. Add `mcpToken` to `ServerConfig`, constant-time secret comparison, POST-only handling, and a fail-closed `/mcp` middleware.
4. Run the focused test and confirm the authentication assertions pass.

### Task 2: Add the cross-runtime Streamable HTTP adapter

**Files:**
- Create: `packages/server/src/mcp/http.ts`
- Modify: `packages/server/src/mcp/server.ts`
- Modify: `packages/server/src/routes/app.test.ts`
- Modify: `packages/server/src/routes/app.ts`

1. Add a failing test that inspects `tools/list` with and without `checkNodes` capability.
2. Make `createMcpServer` pass runtime capabilities to `buildTools`.
3. Implement a per-request `WebStandardStreamableHTTPServerTransport` handler and mount it in Hono.
4. Run the route tests and confirm protocol and capability tests pass.

### Task 3: Wire Node and Workers configuration

**Files:**
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Create: `packages/server/src/config.test.ts`
- Modify: `packages/server/src/config.ts`
- Modify: `packages/server/src/worker.ts`
- Modify: `packages/server/wrangler.jsonc`

1. Add a failing config test for `MCP_TOKEN`.
2. Read `MCP_TOKEN` from Node environment, Docker Compose, and Workers bindings.
3. Add `/mcp` to `run_worker_first` and document the Worker secret inline.
4. Run server typecheck and focused tests.

### Task 4: Expose safe MCP metadata

**Files:**
- Modify: `packages/server/src/routes/app.test.ts`
- Modify: `packages/server/src/routes/app.ts`
- Modify: `packages/web/src/types.ts`

1. Add a failing `/api/meta` assertion for `mcp.enabled`, endpoint, transport, capability-filtered tools, and token non-disclosure.
2. Build metadata from the existing tool registry without returning the token.
3. Run the route tests and web TypeScript check.

### Task 5: Add the MCP connection page

**Files:**
- Create: `packages/web/src/mcp.test.ts`
- Create: `packages/web/src/mcp.ts`
- Create: `packages/web/src/components/Mcp.tsx`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/icons.tsx`
- Modify: `packages/web/vite.config.ts`

1. Test endpoint and client configuration generation before implementation.
2. Add an MCP navigation entry and focused, responsive connection view.
3. Show enabled/disabled state, endpoint, auth header shape, tool inventory, and copy controls for client configuration.
4. Keep credentials as placeholders and never persist or request the MCP token.
5. Proxy `/mcp` to the backend in local Vite development.
6. Run web TypeScript check and production build.

### Task 6: Update user and deployment documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/DEPLOY_CLOUDFLARE.md`

1. Document local stdio and remote Streamable HTTP separately.
2. Document `MCP_TOKEN` for Node, Docker, and `wrangler secret put MCP_TOKEN` for Workers.
3. State the custom-header versus OAuth client compatibility boundary.

### Task 7: Verify the complete change

1. Run `npm test`.
2. Run `npm run typecheck` and `npx tsc --noEmit -p packages/web/tsconfig.json`.
3. Run `npm run build`.
4. Start the local dev servers and verify the MCP page at desktop and mobile widths with screenshots.
5. Inspect `git diff --check` and `git status --short` before handoff.
