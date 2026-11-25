/**
 * GitHub-flavored extras the terminal markdown renderer doesn't know about.
 * Each block is turned into a `View`: either markdown (rewritten so OpenTUI
 * renders it the way GitHub would) or a dedicated widget (code, diagram, math,
 * alert, image). Everything here is pure, so it runs inside React's memo.
 */
import { Option } from "effect";
import { emojify } from "node-emoji";
import type { Block } from "./blocks.ts";
import { type Diagram, renderDiagram } from "./diagram.ts";

export type AlertKind = "note" | "tip" | "important" | "warning" | "caution";

export type View =
	| { readonly _tag: "Markdown"; readonly text: string; readonly rule: boolean }
	| { readonly _tag: "Code"; readonly lang: string; readonly text: string }
	| { readonly _tag: "Diagram"; readonly source: string; readonly diagram: Option.Option<Diagram> }
	| { readonly _tag: "Math"; readonly text: string }
	| { readonly _tag: "Alert"; readonly kind: AlertKind; readonly body: string }
	| { readonly _tag: "Image"; readonly alt: string; readonly src: string }
	| { readonly _tag: "Hidden" };

// ---------------------------------------------------------------------------
// inline rewriting

/** Apply `f` to the parts of `text` outside inline code spans. */
const outsideCode = (text: string, f: (s: string) => string): string =>
	text
		.split(/(`+[^`]*?`+)/g)
		.map((part, i) => (i % 2 === 1 ? part : f(part)))
		.join("");

const SUPER: Record<string, string> = {
	"0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
	"+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ", a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ",
	e: "ᵉ", f: "ᶠ", g: "ᵍ", h: "ʰ", j: "ʲ", k: "ᵏ", l: "ˡ", m: "ᵐ", o: "ᵒ", p: "ᵖ", r: "ʳ", s: "ˢ",
	t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ", x: "ˣ", y: "ʸ", z: "ᶻ", T: "ᵀ",
};
const SUB: Record<string, string> = {
	"0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
	"+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ",
	l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ",
};

/** Map every char through `table`, or None if any char has no mapping. */
const script = (s: string, table: Record<string, string>): Option.Option<string> =>
	[...s].reduce<Option.Option<string>>(
		(acc, ch) => Option.flatMap(acc, (out) => Option.map(Option.fromNullishOr(table[ch]), (m) => out + m)),
		Option.some(""),
	);

const sup = (s: string): string => Option.getOrElse(script(s, SUPER), () => `^(${s})`);
const sub = (s: string): string => Option.getOrElse(script(s, SUB), () => `_(${s})`);

const TEX: ReadonlyArray<readonly [string, string]> = [
	["alpha", "α"], ["beta", "β"], ["gamma", "γ"], ["delta", "δ"], ["epsilon", "ε"], ["varepsilon", "ε"],
	["zeta", "ζ"], ["eta", "η"], ["theta", "θ"], ["iota", "ι"], ["kappa", "κ"], ["lambda", "λ"], ["mu", "μ"],
	["nu", "ν"], ["xi", "ξ"], ["pi", "π"], ["rho", "ρ"], ["sigma", "σ"], ["tau", "τ"], ["upsilon", "υ"],
	["phi", "φ"], ["varphi", "φ"], ["chi", "χ"], ["psi", "ψ"], ["omega", "ω"], ["Gamma", "Γ"], ["Delta", "Δ"],
	["Theta", "Θ"], ["Lambda", "Λ"], ["Xi", "Ξ"], ["Pi", "Π"], ["Sigma", "Σ"], ["Phi", "Φ"], ["Psi", "Ψ"],
	["Omega", "Ω"], ["sum", "∑"], ["prod", "∏"], ["int", "∫"], ["oint", "∮"], ["infty", "∞"], ["partial", "∂"],
	["nabla", "∇"], ["leq", "≤"], ["le", "≤"], ["geq", "≥"], ["ge", "≥"], ["neq", "≠"], ["ne", "≠"],
	["approx", "≈"], ["equiv", "≡"], ["sim", "∼"], ["propto", "∝"], ["times", "×"], ["cdot", "·"], ["div", "÷"],
	["pm", "±"], ["mp", "∓"], ["to", "→"], ["rightarrow", "→"], ["leftarrow", "←"], ["Rightarrow", "⇒"],
	["Leftarrow", "⇐"], ["iff", "⇔"], ["implies", "⇒"], ["mapsto", "↦"], ["in", "∈"], ["notin", "∉"],
	["subset", "⊂"], ["subseteq", "⊆"], ["supset", "⊃"], ["cup", "∪"], ["cap", "∩"], ["emptyset", "∅"],
	["forall", "∀"], ["exists", "∃"], ["neg", "¬"], ["land", "∧"], ["lor", "∨"], ["ldots", "…"], ["cdots", "⋯"],
	["dots", "…"], ["circ", "∘"], ["star", "⋆"], ["ell", "ℓ"], ["hbar", "ℏ"], ["angle", "∠"], ["deg", "°"],
	["langle", "⟨"], ["rangle", "⟩"], ["lfloor", "⌊"], ["rfloor", "⌋"], ["lceil", "⌈"], ["rceil", "⌉"],
	["quad", "  "], ["qquad", "    "], ["mid", "|"], ["vert", "|"], ["Vert", "‖"],
];
const BLACKBOARD: Record<string, string> = { R: "ℝ", N: "ℕ", Z: "ℤ", Q: "ℚ", C: "ℂ", P: "ℙ", E: "𝔼" };

const group = (s: string): string => (/^[\w.]+$/.test(s) ? s : `(${s})`);

/** Best-effort LaTeX to Unicode, good enough to read formulas in a terminal. */
export const texToUnicode = (tex: string): string =>
	TEX.reduce((s, [name, ch]) => s.replace(new RegExp(`\\\\${name}(?![a-zA-Z])`, "g"), ch), tex)
		.replace(/\\mathbb\{(\w)\}/g, (_, c: string) => BLACKBOARD[c] ?? c)
		.replace(/\\(?:mathrm|mathbf|mathit|text|textbf|operatorname|mathcal)\{([^{}]*)\}/g, "$1")
		.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, a: string, b: string) =>
			a.length === 1 && b.length === 1 ? `${a}⁄${b}` : `${group(a)}/${group(b)}`,
		)
		.replace(/\\sqrt\{([^{}]*)\}/g, (_, a: string) => (a.length === 1 ? `√${a}` : `√(${a})`))
		.replace(/\\(?:left|right|big|Big|bigg|Bigg|displaystyle|,|;|!)/g, "")
		.replace(/\^\{([^{}]*)\}/g, (_, a: string) => sup(a))
		.replace(/\^(\\?\w)/g, (_, a: string) => sup(a))
		.replace(/_\{([^{}]*)\}/g, (_, a: string) => sub(a))
		.replace(/_(\w)/g, (_, a: string) => sub(a))
		.replace(/\\\\/g, "\n")
		.replace(/[{}]/g, "")
		.replace(/\\([#$%&_])/g, "$1");

const attr = (tag: string, name: string): string | undefined =>
	new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag)?.slice(1).find((v) => v !== undefined);

/** Inline HTML GitHub allows, mapped onto markdown the renderer understands. */
const html = (s: string): string =>
	s
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<br\s*\/?>/gi, "  \n")
		.replace(/<kbd>([\s\S]*?)<\/kbd>/gi, "`$1`")
		.replace(/<(?:b|strong)>([\s\S]*?)<\/(?:b|strong)>/gi, "**$1**")
		.replace(/<(?:i|em)>([\s\S]*?)<\/(?:i|em)>/gi, "*$1*")
		.replace(/<(?:s|del|strike)>([\s\S]*?)<\/(?:s|del|strike)>/gi, "~~$1~~")
		.replace(/<code>([\s\S]*?)<\/code>/gi, "`$1`")
		.replace(/<sup>([\s\S]*?)<\/sup>/gi, (_, a: string) => sup(a))
		.replace(/<sub>([\s\S]*?)<\/sub>/gi, (_, a: string) => sub(a))
		.replace(/<a\s[^>]*>([\s\S]*?)<\/a>/gi, (tag: string, text: string) => {
			const href = attr(tag, "href");
			return href === undefined ? text : `[${text}](${href})`;
		})
		.replace(/<img\s[^>]*>/gi, (tag) => `![${attr(tag, "alt") ?? "image"}](${attr(tag, "src") ?? ""})`)
		.replace(/<summary>([\s\S]*?)<\/summary>/gi, "**▾ $1**")
		.replace(/<\/?(?:details|summary|p|div|span|picture|source|center|section|article|ins|mark|small|big|u|font)\b[^>]*>/gi, "")
		.replace(/<hr\s*\/?>/gi, "───");

const footnotes = (s: string): string =>
	s
		.replace(/^\[\^([^\]\s]+)\]:\s*/gm, (_, id: string) => `${sup(id)} `)
		.replace(/\[\^([^\]\s]+)\]/g, (_, id: string) => sup(id));

const inlineMath = (s: string): string =>
	s
		.replace(/\$`([^`]+)`\$/g, (_, tex: string) => `\`${texToUnicode(tex)}\``)
		.replace(/(?<![\\$\w])\$(?=[^\s$])([^$\n]+?)(?<=[^\s\\])\$(?![\w$])/g, (_, tex: string) => `\`${texToUnicode(tex)}\``);

/** Images become a marker plus their path, since inline pictures don't fit a text line. */
const images = (s: string): string => s.replace(/!\[([^\]]*)\]\(([^)\s]*)[^)]*\)/g, (_, alt: string, src: string) => `▣ ${alt || "image"} (${src})`);

const tasks = (s: string): string =>
	s.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\](?=\s)/gm, (_, lead: string, mark: string) => `${lead}${mark === " " ? "☐" : "☑"}`);

const unquote = (raw: string): string =>
	raw
		.split("\n")
		.map((l) => l.replace(/^\s*>\s?/, ""))
		.join("\n");

/** A line that starts its own markdown construct, so it must stay on its own line. */
const STARTS_BLOCK = /^\s*(?:[-*+]\s|\d+[.)]\s|>|#{1,6}\s|\||```|~~~|<\/?[a-zA-Z]|\[\^[^\]]+\]:|$)/;

/**
 * Join soft line breaks the way GitHub does: a newline inside a paragraph or
 * list item is a space. Hard breaks (two trailing spaces or a backslash) and
 * lines that start a new item, quote, or heading keep their newline.
 */
export const unwrap = (text: string): string =>
	text
		.split("\n")
		.reduce<ReadonlyArray<string>>((out, line) => {
			const prev = out.at(-1);
			const hard = prev === undefined || / {2,}$|\\$/.test(prev) || prev.trim() === "" || /^\s*(?:```|~~~)/.test(prev);
			return hard || STARTS_BLOCK.test(line) ? [...out, line] : [...out.slice(0, -1), `${prev.trimEnd()} ${line.trimStart()}`];
		}, [])
		.join("\n");

/** `unwrap` for a blockquote: strip the `>` markers, join, then put them back. */
const unwrapQuote = (raw: string): string =>
	unwrap(unquote(raw))
		.split("\n")
		.map((l) => (l === "" ? ">" : `> ${l}`))
		.join("\n");

const inline = (s: string): string => outsideCode(s, (part) => images(inlineMath(footnotes(emojify(html(part))))));

// ---------------------------------------------------------------------------
// blocks

const ALERT = /^\s*>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i;
const ALERT_KINDS: Record<string, AlertKind> = {
	NOTE: "note",
	TIP: "tip",
	IMPORTANT: "important",
	WARNING: "warning",
	CAUTION: "caution",
};

/** A paragraph that is just a lone image renders as an image widget. */
const LONE_IMAGE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/;

export const viewOf = (b: Block): View => {
	if (b.code !== undefined) {
		const lang = b.code.lang.toLowerCase();
		if (lang === "mermaid") return { _tag: "Diagram", source: b.code.text, diagram: renderDiagram(b.code.text) };
		if (lang === "math" || lang === "latex" || lang === "tex") return { _tag: "Math", text: texToUnicode(b.code.text) };
		return { _tag: "Code", lang: b.code.lang, text: b.code.text };
	}
	const raw = b.raw.trim();
	const block = /^\$\$([\s\S]+)\$\$$/.exec(raw);
	if (block?.[1] !== undefined) return { _tag: "Math", text: texToUnicode(block[1].trim()) };
	if (b.kind === "blockquote") {
		const [first, ...rest] = raw.split("\n");
		const kind = ALERT_KINDS[(first === undefined ? null : ALERT.exec(first))?.[1]?.toUpperCase() ?? ""];
		if (kind !== undefined) return { _tag: "Alert", kind, body: inline(unwrap(unquote(rest.join("\n")))) };
	}
	const lone = b.kind === "paragraph" ? LONE_IMAGE.exec(raw) : null;
	if (lone?.[2] !== undefined) return { _tag: "Image", alt: lone[1] ?? "", src: lone[2] };
	const flowed =
		b.kind === "paragraph" ? unwrap(raw) : b.kind === "list" ? tasks(unwrap(raw)) : b.kind === "blockquote" ? unwrapQuote(raw) : raw;
	const text = inline(flowed).trim();
	if (text === "") return { _tag: "Hidden" };
	return { _tag: "Markdown", text, rule: b.kind === "heading" && /^#{1,2}\s/.test(raw) };
};
