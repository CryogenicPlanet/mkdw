import { Context, Effect, FileSystem, Layer, Path, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const MARKDOWN = /\.(md|markdown|mdx|mdown)$/i;
const IGNORED = /(^|\/)(node_modules|\.git|\.jj|dist|build|repos|target|\.next|\.cache|vendor)(\/|$)/;
const MAX_FILES = 500;

export interface Root {
	/** absolute directory the sidebar lists */
	readonly dir: string;
	/** absolute file to open first, if any */
	readonly initial: string | undefined;
}

const make = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

	const resolveRoot = (input: string): Effect.Effect<Root> =>
		Effect.gen(function* () {
			const abs = path.resolve(input);
			const info = yield* fs.stat(abs).pipe(Effect.option);
			const isDir = info._tag === "Some" && info.value.type === "Directory";
			return isDir ? { dir: abs, initial: undefined } : { dir: path.dirname(abs), initial: abs };
		});

	/** Tracked and untracked-but-not-ignored markdown files, via git. Fails outside a repo. */
	const gitList = (dir: string) =>
		spawner
			.string(
				ChildProcess.make(
					"git",
					["-C", dir, "ls-files", "--cached", "--others", "--exclude-standard", "--deduplicate", "-z", "--", "*.md", "*.markdown", "*.mdx", "*.mdown"],
				),
			)
			.pipe(Effect.map((out) => out.split("\0").filter((f) => f !== "")));

	/** Fallback for plain directories: a recursive walk, skipping the usual heavy dirs. */
	const walkList = (dir: string) => fs.readDirectory(dir, { recursive: true });

	const inRepo = (dir: string): Effect.Effect<boolean> =>
		spawner.exitCode(ChildProcess.make("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"])).pipe(
			Effect.map((code) => code === 0),
			Effect.orElseSucceed(() => false),
		);

	/** Markdown files under `dir`, relative, README first, then by path. */
	const list = (dir: string): Effect.Effect<ReadonlyArray<string>> =>
		inRepo(dir).pipe(
			Effect.flatMap((repo): Effect.Effect<ReadonlyArray<string>, unknown> => (repo ? gitList(dir) : walkList(dir))),
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

	/** Ticks whenever a markdown file under `dir` changes (debounced). */
	const changes = (dir: string): Stream.Stream<void> =>
		fs.watch(dir, { recursive: true }).pipe(
			Stream.filter((e) => {
				const rel = path.relative(dir, e.path);
				return MARKDOWN.test(rel) && !IGNORED.test(rel);
			}),
			Stream.debounce("60 millis"),
			Stream.as(undefined),
			Stream.catchCause(() => Stream.empty),
		);

	/**
	 * Ticks whenever `file` changes. Watches the parent directory, not the file,
	 * because editors often save by writing a new file and renaming it over the old one.
	 */
	const fileChanges = (file: string): Stream.Stream<void> =>
		fs.watch(path.dirname(file)).pipe(
			Stream.filter((e) => path.basename(e.path) === path.basename(file)),
			Stream.debounce("60 millis"),
			Stream.as(undefined),
			Stream.catchCause(() => Stream.empty),
		);

	return { resolveRoot, list, read, changes, fileChanges } as const;
});

const rank = (rel: string): number => {
	const depth = rel.split("/").length - 1;
	const readme = /(^|\/)readme\.md$/i.test(rel) ? 0 : 1;
	return depth * 2 + readme;
};

export class Workspace extends Context.Service<Workspace, Effect.Success<typeof make>>()("mkdw/Workspace") {}
export const layer = Layer.effect(Workspace, make);
