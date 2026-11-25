import { Clock, Context, Data, Effect, FileSystem, Layer, Path, Random, Schema, Stream } from "effect";

/**
 * Review comments on markdown documents, hunk-style. Each document gets a
 * sidecar JSON file under `~/.local/state/mkdw/comments/`. Comments anchor to a
 * source line plus the quoted text of that line, so they survive edits that
 * move the line around.
 */

export const Comment = Schema.Struct({
	id: Schema.String,
	/** absolute path of the commented document */
	file: Schema.String,
	/** 1-based source line the comment anchors to */
	line: Schema.Number,
	/** that line's text when the comment was made, for re-anchoring */
	quote: Schema.String,
	body: Schema.String,
	author: Schema.String,
	kind: Schema.Literals(["user", "agent"]),
	createdAt: Schema.Number,
	resolved: Schema.Boolean,
});
export type Comment = typeof Comment.Type;

const CommentsJson = Schema.fromJsonString(Schema.Array(Comment));

export class CommentsError extends Data.TaggedError("CommentsError")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export interface NewComment {
	readonly file: string;
	readonly line: number;
	readonly quote: string;
	readonly body: string;
	readonly author: string;
	readonly kind: Comment["kind"];
}

/** Move `line` to wherever `quote` now lives (nearest match), else keep it. */
export const reanchor = (lines: ReadonlyArray<string>, c: Pick<Comment, "line" | "quote">): number => {
	if (c.quote.trim() === "" || lines[c.line - 1] === c.quote) return Math.min(Math.max(1, c.line), Math.max(1, lines.length));
	const hits = lines.flatMap((l, i) => (l === c.quote ? [i + 1] : []));
	return hits.length === 0
		? Math.min(Math.max(1, c.line), Math.max(1, lines.length))
		: hits.reduce((best, n) => (Math.abs(n - c.line) < Math.abs(best - c.line) ? n : best));
};

const make = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;

	const dir = path.join(
		process.env["XDG_STATE_HOME"] ?? path.join(process.env["HOME"] ?? "/tmp", ".local", "state"),
		"mkdw",
		"comments",
	);
	const fileFor = (doc: string): string => path.join(dir, `${doc.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`);

	const list = (doc: string): Effect.Effect<ReadonlyArray<Comment>> =>
		fs.readFileString(fileFor(doc)).pipe(
			Effect.flatMap(Schema.decodeUnknownEffect(CommentsJson)),
			Effect.orElseSucceed((): ReadonlyArray<Comment> => []),
		);

	const save = (doc: string, comments: ReadonlyArray<Comment>): Effect.Effect<void, CommentsError> =>
		Effect.gen(function* () {
			yield* fs.makeDirectory(dir, { recursive: true });
			const json = yield* Schema.encodeEffect(CommentsJson)(comments);
			const target = fileFor(doc);
			const tmp = `${target}.${yield* Random.nextInt}.tmp`;
			yield* fs.writeFileString(tmp, json);
			yield* fs.rename(tmp, target);
		}).pipe(Effect.mapError((cause) => new CommentsError({ message: "failed to save comments", cause })));

	const modify = (doc: string, f: (cs: ReadonlyArray<Comment>) => ReadonlyArray<Comment>) =>
		list(doc).pipe(Effect.flatMap((cs) => save(doc, f(cs))));

	const add = (c: NewComment): Effect.Effect<Comment, CommentsError> =>
		Effect.gen(function* () {
			const id = (yield* Random.nextIntBetween(0, 0xffffffff)).toString(16).padStart(8, "0");
			const comment: Comment = { ...c, id, createdAt: yield* Clock.currentTimeMillis, resolved: false };
			yield* modify(c.file, (cs) => [...cs, comment]);
			return comment;
		});

	/** Every document that has a comment file, newest-first comments flattened. */
	const all: Effect.Effect<ReadonlyArray<Comment>> = fs.readDirectory(dir).pipe(
		Effect.orElseSucceed((): ReadonlyArray<string> => []),
		Effect.flatMap((names) =>
			Effect.forEach(
				names.filter((n) => n.endsWith(".json")),
				(n) =>
					fs.readFileString(path.join(dir, n)).pipe(
						Effect.flatMap(Schema.decodeUnknownEffect(CommentsJson)),
						Effect.orElseSucceed((): ReadonlyArray<Comment> => []),
					),
			),
		),
		Effect.map((groups) => groups.flat()),
	);

	const findDoc = (id: string): Effect.Effect<string, CommentsError> =>
		all.pipe(
			Effect.flatMap((cs) => {
				const hit = cs.find((c) => c.id === id || c.id.startsWith(id));
				return hit === undefined
					? Effect.fail(new CommentsError({ message: `no comment ${id}` }))
					: Effect.succeed(hit.file);
			}),
		);

	const remove = (id: string): Effect.Effect<void, CommentsError> =>
		findDoc(id).pipe(Effect.flatMap((doc) => modify(doc, (cs) => cs.filter((c) => !c.id.startsWith(id)))));

	const setResolved = (doc: string, ids: ReadonlyArray<string>, resolved: boolean): Effect.Effect<void, CommentsError> =>
		modify(doc, (cs) => cs.map((c) => (ids.includes(c.id) ? { ...c, resolved } : c)));

	const resolve = (id: string): Effect.Effect<void, CommentsError> =>
		findDoc(id).pipe(Effect.flatMap((doc) => modify(doc, (cs) => cs.map((c) => (c.id.startsWith(id) ? { ...c, resolved: true } : c)))));

	const clear = (doc: string): Effect.Effect<void, CommentsError> => save(doc, []);

	/** Ticks with the document's comments whenever its sidecar changes. */
	const changes = (doc: string): Stream.Stream<ReadonlyArray<Comment>> =>
		Stream.unwrap(
			fs.makeDirectory(dir, { recursive: true }).pipe(
				Effect.ignore,
				Effect.as(
					fs.watch(dir).pipe(
						Stream.filter((e) => e.path.endsWith(path.basename(fileFor(doc)))),
						Stream.debounce("30 millis"),
						Stream.mapEffect(() => list(doc)),
						Stream.catchCause(() => Stream.empty),
					),
				),
			),
		);

	/** Ticks with every comment whenever any sidecar changes. */
	const allChanges: Stream.Stream<ReadonlyArray<Comment>> = Stream.unwrap(
		fs.makeDirectory(dir, { recursive: true }).pipe(
			Effect.ignore,
			Effect.as(
				fs.watch(dir).pipe(
					Stream.filter((e) => e.path.endsWith(".json")),
					Stream.debounce("30 millis"),
					Stream.mapEffect(() => all),
					Stream.catchCause(() => Stream.empty),
				),
			),
		),
	);

	return { list, add, all, remove, resolve, setResolved, clear, changes, allChanges } as const;
});

export class Comments extends Context.Service<Comments, Effect.Success<typeof make>>()("mkdw/Comments") {}
export const layer = Layer.effect(Comments, make);
