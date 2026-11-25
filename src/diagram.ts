/**
 * Mermaid diagrams for the terminal. Flowcharts, sequence, class, state, ER and
 * xy charts draw as text with beautiful-mermaid, so they stay crisp and
 * selectable. Everything else (pie, gantt, mindmap, timeline, gitGraph, ...)
 * renders to SVG with pele and is rasterized to a PNG the panel shows as an image.
 */
import { Resvg } from "@resvg/resvg-js";
import { renderMermaidASCII } from "beautiful-mermaid";
import { Option } from "effect";
import { render as renderSvg } from "pele";

export type Diagram =
	| { readonly _tag: "Text"; readonly art: string }
	| { readonly _tag: "Picture"; readonly png: Uint8Array; readonly width: number; readonly height: number };

/** pele's theme variables, set to mkdw's dark palette. */
const THEME: Record<string, string> = {
	"pele-bg": "#131318",
	"pele-fg": "#e6e6ea",
	"pele-muted": "#a0a0ad",
	"pele-line": "#a0a0ad",
	"pele-surface": "#1c1c24",
	"pele-surface-alt": "#24242e",
	"pele-border": "#3a3a46",
	"pele-accent": "#7aa2ff",
	"pele-font": "Helvetica, Arial, sans-serif",
	"pele-font-mono": "Menlo, monospace",
	"pele-series-1": "#7aa2ff",
	"pele-series-2": "#ff8ed1",
	"pele-series-3": "#5ed39a",
	"pele-series-4": "#f5b65c",
	"pele-series-5": "#c8a6ff",
	"pele-series-6": "#7ee0ff",
	"pele-series-7": "#ff7ab6",
	"pele-series-8": "#9fe8c2",
};

const VAR = /var\(--([\w-]+)(?:,([^()]*(?:\([^()]*\))?[^()]*))?\)/g;

/**
 * resvg doesn't do CSS custom properties, so inline them: pele declares
 * `--_x: var(--pele-x, default)` on the root and uses `var(--_x)` below.
 */
export const inlineVars = (svg: string): string => {
	const local = new Map(
		[...svg.matchAll(/--(_[\w-]+):\s*(var\([^;"]*\)|[^;"]+)/g)].map((m) => [m[1] ?? "", m[2] ?? ""] as const),
	);
	const resolve = (s: string, depth: number): string =>
		depth > 4
			? s
			: s.replace(VAR, (_, name: string, fallback: string | undefined) =>
					resolve(THEME[name] ?? local.get(name) ?? fallback ?? "", depth + 1),
				);
	return resolve(svg, 0);
};

const toPicture = Option.liftThrowable((source: string): Diagram => {
	const { svg } = renderSvg(source, { fontSize: 15 });
	const png = new Resvg(inlineVars(svg), {
		fitTo: { mode: "zoom", value: 2 },
		background: THEME["pele-bg"] ?? "#131318",
		font: { loadSystemFonts: true, defaultFontFamily: "Helvetica" },
	}).render();
	return { _tag: "Picture", png: png.asPng(), width: png.width, height: png.height };
});

/**
 * beautiful-mermaid reads `A-->B` as a node named `A--`, since ids may contain
 * dashes. Mermaid itself splits there, so space out the arrows first.
 */
const spaceArrows = (source: string): string =>
	/^\s*(?:graph|flowchart)\b/.test(source) ? source.replace(/(\w)(?=--|-\.|<-|==|~~)/g, "$1 ") : source;

const toText = Option.liftThrowable(
	(source: string): Diagram => ({
		_tag: "Text",
		art: renderMermaidASCII(spaceArrows(source), { colorMode: "none", paddingX: 3, paddingY: 1 }).replace(/\s+$/gm, ""),
	}),
);

export const renderDiagram = (source: string): Option.Option<Diagram> => Option.orElse(toText(source), () => toPicture(source));
