// Copyright 2026 RodrigoCossi (https://github.com/RodrigoCossi)
// Part of Session Tree for Claude Code: https://github.com/RodrigoCossi/claude-code-session-tree
// Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE). Commercial use needs a
// separate license. Keep this notice in every copy or modified version.

import { expect, test } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'
import { cutFor } from './cut'

const node = (n: number, parent: string | null, prompt: string) => ({ id: `t${n}`, parent, n, prompt, reply: `r${n}`, built: `answer ${n}`, at: n })
const u = (text: string): SessionMessage => ({ role: 'user', text, toolUses: [] })
const a = (text: string): SessionMessage => ({ role: 'assistant', text, toolUses: [] })
const cmd = (id: string) => [u('<local-command-caveat>The command below…</local-command-caveat>'), u(`<command-name>/compact</command-name> <command-args>session-tree:switch:${id}</command-args>`), u('<local-command-stdout>Compacted</local-command-stdout>')]
const texts = (m: SessionMessage[] | null) => (m ?? []).map(x => x.text)

// The real session: pre-tree history, then turns; the tree's head lagged behind (stale), which must not matter.
const nodes = [node(1, null, 'I will be pasting several inputs and testing navigation'), node(2, 't1', 'testing 1'), node(3, 't1', 'testing 2'), node(4, 't3', 'testing 3'), node(5, 't3', 'testing 3.5')]
const history = [u('old stuff from before the tree'), a('old answer'), u(nodes[0]!.prompt), a('Okay.'), u('testing 1'), a('ok'), ...cmd('t1'), u('testing 2'), a('ok'), u('testing 3'), a('ok')]

test('jump back to turn 3 with a stale head: "testing 3" is dropped, history before is kept whole', async () => {
  const out = texts(cutFor({ nodes, head: 't1' }, 't3', history))
  expect(out).not.toContain('testing 3')
  expect(out).toContain('testing 2')
  expect(out).toContain('old stuff from before the tree')
  expect(out).not.toContain('testing 1') // another branch
  expect(out.slice(-2)).toEqual(['testing 2', 'answer 3'])
})

test('jump to a turn on another branch: shared part kept, the rest rebuilt from text', async () => {
  const out = texts(cutFor({ nodes, head: 't4' }, 't2', history))
  // t2 ("testing 1") is in the transcript right after t1, so it is kept as the engine's own
  expect(out).toContain('testing 1')
  expect(out).not.toContain('testing 2')
  expect(out).not.toContain('testing 3')
})

test('"testing 3" does not match "testing 3.5"', async () => {
  const h = [...history.slice(0, -2), u('testing 3.5'), a('ok')]
  const out = texts(cutFor({ nodes, head: 't5' }, 't4', h))
  expect(out).not.toContain('testing 3.5')
  expect(out.slice(-2)).toEqual(['testing 3', 'answer 4'])
})
