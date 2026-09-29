import { deepEqual } from "@/common/utils/deepEqual";
import { shallowEqual } from "@/common/utils/shallowEqual";
import type { ReadonlySignal, StateSignal } from "@/signals/types";

import type { FormState, GroupState, InitializeOptions, Issue, IssuePath, Parsed, ShowErrors } from "../../types";
import type { GroupRecord } from "../definition/records";
import { action } from "../runtime/action";
import { guard, outcomeEquals, type Outcome } from "../runtime/guard";
import { ABSENT, childData, composedParsedEquals, DEFAULTS, isProvided, NOT_PARSED } from "../runtime/values";
import { commitSnapshot, type AttemptSnapshot, type GroupSnapshot } from "../submit/snapshot";
import { SubmitController } from "../submit/SubmitController";
import { callbackIssue, collectRuleIssues, isShown, withSeverity } from "../validation/issues";
import { createRule, type RuleSignal } from "../validation/rules";

import { buildNode } from "./buildNode";
import {
    derived,
    memberPath,
    nodeKey,
    registerNode,
    ROOT_PATH,
    writable,
    type InstanceScope,
    type NodeCore,
    type ParentCore,
    type ReinitOptions,
} from "./NodeCore";
import { createQueries } from "./queries";

interface GroupMeta {
    readonly isTouched: boolean;
    readonly isSubmitted: boolean;
}

/** What only the root gets: the instance key and the starting context. */
export interface RootInit {
    readonly key: string;
    readonly context: unknown;
}

/** A callback of the group whose failure is an own `callback` issue. */
interface CallbackRun {
    readonly name: string;
    readonly run$: ReadonlySignal<Outcome<unknown>>;
}

const PRISTINE: GroupMeta = Object.freeze({ isTouched: false, isSubmitted: false });
const NO_ISSUES: Issue[] = [];

/** A group node; the root is a group without a parent. */
export class GroupCore implements ParentCore {
    readonly kind = "group";
    readonly scope: InstanceScope;
    readonly segments: readonly string[];
    readonly path$: ReadonlySignal<IssuePath>;
    readonly showErrors: ShowErrors;
    readonly rules: readonly RuleSignal[];
    readonly node: object;
    readonly children: Readonly<Record<string, NodeCore>>;

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

    private readonly _meta$: StateSignal<GroupMeta>;
    private readonly _server$: StateSignal<Issue[]>;
    private readonly _excluded: Readonly<Record<string, ReadonlySignal<Outcome<boolean>>>>;
    private readonly _submit: SubmitController | null;
    private readonly _context$: StateSignal<unknown> | null;

    constructor(
        record: GroupRecord,
        readonly parent: ParentCore | null,
        name: string | null,
        initial: unknown,
        root?: RootInit,
    ) {
        const segments = parent && name !== null ? [...parent.segments, name] : [];
        let scope: InstanceScope;
        if (parent) {
            scope = parent.scope;
            this._context$ = null;
        } else {
            const { key, context } = root!;
            const context$ = writable(`${key}/context$`, context);
            this._context$ = context$;
            scope = {
                key,
                rootName: record.name ?? "root",
                context$: derived(`${key}/context$`, () => context$()),
                bases: { generation: 0 },
            };
        }
        const key = nodeKey(scope, segments);
        const signal = <T>(member: string, fn: () => T, equals?: (a: T, b: T) => boolean) =>
            derived(`${key}/${member}`, fn, equals);
        const context$ = scope.context$;

        this.scope = scope;
        this.segments = segments;
        this.showErrors = record.showErrors ?? parent?.showErrors ?? "touched";
        this.path$ =
            parent && name !== null
                ? signal("path$", () => [...parent.path$(), parent.pathSegment(name)], shallowEqual)
                : signal("path$", () => ROOT_PATH);
        this._meta$ = writable(`${key}/meta$`, PRISTINE);
        this._server$ = writable(`${key}/server$`, NO_ISSUES);

        // ==================== Children ====================

        const children: Record<string, NodeCore> = {};
        const fields: Record<string, unknown> = {};
        for (const [childName, childRecord] of Object.entries(record.fields)) {
            const child = buildNode(childRecord, this, childName, childData(initial, childName));
            children[childName] = child;
            fields[childName] = child.node;
            fields[`${childName}$`] = (child.node as { state$: unknown }).state$;
        }
        this.children = Object.freeze(children);
        Object.freeze(fields);
        const childList = Object.entries(children);
        /** The children this level does not exclude, in definition order. */
        const enabledEntries = () => childList.filter(([childName]) => !this.isExcluded(childName));
        const enabled = () => enabledEntries().map(([, child]) => child);

        // ==================== disabled ====================

        const disabledCtx = Object.freeze({ fields, context$ });
        const excluded: Record<string, ReadonlySignal<Outcome<boolean>>> = {};
        for (const [childName, fn] of Object.entries(record.disabled)) {
            const where = memberPath(segments, `disabled.${childName}`);
            excluded[childName] = signal(
                `disabled.${childName}`,
                () => guard(() => Boolean(fn(disabledCtx)), where),
                outcomeEquals,
            );
        }
        this._excluded = Object.freeze(excluded);

        // ==================== Value ====================

        const value$ = signal(
            "value$",
            () => {
                const value: Record<string, unknown> = {};
                for (const [childName, child] of enabledEntries()) value[childName] = child.value$();
                return value;
            },
            shallowEqual,
        );
        const parsed$ = signal(
            "parsed$",
            (): Parsed<unknown> => {
                const value: Record<string, unknown> = {};
                for (const [childName, child] of enabledEntries()) {
                    const parsed = child.parsed$();
                    if (!parsed.isParsed) return NOT_PARSED;
                    value[childName] = parsed.value;
                }
                return { isParsed: true, value };
            },
            composedParsedEquals,
        );

        // ==================== computed, queries, rules ====================

        const callbacks: CallbackRun[] = [];
        const computed: Record<string, ReadonlySignal<unknown>> = {};
        const computedCtx = Object.freeze({ fields, value$, parsed$, context$ });
        for (const [computedName, fn] of Object.entries(record.computed)) {
            const where = memberPath(segments, `computed.${computedName}`);
            // The last successful value: the signal keeps it while the callback throws.
            let last: unknown = undefined;
            const run$ = signal(
                `computed.${computedName}`,
                () => {
                    const outcome = guard(() => fn(computedCtx), where);
                    if (outcome.ok) last = outcome.value;
                    return outcome;
                },
                outcomeEquals,
            );
            computed[`${computedName}$`] = signal(`computed.${computedName}$`, () => {
                const outcome = run$();
                return outcome.ok ? outcome.value : last;
            });
            callbacks.push({ name: `computed.${computedName}`, run$ });
        }
        Object.freeze(computed);

        const queries = createQueries(this, record.queries, Object.freeze({ ...computedCtx, computed }));
        this.rules = record.rules.map((rule) =>
            createRule(this, rule, { fields, value$, parsed$, computed, queries: queries.views, context$ }),
        );
        const submit = parent
            ? null
            : new SubmitController(
                  this,
                  record,
                  Object.freeze({ fields, value$, parsed$, computed, queries: queries.views, context$ }),
              );
        this._submit = submit;
        const disabledRuns = Object.entries(excluded).map(([childName, run$]) => ({
            name: `disabled.${childName}`,
            run$,
        }));

        // ==================== Issues ====================

        const collectCallbacks = (runs: readonly CallbackRun[], path: IssuePath, out: Issue[]) => {
            for (const { name: member, run$ } of runs) {
                const outcome = run$();
                if (!outcome.ok) out.push(callbackIssue(this, path, member, outcome.error));
            }
        };
        const ownIssues$ = signal(
            "ownIssues$",
            () => {
                const path = this.path$();
                const out: Issue[] = [];
                collectRuleIssues(this, path, out);
                collectCallbacks(callbacks, path, out);
                queries.collectIssues(path, out);
                collectCallbacks(disabledRuns, path, out);
                out.push(...this._server$());
                if (submit) out.push(...submit.issues$());
                return out;
            },
            deepEqual,
        );
        const issues$ = signal(
            "issues$",
            () => {
                const out = [...ownIssues$()];
                for (const child of enabled()) out.push(...child.issues$());
                return out;
            },
            deepEqual,
        );
        const errors$ = signal("errors$", () => withSeverity(issues$(), "error"), shallowEqual);
        const warnings$ = signal("warnings$", () => withSeverity(issues$(), "warning"), shallowEqual);
        const ownErrors$ = signal("ownErrors", () => withSeverity(ownIssues$(), "error"), shallowEqual);
        const ownWarnings$ = signal("ownWarnings", () => withSeverity(ownIssues$(), "warning"), shallowEqual);

        // ==================== Flags ====================

        const anyEnabled = (read: (child: NodeCore) => boolean) => enabled().some(read);
        this.isTouched$ = signal("isTouched$", () => this._meta$().isTouched || anyEnabled((c) => c.isTouched$()));
        this.isSubmitted$ = signal(
            "isSubmitted$",
            () => this._meta$().isSubmitted || anyEnabled((c) => c.isSubmitted$()),
        );
        this.isModified$ = signal("isModified$", () => anyEnabled((c) => c.isModified$()));
        this.isDirty$ = signal("isDirty$", () => anyEnabled((c) => c.isDirty$()));
        // No short circuit: one read activates the queries of every enabled descendant at once.
        this.isPending$ = signal("isPending$", () => {
            let isPending = queries.isPending();
            for (const child of enabled()) isPending = child.isPending$() || isPending;
            return isPending;
        });
        this.isValid$ = signal(
            "isValid$",
            () => ownErrors$().length === 0 && enabled().every((child) => child.isValid$()),
        );
        this.isDisabled$ =
            parent && name !== null
                ? signal("isDisabled$", () => parent.isDisabled$() || parent.isExcluded(name))
                : signal("isDisabled$", () => false);

        const visible = (own$: ReadonlySignal<Issue[]>, read: (child: NodeCore) => Issue[]) => () => {
            const out = isShown(this.showErrors, this) ? [...own$()] : [];
            for (const child of enabled()) out.push(...read(child));
            return out;
        };
        this.visibleErrors$ = signal(
            "visibleErrors$",
            visible(ownErrors$, (c) => c.visibleErrors$()),
            shallowEqual,
        );
        this.visibleWarnings$ = signal(
            "visibleWarnings$",
            visible(ownWarnings$, (c) => c.visibleWarnings$()),
            shallowEqual,
        );
        this.value$ = value$;
        this.parsed$ = parsed$;
        this.issues$ = issues$;

        // ==================== Public node ====================

        const groupState = (): GroupState => {
            const visibleErrors = this.visibleErrors$();
            return {
                isValid: this.isValid$(),
                isPending: this.isPending$(),
                isTouched: this.isTouched$(),
                isModified: this.isModified$(),
                isDirty: this.isDirty$(),
                hasVisibleErrors: visibleErrors.length > 0,
                visibleErrorCount: visibleErrors.length,
                isDisabled: this.isDisabled$(),
            };
        };

        const members = {
            fields,
            value$,
            parsed$,
            computed,
            queries: queries.nodes,
            ownIssues$,
            issues$,
            errors$,
            warnings$,
            visibleErrors$: this.visibleErrors$,
            visibleWarnings$: this.visibleWarnings$,
            isValid$: this.isValid$,
            isPending$: this.isPending$,
            isTouched$: this.isTouched$,
            isModified$: this.isModified$,
            isDirty$: this.isDirty$,
            isDisabled$: this.isDisabled$,
            markTouched: action((touched?: boolean) => this.markTouched(touched === undefined ? true : !!touched)),
            reset: action(() => this.reset()),
            initialize: action((data?: unknown, options?: InitializeOptions) => this._initialize(data, options)),
            // A list item is named by its key.
            ...(parent?.kind === "list" ? { key: name } : null),
        };

        if (!submit) {
            this.node = Object.freeze({ ...members, state$: signal("state$", groupState, shallowEqual) });
        } else {
            const state$ = signal(
                "state$",
                (): FormState => ({
                    ...groupState(),
                    status: submit.status$(),
                    isSubmitting: submit.isSubmitting$(),
                    submitCount: submit.submitCount$(),
                    canSubmit: submit.canSubmit$(),
                }),
                shallowEqual,
            );
            const node = {
                ...members,
                state$,
                context$,
                submission$: submit.submission$,
                isSubmitting$: submit.isSubmitting$,
                status$: submit.status$,
                submitAttempts$: submit.submitAttempts$,
                submitCount$: submit.submitCount$,
                canSubmit$: submit.canSubmit$,
                get entryKey(): string {
                    return submit.entryKey;
                },
                submit: (options?: { force?: boolean }) => submit.submit(options),
                clearIssues: action(() => this.clearServerIssues()),
            };
            if (record.instanceMembers) Object.defineProperties(node, record.instanceMembers(node));
            this.node = Object.freeze(node);
        }
        registerNode(this);
    }

    isExcluded(name: string): boolean {
        if (!Object.prototype.hasOwnProperty.call(this._excluded, name)) return false;
        const outcome = this._excluded[name]();
        return outcome.ok && outcome.value;
    }

    pathSegment(name: string): string {
        return name;
    }

    reset(): void {
        this._clearOwn();
        for (const child of Object.values(this.children)) child.reset();
        this._submit?.reset();
    }

    markTouched(touched: boolean): void {
        this._patchMeta({ isTouched: touched });
        for (const child of Object.values(this.children)) child.markTouched(touched);
    }

    markSubmitted(): void {
        this._patchMeta({ isSubmitted: true });
        for (const child of Object.values(this.children)) child.markSubmitted();
    }

    /** Own meta and server issues follow the group's reinit; each child follows its own data. */
    reinit(data: unknown, options: ReinitOptions): void {
        if (data === ABSENT) return;
        this._clearOwn();
        for (const [childName, child] of Object.entries(this.children)) {
            child.reinit(childData(data, childName), options);
        }
    }

    snapshot(): GroupSnapshot {
        const children = new Map<string, AttemptSnapshot>();
        for (const [childName, child] of Object.entries(this.children)) {
            if (!this.isExcluded(childName)) children.set(childName, child.snapshot());
        }
        return { kind: "group", core: this, children };
    }

    /** `_commit()` of the sent children. */
    commit(snapshot: GroupSnapshot): void {
        for (const child of snapshot.children.values()) commitSnapshot(child);
    }

    addServerIssues(issues: readonly Issue[]): void {
        if (issues.length) this._server$.set([...this._server$.peek(), ...issues]);
    }

    clearServerIssues(): void {
        this._server$.set(NO_ISSUES);
        for (const child of Object.values(this.children)) child.clearServerIssues();
    }

    /**
     * `initialize(data?, options?)`. Values are reinitialized from `data.state`, or from the
     * defaults when neither `state` nor (at the root) `context` is given. `context` alone changes
     * only the context. The submit state is reset with the values, unless `keepDirtyValues`.
     */
    private _initialize(data: unknown, options: InitializeOptions | undefined): void {
        const keepDirtyValues = options?.keepDirtyValues === true;
        const keepDirtyLists =
            options?.keepDirtyLists === undefined ? keepDirtyValues : options.keepDirtyLists === true;
        const hasState = isProvided(data, "state");
        const hasContext = this._context$ !== null && isProvided(data, "context");
        if (hasContext) this._context$!.set((data as { context: unknown }).context);
        if (!hasState && hasContext) return;
        this.scope.bases.generation++;
        this.reinit(hasState ? (data as { state: unknown }).state : DEFAULTS, { keepDirtyValues, keepDirtyLists });
        if (!keepDirtyValues) this._submit?.reset();
    }

    private _clearOwn(): void {
        this._patchMeta({ isTouched: false, isSubmitted: false });
        this._server$.set(NO_ISSUES);
    }

    private _patchMeta(patch: Partial<GroupMeta>): void {
        const meta = this._meta$.peek();
        const next = { ...meta, ...patch };
        if (!shallowEqual(meta, next)) this._meta$.set(next);
    }
}
