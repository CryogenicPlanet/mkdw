import { lexer } from "marked";

/** A top-level markdown block and the source lines it covers (1-based, inclusive). */
export interface Block {
	readonly raw: string;
	readonly start: number;
	readonly end: number;
	readonly kind: string;
	/** fenced or indented code: the info string's language and the bare code */
	readonly code?: { readonly lang: string; readonly text: string };
}

const newlines = (s: string): number => s.split("\n").length - 1;

/**
 * Split a document into top-level blocks (headings, paragraphs, lists, code,
 * tables…). Blank-line tokens are dropped but still advance the line count,
 * so every block knows exactly where it sits in the source.
 */
export const splitBlocks = (source: string): ReadonlyArray<Block> => {
	// YAML frontmatter (skills, docs sites) renders as a yaml code block
	const fm = /^---\n[\s\S]*?\n---(\n|$)/.exec(source);
	if (fm !== null) {
		const head = fm[0].replace(/\n$/, "");
		const lines = newlines(head) + 1;
		const yaml = head.split("\n").slice(1, -1).join("\n");
		const front: Block = {
			raw: `\`\`\`yaml\n${yaml}\n\`\`\``,
			start: 1,
			end: lines,
			kind: "frontmatter",
			code: { lang: "yaml", text: yaml },
		};
		const rest = splitBody(source.slice(fm[0].length), lines + 1);
		return [front, ...rest];
	}
	return splitBody(source, 1);
};

const splitBody = (source: string, firstLine: number): ReadonlyArray<Block> => {
	const tokens = lexer(source);
	const { blocks } = tokens.reduce<{ readonly line: number; readonly blocks: ReadonlyArray<Block> }>(
		(acc, t) => {
			const lines = newlines(t.raw);
			const body = t.raw.replace(/\n+$/, "");
			const next = acc.line + lines;
			if (t.type === "space" || body.trim() === "") return { line: next, blocks: acc.blocks };
			const base = { raw: body, start: acc.line, end: acc.line + newlines(body), kind: t.type };
			const block: Block =
				t.type === "code" ? { ...base, code: { lang: (t.lang ?? "").trim().split(/\s+/)[0] ?? "", text: t.text } } : base;
			return { line: next, blocks: [...acc.blocks, block] };
		},
		{ line: firstLine, blocks: [] },
	);
	return blocks;
};

/** Index of the block containing `line`, or the nearest block above it. */
export const blockAt = (blocks: ReadonlyArray<Block>, line: number): number =>
	blocks.reduce((found, b, i) => (b.start <= line ? i : found), 0);
