import {
    createSessionId,
    serializeInspectionEvent,
    STATELY_CONNECTED_MESSAGE_TYPE,
    STATELY_DISCONNECTED_MESSAGE_TYPE,
    STATELY_INSPECT_DEFAULT_URL,
    STATELY_INSPECT_PROTOCOL_VERSION,
    STATELY_INSPECT_WINDOW_NAME,
    statelyInspector,
    type StatelyInspectionEvent,
    type StatelyInspectorAdapter,
} from "./statelyInspector";
import type { MachineDevtoolsActorInfo, MachineDevtoolsSnapshot } from "./types";

type MessageListener = (event: { data: unknown; source?: unknown }) => void;

function createFakeWindow(options: { openReturnsNull?: boolean } = {}) {
    const popup = { postMessage: vi.fn() };
    const listeners = new Set<MessageListener>();

    const hostWindow = {
        open: vi.fn(() => (options.openReturnsNull ? null : popup)),
        addEventListener: vi.fn((type: string, listener: MessageListener) => {
            if (type === "message") listeners.add(listener);
        }),
        removeEventListener: vi.fn((type: string, listener: MessageListener) => {
            if (type === "message") listeners.delete(listener);
        }),
    };

    const receive = (data: unknown, source: unknown = popup) => {
        listeners.forEach((listener) => listener({ data, source }));
    };
    const connect = () => receive({ type: STATELY_CONNECTED_MESSAGE_TYPE });

    return { hostWindow: hostWindow as unknown as Window, popup, listeners, receive, connect };
}

function createFakeIframe() {
    const contentWindow = { postMessage: vi.fn() };
    const loadListeners = new Set<() => void>();

    const iframe = {
        contentWindow,
        setAttribute: vi.fn(),
        addEventListener: vi.fn((type: string, listener: () => void) => {
            if (type === "load") loadListeners.add(listener);
        }),
        removeEventListener: vi.fn((type: string, listener: () => void) => {
            if (type === "load") loadListeners.delete(listener);
        }),
    };

    const load = () => loadListeners.forEach((listener) => listener());

    return { iframe: iframe as unknown as HTMLIFrameElement, contentWindow, loadListeners, load };
}

const snapshot: MachineDevtoolsSnapshot = { status: "active", value: "green", context: { ready: false }, tags: [] };

function actorInfo(overrides: Partial<MachineDevtoolsActorInfo> = {}): MachineDevtoolsActorInfo {
    return {
        sessionId: "sc:1",
        name: "trafficLight",
        definition: { id: "trafficLight", initial: "green", states: { green: {} } },
        snapshot,
        ...overrides,
    };
}

function postedMessages(target: { postMessage: ReturnType<typeof vi.fn> }): unknown[] {
    return target.postMessage.mock.calls.map((call) => call[0]);
}

describe("statelyInspector", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    describe("browser transport: opening", () => {
        it("opens the inspector popup with the default url and the xstateinspector window name on autoStart", () => {
            const { hostWindow } = createFakeWindow();
            const inspector = statelyInspector({ window: hostWindow });

            expect(hostWindow.open).toHaveBeenCalledWith(STATELY_INSPECT_DEFAULT_URL, STATELY_INSPECT_WINDOW_NAME);
            expect(hostWindow.addEventListener).toHaveBeenCalledWith("message", expect.any(Function));
            expect(inspector.status).toBe("disconnected");
        });

        it("uses a custom url", () => {
            const { hostWindow } = createFakeWindow();
            statelyInspector({ window: hostWindow, url: "https://example.test/inspect" });

            expect(hostWindow.open).toHaveBeenCalledWith("https://example.test/inspect", STATELY_INSPECT_WINDOW_NAME);
        });

        it("does not open anything with autoStart: false until start() is called", () => {
            const { hostWindow } = createFakeWindow();
            const inspector = statelyInspector({ window: hostWindow, autoStart: false });

            expect(hostWindow.open).not.toHaveBeenCalled();
            expect(hostWindow.addEventListener).not.toHaveBeenCalled();

            inspector.start();
            expect(hostWindow.open).toHaveBeenCalledTimes(1);
        });

        it("start() is idempotent: a second call does not open a second window or listener", () => {
            const { hostWindow } = createFakeWindow();
            const inspector = statelyInspector({ window: hostWindow });

            inspector.start();
            inspector.start();

            expect(hostWindow.open).toHaveBeenCalledTimes(1);
            expect(hostWindow.addEventListener).toHaveBeenCalledTimes(1);
        });

        it("warns when the popup cannot be opened and ignores handshakes from any window (nothing is adopted)", () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            const { hostWindow, receive } = createFakeWindow({ openReturnsNull: true });
            const inspector = statelyInspector({ window: hostWindow });

            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.mock.calls[0][0]).toContain("popup");

            // Any browsing context on the page can post the handshake; adopting
            // it as the target would replay the buffer (full context) to it.
            inspector.actor(actorInfo());
            const foreign = { postMessage: vi.fn() };
            expect(() => receive({ type: STATELY_CONNECTED_MESSAGE_TYPE }, foreign)).not.toThrow();
            expect(inspector.status).toBe("disconnected");
            expect(foreign.postMessage).not.toHaveBeenCalled();
        });

        it("falls back to the global window when none is injected", () => {
            const { hostWindow } = createFakeWindow();
            vi.stubGlobal("window", hostWindow);

            statelyInspector();

            expect(hostWindow.open).toHaveBeenCalledTimes(1);
        });
    });

    describe("browser transport: handshake and buffering", () => {
        it("buffers events until @statelyai.connected, then flushes them in order", () => {
            const { hostWindow, popup, connect } = createFakeWindow();
            const inspector = statelyInspector({ window: hostWindow });

            const handle = inspector.actor(actorInfo());
            handle.event({ type: "TIMER" });
            handle.snapshot({ ...snapshot, value: "yellow" }, { type: "TIMER" });

            expect(popup.postMessage).not.toHaveBeenCalled();

            connect();

            expect(inspector.status).toBe("connected");
            const messages = postedMessages(popup) as StatelyInspectionEvent[];
            expect(messages.map((m) => m.type)).toEqual(["@xstate.actor", "@xstate.event", "@xstate.snapshot"]);
            expect(popup.postMessage.mock.calls.every((call) => call[1] === "*")).toBe(true);
        });

        it("forwards events immediately once connected", () => {
            const { hostWindow, popup, connect } = createFakeWindow();
            const inspector = statelyInspector({ window: hostWindow });
            connect();

            const handle = inspector.actor(actorInfo());
            expect(popup.postMessage).toHaveBeenCalledTimes(1);

            handle.event({ type: "TIMER" });
            expect(popup.postMessage).toHaveBeenCalledTimes(2);
        });

        it("replays the whole history on every reconnect (reloaded inspector page)", () => {
            const { hostWindow, popup, connect } = createFakeWindow();
            const inspector = statelyInspector({ window: hostWindow });
            connect();

            const handle = inspector.actor(actorInfo());
            handle.event({ type: "TIMER" });
            expect(popup.postMessage).toHaveBeenCalledTimes(2);

            connect();

            const messages = postedMessages(popup) as StatelyInspectionEvent[];
            expect(messages.map((m) => m.type)).toEqual([
                "@xstate.actor",
                "@xstate.event",
                "@xstate.actor",
                "@xstate.event",
            ]);
        });

        it("drops the oldest events beyond maxDeferredEvents", () => {
            const { hostWindow, popup, connect } = createFakeWindow();
            const inspector = statelyInspector({ window: hostWindow, maxDeferredEvents: 3 });

            const handle = inspector.actor(actorInfo());
            handle.event({ type: "E1" });
            handle.event({ type: "E2" });
            handle.event({ type: "E3" });

            connect();

            const messages = postedMessages(popup) as StatelyInspectionEvent[];
            expect(messages.map((m) => (m.type === "@xstate.event" ? m.event.type : m.type))).toEqual([
                "E1",
                "E2",
                "E3",
            ]);
        });

        it("with a known target, a handshake from any source only replays to the target, never to the sender", () => {
            const { hostWindow, popup, receive } = createFakeWindow();
            const inspector = statelyInspector({ window: hostWindow });
            inspector.actor(actorInfo());

            const foreign = { postMessage: vi.fn() };
            receive({ type: STATELY_CONNECTED_MESSAGE_TYPE }, foreign);

            expect(inspector.status).toBe("connected");
            expect(popup.postMessage).toHaveBeenCalledTimes(1);
            expect(foreign.postMessage).not.toHaveBeenCalled();
        });

        it("ignores unrelated messages", () => {
            const { hostWindow, popup, receive } = createFakeWindow();
            const inspector = statelyInspector({ window: hostWindow });
            inspector.actor(actorInfo());

            receive("hello");
            receive(null);
            receive({ type: 42 });
            receive({ type: "something-else" });

            expect(inspector.status).toBe("disconnected");
            expect(popup.postMessage).not.toHaveBeenCalled();
        });
    });

    describe("browser transport: stop()", () => {
        it("posts @statelyai.disconnected, removes the listener and stops forwarding", () => {
            const { hostWindow, popup, listeners, connect } = createFakeWindow();
            const inspector = statelyInspector({ window: hostWindow });
            connect();
            const handle = inspector.actor(actorInfo());

            inspector.stop();

            expect(popup.postMessage).toHaveBeenLastCalledWith({ type: STATELY_DISCONNECTED_MESSAGE_TYPE }, "*");
            expect(inspector.status).toBe("disconnected");
            expect(listeners.size).toBe(0);

            const before = popup.postMessage.mock.calls.length;
            handle.event({ type: "TIMER" });
            expect(popup.postMessage).toHaveBeenCalledTimes(before);
        });

        it("stop() before start() and a repeated stop() are no-ops", () => {
            const { hostWindow, popup } = createFakeWindow();
            const inspector = statelyInspector({ window: hostWindow, autoStart: false });

            expect(() => inspector.stop()).not.toThrow();
            expect(popup.postMessage).not.toHaveBeenCalled();

            inspector.start();
            inspector.stop();
            inspector.stop();
            expect(popup.postMessage).toHaveBeenCalledTimes(1);
        });

        it("can be restarted: reopens the window and replays the history on the next handshake", () => {
            const { hostWindow, popup, connect } = createFakeWindow();
            const inspector = statelyInspector({ window: hostWindow });
            inspector.actor(actorInfo());
            inspector.stop();

            inspector.start();
            expect(hostWindow.open).toHaveBeenCalledTimes(2);
            connect();

            const messages = postedMessages(popup) as StatelyInspectionEvent[];
            expect(messages.map((m) => m.type)).toEqual([STATELY_DISCONNECTED_MESSAGE_TYPE, "@xstate.actor"]);
        });
    });

    describe("browser transport: iframe", () => {
        it("sets the iframe src instead of opening a popup and posts into its content window", () => {
            const { hostWindow, connect } = createFakeWindow();
            const { iframe, contentWindow, load } = createFakeIframe();
            const inspector = statelyInspector({ window: hostWindow, iframe, url: "https://example.test/inspect" });

            expect(hostWindow.open).not.toHaveBeenCalled();
            expect(iframe.setAttribute).toHaveBeenCalledWith("src", "https://example.test/inspect");
            expect(iframe.addEventListener).toHaveBeenCalledWith("load", expect.any(Function));

            load();
            inspector.actor(actorInfo());
            connect();

            expect(contentWindow.postMessage).toHaveBeenCalledTimes(1);
            expect((contentWindow.postMessage.mock.calls[0][0] as StatelyInspectionEvent).type).toBe("@xstate.actor");
        });

        it("adopts the iframe's content window when the handshake arrives before the target is known", () => {
            const { hostWindow, receive } = createFakeWindow();
            const { iframe } = createFakeIframe();
            const frame = iframe as unknown as { contentWindow: unknown };
            frame.contentWindow = null; // not attached yet at start()
            const inspector = statelyInspector({ window: hostWindow, iframe });
            inspector.actor(actorInfo());

            const contentWindow = { postMessage: vi.fn() };
            frame.contentWindow = contentWindow; // attached by the time the page announces itself
            receive({ type: STATELY_CONNECTED_MESSAGE_TYPE }, contentWindow);

            expect(inspector.status).toBe("connected");
            expect(contentWindow.postMessage).toHaveBeenCalledTimes(1);
        });

        it("never adopts a foreign sender: a handshake from another window is ignored while the target is unknown", () => {
            const { hostWindow, receive } = createFakeWindow();
            const { iframe } = createFakeIframe();
            (iframe as unknown as { contentWindow: unknown }).contentWindow = null;
            const inspector = statelyInspector({ window: hostWindow, iframe });
            inspector.actor(actorInfo());

            const foreign = { postMessage: vi.fn() };
            receive({ type: STATELY_CONNECTED_MESSAGE_TYPE }, foreign);

            expect(inspector.status).toBe("disconnected");
            expect(foreign.postMessage).not.toHaveBeenCalled();
        });

        it("stop() removes the load listener", () => {
            const { hostWindow } = createFakeWindow();
            const { iframe, loadListeners } = createFakeIframe();
            const inspector = statelyInspector({ window: hostWindow, iframe });
            expect(loadListeners.size).toBe(1);

            inspector.stop();
            expect(loadListeners.size).toBe(0);
        });
    });

    describe("wire format", () => {
        beforeEach(() => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(1_700_000_000_000));
        });

        function connected() {
            const fake = createFakeWindow();
            const inspector = statelyInspector({ window: fake.hostWindow });
            fake.connect();
            return { ...fake, inspector };
        }

        it("@xstate.actor carries name, JSON definition, snapshot and the common envelope", () => {
            const { inspector, popup } = connected();
            inspector.actor(actorInfo());

            expect(popup.postMessage.mock.calls[0][0]).toEqual({
                type: "@xstate.actor",
                _version: STATELY_INSPECT_PROTOCOL_VERSION,
                sessionId: "sc:1",
                rootId: "sc:1",
                id: null,
                createdAt: "1700000000000",
                name: "trafficLight",
                definition: JSON.stringify({ id: "trafficLight", initial: "green", states: { green: {} } }),
                snapshot: { status: "active", value: "green", context: { ready: false }, tags: [] },
            });
        });

        it("@xstate.event carries the event and the envelope (sourceId is dropped as undefined)", () => {
            const { inspector, popup } = connected();
            inspector.actor(actorInfo()).event({ type: "TIMER", payload: 1 } as { type: string });

            expect(popup.postMessage.mock.calls[1][0]).toEqual({
                type: "@xstate.event",
                _version: STATELY_INSPECT_PROTOCOL_VERSION,
                sessionId: "sc:1",
                rootId: "sc:1",
                id: null,
                createdAt: "1700000000000",
                event: { type: "TIMER", payload: 1 },
            });
        });

        it("@xstate.snapshot carries snapshot and event", () => {
            const { inspector, popup } = connected();
            const next: MachineDevtoolsSnapshot = {
                status: "done",
                value: { a: "b" },
                context: { ready: true },
                output: 42,
                tags: ["t"],
            };
            inspector.actor(actorInfo()).snapshot(next, { type: "TIMER" });

            expect(popup.postMessage.mock.calls[1][0]).toEqual({
                type: "@xstate.snapshot",
                _version: STATELY_INSPECT_PROTOCOL_VERSION,
                sessionId: "sc:1",
                rootId: "sc:1",
                id: null,
                createdAt: "1700000000000",
                snapshot: next,
                event: { type: "TIMER" },
            });
        });

        it("renders functions in the definition as { type: fn.name } (builtins look like XState's)", () => {
            const { inspector, popup } = connected();
            function assign() {}
            const definition = {
                id: "m",
                states: { a: { entry: [assign, { type: "warn" }], on: { E: { guard: () => true } } } },
            };
            inspector.actor(actorInfo({ definition }));

            const actorEvent = popup.postMessage.mock.calls[0][0] as { definition: string };
            expect(JSON.parse(actorEvent.definition)).toEqual({
                id: "m",
                states: {
                    a: { entry: [{ type: "assign" }, { type: "warn" }], on: { E: { guard: { type: "guard" } } } },
                },
            });
        });

        it("omits the definition when the actor has none", () => {
            const { inspector, popup } = connected();
            inspector.actor(actorInfo({ definition: undefined }));

            expect(popup.postMessage.mock.calls[0][0]).not.toHaveProperty("definition");
        });

        it("posts plain JSON clones: functions, circular references and bigints in the snapshot are made cloneable", () => {
            const { inspector, popup } = connected();
            const context: Record<string, unknown> = { big: 10n, fn: function named() {} };
            context.self = context;
            inspector.actor(actorInfo()).snapshot({ status: "active", value: "a", context }, { type: "E" });

            const posted = popup.postMessage.mock.calls[1][0] as { snapshot: { context: unknown } };
            expect(posted.snapshot.context).toEqual({ big: "10", fn: { type: "named" }, self: "[Circular]" });
        });

        it("does not confuse a shared (non-circular) reference with a cycle", () => {
            const shared = { x: 1 };
            const event = {
                type: "@xstate.snapshot",
                _version: "0.7.2",
                sessionId: "s",
                rootId: "s",
                id: null,
                createdAt: "0",
                snapshot: { status: "active", value: "a", context: { left: shared, right: shared } },
                event: { type: "E" },
            } satisfies StatelyInspectionEvent;

            const out = serializeInspectionEvent(event) as typeof event;
            expect(out.snapshot.context).toEqual({ left: { x: 1 }, right: { x: 1 } });
        });

        it("renders HTML elements as their outerHTML", () => {
            const { inspector, popup } = connected();
            const element = document.createElement("div");
            element.id = "root";
            inspector
                .actor(actorInfo())
                .snapshot({ status: "active", value: "a", context: { element } }, { type: "E" });

            const posted = popup.postMessage.mock.calls[1][0] as { snapshot: { context: { element: string } } };
            expect(posted.snapshot.context.element).toBe('<div id="root"></div>');
        });
    });

    describe("actor handle", () => {
        it("stop() silences the handle without touching the inspector", () => {
            const { hostWindow, popup, connect } = createFakeWindow();
            const inspector = statelyInspector({ window: hostWindow });
            connect();

            const first = inspector.actor(actorInfo({ sessionId: "sc:1" }));
            const second = inspector.actor(actorInfo({ sessionId: "sc:2" }));
            first.stop();
            first.event({ type: "E" });
            first.snapshot(snapshot, { type: "E" });
            second.event({ type: "E" });

            const messages = postedMessages(popup) as StatelyInspectionEvent[];
            expect(messages.map((m) => `${m.type}:${m.sessionId}`)).toEqual([
                "@xstate.actor:sc:1",
                "@xstate.actor:sc:2",
                "@xstate.event:sc:2",
            ]);
            expect(inspector.status).toBe("connected");
        });

        it("generates a session id when the caller passes none, and uses it for every message of that actor", () => {
            const { hostWindow, popup, connect } = createFakeWindow();
            const inspector = statelyInspector({ window: hostWindow });
            connect();

            inspector.actor(actorInfo({ sessionId: undefined })).event({ type: "E" });

            const [actorEvent, eventEvent] = postedMessages(popup) as StatelyInspectionEvent[];
            expect(actorEvent.sessionId).toMatch(/^[0-9a-f-]{36}$/);
            expect(eventEvent.sessionId).toBe(actorEvent.sessionId);
            expect(actorEvent.rootId).toBe(actorEvent.sessionId);
        });
    });

    describe("filter and serialize", () => {
        it("filter drops events before serialization and transport", () => {
            const { hostWindow, popup, connect } = createFakeWindow();
            const serialize = vi.fn((event: StatelyInspectionEvent) => event);
            const inspector = statelyInspector({
                window: hostWindow,
                filter: (event) => event.type !== "@xstate.event",
                serialize,
            });
            connect();

            const handle = inspector.actor(actorInfo());
            handle.event({ type: "E" });
            handle.snapshot(snapshot, { type: "E" });

            expect(serialize).toHaveBeenCalledTimes(2);
            const messages = postedMessages(popup) as StatelyInspectionEvent[];
            expect(messages.map((m) => m.type)).toEqual(["@xstate.actor", "@xstate.snapshot"]);
        });

        it("serialize replaces the default and its result is what gets posted (once per event)", () => {
            const { hostWindow, popup, connect } = createFakeWindow();
            const serialize = vi.fn((event: StatelyInspectionEvent) => ({
                ...serializeInspectionEvent(event),
                createdAt: "redacted",
            }));
            const inspector = statelyInspector({ window: hostWindow, serialize });

            inspector.actor(actorInfo());
            connect();

            expect(serialize).toHaveBeenCalledTimes(1);
            expect((popup.postMessage.mock.calls[0][0] as StatelyInspectionEvent).createdAt).toBe("redacted");
        });
    });

    describe("custom adapter", () => {
        function createAdapter() {
            return {
                start: vi.fn<() => void>(),
                stop: vi.fn<() => void>(),
                send: vi.fn<(event: StatelyInspectionEvent) => void>(),
            } satisfies StatelyInspectorAdapter;
        }

        it("drives the adapter instead of the browser transport (no window needed)", () => {
            vi.stubGlobal("window", undefined);
            const adapter = createAdapter();
            const inspector = statelyInspector({ adapter });

            expect(adapter.start).toHaveBeenCalledTimes(1);
            expect(inspector.status).toBe("connected");

            const handle = inspector.actor(actorInfo());
            handle.event({ type: "E" });

            expect(adapter.send).toHaveBeenCalledTimes(2);
            const sent = adapter.send.mock.calls.map((call) => call[0] as StatelyInspectionEvent);
            expect(sent.map((e) => e.type)).toEqual(["@xstate.actor", "@xstate.event"]);
            expect(sent[0]).toMatchObject({ _version: STATELY_INSPECT_PROTOCOL_VERSION, sessionId: "sc:1" });

            inspector.stop();
            expect(adapter.stop).toHaveBeenCalledTimes(1);
            expect(inspector.status).toBe("disconnected");
        });

        it("hands the adapter serialized events (functions already replaced)", () => {
            const adapter = createAdapter();
            const inspector = statelyInspector({ adapter });
            inspector
                .actor(actorInfo())
                .snapshot({ status: "active", value: "a", context: { fn() {} } }, { type: "E" });

            const sent = adapter.send.mock.calls[1][0] as { snapshot: { context: unknown } };
            expect(sent.snapshot.context).toEqual({ fn: { type: "fn" } });
        });

        it("respects autoStart: false and works with a send-only adapter", () => {
            const adapter: StatelyInspectorAdapter = { send: vi.fn() };
            const inspector = statelyInspector({ adapter, autoStart: false });

            expect(inspector.status).toBe("disconnected");
            inspector.actor(actorInfo());
            expect(adapter.send).toHaveBeenCalledTimes(1);

            expect(() => inspector.start()).not.toThrow();
            expect(() => inspector.stop()).not.toThrow();
        });

        it("applies filter and serialize before the adapter", () => {
            const adapter = createAdapter();
            const inspector = statelyInspector({
                adapter,
                filter: (event) => event.type === "@xstate.event",
                serialize: (event) => ({ ...event, createdAt: "x" }),
            });
            const handle = inspector.actor(actorInfo());
            handle.event({ type: "E" });

            expect(adapter.send).toHaveBeenCalledTimes(1);
            expect(adapter.send.mock.calls[0][0]).toMatchObject({ type: "@xstate.event", createdAt: "x" });
        });

        it("rejects browser transport options combined with an adapter", () => {
            const adapter = createAdapter();
            expect(() => statelyInspector({ adapter, url: "https://x" })).toThrow(/cannot be combined/);
            expect(() => statelyInspector({ adapter, window: {} as Window })).toThrow(/cannot be combined/);
            expect(() => statelyInspector({ adapter, iframe: {} as HTMLIFrameElement })).toThrow(/cannot be combined/);
            expect(() => statelyInspector({ adapter, iframe: null })).not.toThrow();
        });
    });

    describe("SSR", () => {
        it("is a silent no-op without a window", () => {
            vi.stubGlobal("window", undefined);
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            const error = vi.spyOn(console, "error").mockImplementation(() => {});

            const inspector = statelyInspector();
            const handle = inspector.actor(actorInfo());
            handle.event({ type: "E" });
            handle.snapshot(snapshot, { type: "E" });
            handle.stop();
            inspector.stop();
            inspector.start();

            expect(inspector.status).toBe("disconnected");
            expect(warn).not.toHaveBeenCalled();
            expect(error).not.toHaveBeenCalled();
        });
    });

    describe("createSessionId", () => {
        it("uses crypto.randomUUID when available", () => {
            vi.stubGlobal("crypto", { randomUUID: () => "fixed-uuid" });
            expect(createSessionId()).toBe("fixed-uuid");
        });

        it("falls back to getRandomValues", () => {
            vi.stubGlobal("crypto", {
                getRandomValues: (bytes: Uint8Array) => {
                    bytes.fill(0xab);
                    return bytes;
                },
            });
            expect(createSessionId()).toBe("abababab-abab-4bab-abab-abababababab");
        });

        it("falls back to Math.random without crypto and still produces a v4-shaped id", () => {
            vi.stubGlobal("crypto", undefined);
            expect(createSessionId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
            expect(createSessionId()).not.toBe(createSessionId());
        });
    });
});
