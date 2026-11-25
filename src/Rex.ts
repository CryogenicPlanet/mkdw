import { Context, Data, Effect, Layer, Option, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

export class RexError extends Data.TaggedError("RexError")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

const SplitResult = Schema.fromJsonString(Schema.Struct({ block_ids: Schema.NonEmptyArray(Schema.String) }));

export interface Here {
	readonly session: string;
	readonly block: string;
}

const make = Effect.gen(function* () {
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

	/** The Rex session/pane this process is running in, if any. */
	const here: Option.Option<Here> = Option.all({
		session: Option.fromNullishOr(process.env["REX_SESSION"]),
		block: Option.fromNullishOr(process.env["REX_BLOCK"]),
	});

	const isAlive = (session: string, block: string): Effect.Effect<boolean> =>
		spawner.exitCode(ChildProcess.make("rex", ["block", "inspect", "-s", session, block, "--json"])).pipe(
			Effect.map((code) => code === 0),
			Effect.orElseSucceed(() => false),
		);

	/** Split a pane to the right of `at` running `command`, without stealing focus. */
	const splitRight = (
		at: Here,
		command: ReadonlyArray<string>,
		opts: { readonly ratio: number; readonly label: string; readonly cwd: string },
	): Effect.Effect<string, RexError> =>
		spawner
			.string(
				ChildProcess.make("rex", [
					"split",
					"-s",
					at.session,
					"-b",
					at.block,
					"--split=right",
					`--ratio=${opts.ratio}`,
					"--label",
					opts.label,
					"--focus=false",
					"-c",
					opts.cwd,
					"--json",
					"--",
					...command,
				]),
			)
			.pipe(
				Effect.flatMap(Schema.decodeUnknownEffect(SplitResult)),
				Effect.map((r) => r.block_ids[0]),
				Effect.mapError((cause) => new RexError({ message: "rex split failed", cause })),
			);

	const focus = (session: string, block: string): Effect.Effect<void> =>
		spawner.exitCode(ChildProcess.make("rex", ["block", "focus", "-s", session, block])).pipe(Effect.ignore);

	const close = (session: string, block: string): Effect.Effect<void> =>
		spawner.exitCode(ChildProcess.make("rex", ["block", "close", "-s", session, block])).pipe(Effect.ignore);

	return { here, isAlive, splitRight, focus, close } as const;
});

export class Rex extends Context.Service<Rex, Effect.Success<typeof make>>()("mkdw/Rex") {}
export const layer = Layer.effect(Rex, make);
