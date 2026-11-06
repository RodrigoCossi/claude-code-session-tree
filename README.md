# 🌳 Session Tree for Claude Code

A git-style graph of every turn in a Claude Code session, shown in a pane beside the chat.
Click any earlier turn to jump the conversation back to it. Your next prompt then starts a new
branch, and the other branches stay in the tree so you can switch back to them later.

<p align="center">
  <img src="docs/tree.svg" alt="Session Tree pane: main branch in blue, branch 2 in magenta, branch 3 in green, with the current turn marked" width="680">
</p>

## Features

- **Graph pane**: every turn as a dot, labelled with its prompt and a preview of the reply.
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

1. In Claude Code, type the first line at the prompt:

   ```
   /plugin install session-tree --marketplace RodrigoCossi/claude-code-session-tree
   ```

   The first time, it asks whether to add the marketplace: answer `y`.
   When it asks for a scope, choose **user** (the first option, then Enter). The mod then loads
   in every Claude Code session, in any folder.

2. Type the second line the same way:

   ```
   /plugin install session-tree-cut --marketplace RodrigoCossi/claude-code-session-tree
   ```

   **Both lines are required.** `session-tree` draws the tree; `session-tree-cut` is what switches
   the conversation when you jump. Without it, a jump runs a normal summarizing compaction
   (see [How it works](#how-it-works)).

3. Check that it loaded: a **🌳 Tree** button appears at the bottom right of the prompt. Click it,
   or type `/tree`.

**Private repository:** installing works only for GitHub accounts that can read this repository,
on a machine where git can already authenticate to github.com (for example after
`gh auth login` and `gh auth setup-git`). The install does not ask for a password.

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
  cut to 600 characters and each result to 6,000. About 5% of tool results are longer than that.
  If Claude needs the full content of a file it read on that branch, it reads it again.
- **Size of a rebuilt branch.** On average a stored turn is about 5,500 characters, so rebuilding
  a 10-turn branch adds roughly 14,000 tokens to the next prompt. A typical short turn is about
  260 tokens.

### Correctness

- **Very long turns lose their middle steps.** Each turn is stored as text of at most 30,000
  characters (about 6% of turns are longer). Over that, the middle of the turn is cut and its start
  and final answer are always kept, so after a jump Claude still sees what was asked and what was
  concluded.
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

## Contributing

Contributions are welcome. This section is only for people who want to change the code; if you
just use the mod, you don't need any of it.

### Repository layout

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

### Trying your changes in Claude Code

1. If you installed the mod with `/plugin install`, turn that copy off first. Otherwise both
   copies load and you get two Tree panes:
   ```sh
   claude plugin disable session-tree@claude-code-session-tree
   claude plugin disable session-tree-cut@claude-code-session-tree
   ```
2. From the root of your clone, start Claude Code with your copy of both mods:
   ```sh
   CLAUDE_CODE_PLUGIN_DIRS="$PWD/session-tree:$PWD/session-tree-cut" claude
   ```
3. When you're done, turn the installed copy back on with `claude plugin enable` and the same
   two names.

### Running the tests

The tests check the mod's behavior in a simulated session, in under a second, without you having
to click through the tree by hand. Run them after every change: if one fails, your change broke
something that used to work.

From the root of your clone:

```sh
claude plugin test session-tree
claude plugin test session-tree-cut
```

When everything is fine, each command lists its tests marked `(pass)` and ends with a summary:

```
 13 pass
 0 fail
Ran 13 tests across 5 files.
```

for `session-tree`, and `3 pass`, `0 fail` for `session-tree-cut`. A test marked `(fail)` names
the behavior that broke and shows what was expected and what came out.

What each test file covers:

| File | Checks |
| --- | --- |
| `session-tree/hooks/tree.test.tsx` | branches are drawn, each in its own color, with the current turn marked; a turn is recorded from the conversation; the Tree button opens the pane |
| `session-tree/hooks/links.test.tsx` | dots on the same branch are joined by a line |
| `session-tree/hooks/switch.test.tsx` | clicking a turn asks for the cut and moves the "you are here" marker |
| `session-tree/hooks/fork-delete.test.tsx` | Fork here starts a new branch; delete and undo; deleting the branch you're on jumps back first; main can't be deleted |
| `session-tree/hooks/flatten.test.tsx` | how a turn is stored: tool results up to 6,000 characters kept whole, long turns keep their start and final answer |
| `session-tree-cut/hooks/cut.test.tsx` | what a jump keeps and rebuilds; similar prompts aren't confused |

If you add a feature or fix a bug, add a test for it in the matching file.

### Sending a change for review

This repository is private, so ask the owner to invite your GitHub account as a collaborator
first. Then:

1. **Fork** the repository: the **Fork** button at the top right of its GitHub page. This makes
   your own copy under your account.
2. **Clone your fork** and create a branch for your change:
   ```sh
   git clone https://github.com/<your-account>/claude-code-session-tree.git
   cd claude-code-session-tree
   git checkout -b my-change
   ```
3. Make the change, try it in Claude Code (above), and run the tests until they all pass.
   Then raise the `version` in the `.claude-plugin/plugin.json` of each mod you changed
   (for example `0.1.0` → `0.2.0`): `claude plugin update` uses it to tell that there is
   something new to install.
4. **Commit and push** the branch to your fork:
   ```sh
   git add -A
   git commit -m "Short description of the change"
   git push -u origin my-change
   ```
5. **Open a pull request**: on your fork's GitHub page, click **Compare & pull request**, check that
   the target is `RodrigoCossi/claude-code-session-tree`, branch `main`, then describe what you
   changed, why, and how you tested it.

The owner reviews the pull request and may ask for changes; push more commits to the same branch
and they appear in the pull request. Once approved, it's merged into `main`, and people who
installed the mod get it with:

```sh
claude plugin update session-tree@claude-code-session-tree
claude plugin update session-tree-cut@claude-code-session-tree
```
