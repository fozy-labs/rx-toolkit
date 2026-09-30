import { deepEqual } from "@/common/utils/deepEqual";
import { shallowEqual } from "@/common/utils/shallowEqual";
import type { ReadonlySignal, StateSignal } from "@/signals/types";

import type { FieldState, Issue, IssuePath, Parsed, ShowErrors } from "../../types";
import type { FieldRecord } from "../definition/records";
import { action } from "../runtime/action";
import { ABSENT, DEFAULTS, parsedEquals, safeEquals } from "../runtime/values";
import type { FieldSnapshot } from "../submit/snapshot";
import { collectRuleIssues, isShown, schemaIssue, withSeverity } from "../validation/issues";
import { parseValue, type ParseResult } from "../validation/parse";
import { createRule, type RuleSignal } from "../validation/rules";

import {
    derived,
    memberPath,
    nodeKey,
    registerNode,
    writable,
    type InstanceScope,
    type NodeCore,
    type ParentCore,
    type ReinitOptions,
} from "./NodeCore";
import { createQueries } from "./queries";

/** The field model: one signal for the base and the draft. `"value" in input` ⇔ a draft exists. */
interface FieldInput {
    readonly default: unknown;
    readonly value?: unknown;
}

interface FieldMeta {
    readonly isTouched: boolean;
    readonly isFocused: boolean;
    readonly isSubmitted: boolean;
}

const PRISTINE: FieldMeta = Object.freeze({ isTouched: false, isFocused: false, isSubmitted: false });
const NO_ISSUES: Issue[] = [];

export class FieldCore implements NodeCore {
    readonly kind = "field";
    readonly scope: InstanceScope;
    readonly segments: readonly string[];
    readonly path$: ReadonlySignal<IssuePath>;
    readonly showErrors: ShowErrors;
    readonly rules: readonly RuleSignal[];
    readonly node: object;

    readonly value$: ReadonlySignal<unknown>;
    readonly parsed$: ReadonlySignal<Parsed<unknown>>;
    readonly issues$: ReadonlySignal<Issue[]>;
    readonly visibleErrors$: ReadonlySignal<Issue[]>;
    readonly visibleWarnings$: ReadonlySignal<Issue[]>;
    readonly isValid$: ReadonlySignal<boolean>;
    readonly isPending$: ReadonlySignal<boolean>;
    readonly isTouched$: ReadonlySignal<boolean>;
    readonly isModified$: ReadonlySignal<boolean>;
    readonly isDirty$: ReadonlySignal<boolean>;
    readonly isSubmitted$: ReadonlySignal<boolean>;
    readonly isDisabled$: ReadonlySignal<boolean>;

    private readonly _input$: StateSignal<FieldInput>;
    private readonly _meta$: StateSignal<FieldMeta>;
    private readonly _server$: StateSignal<Issue[]>;
    private readonly _label: string;

    constructor(
        private readonly _record: FieldRecord,
        readonly parent: ParentCore,
        name: string,
        initial: unknown,
    ) {
        const scope = parent.scope;
        const segments = [...parent.segments, name];
        const key = nodeKey(scope, segments);
        const signal = <T>(member: string, fn: () => T, equals?: (a: T, b: T) => boolean) =>
            derived(`${key}/${member}`, fn, equals);

        this.scope = scope;
        this.segments = segments;
        this._label = segments.join(".");
        this.showErrors = _record.showErrors ?? parent.showErrors;
        this.path$ = signal("path$", () => [...parent.path$(), parent.pathSegment(name)], shallowEqual);

        // Init: the starting state becomes the base, with no draft.
        this._input$ = writable<FieldInput>(`${key}/input$`, {
            default: initial === ABSENT ? _record.defaultValue : initial,
        });
        this._meta$ = writable(`${key}/meta$`, PRISTINE);
        this._server$ = writable(`${key}/server$`, NO_ISSUES);

        const input$ = this._input$;
        const meta$ = this._meta$;

        const value$ = signal("value$", () => {
            const input = input$();
            return "value" in input ? input.value : input.default;
        });
        let hasReportedAsync = false;
        const parse$ = signal<ParseResult>("parse", () =>
            parseValue(_record.schema, value$(), memberPath(segments, "schema"), () => {
                if (hasReportedAsync) return;
                hasReportedAsync = true;
                console.error(
                    `[rx-toolkit] The schema of form field "${this._label}" returned a promise. Async schemas are ` +
                        "not supported: move the async check into `queries` and read the query in `validate`.",
                );
            }),
        );
        const parsed$ = signal("parsed$", () => parse$().parsed, parsedEquals);

        const ctxBase = { value$, parsed$, context$: scope.context$ };
        const queries = createQueries(this, _record.queries, Object.freeze({ ...ctxBase }));
        this.rules = _record.rules.map((rule) => createRule(this, rule, { ...ctxBase, queries: queries.views }));

        const issues$ = signal(
            "issues$",
            () => {
                const path = this.path$();
                const out: Issue[] = [];
                for (const issue of parse$().issues) out.push(schemaIssue(path, issue));
                collectRuleIssues(this, path, out);
                queries.collectIssues(path, out);
                out.push(...this._server$());
                return out;
            },
            deepEqual,
        );
        const errors$ = signal("errors$", () => withSeverity(issues$(), "error"), shallowEqual);
        const warnings$ = signal("warnings$", () => withSeverity(issues$(), "warning"), shallowEqual);

        const isTouched$ = signal("isTouched$", () => meta$().isTouched);
        const isFocused$ = signal("isFocused$", () => meta$().isFocused);
        const isModified$ = signal("isModified$", () => "value" in input$());
        const isDirty$ = signal("isDirty$", () => {
            const input = input$();
            return "value" in input && !this._equals(input.value, input.default);
        });
        this.isSubmitted$ = signal("isSubmitted$", () => meta$().isSubmitted);
        this.isTouched$ = isTouched$;
        this.isModified$ = isModified$;

        const visibleErrors$ = signal(
            "visibleErrors$",
            () => (isShown(this.showErrors, this) ? errors$() : []),
            shallowEqual,
        );
        const visibleWarnings$ = signal(
            "visibleWarnings$",
            () => (isShown(this.showErrors, this) ? warnings$() : []),
            shallowEqual,
        );
        const isValid$ = signal("isValid$", () => parsed$().isParsed && errors$().length === 0);
        const isPending$ = signal("isPending$", () => queries.isPending());
        const isDisabled$ = signal("isDisabled$", () => parent.isDisabled$() || parent.isExcluded(name));

        const state$ = signal(
            "state$",
            (): FieldState<unknown> => ({
                value: value$(),
                parsed: parsed$(),
                visibleErrors: visibleErrors$(),
                visibleWarnings: visibleWarnings$(),
                isValid: isValid$(),
                isPending: isPending$(),
                isFocused: isFocused$(),
                isTouched: isTouched$(),
                isModified: isModified$(),
                isDirty: isDirty$(),
                isRequired: _record.required,
                isDisabled: isDisabled$(),
            }),
            shallowEqual,
        );

        this.value$ = value$;
        this.parsed$ = parsed$;
        this.issues$ = issues$;
        this.visibleErrors$ = visibleErrors$;
        this.visibleWarnings$ = visibleWarnings$;
        this.isValid$ = isValid$;
        this.isPending$ = isPending$;
        this.isDirty$ = isDirty$;
        this.isDisabled$ = isDisabled$;

        this.node = Object.freeze({
            state$,
            value$,
            parsed$,
            issues$,
            errors$,
            warnings$,
            visibleErrors$,
            visibleWarnings$,
            isValid$,
            isPending$,
            isFocused$,
            isTouched$,
            isModified$,
            isDirty$,
            isDisabled$,
            isRequired: _record.required,
            queries: queries.nodes,
            set: action((value: unknown) => this._set(value)),
            focus: action(() => this._patchMeta({ isFocused: true })),
            blur: action(() => this._patchMeta({ isFocused: false, isTouched: true })),
            markTouched: action((touched?: boolean) => this.markTouched(touched === undefined ? true : !!touched)),
            reset: action(() => this.reset()),
            // A list item is named by its key.
            ...(parent.kind === "list" ? { key: name } : null),
        });
        registerNode(this);
    }

    reset(): void {
        const input = this._input$.peek();
        if ("value" in input) this._input$.set({ default: input.default });
        this._clearMeta();
    }

    markTouched(touched: boolean): void {
        this._patchMeta({ isTouched: touched });
    }

    markSubmitted(): void {
        this._patchMeta({ isSubmitted: true });
    }

    /**
     * Reinit: a provided value becomes the base and the draft is dropped. With `keepDirtyValues`
     * a draft stays if it is dirty against the old base and differs from the new one; meta and
     * server issues follow the value: they go only when the value becomes one that does not
     * `equals` the value before.
     */
    reinit(data: unknown, { keepDirtyValues }: ReinitOptions): void {
        if (data === ABSENT) return;
        const base = data === DEFAULTS ? this._record.defaultValue : data;
        const input = this._input$.peek();
        const hasDraft = "value" in input;
        const value = hasDraft ? input.value : input.default;
        if (keepDirtyValues && hasDraft && !this._equals(value, input.default) && !this._equals(value, base)) {
            this._input$.set({ default: base, value });
            return;
        }
        if (hasDraft || !Object.is(input.default, base)) this._input$.set({ default: base });
        if (!keepDirtyValues || !this._equals(value, base)) this._clearMeta();
    }

    addServerIssues(issues: readonly Issue[]): void {
        if (issues.length) this._server$.set([...this._server$.peek(), ...issues]);
    }

    clearServerIssues(): void {
        this._server$.set(NO_ISSUES);
    }

    snapshot(): FieldSnapshot {
        return { kind: "field", core: this, value: this.value$.peek() };
    }

    /**
     * `_commit()`: what was sent becomes the base. The draft is dropped only if it `equals` what
     * was sent, so an edit made during the submit stays; meta is not touched.
     */
    commit({ value }: FieldSnapshot): void {
        const input = this._input$.peek();
        const next: FieldInput =
            "value" in input && !this._equals(input.value, value)
                ? { default: value, value: input.value }
                : { default: value };
        if (!shallowEqual(input, next)) this._input$.set(next);
    }

    /** Whether the value still `equals` `value`. */
    hasValue(value: unknown): boolean {
        return this._equals(this.value$.peek(), value);
    }

    private _set(value: unknown): void {
        if (this._equals(value, this.value$.peek())) return;
        this._input$.set({ default: this._input$.peek().default, value });
        this.clearServerIssues();
    }

    /** Removes touched, `submitted` and the server issues; focus is an input event and stays. */
    private _clearMeta(): void {
        this._patchMeta({ isTouched: false, isSubmitted: false });
        this.clearServerIssues();
    }

    private _patchMeta(patch: Partial<FieldMeta>): void {
        const meta = this._meta$.peek();
        const next = { ...meta, ...patch };
        if (!shallowEqual(meta, next)) this._meta$.set(next);
    }

    private _equals(a: unknown, b: unknown): boolean {
        return safeEquals(this._record.equals, a, b, this._label);
    }
}
