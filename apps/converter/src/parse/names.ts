// NAME := [A-Za-z_][A-Za-z0-9_]* — state ids, event names, guard / action / delay names, the machine id.
export const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Names become keys of plain config objects (`states`, `on`, the directive
 * tables), where `__proto__` would replace the prototype instead of adding
 * an entry — and an object literal in the generated file would do the same.
 */
const PROTOTYPE_ACCESSOR = "__proto__";

/** The "expected …" part of every invalid-name message. */
export const NAME_HINT = "expected /[A-Za-z_][A-Za-z0-9_]*/ other than `__proto__`";

// INT := [0-9]+ without leading zeros, so that the config key equals the text of the diagram.
export const INT_PATTERN = /^(?:0|[1-9][0-9]*)$/;

export function isName(text: string): boolean {
    return NAME_PATTERN.test(text) && text !== PROTOTYPE_ACCESSOR;
}

/** Trigger keywords of the label grammar; an event may not be called like them. */
export const RESERVED_TRIGGERS: ReadonlySet<string> = new Set(["after", "done"]);

/** The `[*]` pseudo-state of mermaid (initial on the left, final on the right of `-->`). */
export const PSEUDO_STATE = "[*]";
