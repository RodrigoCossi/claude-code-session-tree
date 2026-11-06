export type TurnNode = {
  id: string
  parent: string | null
  n: number // creation order, 1-based
  prompt: string // the user's prompt as typed
  reply: string // short preview of the final answer
  built: string // the whole turn flattened to text (tool calls included), used to rebuild a branch
  at: number
  fork?: boolean // started a new branch even though its parent was a branch tip (the Fork button)
}

export type Tree = {
  nodes: TurnNode[]
  head: string | null
  forkNext?: boolean // the Fork button was pressed: the next turn starts a new branch from head
  selected?: string | null // the selected branch, by the id of its first turn
  confirm?: string | null // the branch (first turn id) whose delete is awaiting Yes
  trash?: { nodes: TurnNode[]; name: string } | null // the last deleted branch, for Undo
  seq?: number // highest turn number ever given, so numbers never repeat after a delete
}

declare module 'claude-code' {
  interface PluginState {
    'session-tree': { tree: Shaped<Tree> }
  }
}
