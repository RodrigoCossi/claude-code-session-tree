// Copyright 2026 RodrigoCossi (https://github.com/RodrigoCossi)
// Part of Session Tree for Claude Code: https://github.com/RodrigoCossi/claude-code-session-tree
// Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE). Commercial use needs a
// separate license. Keep this notice in every copy or modified version.

import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'session-tree',
  component: 'Pane',
  requestId: 'session-tree',
  props: { title: 'Session tree', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const node = (n: number, parent: string | null, prompt: string) => ({ id: `t${n}`, parent, n, prompt, reply: `answer ${n}`, built: `answer ${n}`, at: n })

test('three turns, then a fork from turn 1: both branches drawn, head marked', async ($, on) => {
  const tree = {
    nodes: [node(1, null, 'first question'), node(2, 't1', 'second question'), node(3, 't2', 'third question'), node(4, 't1', 'alternative second')],
    head: 't4',
  }
  on('state.get', () => ({ value: { value: { shape: 'tree-2', value: tree }, version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  for (const p of ['first question', 'second question', 'third question', 'alternative second']) {
    expect(await ui.find({ type: 'Button', text: new RegExp(p) })).toBeTruthy()
  }
  const graph = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
  expect(graph).toMatch(/╮/)
  expect(graph).toMatch(/◉/)
  expect(graph).toMatch(/branch 2/)
  expect(graph).toMatch(/main/)
  await ui.unmount()
})

test('records a turn from the transcript', async ($, on) => {
  const transcript: import('claude-code').SessionMessage[] = [{ role: 'user', text: 'hello tree', toolUses: [] }, { role: 'assistant', text: 'hi', toolUses: [{ tool_use_id: 'x', tool: 'Bash', input: { command: 'ls' }, text: 'a b' }] }]
  on('command.register', () => ({ value: { command: 'tree' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.start', () => ({ turnId: 't' }))
  on('turn.complete', () => ({ text: '' }))
  on('session.messages', () => ({ value: transcript }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'hello tree', wait: false, origin: { kind: 'person' } } as never)
  await $.turn.start({ turnId: 't' } as never)
  await $.turn.complete({ turnId: 't', answer: 'hi', durationMs: 1, isAborted: false, reason: 'end_turn' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Button', text: /hello tree/ })).toBeTruthy()
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')).toMatch(/◉/)
  await ui.unmount()
})

test('a Tree button sits in the footer corner, keeping the mode labels, and opens the pane', async ($, on) => {
  let opened = 0
  on('ui.open', () => (opened++, { value: { isPlaced: true } }))
  const ui = await $.ui.mount({ plugin: 'session-tree', component: 'SessionMode', props: { modes: ['focus'] }, surface: 'terminal' } as never)
  const b = await ui.find({ type: 'Button', text: /Tree/ })
  expect(b).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /focus/ })).toBeTruthy()
  await ui.press({ key: b!.key! })
  expect(opened).toBe(1)
  await ui.unmount()
})

test('each branch draws in its own colour', async ($, on) => {
  const node = (n: number, parent: string | null, prompt: string) => ({ id: `t${n}`, parent, n, prompt, reply: '', built: '', at: n })
  const tree = { nodes: [node(1, null, 'a'), node(2, 't1', 'b'), node(3, 't1', 'c'), node(4, 't1', 'd')], head: 't4' }
  on('state.get', () => ({ value: { value: { shape: 'tree-2', value: tree }, version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const colours = new Set((await ui.findAll({ type: 'Text' })).filter(t => /[●◉│╮─]/.test(t.text) && (t as any).props?.color).map(t => (t as any).props.color))
  console.log(JSON.stringify([...colours]))
  expect(colours.size).toBeGreaterThanOrEqual(3)
  await ui.unmount()
})
