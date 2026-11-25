# mkdw

`mkdw` is a markdown viewer that lives in a side panel of your terminal. Your agent writes a doc and points the panel at it. You read it, comment on it, and see what changed, all without leaving the terminal.

```
 mkdw › plan.md                                         ● 1 changed ● 1
  │ Rollout plan
  │
  │ Ship the panel first, then comments, then diffs.
  │
  │ Steps
  │
  │ - [x] build the panel
  │ - [x] add review comments
  │ - [x] add the diff view
  │ - [ ] write the README
  │
  │ Risks
  │ ╭─ ◆ claude · 1s · 8a22ba14 ─────────────────────────────────────╮
  │ │ Mitigation: the panel sticks to the bottom while streaming.    │
  │ ╰────────────────────────────────────────────────────────────────╯
  │
  │ Agents may write faster than you can read.
 j/k scroll  J/K block  c comment  x resolve  D diff  m seen  q quit
```

The review model is borrowed from [hunk](https://github.com/modem-dev/hunk), and the streaming idea from Pierre's [Words](https://diffs.com/words). Words renders to HTML for the browser, so `mkdw` doesn't use it directly. Rendering comes from [OpenTUI](https://github.com/sst/opentui)'s terminal markdown renderer, and everything else is built on [Effect](https://effect.website).

## Quickstart

You need [Bun](https://bun.sh). The side panel needs a Rex terminal, but `mkdw open` works in any terminal.

```sh
git clone https://github.com/CryogenicPlanet/mkdw
cd mkdw && bun install
ln -s "$PWD/bin/mkdw" ~/.local/bin/mkdw
```

Now open a doc in a panel beside you:

```sh
mkdw panel README.md
```

That's it. The panel opens to the right without stealing focus. Run `mkdw panel` again with another file and the same panel switches to it, so you never end up with a stack of panes.

## Viewing docs

Give `mkdw` a file to read it, or a directory to browse every markdown file under it.

```sh
mkdw README.md       # view here, in this terminal
mkdw docs/           # sidebar of every .md under docs/
mkdw panel docs/     # same, in the side panel
mkdw close           # close the panel
```

Files are watched. Save a change in your editor and the panel re-renders, with a brief flash in the header so you notice. You don't need to reload anything.

## Streaming from an agent

`mkdw push` streams markdown into the panel as it arrives. The panel shows `● streaming`, sticks to the bottom, and switches to `● live` when the input ends.

```sh
some-agent | mkdw push --title "plan"
mkdw push plan.md --delay 15     # replay a file word by word
```

The trailing block renders in streaming mode, so a half-written table or code fence doesn't flicker into garbage while it's still arriving.

## Comments

Comments work like hunk's review notes. Each one anchors to a block of the doc (a heading, paragraph, list, table, or code block) and renders inline as a card under it. You and your agent share the same comments.

In the panel, `J` and `K` move the block cursor, and `c` comments on the selected block. The cursor follows your scrolling, so `c` always targets something on screen, and the comment box names the block before you save. You can also click a block to select it.

Your agent reads and writes the same comments from the CLI:

```sh
mkdw comments                          # every open comment
mkdw comments plan.md --wait           # block until you leave a new comment
mkdw comment plan.md --match "## Risks" --author claude "Missing a rollback step"
mkdw comment plan.md --line 12 "..."
mkdw comment resolve 8a22ba14
mkdw comment rm 8a22ba14
```

`--wait` is the useful one. An agent can write a plan, open it with `mkdw panel`, and then wait for your feedback instead of polling.

```sh
$ mkdw comments plan.md --wait
plan.md:11  [b34dd869] sam (user)
    > ## Risks
    What happens if the push dies halfway?
```

Pass `live` instead of a path to target the doc that `mkdw push` streamed.

Note that comments are stored outside your repo, in `~/.local/state/mkdw/comments/`, one JSON file per doc. Each comment keeps its line number *and* the text of that line, so it follows the line when the doc is edited.

## Seeing what changed

The panel remembers each doc as it was when you opened it. When the file changes underneath you, changed blocks get a green rail and the header shows `● 3 changed`.

- `D` opens a full diff against that snapshot, in split view when the panel is wide enough.
- `m` marks the changes as seen and resets the snapshot.

Running `mkdw panel` on the doc that's already open keeps the snapshot. That way an agent can edit a plan, re-point the panel at it, and you see exactly what it changed.

## Keys

| Key | Action |
| --- | --- |
| `j` / `k` | Scroll |
| `space` / `u` / `d` | Page down, half page up, half page down |
| `g` / `G` | Top / end |
| `[` / `]` | Previous / next file |
| `J` / `K` | Move the block cursor |
| `c` | Comment on the selected block |
| `x` | Resolve the block's comments |
| `{` / `}` | Previous / next commented block |
| `a` | Hide or show comments |
| `D` | Toggle the diff view |
| `m` | Mark changes as seen |
| `tab` | Focus the sidebar |
| `s` | Toggle the sidebar |
| `r` | Show the raw source |
| `q` | Quit |

## Agent skill

`mkdw` ships with a skill that teaches your agent when to reach for the panel and how to run the review loop: open a doc, wait for your comments, act on them, and resolve them. It lives in [`skills/mkdw/SKILL.md`](skills/mkdw/SKILL.md).

Install it for Claude Code with:

```sh
mkdw skill install                  # symlinks into ~/.claude/skills/mkdw
mkdw skill install --dir ~/.agents/skills   # or any other skills directory
```

The install is a symlink, so pulling the repo updates the skill too. `mkdw skill show` prints it, and `mkdw status --json` tells an agent where the panel is and what it's showing.

## How the panel works

There's one panel per Rex session, and it's driven by two files in `~/.local/state/mkdw/<session>/`:

- `control.json` says what the panel shows. `mkdw panel` and `mkdw push` write it, and the panel watches it.
- `live.md` holds the content `mkdw push` streams in.

Because the control channel is just files, any process can drive the panel. You don't need a daemon, a socket, or a library.

## Development

```sh
bun install
bun run typecheck    # tsgo
bun run lint         # oxlint
bun src/main.ts open README.md
```

The code is organized as Effect services (`Control`, `Comments`, `Workspace`, `Rex`, and `Panel`) wired together in `src/main.ts`. The UI is OpenTUI React in `src/ui/`.
