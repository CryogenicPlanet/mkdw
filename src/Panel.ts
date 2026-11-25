import { Context, Data, Effect, Layer, Option, Path } from "effect";
import { Control, type ControlError, type Target } from "./Control.ts";
import { Rex, type RexError } from "./Rex.ts";

export class NotInRex extends Data.TaggedError("NotInRex")<{}> {
	override get message(): string {
		return "mkdw panel needs a Rex terminal (REX_SESSION/REX_BLOCK unset). Use `mkdw open` instead.";
	}
}

export interface PanelOptions {
	/** percentage of the split the panel takes */
	readonly ratio: number;
	readonly focus: boolean;
}

const make = Effect.gen(function* () {
	const rex = yield* Rex;
	const control = yield* Control;
	const path = yield* Path.Path;
	const main = path.join(import.meta.dir, "main.ts");

	/**
	 * Point this Rex session's mkdw panel at `target`, opening the panel beside
	 * the current pane if it isn't running. One panel per Rex session.
	 */
	const show = (
		target: Target,
		opts: PanelOptions,
	): Effect.Effect<{ readonly dir: string; readonly block: string; readonly opened: boolean }, NotInRex | RexError | ControlError> =>
		Effect.gen(function* () {
			const here = yield* Option.match(rex.here, {
				onNone: () => Effect.fail(new NotInRex()),
				onSome: Effect.succeed,
			});
			const dir = control.dirFor(here.session);
			const prev = yield* control.read(dir);
			const existing = Option.flatMap(prev, (p) => Option.fromUndefinedOr(p.block));
			const alive = yield* Option.match(existing, {
				onNone: () => Effect.succeed(false),
				onSome: (b) => rex.isAlive(here.session, b),
			});

			const keep = alive ? Option.getOrUndefined(existing) : undefined;
			// write the target first so a freshly spawned panel starts on it
			yield* control.update(dir, () => (keep === undefined ? { target } : { target, block: keep }));
			const block =
				keep ??
				(yield* rex.splitRight(here, [process.execPath, main, "open", process.cwd(), "--control", dir], {
					ratio: opts.ratio,
					label: "mkdw",
					cwd: process.cwd(),
				}));
			if (keep === undefined) yield* control.update(dir, () => ({ target, block }));
			if (opts.focus) yield* rex.focus(here.session, block);
			return { dir, block, opened: !alive };
		});

	return { show } as const;
});

export class Panel extends Context.Service<Panel, Effect.Success<typeof make>>()("mkdw/Panel") {}
export const layer = Layer.effect(Panel, make);
