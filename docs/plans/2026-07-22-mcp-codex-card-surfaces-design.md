# MCP Codex Client And Card Surfaces Design

## Goal

Make SubForge's work surfaces feel quieter by replacing structural borders with a selective card hierarchy, add a first-class Codex MCP client example, and update the README so remote MCP setup is discoverable and safe.

## Surface Hierarchy

Top-level work areas use borderless cards with a restrained `xs` shadow. This applies to subscription list/add surfaces, profile navigation and editor sections, the Agent conversation surface, and equivalent framed loading or error surfaces. Light mode uses shadow plus a white surface; dark mode relies mainly on the surface luminance difference with a low-opacity shadow.

Nested content remains flat. Subscription rows, proxy-group editors, MCP tool lists, and other repeated content use `surface-subtle`, spacing, and hover state instead of continuous outlines or separators. Inputs, selects, textareas, code blocks, read-only copy fields, focus rings, and modal boundaries retain visible borders because those borders communicate interaction or containment.

The change must not create cards inside cards. A top-level card may contain flat rows or subtle grouped regions, but nested regions do not receive their own shadow.

## Codex MCP Configuration

The MCP client selector adds a `Codex` mode beside `Claude Code` and `通用 JSON`. The Codex mode renders a two-line shell example:

```bash
export SUBFORGE_MCP_TOKEN="<MCP_TOKEN>"
codex mcp add subforge --url "<ENDPOINT>" --bearer-token-env-var SUBFORGE_MCP_TOKEN
```

The endpoint continues to be derived from `window.location.origin` plus the server-provided `/mcp` path. The example never contains the configured token. This syntax is supported by the current Codex CLI and keeps the secret in an environment variable rather than storing it directly in the command or config.

The README also includes the equivalent user configuration:

```toml
[mcp_servers.subforge]
url = "https://subforge.example.com/mcp"
bearer_token_env_var = "SUBFORGE_MCP_TOKEN"
```

## README Scope

Update the feature summary and MCP section to cover:

- remote Streamable HTTP with a dedicated Bearer token;
- Claude Code, Codex CLI, Codex `config.toml`, and generic JSON clients;
- the fact that the management UI derives the endpoint from the actual deployed origin;
- the security expectation that `MCP_TOKEN` is an administrator-grade credential.

## Behavior And Data Flow

No API, authentication, storage, or MCP server behavior changes. `buildMcpExamples` remains the single source for client examples. `Mcp.tsx` only selects which prebuilt example to show and which copy label to expose.

Async loading, empty, error, retry, and pending states retain their existing behavior. Their visual containers follow the new surface hierarchy without changing accessibility roles.

## Verification

Use TDD to extend `mcp.test.ts` with the Codex example before implementation. Run the full test suite, root and Web type checks, and the production build. Repeat light/dark screenshots at 1440x900, 768x1024, and 375x812 for subscriptions, profiles, Agent, and MCP, including horizontal-overflow checks. Deploy only with `npm run cf:release -w packages/server`, then verify the Worker health endpoint, anonymous MCP rejection, authenticated initialization, tool listing, and restored Wrangler placeholders.
