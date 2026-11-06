import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'session-tree', component: 'Pane', requestId: 'session-tree',
  props: { title: 'Session tree', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const node = (n: number, parent: string | null, prompt: string, extra = {}) => ({ id: `t${n}`, parent, n, prompt, reply: `r${n}`, built: `answer ${n}`, at: n, ...extra })
const text = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((t: any) => t.text).join('\n')
const settle = () => new Promise(r => setTimeout(r, 50))

function stateOf(on: any, value: any) {
  const box = { state: { shape: 'tree-2', value } as any, ver: 1 }
  on('state.get', () => ({ value: { value: box.state, version: box.ver } }))
  on('state.set', (_: any, e: any) => { box.state = e.value; box.ver++; return { value: { isSet: true, version: box.ver } } })
  on('ui.toast', () => ({ value: undefined }) as never)
  return box
}

test('Fork here at the tip: the next turn draws as a new branch from it', async ($, on) => {
  const box = stateOf(on, { nodes: [node(1, null, 'one'), node(2, 't1', 'two')], head: 't2' })
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const f = await ui.find({ type: 'Button', text: /Fork here/ })
  expect(f).toBeTruthy()
  await ui.press({ key: f!.key! })
  await settle()
  expect(box.state.value.forkNext).toBe(true)
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await text(ui)).toMatch(/next prompt starts a new branch from turn 2/)
  expect(await ui.find({ type: 'Button', text: /Cancel fork/ })).toBeTruthy()
  await ui.unmount()
  // Simulate the turn that follows (what turn.complete writes), then draw again.
  box.state = { shape: 'tree-2', value: { ...box.state.value, forkNext: false, head: 't3', nodes: [...box.state.value.nodes, node(3, 't2', 'three', { fork: true })] } }
  box.ver++
  const ui2 = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const g = await text(ui2)
  expect(g).toMatch(/branch 2/) // a new branch, not main carried on
  expect(g).toMatch(/╮|╭/)
  await ui2.unmount()
})

test('select a branch, delete it, then undo', async ($, on) => {
  const nodes = [node(1, null, 'one'), node(2, 't1', 'two'), node(3, 't1', 'alt two'), node(4, 't3', 'alt three'), node(5, 't4', 'sub of alt', {}), node(6, 't3', 'second fork off alt')]
  const box = stateOf(on, { nodes, head: 't2' })
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Button', text: /Delete/ })).toBeFalsy()
  const chip = await ui.find({ type: 'Button', text: /branch 2/ })
  await ui.press({ key: chip!.key! })
  await settle()
  expect(box.state.value.selected).toBe('t3')
  await ui.unmount(); ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const del = await ui.find({ type: 'Button', text: /Delete/ })
  await ui.press({ key: del!.key! })
  await settle()
  await ui.unmount(); ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await text(ui)).toMatch(/4 turns \(with the branches off it\)/)
  const yes = await ui.find({ type: 'Button', text: /Yes, delete/ })
  await ui.press({ key: yes!.key! })
  await settle()
  expect(box.state.value.nodes.map((n: any) => n.id)).toEqual(['t1', 't2'])
  expect(box.state.value.head).toBe('t2')
  expect(box.state.value.seq).toBe(6)
  await ui.unmount(); ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const undo = await ui.find({ type: 'Button', text: /Undo delete branch 2/ })
  await ui.press({ key: undo!.key! })
  await settle()
  expect(box.state.value.nodes.length).toBe(6)
  await ui.unmount()
})

test('deleting the branch you stand on jumps back to its fork point first', async ($, on) => {
  const box = stateOf(on, { nodes: [node(1, null, 'one'), node(2, 't1', 'two'), node(3, 't1', 'alt')], head: 't3', selected: 't3', confirm: 't3' })
  let sent: any
  on('session.compact', (_: any, e: any) => { sent = e; return { messages: [{ role: 'user', text: 'one', toolUses: [] }] } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const yes = await ui.find({ type: 'Button', text: /Yes, delete/ })
  await ui.press({ key: yes!.key! })
  await settle()
  expect(JSON.parse(sent.instructions.slice('session-tree:cut:'.length)).target).toBe('t1')
  expect(box.state.value.head).toBe('t1')
  expect(box.state.value.nodes.map((n: any) => n.id)).toEqual(['t1', 't2'])
  await ui.unmount()
})

test('main cannot be deleted', async ($, on) => {
  stateOf(on, { nodes: [node(1, null, 'one'), node(2, 't1', 'two')], head: 't2', selected: 't1' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Button', text: /Delete/ })).toBeFalsy()
  expect(await text(ui)).toMatch(/main can't be deleted/)
  await ui.unmount()
})
