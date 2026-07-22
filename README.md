# agents-cost

An [OpenCode](https://opencode.ai) TUI plugin that shows the **cumulative cost** of the
current session — main agent **plus** all subagents — live in the sidebar.

OpenCode's built-in cost display only accounts for the main session. When an agent
spawns subagents (via the `task` tool, custom subagents, etc.), that spend is invisible.
`agents-cost` walks the session tree with a BFS over `client.session.children`, sums the
`AssistantMessage.cost` of every descendant, and keeps the total up to date via
`message.updated` / `session.created` / `session.deleted` / `session.idle` events.

Cost is treated as **monotonic** (matches opencode's own accounting: `revert`/`unrevert`
never subtract), so the displayed number only ever goes up.

## Install

This is a **TUI plugin** — it goes in `tui.json`, not `opencode.json`.

### From a checkout

```bash
git clone https://github.com/taratatach/agents-cost.git \
  ~/.config/opencode/plugins/agents-cost
```

Add to `~/.config/opencode/tui.json`:

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["./plugins/agents-cost"]
}
```

The `./` path resolves relative to `tui.json`'s directory (`~/.config/opencode/`).

Or clone anywhere and use an absolute path:

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["file:///absolute/path/to/agents-cost"]
}
```

Restart opencode. The plugin loads from the checkout — no npm, no cache.

## What you see

A small block in the sidebar:

```
Costs
Main $0.42
Subs $1.07
Total $1.49
```

- **Main** — `session.cost` of the current session (what opencode shows natively).
- **Subs** — cumulative cost of every descendant session, summed from
  `AssistantMessage.cost` deltas.
- **Total** — `Main + Subs`.

## How it works

On load, the plugin:

1. BFS-walks `client.session.children` from the current session, collecting every
   reachable descendant.
2. For each child, fetches `client.session.messages` and seeds a per-message cost
   baseline (so a subagent that already ran before the plugin loaded is still counted).
3. Subscribes to `message.updated` (applies positive deltas only, keyed by message ID),
   `session.created` (adds new children), `session.deleted` (drops tracking, cost stays
   monotone), and `session.idle` (resync safety net in case an event was lost).

Cost deltas are guarded by `max(0, delta)` to protect against any event-ordering
inversion, even though opencode's own cost field is monotone.

## Compatibility

Tested against OpenCode 1.18.x. The plugin uses only the public TUI plugin API
(`@opencode-ai/plugin/tui`) and the SDK client (`@opencode-ai/sdk/v2`); `@opentui/solid`
and `solid-js` are provided by opencode's bundled runtime, so there are no installable
dependencies.

## License

GPL-3.0 — see [LICENSE](./LICENSE).
