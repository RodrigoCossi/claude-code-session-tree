import { expect, test } from 'claude-code/testing'
import { layout } from './register'

const node = (n: number, parent: string | null) => ({ id: `t${n}`, parent, n, prompt: `p${n}`, reply: '', built: '', at: n })

test('sequential dots on a branch are joined by a line on the spacer between them', async () => {
  // main: 1-2-3, branch from 1: 4
  const { rows } = layout([node(1, null), node(2, 't1'), node(3, 't2'), node(4, 't1')])
  const pic = rows.map(r => `${r.cells.join('')}  ${r.node.prompt}\n${r.link.map(o => (o >= 0 ? '│' : ' ')).join('')}`).join('\n')
  console.log(pic)
  expect(rows.map(r => r.node.prompt)).toEqual(['p1', 'p2', 'p3', 'p4']) // oldest at the top
  expect(rows[0]!.cells.join('')).toMatch(/╮/) // the branch bends out of turn 1, downward
  for (const r of rows.slice(0, 2)) expect(r.link[0]).toBe(0) // main runs 1 → 2 → 3
  expect(rows[rows.length - 1]!.link.every(o => o < 0)).toBe(true)
})
