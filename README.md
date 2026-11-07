# 🌳 Session Tree for Claude Code

A Claude Code conversation is a single line. When it goes the wrong way, say a bad
approach, a misread request or a long detour, everything after it stays in Claude's context and
keeps steering the answers. Your choices are to argue it back on track, start a new session and
lose the useful context, or rewind and leave the other path behind with no map back to it. Session
Tree lets you try alternatives the way you would in git: go back to any turn, branch from there,
and keep every path you tried one click away, while Claude sees only the branch you're on.

A git-style graph of every turn in a Claude Code session, shown in a pane beside the chat.
Click any earlier turn to jump the conversation back to it. Your next prompt then starts a new
branch, and the other branches stay in the tree so you can switch back to them later.

<p align="center">
  <img src="docs/tree.svg" alt="Session Tree pane: main branch in blue, branch 2 in magenta, branch 3 in green, with the current turn marked" width="680">
</p>

## Features

- **Graph pane**: every turn as a dot, labelled with its prompt.
  Branches get tags such as `[main]` and `[branch 2]`. The first turn is at the top.
- **Jump**: click a turn, or use `/tree-go N`, and Claude sees only the conversation up to that
  turn on that branch.
- **Branch**: after a jump, the next prompt opens a new branch from that turn.
- **Fork here**: at the tip of a branch, start a new branch from it without jumping.
- **Delete branch**: click a branch's tag to select it, then 🗑 Delete → Yes. The branch and every
  branch grown from it are removed. If you are standing on it, the tree first jumps back to the
  fork point so Claude forgets it too. `main` cannot be deleted.
- **Undo delete**: restores the last deleted branch.
- **Queued prompts**: a prompt typed while a turn runs still gets its own dot.

## How it works

### The tree is stored outside the conversation

Each turn is a node with a pointer to its parent turn:

```ts
type TurnNode = {
  id: string
  parent: string | null   // the turn this one continued from
  n: number               // turn number (never reused, even after a delete)
  prompt: string          // the prompt as typed
  reply: string           // short preview of the answer
  built: string           // the whole turn flattened to text, used to rebuild a branch
  at: number
  fork?: boolean          // made after "Fork here"
}
```

The tree also keeps a `head`: the turn you are currently on. A new turn gets `parent = head` and
becomes the new head. Branches are not stored anywhere; they are worked out from the parent
links when the graph is drawn. The oldest child of a turn continues its branch, and every other
child starts a new one.

This bookkeeping costs **zero tokens** in the model's context: Claude never sees markers or
branch labels, only the conversation along the current path.

### A jump rewrites the context

A jump is done with Claude Code's own compaction hook, but instead of summarizing, it cuts:

1. `session-tree` calls `$.session.compact` with a special instruction that carries the target
   turn and the branch's nodes.
2. `session-tree-cut` catches that compaction, keeps the original messages up to the part shared
   with the target branch, and appends the rest of the target branch rebuilt from the stored turns.
3. The result replaces the conversation. No summary is written and no `/compact` rows appear.

The cut lives in a **separate mod** because Claude Code does not run a mod's own
`session.compact` hook for a compaction that the same mod started.

## Installation

1. In Claude Code, type this line at the prompt:

   ```
   /plugin install session-tree --marketplace RodrigoCossi/claude-code-session-tree
   ```

2. Answer the two questions:
   - **Add marketplace?** Press `y`.
   - **Where to install:** keep **Install for you (user scope)**, the first option, and press
     Enter. The mod then loads in every Claude Code session, in any folder.

   You'll see `Installed session-tree … (+ 1 dependency: session-tree-cut)`: the companion part
   that switches the conversation on a jump comes along automatically, with the same scope
   (see [How it works](#how-it-works) for why it is a separate part).

3. Check that it loaded: a **🌳 Tree** button appears at the bottom right of the prompt. Click it,
   or type `/tree`.

**Load it only once:** if you also load these folders another way (for example through
`CLAUDE_CODE_PLUGIN_DIRS` while developing), two Tree panes appear and closing one seems not
to work.

## Usage

| Action | How |
| --- | --- |
| Open / close the tree | 🌳 Tree button in the prompt footer, or `/tree` |
| Jump to a turn | Click it in the pane, or `/tree-go N` |
| New branch from an earlier turn | Jump to it, then type your next prompt |
| New branch from the tip you're on | **Fork here**, then type |
| Delete a branch | Click its `[tag]`, then 🗑 Delete → Yes |
| Undo the last delete | **↶ Undo delete** |

The pane asks for the widest dock Claude Code allows (45% of the terminal).

## How this differs from Claude Code's fork agent

Claude Code can also "fork": Claude can start a `fork` agent (the Agent tool with
`subagent_type: "fork"`). The two do different jobs.

**Claude Code's fork agent**
- Claude starts a copy of itself that has the whole conversation so far, on the same model.
- It runs **in the background, in parallel**. You keep talking to the main session while it works.
- You don't see it work and can't steer it; only the main session can message it. When it finishes,
  only its **final report** comes back into the main context. Its tool output stays out, which keeps
  that context small.
- It works on the same files, unless it is given its own git worktree. Its changes are real.
- Good for side jobs: "research or build X while we keep working on Y."

**Session Tree's branches**
- They branch **the same single conversation**. Only one branch is live at a time.
- It runs **one branch at a time, and you drive it**: you jump back to a turn and continue from there.
  Claude then forgets the other branch, because the jump cuts and rebuilds its context. The other
  branches stay in the graph so you can switch back.
- Nothing runs in parallel, and nothing reports back. Switching branches is how you move between them.
- Good for "what if I'd asked differently?", undoing a wrong turn, or exploring alternatives by hand.

**In short:** the fork agent is a parallel worker whose result is merged into the main conversation
as a summary. Session Tree is a time machine for one conversation: you go back and take a different
path, and nothing merges back. In both cases, files changed and commands run on any branch, or by
any fork, stay changed. Neither one undoes real work.

## Notes on cost and behavior

The numbers below were measured on 255 real sessions (1,541 turns, 6,356 tool results) by
re-running the mod's way of storing turns; token counts are estimated as characters ÷ 4.

### Token and context cost

- **What costs nothing**: the tree itself never enters the model's context, and a jump does not
  ask the model to summarize anything. After a jump, the context holds only the path to the target
  turn, so it never grows from keeping several branches.
- **Every jump breaks the prompt cache.** Claude Code resends the whole conversation on every
  prompt, and the unchanged start of it is normally served from Anthropic's prompt cache at a
  fraction of the price. A jump changes everything after the fork point, so the next prompt pays
  full price for that part. Caching works again from the prompt after. Switching branches often
  costs more than staying on one.
- **Long tool results come back shortened.** When a branch is rebuilt, each tool call's input is
  cut to 600 characters and each result to 6,000. If Claude needs the full content of a file it read on that branch, it reads it again.
- **Size of a rebuilt branch.** On average a stored turn is about 5,500 characters, so rebuilding
  a 10-turn branch adds roughly 14,000 tokens to the next prompt. A typical short turn is about
  260 tokens.

### Correctness

- **Very long turns lose their middle steps.** Each turn is stored as text of at most 30,000
  characters, so that a single huge turn can't flood the context after a jump. Over that limit,
  the middle of the turn is cut and its start and final answer are always kept, so Claude still
  sees what was asked and what was concluded.
- **Turns are found by their prompt text.** To decide where to cut, the companion mod matches each
  turn's prompt against the conversation. Two identical prompts (for example, "continue") can make
  it cut in the wrong place and build the wrong context.

### Scope

- **Only the conversation changes.** Files written and commands run on a deleted or abandoned
  branch stay done. If Claude reads those files on another branch, it sees their result. The raw
  session transcript also keeps everything.
- **One tree per session.** Turns from before the mod was loaded, or from a session Claude Code
  moved to a new session id, are not in the tree.
- Up to the last 500 turns are kept.

## Updating

When a new version is out, type this line in a terminal:

```sh
claude plugin update session-tree@claude-code-session-tree && claude plugin update session-tree-cut@claude-code-session-tree
```

It updates both parts of the mod. Then restart Claude Code. If an error appears, run the line
again, and restart only when both parts are updated.

## Contributing

Anyone can propose a change. By opening a pull request, you agree that RodrigoCossi may use,
modify and license your contribution under any terms, including the
[PolyForm Noncommercial license](LICENSE) and separate commercial licenses. You keep the right
to use your own contribution as you wish.

### Step by step

1. **Fork** this repository with the **Fork** button at the top right of this page. It makes
   your own copy on GitHub.
2. **Download your copy** and create a branch for your change:
   ```sh
   git clone https://github.com/<your-account>/claude-code-session-tree.git
   cd claude-code-session-tree
   git checkout -b my-change
   ```
3. **Make your change** in this folder, yourself or by asking Claude Code. Don't edit the copy
   installed with `/plugin install`: an update overwrites it.
4. **Try it.** From this folder, start Claude Code with:
   ```sh
   claude --plugin-dir .
   ```
   This Claude Code window uses your version of the mod instead of the installed one. Other
   windows are not affected. After each change, quit and run the line again.
5. **Run the tests** from this folder:
   ```sh
   claude plugin test session-tree && claude plugin test session-tree-cut
   ```
   Everything is fine when both end with `0 fail` (13 tests for `session-tree`, 3 for
   `session-tree-cut`). A failed test says what broke.
6. **Raise the version** in `.claude-plugin/plugin.json` of each part you changed, for example
   `0.2.2` → `0.2.3`. Without this, people who installed the mod don't get your change when they
   update.
7. **Send it:**
   ```sh
   git add -A
   git commit -m "Short description of the change"
   git push -u origin my-change
   ```
   Then on your fork's GitHub page click **Compare & pull request**, and describe what you
   changed, why, and how you tested it.

### Where the code is

```
session-tree/                  the pane, the Tree button, /tree and /tree-go; records each turn
  hooks/register.tsx           all of the mod's code
  hooks/*.test.tsx             its tests
  types/index.d.ts             TurnNode and Tree types (the stored tree)
session-tree-cut/              applies a jump to the conversation
  hooks/cut.tsx                the cut
  hooks/cut.test.tsx           its tests
.claude-plugin/marketplace.json   makes this repository installable with /plugin install
```

### What the tests check

| File | Checks |
| --- | --- |
| `session-tree/hooks/tree.test.tsx` | branches are drawn, each in its own color, with the current turn marked; a turn is recorded from the conversation; the Tree button opens the pane |
| `session-tree/hooks/links.test.tsx` | dots on the same branch are joined by a line |
| `session-tree/hooks/switch.test.tsx` | clicking a turn asks for the cut and moves the "you are here" marker |
| `session-tree/hooks/fork-delete.test.tsx` | Fork here starts a new branch; delete and undo; deleting the branch you're on jumps back first; main can't be deleted |
| `session-tree/hooks/flatten.test.tsx` | how a turn is stored: tool results up to 6,000 characters kept whole, long turns keep their start and final answer |
| `session-tree-cut/hooks/cut.test.tsx` | what a jump keeps and rebuilds; similar prompts aren't confused |

If you add a feature or fix a bug, add a test for it.

## License

[PolyForm Noncommercial 1.0.0](LICENSE). Copyright 2026 RodrigoCossi.

- **Free for noncommercial use:** personal projects, study, research, hobby use, and use by
  charities, schools, public research and government institutions. You may change the code and
  share it, as long as you keep the [LICENSE](LICENSE) file and its `Required Notice` line.
- **Commercial use needs a separate license.** This includes using it in a company's work, in a
  paid product or service, or selling it. To ask for one, contact
  [RodrigoCossi on GitHub](https://github.com/RodrigoCossi).
