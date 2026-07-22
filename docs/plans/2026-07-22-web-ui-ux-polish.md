# Web UI/UX Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the SubForge control panel visually quieter, responsive, accessible, URL-addressable, and explicit about asynchronous loading, empty, error, and pending states.

**Architecture:** Keep React 18 and Mantine v7. Add a small set of shared presentation primitives for skeleton/error states and pure helpers for URL-backed top-level navigation; page-specific components continue owning their API calls and mutation state. Centralize visual decisions in the existing theme and global CSS, then refine each work surface without changing server contracts.

**Tech Stack:** React 18, TypeScript, Mantine v7, Vite 6, Vitest, React DOM server rendering for stateless component tests.

**Design reference:** `docs/plans/2026-07-22-web-ui-ux-polish-design.md`

---

### Task 1: URL-backed navigation helpers

**Files:**
- Create: `packages/web/src/navigation.ts`
- Create: `packages/web/src/navigation.test.ts`
- Modify: `packages/web/src/App.tsx`

**Step 1: Write failing helper tests**

Cover these cases in `navigation.test.ts`:

```ts
expect(readView('?view=mcp')).toBe('mcp')
expect(readView('?view=unknown')).toBe('profiles')
expect(writeView('?foo=1', 'subs')).toBe('?foo=1&view=subs')
expect(writeView('?view=mcp&foo=1', 'agent')).toBe('?view=agent&foo=1')
```

Keep the view union and default in `navigation.ts` so `App.tsx` and tests share one source of truth.

**Step 2: Run the focused test and verify red**

Run:

```bash
npx vitest run packages/web/src/navigation.test.ts
```

Expected: FAIL because `navigation.ts` does not exist.

**Step 3: Implement the pure helpers**

Implement `readView(search)`, `writeView(search, view)`, and `isView(value)` with `URLSearchParams`. Preserve unrelated query parameters and fall back to `profiles` for absent or invalid values.

**Step 4: Run the focused test and verify green**

Run the same Vitest command. Expected: all navigation tests pass.

**Step 5: Connect App navigation to browser history**

In `App.tsx`:

- initialize the selected view from `window.location.search`
- use `history.pushState` when a navigation item is selected
- listen for `popstate` and restore the view
- keep closing the mobile navbar after selection
- do not introduce React Router or server route changes

**Step 6: Type-check and commit**

```bash
npx tsc --noEmit -p packages/web/tsconfig.json
git add packages/web/src/navigation.ts packages/web/src/navigation.test.ts packages/web/src/App.tsx
git commit -m "feat(web): make primary navigation URL-backed"
```

---

### Task 2: Shared async presentation states

**Files:**
- Create: `packages/web/src/components/AsyncState.tsx`
- Create: `packages/web/src/components/AsyncState.test.tsx`
- Modify: `packages/web/src/styles.css`

**Step 1: Write failing static-render tests**

Use `renderToStaticMarkup` and `MantineProvider` to verify:

- `PageSkeleton` renders a status element with `aria-label="正在加载"`
- `ListSkeleton` renders the requested number of stable rows
- `LoadError` renders the supplied message and a semantic retry button

Prefer stable `data-testid` attributes only where an accessible query is insufficient.

**Step 2: Run the focused test and verify red**

```bash
npx vitest run packages/web/src/components/AsyncState.test.tsx
```

Expected: FAIL because the shared components do not exist.

**Step 3: Implement minimal shared primitives**

Create:

```ts
export function PageSkeleton(): JSX.Element
export function ListSkeleton(props: { rows?: number }): JSX.Element
export function DetailSkeleton(): JSX.Element
export function MessageSkeleton(): JSX.Element
export function LoadError(props: { message: string; onRetry: () => void }): JSX.Element
```

Build them from Mantine `Skeleton`, `Stack`, `Group`, `Box`, `Text`, and `Button`. Match final content geometry and avoid animated decoration beyond Mantine's loading treatment.

**Step 4: Add stable skeleton/error styling**

Add only layout classes that are shared across pages. Ensure skeleton blocks have bounded dimensions and no horizontal overflow.

**Step 5: Run the focused test and verify green**

Run the same Vitest command. Expected: all async presentation tests pass.

**Step 6: Commit**

```bash
git add packages/web/src/components/AsyncState.tsx packages/web/src/components/AsyncState.test.tsx packages/web/src/styles.css
git commit -m "feat(web): add shared async state surfaces"
```

---

### Task 3: Global visual foundation and application loading state

**Files:**
- Modify: `packages/web/index.html`
- Modify: `packages/web/src/theme.ts`
- Modify: `packages/web/src/styles.css`
- Modify: `packages/web/src/App.tsx`

**Step 1: Update typography and theme primitives**

- remove Inter from the Google Fonts request and from the body font stack
- use `ui-sans-serif`, `system-ui`, Apple/Windows/Chinese system fallbacks
- keep JetBrains Mono with system monospace fallbacks for technical content
- replace synthetic 650/550 weights with 600/500
- cap standard card/control radii at 8px
- reduce default card shadow and use semantic surface/border tokens

Define separate light/dark values for `--sf-surface-subtle`, `--sf-border-subtle`, `--sf-border-interactive`, and `--sf-focus-ring`. Do not globally make interactive borders so faint that controls disappear.

**Step 2: Add interaction and accessibility defaults**

- add visible `:focus-visible` treatment where Mantine does not already provide one
- use 150-200ms color/opacity transitions for navigation and repeated rows
- disable nonessential transitions in `prefers-reduced-motion`
- add mobile-only 44px minimum hit areas for icon actions
- preserve zero letter spacing

**Step 3: Model metadata loading explicitly in App**

Replace `meta: Meta | null` plus partial error handling with explicit loading/error/success state. Requirements:

- initial shell renders immediately with `PageSkeleton`
- 401 still opens the admin-token form
- other failures render `LoadError` and retry `loadMeta`
- an unresolved request never renders an empty feature page
- retry clears the old error and returns to loading

**Step 4: Normalize shell hierarchy**

- soften the sidebar edge and footer separator
- use 600 for the page title and brand
- retain icon-plus-label navigation and textual Agent readiness
- keep main content constrained while using adaptive gutters
- use semantic `main`/heading relationships where Mantine supports component overrides

**Step 5: Verify**

```bash
npx vitest run packages/web/src/navigation.test.ts packages/web/src/components/AsyncState.test.tsx
npx tsc --noEmit -p packages/web/tsconfig.json
npm run build -w packages/web
```

Expected: tests, type-check, and build pass.

**Step 6: Commit**

```bash
git add packages/web/index.html packages/web/src/theme.ts packages/web/src/styles.css packages/web/src/App.tsx
git commit -m "style(web): refine global hierarchy and loading shell"
```

---

### Task 4: Subscription async states, responsiveness, and safe mutations

**Files:**
- Modify: `packages/web/src/components/Subscriptions.tsx`
- Modify: `packages/web/src/styles.css`
- Test: `packages/web/src/components/AsyncState.test.tsx`

**Step 1: Extend the shared-state test if a subscription-specific skeleton shape is needed**

Assert row count and that loading markup cannot be mistaken for the empty-state text.

**Step 2: Add explicit query state**

Track `loading`, `loadError`, and successful `subs` separately. On first load show list skeletons; after a successful empty response show “还没有订阅”; on error show retry. During refresh preserve current rows and show a pending state on only the affected subscription.

**Step 3: Add mutation state**

Track pending add, refresh, and delete IDs. Disable duplicate operations and use Mantine loading indicators. Keep success/error notifications, but ensure the triggering control also reflects progress.

**Step 4: Confirm destructive deletion**

Use a Mantine confirmation modal for persisted subscription deletion. The dialog names the subscription, provides Cancel/Delete actions, and places initial focus on the non-destructive action. Do not use native `confirm()`.

**Step 5: Make layout responsive**

Replace the nowrap `Group` plus fixed 360px panel with a CSS grid class:

```css
.subscriptions-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 24px;
}
```

At the Mantine small breakpoint, switch to one column and remove fixed widths. Let row actions wrap below metadata on narrow screens. Replace “在右侧” copy with viewport-neutral wording.

**Step 6: Verify and commit**

```bash
npx vitest run packages/web/src/components/AsyncState.test.tsx
npx tsc --noEmit -p packages/web/tsconfig.json
git add packages/web/src/components/Subscriptions.tsx packages/web/src/styles.css packages/web/src/components/AsyncState.test.tsx
git commit -m "feat(web): add responsive subscription loading states"
```

---

### Task 5: Profile loading states, responsive editor, and action hierarchy

**Files:**
- Modify: `packages/web/src/components/Profiles.tsx`
- Modify: `packages/web/src/styles.css`

**Step 1: Add explicit list and detail loading state**

- track profile-list and subscription-list requests independently
- show `ListSkeleton` until profiles resolve
- do not show “还没有配置” before a successful response
- show local retry on list failure
- while fetching a selected profile, show `DetailSkeleton` in the detail pane
- preserve selected identity and ignore stale selection responses

Use a monotonically increasing request ID or `AbortController` so a slower prior selection cannot replace the newest one.

**Step 2: Make the profile chooser semantic and responsive**

Replace clickable `Group` rows with `UnstyledButton` or another semantic Mantine control. Add selected state semantics and visible focus. Use a `.profiles-layout` grid with `212px minmax(0, 1fr)` on desktop and one column on small screens.

**Step 3: Rework the action hierarchy**

- keep Save as the single primary command
- group template/output/version/health/Agent commands as secondary controls
- allow the group to wrap without forcing horizontal scrolling
- separate the persisted Delete action and confirm it in a Mantine modal
- add pending state to save, output, rollback, and other async actions that currently allow duplicate clicks

**Step 4: Make editor sections responsive**

- convert rigid field rows and proxy-group rows to breakpoint-aware grids
- add visible or accessible labels to group name/type/filter fields
- keep delete controls reachable with a 44px mobile hit area
- avoid disabling a whole section solely with opacity; expose the disabled reason in text and semantic disabled controls where practical

**Step 5: Flatten visual hierarchy**

Use shared surface and border tokens, 6-8px radii, and spacing rather than stronger card borders. Remove nested card treatment from preview areas.

**Step 6: Verify and commit**

```bash
npx tsc --noEmit -p packages/web/tsconfig.json
npm run build -w packages/web
git add packages/web/src/components/Profiles.tsx packages/web/src/styles.css
git commit -m "feat(web): refine responsive profile workflow"
```

---

### Task 6: Lazy script editor and Agent async feedback

**Files:**
- Modify: `packages/web/src/components/Profiles.tsx`
- Modify: `packages/web/src/components/ScriptEditor.tsx`
- Modify: `packages/web/src/components/AgentChatPanel.tsx`
- Modify: `packages/web/src/icons.tsx`
- Modify: `packages/web/src/styles.css`

**Step 1: Lazy-load Monaco**

Replace the eager `ScriptEditor` import with `React.lazy`. Render it only when the script section is expanded and wrap it in `Suspense` with `DetailSkeleton` or an editor-shaped skeleton. Verify that a collapsed script section neither mounts Monaco nor starts a preview request.

**Step 2: Clarify preview loading**

When no prior preview exists, render a preview skeleton. During subsequent preview runs, preserve old results and add a small textual running state. Ensure errors remain local and readable.

**Step 3: Add Agent-history states**

Track initial message loading and error separately. Render `MessageSkeleton` initially and an inline retry on failure instead of swallowing the error. Preserve the existing streaming and stick-to-bottom behavior.

**Step 4: Replace character status icons**

Add or reuse consistent SVG check/loading indicators. Tool rows must not use emoji or color alone. Keep screen-reader text meaningful and running state explicit.

**Step 5: Normalize composer interaction**

Use the subtle border token, retain Enter/Shift+Enter behavior, and make the send hit area at least 44px on mobile. Busy state remains non-submittable and visible.

**Step 6: Verify bundle split and commit**

```bash
npx tsc --noEmit -p packages/web/tsconfig.json
npm run build -w packages/web
```

Expected: production output contains a separate lazy script-editor/Monaco chunk and the main bundle is smaller than the pre-change build.

```bash
git add packages/web/src/components/Profiles.tsx packages/web/src/components/ScriptEditor.tsx packages/web/src/components/AgentChatPanel.tsx packages/web/src/icons.tsx packages/web/src/styles.css
git commit -m "perf(web): lazy-load editor and expose Agent loading"
```

---

### Task 7: MCP information hierarchy

**Files:**
- Modify: `packages/web/src/components/Mcp.tsx`
- Modify: `packages/web/src/styles.css`
- Test: `packages/web/src/mcp.test.ts`

**Step 1: Preserve endpoint behavior with the existing test**

Run:

```bash
npx vitest run packages/web/src/mcp.test.ts
```

Expected: current endpoint and example tests pass before refactoring.

**Step 2: Refine the connection area**

- remove the full-width header divider
- render a compact status row with text plus enabled/disabled badge
- style endpoint and Authorization values as read-only technical surfaces
- keep copy controls labeled and place them inside or directly beside the value surface

**Step 3: Replace heavy tabs and tool dividers**

Use a compact segmented mode control or low-emphasis tabs without a full-width rule for Claude Code/JSON. Increase tool names/descriptions to readable sizes and use inset low-contrast separators plus row spacing. Keep the tool count adjacent to its heading.

**Step 4: Verify responsive ordering**

At desktop, use a balanced connection/tools grid. At small widths, order content as connection information, client configuration, then tools. Code scrolls internally and copy actions do not overlap text.

**Step 5: Run tests and commit**

```bash
npx vitest run packages/web/src/mcp.test.ts
npx tsc --noEmit -p packages/web/tsconfig.json
git add packages/web/src/components/Mcp.tsx packages/web/src/styles.css packages/web/src/mcp.test.ts
git commit -m "style(web): refine MCP connection hierarchy"
```

---

### Task 8: Cross-page visual and accessibility verification

**Files:**
- Modify only files required by issues found during verification

**Step 1: Run automated verification**

```bash
npx vitest run
npx tsc --noEmit -p packages/web/tsconfig.json
npm run build -w packages/web
```

Expected: all tests pass, type-check exits 0, and production build exits 0.

**Step 2: Start local verification services**

Run the server with `SUBFORGE_ALLOW_NO_AUTH=1` and start Vite on available local ports. Record the actual URLs. Do not leave these services running after verification.

**Step 3: Capture and inspect screenshots**

Capture subscriptions, profiles, Agent, and MCP in light and dark modes at:

- 1440x900
- 768x1024
- 375x812

Seed or use non-sensitive local data so loaded and empty states can both be inspected. Also throttle or intercept API responses to capture skeleton and error states.

**Step 4: Check behavior, not only appearance**

- no page-level horizontal overflow at 375px
- navigation back/forward and direct URLs restore the correct page
- keyboard focus reaches navigation, profile rows, copy actions, and destructive dialogs
- icon hit areas meet mobile size requirements
- skeletons transition to data or true empty states without layout jumps
- loading buttons reject duplicate actions
- reduced-motion mode removes nonessential transitions
- light and dark secondary text/borders remain readable

**Step 5: Fix findings and rerun the relevant checks**

Keep fixes scoped to observed failures. Repeat screenshots for any changed viewport/theme.

**Step 6: Final commit**

```bash
git add packages/web
git commit -m "fix(web): address responsive UI verification findings"
```

Skip the commit if verification required no code changes.

---

### Task 9: Full repository verification and release readiness

**Files:**
- No planned source changes

**Step 1: Run repository checks**

```bash
npm test
npm run typecheck
npx tsc --noEmit -p packages/web/tsconfig.json
npm run build
```

Expected: all tests, project references, web type-check, and all package builds pass.

**Step 2: Review the final diff and worktree**

```bash
git status --short
git log --oneline --decorate -10
```

Confirm only intended UI, tests, and design/plan files changed. Do not deploy until the user explicitly requests a new Worker release.
