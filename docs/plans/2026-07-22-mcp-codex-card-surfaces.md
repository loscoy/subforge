# MCP Codex Client And Card Surfaces Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a safe Codex remote MCP client example, document it in README, and replace structural borders with a selective borderless card hierarchy across the Web UI.

**Architecture:** Keep client examples as pure values produced by `buildMcpExamples`, with `Mcp.tsx` only selecting and copying them. Apply the visual change through the existing Mantine Card theme defaults and tightly scoped global classes: top-level surfaces receive background and shadow, nested rows receive subtle fill and spacing, and interactive/code boundaries remain visible.

**Tech Stack:** React 18, TypeScript, Mantine v7, CSS variables, Vitest, Vite 6, Playwright/Chromium, Cloudflare Workers/Wrangler.

**Design reference:** `docs/plans/2026-07-22-mcp-codex-card-surfaces-design.md`

---

### Task 1: Codex MCP client example

**Files:**
- Modify: `packages/web/src/mcp.test.ts`
- Modify: `packages/web/src/mcp.ts`
- Modify: `packages/web/src/components/Mcp.tsx`

**Step 1: Write the failing pure-helper test**

Extend the existing example test with these expectations:

```ts
expect(examples.codex).toContain('export SUBFORGE_MCP_TOKEN="<MCP_TOKEN>"')
expect(examples.codex).toContain(
  'codex mcp add subforge --url "https://subforge.example.com/mcp" --bearer-token-env-var SUBFORGE_MCP_TOKEN',
)
expect(examples.codex).not.toContain('Bearer <MCP_TOKEN>')
```

The Codex example must use an environment variable rather than a static header or token argument.

**Step 2: Run the focused test and verify red**

```bash
npx vitest run packages/web/src/mcp.test.ts
```

Expected: FAIL because `buildMcpExamples` does not return `codex`.

**Step 3: Implement the minimal helper output**

Change the return type to:

```ts
{ claudeCode: string; codex: string; json: string }
```

Build `codex` from the existing endpoint and token placeholder:

```ts
codex: [
  `export SUBFORGE_MCP_TOKEN="${TOKEN_PLACEHOLDER}"`,
  `codex mcp add subforge --url "${endpoint}" --bearer-token-env-var SUBFORGE_MCP_TOKEN`,
].join('\n')
```

**Step 4: Run the focused test and verify green**

Run the same Vitest command. Expected: all MCP configuration tests pass.

**Step 5: Add the Codex selector mode**

In `Mcp.tsx`:

- expand `exampleMode` to `'claude' | 'codex' | 'json'`;
- add `{ value: 'codex', label: 'Codex' }` between Claude Code and generic JSON;
- render `examples.codex` with copy label `复制 Codex 命令`;
- keep the endpoint and Authorization fields unchanged;
- keep the segmented control wrapping safely at narrow widths.

Use a small mode-to-example map or explicit branches; do not add a new component abstraction.

**Step 6: Verify and commit**

```bash
npx vitest run packages/web/src/mcp.test.ts
npx tsc --noEmit -p packages/web/tsconfig.json
git add packages/web/src/mcp.ts packages/web/src/mcp.test.ts packages/web/src/components/Mcp.tsx
git commit -m "feat(web): add Codex MCP client configuration"
```

---

### Task 2: Selective borderless card hierarchy

**Files:**
- Modify: `packages/web/src/theme.ts`
- Modify: `packages/web/src/styles.css`
- Test: `packages/web/src/components/AsyncState.test.tsx`

**Step 1: Preserve semantic async-state coverage**

Run the existing async-state tests before styling:

```bash
npx vitest run packages/web/src/components/AsyncState.test.tsx
```

Expected: PASS. The style change must not remove loading status roles, error alerts, or retry buttons.

**Step 2: Set the top-level Card treatment**

Update the Mantine `Card` extension defaults to:

```ts
Card.extend({
  defaultProps: { radius: 'md', withBorder: false, padding: 'md', shadow: 'xs' },
  styles: { root: { background: 'var(--sf-surface)' } },
})
```

Refine `shadows.xs` only if necessary so it remains restrained in light mode. Dark mode should rely on `--sf-surface` against the body rather than a bright outline.

**Step 3: Flatten nested structural regions**

In `styles.css`:

- remove borders from `.subscription-row` and use `--sf-surface-subtle`;
- remove borders from `.proxy-group-editor` and preserve its subtle fill;
- remove borders from `.async-detail-skeleton`, `.async-error`, and `.script-preview`; give top-level async surfaces the same low shadow where needed;
- remove `.mcp-tool-row + .mcp-tool-row` dividers and use spacing within the subtle tool-list surface;
- keep `.mcp-copy-value`, `.editor-wrap`, `.logs`, inputs, selects, textareas, modal boundaries, and focus rings visibly bounded;
- do not add shadows to nested rows or grouped editors;
- preserve the no-horizontal-overflow mobile rules.

**Step 4: Verify semantic tests, type checking, and build**

```bash
npx vitest run packages/web/src/components/AsyncState.test.tsx
npx tsc --noEmit -p packages/web/tsconfig.json
npm run build -w packages/web
```

Expected: tests and type checks pass; the production build keeps ScriptEditor in its own chunk.

**Step 5: Commit**

```bash
git add packages/web/src/theme.ts packages/web/src/styles.css
git commit -m "style(web): replace structural borders with card surfaces"
```

---

### Task 3: README remote MCP and Codex guidance

**Files:**
- Modify: `README.md`

**Step 1: Update the feature summary**

Change the Agent/MCP feature bullet so it names Claude Code and Codex and explicitly identifies remote Streamable HTTP support with a dedicated Bearer token.

**Step 2: Add Codex CLI setup**

Under remote MCP, add:

```bash
export SUBFORGE_MCP_TOKEN="<MCP_TOKEN>"
codex mcp add subforge --url "https://subforge.example.com/mcp" \
  --bearer-token-env-var SUBFORGE_MCP_TOKEN
```

Explain that the ChatGPT desktop app, Codex CLI, and IDE extension share Codex MCP configuration on the same host.

**Step 3: Add the equivalent Codex TOML**

```toml
[mcp_servers.subforge]
url = "https://subforge.example.com/mcp"
bearer_token_env_var = "SUBFORGE_MCP_TOKEN"
```

Keep the existing Claude Code and generic JSON examples. State that the UI derives its endpoint from the actual deployment origin and that the token must not be committed.

**Step 4: Verify documentation content and commit**

```bash
rg -n "codex mcp add|mcp_servers\.subforge|bearer_token_env_var|当前域名" README.md
git diff --check
git add README.md
git commit -m "docs: document Codex remote MCP setup"
```

---

### Task 4: Cross-viewport verification and release

**Files:**
- Modify only files required by observed verification issues

**Step 1: Run repository verification**

```bash
npm test
npm run typecheck
npx tsc --noEmit -p packages/web/tsconfig.json
npm run build
```

Expected: all tests, both type checks, and the full package build pass.

**Step 2: Start isolated local verification services**

Start the Node server with an isolated sqlite database, `SUBFORGE_ALLOW_NO_AUTH=1`, and a non-sensitive MCP token. Start Vite on an explicit available host/port. Seed non-sensitive subscription/profile data. Record session IDs and stop both processes after verification.

**Step 3: Capture the screenshot matrix**

Capture subscriptions, selected profile details, Agent, and MCP at:

- 1440x900;
- 768x1024;
- 375x812;
- light and dark schemes.

Inspect that top-level cards have a restrained surface/shadow, nested regions do not look like cards inside cards, interactive/code boundaries remain visible, the three-mode client selector fits, and no page-level horizontal overflow appears.

**Step 4: Check behavior**

- switch to Codex mode and verify the two-line command uses the actual origin;
- verify the Codex copy action is labeled;
- preserve keyboard focus and mobile 44px icon targets;
- preserve skeleton/error/empty states and reduced-motion behavior.

Fix only observed issues, rerun affected screenshots, and commit any fix as:

```bash
git add packages/web
git commit -m "fix(web): address card surface verification findings"
```

Skip this commit if no code changes are needed.

**Step 5: Merge and deploy**

Use `superpowers:verification-before-completion` and `superpowers:finishing-a-development-branch`. Fast-forward the verified branch into `main`, rerun tests on the merged result, stop local services, and clean up the worktree/branch.

Deploy only with:

```bash
npm run cf:release -w packages/server
```

Verify `/healthz` returns 200, anonymous `/mcp` returns 401, the configured token initializes MCP and lists tools, the Web root returns HTML, `wrangler.jsonc` contains `REPLACE_WITH_YOUR_D1_ID`, no backup file remains, and the Git worktree is clean.
