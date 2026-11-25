import { lexer } from "marked";

/** A top-level markdown block and the source lines it covers (1-based, inclusive). */
export interface Block {
	readonly raw: string;
	readonly start: number;
	readonly end: number;
	readonly kind: string;
}

const newlines = (s: string): number => s.split("\n").length - 1;

/**
 * Split a document into top-level blocks (headings, paragraphs, lists, code,
 * tables…). Blank-line tokens are dropped but still advance the line count,
 * so every block knows exactly where it sits in the source.
 */
export const splitBlocks = (source: string): ReadonlyArray<Block> => {
	const tokens = lexer(source);
	const { blocks } = tokens.reduce<{ readonly line: number; readonly blocks: ReadonlyArray<Block> }>(
		(acc, t) => {
			const lines = newlines(t.raw);
			const body = t.raw.replace(/\n+$/, "");
			const next = acc.line + lines;
			if (t.type === "space" || body.trim() === "") return { line: next, blocks: acc.blocks };
			const block: Block = { raw: body, start: acc.line, end: acc.line + newlines(body), kind: t.type };
			return { line: next, blocks: [...acc.blocks, block] };
		},
		{ line: 1, blocks: [] },
	);
	return blocks;
};

/** Index of the block containing `line`, or the nearest block above it. */
export const blockAt = (blocks: ReadonlyArray<Block>, line: number): number =>
	blocks.reduce((found, b, i) => (b.start <= line ? i : found), 0);
