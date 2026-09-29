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

        it("flushes tasks queued before fn throws, then rethrows fn's error", () => {
            const queued = vi.fn();
            const s = Batcher.scheduler(0);

            // fn already wrote state and queued its reactions: they must run in
            // this batch, not be dropped (reactions out of sync) or leak into the next one.
            expect(() =>
                Batcher.run(() => {
                    s.schedule(queued);
                    throw new Error("boom");
                }),
            ).toThrow("boom");
            expect(queued).toHaveBeenCalledOnce();

            const nextBatch = vi.fn();
            Batcher.run(() => {
                s.schedule(nextBatch);
            });

            expect(queued).toHaveBeenCalledOnce();
            expect(nextBatch).toHaveBeenCalledOnce();
        });

        it("runs every remaining task when a task throws, then rethrows its error", () => {
            const order: string[] = [];
            const s0 = Batcher.scheduler(0);
            const s1 = Batcher.scheduler(1);
            const sInf = Batcher.scheduler(Infinity);

            expect(() =>
                Batcher.run(() => {
                    sInf.schedule(() => order.push("inf"));
                    s1.schedule(() => order.push("1"));
                    s0.schedule(() => {
                        order.push("0-throws");
                        throw new Error("flush-boom");
                    });
                    s0.schedule(() => order.push("0"));
                }),
            ).toThrow("flush-boom");

            expect(order).toEqual(["0-throws", "0", "1", "inf"]);

            // The queue is fully reset: nothing runs twice in the next batch.
            const nextBatch = vi.fn();
            Batcher.run(() => {
                s0.schedule(nextBatch);
            });
            expect(order).toEqual(["0-throws", "0", "1", "inf"]);
            expect(nextBatch).toHaveBeenCalledOnce();
        });

        it("rethrows the first error when several tasks throw", () => {
            const s0 = Batcher.scheduler(0);
            const s1 = Batcher.scheduler(1);
            const first = new Error("first");

            let caught: unknown;
            try {
                Batcher.run(() => {
                    s1.schedule(() => {
                        throw new Error("second");
                    });
                    s0.schedule(() => {
                        throw first;
                    });
                });
            } catch (error) {
                caught = error;
            }

            expect(caught).toBe(first);
        });

        it("rethrows fn's error even when a task throws too", () => {
            const s0 = Batcher.scheduler(0);
            const task = vi.fn(() => {
                throw new Error("task-error");
            });

            expect(() =>
                Batcher.run(() => {
                    s0.schedule(task);
                    throw new Error("fn-error");
                }),
            ).toThrow("fn-error");
            expect(task).toHaveBeenCalledOnce();
        });

        it("keeps a task error for the outermost run: a nested run does not flush", () => {
            const s0 = Batcher.scheduler(0);
            const after = vi.fn();

            expect(() =>
                Batcher.run(() => {
                    Batcher.run(() => {
                        s0.schedule(() => {
                            throw new Error("task-error");
                        });
                    });
                    after();
                }),
            ).toThrow("task-error");
            expect(after).toHaveBeenCalledOnce();
        });

        it("runs finite-rang tasks scheduled by an Infinity task mid-flush", () => {
            // The Infinity terminal path must re-check the queue, mirroring the
            // normal loop: work scheduled while flushing Infinity tasks (e.g. a
            // devtools flush that mutates a signal) must not be dropped.
            const order: string[] = [];
            const sInf = Batcher.scheduler(Infinity);
            const s0 = Batcher.scheduler(0);

            Batcher.run(() => {
                sInf.schedule(() => {
                    order.push("inf");
                    s0.schedule(() => order.push("rescheduled-finite"));
                });
            });

            expect(order).toEqual(["inf", "rescheduled-finite"]);
        });

        it("runs an Infinity task rescheduled during the Infinity flush", () => {
            const order: string[] = [];
            const sInf = Batcher.scheduler(Infinity);
            let rescheduled = false;

            Batcher.run(() => {
                sInf.schedule(() => {
                    order.push("inf");
                    if (!rescheduled) {
                        rescheduled = true;
                        sInf.schedule(() => order.push("inf-2"));
                    }
                });
            });

            expect(order).toEqual(["inf", "inf-2"]);
        });

        it("does not leak mid-flush Infinity-scheduled tasks into the next batch", () => {
            const order: string[] = [];
            const sInf = Batcher.scheduler(Infinity);
            const s0 = Batcher.scheduler(0);

            Batcher.run(() => {
                sInf.schedule(() => {
                    order.push("inf");
                    s0.schedule(() => order.push("rescheduled-finite"));
                });
            });

            // Second unrelated batch: the flushed queue must be fully reset.
            const nextBatch = vi.fn();
            const s = Batcher.scheduler(0);
            Batcher.run(() => {
                s.schedule(nextBatch);
            });

            expect(order).toEqual(["inf", "rescheduled-finite"]);
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
