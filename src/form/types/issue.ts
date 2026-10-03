/** The position of an issue: absolute from the root, list items by index. */
export type IssuePath = ReadonlyArray<string | number>;

export type IssueSeverity = "error" | "warning";

/**
 * Where an issue comes from. `rule` and `callback` name the declaring node (`path`) and the
 * member (`name`); their string form joins `[...path, name]` with `.`.
 */
export type IssueSource =
    | { type: "schema" }
    | { type: "server" }
    | { type: "rule"; path: string[]; name: string }
    | { type: "callback"; path: string[]; name: string };

export interface Issue {
    path: IssuePath;
    message: string;
    severity: IssueSeverity;
    source: IssueSource;
    code?: string;
}

/** An issue as `mapSubmitError` returns it: the form sets `source`, `severity` defaults to `"error"`. */
export interface IssueInput {
    path?: IssuePath;
    message: string;
    severity?: IssueSeverity;
    code?: string;
}

/** The third argument of `error` / `warn`. */
export interface IssueOptions {
    code?: string;
}
