/** @jsxImportSource @opentui/solid */
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { createMemo, onMount } from "solid-js"

// ponytail: USD car model.cost est en USD côté opencode
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

// ponytail: en V2, `data.session.cost(root)` somme déjà toute la famille
// (session racine + descendants enregistrés) : le data layer opencode maintient
// `family` via les events `session.created` / `session.deleted` et rafraîchit
// les coûts via `session.usage.updated` (coût cumulatif par session, monotone —
// revert/unrevert ne soustraient jamais). Le plugin se contente d'afficher la
// décomposition Main / Subs / Total.
function View(props: { sessionID: string }) {
  const ctx = usePlugin()

  const main = createMemo(() => ctx.data.session.get(props.sessionID)?.cost ?? 0)
  const total = createMemo(() => ctx.data.session.cost(props.sessionID))
  // ponytail: garde max(0, ...) — protège contre toute inversion transitoire
  // entre la lecture de `total` et celle de `main` (batch du store).
  const subs = createMemo(() => Math.max(0, total() - main()))

  // Les sous-sessions créées avant le montage du composant ne sont pas
  // forcément connues du store : on les sync récursivement au montage (BFS sur
  // `client.session.list({ parentID })`). Ensuite, les events `session.created`
  // enregistrent les nouveaux descendants dans la famille.
  onMount(() => {
    let cancelled = false
    const bootstrap = async () => {
      const seen = new Set([props.sessionID])
      const queue = [props.sessionID]
      while (queue.length > 0 && !cancelled) {
        const current = queue.shift() as string
        let children: string[] = []
        try {
          const res = await ctx.client.session.list({ parentID: current })
          children = (res.data ?? []).map((s) => s.id)
        } catch {
          continue
        }
        for (const id of children) {
          if (seen.has(id)) continue
          seen.add(id)
          queue.push(id)
          try {
            await ctx.data.session.sync(id)
          } catch {
            // session déjà disparue ou injoignable : on l'ignore
          }
        }
      }
    }
    void bootstrap()
    return () => {
      cancelled = true
    }
  })

  return (
    <box>
      <text fg={ctx.theme.text.base}>Costs</text>
      <text fg={ctx.theme.text.muted}>Main {money.format(main())}</text>
      <text fg={ctx.theme.text.muted}>Subs {money.format(subs())}</text>
      <text fg={ctx.theme.text.muted}>Total {money.format(total())}</text>
    </box>
  )
}

export default Plugin.define({
  id: "agents-cost",
  setup(ctx) {
    return ctx.ui.slot({
      append: "sidebar.content",
      render: ({ sessionID }) => <View sessionID={sessionID} />,
    })
  },
})
