import type { Register, SessionMessage } from 'claude-code'

// Companion of the session-tree mod: applies a tree jump to the conversation.
// It is a separate mod because Claude Code skips the calling mod's own session.compact hook
// when a mod calls $.session.compact itself.
// session-tree calls compact with instructions = CUT_PREFIX + JSON { target, nodes }.
export const CUT_PREFIX = 'session-tree:cut:'

type TurnNode = { id: string; parent: string | null; n: number; prompt: string; reply: string; built: string; at: number }
type Tree = { nodes: TurnNode[]; head: string | null }

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

function pathTo(nodes: TurnNode[], id: string | null): TurnNode[] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const out: TurnNode[] = []
  let cur = id ? byId.get(id) : undefined
  while (cur) {
    out.unshift(cur)
    cur = cur.parent ? byId.get(cur.parent) : undefined
  }
  return out
}

const isCommandRow = (m: SessionMessage) => /^\s*<(local-command|command-name|command-message)/.test(m.text)
const sameText = (text: string, prompt: string) => {
  const a = oneLine(text)
  const b = oneLine(prompt)
  return b !== '' && (a === b || (b.length >= 20 && a.includes(b.slice(0, 200))))
}

// The messages that make the conversation look as if it had stopped at `targetId`.
export function cutFor(t: Tree, targetId: string, msgs: readonly SessionMessage[]): SessionMessage[] | null {
  const plan = cutPlan(t, targetId, msgs)
  if (!plan) return null
  const out = [...msgs.slice(0, plan.keep), ...plan.built]
  return out.length ? out : null
}

// The cut as data: keep msgs[0, keep) as the engine's own, then the rebuilt turns.
export function cutPlan(t: Tree, targetId: string, msgs: readonly SessionMessage[]): { keep: number; built: SessionMessage[] } | null {
  const target = pathTo(t.nodes, targetId)
  if (target.length === 0) return null
  const userRow = (m: SessionMessage) => m.role === 'user' && !(m.toolResults?.length)
  const isTurnStart = (m: SessionMessage) => userRow(m) && (isCommandRow(m) || t.nodes.some(n => sameText(m.text, n.prompt)))
  const nextStart = (from: number) => {
    for (let i = from + 1; i < msgs.length; i++) if (isTurnStart(msgs[i]!)) return i
    return -1
  }
  // First turn of the branch: its first occurrence; each later one must be the very next turn.
  let k = 0
  let at = -1
  for (let i = 0; i < target.length; i++) {
    let idx = -1
    if (i === 0) {
      idx = msgs.findIndex(m => userRow(m) && sameText(m.text, target[0]!.prompt))
    } else {
      idx = nextStart(at)
      while (idx >= 0 && isCommandRow(msgs[idx]!)) idx = nextStart(idx) // a /command between turns
    }
    if (idx < 0 || !sameText(msgs[idx]!.text, target[i]!.prompt)) break
    at = idx
    k = i + 1
  }
  let keepUpTo: number
  if (k > 0) {
    const end = nextStart(at)
    keepUpTo = end < 0 ? msgs.length : end
  } else {
    // None of the branch is in the transcript: keep what came before the tree's first turn.
    const first = msgs.findIndex(isTurnStart)
    keepUpTo = first < 0 ? msgs.length : first
  }
  const built: SessionMessage[] = []
  for (const n of target.slice(k)) {
    built.push({ role: 'user', text: n.prompt, toolUses: [] })
    built.push({ role: 'assistant', text: n.built || n.reply || '(no reply)', toolUses: [] })
  }
  return { keep: keepUpTo, built }
}

export const register: Register = on => {
  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined || !e.instructions?.startsWith(CUT_PREFIX)) return next(e)
    let req: { target: string; nodes: TurnNode[] }
    try { req = JSON.parse(e.instructions.slice(CUT_PREFIX.length)) } catch { return { skip: 'session tree: bad jump data' } }
    const out = cutFor({ nodes: req.nodes, head: null }, req.target, e.messages)
    if (!out) return { skip: 'session tree: nothing to switch to' }
    return { messages: out }
  })
}
