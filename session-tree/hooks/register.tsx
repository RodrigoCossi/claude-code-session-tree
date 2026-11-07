// Copyright 2026 RodrigoCossi (https://github.com/RodrigoCossi)
// Part of Session Tree for Claude Code: https://github.com/RodrigoCossi/claude-code-session-tree
// Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE). Commercial use needs a
// separate license. Keep this notice in every copy or modified version.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMessage } from 'claude-code'

import type { Tree, TurnNode } from '../types'
const CUT_PREFIX = 'session-tree:cut:' // read by the session-tree-cut mod

const PANE = 'session-tree'
const TITLE = 'Session tree'
const tree = atom({ plugin: 'session-tree', key: 'tree' } as const, { nodes: [], head: null } as Tree, {
  shape: 'tree-2',
})

const BUILT_CAP = 30_000
const RESULT_CAP = 6_000

// Module variables (reset on reload, which is fine: they only live across one call).
// Prompts sent but not yet recorded, oldest first. One typed while a turn runs fires its submit at
// Enter and waits in the queue, so a single slot would lose it (2026-11-02: 4 turns, 3 dots).
let pendingPrompts: string[] = []
let turnRunning = false
// The switch in flight: its rows in the transcript are rewritten into one readable line.
let switching: { marker: string; line: string } | null = null

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

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

const isPrompt = (m: SessionMessage) => m.role === 'user' && !(m.toolResults?.length) && m.text.trim() !== ''

// Index of the user message that opened the turn whose prompt is `prompt`, searching from `from`.
function findPrompt(msgs: readonly SessionMessage[], prompt: string, from: number): number {
  const key = oneLine(prompt).slice(0, 200)
  for (let i = from; i < msgs.length; i++) {
    const m = msgs[i]!
    if (m.role === 'user' && key !== '' && oneLine(m.text).includes(key)) return i
  }
  return -1
}

const MIDDLE_CUT = '\n\n[… middle of this turn cut …]\n\n'
const clipMiddle = (s: string, n: number) => {
  if (s.length <= n) return s
  const room = n - MIDDLE_CUT.length
  if (room < 2) return MIDDLE_CUT.trim()
  return s.slice(0, Math.ceil(room / 2)) + MIDDLE_CUT + s.slice(s.length - Math.floor(room / 2))
}

// Over BUILT_CAP, the middle of the turn is cut and the final answer always kept.
export function flatten(rows: readonly SessionMessage[]): { built: string; reply: string } {
  const parts: string[] = []
  let reply = ''
  for (const m of rows) {
    if (m.role !== 'assistant') continue
    if (m.text.trim()) {
      parts.push(m.text.trim())
      reply = m.text.trim()
    }
    for (const t of m.toolUses) {
      const input = clip(JSON.stringify(t.input), 600)
      const res = t.text === undefined ? '(no result)' : clip(t.text, RESULT_CAP)
      parts.push(`[tool ${t.tool} ${input}${t.isError ? ' → ERROR' : ' →'} ${res}]`)
    }
  }
  const endsWithReply = reply !== '' && parts[parts.length - 1] === reply
  let built: string
  if (endsWithReply && parts.length > 1) {
    const final = clipMiddle(reply, BUILT_CAP)
    const room = BUILT_CAP - final.length - 2
    const before = parts.slice(0, -1).join('\n\n')
    built = room >= before.length ? `${before}\n\n${final}` : `${clipMiddle(before, Math.max(0, room))}\n\n${final}`
  } else {
    built = clipMiddle(parts.join('\n\n'), BUILT_CAP)
  }
  return { built, reply: clip(oneLine(reply), 300) }
}

// ── git-graph layout, oldest first: the first turn at the top ───────────────────
// owners[i]: which branch drew cell i (its colour), or -1 for blank.
// link[i]: the branch whose line runs in cell i of the spacer line below this row, or -1.
type Row = { node: TurnNode; lane: number; cells: string[]; owners: number[]; link: number[]; branch: number; branchKey: string; tipOf: string | null }
export type BranchInfo = { key: string; name: string; parent: string | null; members: string[] }

// One colour per branch, in the order branches appear: blue trunk, then magenta, green, …
export const BRANCH_COLORS = ['blue', 'magenta', 'green', 'yellow', 'cyan', 'red', 'blueBright', 'magentaBright', 'greenBright', 'yellowBright'] as const

type Branch = { id: number; name: string; members: TurnNode[]; parent: string | null; lane: number; top: number; bottom: number }

export function layout(nodes: TurnNode[]): { rows: Row[]; width: number; branches: BranchInfo[] } {
  const sorted = [...nodes].sort((a, b) => a.n - b.n)
  const firstKid = new Map<string, string>()
  // A turn made after the Fork button never carries its parent's branch on.
  for (const n of sorted) if (n.parent && !n.fork && !firstKid.has(n.parent)) firstKid.set(n.parent, n.id)
  // The oldest child carries its parent's branch on; every other child starts a new one.
  const branches: Branch[] = []
  const branchOf = new Map<string, Branch>()
  for (const n of sorted) {
    let b = n.parent && firstKid.get(n.parent) === n.id ? branchOf.get(n.parent) : undefined
    if (!b) {
      b = { id: branches.length, name: branches.length === 0 ? 'main' : `branch ${branches.length + 1}`, members: [], parent: n.parent, lane: 0, top: 0, bottom: 0 }
      branches.push(b)
    }
    b.members.push(n)
    branchOf.set(n.id, b)
  }
  const order = [...sorted].reverse() // newest at the top
  const rowOf = new Map(order.map((n, i) => [n.id, i]))
  for (const b of branches) {
    b.top = rowOf.get(b.members[b.members.length - 1]!.id)!
    b.bottom = b.parent ? rowOf.get(b.parent)! : rowOf.get(b.members[0]!.id)! // a branch runs down to the turn it came from
  }
  // Lanes: the trunk first, then each branch in the lowest lane free over its rows.
  const taken: Array<Array<[number, number]>> = []
  for (const b of branches) {
    let l = 0
    while ((taken[l] ?? []).some(([t, bo]) => !(b.bottom < t || b.top > bo))) l++
    b.lane = l
    ;(taken[l] ??= []).push([b.top, b.bottom])
  }
  const width = Math.max(1, taken.length) * 2 - 1
  const grid = order.map(() => Array.from({ length: width }, () => ' '))
  const own = order.map(() => Array.from({ length: width }, () => -1))
  const put = (r: number, c: number, ch: string, o: number) => { grid[r]![c] = ch; own[r]![c] = o }
  for (const b of branches) {
    const last = b.parent ? b.bottom - 1 : b.bottom
    for (let r = b.top; r <= last; r++) put(r, b.lane * 2, '│', b.id)
    for (const m of b.members) put(rowOf.get(m.id)!, b.lane * 2, '●', b.id)
  }
  // Each branch bends into the turn it came from: ●─╯
  for (const b of branches) {
    if (!b.parent) continue
    const from = branchOf.get(b.parent)!.lane
    const r = b.bottom
    const lo = Math.min(from, b.lane) * 2
    const hi = Math.max(from, b.lane) * 2
    for (let c = lo + 1; c < hi; c++) if (grid[r]![c] === ' ' || grid[r]![c] === '─') put(r, c, '─', b.id)
    put(r, b.lane * 2, b.lane > from ? '╯' : '╰', b.id)
  }
  // The spacer line under each row: every branch's line continues through it, so sequential dots are joined.
  const link = order.map(() => Array.from({ length: width }, () => -1))
  for (const b of branches) for (let r = b.top; r < b.bottom; r++) link[r]![b.lane * 2] = b.id
  const rows = order.map((node, i) => {
    const b = branchOf.get(node.id)!
    const isTip = b.members[b.members.length - 1]!.id === node.id
    return { node, lane: b.lane, cells: grid[i]!, owners: own[i]!, link: link[i]!, branch: b.id, branchKey: b.members[0]!.id, tipOf: isTip ? b.name : null }
  })
  // Shown oldest first (first turn at the top): flip the drawing upside down. The spacer under
  // a flipped row is the one that was above it; the bends turn over (╯ → ╮, ╰ → ╭).
  const flip: Record<string, string> = { '╯': '╮', '╰': '╭' }
  const R = rows.length
  return {
    rows: rows.map((_, i) => {
      const r = rows[R - 1 - i]!
      const below = R - 2 - i >= 0 ? rows[R - 2 - i]!.link : r.link.map(() => -1)
      return { ...r, cells: r.cells.map(c => flip[c] ?? c), link: below }
    }),
    width,
    branches: branches.map(b => ({ key: b.members[0]!.id, name: b.name, parent: b.parent, members: b.members.map(m => m.id) })),
  }
}

// Every turn a branch delete removes: the branch's own turns and everything that grew from them.
export function doomed(nodes: TurnNode[], members: string[]): Set<string> {
  const out = new Set(members)
  for (let grew = true; grew; ) {
    grew = false
    for (const n of nodes) if (n.parent && out.has(n.parent) && !out.has(n.id)) { out.add(n.id); grew = true }
  }
  return out
}

// The pane asks for as wide as the dock allows (Claude Code caps it at 45% of the terminal).
const WIDE = 400

// The Tree button toggles the pane. Whether it is showing is tracked here (an open that placed it
// sets it, any close clears it) rather than asked of $.ui.panes(): the open must run straight from the
// press, or Claude Code no longer counts it as the person's and won't place it on a narrow terminal.
let paneShown = false
function toggle($: EngineInterface) {
  if (paneShown) {
    paneShown = false
    return void $.ui.close({ id: PANE }).catch(() => {})
  }
  return void open($, true).catch(() => {})
}

async function open($: EngineInterface, focus = false) {
  const r = await $.ui.open({ id: PANE, title: TITLE, columns: WIDE, ...(focus ? { focus: true as const } : {}) })
  paneShown = r.isPlaced
  if (focus && !r.isPlaced) $.ui.toast(`The tree can't be shown here: ${r.reason}`)
  return r
}

let switchApplied = false

// A jump is a compaction whose result is the cut (cut.tsx applies it; see there why it is separate).
async function jump($: EngineInterface, id: string): Promise<string> {
  const t = await read($, tree)
  const node = t.nodes.find(n => n.id === id)
  if (!node) return 'No such turn.'
  if (switching) return 'A switch is already running.'
  if (t.head === id) {
    const tip = !t.nodes.some(c => c.parent === id)
    $.ui.toast(tip
      ? `You're already on turn ${node.n}. Type to continue, or press Fork here to start a new branch from it.`
      : `You're already on turn ${node.n}. Your next prompt starts a new branch from it.`)
    return `Already at turn ${node.n}.`
  }
  if (turnRunning) {
    $.ui.toast('Wait for the current turn to finish, then click again.')
    return 'A turn is running.'
  }
  const marker = `session-tree:switch:${id}`
  switchApplied = false
  switching = { marker, line: '' }
  try {
    // The cut is worked out by the session-tree-cut mod from the exact messages being compacted.
    // It needs every turn's prompt (to find turn starts) and the target branch in full.
    const onPath = new Set(pathTo(t.nodes, id).map(n => n.id))
    const slim = t.nodes.map(n => (onPath.has(n.id) ? n : { ...n, built: '', reply: '' }))
    const res = await $.session.compact({ instructions: CUT_PREFIX + JSON.stringify({ target: id, nodes: slim }) })
    if (res.skip) throw new Error(res.skip)
    switchApplied = true
  } catch (err) {
    switching = null
    $.ui.toast(`Could not switch: ${String(err)}`)
    return `Could not switch: ${String(err)}`
  }
  switching = null
  if (!switchApplied) {
    $.ui.toast('Branch switch did not apply; the conversation was not changed by the tree.')
    return 'Branch switch did not apply.'
  }
  await update($, tree, x => ({ ...x, head: id, forkNext: false }))
  return `Now at turn ${node.n}.`
}

// ── Fork button: the next prompt starts a new branch from where you are, without jumping ──
async function forkHere($: EngineInterface, on: boolean) {
  const t = await read($, tree)
  if (!t.head) return void $.ui.toast('Send a first prompt, then you can fork from it.')
  await update($, tree, x => ({ ...x, forkNext: on }))
}

// ── Selecting and deleting a branch ──
async function select($: EngineInterface, key: string) {
  await update($, tree, x => ({ ...x, selected: x.selected === key ? null : key, confirm: null }))
}

async function deleteBranch($: EngineInterface, key: string) {
  const t = await read($, tree)
  const b = layout(t.nodes).branches.find(x => x.key === key)
  if (!b) return void (await update($, tree, x => ({ ...x, selected: null, confirm: null })))
  if (!b.parent) return void $.ui.toast("The main line can't be deleted; delete the branches off it instead.")
  const gone = doomed(t.nodes, b.members)
  // Standing on the branch: move the conversation back to where it forked first, so Claude forgets it too.
  if (t.head && gone.has(t.head)) {
    const r = await jump($, b.parent)
    if (!r.startsWith('Now at')) return
  }
  await update($, tree, x => {
    if (x.head && gone.has(x.head)) return x // a turn landed on it meanwhile: leave it
    const seq = Math.max(x.seq ?? 0, ...x.nodes.map(n => n.n))
    return {
      ...x,
      seq,
      nodes: x.nodes.filter(n => !gone.has(n.id)),
      trash: { nodes: x.nodes.filter(n => gone.has(n.id)), name: b.name },
      selected: null,
      confirm: null,
    }
  })
  $.ui.toast(`Deleted ${b.name} (${gone.size} turn${gone.size === 1 ? '' : 's'}). Undo is in the tree pane.`)
}

async function undoDelete($: EngineInterface) {
  await update($, tree, x => {
    if (!x.trash) return x
    const ids = new Set(x.nodes.map(n => n.id))
    const back = x.trash.nodes.filter(n => !ids.has(n.id))
    return { ...x, nodes: [...x.nodes, ...back].sort((a, b) => a.n - b.n), trash: null }
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'tree', description: 'Show the session tree (turns and forks) in a pane' })
    await $.command.register({ name: 'tree-go', description: 'Jump to turn N of the session tree (branches from there)' })
    return next(e)
  })

  on('command.run', { command: 'tree' }, async $ => {
    await open($, true)
    return { text: 'Session tree opened. Click a turn to jump there; your next prompt branches from it.' }
  })

  // /tree-go N — keyboard way to jump to turn N.
  on('command.run', { command: 'tree-go' }, async ($, e) => {
    const n = Number(e.args.trim())
    const t = await read($, tree)
    const node = t.nodes.find(x => x.n === n)
    if (!node) return { text: `No turn ${e.args.trim() || '(none given)'}. Turns: 1–${t.nodes.length}.` }
    setTimeout(() => void jump($, node.id), 300)
    return { text: `Switching to turn ${n}…` }
  })

  on('prompt.submit', async ($, e, next) => {
    if (!e.command && !e.isMeta && e.text.trim()) {
      // Nothing running: any leftovers were merged into an earlier turn, so start fresh.
      if (turnRunning) pendingPrompts.push(e.text)
      else pendingPrompts = [e.text]
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) turnRunning = true
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const res = await next(e)
    if (e.agentId !== undefined) return res
    turnRunning = false
    const prompt = pendingPrompts.shift() ?? null
    if (!prompt || switching) return res // a /command, a compaction or a switch is not a turn
    const msgs = await $.session.messages()
    let start = prompt ? findPrompt(msgs, prompt, 0) : -1
    if (prompt && start >= 0) {
      // the latest occurrence
      for (let j = findPrompt(msgs, prompt, start + 1); j >= 0; j = findPrompt(msgs, prompt, j + 1)) start = j
    }
    if (start < 0) {
      for (let i = msgs.length - 1; i >= 0; i--) if (isPrompt(msgs[i]!)) { start = i; break }
    }
    if (start < 0) return res
    const rows = msgs.slice(start)
    const { built, reply } = flatten(rows)
    await update($, tree, t => {
      const n = Math.max(t.seq ?? 0, ...t.nodes.map(x => x.n)) + 1
      const node: TurnNode = {
        id: `t${n}-${Date.now().toString(36)}`,
        parent: t.head,
        n,
        prompt: prompt ?? rows[0]!.text,
        reply: reply || oneLine(e.answer ?? ''),
        built,
        at: Date.now(),
        ...(t.forkNext ? { fork: true } : {}),
      }
      return { ...t, nodes: [...t.nodes, node].slice(-500), head: node.id, seq: n, forkNext: false, confirm: null }
    })
    return res
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    paneShown = false
    return next(e)
  })

  // The button in the bottom-right corner of the prompt footer, beside the engine's mode labels.
  on('ui.render', { component: 'SessionMode' }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const t = await read($, tree)
    const modes = e.props?.modes ?? []
    return (
      <Box flexDirection="row" justifyContent="flex-end">
        {modes.length > 0 && <Text dimColor>{modes.join(' & ')}  </Text>}
        <Button key="session-tree-open" variant="primary" onPress={() => toggle($)}>
          {`🌳 Tree${t.nodes.length ? ` (${t.nodes.length})` : ''}`}
        </Button>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const t = await read($, tree)
    if (t.nodes.length === 0) {
      return (
        <Box flexDirection="column">
          <Text bold>No turns yet</Text>
          <Text dimColor>Each prompt you send becomes a dot here.</Text>
          <Text dimColor>Click a past dot to jump back; your next prompt then forks a new branch, and the old one stays.</Text>
        </Box>
      )
    }
    const { rows, width, branches } = layout(t.nodes)
    const cols = e.props?.bodyColumns ?? 50
    const color = (o: number) => (o < 0 ? undefined : BRANCH_COLORS[o % BRANCH_COLORS.length])
    const headIsTip = !!t.head && !t.nodes.some(n => n.parent === t.head)
    const headN = t.nodes.find(n => n.id === t.head)?.n
    const sel = branches.find(b => b.key === t.selected) ?? null
    const selColor = sel ? color(branches.indexOf(sel)) : undefined
    const gone = sel ? doomed(t.nodes, sel.members).size : 0

    // Toolbar: Fork on the left, the selected branch's Delete on the right; a confirm line replaces it.
    const toolbar = t.confirm && sel ? (
      <Box flexDirection="column" marginBottom={1}>
        <Text>
          <Text color="red" bold>{'Delete '}</Text>
          <Text color={selColor} bold>{sel.name}</Text>
          <Text>{` · ${gone} turn${gone === 1 ? '' : 's'}${gone > sel.members.length ? ' (with the branches off it)' : ''}?`}</Text>
        </Text>
        <Box flexDirection="row" gap={2}>
          <Button key="st-del-yes" variant="primary" onPress={() => void deleteBranch($, sel.key)}>Yes, delete</Button>
          <Button key="st-del-no" onPress={() => void update($, tree, x => ({ ...x, confirm: null }))}>Cancel</Button>
        </Box>
      </Box>
    ) : (
      <Box flexDirection="column" marginBottom={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexDirection="row" gap={2}>
            {t.forkNext ? (
              <Button key="st-fork-cancel" onPress={() => void forkHere($, false)}>✕ Cancel fork</Button>
            ) : headIsTip ? (
              <Button key="st-fork" variant="primary" onPress={() => void forkHere($, true)}>Fork here</Button>
            ) : (
              <Text dimColor>next prompt branches</Text>
            )}
            {t.trash && (
              <Button key="st-undo" onPress={() => void undoDelete($)}>{`↶ Undo delete ${t.trash.name}`}</Button>
            )}
          </Box>
          {sel ? (
            sel.parent ? (
              <Button key="st-del" onPress={() => void update($, tree, x => ({ ...x, confirm: sel.key }))}>
                <Text color="red">{'🗑 Delete '}</Text><Text color={selColor}>{sel.name}</Text>
              </Button>
            ) : (
              <Text dimColor>main can't be deleted</Text>
            )
          ) : (
            <Text dimColor>click a branch name to select</Text>
          )}
        </Box>
        {t.forkNext && (
          <Text color="green">{`Your next prompt starts a new branch from turn ${headN}.`}</Text>
        )}
      </Box>
    )

    return (
      <Box flexDirection="column">
        {toolbar}
        {rows.map((r, ri) => {
          const isHead = r.node.id === t.head
          const c = color(r.branch)
          const isSel = r.branchKey === t.selected
          const chip = r.tipOf ? r.tipOf.length + 6 : 0
          const label = clip(oneLine(r.node.prompt), Math.max(10, cols - width - 2 - chip - (isHead ? 15 : 0)))
          const spacer = ri < rows.length - 1 && r.link.some(o => o >= 0) && (
            <Text>
              {r.link.map((o, i) => (
                <Text key={i} color={color(o)}>{o >= 0 ? '│' : ' '}</Text>
              ))}
            </Text>
          )
          return (
            <Box key={r.node.id} flexDirection="column">
            <Box flexDirection="row">
              <Text>
                {r.cells.map((ch, i) => (
                  <Text key={i} color={color(r.owners[i]!)} bold={i === r.lane * 2}>
                    {i === r.lane * 2 && isHead ? '◉' : ch}
                  </Text>
                ))}
                {'  '}
              </Text>
              {r.tipOf && (
                <Button key={`sel-${r.branchKey}`} plain onPress={() => void select($, r.branchKey)}>
                  {isSel ? (
                    <Text backgroundColor={c} color="black" bold>{` ${r.tipOf} ✓ `}</Text>
                  ) : (
                    <Text color={c} bold>{`[${r.tipOf}]`}</Text>
                  )}
                </Button>
              )}
              {r.tipOf && <Text> </Text>}
              <Button key={r.node.id} plain onPress={() => void jump($, r.node.id)}>
                <Text>
                  <Text bold={isHead}>{label}</Text>
                  {isHead && <Text dimColor>{'  ← you are here'}</Text>}
                </Text>
              </Button>
            </Box>
            {spacer}
            </Box>
          )
        })}
      </Box>
    )
  })
}
