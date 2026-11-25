import { addDefaultParsers, createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createElement } from "react";
import { Data, Deferred, Effect, Option, Path, Queue, Stream, SubscriptionRef } from "effect";
import { Comments } from "./Comments.ts";
import { Control, type Target } from "./Control.ts";
import { App } from "./ui/App.tsx";
import { parsers } from "./ui/parsers.ts";
import type { Current, Intent, Store, ViewState } from "./ViewState.ts";
import { Workspace } from "./Workspace.ts";

const sameDoc = (a: Current, b: Current): boolean =>
	(a._tag === "File" && b._tag === "File" && a.path === b.path) || (a._tag === "Live" && b._tag === "Live");

export class RendererError extends Data.TaggedError("RendererError")<{ readonly cause: unknown }> {}

export interface ViewerOptions {
	readonly input: string;
	/** control directory when launched as a panel */
	readonly control: Option.Option<string>;
}

export const runViewer = (opts: ViewerOptions) =>
	Effect.gen(function* () {
		const workspace = yield* Workspace;
		const control = yield* Control;
		const path = yield* Path.Path;
		const comments = yield* Comments;

		const docPathOf = (current: Current): string | undefined =>
			current._tag === "File"
				? current.path
				: current._tag === "Live"
					? Option.match(opts.control, { onNone: () => undefined, onSome: (dir) => control.files(dir).live })
					: undefined;

		const root = yield* workspace.resolveRoot(opts.input);
		const browseArgv = root.initial === undefined && Option.isNone(opts.control);
		const initial: ViewState = {
			root: root.dir,
			// a single file needs no listing, so opening one never scans the disk. A panel's
			// argv is just its cwd; what it shows (and whether to browse) comes from `mkdw panel`.
			browse: browseArgv,
			files: browseArgv ? yield* workspace.list(root.dir) : [],
			current: root.initial === undefined ? { _tag: "Empty" } : { _tag: "File", path: root.initial },
			content: "",
			baseline: "",
			streaming: false,
			error: undefined,
			controlled: Option.isSome(opts.control),
			revision: 0,
			docPath: undefined,
			comments: [],
		};
		const state = yield* SubscriptionRef.make(initial);

		const contentFor = (current: Current): Effect.Effect<{ content: string; error: string | undefined }> => {
			switch (current._tag) {
				case "File":
					return workspace.read(current.path).pipe(
						Effect.map((content) => ({ content, error: undefined })),
						Effect.catch((error) => Effect.succeed({ content: "", error })),
					);
				case "Live":
					return Option.match(opts.control, {
						onNone: () => Effect.succeed({ content: "", error: undefined }),
						onSome: (dir) => control.readLive(dir).pipe(Effect.map((content) => ({ content, error: undefined }))),
					});
				case "Empty":
					return Effect.succeed({ content: "", error: undefined });
			}
		};

		const show = (current: Current, streaming = false) =>
			Effect.gen(function* () {
				const loaded = yield* contentFor(current);
				const docPath = docPathOf(current);
				const docComments = docPath === undefined ? [] : yield* comments.list(docPath);
				// a file outside the browsed directory drops back to single-file mode
				const prev = yield* SubscriptionRef.get(state);
				const leave =
					current._tag === "File" && (!prev.browse || path.relative(prev.root, current.path).startsWith(".."));
				yield* SubscriptionRef.update(state, (s) => ({
					...s,
					...loaded,
					current,
					streaming,
					docPath,
					comments: docComments,
					// re-showing the same file (e.g. `mkdw panel` after an edit) keeps the diff base
					baseline: sameDoc(s.current, current) && s.revision > 0 ? s.baseline : loaded.content,
					...(leave && current._tag === "File" ? { root: path.dirname(current.path), browse: false, files: [] } : {}),
					revision: s.revision + 1,
				}));
			});

		const reloadCurrent = Effect.gen(function* () {
			const s = yield* SubscriptionRef.get(state);
			const files = s.browse ? yield* workspace.list(s.root) : s.files;
			const loaded = s.current._tag === "File" ? yield* contentFor(s.current) : { content: s.content, error: s.error };
			yield* SubscriptionRef.update(state, (prev) => ({
				...prev,
				...loaded,
				files,
				revision: loaded.content === prev.content ? prev.revision : prev.revision + 1,
			}));
		});

		// pick something to show when opened on a bare directory
		const first = initial.files[0];
		const start: Current =
			initial.current._tag === "Empty" && first !== undefined ? { _tag: "File", path: path.join(root.dir, first) } : initial.current;

		// the panel's control state wins over argv when it exists
		const controlled = yield* Option.match(opts.control, {
			onNone: () => Effect.succeed(Option.none()),
			onSome: (dir) => control.read(dir),
		});
		yield* Option.match(controlled, {
			onNone: () => show(start),
			onSome: (c) => applyTarget(c.target),
		});

		/** Open a file, or re-root the sidebar at a directory and open its first file. */
		function openPath(p: string) {
			return Effect.gen(function* () {
				const r = yield* workspace.resolveRoot(p);
				if (r.initial !== undefined) return yield* show({ _tag: "File", path: r.initial });
				const files = yield* workspace.list(r.dir);
				yield* SubscriptionRef.update(state, (s) => ({ ...s, root: r.dir, browse: true, files }));
				const head = files[0];
				return yield* show(head === undefined ? { _tag: "Empty" } : { _tag: "File", path: path.join(r.dir, head) });
			});
		}

		function applyTarget(target: Target) {
			return target._tag === "File" ? openPath(target.path) : show({ _tag: "Live", title: target.title }, target.streaming);
		}

		// watch the browsed directory, or just the open file, and reload on edits
		yield* SubscriptionRef.changes(state).pipe(
			Stream.map((s) =>
				s.browse ? `dir:${s.root}` : s.current._tag === "File" ? `file:${s.current.path}` : "none",
			),
			Stream.changes,
			Stream.switchMap((key) =>
				(key.startsWith("dir:")
					? workspace.changes(key.slice(4))
					: key.startsWith("file:")
						? workspace.fileChanges(key.slice(5))
						: Stream.empty
				).pipe(Stream.mapEffect(() => reloadCurrent)),
			),
			Stream.runDrain,
			Effect.forkScoped,
		);

		// follow `mkdw panel` / `mkdw push`
		yield* Option.match(opts.control, {
			onNone: () => Effect.void,
			onSome: (dir) =>
				Effect.all(
					[
						control.changes(dir).pipe(Stream.runForEach((c) => applyTarget(c.target)), Effect.forkScoped),
						control
							.liveChanges(dir)
							.pipe(
								Stream.runForEach((content) =>
									SubscriptionRef.update(state, (s) =>
										s.current._tag === "Live" && content !== s.content ? { ...s, content, revision: s.revision + 1 } : s,
									),
								),
								Effect.forkScoped,
							),
					],
					{ discard: true },
				),
		});

		// UI intents
		const intents = yield* Queue.unbounded<Intent>();
		const quit = yield* Deferred.make<void>();
		yield* Queue.take(intents).pipe(
			Effect.flatMap((intent) => handle(intent)),
			Effect.forever,
			Effect.forkScoped,
		);

		function handle(intent: Intent) {
			return Effect.gen(function* () {
				const s = yield* SubscriptionRef.get(state);
				switch (intent._tag) {
					case "Quit":
						return yield* Deferred.succeed(quit, undefined);
					case "Open":
						return yield* show({ _tag: "File", path: intent.path });
					case "AddComment": {
						if (s.docPath === undefined || intent.body.trim() === "") return;
						const added = yield* comments.add({
							file: s.docPath,
							line: intent.line,
							quote: s.content.split("\n")[intent.line - 1] ?? "",
							body: intent.body.trim(),
							author: process.env["USER"] ?? "you",
							kind: "user",
						});
						return yield* SubscriptionRef.update(state, (p) =>
							p.comments.some((c) => c.id === added.id) ? p : { ...p, comments: [...p.comments, added] },
						);
					}
					case "MarkSeen":
						return yield* SubscriptionRef.update(state, (p) => ({ ...p, baseline: p.content }));
					case "Resolve":
						if (s.docPath === undefined) return;
						return yield* comments.setResolved(s.docPath, intent.ids, intent.resolved);
				}
			}).pipe(Effect.catchTag("CommentsError", (e) => SubscriptionRef.update(state, (p) => ({ ...p, error: e.message }))));
		}

		// keep comments in sync with their sidecar (agents write it too)
		yield* SubscriptionRef.changes(state).pipe(
			Stream.map((s) => s.docPath),
			Stream.changes,
			Stream.switchMap((doc) =>
				doc === undefined
					? Stream.empty
					: comments.changes(doc).pipe(
							Stream.mapEffect((cs) =>
								SubscriptionRef.update(state, (s) => (s.docPath === doc ? { ...s, comments: cs } : s)),
							),
						),
			),
			Stream.runDrain,
			Effect.forkScoped,
		);

		// bridge the SubscriptionRef into a synchronous store for React
		const store = yield* makeStore(yield* SubscriptionRef.get(state), (intent) => {
			Queue.offerUnsafe(intents, intent);
		});
		yield* SubscriptionRef.changes(state).pipe(Stream.runForEach(store.publish), Effect.forkScoped);

		// register before the first code block asks the tree-sitter client for a grammar
		yield* Effect.sync(() => addDefaultParsers([...parsers]));
		const renderer = yield* Effect.acquireRelease(
			Effect.tryPromise({
				try: () => createCliRenderer({ exitOnCtrlC: false, useMouse: true }),
				catch: (cause) => new RendererError({ cause }),
			}),
			(r) => Effect.sync(() => r.destroy()),
		);
		yield* Effect.sync(() => createRoot(renderer).render(createElement(App, { store: store.store })));

		yield* Deferred.await(quit);
	});

const makeStore = (initial: ViewState, dispatch: Store["dispatch"]) =>
	Effect.sync(() => {
		const box = { current: initial };
		const listeners = new Set<() => void>();
		const store: Store = {
			get: () => box.current,
			subscribe: (listener) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
			dispatch,
		};
		const publish = (next: ViewState) =>
			Effect.sync(() => {
				box.current = next;
				listeners.forEach((l) => l());
			});
		return { store, publish };
	});
