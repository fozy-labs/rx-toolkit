/**
 * Transition label grammar of the proposal («Грамматика подписи перехода»):
 *
 *     label   := trigger? guard? actions?
 *     trigger := EVENT | "after" (INT | NAME) | "done"
 *     guard   := "[" NAME "]"
 *     actions := "/" NAME ("," NAME)*
 *
 * The viz only needs the trigger to decide whether an edge is clickable and
 * which event it sends; guard and actions are kept for display.
 */

export type TransitionTrigger =
    | { kind: "event"; event: string }
    | { kind: "after"; delay: string }
    | { kind: "done" }
    | { kind: "always" }
    | { kind: "unknown" };

export type TransitionLabel = {
    raw: string;
    trigger: TransitionTrigger;
    guard?: string;
    actions: string[];
};

const NAME = "[A-Za-z_][A-Za-z0-9_]*";
const LABEL_RE = new RegExp(
    "^(?:after\\s+(?<delay>[0-9]+|" +
        NAME +
        ")|(?<done>done)|(?<event>" +
        NAME +
        "))?" +
        "\\s*(?:\\[\\s*(?<guard>" +
        NAME +
        ")\\s*\\])?" +
        "\\s*(?:/\\s*(?<actions>" +
        NAME +
        "(?:\\s*,\\s*" +
        NAME +
        ")*))?\\s*$",
);

/** Parses a raw mermaid edge label; text outside the grammar yields `kind: "unknown"`. */
export function parseTransitionLabel(raw: string): TransitionLabel {
    const text = raw.trim();
    const match = LABEL_RE.exec(text);
    if (!match?.groups) {
        return { raw, trigger: { kind: "unknown" }, actions: [] };
    }
    const { delay, done, event, guard, actions } = match.groups;
    const trigger: TransitionTrigger =
        delay !== undefined
            ? { kind: "after", delay }
            : done !== undefined
              ? { kind: "done" }
              : event !== undefined
                ? { kind: "event", event }
                : { kind: "always" };
    return {
        raw,
        trigger,
        guard: guard || undefined,
        actions: actions ? actions.split(",").map((name) => name.trim()) : [],
    };
}
