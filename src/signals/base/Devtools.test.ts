import { SharedOptions } from "@/common/options/SharedOptions";

import { Devtools } from "./Devtools";
import { Indexer } from "./Indexer";

describe("Devtools", () => {
    describe("createState()", () => {
        it("returns null when SharedOptions.DEVTOOLS is null", () => {
            SharedOptions.DEVTOOLS = null;
            const result = Devtools.createState(0);
            expect(result).toBeNull();
        });

        it("creates and returns DevtoolsStateLike when devtools is set", () => {
            const mockStateFn = vi.fn();
            const mockCreateState = vi.fn(() => mockStateFn);
            SharedOptions.DEVTOOLS = { state: mockCreateState };

            const devtoolsState = Devtools.createState(42, { key: "test" });

            expect(devtoolsState).toBeTypeOf("function");
            expect(mockCreateState).toHaveBeenCalledOnce();

            // Calling the returned function should forward to the mock
            devtoolsState!(100);
            expect(mockStateFn).toHaveBeenCalledWith(100);
        });

        it("returns null when options.isDisabled is true", () => {
            const mockCreateState = vi.fn(() => vi.fn());
            SharedOptions.DEVTOOLS = { state: mockCreateState };

            const result = Devtools.createState(0, { isDisabled: true });
            expect(result).toBeNull();
        });

        it("accepts string options as name", () => {
            const mockStateFn = vi.fn();
            const mockCreateState = vi.fn(() => mockStateFn);
            SharedOptions.DEVTOOLS = { state: mockCreateState };

            const devtoolsState = Devtools.createState("hello", "mySignal");
            expect(devtoolsState).toBeTypeOf("function");
            expect(mockCreateState).toHaveBeenCalledOnce();

            // Key should include 'mySignal'
            const key = (mockCreateState.mock.calls[0] as unknown as [string])[0];
            expect(key).toContain("mySignal");
        });

        it("handles beforeDevtoolsPush — skips initial value via filtering", () => {
            const mockStateFn = vi.fn();
            const mockCreateState = vi.fn(() => mockStateFn);
            SharedOptions.DEVTOOLS = { state: mockCreateState };

            const devtoolsState = Devtools.createState<number | null>(null, {
                beforeDevtoolsPush: (value, push) => {
                    if (value !== null) push(value);
                },
            });

            // createState should not have been called since initial value is skipped
            expect(mockCreateState).not.toHaveBeenCalled();
            // But we still get a function (lazy init)
            expect(devtoolsState).toBeTypeOf("function");

            // Calling with a non-skip value should lazily create
            devtoolsState!(42 as number | null);
            expect(mockCreateState).toHaveBeenCalledOnce();
        });

        it("handles beforeDevtoolsPush — skips update via filtering", () => {
            const mockStateFn = vi.fn();
            const mockCreateState = vi.fn(() => mockStateFn);
            SharedOptions.DEVTOOLS = { state: mockCreateState };

            const devtoolsState = Devtools.createState<number | null>(1, {
                beforeDevtoolsPush: (value, push) => {
                    if (value !== null) push(value);
                },
            });
            expect(mockCreateState).toHaveBeenCalledOnce();

            // Calling with a skip value should not forward
            devtoolsState!(null as number | null);
            expect(mockStateFn).not.toHaveBeenCalled();
        });
    });

    describe("hasDevtools", () => {
        it("returns false when DEVTOOLS is null", () => {
            SharedOptions.DEVTOOLS = null;
            expect(Devtools.hasDevtools).toBe(false);
        });

        it("returns true when DEVTOOLS.state is set", () => {
            SharedOptions.DEVTOOLS = { state: vi.fn() };
            expect(Devtools.hasDevtools).toBe(true);
        });
    });

    describe("key generation", () => {
        it("generates unique keys via Indexer", () => {
            const keys: string[] = [];
            const mockCreateState = vi.fn((key: string) => {
                keys.push(key);
                return vi.fn();
            });
            SharedOptions.DEVTOOLS = { state: mockCreateState };

            Devtools.createState(1, { key: "a" });
            Devtools.createState(2, { key: "b" });

            expect(keys).toHaveLength(2);
            expect(keys[0]).not.toBe(keys[1]);
        });

        it("replaces {scope} placeholder with scope name", () => {
            const keys: string[] = [];
            const mockCreateState = vi.fn((key: string) => {
                keys.push(key);
                return vi.fn();
            });
            SharedOptions.DEVTOOLS = { state: mockCreateState };
            SharedOptions.getScopeName = () => "myScope";

            Devtools.createState(1, { key: "pre-{scope}-post" });

            expect(keys[0]).toContain("myScope");
        });

        it("replaces {base} placeholder with base option", () => {
            const keys: string[] = [];
            const mockCreateState = vi.fn((key: string) => {
                keys.push(key);
                return vi.fn();
            });
            SharedOptions.DEVTOOLS = { state: mockCreateState };

            Devtools.createState(1, { key: "{base}/signal", base: "State" });

            expect(keys[0]).toContain("State");
        });
    });

    describe("createSignalHooks()", () => {
        it("returns SignalLifecycleHook when DEVTOOLS is set", () => {
            const mockStateFn = vi.fn();
            const mockCreateState = vi.fn(() => mockStateFn);
            SharedOptions.DEVTOOLS = { state: mockCreateState };

            const hook = Devtools.createSignalHooks(42, { key: "test" });

            expect(hook).not.toBeNull();
            expect(hook!.onChange).toBeTypeOf("function");
            expect(hook!.onDispose).toBeTypeOf("function");
        });

        it("returns null when DEVTOOLS is null", () => {
            SharedOptions.DEVTOOLS = null;
            const hook = Devtools.createSignalHooks(0);
            expect(hook).toBeNull();
        });

        it("returns null when isDisabled is true", () => {
            SharedOptions.DEVTOOLS = { state: vi.fn(() => vi.fn()) };
            const hook = Devtools.createSignalHooks(0, { isDisabled: true });
            expect(hook).toBeNull();
        });

        it("init calls DEVTOOLS.state() via createState delegation", () => {
            const mockStateFn = vi.fn();
            const mockCreateState = vi.fn(() => mockStateFn);
            SharedOptions.DEVTOOLS = { state: mockCreateState };

            Devtools.createSignalHooks(42, { key: "test" });

            expect(mockCreateState).toHaveBeenCalledOnce();
            expect((mockCreateState.mock.calls[0] as unknown as [unknown, unknown])[1]).toBe(42);
        });

        it("onChange calls stateDevtools function", () => {
            const mockStateFn = vi.fn();
            const mockCreateState = vi.fn(() => mockStateFn);
            SharedOptions.DEVTOOLS = { state: mockCreateState };

            const hook = Devtools.createSignalHooks(0, { key: "test" });
            hook!.onChange!(100);

            expect(mockStateFn).toHaveBeenCalledWith(100);
        });

        it("onDispose sends $COMPLETED", () => {
            const mockStateFn = vi.fn();
            const mockCreateState = vi.fn(() => mockStateFn);
            SharedOptions.DEVTOOLS = { state: mockCreateState };

            const hook = Devtools.createSignalHooks(0, { key: "test" });
            hook!.onDispose!();

            expect(mockStateFn).toHaveBeenCalledWith("$COMPLETED");
        });

        it("generates unique keys via Indexer", () => {
            const keys: string[] = [];
            const mockCreateState = vi.fn((key: string) => {
                keys.push(key);
                return vi.fn();
            });
            SharedOptions.DEVTOOLS = { state: mockCreateState };

            Devtools.createSignalHooks(1, { key: "a" });
            Devtools.createSignalHooks(2, { key: "b" });

            expect(keys).toHaveLength(2);
            expect(keys[0]).not.toBe(keys[1]);
        });

        it("replaces {scope} placeholder", () => {
            const keys: string[] = [];
            const mockCreateState = vi.fn((key: string) => {
                keys.push(key);
                return vi.fn();
            });
            SharedOptions.DEVTOOLS = { state: mockCreateState };
            SharedOptions.getScopeName = () => "myScope";

            Devtools.createSignalHooks(1, { key: "pre-{scope}-post" });

            expect(keys[0]).toContain("myScope");
        });

        it("replaces {base} placeholder", () => {
            const keys: string[] = [];
            const mockCreateState = vi.fn((key: string) => {
                keys.push(key);
                return vi.fn();
            });
            SharedOptions.DEVTOOLS = { state: mockCreateState };

            Devtools.createSignalHooks(1, { key: "{base}/signal", base: "State" });

            expect(keys[0]).toContain("State");
        });

        describe("with beforeDevtoolsPush", () => {
            it("init — filtering skips createState init", () => {
                const mockStateFn = vi.fn();
                const mockCreateState = vi.fn(() => mockStateFn);
                SharedOptions.DEVTOOLS = { state: mockCreateState };

                const hook = Devtools.createSignalHooks<number | null>(null, {
                    key: "test",
                    beforeDevtoolsPush: (value: number | null, push: (v: number | null) => void) => {
                        if (value !== null) push(value);
                    },
                });

                expect(hook).not.toBeNull();
                expect(mockCreateState).not.toHaveBeenCalled();
            });

            it("onChange — lazy init on first push", () => {
                const mockStateFn = vi.fn();
                const mockCreateState = vi.fn(() => mockStateFn);
                SharedOptions.DEVTOOLS = { state: mockCreateState };

                const hook = Devtools.createSignalHooks<number | null>(null, {
                    key: "test",
                    beforeDevtoolsPush: (value: number | null, push: (v: number | null) => void) => {
                        if (value !== null) push(value);
                    },
                });

                hook!.onChange!(42);
                expect(mockCreateState).toHaveBeenCalledOnce();
            });

            it("onChange — transforms value", () => {
                const mockStateFn = vi.fn();
                const mockCreateState = vi.fn(() => mockStateFn);
                SharedOptions.DEVTOOLS = { state: mockCreateState };

                const hook = Devtools.createSignalHooks<number>(0, {
                    key: "test",
                    beforeDevtoolsPush: (value: number, push: (v: number) => void) => {
                        push(value * 2);
                    },
                });

                hook!.onChange!(5);
                expect(mockStateFn).toHaveBeenCalledWith(10);
            });

            it("onDispose works independently", () => {
                const mockStateFn = vi.fn();
                const mockCreateState = vi.fn(() => mockStateFn);
                SharedOptions.DEVTOOLS = { state: mockCreateState };

                const hook = Devtools.createSignalHooks(1, {
                    key: "test",
                    beforeDevtoolsPush: (value: number, push: (v: number) => void) => {
                        push(value);
                    },
                });

                hook!.onDispose!();
                expect(mockStateFn).toHaveBeenCalledWith("$COMPLETED");
            });

            it("onDispose without prior push — no error", () => {
                const mockStateFn = vi.fn();
                const mockCreateState = vi.fn(() => mockStateFn);
                SharedOptions.DEVTOOLS = { state: mockCreateState };

                const hook = Devtools.createSignalHooks<number | null>(null, {
                    key: "test",
                    beforeDevtoolsPush: (value: number | null, push: (v: number | null) => void) => {
                        if (value !== null) push(value);
                    },
                });

                // stateDevtools was never created (filtered on init, never called onChange)
                // onDispose should still work — calling the returned fn from createState
                expect(() => hook!.onDispose!()).not.toThrow();
            });
        });
    });
});
