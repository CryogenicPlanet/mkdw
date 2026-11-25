import type { SyntaxStyle } from "@opentui/core";
import type { Block } from "../blocks.ts";
import type { Comment } from "../Comments.ts";
import { palette } from "./theme.ts";

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

/** The document as a column of blocks, each with a cursor rail and its comment thread. */
export function DocBlocks(props: {
	readonly blocks: ReadonlyArray<Block>;
	readonly threads: ReadonlyMap<number, ReadonlyArray<Comment>>;
	readonly cursor: number;
	readonly showNotes: boolean;
	readonly streaming: boolean;
	readonly syntaxStyle: SyntaxStyle;
}) {
	const now = Date.now();
	const last = props.blocks.length - 1;
	return (
		<box style={{ flexDirection: "column", width: "100%" }}>
			{props.blocks.map((b, i) => {
				const thread = props.threads.get(i) ?? [];
				const active = i === props.cursor;
				return (
					<box
						key={`${i}:${b.start}`}
						id={blockId(i)}
						style={{
							flexDirection: "column",
							border: ["left"],
							borderColor: active ? palette.accent : thread.length > 0 ? palette.flash : palette.bg,
							paddingLeft: 1,
							marginBottom: 1,
						}}
					>
						<markdown
							content={b.raw}
							syntaxStyle={props.syntaxStyle}
							streaming={props.streaming && i === last}
							conceal
							fg={palette.fg}
							tableOptions={{ style: "grid", widthMode: "content", cellPaddingX: 1, borderColor: palette.border }}
						/>
						{props.showNotes ? thread.map((c) => <Note key={c.id} c={c} now={now} />) : null}
						{!props.showNotes && thread.length > 0 ? (
							<text fg={palette.flash}>{`● ${thread.length} note${thread.length === 1 ? "" : "s"}`}</text>
						) : null}
					</box>
				);
			})}
		</box>
	);
}
