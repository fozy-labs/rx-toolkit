/**
 * Public data contracts of the converter: the JSON-serializable config subset
 * emitted into the generated file and walked by the viz, and the result of
 * `parse()` consumed by the emitter and by the viz playground.
 */

// --- config JSON -----------------------------------------------------------

/** A transition object; `guard` / `actions` are implementation names. */
export interface TransitionObjectJson {
    target?: string;
    guard?: string;
    actions?: string[];
}

/** A bare target (no guard, no actions), or a transition object. */
export type TransitionJson = string | TransitionObjectJson;

/** A single transition or the candidates of one trigger in source order (first enabled wins). */
export type TransitionListJson = TransitionJson | TransitionJson[];

/**
 * `after` / `onDone` candidates: `createMachine` accepts a bare target
 * there only outside an array, so a candidate list holds objects.
 */
export type DelayedTransitionListJson = TransitionJson | TransitionObjectJson[];

export interface StateNodeJson {
    /** Absent = atomic or compound (compound by presence of `states`). */
    type?: "final" | "parallel";
    /** From `state "desc" as X`. */
    description?: string;
    initial?: string;
    on?: Record<string, TransitionListJson>;
    /** Keys: `"3000"` (milliseconds) or a delay name declared with `@delay`. */
    after?: Record<string, DelayedTransitionListJson>;
    always?: TransitionListJson;
    onDone?: DelayedTransitionListJson;
    states?: Record<string, StateNodeJson>;
}

export interface MachineConfigJson {
    id: string;
    /** Verbatim `.mmd` text. */
    source: string;
    initial: string;
    states: Record<string, StateNodeJson>;
}

// --- parse result ----------------------------------------------------------

/** A directive body: text with the common indent of continuation lines removed; `line` is the 1-based line of the directive. */
export interface DirectiveBody {
    text: string;
    line: number;
}

export interface StateInfo {
    /** Mermaid id (`"green"`); synthetic region ids are `"<parent>.$<index>"`. */
    id: string;
    /** Config path (`"working.green"`). */
    path: string;
    /** Mermaid id of the owning scope; absent for root-level states. */
    parent?: string;
    description?: string;
    /**
     * 1-based source line of the mention that places the state: its mention
     * inside the owning block, otherwise its first mention at the root; for a
     * region, the line of the `state X {` statement.
     */
    line: number;
}

/** Markers used in `references` for transitions without a user event. */
export type SystemTriggerMarker = "$always" | "$after" | "$done";

export interface ParseResult {
    machineId: string;
    config: MachineConfigJson;
    /**
     * `@context type` (TS type text) / `@context initial` (JS expression). Each is absent when not declared;
     * `parse` accepts any combination, `emit` requires both or none.
     */
    context: { type?: string; initial?: DirectiveBody };
    /** `@event NAME: <ts-type>` payload type text; undeclared events are absent. */
    events: Record<string, string>;
    /** Every event name used in transition labels, source order, unique. */
    eventTypes: string[];
    /** `@guard` bodies — JS expressions. */
    guards: Record<string, DirectiveBody>;
    /** `@action` bodies — JS statements. */
    actions: Record<string, DirectiveBody>;
    /** `@delay` bodies — JS expressions. */
    delays: Record<string, DirectiveBody>;
    /** Event names (or system markers) of the transitions referencing each guard / action, source order, unique. */
    references: {
        guards: Record<string, Array<string | SystemTriggerMarker>>;
        actions: Record<string, Array<string | SystemTriggerMarker>>;
    };
    /** Every state in config order (depth first), regions included, synthetic `$final` states excluded. */
    states: StateInfo[];
}

// --- emit / convert --------------------------------------------------------

export interface EmitOptions {
    /** Module specifier of the import line. @default "@fozy-labs/rx-toolkit" */
    importFrom?: string;
    /** Source file name for the header comment; only its base name is written. */
    fileName?: string;
}

export interface ConvertOptions extends EmitOptions {
    fileName: string;
}

export interface ConvertResult {
    code: string;
    parsed: ParseResult;
}
