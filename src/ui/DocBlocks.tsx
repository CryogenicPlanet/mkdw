import { ImageRenderable, infoStringToFiletype, type SyntaxStyle } from "@opentui/core";
import { extend } from "@opentui/react";
import { Option } from "effect";
import { memo, type ReactNode, useMemo, useState } from "react";
import { type AlertKind, type View as GfmView, viewOf } from "../gfm.ts";
import type { Block } from "../blocks.ts";
import type { Comment } from "../Comments.ts";
import { palette } from "./theme.ts";

extend({ image: ImageRenderable });

declare module "@opentui/react" {
	interface OpenTUIComponents {
		image: typeof ImageRenderable;
	}
}

export const blockId = (i: number): string => `blk-${i}`;

const ago = (ms: number, now: number): string => {
	const s = Math.max(0, Math.round((now - ms) / 1000));
	return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
};

function Note({ c, now }: { readonly c: Comment; readonly now: number }) {
	const agent = c.kind === "agent";
	return (
		<box
			style={{
				border: true,
				borderStyle: "rounded",
				borderColor: agent ? palette.accent : palette.flash,
				marginTop: 1,
				paddingLeft: 1,
				paddingRight: 1,
				backgroundColor: palette.side,
			}}
			title={` ${agent ? "◆" : "●"} ${c.author} · ${ago(c.createdAt, now)} · ${c.id} `}
			titleAlignment="left"
		>
			<text fg={palette.fg}>{c.body}</text>
		</box>
	);
}

const ALERTS: Record<AlertKind, { readonly icon: string; readonly label: string; readonly color: string }> = {
	note: { icon: "ⓘ", label: "Note", color: palette.note },
	tip: { icon: "✦", label: "Tip", color: palette.tip },
	important: { icon: "❢", label: "Important", color: palette.important },
	warning: { icon: "▲", label: "Warning", color: palette.warning },
	caution: { icon: "⊘", label: "Caution", color: palette.caution },
};

/** A framed panel with an optional label in the top-right corner. */
function Frame(props: { readonly label: string; readonly children: ReactNode; readonly color?: string }) {
	return (
		<box
			style={{
				border: true,
				borderStyle: "rounded",
				borderColor: props.color ?? palette.border,
				backgroundColor: palette.code,
				paddingLeft: 1,
				paddingRight: 1,
			}}
			{...(props.label === "" ? {} : { title: ` ${props.label} `, titleAlignment: "right" as const })}
		>
			{props.children}
		</box>
	);
}

/** A fenced code block, highlighted by tree-sitter, with line numbers once it's long enough to need them. */
function CodeBlock(props: {
	readonly lang: string;
	readonly text: string;
	readonly streaming: boolean;
	readonly syntaxStyle: SyntaxStyle;
}) {
	const filetype = infoStringToFiletype(props.lang);
	const code = (
		<code
			content={props.text}
			{...(filetype === undefined ? {} : { filetype })}
			syntaxStyle={props.syntaxStyle}
			fg={palette.fg}
			bg={palette.code}
			streaming={props.streaming}
			drawUnstyledText
		/>
	);
	const lines = props.text.split("\n").length;
	return (
		<Frame label={props.lang}>
			{lines >= 5 ? (
				<line-number fg={palette.dim} bg={palette.code} minWidth={2} paddingRight={1}>
					{code}
				</line-number>
			) : (
				code
			)}
		</Frame>
	);
}

const TABLE = { style: "grid", widthMode: "content", cellPaddingX: 1, borderColor: palette.border } as const;

function Markdown(props: { readonly text: string; readonly streaming: boolean; readonly syntaxStyle: SyntaxStyle }) {
	return (
		<markdown
			content={props.text}
			syntaxStyle={props.syntaxStyle}
			streaming={props.streaming}
			conceal
			fg={palette.fg}
			tableOptions={TABLE}
		/>
	);
}

/** A rasterized diagram, sized from its pixel size (rendered at 2x, ~8x17px cells). */
function Picture(props: { readonly png: Uint8Array; readonly width: number; readonly height: number }) {
	const cols = Math.ceil(props.width / 2 / 8);
	const rows = Math.min(30, Math.max(3, Math.ceil(props.height / 2 / 17)));
	return <image source={props.png} fit="fit" style={{ width: cols, maxWidth: "100%", height: rows }} />;
}

function ImageBlock(props: { readonly alt: string; readonly src: string; readonly docDir: string | undefined }) {
	const [failed, setFailed] = useState(false);
	const remote = /^https?:\/\//.test(props.src);
	const source = remote || props.docDir === undefined || props.src.startsWith("/") ? props.src : `${props.docDir}/${props.src}`;
	return (
		<box style={{ flexDirection: "column" }}>
			{failed ? null : (
				<image source={source} fit="fit" style={{ width: "100%", height: 14 }} onError={() => setFailed(true)} />
			)}
			<text fg={palette.dim}>{`▣ ${props.alt || "image"}${failed ? `  (${props.src}, couldn't load)` : ""}`}</text>
		</box>
	);
}

function View(props: {
	readonly view: GfmView;
	readonly streaming: boolean;
	readonly syntaxStyle: SyntaxStyle;
	readonly docDir: string | undefined;
}) {
	const v = props.view;
	switch (v._tag) {
		case "Markdown":
			return v.rule ? (
				<box style={{ border: ["bottom"], borderColor: palette.border }}>
					<Markdown text={v.text} streaming={props.streaming} syntaxStyle={props.syntaxStyle} />
				</box>
			) : (
				<Markdown text={v.text} streaming={props.streaming} syntaxStyle={props.syntaxStyle} />
			);
		case "Code":
			return <CodeBlock lang={v.lang} text={v.text} streaming={props.streaming} syntaxStyle={props.syntaxStyle} />;
		case "Diagram":
			return Option.match(v.diagram, {
				onSome: (d) =>
					d._tag === "Text" ? (
						<Frame label="mermaid">
							<text fg={palette.accent} wrapMode="none">
								{d.art}
							</text>
						</Frame>
					) : (
						<Frame label="mermaid">
							<Picture png={d.png} width={d.width} height={d.height} />
						</Frame>
					),
				onNone: () => (
					<CodeBlock lang="mermaid" text={v.source} streaming={props.streaming} syntaxStyle={props.syntaxStyle} />
				),
			});
		case "Math":
			return (
				<Frame label="math">
					<text fg={palette.fg}>{v.text}</text>
				</Frame>
			);
		case "Alert": {
			const a = ALERTS[v.kind];
			return (
				<box style={{ flexDirection: "column", border: ["left"], borderColor: a.color, paddingLeft: 1 }}>
					<text fg={a.color}>
						<b>{`${a.icon} ${a.label}`}</b>
					</text>
					<Markdown text={v.body} streaming={props.streaming} syntaxStyle={props.syntaxStyle} />
				</box>
			);
		}
		case "Image":
			return <ImageBlock alt={v.alt} src={v.src} docDir={props.docDir} />;
		case "Hidden":
			return null;
	}
}

export const DOC_ID = "doc-blocks";

/**
 * One block with its cursor rail and comment thread. Memoized: moving the cursor
 * re-renders the two rows whose rail changed, not the whole document.
 */
const Row = memo(function Row(props: {
	readonly index: number;
	readonly view: GfmView;
	readonly rail: string;
	readonly thread: ReadonlyArray<Comment>;
	readonly showNotes: boolean;
	readonly streaming: boolean;
	readonly syntaxStyle: SyntaxStyle;
	readonly docDir: string | undefined;
	readonly onPick: (index: number) => void;
}) {
	// html comments and the like take no space, unless someone commented on them
	if (props.view._tag === "Hidden" && props.thread.length === 0) return <box id={blockId(props.index)} />;
	const now = Date.now();
	return (
		<box
			id={blockId(props.index)}
			onMouseDown={() => props.onPick(props.index)}
			style={{ flexDirection: "column", border: ["left"], borderColor: props.rail, paddingLeft: 1, marginBottom: 1 }}
		>
			<View view={props.view} streaming={props.streaming} syntaxStyle={props.syntaxStyle} docDir={props.docDir} />
			{props.showNotes ? props.thread.map((c) => <Note key={c.id} c={c} now={now} />) : null}
			{!props.showNotes && props.thread.length > 0 ? (
				<text fg={palette.flash}>{`● ${props.thread.length} note${props.thread.length === 1 ? "" : "s"}`}</text>
			) : null}
		</box>
	);
});

const NO_THREAD: ReadonlyArray<Comment> = [];

/** The document as a column of blocks, each with a cursor rail and its comment thread. */
export function DocBlocks(props: {
	readonly blocks: ReadonlyArray<Block>;
	readonly threads: ReadonlyMap<number, ReadonlyArray<Comment>>;
	readonly cursor: number;
	/** blocks that changed since the diff baseline */
	readonly changed: ReadonlySet<number>;
	readonly showNotes: boolean;
	readonly streaming: boolean;
	readonly syntaxStyle: SyntaxStyle;
	/** directory of the open doc, for relative image paths */
	readonly docDir: string | undefined;
	readonly onPick: (index: number) => void;
}) {
	const views = useMemo(() => props.blocks.map(viewOf), [props.blocks]);
	const last = props.blocks.length - 1;
	return (
		<box id={DOC_ID} style={{ flexDirection: "column", width: "100%" }}>
			{props.blocks.map((b, i) => {
				const thread = props.threads.get(i) ?? NO_THREAD;
				const rail =
					i === props.cursor
						? palette.accent
						: thread.length > 0
							? palette.flash
							: props.changed.has(i)
								? palette.ok
								: palette.bg;
				return (
					<Row
						key={`${i}:${b.start}`}
						index={i}
						view={views[i] ?? HIDDEN}
						rail={rail}
						thread={thread}
						showNotes={props.showNotes}
						streaming={props.streaming && i === last}
						syntaxStyle={props.syntaxStyle}
						docDir={props.docDir}
						onPick={props.onPick}
					/>
				);
			})}
		</box>
	);
}

const HIDDEN: GfmView = { _tag: "Hidden" };
