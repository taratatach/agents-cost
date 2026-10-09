# agents-cost

An [OpenCode](https://opencode.ai) TUI plugin that shows the **cumulative cost** of the
current session — main agent **plus** all subagents — live in the sidebar.

OpenCode's built-in cost display only accounts for the main session. When an agent
spawns subagents (via the `task` tool, custom subagents, etc.), that spend is invisible.
`agents-cost` sums the cost of the whole session family — the root session plus every
descendant the client knows about — and breaks it down into `Main` / `Subs` / `Total`.

Cost is treated as **monotonic** (matches opencode's own accounting: `revert`/`unrevert`
never subtract), so the displayed number only ever goes up.

## Install

This is a **CLI/TUI plugin** — it goes in `cli.json`, not `opencode.json`.

### From a checkout

```bash
git clone https://github.com/taratatach/agents-cost.git \
  ~/.config/opencode/plugins/agents-cost
```

Add to `~/.config/opencode/cli.json`:

```jsonc
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["./plugins/agents-cost"]
}
```

The `./` path resolves relative to `cli.json`'s directory (`~/.config/opencode/`).

> **Note** — the TUI entrypoint file must be named `tui.tsx` and sit at the root
> of the checkout. OpenCode's V2 CLI plugin loader resolves `<dir>/tui` with
> `Bun.resolveSync` and ignores the `package.json` `exports` map; any other name
> resolves to nothing and the plugin is silently skipped.

Or clone anywhere and use an absolute path:

```jsonc
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["file:///absolute/path/to/agents-cost"]
}
```

Restart opencode. The plugin loads from the checkout — no npm, no cache: OpenCode
resolves `@opencode/plugin/tui`, `@opentui/solid` and `solid-js` at runtime.

## What you see

A small block in the sidebar:

```
Costs
Main $0.42
Subs $1.07
Total $1.49
```

- **Main** — `session.cost` of the current session (what opencode shows natively).
- **Subs** — cumulative cost of every descendant session (family total minus
  the root's own cost).
- **Total** — `Main + Subs`.

## How it works

The plugin claims the `sidebar.content` slot. For the displayed session it reads
OpenCode's own reactive session data (`@opencode/plugin/tui` context):

- **Main** — `data.session.get(sessionID)?.cost`, the root session's own cost.
- **Total** — `data.session.cost(sessionID)`, which sums the whole session family
  (root + every registered descendant) and is kept up to date by opencode's data
  layer via `session.usage.updated` / `session.created` / `session.deleted` events.
- **Subs** — `Total - Main`, guarded by `max(0, …)`.

On mount, the plugin bootstraps by walking the session tree with a BFS over
`client.session.list({ parentID })` — following the server's pagination cursor,
since the endpoint caps at 50 sessions per page — and syncing each descendant
(`data.session.sync(id)`), so subagents that already ran before the plugin loaded
are still counted; afterwards, new descendants register themselves through the
event stream. The Total is always computed from the family root
(`data.session.root()`), so forked/continued sessions are summed correctly too.

## Compatibility

Requires OpenCode **2.x** (V1 plugin implementations do not run in V2). The plugin
uses only the public TUI plugin API (`@opencode/plugin/tui`); `@opentui/solid` and
`solid-js` are provided by opencode's bundled runtime, so there are no installable
dependencies.

## License

GPL-3.0 — see [LICENSE](./LICENSE).
