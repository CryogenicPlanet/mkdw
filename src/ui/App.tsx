import { SyntaxStyle, type ScrollBoxRenderable, type SelectOption } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Store, ViewState } from "../ViewState.ts";
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
	const [flash, setFlash] = useState(false);

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
	}, [docKey]);

	const open = (delta: number) => {
		if (s.files.length === 0) return;
		const i = indexOfCurrent(s);
		const next = s.files[(i + delta + s.files.length) % s.files.length];
		if (next !== undefined) store.dispatch({ _tag: "Open", path: `${s.root}/${next}` });
	};

	useKeyboard((key) => {
		const page = Math.max(1, (scroll.current?.height ?? 20) - 2);
		if (key.name === "q" || (key.ctrl && key.name === "c")) return store.dispatch({ _tag: "Quit" });
		if (key.name === "tab") return setFocus((f) => (f === "doc" && sidebar ? "sidebar" : "doc"));
		if (key.name === "s") {
			setSidebarPref(!sidebar);
			return setFocus("doc");
		}
		if (key.name === "r") return setRaw((v) => !v);
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
					focused={focus === "doc"}
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
					) : raw ? (
						<code content={s.content} filetype="markdown" syntaxStyle={syntaxStyle} />
					) : s.content === "" ? (
						<text fg={palette.dim}>{live ? "waiting for content…" : "(empty)"}</text>
					) : (
						<markdown
							content={s.content}
							syntaxStyle={syntaxStyle}
							streaming={live && s.streaming}
							conceal
							fg={palette.fg}
							tableOptions={{ style: "grid", widthMode: "content", cellPaddingX: 1, borderColor: palette.border }}
						/>
					)}
				</scrollbox>
			</box>

			{/* footer */}
			<box style={{ flexDirection: "row", height: 1, paddingLeft: 1, backgroundColor: palette.bar }}>
				<text fg={palette.dim}>
					{width < 70 ? "j/k scroll  [ ] file  s side  r raw  q quit" : "j/k scroll  space/u/d page  g/G top/end  [ ] prev/next  tab focus  s sidebar  r raw  q quit"}
				</text>
			</box>
		</box>
	);
}
