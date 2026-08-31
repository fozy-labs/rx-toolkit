/**
 * Dependency-free adapter to the Stately Inspector (https://stately.ai/inspect),
 * mirroring the wire protocol of `@statelyai/inspect@0.7.2`
 * (`createBrowserInspector` + `BrowserAdapter` + `createInspector`). Spec: section 5.
 *
 * SSR-safe: nothing here touches `window` at import time, and without a host
 * window (and without a custom adapter) the inspector is a silent no-op.
 */
import type {
    MachineDevtoolsActor,
    MachineDevtoolsActorInfo,
    MachineDevtoolsEvent,
    MachineDevtoolsLike,
    MachineDevtoolsSnapshot,
} from "./types";

/** `_version` field of every inspection event (protocol version of `@statelyai/inspect`). */
export const STATELY_INSPECT_PROTOCOL_VERSION = "0.7.2";

export const STATELY_INSPECT_DEFAULT_URL = "https://stately.ai/inspect";

/** Name of the popup opened by `window.open`; the inspector page identifies itself by it. */
export const STATELY_INSPECT_WINDOW_NAME = "xstateinspector";

/** Sent by the inspector page once it listens; events are buffered until then. */
export const STATELY_CONNECTED_MESSAGE_TYPE = "@statelyai.connected";
export const STATELY_DISCONNECTED_MESSAGE_TYPE = "@statelyai.disconnected";

const DEFAULT_MAX_DEFERRED_EVENTS = 200;

interface StatelyInspectionEventBase {
    readonly _version: string;
    readonly sessionId: string;
    /** `Date.now().toString()` */
    readonly createdAt: string;
    readonly id: null;
    /** Session id of the root actor; every `Statechart` is its own root. */
    readonly rootId: string;
}

export interface StatelyActorEvent extends StatelyInspectionEventBase {
    readonly type: "@xstate.actor";
    readonly name: string;
    /** JSON of the machine config (functions as `{ type: fn.name }`). */
    readonly definition: string | undefined;
    readonly parentId: undefined;
    readonly snapshot: MachineDevtoolsSnapshot;
}

export interface StatelyEventEvent extends StatelyInspectionEventBase {
    readonly type: "@xstate.event";
    readonly event: MachineDevtoolsEvent;
    readonly sourceId: undefined;
}

export interface StatelySnapshotEvent extends StatelyInspectionEventBase {
    readonly type: "@xstate.snapshot";
    readonly snapshot: MachineDevtoolsSnapshot;
    readonly event: MachineDevtoolsEvent;
}

export type StatelyInspectionEvent = StatelyActorEvent | StatelyEventEvent | StatelySnapshotEvent;

/**
 * Transport behind `statelyInspector`. The built-in browser transport
 * (popup/iframe + `postMessage`) is used unless a custom one is passed via
 * `StatelyInspectorOptions.adapter`; a WebSocket transport is a natural
 * custom adapter. Events arrive already filtered and serialized, so an
 * adapter only has to deliver them (and buffer them itself while it is not
 * ready, if it needs to).
 */
export interface StatelyInspectorAdapter {
    /** Called from `inspector.start()`. */
    start?(): void;
    /** Called from `inspector.stop()`. */
    stop?(): void;
    send(event: StatelyInspectionEvent): void;
}

export interface StatelyInspectorOptions {
    /** @default "https://stately.ai/inspect" */
    url?: string;
    /** Load the inspector into this iframe instead of `window.open(url, "xstateinspector")`. */
    iframe?: HTMLIFrameElement | null;
    /** Host window (injectable for tests). @default globalThis.window */
    window?: Window;
    /** Open the inspector immediately. @default true */
    autoStart?: boolean;
    /** Events kept while not connected (oldest dropped first). @default 200 */
    maxDeferredEvents?: number;
    /** Drops the events it returns `false` for (checked before `serialize`). @default () => true */
    filter?: (event: StatelyInspectionEvent) => boolean;
    /**
     * Turns an event into what is put on the wire. The default
     * (`serializeInspectionEvent`) is a JSON round-trip that renders functions
     * as `{ type: fn.name }`, HTML elements as their `outerHTML` and circular
     * references as `"[Circular]"`. A custom serializer that keeps the shape
     * may compose it: `(e) => strip(serializeInspectionEvent(e))`.
     */
    serialize?: (event: StatelyInspectionEvent) => StatelyInspectionEvent;
    /**
     * Custom transport (e.g. a WebSocket). Replaces the browser transport, so
     * it cannot be combined with `url`, `iframe` or `window`.
     */
    adapter?: StatelyInspectorAdapter;
}

export interface StatelyInspector extends MachineDevtoolsLike {
    /**
     * Browser transport: `"connected"` after the `@statelyai.connected`
     * handshake. Custom adapter: `"connected"` between `start()` and `stop()`
     * (the adapter owns its real connection state).
     */
    readonly status: "disconnected" | "connected";
    /** Opens the inspector window/iframe and starts listening for the handshake. Idempotent. */
    start(): void;
    /** Posts `@statelyai.disconnected` and stops forwarding. Idempotent. */
    stop(): void;
    /** Forwards one already-built inspection event (filter → serialize → transport). */
    send(event: StatelyInspectionEvent): void;
}

/**
 * Creates the adapter. Wire it globally with
 * `DefaultOptions.update({ MACHINE_DEVTOOLS: statelyInspector() })` or per
 * instance through `StatechartOptions.inspector`.
 */
export function statelyInspector(options: StatelyInspectorOptions = {}): StatelyInspector {
    const filter = options.filter ?? (() => true);
    const serialize = options.serialize ?? serializeInspectionEvent;
    const transport = createTransport(options);

    let started = false;

    const inspector: StatelyInspector = {
        get status() {
            return transport.status;
        },
        start() {
            if (started) return;
            started = true;
            transport.start();
        },
        stop() {
            if (!started) return;
            started = false;
            transport.stop();
        },
        send(event) {
            // SSR/Node no-op transport: skip filter/serialize entirely —
            // serializing (a deep JSON clone of the full snapshot/context)
            // per event just to discard the result is pure overhead.
            if (!transport.wantsEvents) return;
            if (!filter(event)) return;
            transport.send(serialize(event));
        },
        actor(info) {
            // Same short-circuit for the per-actor registration, which would
            // otherwise stringify the whole machine definition per actor.
            if (!transport.wantsEvents) return NOOP_ACTOR;
            return createActorHandle(inspector, info);
        },
    };

    if (options.autoStart ?? true) {
        inspector.start();
    }

    return inspector;
}

// --- actor handle ----------------------------------------------------------

function createActorHandle(inspector: StatelyInspector, info: MachineDevtoolsActorInfo): MachineDevtoolsActor {
    const sessionId = info.sessionId ?? createSessionId();
    let isStopped = false;

    const base = (): StatelyInspectionEventBase => ({
        _version: STATELY_INSPECT_PROTOCOL_VERSION,
        sessionId,
        createdAt: Date.now().toString(),
        id: null,
        rootId: sessionId,
    });

    inspector.send({
        type: "@xstate.actor",
        ...base(),
        name: info.name,
        parentId: undefined,
        definition: info.definition === undefined ? undefined : safeStringify(info.definition),
        snapshot: info.snapshot,
    });

    return {
        event(event) {
            if (isStopped) return;
            inspector.send({ type: "@xstate.event", ...base(), event, sourceId: undefined });
        },
        snapshot(snapshot, event) {
            if (isStopped) return;
            inspector.send({ type: "@xstate.snapshot", ...base(), snapshot, event });
        },
        // The protocol has no per-actor teardown message; the handle only
        // stops forwarding so a disposed instance can never resurface.
        stop() {
            isStopped = true;
        },
    };
}

// --- transports ------------------------------------------------------------

interface Transport {
    readonly status: "disconnected" | "connected";
    /**
     * Whether the transport can ever deliver events. `false` only for the
     * SSR/Node no-op transport; the inspector then skips the whole
     * filter → serialize pipeline (and the actor-definition stringification)
     * instead of producing payloads that would be thrown away. The browser
     * transport keeps `true` even while disconnected: it buffers for replay.
     */
    readonly wantsEvents: boolean;
    start(): void;
    stop(): void;
    send(event: StatelyInspectionEvent): void;
}

function createTransport(options: StatelyInspectorOptions): Transport {
    if (options.adapter) {
        if (options.url !== undefined || options.iframe != null || options.window !== undefined) {
            throw new Error(
                "statelyInspector: 'adapter' replaces the browser transport and cannot be combined with 'url', 'iframe' or 'window'",
            );
        }
        return createAdapterTransport(options.adapter);
    }

    // `typeof window` guards SSR/Node: a bare `window` reference throws
    // ReferenceError on an undeclared global.
    const hostWindow = options.window ?? (typeof window === "undefined" ? undefined : window);
    if (!hostWindow) {
        return NOOP_TRANSPORT;
    }

    return createBrowserTransport({
        hostWindow,
        url: options.url ?? STATELY_INSPECT_DEFAULT_URL,
        iframe: options.iframe ?? null,
        maxDeferredEvents: options.maxDeferredEvents ?? DEFAULT_MAX_DEFERRED_EVENTS,
    });
}

const NOOP_TRANSPORT: Transport = {
    status: "disconnected",
    wantsEvents: false,
    start() {},
    stop() {},
    send() {},
};

const NOOP_ACTOR: MachineDevtoolsActor = {
    event() {},
    snapshot() {},
    stop() {},
};

function createAdapterTransport(adapter: StatelyInspectorAdapter): Transport {
    let status: Transport["status"] = "disconnected";

    return {
        get status() {
            return status;
        },
        wantsEvents: true,
        start() {
            status = "connected";
            adapter.start?.();
        },
        stop() {
            status = "disconnected";
            adapter.stop?.();
        },
        send(event) {
            adapter.send(event);
        },
    };
}

interface BrowserTransportConfig {
    hostWindow: Window;
    url: string;
    iframe: HTMLIFrameElement | null;
    maxDeferredEvents: number;
}

/** Target of `postMessage`: a popup or an iframe's content window. */
interface MessageTarget {
    postMessage(message: unknown, targetOrigin: string): void;
}

function isEventObject(data: unknown): data is { type: string } {
    return typeof data === "object" && data !== null && typeof (data as { type?: unknown }).type === "string";
}

/**
 * Mirror of `BrowserAdapter`: events are buffered (bounded) and replayed on
 * every `@statelyai.connected` handshake, so a reloaded inspector page catches
 * up with the history.
 */
function createBrowserTransport(config: BrowserTransportConfig): Transport {
    const { hostWindow, url, iframe, maxDeferredEvents } = config;

    let status: Transport["status"] = "disconnected";
    let targetWindow: MessageTarget | null = null;
    const deferredEvents: StatelyInspectionEvent[] = [];

    const post = (message: unknown) => {
        targetWindow?.postMessage(message, "*");
    };

    const onMessage = (event: MessageEvent) => {
        if (!isEventObject(event.data) || event.data.type !== STATELY_CONNECTED_MESSAGE_TYPE) return;
        // The inspector page may announce itself before the iframe's `load`
        // fires, while the target is not known yet. Only the iframe's own
        // content window is ever adopted as the target: any browsing context
        // on the page can post `@statelyai.connected`, and adopting a foreign
        // sender would replay every buffered snapshot (full context) to it.
        // The reference implementation never adopts a sender at all.
        if (targetWindow === null) {
            const contentWindow = iframe?.contentWindow ?? null;
            if (contentWindow === null || event.source !== contentWindow) return;
            targetWindow = contentWindow;
        }
        // With a known target the handshake only flips the status and replays
        // the buffer *to that target* (reference semantics: the sender is not
        // checked, and nothing is posted to it).
        status = "connected";
        deferredEvents.forEach(post);
    };

    const onIframeLoad = () => {
        targetWindow = iframe?.contentWindow ?? null;
    };

    return {
        get status() {
            return status;
        },
        wantsEvents: true,
        start() {
            hostWindow.addEventListener("message", onMessage);

            if (iframe) {
                targetWindow = iframe.contentWindow;
                iframe.addEventListener("load", onIframeLoad);
                iframe.setAttribute("src", url);
                return;
            }

            targetWindow = hostWindow.open(url, STATELY_INSPECT_WINDOW_NAME);
            if (targetWindow === null) {
                warn(`could not open the inspector window (${url}); is the popup blocked?`);
            }
        },
        stop() {
            post({ type: STATELY_DISCONNECTED_MESSAGE_TYPE });
            hostWindow.removeEventListener("message", onMessage);
            iframe?.removeEventListener("load", onIframeLoad);
            status = "disconnected";
            targetWindow = null;
        },
        send(event) {
            if (status === "connected") {
                post(event);
            }
            // Always kept: the buffer is the replay history for a reconnect.
            deferredEvents.push(event);
            if (deferredEvents.length > maxDeferredEvents) {
                deferredEvents.shift();
            }
        },
    };
}

function warn(message: string): void {
    if (typeof console !== "undefined" && typeof console.warn === "function") {
        console.warn(`[RxToolkit Stately Inspector] ${message}`);
    }
}

// --- serialization ---------------------------------------------------------

/**
 * Default `serialize`: a JSON round-trip that survives anything a machine
 * config or context may hold. Functions become `{ type: fn.name }` (so the
 * builtins render exactly like XState's in the inspector), HTML elements
 * their `outerHTML`, circular references `"[Circular]"`, bigints strings.
 * `undefined` fields are dropped, as with any JSON.
 */
export function serializeInspectionEvent(event: StatelyInspectionEvent): StatelyInspectionEvent {
    return JSON.parse(safeStringify(event)) as StatelyInspectionEvent;
}

function safeStringify(value: unknown): string {
    // Ancestor chain of the value being visited. `JSON.stringify` calls the
    // replacer with the holder as `this`, which lets us unwind the chain and
    // flag only true cycles (a shared reference in two branches is not one).
    const ancestors: object[] = [];

    const replacer = function (this: unknown, _key: string, rawValue: unknown): unknown {
        const value = toSerializable(rawValue);
        if (typeof value !== "object" || value === null) return value;

        while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
            ancestors.pop();
        }
        if (ancestors.includes(value)) return "[Circular]";

        ancestors.push(value);
        return value;
    };

    return JSON.stringify(value, replacer);
}

function toSerializable(value: unknown): unknown {
    if (typeof value === "function") return { type: value.name };
    if (typeof value === "bigint") return value.toString();
    if (typeof HTMLElement !== "undefined" && value instanceof HTMLElement) return value.outerHTML;
    return value;
}

// --- session ids -----------------------------------------------------------

/** `crypto.randomUUID()` when available, otherwise a v4-shaped UUID from `getRandomValues`/`Math.random`. */
export function createSessionId(): string {
    const cryptoApi = typeof crypto === "undefined" ? undefined : crypto;

    if (typeof cryptoApi?.randomUUID === "function") {
        return cryptoApi.randomUUID();
    }

    const bytes = new Uint8Array(16);
    if (typeof cryptoApi?.getRandomValues === "function") {
        cryptoApi.getRandomValues(bytes);
    } else {
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
