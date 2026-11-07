// Copyright 2026 RodrigoCossi (https://github.com/RodrigoCossi)
// Part of Session Tree for Claude Code: https://github.com/RodrigoCossi/claude-code-session-tree
// Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE). Commercial use needs a
// separate license. Keep this notice in every copy or modified version.

import { expect, test } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'
import { flatten } from './register'

const tool = (text: string) => ({ tool: 'Bash', input: { command: 'cat big.log' }, text, isError: false })
const msg = (text: string, toolUses: ReturnType<typeof tool>[] = []) => ({ role: 'assistant', text, toolUses }) as unknown as SessionMessage

test('a long turn keeps its start and its final answer, and cuts the middle', async () => {
  const rows = [
    msg('Starting the work.'),
    ...Array.from({ length: 12 }, (_, i) => msg('', [tool(`STEP${i} ` + 'x'.repeat(5_500))])),
    msg('FINAL ANSWER: all done.'),
  ]
  const { built, reply } = flatten(rows)
  expect(built.length <= 30_000).toBe(true)
  expect(built.startsWith('Starting the work.')).toBe(true)
  expect(built.endsWith('FINAL ANSWER: all done.')).toBe(true)
  expect(built.includes('middle of this turn cut')).toBe(true)
  expect(reply).toBe('FINAL ANSWER: all done.')
})

test('a tool result up to 6,000 characters is kept whole', async () => {
  const { built } = flatten([msg('', [tool('y'.repeat(5_900) + 'END')]), msg('ok')])
  expect(built.includes('y'.repeat(5_900) + 'END')).toBe(true)
})

test('a short turn is unchanged', async () => {
  const { built } = flatten([msg('Hello.'), msg('Bye.')])
  expect(built).toBe('Hello.\n\nBye.')
})
