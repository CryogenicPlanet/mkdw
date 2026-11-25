#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Data, Effect, Layer, Option, Path, Stdio, Stream } from "effect";
import type { PlatformError } from "effect/PlatformError";
import * as Comments from "./Comments.ts";
import * as Control from "./Control.ts";
import * as Panel from "./Panel.ts";
import * as Rex from "./Rex.ts";
import { runViewer } from "./Viewer.ts";
import * as Workspace from "./Workspace.ts";

const USAGE = `mkdw: a terminal markdown viewer that lives in a side panel

Usage:
  mkdw [path]                 view a file or browse a directory here (= mkdw open)
  mkdw open [path]            same, in this terminal
  mkdw panel [path]           show path in a Rex side panel (reuses the open one)
  mkdw push [file] [--title T] [--delay ms]
                              stream markdown from stdin (or a file) into the panel
  mkdw close                  close this session's panel

Comments (hunk-style review notes; "live" = the panel's pushed doc):
  mkdw comments [file|live] [--all] [--json]
                              list open comments (all files if none given)
  mkdw comments [file|live] --wait
                              block until the user leaves a new comment, print it
  mkdw comment <file|live> (--line N | --match TEXT) [--author NAME] <text…>
                              add an agent comment on the block at that line
  mkdw comment resolve <id> · mkdw comment rm <id>

Panel options:  --ratio N (default 42)  --focus

Keys: j/k scroll · space/u/d page · g/G top/end · [ ] prev/next file
      J/K block cursor · c comment · x resolve · { } prev/next comment · a hide notes
      tab focus sidebar · s sidebar · r raw source · q quit`;

class UsageError extends Data.TaggedError("UsageError")<{ readonly message: string }> {}

interface Args {
	readonly positional: ReadonlyArray<string>;
	readonly flags: ReadonlyMap<string, string | true>;
}

const parseArgs = (argv: ReadonlyArray<string>): Args => {
	const step = (rest: ReadonlyArray<string>, acc: Args): Args => {
		const [head, ...tail] = rest;
		if (head === undefined) return acc;
		if (!head.startsWith("--") || head === "--") return step(tail, { ...acc, positional: [...acc.positional, head] });
		const [name = "", inline] = head.slice(2).split("=", 2);
		const next = tail[0];
		const takesValue = inline === undefined && next !== undefined && !next.startsWith("--") && VALUED.has(name);
		const value: string | true = inline ?? (takesValue ? next : true);
		return step(takesValue ? tail.slice(1) : tail, { ...acc, flags: new Map([...acc.flags, [name, value]]) });
	};
	return step(argv, { positional: [], flags: new Map() });
};
const VALUED = new Set(["control", "title", "ratio", "delay", "line", "match", "author"]);

const str = (args: Args, name: string): Option.Option<string> => {
	const v = args.flags.get(name);
	return typeof v === "string" ? Option.some(v) : Option.none();
};
const num = (args: Args, name: string, fallback: number): number =>
	Option.match(str(args, name), { onNone: () => fallback, onSome: (v) => (Number.isFinite(Number(v)) ? Number(v) : fallback) });

const panelOpts = (args: Args): Panel.PanelOptions => ({
	ratio: Math.min(80, Math.max(20, num(args, "ratio", 42))),
	focus: args.flags.has("focus"),
});

const sleepMs = (ms: number) => (ms > 0 ? Effect.sleep(`${ms} millis`) : Effect.void);

/** `mkdw push`: stream stdin (or replay a file) into the panel's live document. */
const push = (args: Args) =>
	Effect.gen(function* () {
		const panel = yield* Panel.Panel;
		const control = yield* Control.Control;
		const stdio = yield* Stdio.Stdio;
		const path = yield* Path.Path;
		const file = Option.fromUndefinedOr(args.positional[0]);
		const title = Option.getOrElse(str(args, "title"), () =>
			Option.match(file, { onNone: () => "stdin", onSome: (f) => path.basename(f) }),
		);
		const delay = num(args, "delay", 0);

		const rex = yield* Rex.Rex;
		const here = yield* Option.match(rex.here, { onNone: () => Effect.fail(new Panel.NotInRex()), onSome: Effect.succeed });
		const dir = control.dirFor(here.session);
		yield* control.resetLive(dir);
		yield* (yield* Comments.Comments).clear(control.files(dir).live);
		yield* panel.show({ _tag: "Live", title, streaming: true }, panelOpts(args));

		const decoder = new TextDecoder();
		const source: Stream.Stream<string, string | PlatformError, Workspace.Workspace> = Option.match(file, {
			onNone: () => stdio.stdin.pipe(Stream.map((bytes) => decoder.decode(bytes, { stream: true }))),
			// replaying a file: split into word-ish chunks so it reads like a model streaming
			onSome: (f) =>
				Stream.fromEffect(Workspace.Workspace.use((w) => w.read(f))).pipe(
					Stream.flatMap((text) => Stream.fromIterable(text.match(/\S+\s*|\s+/g) ?? [])),
				),
		});

		yield* source.pipe(
			Stream.mapEffect((chunk) => control.appendLive(dir, chunk).pipe(Effect.andThen(sleepMs(delay)))),
			Stream.runDrain,
			Effect.ensuring(
				control.update(dir, (prev) => ({
					target: { _tag: "Live", title, streaming: false },
					...Option.match(Option.flatMap(prev, (p) => Option.fromUndefinedOr(p.block)), {
						onNone: () => ({}),
						onSome: (block) => ({ block }),
					}),
				})).pipe(Effect.ignore),
			),
		);
	});

const close = Effect.gen(function* () {
	const rex = yield* Rex.Rex;
	const control = yield* Control.Control;
	const here = yield* Option.match(rex.here, { onNone: () => Effect.fail(new Panel.NotInRex()), onSome: Effect.succeed });
	const state = yield* control.read(control.dirFor(here.session));
	const block = Option.flatMap(state, (s) => Option.fromUndefinedOr(s.block));
	yield* Option.match(block, {
		onNone: () => Console.log("no mkdw panel open"),
		onSome: (b) => rex.close(here.session, b),
	});
});

/** `live` → this Rex session's pushed document; anything else → an absolute path. */
const resolveDoc = (input: string) =>
	Effect.gen(function* () {
		if (input !== "live") return (yield* Path.Path).resolve(input);
		const rex = yield* Rex.Rex;
		const control = yield* Control.Control;
		const here = yield* Option.match(rex.here, { onNone: () => Effect.fail(new Panel.NotInRex()), onSome: Effect.succeed });
		return control.files(control.dirFor(here.session)).live;
	});

const formatComment = (c: Comments.Comment): string => {
	const rel = c.file.startsWith(`${process.cwd()}/`) ? c.file.slice(process.cwd().length + 1) : c.file;
	const state = c.resolved ? " (resolved)" : "";
	return `${rel}:${c.line}  [${c.id}] ${c.author} (${c.kind})${state}\n    > ${c.quote.trim()}\n    ${c.body.replaceAll("\n", "\n    ")}`;
};

const commentsCmd = (args: Args) =>
	Effect.gen(function* () {
		const store = yield* Comments.Comments;
		const doc = yield* Option.match(Option.fromUndefinedOr(args.positional[0]), {
			onNone: () => Effect.succeed(Option.none<string>()),
			onSome: (f) => resolveDoc(f).pipe(Effect.map(Option.some)),
		});
		const scoped = (cs: ReadonlyArray<Comments.Comment>) =>
			Option.match(doc, { onNone: () => cs, onSome: (d) => cs.filter((c) => c.file === d) });
		const json = args.flags.has("json");
		const print = (cs: ReadonlyArray<Comments.Comment>) =>
			json ? Console.log(JSON.stringify(cs, null, 2)) : Console.log(cs.length === 0 ? "no comments" : cs.map(formatComment).join("\n\n"));

		if (!args.flags.has("wait")) {
			const cs = scoped(yield* store.all).filter((c) => args.flags.has("all") || !c.resolved);
			return yield* print(cs.toSorted((a, b) => a.file.localeCompare(b.file) || a.line - b.line));
		}
		// wait for user comments this process hasn't seen yet
		const seen = new Set(scoped(yield* store.all).map((c) => c.id));
		const fresh = yield* store.allChanges.pipe(
			Stream.map((cs) => scoped(cs).filter((c) => c.kind === "user" && !c.resolved && !seen.has(c.id))),
			Stream.filter((cs) => cs.length > 0),
			Stream.runHead,
		);
		return yield* print(Option.getOrElse(fresh, () => []));
	});

const commentCmd = (args: Args) =>
	Effect.gen(function* () {
		const store = yield* Comments.Comments;
		const [first, ...rest] = args.positional;
		if (first === "rm" || first === "resolve") {
			const id = rest[0];
			if (id === undefined) return yield* Effect.fail(new UsageError({ message: `usage: mkdw comment ${first} <id>` }));
			yield* first === "rm" ? store.remove(id) : store.resolve(id);
			return yield* Console.log(`${first === "rm" ? "removed" : "resolved"} ${id}`);
		}
		if (first === undefined || rest.length === 0)
			return yield* Effect.fail(new UsageError({ message: "usage: mkdw comment <file|live> (--line N | --match TEXT) <text…>" }));
		const file = yield* resolveDoc(first);
		const workspace = yield* Workspace.Workspace;
		const lines = (yield* workspace.read(file).pipe(Effect.orElseSucceed(() => ""))).split("\n");
		const line = Option.match(str(args, "match"), {
			onNone: () => num(args, "line", 1),
			onSome: (m) => lines.findIndex((l) => l.includes(m)) + 1 || 1,
		});
		const added = yield* store.add({
			file,
			line,
			quote: lines[line - 1] ?? "",
			body: rest.join(" "),
			author: Option.getOrElse(str(args, "author"), () => "agent"),
			kind: "agent",
		});
		return yield* Console.log(formatComment(added));
	});

const program = Effect.gen(function* () {
	const args = parseArgs(process.argv.slice(2));
	const [command = "open", ...rest] = args.positional;
	const sub: Args = { ...args, positional: rest };
	const target = (fallback: string) => sub.positional[0] ?? fallback;

	if (args.flags.has("help") || command === "help" || command === "-h") return yield* Console.log(USAGE);

	switch (command) {
		case "open":
			return yield* runViewer({ input: target("."), control: str(args, "control") }).pipe(Effect.scoped);
		case "panel": {
			const path = yield* Path.Path;
			const input = path.resolve(target("."));
			const r = yield* (yield* Panel.Panel).show({ _tag: "File", path: input }, panelOpts(sub));
			return yield* Console.log(r.opened ? `opened mkdw panel (${r.block})` : `mkdw panel → ${input}`);
		}
		case "push":
			return yield* push(sub);
		case "close":
			return yield* close;
		case "comments":
			return yield* commentsCmd(sub);
		case "comment":
			return yield* commentCmd(sub);
		default:
			// `mkdw README.md` / `mkdw docs/`
			if (args.positional.length === 1) return yield* runViewer({ input: command, control: Option.none() }).pipe(Effect.scoped);
			return yield* Effect.fail(new UsageError({ message: `unknown command: ${command}\n\n${USAGE}` }));
	}
});

const AppLayer = Panel.layer.pipe(
	Layer.provideMerge(Layer.mergeAll(Control.layer, Rex.layer, Workspace.layer, Comments.layer)),
	Layer.provideMerge(BunServices.layer),
);

program.pipe(
	Effect.provide(AppLayer),
	Effect.catchTag("UsageError", (e) => Console.error(e.message)),
	Effect.catchTag("NotInRex", (e) => Console.error(e.message)),
	Effect.catchTag("CommentsError", (e) => Console.error(e.message)),
	BunRuntime.runMain,
);
