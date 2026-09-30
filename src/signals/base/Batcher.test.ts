import { Signal } from "../signals/Signal";

import { Batcher } from "./Batcher";

/** An effect over `source` that records its runs and optionally throws. */
function reaction(source: () => number, body: (value: number) => void = () => {}) {
    const runs: number[] = [];
    const effect = Signal.effect(() => {
        const value = source();
        if (runs.length === 0) {
            runs.push(value);
            return;
        }
        runs.push(value);
        body(value);
    });
    return { runs, effect };
}

describe("Batcher", () => {
    describe("run(fn)", () => {
        it("executes fn and returns its result", () => {
            const result = Batcher.run(() => 42);
            expect(result).toBe(42);
        });

        it("runs the reactions of the batch after fn, before run() returns", () => {
            const order: string[] = [];
            const s = Signal.state(0);
            const { effect } = reaction(s, () => order.push("reaction"));

            Batcher.run(() => {
                s.set(1);
                order.push("fn");
            });

            expect(order).toEqual(["fn", "reaction"]);
            effect.unsubscribe();
        });

        it("nested run() executes fn directly; the outer run flushes", () => {
            const order: string[] = [];
            const s = Signal.state(0);
            const { effect } = reaction(s, () => order.push("reaction"));

            Batcher.run(() => {
                order.push("outer-start");
                const innerResult = Batcher.run(() => {
                    order.push("inner");
                    s.set(1);
                    return "inner-val";
                });
                expect(innerResult).toBe("inner-val");
                order.push("outer-end");
            });

            expect(order).toEqual(["outer-start", "inner", "outer-end", "reaction"]);
            effect.unsubscribe();
        });

        it("handles an empty batch", () => {
            const result = Batcher.run(() => "ok");
            expect(result).toBe("ok");
        });

        it("propagates error from fn upward", () => {
            expect(() =>
                Batcher.run(() => {
                    throw new Error("test-error");
                }),
            ).toThrow("test-error");
        });

        it("keeps batching after fn threw", () => {
            expect(() =>
                Batcher.run(() => {
                    throw new Error("fail");
                }),
            ).toThrow();

            const order: string[] = [];
            const s = Signal.state(0);
            const { effect } = reaction(s, () => order.push("after-error-reaction"));
            Batcher.run(() => {
                s.set(1);
                order.push("after-error-fn");
            });
            expect(order).toEqual(["after-error-fn", "after-error-reaction"]);
            effect.unsubscribe();
        });

        it("runs the reactions of writes made before fn threw, then rethrows fn's error", () => {
            const s = Signal.state(0);
            const { runs, effect } = reaction(s);

            // fn already wrote state: its reactions run in this batch, not dropped or leaked into the next one.
            expect(() =>
                Batcher.run(() => {
                    s.set(1);
                    throw new Error("boom");
                }),
            ).toThrow("boom");
            expect(runs).toEqual([0, 1]);

            Batcher.run(() => s.set(2));
            expect(runs).toEqual([0, 1, 2]);
            effect.unsubscribe();
        });

        it("runs every remaining reaction when one throws, then rethrows its error", () => {
            const s = Signal.state(0);
            const first = reaction(s, () => {
                throw new Error("flush-boom");
            });
            const second = reaction(s);

            expect(() => Batcher.run(() => s.set(1))).toThrow("flush-boom");
            expect(first.runs).toEqual([0, 1]);
            expect(second.runs).toEqual([0, 1]);

            // Nothing is left queued: the next batch runs each reaction once.
            expect(() => Batcher.run(() => s.set(2))).toThrow("flush-boom");
            expect(second.runs).toEqual([0, 1, 2]);
            first.effect.unsubscribe();
            second.effect.unsubscribe();
        });

        it("rethrows the first error when several reactions throw", () => {
            const s = Signal.state(0);
            const firstError = new Error("first");
            const first = reaction(s, () => {
                throw firstError;
            });
            const second = reaction(s, () => {
                throw new Error("second");
            });

            let caught: unknown;
            try {
                Batcher.run(() => s.set(1));
            } catch (error) {
                caught = error;
            }

            expect(caught).toBe(firstError);
            first.effect.unsubscribe();
            second.effect.unsubscribe();
        });

        it("rethrows fn's error even when a reaction throws too", () => {
            const s = Signal.state(0);
            const failing = reaction(s, () => {
                throw new Error("reaction-error");
            });

            expect(() =>
                Batcher.run(() => {
                    s.set(1);
                    throw new Error("fn-error");
                }),
            ).toThrow("fn-error");
            expect(failing.runs).toEqual([0, 1]);
            failing.effect.unsubscribe();
        });

        it("keeps a reaction error for the outermost run: a nested run does not flush", () => {
            const s = Signal.state(0);
            const failing = reaction(s, () => {
                throw new Error("reaction-error");
            });
            const after = vi.fn();

            expect(() =>
                Batcher.run(() => {
                    Batcher.run(() => s.set(1));
                    after();
                }),
            ).toThrow("reaction-error");
            expect(after).toHaveBeenCalledOnce();
            failing.effect.unsubscribe();
        });

        it("runs reactions scheduled by a reaction in the same flush", () => {
            const a = Signal.state(0);
            const b = Signal.state(0);
            const order: string[] = [];
            const forward = reaction(a, (v) => {
                order.push("a");
                b.set(v);
            });
            const tail = reaction(b, () => order.push("b"));

            Batcher.run(() => a.set(1));

            expect(order).toEqual(["a", "b"]);
            forward.effect.unsubscribe();
            tail.effect.unsubscribe();
        });
    });
});
