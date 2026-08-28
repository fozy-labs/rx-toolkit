/**
 * Statement tree + directives → `ParseResult` (Contract: config JSON / ParseResult).
 *
 * Ownership of states follows mermaid 11.17.2 exactly (verified against
 * `getData()` of the pinned version): a state is drawn inside the block
 * (`state X { }` body or a `--` region) that mentions it — as a transition
 * end, a declaration or a note target; mentions at the root never place a
 * state. A state mentioned inside two different blocks is a duplicate id
 * (mermaid would silently keep only the last block), and a state mentioned
 * inside its own block is a cycle; both are errors.
 */
import { StatechartParseError } from "../StatechartParseError.js";
import {
    type DelayedTransitionListJson,
    type DirectiveBody,
    type MachineConfigJson,
    type ParseResult,
    type StateInfo,
    type StateNodeJson,
    type SystemTriggerMarker,
    type TransitionJson,
    type TransitionListJson,
    type TransitionObjectJson,
} from "../types.js";

import {
    type BlockStatement,
    type Diagram,
    type InitialStatement,
    type Statement,
    type TransitionStatement,
} from "./diagram.js";
import { type BodySource, type DirectiveSet } from "./directives.js";
import { parseLabel, type TransitionLabel } from "./label.js";

const FINAL_KEY = "$final";

// --- scopes ----------------------------------------------------------------

interface RootScope {
    kind: "root";
}

interface BodyScope {
    kind: "body";
    stateId: string;
}

interface RegionScope {
    kind: "region";
    stateId: string;
    index: number;
}

type Scope = RootScope | BodyScope | RegionScope;

interface Mention {
    scope: Scope;
    line: number;
    column: number;
}

interface ScopeRecord {
    scope: Scope;
    /** Human-readable name for messages. */
    label: string;
    /** Path of the scope as written in the diagram (for messages raised before ownership is final). */
    lexicalPath: string;
    line: number;
    /** State ids in first-mention order within this scope. */
    mentions: string[];
    initials: InitialStatement[];
    hasFinal: boolean;
}

interface BlockRecord {
    statement: BlockStatement;
    bodyScope: BodyScope;
    regionScopes: RegionScope[];
}

interface StateRecord {
    id: string;
    /** The (single) non-root scope mentioning the state — its owner. */
    owner: Mention | null;
    rootMention: Mention | null;
    description: { text: string; line: number } | null;
    choice: { line: number } | null;
    block: BlockRecord | null;
}

interface PendingTransition {
    statement: TransitionStatement;
    scope: Scope;
}

interface NodeLists {
    on: Map<string, TransitionJson[]>;
    after: Map<string, TransitionJson[]>;
    always: TransitionJson[];
    onDone: TransitionJson[];
}

function scopeKey(scope: Scope): string {
    switch (scope.kind) {
        case "root":
            return "root";
        case "body":
            return `body:${scope.stateId}`;
        case "region":
            return `region:${scope.stateId}:${scope.index}`;
    }
}

function toBody(body: BodySource): DirectiveBody {
    return { text: body.text, line: body.line };
}

function bodies(table: Map<string, BodySource>): Record<string, DirectiveBody> {
    const result: Record<string, DirectiveBody> = {};
    for (const [name, body] of table) result[name] = toBody(body);
    return result;
}

function pushUnique<T>(list: T[], value: T): void {
    if (!list.includes(value)) list.push(value);
}

class Builder {
    private readonly states = new Map<string, StateRecord>();
    private readonly scopes = new Map<string, ScopeRecord>();
    private readonly transitions: PendingTransition[] = [];
    private readonly rootScope: RootScope = { kind: "root" };
    private readonly paths = new Map<string, string>();
    private readonly resolving = new Set<string>();
    private readonly nodes = new Map<string, StateNodeJson>();
    private readonly lists = new Map<StateNodeJson, NodeLists>();
    /** Config path → source line of the mention that places the state (`StateInfo.line`). */
    private readonly stateLines = new Map<string, number>();
    private readonly eventTypes: string[] = [];
    private readonly guardReferences: Record<string, Array<string | SystemTriggerMarker>> = {};
    private readonly actionReferences: Record<string, Array<string | SystemTriggerMarker>> = {};
    private readonly machineId: string;

    constructor(
        private readonly diagram: Diagram,
        private readonly directives: DirectiveSet,
        private readonly source: string,
    ) {
        if (directives.machine === null) {
            throw new StatechartParseError("missing `%% @machine <id>` directive", { line: diagram.headerLine });
        }
        this.machineId = directives.machine.id;
    }

    build(): ParseResult {
        this.scopes.set(scopeKey(this.rootScope), {
            scope: this.rootScope,
            label: "the root of the diagram",
            lexicalPath: "",
            line: this.diagram.headerLine,
            mentions: [],
            initials: [],
            hasFinal: false,
        });
        this.collect(this.diagram.statements, this.rootScope, "");
        for (const id of this.states.keys()) this.pathOf(id);

        const rootRecord = this.record(this.rootScope);
        const initial = this.requireInitial(rootRecord);
        const states = this.buildStates(rootRecord);
        for (const pending of this.transitions) this.applyTransition(pending);
        this.finalizeNodes();
        this.checkUnusedEvents();

        const config: MachineConfigJson = { id: this.machineId, source: this.source, initial, states };
        return {
            machineId: this.machineId,
            config,
            context: {
                ...(this.directives.contextType === null ? {} : { type: this.directives.contextType.text }),
                ...(this.directives.contextInitial === null ? {} : { initial: toBody(this.directives.contextInitial) }),
            },
            events: Object.fromEntries([...this.directives.events].map(([name, body]) => [name, body.text])),
            eventTypes: this.eventTypes,
            guards: bodies(this.directives.guards),
            actions: bodies(this.directives.actions),
            delays: bodies(this.directives.delays),
            references: { guards: this.guardReferences, actions: this.actionReferences },
            states: this.listStates(states, "", undefined),
        };
    }

    // --- pass 1: mentions, declarations, scopes ------------------------------

    private record(scope: Scope): ScopeRecord {
        return this.scopes.get(scopeKey(scope))!;
    }

    private state(id: string): StateRecord {
        let record = this.states.get(id);
        if (record === undefined) {
            record = { id, owner: null, rootMention: null, description: null, choice: null, block: null };
            this.states.set(id, record);
        }
        return record;
    }

    private mention(id: string, scope: Scope, line: number, column: number): StateRecord {
        const state = this.state(id);
        const record = this.record(scope);
        pushUnique(record.mentions, id);
        if (scope.kind === "root") {
            if (state.rootMention === null) state.rootMention = { scope, line, column };
            return state;
        }
        if (state.owner !== null && scopeKey(state.owner.scope) !== scopeKey(scope)) {
            const first = this.record(state.owner.scope);
            throw new StatechartParseError(
                `duplicate state id ${JSON.stringify(id)}: used inside ${first.label} (line ${state.owner.line}) and inside ${record.label}; mermaid draws a state inside the last block that mentions it, so a state id may appear inside at most one block`,
                { line, column, path: record.lexicalPath },
            );
        }
        if (state.owner === null) state.owner = { scope, line, column };
        return state;
    }

    private collect(statements: Statement[], scope: Scope, lexicalPath: string): void {
        const record = this.record(scope);
        for (const statement of statements) {
            switch (statement.kind) {
                case "initial":
                    record.initials.push(statement);
                    this.mention(statement.target, scope, statement.line, statement.targetColumn);
                    break;
                case "transition":
                    this.mention(statement.source, scope, statement.line, statement.sourceColumn);
                    if (statement.target === null) record.hasFinal = true;
                    else this.mention(statement.target, scope, statement.line, statement.targetColumn);
                    this.transitions.push({ statement, scope });
                    break;
                case "description":
                    this.declareDescription(
                        this.mention(statement.id, scope, statement.line, statement.idColumn),
                        statement.description,
                        statement.line,
                        statement.idColumn,
                        lexicalPath,
                    );
                    break;
                case "choice": {
                    const state = this.mention(statement.id, scope, statement.line, statement.idColumn);
                    if (state.choice !== null) {
                        throw new StatechartParseError(
                            `duplicate \`state ${statement.id} <<choice>>\` (first declared at line ${state.choice.line})`,
                            { line: statement.line, column: statement.idColumn, path: lexicalPath },
                        );
                    }
                    state.choice = { line: statement.line };
                    break;
                }
                case "block":
                    this.collectBlock(statement, scope, lexicalPath);
                    break;
                case "note":
                case "declaration":
                    this.mention(statement.id, scope, statement.line, statement.idColumn);
                    break;
                case "ignored":
                    break;
            }
        }
    }

    private declareDescription(
        state: StateRecord,
        text: string,
        line: number,
        column: number,
        lexicalPath: string,
    ): void {
        if (state.description !== null) {
            throw new StatechartParseError(
                `duplicate description of state ${JSON.stringify(state.id)} (first declared at line ${state.description.line})`,
                { line, column, path: lexicalPath },
            );
        }
        state.description = { text, line };
    }

    private collectBlock(statement: BlockStatement, scope: Scope, lexicalPath: string): void {
        const state = this.mention(statement.id, scope, statement.line, statement.idColumn);
        const blockPath = lexicalPath === "" ? statement.id : `${lexicalPath}.${statement.id}`;
        if (state.block !== null) {
            throw new StatechartParseError(
                `duplicate block \`state ${statement.id} {\` (first opened at line ${state.block.statement.line})`,
                { line: statement.line, column: statement.idColumn, path: blockPath },
            );
        }
        if (statement.description !== null) {
            this.declareDescription(state, statement.description, statement.line, statement.idColumn, lexicalPath);
        }
        const bodyScope: BodyScope = { kind: "body", stateId: statement.id };
        const regionScopes: RegionScope[] = [];
        state.block = { statement, bodyScope, regionScopes };

        if (statement.hasDividers) {
            statement.regions.forEach((regionStatements, index) => {
                const regionScope: RegionScope = { kind: "region", stateId: statement.id, index };
                regionScopes.push(regionScope);
                const regionPath = `${blockPath}.$${index}`;
                this.scopes.set(scopeKey(regionScope), {
                    scope: regionScope,
                    label: `region $${index} of state \`${statement.id}\``,
                    lexicalPath: regionPath,
                    line: statement.line,
                    mentions: [],
                    initials: [],
                    hasFinal: false,
                });
                this.collect(regionStatements, regionScope, regionPath);
            });
            return;
        }
        this.scopes.set(scopeKey(bodyScope), {
            scope: bodyScope,
            label: `state \`${statement.id}\``,
            lexicalPath: blockPath,
            line: statement.line,
            mentions: [],
            initials: [],
            hasFinal: false,
        });
        this.collect(statement.regions[0]!, bodyScope, blockPath);
    }

    // --- pass 2: ownership → paths ------------------------------------------

    private ownerScope(id: string): Scope {
        return this.states.get(id)!.owner?.scope ?? this.rootScope;
    }

    private pathOf(id: string): string {
        const known = this.paths.get(id);
        if (known !== undefined) return known;
        const state = this.states.get(id)!;
        if (this.resolving.has(id)) {
            const owner = state.owner!;
            throw new StatechartParseError(
                `state ${JSON.stringify(id)} is used inside its own block (${this.record(owner.scope).label})`,
                { line: owner.line, column: owner.column, path: this.record(owner.scope).lexicalPath },
            );
        }
        this.resolving.add(id);
        const scope = this.ownerScope(id);
        const scopePath = this.scopePath(scope);
        const path = scopePath === "" ? id : `${scopePath}.${id}`;
        this.resolving.delete(id);
        this.paths.set(id, path);
        return path;
    }

    private scopePath(scope: Scope): string {
        switch (scope.kind) {
            case "root":
                return "";
            case "body":
                return this.pathOf(scope.stateId);
            case "region":
                return `${this.pathOf(scope.stateId)}.$${scope.index}`;
        }
    }

    // --- pass 3: config nodes ------------------------------------------------

    private childrenOf(record: ScopeRecord): string[] {
        const key = scopeKey(record.scope);
        return record.mentions.filter((id) => scopeKey(this.ownerScope(id)) === key);
    }

    private requireInitial(record: ScopeRecord): string {
        const path = this.scopePath(record.scope);
        if (record.initials.length === 0) {
            throw new StatechartParseError(`${record.label} has no initial state: add \`[*] --> <state>\``, {
                line: record.line,
                path,
            });
        }
        if (record.initials.length > 1) {
            const second = record.initials[1]!;
            throw new StatechartParseError(
                `${record.label} has more than one initial state (first \`[*] -->\` at line ${record.initials[0]!.line})`,
                { line: second.line, column: second.targetColumn, path },
            );
        }
        const initial = record.initials[0]!;
        const owner = this.ownerScope(initial.target);
        if (scopeKey(owner) !== scopeKey(record.scope)) {
            const ownerRecord = this.record(owner);
            const state = this.states.get(initial.target)!;
            throw new StatechartParseError(
                `initial state ${JSON.stringify(initial.target)} of ${record.label} is drawn inside ${ownerRecord.label} (mentioned there at line ${state.owner!.line})`,
                { line: initial.line, column: initial.targetColumn, path },
            );
        }
        return initial.target;
    }

    private buildStates(record: ScopeRecord): Record<string, StateNodeJson> {
        const states: Record<string, StateNodeJson> = {};
        for (const id of this.childrenOf(record)) states[id] = this.buildState(id);
        if (record.hasFinal) {
            const node: StateNodeJson = { type: "final" };
            states[FINAL_KEY] = node;
            this.registerNode(this.finalPath(record.scope), node);
        }
        return states;
    }

    private buildState(id: string): StateNodeJson {
        const state = this.states.get(id)!;
        const node: StateNodeJson = {};
        const path = this.pathOf(id);
        this.registerNode(path, node);
        // Every state has at least one mention (that is how it was created).
        this.stateLines.set(path, (state.owner ?? state.rootMention!).line);
        if (state.description !== null) node.description = state.description.text;
        if (state.block === null) return node;

        if (state.choice !== null) {
            throw new StatechartParseError(`choice state ${JSON.stringify(id)} cannot have a block`, {
                line: state.block.statement.line,
                column: state.block.statement.idColumn,
                path: this.pathOf(id),
            });
        }
        if (state.block.statement.hasDividers) {
            node.type = "parallel";
            node.states = {};
            for (const regionScope of state.block.regionScopes) {
                const record = this.record(regionScope);
                node.states[`$${regionScope.index}`] = this.buildRegion(record);
            }
            return node;
        }
        const record = this.record(state.block.bodyScope);
        node.initial = this.requireInitial(record);
        node.states = this.buildStates(record);
        return node;
    }

    private buildRegion(record: ScopeRecord): StateNodeJson {
        const node: StateNodeJson = {};
        const path = this.scopePath(record.scope);
        this.registerNode(path, node);
        this.stateLines.set(path, record.line);
        node.initial = this.requireInitial(record);
        node.states = this.buildStates(record);
        return node;
    }

    private registerNode(path: string, node: StateNodeJson): void {
        this.nodes.set(path, node);
        this.lists.set(node, { on: new Map(), after: new Map(), always: [], onDone: [] });
    }

    private finalPath(scope: Scope): string {
        const scopePath = this.scopePath(scope);
        return scopePath === "" ? FINAL_KEY : `${scopePath}.${FINAL_KEY}`;
    }

    // --- transitions ---------------------------------------------------------

    private applyTransition({ statement, scope }: PendingTransition): void {
        const source = this.states.get(statement.source)!;
        const sourceNode = this.nodes.get(this.pathOf(statement.source))!;
        const sourcePath = this.pathOf(statement.source);
        const label: TransitionLabel =
            statement.label === null
                ? { trigger: null, guard: null, actions: [] }
                : parseLabel(statement.label, statement.line, statement.labelColumn);

        let targetPath: string;
        let sibling: boolean;
        if (statement.target === null) {
            targetPath = this.finalPath(scope);
            sibling = scopeKey(this.ownerScope(statement.source)) === scopeKey(scope);
        } else {
            targetPath = this.pathOf(statement.target);
            sibling = scopeKey(this.ownerScope(statement.target)) === scopeKey(this.ownerScope(statement.source));
        }
        const target = sibling ? targetPath.slice(targetPath.lastIndexOf(".") + 1) : `#${this.machineId}.${targetPath}`;

        const { trigger } = label;
        if (source.choice !== null && trigger !== null) {
            throw new StatechartParseError(
                `transitions out of choice state ${JSON.stringify(statement.source)} must be eventless (\`${statement.source} --> X: [guard]\`)`,
                { line: statement.line, column: trigger.column, path: sourcePath },
            );
        }
        if (trigger?.kind === "done" && source.block === null) {
            throw new StatechartParseError(
                `\`done\` requires ${JSON.stringify(statement.source)} to be a compound or parallel state (\`state ${statement.source} { }\`)`,
                { line: statement.line, column: trigger.column, path: sourcePath },
            );
        }
        if (trigger?.kind === "after" && trigger.named && !this.directives.delays.has(trigger.delay)) {
            throw new StatechartParseError(
                `undeclared delay ${JSON.stringify(trigger.delay)}: add \`%% @delay ${trigger.delay}: <expression>\``,
                { line: statement.line, column: trigger.column, path: sourcePath },
            );
        }
        if (label.guard !== null && !this.directives.guards.has(label.guard.name)) {
            throw new StatechartParseError(
                `undeclared guard ${JSON.stringify(label.guard.name)}: add \`%% @guard ${label.guard.name}: <expression>\``,
                { line: statement.line, column: label.guard.column, path: sourcePath },
            );
        }
        for (const action of label.actions) {
            if (!this.directives.actions.has(action.name)) {
                throw new StatechartParseError(
                    `undeclared action ${JSON.stringify(action.name)}: add \`%% @action ${action.name}: <statements>\``,
                    { line: statement.line, column: action.column, path: sourcePath },
                );
            }
        }

        const transition: TransitionJson =
            label.guard === null && label.actions.length === 0
                ? target
                : {
                      target,
                      ...(label.guard === null ? {} : { guard: label.guard.name }),
                      ...(label.actions.length === 0 ? {} : { actions: label.actions.map((action) => action.name) }),
                  };

        const lists = this.lists.get(sourceNode)!;
        let marker: string | SystemTriggerMarker;
        if (trigger === null) {
            lists.always.push(transition);
            marker = "$always";
        } else if (trigger.kind === "event") {
            this.append(lists.on, trigger.name, transition);
            pushUnique(this.eventTypes, trigger.name);
            marker = trigger.name;
        } else if (trigger.kind === "after") {
            this.append(lists.after, trigger.delay, transition);
            marker = "$after";
        } else {
            lists.onDone.push(transition);
            marker = "$done";
        }
        if (label.guard !== null) this.reference(this.guardReferences, label.guard.name, marker);
        for (const action of label.actions) this.reference(this.actionReferences, action.name, marker);
    }

    private append(map: Map<string, TransitionJson[]>, key: string, transition: TransitionJson): void {
        const list = map.get(key);
        if (list === undefined) map.set(key, [transition]);
        else list.push(transition);
    }

    private reference(
        table: Record<string, Array<string | SystemTriggerMarker>>,
        name: string,
        marker: string | SystemTriggerMarker,
    ): void {
        const list = (table[name] ??= []);
        pushUnique(list, marker);
    }

    /** Collapses single-candidate lists and orders keys canonically (type, description, initial, on, after, always, onDone, states). */
    private finalizeNodes(): void {
        for (const [node, lists] of this.lists) {
            const ordered: StateNodeJson = {};
            if (node.type !== undefined) ordered.type = node.type;
            if (node.description !== undefined) ordered.description = node.description;
            if (node.initial !== undefined) ordered.initial = node.initial;
            if (lists.on.size > 0) ordered.on = this.collapseMap(lists.on);
            if (lists.after.size > 0) ordered.after = this.collapseDelayedMap(lists.after);
            if (lists.always.length > 0) ordered.always = this.collapse(lists.always);
            if (lists.onDone.length > 0) ordered.onDone = this.collapseDelayed(lists.onDone);
            if (node.states !== undefined) ordered.states = node.states;
            for (const key of Object.keys(node)) delete node[key as keyof StateNodeJson];
            Object.assign(node, ordered);
        }
    }

    private collapse(list: TransitionJson[]): TransitionListJson {
        return list.length === 1 ? list[0]! : list;
    }

    private collapseMap(map: Map<string, TransitionJson[]>): Record<string, TransitionListJson> {
        const result: Record<string, TransitionListJson> = {};
        for (const [key, list] of map) result[key] = this.collapse(list);
        return result;
    }

    /** `after` / `onDone`: `createMachine` rejects bare targets inside arrays there, so candidates become objects. */
    private collapseDelayed(list: TransitionJson[]): DelayedTransitionListJson {
        if (list.length === 1) return list[0]!;
        return list.map((transition): TransitionObjectJson =>
            typeof transition === "string" ? { target: transition } : transition,
        );
    }

    private collapseDelayedMap(map: Map<string, TransitionJson[]>): Record<string, DelayedTransitionListJson> {
        const result: Record<string, DelayedTransitionListJson> = {};
        for (const [key, list] of map) result[key] = this.collapseDelayed(list);
        return result;
    }

    private checkUnusedEvents(): void {
        for (const [name, body] of this.directives.events) {
            if (!this.eventTypes.includes(name)) {
                throw new StatechartParseError(
                    `event ${JSON.stringify(name)} is declared with @event but not used in any transition`,
                    { line: body.line },
                );
            }
        }
    }

    // --- states list ---------------------------------------------------------

    private listStates(
        states: Record<string, StateNodeJson>,
        parentPath: string,
        parentId: string | undefined,
    ): StateInfo[] {
        const result: StateInfo[] = [];
        for (const [key, node] of Object.entries(states)) {
            if (key === FINAL_KEY) continue;
            const path = parentPath === "" ? key : `${parentPath}.${key}`;
            const id = key.startsWith("$") ? `${parentId}.${key}` : key;
            const info: StateInfo = { id, path, line: this.stateLines.get(path)! };
            if (parentId !== undefined) info.parent = parentId;
            if (node.description !== undefined) info.description = node.description;
            result.push(info);
            if (node.states !== undefined) result.push(...this.listStates(node.states, path, id));
        }
        return result;
    }
}

export function buildParseResult(diagram: Diagram, directives: DirectiveSet, source: string): ParseResult {
    return new Builder(diagram, directives, source).build();
}
