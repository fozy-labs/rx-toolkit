import { reduxDevtools } from "./reduxDevtools";

function createMockExtension() {
    const connection = {
        init: vi.fn(),
        send: vi.fn(),
    };
    const extension = {
        connect: vi.fn(() => connection),
    };
    return { extension, connection };
}

describe("reduxDevtools", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe("initialization", () => {
        it("throws when extension is missing", () => {
            vi.stubGlobal("window", {});
            expect(() => reduxDevtools()).toThrow("Redux Devtools extension is not installed");
        });

        it('connects with default name "RxToolkit"', () => {
            const { extension } = createMockExtension();
            reduxDevtools({ driver: extension });
            expect(extension.connect).toHaveBeenCalledWith({ name: "RxToolkit" });
        });

        it("connects with custom name", () => {
            const { extension } = createMockExtension();
            reduxDevtools({ driver: extension, name: "MyApp" });
            expect(extension.connect).toHaveBeenCalledWith({ name: "MyApp" });
        });

        it("calls init with empty state", () => {
            const { extension, connection } = createMockExtension();
            reduxDevtools({ driver: extension });
            expect(connection.init).toHaveBeenCalledWith({});
        });
    });

    describe("window.__REDUX_DEVTOOLS_EXTENSION__", () => {
        it("uses window extension when no driver provided", () => {
            const { extension, connection } = createMockExtension();
            vi.stubGlobal("__REDUX_DEVTOOLS_EXTENSION__", extension);
            reduxDevtools();
            expect(extension.connect).toHaveBeenCalled();
            expect(connection.init).toHaveBeenCalledWith({});
        });

        it("throws the friendly 'not installed' error (not a window ReferenceError) in SSR without window", () => {
            vi.stubGlobal("window", undefined);
            // Bare `window` access would blow up with a low-level TypeError/
            // ReferenceError; the guard must funnel this into the clean error.
            expect(() => reduxDevtools()).toThrow("Redux Devtools extension is not installed");
        });
    });

    describe("state() and updater", () => {
        it('state() schedules a "create" send', async () => {
            const { extension, connection } = createMockExtension();
            reduxDevtools({ driver: extension, batchStrategy: "microtask" }).state("counter", 0);

            // Wait for microtask flush
            await Promise.resolve();

            expect(connection.send).toHaveBeenCalledWith({ type: "CREATE" }, { counter: 0 });
        });

        it('updater schedules an "update" send', async () => {
            const { extension, connection } = createMockExtension();
            const dt = reduxDevtools({ driver: extension, batchStrategy: "microtask" });
            const updater = dt.state("counter", 0);

            // Flush the initial create
            await Promise.resolve();
            connection.send.mockClear();

            updater(42);

            await Promise.resolve();

            expect(connection.send).toHaveBeenCalledWith({ type: "UPDATE" }, { counter: 42 });
        });

        it('$COMPLETED triggers "clear" and removes state key', async () => {
            const { extension, connection } = createMockExtension();
            const dt = reduxDevtools({ driver: extension, batchStrategy: "microtask" });
            const updater = dt.state("counter", 0);

            await Promise.resolve();
            connection.send.mockClear();

            updater("$COMPLETED" as any);

            await Promise.resolve();

            expect(connection.send).toHaveBeenCalledWith({ type: "CLEAR" }, {});
        });

        it('$CLEANED triggers "clear" and removes state key', async () => {
            const { extension, connection } = createMockExtension();
            const dt = reduxDevtools({ driver: extension, batchStrategy: "microtask" });
            const updater = dt.state("counter", 0);

            await Promise.resolve();
            connection.send.mockClear();

            updater("$CLEANED" as any);

            await Promise.resolve();

            expect(connection.send).toHaveBeenCalledWith({ type: "CLEAR" }, {});
        });

        it('nested state keys via "/" separator', async () => {
            const { extension, connection } = createMockExtension();
            const dt = reduxDevtools({ driver: extension, batchStrategy: "microtask" });
            dt.state("group/counter", 10);

            await Promise.resolve();

            expect(connection.send).toHaveBeenCalledWith({ type: "CREATE" }, { group: { counter: 10 } });
        });
    });

    describe("key ownership (instances)", () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('re-registering a live key sends "recreate" without warning', async () => {
            const { extension, connection } = createMockExtension();
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            const dt = reduxDevtools({ driver: extension, batchStrategy: "microtask" });

            dt.state("counter", 0);
            await Promise.resolve();
            connection.send.mockClear();

            dt.state("counter", 5);
            await Promise.resolve();

            expect(connection.send).toHaveBeenCalledWith({ type: "RECREATE" }, { counter: 5 });
            expect(warn).not.toHaveBeenCalled();
        });

        it("ignores updates from a superseded instance and warns once", async () => {
            const { extension, connection } = createMockExtension();
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            const dt = reduxDevtools({ driver: extension, batchStrategy: "microtask" });

            const stale = dt.state("counter", 0);
            const current = dt.state("counter", 5);
            await Promise.resolve();
            connection.send.mockClear();

            stale(1);
            stale(2);
            await Promise.resolve();

            expect(connection.send).not.toHaveBeenCalled();
            expect(warn).toHaveBeenCalledTimes(1);

            current(7);
            await Promise.resolve();

            expect(connection.send).toHaveBeenCalledWith({ type: "UPDATE" }, { counter: 7 });
        });

        it("ignores $COMPLETED from a superseded instance, keeping the current entry", async () => {
            const { extension, connection } = createMockExtension();
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            const dt = reduxDevtools({ driver: extension, batchStrategy: "microtask" });

            const stale = dt.state("counter", 0);
            const current = dt.state("counter", 5);
            await Promise.resolve();
            connection.send.mockClear();

            // A late finalizer/dispose of the old signal must not wipe the new one.
            stale("$COMPLETED" as any);
            await Promise.resolve();

            expect(connection.send).not.toHaveBeenCalled();
            expect(warn).not.toHaveBeenCalled();

            current(7);
            await Promise.resolve();

            expect(connection.send).toHaveBeenCalledWith({ type: "UPDATE" }, { counter: 7 });
        });

        it('releases the key on the owner disposal, so the next state() is a "create"', async () => {
            const { extension, connection } = createMockExtension();
            const dt = reduxDevtools({ driver: extension, batchStrategy: "microtask" });

            const owner = dt.state("counter", 0);
            owner("$COMPLETED" as any);
            await Promise.resolve();
            connection.send.mockClear();

            dt.state("counter", 9);
            await Promise.resolve();

            expect(connection.send).toHaveBeenCalledWith({ type: "CREATE" }, { counter: 9 });
        });

        it("does not resurrect a released key from a superseded instance", async () => {
            const { extension, connection } = createMockExtension();
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            const dt = reduxDevtools({ driver: extension, batchStrategy: "microtask" });

            const stale = dt.state("counter", 0);
            const current = dt.state("counter", 5);
            current("$COMPLETED" as any);
            await Promise.resolve();
            connection.send.mockClear();

            stale(1);
            await Promise.resolve();

            expect(connection.send).not.toHaveBeenCalled();
            expect(warn).toHaveBeenCalledTimes(1);
        });
    });

    describe("batch strategies", () => {
        it("sync strategy sends via Batcher scheduler", async () => {
            const { extension, connection } = createMockExtension();
            const dt = reduxDevtools({ driver: extension, batchStrategy: "sync" });
            dt.state("x", 1);

            // Batcher.scheduler(Infinity) defers to end of batch or runs immediately
            // Give it a microtask to settle
            await Promise.resolve();
            await Promise.resolve();

            expect(connection.send).toHaveBeenCalled();
        });

        it("task strategy sends after setTimeout", async () => {
            vi.useFakeTimers();
            const { extension, connection } = createMockExtension();
            const dt = reduxDevtools({ driver: extension, batchStrategy: "task", taskDelay: 50 });
            dt.state("x", 1);

            expect(connection.send).not.toHaveBeenCalled();

            vi.advanceTimersByTime(50);

            expect(connection.send).toHaveBeenCalledWith({ type: "CREATE" }, { x: 1 });
            vi.useRealTimers();
        });

        it("microtask strategy batches multiple updates", async () => {
            const { extension, connection } = createMockExtension();
            const dt = reduxDevtools({ driver: extension, batchStrategy: "microtask" });
            const updater = dt.state("counter", 0);

            // Before microtask flushes, do an update too
            updater(1);
            updater(2);

            await Promise.resolve();

            // All batched into one send — only the last state is sent
            expect(connection.send).toHaveBeenCalledTimes(1);
            expect(connection.send).toHaveBeenCalledWith({ type: "CREATE" }, { counter: 2 });
        });
    });

    describe("action names", () => {
        const flush = () => Promise.resolve();

        it("appends the action name to the type", async () => {
            const { extension, connection } = createMockExtension();
            const dt = reduxDevtools({ driver: extension, batchStrategy: "microtask" });
            const updater = dt.state("counter", 0);

            await flush();
            connection.send.mockClear();

            updater(1, "success");
            await flush();

            expect(connection.send).toHaveBeenCalledWith({ type: "UPDATE: success" }, { counter: 1 });
        });

        it("keeps the first name of a key within one batch", async () => {
            const { extension, connection } = createMockExtension();
            const dt = reduxDevtools({ driver: extension, batchStrategy: "microtask" });
            const updater = dt.state("counter", 0);

            await flush();
            connection.send.mockClear();

            updater(1, "refresh");
            updater(2, "success");
            await flush();

            expect(connection.send).toHaveBeenCalledWith({ type: "UPDATE: refresh" }, { counter: 2 });
        });

        it("does not carry a name over to the next batch", async () => {
            const { extension, connection } = createMockExtension();
            const dt = reduxDevtools({ driver: extension, batchStrategy: "microtask" });
            const updater = dt.state("counter", 0);

            await flush();
            updater(1, "success");
            await flush();
            connection.send.mockClear();

            updater(2);
            await flush();

            expect(connection.send).toHaveBeenCalledWith({ type: "UPDATE" }, { counter: 2 });
        });

        it("lists the names of every key touched by the batch", async () => {
            const { extension, connection } = createMockExtension();
            const dt = reduxDevtools({ driver: extension, batchStrategy: "microtask" });
            const counter = dt.state("counter", 0);
            const modal = dt.state("modal", "closed");

            await flush();
            connection.send.mockClear();

            counter(1, "success");
            modal("open", "toggle");
            await flush();

            expect(connection.send).toHaveBeenCalledWith(
                { type: "UPDATE: success, toggle" },
                { counter: 1, modal: "open" },
            );
        });

        it("does not pin a name of one key onto a foreign action type", async () => {
            const { extension, connection } = createMockExtension();
            const dt = reduxDevtools({ driver: extension, batchStrategy: "microtask" });
            const counter = dt.state("counter", 0);

            await flush();
            connection.send.mockClear();

            // One batch: a fresh key is created while another one is updated.
            // The label must name both events instead of stamping "success"
            // — which belongs to `counter` — onto a plain CREATE.
            dt.state("modal", "closed");
            counter(1, "success");
            await flush();

            expect(connection.send).toHaveBeenCalledWith(
                { type: "CREATE+UPDATE: success" },
                { counter: 1, modal: "closed" },
            );
        });

        it("keeps the create type when the same key is named right after creation", async () => {
            const { extension, connection } = createMockExtension();
            const dt = reduxDevtools({ driver: extension, batchStrategy: "microtask" });

            const updater = dt.state("counter", 0);
            updater(1, "success");
            await flush();

            expect(connection.send).toHaveBeenCalledWith({ type: "CREATE: success" }, { counter: 1 });
        });

        it("reports a cleared key alongside a named update", async () => {
            const { extension, connection } = createMockExtension();
            const dt = reduxDevtools({ driver: extension, batchStrategy: "microtask" });
            const counter = dt.state("counter", 0);
            const modal = dt.state("modal", "closed");

            await flush();
            connection.send.mockClear();

            counter(1, "success");
            modal("$COMPLETED" as any);
            await flush();

            expect(connection.send).toHaveBeenCalledWith({ type: "UPDATE+CLEAR: success" }, { counter: 1 });
        });

        it("deduplicates identical names", async () => {
            const { extension, connection } = createMockExtension();
            const dt = reduxDevtools({ driver: extension, batchStrategy: "microtask" });
            const a = dt.state("a", 0);
            const b = dt.state("b", 0);

            await flush();
            connection.send.mockClear();

            a(1, "success");
            b(1, "success");
            await flush();

            expect(connection.send).toHaveBeenCalledWith({ type: "UPDATE: success" }, { a: 1, b: 1 });
        });

        it("caps the name list and reports the remainder", async () => {
            const { extension, connection } = createMockExtension();
            const dt = reduxDevtools({ driver: extension, batchStrategy: "microtask" });
            const names = ["n1", "n2", "n3", "n4", "n5", "n6", "n7"];
            const updaters = names.map((name) => dt.state(name, 0));

            await flush();
            connection.send.mockClear();

            updaters.forEach((updater, i) => updater(1, names[i]));
            await flush();

            expect(connection.send.mock.calls[0][0]).toEqual({ type: "UPDATE: n1, n2, n3, n4, n5 +2 more" });
        });

        it("treats an empty name as no name", async () => {
            const { extension, connection } = createMockExtension();
            const dt = reduxDevtools({ driver: extension, batchStrategy: "microtask" });
            const updater = dt.state("counter", 0);

            await flush();
            connection.send.mockClear();

            // An empty string must not occupy the first-wins slot of the key,
            // or the real name right behind it would be swallowed.
            updater(1, "");
            updater(2, "success");
            await flush();

            expect(connection.send).toHaveBeenCalledWith({ type: "UPDATE: success" }, { counter: 2 });
        });

        it("reports a recreated key alongside a named update", async () => {
            const { extension, connection } = createMockExtension();
            const dt = reduxDevtools({ driver: extension, batchStrategy: "microtask" });
            const counter = dt.state("counter", 0);
            dt.state("modal", "closed");

            await flush();
            connection.send.mockClear();

            dt.state("modal", "reopened");
            counter(1, "success");
            await flush();

            expect(connection.send).toHaveBeenCalledWith(
                { type: "RECREATE+UPDATE: success" },
                { counter: 1, modal: "reopened" },
            );
        });

        it("reports a key cleared and re-created within one batch as a create", async () => {
            const { extension, connection } = createMockExtension();
            const dt = reduxDevtools({ driver: extension, batchStrategy: "microtask" });
            const owner = dt.state("counter", 0);

            await flush();
            connection.send.mockClear();

            owner("$COMPLETED" as any);
            dt.state("counter", 42);
            await flush();

            expect(connection.send).toHaveBeenCalledWith({ type: "CREATE" }, { counter: 42 });
        });

        it("does not add the remainder tail at exactly the cap", async () => {
            const { extension, connection } = createMockExtension();
            const dt = reduxDevtools({ driver: extension, batchStrategy: "microtask" });
            const names = ["n1", "n2", "n3", "n4", "n5"];
            const updaters = names.map((name) => dt.state(name, 0));

            await flush();
            connection.send.mockClear();

            updaters.forEach((updater, i) => updater(1, names[i]));
            await flush();

            expect(connection.send.mock.calls[0][0]).toEqual({ type: "UPDATE: n1, n2, n3, n4, n5" });
        });
    });
});
