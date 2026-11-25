---
name: mkdw
description: Show the user a markdown doc in a terminal side panel, collect their review comments on it, and show them what you changed, with the `mkdw` CLI. Use when you write a plan, spec, report, summary, or any doc longer than a screen that the user should read or review; when the user says "show me", "open it in the panel", "let me review", "I'll leave comments", or mentions mkdw; when you want feedback on a doc before acting on it; or when streaming long generated markdown. Needs a Rex terminal (REX_SESSION set) for the panel; `mkdw open` works anywhere.
---

# mkdw

`mkdw` is a markdown viewer that lives in a side panel beside your terminal pane. You write a doc, point the panel at it, and the user reads it there. They can leave comments on any block, and you can wait for those comments, answer them, and resolve them. When you edit the doc, the panel shows the user exactly what changed.

Use it instead of dumping a long doc into chat. Chat is for the short answer; the panel is for the thing they need to read.

## Check that you can use it

```sh
command -v mkdw && echo "rex: ${REX_SESSION:-none}"
```

- **`mkdw` missing:** tell the user to run `ln -s <repo>/bin/mkdw ~/.local/bin/mkdw` from their mkdw checkout. Don't install it yourself.
- **`REX_SESSION` unset:** the side panel won't work. Tell the user they can run `mkdw open <file>` in another terminal, and carry on in chat.

## Show a doc

Write the doc to a file, then point the panel at it:

```sh
mkdw panel plan.md
```

That's the whole API for showing something. The panel opens to the right without taking focus. If it's already open, it switches to the new file instead of opening another pane, so call `mkdw panel` as often as you like.

- Put docs that belong to the project in the repo. Put throwaway docs (plans for this session, reports) in your scratchpad directory.
- Point the panel at a directory (`mkdw panel docs/`) to give the user a sidebar of every markdown file in it.
- Pass `--focus` only when the user asks to jump to the panel.
- Don't open panes with `rex split` yourself, and don't `mkdw close` unless the user asks.

After opening it, tell the user in one line what's in the panel and what you want from them, for example: "The plan is in the panel. Leave comments with `J`/`K` to pick a block and `c` to comment."

## Get the user's review

Start a background wait right after you open the doc:

```sh
mkdw comments plan.md --wait
```

Run it with `run_in_background` so you're notified when it exits. It blocks until the user leaves a new comment, prints the new comments, and exits. It only returns on comments by the user that are unresolved and new since it started, so your own comments don't wake it.

What just happened? You now have a review loop without polling. When the wait returns:

1. Read the comments. Each one shows the line and the text it's anchored to:

   ```
   plan.md:11  [b34dd869] sam (user)
       > ## Risks
       What happens if the push dies halfway?
   ```

2. Act on it. Usually that means editing the doc.
3. Re-point the panel with `mkdw panel plan.md`. Because it's the same doc, the panel keeps its snapshot, so changed blocks get a green rail and the user can press `D` for the full diff.
4. Reply where it helps, then resolve the comment:

   ```sh
   mkdw comment plan.md --match "## Risks" --author claude "Added a retry step under Rollout."
   mkdw comment resolve b34dd869
   ```

5. Start a new `--wait` if you're still expecting feedback.

To read everything without waiting, use `mkdw comments plan.md` or `mkdw comments --json` (every doc).

## Leave notes on a doc

Comment on the user's doc to point at something specific instead of quoting it in chat:

```sh
mkdw comment README.md --match "## Install" --author claude "This step fails on Linux: no ~/.local/bin by default."
```

- Prefer `--match TEXT` over `--line N`. It anchors to the first line containing that text, which is what you mean far more often than a line number.
- Always pass `--author claude` (or your name) so the card shows who wrote it.
- One comment per point. Keep each one short; the panel shows them inline under the block.
- Note that `--match` needs a substring that's actually in the doc. If nothing matches, `mkdw` exits non-zero and adds nothing, so check the exit code.

## Stream markdown

Pipe generated markdown into the panel when it's long and arriving over time:

```sh
some-command | mkdw push --title "Audit report"
```

The panel shows `● streaming`, sticks to the bottom, and switches to `● live` when the input ends. Use the name `live` for that doc in the comment commands (`mkdw comments live --wait`).

For a finished doc, write a file and use `mkdw panel` instead. Files are watched, editable, and keep their comments.

## Check what the user sees

```sh
mkdw status --json
```

This prints the panel's block ID and what it's showing. To see the screen itself:

```sh
rex capture -s "$REX_SESSION" -b "$(mkdw status --json | jq -r .block)" --trim
```

## Keys the user has

Mention these when you hand a doc over, but don't recite the whole table.

| Key | Action |
| --- | --- |
| `J` / `K` | Move the block cursor |
| `c` | Comment on the selected block |
| `x` | Resolve the block's comments |
| `{` / `}` | Jump between commented blocks |
| `D` | Diff against when they opened it |
| `m` | Mark changes as seen |
| `j` / `k`, `space` | Scroll |
| `[` / `]` | Previous / next file |
| `q` | Quit |

## Gotchas

- There's one panel per Rex session. A second `mkdw panel` call retargets it, which is usually what you want.
- `mkdw push` clears the comments on the `live` doc each time it starts.
- Comments live in `~/.local/state/mkdw/comments/`, outside the repo, so they never show up in `git status`.
- `--wait` exits after the first batch. If you need to keep listening, start it again.
