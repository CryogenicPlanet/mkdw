import type { FiletypeParserOptions } from "@opentui/core";

/**
 * Extra tree-sitter grammars for fenced code. OpenTUI only bundles TypeScript,
 * JavaScript, markdown, and zig. These download on first use and are cached in
 * OpenTUI's data directory, so later runs work offline.
 */
const grammar = (
	filetype: string,
	repo: string,
	tag: string,
	aliases: ReadonlyArray<string> = [],
	name = filetype,
): FiletypeParserOptions => ({
	filetype,
	aliases: [...aliases],
	wasm: `https://github.com/${repo}/releases/download/${tag}/tree-sitter-${name}.wasm`,
	queries: { highlights: [`https://raw.githubusercontent.com/${repo}/${tag}/queries/highlights.scm`] },
});

export const parsers: ReadonlyArray<FiletypeParserOptions> = [
	grammar("bash", "tree-sitter/tree-sitter-bash", "v0.25.1", ["sh", "shell", "zsh", "console"]),
	grammar("python", "tree-sitter/tree-sitter-python", "v0.25.0", ["py"]),
	grammar("json", "tree-sitter/tree-sitter-json", "v0.24.8", ["jsonc"]),
	grammar("rust", "tree-sitter/tree-sitter-rust", "v0.24.2", ["rs"]),
	grammar("go", "tree-sitter/tree-sitter-go", "v0.25.0"),
	grammar("css", "tree-sitter/tree-sitter-css", "v0.25.0"),
	grammar("html", "tree-sitter/tree-sitter-html", "v0.23.2"),
	grammar("c", "tree-sitter/tree-sitter-c", "v0.24.2", ["h"]),
	grammar("ruby", "tree-sitter/tree-sitter-ruby", "v0.23.1", ["rb"]),
	grammar("yaml", "tree-sitter-grammars/tree-sitter-yaml", "v0.7.2", ["yml"]),
	grammar("toml", "tree-sitter-grammars/tree-sitter-toml", "v0.7.0"),
	grammar("diff", "tree-sitter-grammars/tree-sitter-diff", "v0.2.0", ["patch"]),
];
