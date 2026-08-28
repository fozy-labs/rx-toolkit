import { Signal, useConstant, useSignal, type StateSignal } from "@fozy-labs/rx-toolkit";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import svgPanZoom from "svg-pan-zoom";

import { collectOutgoingEvents, describeTarget, type OutgoingEvent } from "./core/configWalk";
import { indexDiagram, loadMermaid, nextSvgId, renderDiagram, type DiagramIndex } from "./core/mermaidGraph";
import { formatStateValue, projectActiveIds } from "./core/stateValue";
import {
    annotateSvg,
    applyHighlight,
    resolveClickTarget,
    type ClickTarget,
    type HighlightState,
} from "./core/svgIndex";
import { createSourceMachine, type SourceMachine } from "./playground/createSourceMachine";
import { BASE_CSS, diagramCss } from "./styles";
import type { DisposableVizMachine, StatechartVizProps, VizEvent, VizMachine, VizSnapshot } from "./types";

/**
 * Interactive mermaid view of a statechart. `machine` mode renders
 * `definition.source ?? definition.toMermaid()` and follows the running
 * machine; `source` mode runs the playground pipeline (see
 * `playground/createSourceMachine`).
 */
export function StatechartViz(props: StatechartVizProps) {
    if ("machine" in props) {
        const { machine } = props;
        const source = machine.definition.source ?? machine.definition.toMermaid();
        return <VizFrame machine={machine} source={source} title={props.title ?? machine.definition.id} />;
    }
    return <SourceViz source={props.source} title={props.title} onMachine={props.onMachine} />;
}

type SourceState =
    { phase: "loading" } | { phase: "ready"; machine: SourceMachine } | { phase: "error"; message: string };

type SourceVizProps = {
    source: string;
    title?: string;
    onMachine?: (machine: DisposableVizMachine | null) => void;
};

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * `source` mode: the pipeline runs once per source text, in an effect. The
 * machine lives as long as its text — a new text, an unmount (and StrictMode's
 * rehearsal) dispose it. Pipeline failures and runtime errors of bodies go to
 * the notice area.
 */
function SourceViz({ source, title, onMachine }: SourceVizProps) {
    const state$ = useConstant(() => Signal.state<SourceState>({ phase: "loading" }), [source]);
    const runtimeError$ = useConstant(() => Signal.state<string | null>(null), [source]);
    const onMachineRef = useRef(onMachine);
    useLayoutEffect(() => {
        onMachineRef.current = onMachine;
    });

    useEffect(() => {
        let cancelled = false;
        let machine: SourceMachine | null = null;
        createSourceMachine(source, {
            onError: (error) => runtimeError$.set(`Runtime error: ${messageOf(error)}`),
        }).then(
            (created) => {
                if (cancelled) {
                    created.dispose();
                    return;
                }
                machine = created;
                state$.set({ phase: "ready", machine: created });
                onMachineRef.current?.(created);
            },
            (error: unknown) => {
                if (!cancelled) state$.set({ phase: "error", message: messageOf(error) });
            },
        );
        return () => {
            cancelled = true;
            if (machine) {
                machine.dispose();
                onMachineRef.current?.(null);
            }
        };
    }, [source, state$, runtimeError$]);

    const state = useSignal(state$);
    const runtimeError = useSignal(runtimeError$);
    const machine = state.phase === "ready" ? state.machine : null;
    const notice = state.phase === "error" ? state.message : (runtimeError ?? undefined);
    return (
        <VizFrame
            machine={machine}
            source={source}
            title={title ?? machine?.definition.id ?? "statechart"}
            notice={notice}
        />
    );
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

export type LogEntry = {
    seq: number;
    time: string;
    event: VizEvent;
    from: string;
    to: string;
    /** `false` when `can(event)` was false and the event was not sent. */
    accepted: boolean;
};

type VizStore = {
    selected$: StateSignal<string | null>;
    log$: StateSignal<LogEntry[]>;
    payload$: StateSignal<string>;
};

const LOG_LIMIT = 200;

function createVizStore(): VizStore {
    return {
        selected$: Signal.state<string | null>(null),
        log$: Signal.state<LogEntry[]>([]),
        payload$: Signal.state<string>("{}"),
    };
}

type Payload = { ok: true; value: Record<string, unknown> } | { ok: false; error: string };

/** The payload field: empty → `{}`; otherwise a JSON object. */
export function parsePayload(text: string): Payload {
    if (text.trim() === "") return { ok: true, value: {} };
    try {
        const value: unknown = JSON.parse(text);
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
            return { ok: false, error: "payload must be a JSON object" };
        }
        return { ok: true, value: value as Record<string, unknown> };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

function useMachineSnapshot(machine: VizMachine | null): VizSnapshot | null {
    const signalLike = useMemo(
        () => (machine ? { obs: machine.obs, peek: () => machine() } : { obs: NEVER_SNAPSHOT.obs, peek: () => null }),
        [machine],
    );
    return useSignal(signalLike);
}

const NEVER_SNAPSHOT = Signal.state<VizSnapshot | null>(null);

type DiagramState =
    | { phase: "loading" }
    | { phase: "ready"; svgId: string; svg: string; index: DiagramIndex }
    | { phase: "error"; message: string };

/** Renders the source once (per source text) through mermaid. */
function useDiagram(source: string): DiagramState {
    const state$ = useConstant(() => Signal.state<DiagramState>({ phase: "loading" }), [source]);
    useEffect(() => {
        let cancelled = false;
        const svgId = nextSvgId();
        (async () => {
            const mermaid = await loadMermaid();
            const index = await indexDiagram(mermaid, source);
            const svg = await renderDiagram(mermaid, svgId, source);
            if (!cancelled) state$.set({ phase: "ready", svgId, svg, index });
        })().catch((error: unknown) => {
            if (!cancelled)
                state$.set({ phase: "error", message: error instanceof Error ? error.message : String(error) });
        });
        return () => {
            cancelled = true;
        };
    }, [source, state$]);
    return useSignal(state$);
}

function timeStamp(): string {
    return new Date().toISOString().slice(11, 23);
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

type VizFrameProps = {
    machine: VizMachine | null;
    source: string;
    title: string;
    notice?: string;
};

function VizFrame({ machine, source, title, notice }: VizFrameProps) {
    const store = useConstant(createVizStore, [machine]);
    const snapshot = useMachineSnapshot(machine);
    const selectedId = useSignal(store.selected$);
    const log = useSignal(store.log$);
    const payloadText = useSignal(store.payload$);
    const diagram = useDiagram(source);

    const payload = parsePayload(payloadText);
    const activeIds = snapshot ? projectActiveIds(snapshot.value) : new Set<string>();
    const canSend = (type: string): boolean =>
        machine !== null && payload.ok && machine.can({ type, ...payload.value });

    const enabledEdges = new Set<number>();
    if (diagram.phase === "ready" && machine) {
        for (const edge of diagram.index.edges) {
            if (edge.label.trigger.kind !== "event" || !activeIds.has(edge.start)) continue;
            if (canSend(edge.label.trigger.event)) enabledEdges.add(edge.index);
        }
    }

    const sendEvent = (type: string) => {
        if (!machine || !payload.ok) return;
        const event: VizEvent = { ...payload.value, type };
        const from = formatStateValue(machine().value);
        const accepted = machine.can(event);
        if (accepted) machine.send(event);
        const to = formatStateValue(machine().value);
        store.log$.update((entries) => {
            const seq = (entries[0]?.seq ?? 0) + 1;
            return [{ seq, time: timeStamp(), event, from, to, accepted }, ...entries].slice(0, LOG_LIMIT);
        });
    };

    const onDiagramClick = (target: ClickTarget) => {
        if (target.kind === "state") {
            store.selected$.update((current) => (current === target.id ? null : target.id));
            return;
        }
        if (diagram.phase !== "ready" || !enabledEdges.has(target.index)) return;
        const edge = diagram.index.edges[target.index];
        if (edge?.label.trigger.kind === "event") sendEvent(edge.label.trigger.event);
    };

    const outgoing = machine && selectedId ? collectOutgoingEvents(machine.definition.config, selectedId) : [];

    return (
        <div className="scv" data-scv-root="">
            <style>{BASE_CSS}</style>
            <header className="scv-header">
                <h2 className="scv-title">{title}</h2>
                {snapshot && (
                    <>
                        <span className="scv-status" data-scv-status={snapshot.status}>
                            {snapshot.status}
                        </span>
                        <span className="scv-value" data-scv-value="">
                            {formatStateValue(snapshot.value)}
                        </span>
                    </>
                )}
            </header>
            <div className="scv-body">
                <DiagramPanel
                    diagram={diagram}
                    highlight={{ activeIds, selectedId, enabledEdges }}
                    onClick={onDiagramClick}
                />
                <aside className="scv-side">
                    {notice && (
                        <section className="scv-panel">
                            <h3 className="scv-panel-title">Source mode</h3>
                            <p className="scv-notice" data-scv-notice="">
                                {notice}
                            </p>
                        </section>
                    )}
                    <EventsPanel
                        machineId={machine?.definition.id ?? ""}
                        selectedId={selectedId}
                        outgoing={outgoing}
                        canSend={canSend}
                        onSend={sendEvent}
                        payloadText={payloadText}
                        payload={payload}
                        onPayloadChange={(text) => store.payload$.set(text)}
                    />
                    <LogPanel entries={log} />
                    <ContextPanel snapshot={snapshot} />
                </aside>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

type DiagramPanelProps = {
    diagram: DiagramState;
    highlight: HighlightState;
    onClick: (target: ClickTarget) => void;
};

function DiagramPanel({ diagram, highlight, onClick }: DiagramPanelProps) {
    const hostRef = useRef<HTMLDivElement>(null);
    const svgRef = useRef<SVGSVGElement | null>(null);
    const onClickRef = useRef(onClick);
    useLayoutEffect(() => {
        onClickRef.current = onClick;
    });

    useLayoutEffect(() => {
        const host = hostRef.current;
        if (!host || diagram.phase !== "ready") return;
        host.innerHTML = diagram.svg;
        const svg = host.querySelector("svg");
        if (!svg) return;
        // Mermaid sizes the svg for a document flow; the panel owns the size.
        svg.removeAttribute("height");
        svg.style.maxWidth = "";
        svg.style.width = "100%";
        svg.style.height = "100%";
        annotateSvg(svg, diagram.svgId, diagram.index);
        svgRef.current = svg;

        const panZoom = svgPanZoom(svg, {
            controlIconsEnabled: true,
            fit: true,
            center: true,
            minZoom: 0.1,
            maxZoom: 20,
            zoomScaleSensitivity: 0.25,
            dblClickZoomEnabled: false,
        });
        const handleClick = (event: MouseEvent) => {
            const target = resolveClickTarget(event.target);
            if (target) onClickRef.current(target);
        };
        svg.addEventListener("click", handleClick);
        return () => {
            svg.removeEventListener("click", handleClick);
            panZoom.destroy();
            svgRef.current = null;
            host.innerHTML = "";
        };
    }, [diagram]);

    useLayoutEffect(() => {
        if (svgRef.current) applyHighlight(svgRef.current, highlight);
    });

    return (
        <div className="scv-diagram" data-scv-diagram={diagram.phase}>
            {diagram.phase === "ready" && <style>{diagramCss(diagram.svgId)}</style>}
            <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
            {diagram.phase === "loading" && <div className="scv-message">Rendering diagram…</div>}
            {diagram.phase === "error" && <div className="scv-message scv-error">{diagram.message}</div>}
        </div>
    );
}

type EventsPanelProps = {
    machineId: string;
    selectedId: string | null;
    outgoing: OutgoingEvent[];
    canSend: (type: string) => boolean;
    onSend: (type: string) => void;
    payloadText: string;
    payload: Payload;
    onPayloadChange: (text: string) => void;
};

function EventsPanel(props: EventsPanelProps) {
    const { machineId, selectedId, outgoing, canSend, onSend, payloadText, payload, onPayloadChange } = props;
    return (
        <section className="scv-panel" data-scv-events="">
            <h3 className="scv-panel-title">Events{selectedId ? ` · ${selectedId}` : ""}</h3>
            {selectedId === null ? (
                <p className="scv-hint">Click a state to list its events; click an enabled transition to send it.</p>
            ) : outgoing.length === 0 ? (
                <p className="scv-hint">No event transitions from this state.</p>
            ) : (
                <div className="scv-events">
                    {outgoing.map((item) => (
                        <button
                            key={item.event}
                            type="button"
                            className="scv-event"
                            data-scv-event={item.event}
                            disabled={!canSend(item.event)}
                            title={describeTransitions(item, machineId)}
                            onClick={() => onSend(item.event)}
                        >
                            {item.event}
                        </button>
                    ))}
                </div>
            )}
            <label className="scv-payload-label">
                Payload (JSON object, merged into the event)
                <textarea
                    className="scv-payload"
                    data-scv-payload=""
                    rows={2}
                    value={payloadText}
                    onChange={(event) => onPayloadChange(event.target.value)}
                    spellCheck={false}
                />
            </label>
            {!payload.ok && <p className="scv-payload-error">{payload.error}</p>}
        </section>
    );
}

function describeTransitions(item: OutgoingEvent, machineId: string): string {
    const lines = item.transitions.map((t) => {
        const guard = t.guard ? ` [${t.guard}]` : "";
        const actions = t.actions.length ? ` / ${t.actions.join(", ")}` : "";
        return `→ ${describeTarget(t.target, machineId)}${guard}${actions}`;
    });
    return `${item.event} (from ${item.definedBy})\n${lines.join("\n")}`;
}

function LogPanel({ entries }: { entries: LogEntry[] }) {
    return (
        <section className="scv-panel" data-scv-log="">
            <h3 className="scv-panel-title">Event log</h3>
            {entries.length === 0 ? (
                <p className="scv-hint">No events sent yet.</p>
            ) : (
                <ol className="scv-log">
                    {entries.map((entry) => (
                        <li key={entry.seq} className={entry.accepted ? undefined : "scv-rejected"}>
                            <time>{entry.time}</time>
                            <span>
                                {formatEvent(entry.event)} {entry.from} → {entry.to}
                            </span>
                        </li>
                    ))}
                </ol>
            )}
        </section>
    );
}

function formatEvent(event: VizEvent): string {
    const { type, ...rest } = event;
    return Object.keys(rest).length === 0 ? type : `${type} ${safeStringify(rest)}`;
}

function ContextPanel({ snapshot }: { snapshot: VizSnapshot | null }) {
    return (
        <section className="scv-panel" data-scv-context="">
            <h3 className="scv-panel-title">Context</h3>
            {snapshot ? (
                <pre className="scv-context">{safeStringify(snapshot.context, 2)}</pre>
            ) : (
                <p className="scv-hint">No running machine.</p>
            )}
        </section>
    );
}

function safeStringify(value: unknown, indent = 0): string {
    try {
        return JSON.stringify(value, null, indent) ?? String(value);
    } catch {
        return String(value);
    }
}
