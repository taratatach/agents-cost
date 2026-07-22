/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { AssistantMessage, Message, Session } from "@opencode-ai/sdk/v2"
import { createMemo, createSignal, onCleanup } from "solid-js"

// ponytail: USD car model.cost est en USD côté opencode
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

// ponytail: cost est strictement monotone côté opencode (AssistantMessage.cost += usage.cost
// à chaque step-finish ; revert/unrevert/deleteMessage ne soustraient jamais). Donc `subs`
// ne décrémente jamais — l'argent dépensé reste dépensé.
// Sources: packages/opencode/src/session/processor.ts (step-finish),
// packages/opencode/src/session/revert.ts (aucun appel à cost).

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const parent = createMemo(() => props.api.state.session.get(props.session_id))
  const main = createMemo(() => parent()?.cost ?? 0)
  const [subs, setSubs] = createSignal(0)

  // ponytail: knownChildren vivants uniquement (pour filtrer les events).
  // `subs` reste inchangé à la suppression — l'argent est dépensé.
  const knownChildren = new Set<string>()
  // ponytail: coût déjà comptabilisé par messageID (pour ne calculer que des deltas positifs).
  // Pas de GC : les IDs sont uniques et la mémoire est négligeable.
  const msgCosts = new Map<string, number>()

  const logErr = (msg: string, extra?: Record<string, unknown>) =>
    props.api.client.app
      .log({ service: "agents-cost", level: "error", message: msg, extra })
      .catch(() => {})

  // ponytail: applique un delta positif seulement. Cost est monotone côté opencode,
  // mais la garde max(0, ...) protège contre toute inversion liée à un ordre d'events.
  const applyDelta = (messageID: string, cost: number) => {
    const prev = msgCosts.get(messageID) ?? 0
    const delta = cost - prev
    if (delta > 0) {
      setSubs((s) => s + delta)
      msgCosts.set(messageID, cost)
    }
  }

  // ponytail: baseline d'une sous-session — somme initiale des AssistantMessage.cost.
  // `session.messages` retourne tous les messages ; seuls les assistants ont un cost.
  const baseline = async (sid: string) => {
    try {
      const res = await props.api.client.session.messages({ sessionID: sid })
      for (const m of res.data ?? []) {
        if (m.info.role !== "assistant") continue
        const am = m.info as AssistantMessage
        applyDelta(am.id, am.cost)
      }
    } catch (e) {
      logErr("messages baseline failed", { session: sid, error: String(e) })
    }
  }

  // ponytail: BFS sur `client.session.children` (endpoint direct-children uniquement,
  // pas de descendants). Pour les sous-sous-agents, il faut récursivement walk.
  const bootstrap = async () => {
    const root = props.session_id
    const queue: string[] = [root]
    while (queue.length) {
      const cur = queue.shift() as string
      try {
        const res = await props.api.client.session.children({ sessionID: cur })
        for (const child of res.data ?? []) {
          if (child.id === root || knownChildren.has(child.id)) continue
          knownChildren.add(child.id)
          queue.push(child.id)
          await baseline(child.id)
        }
      } catch (e) {
        logErr("children fetch failed", { parent: cur, error: String(e) })
      }
    }
  }

  bootstrap()

  const onMessageUpdated = (e: { properties: { info: Message } }) => {
    const info = e.properties?.info
    if (!info || info.role !== "assistant") return
    const am = info as AssistantMessage
    if (!knownChildren.has(am.sessionID)) return
    applyDelta(am.id, am.cost)
  }

  const onSessionCreated = (e: { properties: { info: Session } }) => {
    const info = e.properties?.info
    if (!info?.id) return
    // ponytail: parentID soit la session courante, soit un sous-agent déjà connu (nested).
    if (
      info.parentID === props.session_id ||
      (info.parentID && knownChildren.has(info.parentID))
    ) {
      knownChildren.add(info.id)
    }
  }

  const onSessionDeleted = (e: { properties: { info: Session } }) => {
    const info = e.properties?.info
    if (!info?.id || !knownChildren.has(info.id)) return
    // ponytail: subs monotone — on ne retire rien. Cleanup mémoire uniquement.
    knownChildren.delete(info.id)
  }

  const onSessionIdle = (e: { properties: { sessionID: string } }) => {
    const sid = e.properties?.sessionID
    if (!sid || !knownChildren.has(sid)) return
    // ponytail: safety net — resync si un event `message.updated` a été perdu.
    // Cost reste monotone grâce à `applyDelta` (delta positif seulement).
    baseline(sid)
  }

  const offMU = props.api.event.on("message.updated", onMessageUpdated)
  const offSC = props.api.event.on("session.created", onSessionCreated)
  const offSD = props.api.event.on("session.deleted", onSessionDeleted)
  const offI = props.api.event.on("session.idle", onSessionIdle)
  onCleanup(() => {
    offMU?.()
    offSC?.()
    offSD?.()
    offI?.()
  })

  const total = createMemo(() => main() + subs())
  return (
    <box>
      <text fg={theme().text}><b>Costs</b></text>
      <text fg={theme().textMuted}>Main {money.format(main())}</text>
      <text fg={theme().textMuted}>Subs {money.format(subs())}</text>
      <text fg={theme().textMuted}>Total {money.format(total())}</text>
    </box>
  )
}

export const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 150,
    slots: {
      sidebar_content: (_ctx, props) => <View api={api} session_id={props.session_id} />,
    },
  })
}
export default { id: "agents-cost", tui }
