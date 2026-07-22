# Chat Surface Contrast Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make top-level cards visibly distinct from the page and remove non-semantic borders from Agent chat and Markdown content.

**Architecture:** Keep the existing Mantine Card hierarchy and React chat behavior unchanged. Adjust semantic CSS surface tokens and chat/Markdown presentation, with a dedicated composer class replacing the current inline divider style.

**Tech Stack:** React 18, Mantine v7, CSS custom properties, React Markdown, Playwright/Chromium, Vitest.

---

### Task 1: Browser regression test

**Files:**
- Create: `/tmp/subforge-chat-surface-regression.js`
- Test: rendered Agent page at `http://127.0.0.1:5173/?view=agent`

**Step 1: Start isolated server and Vite processes**

Use an isolated sqlite database, `SUBFORGE_ALLOW_NO_AUTH=1`, and explicit ports 8787/5173.

**Step 2: Write the failing Playwright check**

Mock a long assistant Markdown response containing an `hr` and table. Assert:

- light page and Card RGB distance is at least 8;
- assistant message has zero border widths;
- composer has zero border widths;
- Markdown `hr` has no visible border;
- Markdown table cells have zero border widths.

**Step 3: Run the check and verify red**

Run: `node /tmp/subforge-chat-surface-regression.js`

Expected: fail on the current page/card contrast, assistant border, composer divider, Markdown rule, and table grid.

### Task 2: Surface and chat implementation

**Files:**
- Modify: `packages/web/src/styles.css`
- Modify: `packages/web/src/components/AgentChatPanel.tsx`

**Step 1: Separate the page and Card surfaces**

Set the light body surface to a cool gray while keeping `--sf-surface` white. Pair dark page/Card values by luminance rather than bright outlines.

**Step 2: Flatten assistant turns and composer**

Remove the assistant message border and use `--sf-surface-subtle`. Replace the inline composer divider with a `chat-composer` class using spacing only.

**Step 3: Flatten Markdown structure**

Render `hr` as whitespace without a rule. Replace table cell grids with a subtle header fill and alternating row fills; keep code blocks and interactive inputs bounded.

**Step 4: Run the browser check and verify green**

Run: `node /tmp/subforge-chat-surface-regression.js`

Expected: all computed-style assertions pass.

**Step 5: Run focused type checking and commit**

```bash
npx tsc --noEmit -p packages/web/tsconfig.json
git add packages/web/src/styles.css packages/web/src/components/AgentChatPanel.tsx
git commit -m "style(web): clarify card and chat surface hierarchy"
```

### Task 3: Responsive verification and release

**Files:**
- Modify only files required by observed verification issues

**Step 1: Run repository verification**

```bash
npm test
npm run typecheck
npx tsc --noEmit -p packages/web/tsconfig.json
npm run build
```

**Step 2: Capture and inspect screenshots**

Capture Agent with long Markdown and Profiles empty/detail states at 1440x900, 768x1024, and 375x812 in light/dark. Verify surface distinction, no incoherent border stacks, table readability, no horizontal overflow, focus visibility, and 44px mobile targets.

**Step 3: Merge locally**

Fast-forward the verified branch to `main`, rerun `npm test`, stop local services, and remove the worktree/branch.

**Step 4: Deploy and verify**

Deploy only with:

```bash
npm run cf:release -w packages/server
```

Verify root and `/healthz` return 200, anonymous `/mcp` returns 401, authenticated MCP initialize/tools list return 200, Wrangler placeholders are restored, and the Git worktree is clean.
