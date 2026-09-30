import {
    // base
    Batcher,
    Computed,
    Devtools,
    Effect,
    FromSignal,
    LocalSignal,
    LocalState,
    // types
    normalizeSignalOptions,
    // proxy
    produce,
    Signal,
    SourceSignal,
    // signals
    State,
    unstable_ProxySignal,
    // react
    useSignal,
} from "@/signals";
import type { SignalLifecycleHook, SignalOptions, SignalOptionsOrKey } from "@/signals";

describe("Signals module exports", () => {
    describe("base", () => {
        it("exports Batcher", () => {
            expect(Batcher).toBeDefined();
            expect(typeof Batcher.run).toBe("function");
        });

        it("exports Devtools", () => {
            expect(Devtools).toBeDefined();
            expect(typeof Devtools.createState).toBe("function");
        });

        it("exports SourceSignal", () => {
            expect(SourceSignal).toBeDefined();
            expect(typeof SourceSignal.create).toBe("function");
        });
    });

    describe("proxy", () => {
        it("exports unstable_ProxySignal", () => {
            expect(unstable_ProxySignal).toBeDefined();
            expect(typeof unstable_ProxySignal.state).toBe("function");
        });

        it("exports produce", () => {
            expect(produce).toBeDefined();
            expect(typeof produce).toBe("function");
        });
    });

    describe("react", () => {
        it("exports useSignal", () => {
            expect(useSignal).toBeDefined();
            expect(typeof useSignal).toBe("function");
        });
    });

    describe("signals", () => {
        it("exports State", () => {
            expect(State).toBeDefined();
            expect(typeof State.create).toBe("function");
        });

        it("exports Computed", () => {
            expect(Computed).toBeDefined();
            expect(typeof Computed.create).toBe("function");
        });

        it("exports Effect", () => {
            expect(Effect).toBeDefined();
            expect(typeof Effect.create).toBe("function");
        });

        it("exports Signal", () => {
            expect(Signal).toBeDefined();
            expect(typeof Signal.state).toBe("function");
            expect(typeof Signal.compute).toBe("function");
            expect(typeof Signal.effect).toBe("function");
            expect(typeof Signal.from).toBe("function");
        });

        it("exports FromSignal", () => {
            expect(FromSignal).toBeDefined();
            expect(typeof FromSignal.create).toBe("function");
        });

        it("exports LocalState", () => {
            expect(LocalState).toBeDefined();
            expect(typeof LocalState).toBe("function"); // class
        });

        it("exports LocalSignal", () => {
            expect(LocalSignal).toBeDefined();
            expect(typeof LocalSignal.state).toBe("function");
        });
    });

    describe("types", () => {
        it("exports normalizeSignalOptions", () => {
            expect(normalizeSignalOptions).toBeDefined();
            expect(typeof normalizeSignalOptions).toBe("function");
        });

        it("exports SignalOptions type", () => {
            const opts: SignalOptions = { key: "test" };
            expect(opts.key).toBe("test");
        });

        it("exports SignalOptionsOrKey type", () => {
            const opts1: SignalOptionsOrKey = "test";
            const opts2: SignalOptionsOrKey = { key: "test" };
            expect(opts1).toBe("test");
            expect(opts2.key).toBe("test");
        });

        it("exports SignalLifecycleHook type", () => {
            const hook: SignalLifecycleHook = { onChange: () => {} };
            expect(hook.onChange).toBeTypeOf("function");
        });
    });
});
