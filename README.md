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
| `r`            | raw source             |
| `q`            | quit                   |

## How the panel works

- One panel per Rex session. State lives in `~/.local/state/mkdw/<session>/`.
- `control.json` says what to show; the panel watches it and switches.
- `live.md` is what `mkdw push` appends to; the panel renders it in
  *streaming* mode and sticks to the bottom until the push ends.
- Files are watched — edit and save, and the panel re-renders.

> Agents: `mkdw panel <file>` is the whole API. Write a file, point the panel at it.

- [x] render markdown
- [x] live reload
- [ ] diff view of what changed since last render
