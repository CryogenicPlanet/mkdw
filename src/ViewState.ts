export type Current =
	| { readonly _tag: "File"; readonly path: string }
	| { readonly _tag: "Live"; readonly title: string }
	| { readonly _tag: "Empty" };

export interface ViewState {
	/** directory the sidebar lists */
	readonly root: string;
	/** markdown files under root, relative */
	readonly files: ReadonlyArray<string>;
	readonly current: Current;
	readonly content: string;
	/** true while `mkdw push` is still writing */
	readonly streaming: boolean;
	readonly error: string | undefined;
	/** set when the panel is driven by `mkdw panel|push` */
	readonly controlled: boolean;
	/** bumps on every reload so the UI can flash "updated" */
	readonly revision: number;
}

export type Intent =
	| { readonly _tag: "Open"; readonly path: string }
	| { readonly _tag: "Quit" };

/** What the React tree sees: a synchronous snapshot plus a change feed. */
export interface Store {
	readonly get: () => ViewState;
	readonly subscribe: (listener: () => void) => () => void;
	readonly dispatch: (intent: Intent) => void;
}
