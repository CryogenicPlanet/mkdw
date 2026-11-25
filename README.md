# mkdw

A terminal markdown viewer that lives in a **side panel**, in the spirit of
[hunk](https://github.com/modem-dev/hunk) (review UI) and
[Words](https://diffs.com/words) (streaming markdown). Built on
[OpenTUI](https://github.com/sst/opentui)'s `MarkdownRenderable` with an
[Effect](https://effect.website) backbone.

## Usage

```sh
mkdw README.md          # view here
mkdw docs/              # browse a directory (sidebar of every .md)
mkdw panel notes.md     # open in a Rex side panel, or retarget the open one
some-agent | mkdw push  # stream markdown from stdin into the panel
mkdw push plan.md --delay 15   # replay a file word by word
mkdw close
```

| key            | action                 |
| -------------- | ---------------------- |
| `j` / `k`      | scroll                 |
| `space` `u` `d`| page                   |
| `g` / `G`      | top / end              |
| `[` / `]`      | previous / next file   |
| `tab`          | focus sidebar          |
| `s`            | toggle sidebar         |
| `J` / `K`      | block cursor           |
| `c`            | comment on block       |
| `x`            | resolve block's notes  |
| `{` / `}`      | prev / next comment    |
| `a`            | hide / show notes      |
| `r`            | raw source             |
| `q`            | quit                   |

## Comments

Review notes like [hunk](https://github.com/modem-dev/hunk)'s: anchored to a
block of the document, drawn inline as cards, readable and writable by agents.

In the panel: `J`/`K` moves the block cursor, `c` comments on that block,
`x` resolves its notes, `{`/`}` jumps between commented blocks, and `a` hides
or shows notes.

From an agent (`live` means the doc that `mkdw push` streamed):

```sh
mkdw comments                       # open comments everywhere
mkdw comments plan.md --wait        # block until the user leaves a new comment
mkdw comment plan.md --match "## Rollout" --author claude "Missing a rollback step"
mkdw comment plan.md --line 12 "…"
mkdw comment resolve <id>
mkdw comment rm <id>
```

Comments live in `~/.local/state/mkdw/comments/`, one JSON file per document.
Each one stores its line and the text of that line, so it follows the line
when the document is edited.

## How the panel works

- One panel per Rex session. State lives in `~/.local/state/mkdw/<session>/`.
- `control.json` says what to show; the panel watches it and switches.
- `live.md` is what `mkdw push` appends to; the panel renders it in
  *streaming* mode and sticks to the bottom until the push ends.
- Files are watched — edit and save, and the panel re-renders.

> Agents: `mkdw panel <file>` is the whole API. Write a file, point the panel at it.

- [x] render markdown
- [x] live reload
- [x] comments (user + agent)
- [ ] diff view of what changed since last render
