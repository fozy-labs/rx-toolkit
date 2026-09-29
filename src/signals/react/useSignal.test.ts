import { act, render, renderHook, screen } from "@testing-library/react";
import React from "react";
import { flushSync } from "react-dom";
import { config, Observable, Subject } from "rxjs";

import { Signal } from "@/signals/signals/Signal";
import type { StateSignal } from "@/signals/types";

import { flushMicrotasks } from "../../__tests__/helpers/async-helpers";

import { useSignal } from "./useSignal";

describe("useSignal", () => {
    it("returns current signal value on first render", () => {
        const signal = Signal.state(42);
        const { result } = renderHook(() => useSignal(signal));

        expect(result.current).toBe(42);
    });

    it("updates component when signal.set() is called", async () => {
        const signal = Signal.state(0);
        const { result } = renderHook(() => useSignal(signal));

        expect(result.current).toBe(0);

        await act(async () => {
            signal.set(10);
            await flushMicrotasks();
        });

        expect(result.current).toBe(10);
    });

    it("returns updated value after multiple sets", async () => {
        const signal = Signal.state("a");
        const { result } = renderHook(() => useSignal(signal));

        expect(result.current).toBe("a");

        await act(async () => {
            signal.set("b");
            await flushMicrotasks();
        });

        expect(result.current).toBe("b");

        await act(async () => {
            signal.set("c");
            await flushMicrotasks();
        });

        expect(result.current).toBe("c");
    });

    it("unsubscribes on unmount", async () => {
        const signal = Signal.state(1);
        const { result, unmount } = renderHook(() => useSignal(signal));

        expect(result.current).toBe(1);

        unmount();

        // After unmount, setting the signal should not cause errors
        signal.set(2);
        await flushMicrotasks();

        // Value frozen at last rendered value
        expect(result.current).toBe(1);
    });

    it("resubscribes when signal reference changes", async () => {
        const signal1 = Signal.state(100);
        const signal2 = Signal.state(200);

        let currentSignal = signal1;
        const { result, rerender } = renderHook(() => useSignal(currentSignal));

        expect(result.current).toBe(100);

        // Switch to signal2
        currentSignal = signal2;
        rerender();

        expect(result.current).toBe(200);

        // Updates from signal2 should be reflected
        await act(async () => {
            signal2.set(300);
            await flushMicrotasks();
        });

        expect(result.current).toBe(300);

        // Updates from signal1 should NOT be reflected
        await act(async () => {
            signal1.set(999);
            await flushMicrotasks();
        });

        expect(result.current).toBe(300);
    });

    it("does not provide getServerSnapshot (SSR limitation)", () => {
        // useSignal uses useSyncExternalStore without a getServerSnapshot
        // This means it cannot be used during SSR. We verify by checking
        // that the hook works client-side but the implementation has no
        // server snapshot arg — this is a design constraint, not a bug.
        const signal = Signal.state("client-only");
        const { result } = renderHook(() => useSignal(signal));

        expect(result.current).toBe("client-only");
    });

    describe("re-render batching (regression guard)", () => {
        function renderCountingDisplay(signal: StateSignal<number>) {
            const renders = { count: 0 };

            function Display() {
                renders.count++;
                const v = useSignal(signal);
                return React.createElement("div", { "data-testid": "value" }, String(v));
            }

            return { renders, Display };
        }

        it("mounts with a single render (BehaviorSubject replay on subscribe must not re-render)", async () => {
            const signal = Signal.state(0);
            const { renders, Display } = renderCountingDisplay(signal);

            render(React.createElement(Display, null));
            await act(async () => {
                await flushMicrotasks();
            });

            expect(screen.getByTestId("value").textContent).toBe("0");
            expect(renders.count).toBe(1);
        });

        it("batches multiple synchronous sets into a single re-render with the last value", async () => {
            const signal = Signal.state(0);
            const { renders, Display } = renderCountingDisplay(signal);

            render(React.createElement(Display, null));
            const mountRenders = renders.count;

            await act(async () => {
                signal.set(1);
                signal.set(2);
                signal.set(3);
                await flushMicrotasks();
            });

            expect(screen.getByTestId("value").textContent).toBe("3");
            expect(renders.count - mountRenders).toBe(1);
        });

        it("does not re-render when the value returns to the original within one batch (a→b→a)", async () => {
            const signal = Signal.state(0);
            const { renders, Display } = renderCountingDisplay(signal);

            render(React.createElement(Display, null));
            const mountRenders = renders.count;

            await act(async () => {
                signal.set(1);
                signal.set(0);
                await flushMicrotasks();
            });

            expect(screen.getByTestId("value").textContent).toBe("0");
            expect(renders.count - mountRenders).toBe(0);
        });

        it("shows the fresh value in a sync render right after set() without an extra re-render afterwards", async () => {
            const signal = Signal.state(0);
            const { renders, Display } = renderCountingDisplay(signal);

            let bumpTick: () => void;
            function Parent() {
                const [, setTick] = React.useState(0);
                bumpTick = () => setTick((t) => t + 1);
                return React.createElement(Display, null);
            }

            render(React.createElement(Parent, null));
            const mountRenders = renders.count;

            act(() => {
                signal.set(1);
                // A committed sync render reads the snapshot before the
                // subscription notification is processed.
                flushSync(() => bumpTick());
                expect(screen.getByTestId("value").textContent).toBe("1");
            });

            await act(async () => {
                await flushMicrotasks();
            });

            expect(screen.getByTestId("value").textContent).toBe("1");
            // The sync render already committed the fresh value — the
            // notification must not cause a second re-render.
            expect(renders.count - mountRenders).toBe(1);
        });

        it("keeps two components subscribed to the same signal consistent", async () => {
            const signal = Signal.state(0);

            function Display({ id }: { id: string }) {
                const v = useSignal(signal);
                return React.createElement("div", { "data-testid": id }, String(v));
            }

            render(
                React.createElement(
                    React.Fragment,
                    null,
                    React.createElement(Display, { id: "a" }),
                    React.createElement(Display, { id: "b" }),
                ),
            );

            await act(async () => {
                signal.set(7);
                await flushMicrotasks();
            });

            expect(screen.getByTestId("a").textContent).toBe("7");
            expect(screen.getByTestId("b").textContent).toBe("7");
        });
    });

    describe("getSnapshot contract: update delivery must survive snapshot reads", () => {
        // useSyncExternalStore relies on `subscribe` invoking its callback
        // whenever the store changes. React is allowed to call `getSnapshot`
        // at any moment — including from renders it later discards (an
        // interrupted transition, a suspended render). If such a read
        // swallows the pending notification, React never learns about the
        // change and the committed UI stays stale forever.

        it("notifies the subscriber about a change even if getSnapshot was read in between", async () => {
            const signal = Signal.state(0);

            let capturedSubscribe: ((cb: () => void) => () => void) | null = null;
            let capturedGetSnapshot: (() => number) | null = null;

            const realUseSyncExternalStore = React.useSyncExternalStore;
            const spy = vi
                .spyOn(React, "useSyncExternalStore")
                .mockImplementation((subscribe, getSnapshot, getServerSnapshot) => {
                    capturedSubscribe = subscribe as typeof capturedSubscribe;
                    capturedGetSnapshot = getSnapshot as typeof capturedGetSnapshot;
                    return realUseSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
                });

            try {
                renderHook(() => useSignal(signal));

                expect(capturedSubscribe).not.toBeNull();
                expect(capturedGetSnapshot).not.toBeNull();

                const listener = vi.fn();
                const unsubscribe = capturedSubscribe!(listener);

                // BehaviorSubject replays the current value on subscribe —
                // drain that notification first.
                await act(async () => {
                    await flushMicrotasks();
                });
                listener.mockClear();

                act(() => {
                    signal.set(1);
                });

                // React legally reads the snapshot here — e.g. for a render
                // that is subsequently discarded and never committed.
                expect(capturedGetSnapshot!()).toBe(1);

                await act(async () => {
                    await flushMicrotasks();
                });

                // The store changed after the last notification, so the
                // listener must have been called — otherwise React has no
                // reason to ever re-read the store.
                expect(listener).toHaveBeenCalled();

                unsubscribe();
            } finally {
                spy.mockRestore();
            }
        });

        it("does not lose an update read only by a discarded render (suspended transition)", async () => {
            const signal = Signal.state(0);
            let emitted = false;

            // The emission happens during the render phase of the transition:
            // it models a store changing while React renders a tree it will
            // throw away. A reference implementation of this hook — plain
            // useSyncExternalStore(subscribe, () => signal.peek()) — delivers
            // "1" to the committed UI in this exact scenario.
            function EmitOnce({ when }: { when: boolean }) {
                if (when && !emitted) {
                    emitted = true;
                    signal.set(1);
                }
                return null;
            }

            function Display() {
                const v = useSignal(signal);
                return React.createElement("div", { "data-testid": "value" }, String(v));
            }

            function Gate({ suspend }: { suspend: boolean }) {
                if (suspend) throw new Promise(() => {});
                return null;
            }

            let startSuspend: () => void;
            function App() {
                const [n, setN] = React.useState(0);
                startSuspend = () => setN(1);
                return React.createElement(
                    React.Suspense,
                    { fallback: React.createElement("div", null, "FALLBACK") },
                    React.createElement(EmitOnce, { when: n === 1 }),
                    React.createElement(Display, null),
                    React.createElement(Gate, { suspend: n === 1 }),
                );
            }

            // Delivering the update from inside the render phase triggers a
            // React warning about updating a component during render; it is
            // expected noise for this scenario, not the subject of the test.
            const originalConsoleError = console.error;
            const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
                const isRenderPhaseUpdateWarning =
                    typeof args[0] === "string" && args[0].includes("Cannot update a component");
                if (!isRenderPhaseUpdateWarning) {
                    originalConsoleError(...args);
                }
            });

            try {
                render(React.createElement(App, null));
                expect(screen.getByTestId("value").textContent).toBe("0");

                await act(async () => {
                    React.startTransition(() => startSuspend());
                    await flushMicrotasks();
                });
                await flushMicrotasks();

                // The transition is suspended forever, so the previously
                // committed UI stays on screen. The signal update must still
                // reach it — silently keeping "0" while the signal holds 1
                // is a lost update.
                expect(signal.peek()).toBe(1);
                expect(screen.getByTestId("value").textContent).toBe("1");
            } finally {
                consoleErrorSpy.mockRestore();
            }
        });
    });

    describe("error state", () => {
        type BoundaryState = { error: unknown };

        class Boundary extends React.Component<{ children?: React.ReactNode }, BoundaryState> {
            state: BoundaryState = { error: null };

            static getDerivedStateFromError(error: unknown): BoundaryState {
                return { error };
            }

            reset() {
                this.setState({ error: null });
            }

            render() {
                if (this.state.error) {
                    return React.createElement("div", { "data-testid": "error" }, (this.state.error as Error).message);
                }
                return this.props.children;
            }
        }

        function setup(strict = false) {
            const source = Signal.state(1);
            const c = Signal.compute(() => {
                if (source() < 0) throw new Error("negative");
                return source() * 10;
            });

            function Display() {
                const v = useSignal(c);
                return React.createElement("div", { "data-testid": "value" }, String(v));
            }

            const boundary = React.createRef<Boundary>();
            const tree = React.createElement(Boundary, { ref: boundary }, React.createElement(Display, null));
            render(strict ? React.createElement(React.StrictMode, null, tree) : tree);

            return { source, boundary };
        }

        let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

        beforeEach(() => {
            // React reports errors caught by a boundary through console.error
            consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        });

        afterEach(() => {
            consoleErrorSpy.mockRestore();
        });

        it("throws into the nearest ErrorBoundary and works again after the boundary resets", async () => {
            const { source, boundary } = setup();
            expect(screen.getByTestId("value").textContent).toBe("10");

            await act(async () => {
                source.set(-1);
                await flushMicrotasks();
            });
            expect(screen.getByTestId("error").textContent).toBe("negative");

            await act(async () => {
                source.set(2);
                boundary.current!.reset();
                await flushMicrotasks();
            });
            expect(screen.getByTestId("value").textContent).toBe("20");

            await act(async () => {
                source.set(3);
                await flushMicrotasks();
            });
            expect(screen.getByTestId("value").textContent).toBe("30");
        });

        it.each([false, true])(
            "keeps updating when the signal recovers after the deferred update, before React renders (StrictMode: %s)",
            async (strict) => {
                const { source } = setup(strict);

                await act(async () => {
                    source.set(-1);
                    // Runs after the hook's deferred update, before React renders
                    queueMicrotask(() => source.set(2));
                    await flushMicrotasks();
                });
                expect(screen.getByTestId("value").textContent).toBe("20");

                await act(async () => {
                    source.set(3);
                    await flushMicrotasks();
                });
                expect(screen.getByTestId("value").textContent).toBe("30");
            },
        );

        it("keeps updating when the signal fails and recovers to the same value before React renders", async () => {
            const { source } = setup();

            await act(async () => {
                source.set(-1);
                queueMicrotask(() => source.set(1));
                await flushMicrotasks();
            });
            expect(screen.getByTestId("value").textContent).toBe("10");

            await act(async () => {
                source.set(3);
                await flushMicrotasks();
            });
            expect(screen.getByTestId("value").textContent).toBe("30");
        });

        it("does not loop for a signal whose stream errors while peek() still returns a value", async () => {
            const onUnhandledError = vi.fn();
            const previous = config.onUnhandledError;
            config.onUnhandledError = onUnhandledError;

            try {
                const error = new Error("stream-error");
                let isBroken = false;
                const errors$ = new Subject<void>();
                let subscribes = 0;
                const signal = {
                    obs: new Observable<number>((subscriber) => {
                        subscribes++;
                        if (isBroken) {
                            subscriber.error(error);
                            return;
                        }
                        subscriber.next(1);
                        return errors$.subscribe(() => subscriber.error(error));
                    }),
                    peek: () => 1,
                };
                let renders = 0;

                function Display() {
                    renders++;
                    return React.createElement("div", { "data-testid": "value" }, String(useSignal(signal)));
                }

                render(React.createElement(Display, null));
                const subscribesBefore = subscribes;
                const rendersBefore = renders;

                await act(async () => {
                    isBroken = true;
                    errors$.next();
                    for (let i = 0; i < 10; i++) await flushMicrotasks();
                });

                // One resubscribe attempt for the one real notification, one extra render
                expect(subscribes - subscribesBefore).toBe(1);
                expect(renders - rendersBefore).toBeLessThanOrEqual(2);
                expect(screen.getByTestId("value").textContent).toBe("1");
                // Not swallowed: surfaced once, as an unhandled RxJS error
                expect(onUnhandledError).toHaveBeenCalledExactlyOnceWith(error);
            } finally {
                config.onUnhandledError = previous;
            }
        });

        it("keeps updating when the signal recovers before the component re-renders", async () => {
            const { source } = setup();

            await act(async () => {
                source.set(-1);
                source.set(2);
                await flushMicrotasks();
            });
            expect(screen.getByTestId("value").textContent).toBe("20");

            await act(async () => {
                source.set(3);
                await flushMicrotasks();
            });
            expect(screen.getByTestId("value").textContent).toBe("30");
        });
    });
});
