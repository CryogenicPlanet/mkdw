import { Context, Data, Effect, FileSystem, Layer, Option, Path, Schema, Stream } from "effect";

/**
 * The control channel between `mkdw panel|push` and a running panel is a
 * small directory: `control.json` says what the panel should show, and
 * `live.md` holds content streamed in by `mkdw push`.
 */

export const Target = Schema.Union([
	Schema.TaggedStruct("File", { path: Schema.String }),
	Schema.TaggedStruct("Live", { title: Schema.String, streaming: Schema.Boolean }),
]);
export type Target = typeof Target.Type;

export const ControlState = Schema.Struct({
	seq: Schema.Number,
	block: Schema.optional(Schema.String),
	target: Target,
});
export type ControlState = typeof ControlState.Type;

const ControlJson = Schema.fromJsonString(ControlState);

export class ControlError extends Data.TaggedError("ControlError")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

const make = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;

	const dirFor = (key: string): string => {
		const base = process.env["XDG_STATE_HOME"] ?? path.join(process.env["HOME"] ?? "/tmp", ".local", "state");
		return path.join(base, "mkdw", key.replace(/[^a-zA-Z0-9_-]/g, "_"));
	};

	const files = (dir: string) => ({
		control: path.join(dir, "control.json"),
		live: path.join(dir, "live.md"),
	});

	const read = (dir: string): Effect.Effect<Option.Option<ControlState>> =>
		fs.readFileString(files(dir).control).pipe(
			Effect.flatMap(Schema.decodeUnknownEffect(ControlJson)),
			Effect.option,
		);

	const write = (dir: string, state: ControlState): Effect.Effect<void, ControlError> =>
		Effect.gen(function* () {
			yield* fs.makeDirectory(dir, { recursive: true });
			const json = yield* Schema.encodeEffect(ControlJson)(state);
			const { control } = files(dir);
			// write-then-rename so a watching panel never reads a torn file
			yield* fs.writeFileString(`${control}.tmp`, json);
			yield* fs.rename(`${control}.tmp`, control);
		}).pipe(Effect.mapError((cause) => new ControlError({ message: "failed to write control state", cause })));

	/** Read-modify-write; bumps `seq` so the panel always sees a change. */
	const update = (
		dir: string,
		f: (prev: Option.Option<ControlState>) => Omit<ControlState, "seq">,
	): Effect.Effect<ControlState, ControlError> =>
		Effect.gen(function* () {
			const prev = yield* read(dir);
			const next: ControlState = {
				...f(prev),
				seq: Option.match(prev, { onNone: () => 1, onSome: (p) => p.seq + 1 }),
			};
			yield* write(dir, next);
			return next;
		});

	/** Emits the control state every time it changes on disk. */
	const changes = (dir: string): Stream.Stream<ControlState> =>
		Stream.unwrap(
			Effect.gen(function* () {
				yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.ignore);
				return fs.watch(dir).pipe(
					Stream.filter((e) => path.basename(e.path) === "control.json"),
					Stream.debounce("30 millis"),
					Stream.mapEffect(() => read(dir)),
					Stream.filter(Option.isSome),
					Stream.map((o) => o.value),
					Stream.changesWith((a, b) => a.seq === b.seq),
					Stream.catchCause(() => Stream.empty),
				);
			}),
		);

	const readLive = (dir: string): Effect.Effect<string> =>
		fs.readFileString(files(dir).live).pipe(Effect.orElseSucceed(() => ""));

	/** Emits live.md's content every time it changes. */
	const liveChanges = (dir: string): Stream.Stream<string> =>
		fs.watch(dir).pipe(
			Stream.filter((e) => path.basename(e.path) === "live.md"),
			Stream.debounce("16 millis"),
			Stream.mapEffect(() => readLive(dir)),
			Stream.catchCause(() => Stream.empty),
		);

	const resetLive = (dir: string): Effect.Effect<void, ControlError> =>
		fs.makeDirectory(dir, { recursive: true }).pipe(
			Effect.andThen(fs.writeFileString(files(dir).live, "")),
			Effect.mapError((cause) => new ControlError({ message: "failed to reset live.md", cause })),
		);

	const appendLive = (dir: string, chunk: string): Effect.Effect<void, ControlError> =>
		fs
			.writeFileString(files(dir).live, chunk, { flag: "a" })
			.pipe(Effect.mapError((cause) => new ControlError({ message: "failed to append to live.md", cause })));

	return { dirFor, files, read, write, update, changes, readLive, liveChanges, resetLive, appendLive } as const;
});

export class Control extends Context.Service<Control, Effect.Success<typeof make>>()("mkdw/Control") {}
export const layer = Layer.effect(Control, make);
