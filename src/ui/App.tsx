import { SyntaxStyle, type ScrollBoxRenderable, type SelectOption } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createTwoFilesPatch } from "diff";
import { blockAt, splitBlocks } from "../blocks.ts";
import { reanchor, type Comment } from "../Comments.ts";
import type { Store, ViewState } from "../ViewState.ts";
import { blockId, DOC_ID, DocBlocks } from "./DocBlocks.tsx";
import { palette, styles } from "./theme.ts";

type Focus = "sidebar" | "doc";

const titleOf = (s: ViewState): string => {
	switch (s.current._tag) {
		case "File":
			return relativeTo(s.root, s.current.path);
		case "Live":
			return s.current.title;
		case "Empty":
			return "no markdown here";
	}
};

const relativeTo = (root: string, file: string): string =>
	file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;

const indexOfCurrent = (s: ViewState): number =>
	s.current._tag === "File" ? s.files.indexOf(relativeTo(s.root, s.current.path)) : -1;

/** `some/long/dir/README.md` → `some/lo…/README.md`, always keeping the file name. */
const fitPath = (rel: string, max: number): string => {
	if (rel.length <= max) return rel;
	const slash = rel.lastIndexOf("/");
	const name = rel.slice(slash + 1);
	const room = max - name.length - 2;
	return slash === -1 || room < 3 ? `…${rel.slice(-(max - 1))}` : `${rel.slice(0, room)}…/${name}`;
};

/** First line of a block, stripped of markdown markers, for the composer title. */
const preview = (raw: string): string => {
	const first = (raw.split("\n")[0] ?? "").replace(/^[#>*\-+|`\s\d.[\]x]+/, "").trim();
	return first.length > 28 ? `"${first.slice(0, 27)}…"` : `"${first}"`;
};

export function App({ store }: { readonly store: Store }) {
	const s = useSyncExternalStore(store.subscribe, store.get);
	const { width } = useTerminalDimensions();
	const syntaxStyle = useMemo(() => SyntaxStyle.fromStyles(styles), []);
	const scroll = useRef<ScrollBoxRenderable>(null);

	const [focus, setFocus] = useState<Focus>("doc");
	// undefined = auto: show the sidebar when there's room and something to pick
	const [sidebarPref, setSidebarPref] = useState<boolean | undefined>(undefined);
	const sidebar = sidebarPref ?? (width >= 64 && s.files.length > 1);
	const [raw, setRaw] = useState(false);
	const [diffMode, setDiffMode] = useState(false);
	const [flash, setFlash] = useState(false);
	const [cursor, setCursor] = useState(0);
	// block index the open comment box targets; undefined = not composing
	const [composeAt, setComposeAt] = useState<number | undefined>(undefined);
	const composing = composeAt !== undefined;
	const [showNotes, setShowNotes] = useState(true);

	const blocks = useMemo(() => splitBlocks(s.content), [s.content]);
	const threads = useMemo(() => {
		const lines = s.content.split("\n");
		return s.comments
			.filter((c) => !c.resolved)
			.reduce((m, c) => {
				const i = blockAt(blocks, reanchor(lines, c));
				return new Map(m).set(i, [...(m.get(i) ?? []), c]);
			}, new Map<number, ReadonlyArray<Comment>>());
	}, [s.comments, s.content, blocks]);
	const commented = useMemo(() => [...threads.keys()].toSorted((a, b) => a - b), [threads]);
	const openCount = s.comments.filter((c) => !c.resolved).length;

	// what changed since you opened the doc (or pressed m)
	const dirty = s.baseline !== s.content && s.current._tag === "File";
	const changed = useMemo(() => {
		if (!dirty) return new Set<number>();
		const before = new Set(splitBlocks(s.baseline).map((b) => b.raw));
		return new Set(blocks.flatMap((b, i) => (before.has(b.raw) ? [] : [i])));
	}, [dirty, s.baseline, blocks]);
	const removed = useMemo(() => {
		if (!dirty) return 0;
		const now = new Set(blocks.map((b) => b.raw));
		return splitBlocks(s.baseline).filter((b) => !now.has(b.raw)).length;
	}, [dirty, s.baseline, blocks]);
	const patchText = useMemo(
		() => (diffMode && dirty ? createTwoFilesPatch("before", "now", s.baseline, s.content, "", "", { context: 3 }) : ""),
		[diffMode, dirty, s.baseline, s.content],
	);
	const at = Math.min(cursor, Math.max(0, blocks.length - 1));

	// briefly mark the header when the document reloads under us
	useEffect(() => {
		if (s.revision <= 1) return;
		setFlash(true);
		const t = setTimeout(() => setFlash(false), 600);
		return () => clearTimeout(t);
	}, [s.revision]);

	// new document → back to the top (live docs stick to the bottom instead)
	const docKey = s.current._tag === "File" ? s.current.path : s.current._tag;
	useEffect(() => {
		if (s.current._tag !== "Live") scroll.current?.scrollTo(0);
		setCursor(0);
		setComposeAt(undefined);
	}, [docKey]);

	/** Blocks on screen, in order, read straight off the block column (no tree searches). */
	const visibleBlocks = (): ReadonlyArray<{ readonly i: number; readonly full: boolean }> => {
		const sb = scroll.current;
		const rows = sb?.findDescendantById(DOC_ID)?.getChildren() ?? [];
		if (!sb) return [];
		const top = sb.viewport.y;
		const bottom = top + sb.viewport.height;
		return rows.flatMap((r, i) => (r.height > 0 && r.y + r.height > top && r.y < bottom ? [{ i, full: r.y >= top }] : []));
	};

	/** The cursor if it's on screen, else the first block you can see in full. */
	const cursorInView = (): number => {
		const vis = visibleBlocks();
		if (vis.length === 0 || vis.some((v) => v.i === at)) return at;
		return (vis.find((v) => v.full) ?? vis[0])?.i ?? at;
	};

	// after scrolling (keys or wheel) settles, drag the cursor along so it never hides
	// off-screen. Debounced: a burst of wheel events does this work once, not per tick.
	const followTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const atRef = useRef(at);
	atRef.current = at;
	const followScroll = () => {
		clearTimeout(followTimer.current);
		followTimer.current = setTimeout(() => {
			const next = cursorInView();
			if (next !== atRef.current) setCursor(next);
		}, 120);
	};

	const pick = useCallback((i: number) => {
		setCursor(i);
		setFocus("doc");
	}, []);

	const moveCursor = (i: number) => {
		const next = Math.min(Math.max(0, i), Math.max(0, blocks.length - 1));
		setCursor(next);
		scroll.current?.scrollChildIntoView(blockId(next));
	};

	const open = (delta: number) => {
		if (s.files.length === 0) return;
		const i = indexOfCurrent(s);
		const next = s.files[(i + delta + s.files.length) % s.files.length];
		if (next !== undefined) store.dispatch({ _tag: "Open", path: `${s.root}/${next}` });
	};

	useKeyboard((key) => {
		if (composing) {
			if (key.name === "escape") setComposeAt(undefined);
			return;
		}
		const ch = key.sequence;
		if ((key.name === "j" && key.shift) || ch === "J") return moveCursor(cursorInView() === at ? at + 1 : cursorInView());
		if ((key.name === "k" && key.shift) || ch === "K") return moveCursor(cursorInView() === at ? at - 1 : cursorInView());
		if (ch === "}") return moveCursor(commented.find((i) => i > at) ?? commented[0] ?? at);
		if (ch === "{") return moveCursor(commented.findLast((i) => i < at) ?? commented.at(-1) ?? at);
		if (key.name === "c" && !raw && s.docPath !== undefined && blocks.length > 0) {
			const target = cursorInView();
			setCursor(target);
			return setComposeAt(target);
		}
		if (key.name === "x") {
			const ids = (threads.get(at) ?? []).map((c) => c.id);
			return ids.length > 0 ? store.dispatch({ _tag: "Resolve", ids, resolved: true }) : undefined;
		}
		if (key.name === "a") return setShowNotes((v) => !v);
		const page = Math.max(1, (scroll.current?.height ?? 20) - 2);
		if (key.name === "q" || (key.ctrl && key.name === "c")) return store.dispatch({ _tag: "Quit" });
		if (key.name === "tab") return setFocus((f) => (f === "doc" && sidebar ? "sidebar" : "doc"));
		if (key.name === "s") {
			setSidebarPref(!sidebar);
			return setFocus("doc");
		}
		if (key.name === "r") return setRaw((v) => !v);
		if ((key.name === "d" && key.shift) || ch === "D") return setDiffMode((v) => !v);
		if (key.name === "m") {
			setDiffMode(false);
			return store.dispatch({ _tag: "MarkSeen" });
		}
		if (key.name === "]" || key.sequence === "]") return open(1);
		if (key.name === "[" || key.sequence === "[") return open(-1);
		if (focus === "sidebar") return;
		const sb = scroll.current;
		if (!sb) return;
		if (key.name === "j" || key.name === "down") sb.scrollBy(1);
		else if (key.name === "k" || key.name === "up") sb.scrollBy(-1);
		else if (key.name === "space" || key.name === "pagedown" || (key.ctrl && key.name === "f")) sb.scrollBy(page);
		else if (key.name === "pageup" || (key.ctrl && key.name === "b")) sb.scrollBy(-page);
		else if (key.name === "d") sb.scrollBy(Math.floor(page / 2));
		else if (key.name === "u") sb.scrollBy(-Math.floor(page / 2));
		else if (key.name === "g" && !key.shift) sb.scrollTo(0);
		else if (key.name === "G" || (key.name === "g" && key.shift) || key.name === "end") sb.scrollTo(sb.scrollHeight);
		else return;
		followScroll();
	});

	const sideWidth = Math.min(36, Math.max(22, Math.floor(width * 0.3)));
	const options: SelectOption[] = s.files.map((f) => ({ name: fitPath(f, sideWidth - 4), description: f, value: f }));

	const live = s.current._tag === "Live";
	const status = live ? (s.streaming ? "● streaming" : "● live") : s.controlled ? "panel" : "watching";

	return (
		<box style={{ flexDirection: "column", width: "100%", height: "100%", backgroundColor: palette.bg }}>
			{/* header */}
			<box style={{ flexDirection: "row", height: 1, paddingLeft: 1, paddingRight: 1, backgroundColor: palette.bar }}>
				<text fg={palette.accent}>
					<b>mkdw</b>
				</text>
				<text fg={palette.dim}> › </text>
				<text fg={flash ? palette.flash : palette.fg}>{titleOf(s)}</text>
				<box style={{ flexGrow: 1 }} />
				{raw ? <text fg={palette.warn}>raw </text> : null}
				{diffMode ? <text fg={palette.warn}>diff </text> : null}
				{dirty ? (
					<text fg={palette.ok}>
						{`● ${changed.size} changed${removed > changed.size ? ` · ${removed - changed.size} removed` : ""} `}
					</text>
				) : null}
				{openCount > 0 ? <text fg={palette.flash}>{`● ${openCount} ${showNotes ? "" : "hidden "}`}</text> : null}
				<text fg={live ? (s.streaming ? palette.flash : palette.ok) : palette.dim}>{status}</text>
			</box>

			<box style={{ flexDirection: "row", flexGrow: 1 }}>
				{sidebar ? (
					<box
						style={{
							width: sideWidth,
							flexDirection: "column",
							border: ["right"],
							borderColor: focus === "sidebar" ? palette.accent : palette.border,
							backgroundColor: palette.side,
						}}
					>
						<text fg={palette.dim} style={{ paddingLeft: 1 }}>
							{`${s.files.length} file${s.files.length === 1 ? "" : "s"}`}
						</text>
						<select
							focused={focus === "sidebar"}
							options={options}
							selectedIndex={Math.max(0, indexOfCurrent(s))}
							showDescription={false}
							showScrollIndicator
							wrapSelection
							backgroundColor={palette.side}
							focusedBackgroundColor={palette.side}
							textColor={palette.muted}
							focusedTextColor={palette.muted}
							selectedBackgroundColor={palette.selection}
							selectedTextColor={palette.fg}
							style={{ flexGrow: 1 }}
							onChange={(_, option) => {
								const value: unknown = option?.value;
								if (typeof value === "string") store.dispatch({ _tag: "Open", path: `${s.root}/${value}` });
							}}
						/>
					</box>
				) : null}

				<scrollbox
					ref={scroll}
					onMouseScroll={followScroll}
					focused={focus === "doc" && !composing}
					stickyScroll={live}
					stickyStart={live ? "bottom" : "top"}
					style={{
						flexGrow: 1,
						rootOptions: { backgroundColor: palette.bg },
						viewportOptions: { backgroundColor: palette.bg },
						contentOptions: { paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1 },
					}}
				>
					{s.error !== undefined ? (
						<text fg={palette.warn}>{s.error}</text>
					) : diffMode ? (
						dirty ? (
							<diff
								diff={patchText}
								view={width >= 110 ? "split" : "unified"}
								filetype="markdown"
								syntaxStyle={syntaxStyle}
								showLineNumbers
								wrapMode="word"
								fg={palette.fg}
								addedBg="#0f2a1d"
								removedBg="#2d1418"
								addedContentBg="#0f2a1d"
								removedContentBg="#2d1418"
								contextBg={palette.bg}
								contextContentBg={palette.bg}
								addedSignColor={palette.ok}
								removedSignColor="#ff6b7a"
								lineNumberFg={palette.dim}
								lineNumberBg={palette.bg}
							/>
						) : (
							<text fg={palette.dim}>no changes since you opened it · D to go back</text>
						)
					) : raw ? (
						<code content={s.content} filetype="markdown" syntaxStyle={syntaxStyle} />
					) : s.content === "" ? (
						<text fg={palette.dim}>{live ? "waiting for content…" : "(empty)"}</text>
					) : (
						<DocBlocks
							blocks={blocks}
							threads={threads}
							changed={changed}
							cursor={at}
							showNotes={showNotes}
							streaming={live && s.streaming}
							syntaxStyle={syntaxStyle}
							docDir={s.docPath === undefined ? undefined : s.docPath.slice(0, s.docPath.lastIndexOf("/"))}
							onPick={pick}
						/>
					)}
				</scrollbox>
			</box>

			{composing ? (
				<box
					style={{ height: 3, border: true, borderStyle: "rounded", borderColor: palette.flash, paddingLeft: 1, backgroundColor: palette.side }}
					title={` comment on ${preview(blocks[composeAt ?? at]?.raw ?? "")} (line ${blocks[composeAt ?? at]?.start ?? 1}) · enter save · esc `}
					titleAlignment="left"
				>
					<input
						focused
						placeholder="what should change here?"
						backgroundColor={palette.side}
						focusedBackgroundColor={palette.side}
						textColor={palette.fg}
						onSubmit={(submitted: unknown) => {
							const value = typeof submitted === "string" ? submitted : "";
							const line = blocks[composeAt ?? at]?.start;
							if (line !== undefined && value.trim() !== "") store.dispatch({ _tag: "AddComment", line, body: value });
							setComposeAt(undefined);
						}}
					/>
				</box>
			) : null}

			{/* footer */}
			<box style={{ flexDirection: "row", height: 1, paddingLeft: 1, backgroundColor: palette.bar }}>
				<text fg={palette.dim}>
					{width < 70 ? "j/k scroll  J/K block  c comment  [ ] file  q quit" : "j/k scroll  J/K block  c comment  x resolve  { } notes  D diff  m seen  [ ] file  s sidebar  r raw  q quit"}
				</text>
			</box>
		</box>
	);
}
