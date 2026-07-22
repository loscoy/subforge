# SubForge Web UI/UX Polish Design

## Goal

Improve the perceived quality and usability of the existing SubForge control panel without changing its product model. The interface should remain a quiet, content-first operational tool: compact enough for repeated work, but readable, responsive, and explicit about system state.

The work applies globally, with additional refinement for the MCP page. It covers typography, visual hierarchy, responsive behavior, navigation state, asynchronous feedback, accessibility, and initial-load performance.

## Design Direction

Keep Mantine v7, the existing violet brand accent, light/dark themes, and the current outline icon language. Do not introduce a new component library or marketing-style composition.

Use a system-native sans-serif stack for body and headings so Chinese and Latin text use platform-coordinated glyphs. Use only real font weights: 400 for body, 500 for labels and navigation, and 600 for headings. Technical values, endpoints, tool names, and code remain monospaced.

Replace ad hoc borders with semantic tokens:

- `surface`: page and elevated tool surfaces
- `surface-subtle`: quiet grouped content and read-only values
- `border-subtle`: structural separation that should recede
- `border-interactive`: inputs, buttons, and controls
- `focus-ring`: keyboard focus indication

Light and dark schemes receive separate token values. Borders do not carry section hierarchy by themselves; spacing, typography, and surface changes do most of that work.

Radii settle at 6-8px for controls, repeated items, and framed tools. Shadows are reserved for overlays and genuinely elevated surfaces. Nested cards are flattened.

## Application Shell And Navigation

Keep the desktop sidebar and mobile header, but soften the sidebar boundary and footer separation. Active navigation remains text plus icon with a restrained violet state.

Top-level view state becomes URL-backed, using a resilient root-page query such as `?view=mcp`. Clicking navigation updates browser history; reload, direct links, back, and forward restore the selected view. Invalid values fall back to the default view.

The page shell renders immediately. Metadata loading uses a stable page skeleton rather than a heading followed by blank content. Authentication remains a distinct state. Non-authentication failures render an inline error state with a retry command.

## Async State Model

Every asynchronously loaded surface must distinguish four states:

1. `loading`: a shape-matched skeleton with stable dimensions
2. `success with data`: normal content
3. `success empty`: the existing purposeful empty state
4. `error`: a concise local message and retry action

This applies to:

- application metadata and the initial page body
- subscriptions
- profile list and selected profile details
- Agent message history
- script preview and other long-running actions where content is not yet available

Skeletons mirror the eventual layout: list rows for subscriptions and profiles, form/section blocks for profile details, message rows for Agent history, and connection/tool rows for MCP while metadata is loading. Empty states never appear before a request has completed.

Mutation controls expose progress and prevent duplicates. Create, save, refresh, delete, output, rollback, and similar actions disable their trigger while pending. Existing content remains visible during refresh where possible, with a local progress indication instead of replacing the whole surface.

## Responsive Layout

Use the existing Mantine breakpoints and a 4/8px spacing rhythm.

- Desktop subscriptions retain an efficient list/form composition; below the desktop breakpoint they stack without fixed widths.
- Desktop profiles retain list/detail navigation; on small screens the fixed 212px column becomes a full-width profile selector/list above the detail.
- Action groups wrap predictably. One primary action remains visible; lower-priority commands move into a secondary action area when space is constrained.
- Proxy group editors change from rigid rows to responsive grids so fields and delete actions never overflow.
- MCP changes from two columns to a single ordered flow on small screens: connection details, client configuration, then available tools.

The layout must have no horizontal page scrolling at 375px. Code blocks may scroll internally without resizing their parent.

## Information Hierarchy And Actions

Each page or work surface has one visually primary command. On the profile editor, Save is primary. Template, output, version, health check, and Agent controls are visually secondary and grouped by purpose. Persistent destructive actions are spatially separated and require confirmation through Mantine UI rather than native browser dialogs.

Repeated items use quiet hover/pressed states and spacing instead of individually heavy cards. Clickable profile rows become semantic keyboard-operable controls.

Section headings use semantic heading elements in sequence. Labels remain visible rather than relying on placeholders. Secondary descriptions remain readable and are not reduced below 12px; normal descriptive text targets 13-14px on desktop and at least 14px on mobile.

## MCP Page

The MCP page keeps the same data and client examples while reducing visual noise:

- render connection status as a compact, unframed status row without a full-width divider
- place copy actions inside or directly adjacent to read-only endpoint/header fields
- switch the client example format with a compact mode control, without a strong full-width tab rule
- raise tool name and description sizes and line height
- use inset, low-contrast separators or row spacing instead of continuous dark rules
- keep the enabled state textual, not color-only

The full endpoint continues to resolve from `window.location.origin` plus the server-provided `/mcp` path.

## Accessibility And Interaction

- Preserve visible focus rings for keyboard users.
- Make interactive rows semantic buttons or links.
- Keep icon-only controls labeled.
- Provide at least a 44x44px hit area for mobile controls; dense desktop visuals may use a smaller glyph inside the same hit area.
- Replace Agent tool-state emoji characters with the existing SVG icon language and accessible text.
- Do not rely on color alone for enabled, error, or running states.
- Use 150-200ms state transitions based on opacity and color, and respect `prefers-reduced-motion`.
- Ensure destructive actions require confirmation and async errors include a recovery path.

## Performance

Lazy-load heavyweight or inactive UI, especially Monaco and the script editor. Do not mount the editor while its section is collapsed. Page-level modules may be split where that materially reduces the initial bundle without adding navigation instability.

Skeleton dimensions and async transitions must avoid cumulative layout shift.

## Verification

Run web type checking, focused unit tests, and a production build. Verify screenshots in light and dark schemes at representative widths:

- 1440px desktop
- 768px tablet
- 375px phone

Check the subscriptions, profiles, Agent, and MCP views. Validate no horizontal page overflow, stable skeleton-to-content transitions, keyboard navigation and focus visibility, mobile touch targets, destructive confirmations, URL back/forward behavior, reduced motion, and readable contrast in both themes.
