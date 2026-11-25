import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createElement } from "react";
import { Data, Deferred, Effect, Option, Path, Queue, Stream, SubscriptionRef } from "effect";
import { Control, type Target } from "./Control.ts";
import { App } from "./ui/App.tsx";
import type { Current, Intent, Store, ViewState } from "./ViewState.ts";
import { Workspace } from "./Workspace.ts";

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

		const root = yield* workspace.resolveRoot(opts.input);
		const initial: ViewState = {
			root: root.dir,
			files: yield* workspace.list(root.dir),
			current: root.initial === undefined ? { _tag: "Empty" } : { _tag: "File", path: root.initial },
			content: "",
			streaming: false,
			error: undefined,
			controlled: Option.isSome(opts.control),
			revision: 0,
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
				// a file outside the current root re-roots the sidebar at its directory
				const reroot =
					current._tag === "File" && path.relative((yield* SubscriptionRef.get(state)).root, current.path).startsWith("..")
						? Option.some(path.dirname(current.path))
						: Option.none<string>();
				const files = yield* Option.match(reroot, {
					onNone: () => Effect.succeed(Option.none<ReadonlyArray<string>>()),
					onSome: (dir) => workspace.list(dir).pipe(Effect.map(Option.some)),
				});
				yield* SubscriptionRef.update(state, (s) => ({
					...s,
					...loaded,
					current,
					streaming,
					root: Option.getOrElse(reroot, () => s.root),
					files: Option.getOrElse(files, () => s.files),
					revision: s.revision + 1,
				}));
			});

		const reloadCurrent = Effect.gen(function* () {
			const s = yield* SubscriptionRef.get(state);
			const files = yield* workspace.list(s.root);
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
				yield* SubscriptionRef.update(state, (s) => ({ ...s, root: r.dir, files }));
				const head = files[0];
				return yield* show(head === undefined ? { _tag: "Empty" } : { _tag: "File", path: path.join(r.dir, head) });
			});
		}

		function applyTarget(target: Target) {
			return target._tag === "File" ? openPath(target.path) : show({ _tag: "Live", title: target.title }, target.streaming);
		}

		// watch the sidebar root (switching when it changes) and reload on edits
		yield* SubscriptionRef.changes(state).pipe(
			Stream.map((s) => s.root),
			Stream.changes,
			Stream.switchMap((dir) => workspace.changes(dir).pipe(Stream.mapEffect(() => reloadCurrent))),
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
			Effect.flatMap((intent) =>
				intent._tag === "Quit" ? Deferred.succeed(quit, undefined) : show({ _tag: "File", path: intent.path }),
			),
			Effect.forever,
			Effect.forkScoped,
		);

		// bridge the SubscriptionRef into a synchronous store for React
		const store = yield* makeStore(yield* SubscriptionRef.get(state), (intent) => {
			Queue.offerUnsafe(intents, intent);
		});
		yield* SubscriptionRef.changes(state).pipe(Stream.runForEach(store.publish), Effect.forkScoped);

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
