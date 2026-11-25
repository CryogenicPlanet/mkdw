import { Context, Effect, FileSystem, Layer, Path, Stream } from "effect";

const MARKDOWN = /\.(md|markdown|mdx|mdown)$/i;
const IGNORED = /(^|\/)(node_modules|\.git|\.jj|dist|build|repos|target|\.next|\.cache)(\/|$)/;
const MAX_FILES = 2000;

export interface Root {
	/** absolute directory the sidebar lists */
	readonly dir: string;
	/** absolute file to open first, if any */
	readonly initial: string | undefined;
}

const make = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;

	const resolveRoot = (input: string): Effect.Effect<Root> =>
		Effect.gen(function* () {
			const abs = path.resolve(input);
			const info = yield* fs.stat(abs).pipe(Effect.option);
			const isDir = info._tag === "Some" && info.value.type === "Directory";
			return isDir ? { dir: abs, initial: undefined } : { dir: path.dirname(abs), initial: abs };
		});

	/** Markdown files under `dir`, relative, README first, then by path. */
	const list = (dir: string): Effect.Effect<ReadonlyArray<string>> =>
		fs.readDirectory(dir, { recursive: true }).pipe(
			Effect.map((entries) =>
				entries
					.filter((e) => MARKDOWN.test(e) && !IGNORED.test(e))
					.toSorted((a, b) => rank(a) - rank(b) || a.localeCompare(b))
					.slice(0, MAX_FILES),
			),
			Effect.orElseSucceed((): ReadonlyArray<string> => []),
		);

	const read = (file: string): Effect.Effect<string, string> =>
		fs.readFileString(file).pipe(Effect.mapError((e) => e.message));

	/** Ticks whenever something under `dir` changes (debounced). */
	const changes = (dir: string): Stream.Stream<void> =>
		fs.watch(dir, { recursive: true }).pipe(
			Stream.filter((e) => !IGNORED.test(path.relative(dir, e.path))),
			Stream.debounce("60 millis"),
			Stream.as(undefined),
			Stream.catchCause(() => Stream.empty),
		);

	return { resolveRoot, list, read, changes } as const;
});

const rank = (rel: string): number => {
	const depth = rel.split("/").length - 1;
	const readme = /(^|\/)readme\.md$/i.test(rel) ? 0 : 1;
	return depth * 2 + readme;
};

export class Workspace extends Context.Service<Workspace, Effect.Success<typeof make>>()("mkdw/Workspace") {}
export const layer = Layer.effect(Workspace, make);
