import { Batcher } from "./Batcher";

describe("Batcher", () => {
    describe("run(fn)", () => {
        it("executes fn and returns its result", () => {
            const result = Batcher.run(() => 42);
            expect(result).toBe(42);
        });

        it("schedules and executes Scheduled tasks during batch", () => {
            const order: string[] = [];
            const s = Batcher.scheduler(0);

            Batcher.run(() => {
                // Inside run, isLocked is true, so schedule defers
                s.schedule(() => order.push("scheduled"));
                order.push("fn");
            });

            // fn runs first, then scheduled tasks run before run() returns
            expect(order).toEqual(["fn", "scheduled"]);
        });

        it("nested run() executes fn directly without re-batching", () => {
            const order: string[] = [];
            const s = Batcher.scheduler(0);

            Batcher.run(() => {
                order.push("outer-start");
                // Nested run — isLocked already true, so fn executes directly
                const innerResult = Batcher.run(() => {
                    order.push("inner");
                    return "inner-val";
                });
                expect(innerResult).toBe("inner-val");
                s.schedule(() => order.push("scheduled"));
                order.push("outer-end");
            });

            expect(order).toEqual(["outer-start", "inner", "outer-end", "scheduled"]);
        });

        it("handles empty batch (no scheduled tasks)", () => {
            const result = Batcher.run(() => "ok");
            expect(result).toBe("ok");
        });

        it("resets isLocked after fn throws (try/finally fix)", () => {
            expect(() =>
                Batcher.run(() => {
                    throw new Error("boom");
                }),
            ).toThrow("boom");

            // If isLocked was not reset, this would execute fn directly (nested path)
            // and never schedule tasks. Verify scheduling works:
            const scheduled = vi.fn();
            const s = Batcher.scheduler(0);
            Batcher.run(() => {
                s.schedule(scheduled);
            });
            expect(scheduled).toHaveBeenCalled();
        });

        it("propagates error from fn upward", () => {
            expect(() =>
                Batcher.run(() => {
                    throw new Error("test-error");
                }),
            ).toThrow("test-error");
        });

        it("continues working after error", () => {
            expect(() =>
                Batcher.run(() => {
                    throw new Error("fail");
                }),
            ).toThrow();

            const order: string[] = [];
            const s = Batcher.scheduler(0);
            Batcher.run(() => {
                s.schedule(() => order.push("after-error-scheduled"));
                order.push("after-error-fn");
            });
            expect(order).toEqual(["after-error-fn", "after-error-scheduled"]);
        });

        it("drops tasks scheduled before fn throws (does not leak into next batch)", () => {
            const leaked = vi.fn();
            const s = Batcher.scheduler(0);

            // Case A: fn queues a task, then throws before Scheduled.run() flushes.
            expect(() =>
                Batcher.run(() => {
                    s.schedule(leaked);
                    throw new Error("boom");
                }),
            ).toThrow("boom");

            // Next unrelated batch must not flush the stale task.
            const nextBatch = vi.fn();
            const s2 = Batcher.scheduler(0);
            Batcher.run(() => {
                s2.schedule(nextBatch);
            });

            expect(leaked).not.toHaveBeenCalled();
            expect(nextBatch).toHaveBeenCalledOnce();
        });

        it("drops higher-rang tasks when a scheduled task throws during flush", () => {
            const higherRang = vi.fn();
            const s0 = Batcher.scheduler(0);
            const s1 = Batcher.scheduler(1);

            // Case B: a rang-0 task throws mid-flush; a rang-1 task is still queued.
            expect(() =>
                Batcher.run(() => {
                    s1.schedule(higherRang);
                    s0.schedule(() => {
                        throw new Error("flush-boom");
                    });
                }),
            ).toThrow("flush-boom");

            // The un-run higher-rang task must not leak into the next unrelated batch.
            const nextBatch = vi.fn();
            const s = Batcher.scheduler(0);
            Batcher.run(() => {
                s.schedule(nextBatch);
            });

            expect(higherRang).not.toHaveBeenCalled();
            expect(nextBatch).toHaveBeenCalledOnce();
        });
    });

    describe("scheduler(rang)", () => {
        it("returns an object with schedule method", () => {
            const s = Batcher.scheduler(0);
            expect(s).toHaveProperty("schedule");
            expect(typeof s.schedule).toBe("function");
        });

        it("schedule(fn) when not locked executes fn immediately", () => {
            const fn = vi.fn();
            const s = Batcher.scheduler(0);
            s.schedule(fn);
            expect(fn).toHaveBeenCalledOnce();
        });

        it("schedule(fn) when locked defers fn to Scheduled", () => {
            const order: string[] = [];
            const s = Batcher.scheduler(0);

            Batcher.run(() => {
                s.schedule(() => order.push("deferred"));
                order.push("during-run");
            });

            expect(order).toEqual(["during-run", "deferred"]);
        });

        it("rang=0 executes before rang=1", () => {
            const order: number[] = [];
            const s0 = Batcher.scheduler(0);
            const s1 = Batcher.scheduler(1);

            Batcher.run(() => {
                s1.schedule(() => order.push(1));
                s0.schedule(() => order.push(0));
            });

            expect(order).toEqual([0, 1]);
        });

        it("rang=Infinity executes last", () => {
            const order: string[] = [];
            const sInf = Batcher.scheduler(Infinity);
            const s0 = Batcher.scheduler(0);
            const s1 = Batcher.scheduler(1);

            Batcher.run(() => {
                sInf.schedule(() => order.push("inf"));
                s1.schedule(() => order.push("1"));
                s0.schedule(() => order.push("0"));
            });

            expect(order).toEqual(["0", "1", "inf"]);
        });
    });
});
