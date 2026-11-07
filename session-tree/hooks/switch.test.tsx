// Copyright 2026 RodrigoCossi (https://github.com/RodrigoCossi)
// Part of Session Tree for Claude Code: https://github.com/RodrigoCossi/claude-code-session-tree
// Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE). Commercial use needs a
// separate license. Keep this notice in every copy or modified version.

import { expect, test } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'

const PANE = {
  plugin: 'session-tree', component: 'Pane', requestId: 'session-tree',
  props: { title: 'Session tree', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const
const node = (n: number, parent: string | null, prompt: string) => ({ id: `t${n}`, parent, n, prompt, reply: `r${n}`, built: `answer ${n}`, at: n })
const u = (text: string): SessionMessage => ({ role: 'user', text, toolUses: [] })
const a = (text: string): SessionMessage => ({ role: 'assistant', text, toolUses: [] })

test('clicking a turn asks for the cut and moves the head there', async ($, on) => {
  const tree = {
    nodes: [node(1, null, 'first'), node(2, 't1', 'testing 1'), node(3, 't1', 'testing 2'), node(4, 't3', 'testing 3')],
    head: 't4',
  }
  let state: unknown = { shape: 'tree-2', value: tree }; let ver = 1
  on('state.get', () => ({ value: { value: state, version: ver } }))
  on('state.set', (_, e: any) => { state = e.value; ver++; return { value: { isSet: true, version: ver } } })
  const messages = [u('first'), a('answer 1'), u('<command-name>/compact</command-name> <command-args>session-tree:switch:t1</command-args>'), u('testing 2'), a('ok'), u('testing 3'), a('ok')]
  let sent: any
  on('session.compact', (_, e: any) => { sent = e; return { messages } })
  on('ui.toast', () => ({}))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const b = await ui.find({ type: 'Button', text: /testing 2/ })
  await ui.press({ key: b!.key! })
  await new Promise(r => setTimeout(r, 50))
  expect(sent.instructions.startsWith('session-tree:cut:')).toBe(true)
  const req = JSON.parse(sent.instructions.slice('session-tree:cut:'.length))
  expect(req.target).toBe('t3')
  expect(req.nodes.find((n: any) => n.id === 't3').built).toBe('answer 3') // the target branch goes in full
  expect(req.nodes.find((n: any) => n.id === 't2').built).toBe('') // other branches are slimmed
  expect((state as any).value.head).toBe('t3')
  await ui.unmount()
})
