import { Observable, of, Subject } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { flushUnhandledRejections, trackUnhandledRejections } from "@/__tests__/helpers/unhandled-rejections";
import { EmptyStreamError } from "@/query/core/errors";
import { Resource } from "@/query/core/resource/Resource";
import { stableStringify } from "@/query/lib/stableStringify";
import type { IResourceConfig, TQueryStartedContext } from "@/query/types";

// ==================== Helpers ====================

function createResource<TArgs = void, TData = string>(
    overrides: Partial<IResourceConfig<TArgs, TData>> & {
        queryFn: IResourceConfig<TArgs, TData>["queryFn"];
    },
) {
    return new Resource<TArgs, TData>({
        retentionTime: false,
        serializeArgs: stableStringify as (args: TArgs) => string,
        ...overrides,
    });
}

/** A cold observable with subscribe/teardown counters and a handle to the active subscriber. */
function trackedStream<TData>() {
    const state = {
        subscribeCount: 0,
        teardownCount: 0,
        subscriber: null as {
            next: (value: TData) => void;
            error: (error: unknown) => void;
            complete: () => void;
        } | null,
    };

    const stream = new Observable<TData>((subscriber) => {
        state.subscribeCount += 1;
        state.subscriber = subscriber;
        return () => {
            state.teardownCount += 1;
        };
    });

    return { stream, state };
}

// ==================== Stream lifecycle through the entry state ====================

describe("stream queryFn — entry state transitions", () => {
    it("first emission: pending → success", () => {
        const subject = new Subject<string>();
        const resource = createResource({ queryFn: () => subject.asObservable() });

        const entry = resource.getEntry(undefined, true);
        expect(entry.state$.peek().status).toBe("pending");

        subject.next("live-1");

        const state = entry.state$.peek();
        expect(state.status).toBe("success");
        expect(state.data).toBe("live-1");
    });

    it("subsequent emissions: success → success with new data", () => {
        const subject = new Subject<string>();
        const resource = createResource({ queryFn: () => subject.asObservable() });

        const entry = resource.getEntry(undefined, true);
        subject.next("live-1");
        subject.next("live-2");
        subject.next("live-3");

        const state = entry.state$.peek();
        expect(state.status).toBe("success");
        expect(state.data).toBe("live-3");
    });

    it("synchronously emitting observable settles the entry during creation", () => {
        const resource = createResource({ queryFn: () => of("a", "b", "c") });

        const entry = resource.getEntry(undefined, true);

        const state = entry.state$.peek();
        expect(state.status).toBe("success");
        expect(state.data).toBe("c");
    });

    it("stream error before any emission: pending → error (through mapError)", () => {
        const subject = new Subject<string>();
        const resource = createResource({
            queryFn: () => subject.asObservable(),
            mapError: (error) => ({ mapped: error }),
        });

        const entry = resource.getEntry(undefined, true);
        const boom = new Error("boom");
        subject.error(boom);

        const state = entry.state$.peek();
        expect(state.status).toBe("error");
        expect(state.error).toEqual({ mapped: boom });
    });

    it("stream error after data: success → invalidate-error with data kept", () => {
        const subject = new Subject<string>();
        const resource = createResource({ queryFn: () => subject.asObservable() });

        const entry = resource.getEntry(undefined, true);
        subject.next("live-1");
        const boom = new Error("late-boom");
        subject.error(boom);

        const state = entry.state$.peek();
        expect(state.status).toBe("invalidate-error");
        expect(state.data).toBe("live-1");
        expect(state.error).toBe(boom);
    });

    it("completion without a single emission fails the run with EmptyStreamError", () => {
        const subject = new Subject<string>();
        const resource = createResource({ queryFn: () => subject.asObservable() });

        const entry = resource.getEntry(undefined, true);
        subject.complete();

        const state = entry.state$.peek();
        expect(state.status).toBe("error");
        expect(state.error).toBeInstanceOf(EmptyStreamError);
    });

    it("completion after data leaves the entry in success with the last emission", () => {
        const subject = new Subject<string>();
        const queryFn = vi.fn(() => subject.asObservable());
        const resource = createResource({ queryFn });

        const entry = resource.getEntry(undefined, true);
        subject.next("live-1");
        subject.next("live-2");
        subject.complete();

        const state = entry.state$.peek();
        expect(state.status).toBe("success");
        expect(state.data).toBe("live-2");
        expect(queryFn).toHaveBeenCalledTimes(1);
    });
});

// ==================== Teardown & resubscription ====================

describe("stream queryFn — teardown and resubscription", () => {
    it("invalidate() unsubscribes the previous run and resubscribes; first emission rebases", () => {
        const { stream, state } = trackedStream<string>();
        const resource = createResource({ queryFn: () => stream });

        // Held: an active entry re-runs at once on invalidate.
        const entry = resource.getEntry(undefined, true);
        entry.hold();
        state.subscriber!.next("run1-value");
        expect(state.subscribeCount).toBe(1);

        entry.invalidate();
        expect(state.teardownCount).toBe(1);
        expect(state.subscribeCount).toBe(2);
        expect(entry.state$.peek().status).toBe("invalidating");

        state.subscriber!.next("run2-value");
        const entryState = entry.state$.peek();
        expect(entryState.status).toBe("success");
        expect(entryState.data).toBe("run2-value");
    });

    it("emissions from a superseded run are ignored", () => {
        const { stream, state } = trackedStream<string>();
        const resource = createResource({ queryFn: () => stream });

        const entry = resource.getEntry(undefined, true);
        entry.hold();
        const run1 = state.subscriber!;
        run1.next("run1-value");

        entry.invalidate();
        // The stale producer keeps pushing after unsubscribe — must not reach the entry.
        run1.next("stale-value");

        expect(entry.state$.peek().status).toBe("invalidating");
        expect(entry.state$.peek().data).toBe("run1-value");
    });

    it("entry eviction (reset) tears down the subscription", () => {
        const { stream, state } = trackedStream<string>();
        const resource = createResource({ queryFn: () => stream });

        resource.getEntry(undefined, true);
        state.subscriber!.next("live-1");

        resource.reset();
        expect(state.teardownCount).toBe(1);
    });

    it("retry() after a stream error resubscribes", () => {
        const { stream, state } = trackedStream<string>();
        const resource = createResource({ queryFn: () => stream });

        const entry = resource.getEntry(undefined, true);
        state.subscriber!.error(new Error("boom"));
        expect(entry.state$.peek().status).toBe("error");

        entry.retry();
        expect(state.subscribeCount).toBe(2);

        state.subscriber!.next("recovered");
        expect(entry.state$.peek().status).toBe("success");
        expect(entry.state$.peek().data).toBe("recovered");
    });

    it("invalidate() on a melting entry (default: cancel) tears the stream down now and marks the entry; the first hold resubscribes", () => {
        const { stream, state } = trackedStream<string>();
        const resource = createResource({ queryFn: () => stream });

        const entry = resource.getEntry(undefined, true);
        const run1 = state.subscriber!;
        run1.next("run1-value");

        entry.invalidate();

        // Nobody holds the entry and its data was declared unreliable: the
        // socket is closed, the entry is marked, the data stays on screen.
        expect(entry.isInvalidated).toBe(true);
        expect(state.teardownCount).toBe(1);
        expect(state.subscribeCount).toBe(1);
        expect(entry.state$.peek()).toMatchObject({ status: "success", data: "run1-value" });

        // The torn-down producer keeps pushing — nothing reaches the entry.
        run1.next("stale-value");
        expect(entry.state$.peek().data).toBe("run1-value");

        // The first hold resubscribes.
        entry.hold();
        expect(state.subscribeCount).toBe(2);
        expect(entry.isInvalidated).toBe(false);
        expect(entry.state$.peek()).toMatchObject({ status: "invalidating", data: "run1-value" });

        state.subscriber!.next("run2-value");
        expect(entry.state$.peek()).toMatchObject({ status: "success", data: "run2-value" });
    });

    it("invalidateInFlight: 'trail' — invalidate() on a melting entry keeps the stream open; the first hold waits for it", () => {
        const { stream, state } = trackedStream<string>();
        const resource = createResource({ queryFn: () => stream, invalidateInFlight: "trail" });

        const entry = resource.getEntry(undefined, true);
        const run1 = state.subscriber!;
        run1.next("run1-value");

        entry.invalidate();

        // Nobody holds the entry: the live stream stays, the entry is marked.
        expect(entry.isInvalidated).toBe(true);
        expect(state.teardownCount).toBe(0);
        expect(state.subscribeCount).toBe(1);
        expect(entry.state$.peek()).toMatchObject({ status: "success", data: "run1-value" });

        // An emission on the still-open stream lands, but does not clear the mark.
        run1.next("run1-later");
        expect(entry.state$.peek().data).toBe("run1-later");
        expect(entry.isInvalidated).toBe(true);

        // The first hold trusts the still-open stream: the resubscription waits
        // for it to complete.
        entry.hold();
        expect(state.teardownCount).toBe(0);
        expect(state.subscribeCount).toBe(1);
        expect(entry.isInvalidated).toBe(true);

        run1.complete();
        expect(state.subscribeCount).toBe(2);
        expect(entry.isInvalidated).toBe(false);
        expect(entry.state$.peek()).toMatchObject({ status: "invalidating", data: "run1-later" });

        state.subscriber!.next("run2-value");
        expect(entry.state$.peek()).toMatchObject({ status: "success", data: "run2-value" });
    });

    it("invalidateInFlight: 'trail' — invalidate() on a held entry with an open stream waits for it to complete", () => {
        const { stream, state } = trackedStream<string>();
        const resource = createResource({ queryFn: () => stream, invalidateInFlight: "trail" });

        const entry = resource.getEntry(undefined, true);
        entry.hold();
        const run1 = state.subscriber!;
        run1.next("run1-value");

        entry.invalidate();

        // `success` with an open stream is still a run in flight under trail.
        expect(entry.isInvalidated).toBe(true);
        expect(state.teardownCount).toBe(0);
        expect(state.subscribeCount).toBe(1);

        run1.complete();

        expect(state.subscribeCount).toBe(2);
        expect(entry.isInvalidated).toBe(false);
        expect(entry.state$.peek()).toMatchObject({ status: "invalidating", data: "run1-value" });
    });
});

describe("stream queryFn — invalidateInFlight: 'join'", () => {
    it("invalidate() on a held entry with an open stream is a no-op: the stream is trusted, nothing follows its completion", () => {
        const { stream, state } = trackedStream<string>();
        const resource = createResource({ queryFn: () => stream, invalidateInFlight: "join" });

        const entry = resource.getEntry(undefined, true);
        entry.hold();
        const run1 = state.subscriber!;
        run1.next("run1-value");

        resource.invalidate();

        expect(entry.isInvalidated).toBe(false);
        expect(state.teardownCount).toBe(0);
        expect(state.subscribeCount).toBe(1);

        run1.complete();
        expect(state.subscribeCount).toBe(1);
        expect(entry.state$.peek()).toMatchObject({ status: "success", data: "run1-value" });
    });

    describe("a joined consistency violation whose stream ends without another emission", () => {
        type TItems = { items: { n: number }[] };

        /**
         * Held entry; stream 2 (opened by a cancelling invalidate) emits data
         * the pending patch cannot replay over — the violation is joined, and
         * the stream then ends without landing anything.
         */
        function setup() {
            const { stream, state } = trackedStream<TItems>();
            const resource = createResource<void, TItems>({
                queryFn: () => stream,
                invalidateInFlight: "join",
                allowStreamPatches: true,
            });
            const entry = resource.getEntry(undefined, true);
            entry.hold();
            state.subscriber!.next({ items: [{ n: 1 }] });

            entry.invalidate({ inFlight: "cancel" });
            const run2 = state.subscriber!;
            entry.createPatch((draft) => {
                draft.items[0]!.n = 99;
            });
            run2.next({ items: [] });
            expect(entry.state$.peek().status).toBe("invalidating");
            return { resource, entry, state, run2 };
        }

        it("the entry re-queries once the stream ends: it is never left invalidating with nothing in flight", () => {
            const { entry, state, run2 } = setup();

            run2.complete();

            expect(state.subscribeCount).toBe(3);
            state.subscriber!.next({ items: [{ n: 5 }] });
            expect(entry.state$.peek()).toMatchObject({ status: "success", data: { items: [{ n: 5 }] } });
        });

        it.each(["cancel", "trail", "join"] as const)(
            "fetch({ inFlight: %s }) settles with the owed run's data",
            async (inFlight) => {
                const { resource, state, run2 } = setup();

                const fetched = resource.fetch(undefined, { inFlight });
                if (inFlight !== "cancel") run2.complete();

                expect(state.subscribeCount).toBe(3);
                state.subscriber!.next({ items: [{ n: 5 }] });
                await expect(fetched).resolves.toEqual({ items: [{ n: 5 }] });
            },
        );

        it("prefetch({ force: true }) after the stream ended settles with a fresh run", async () => {
            const { resource, state, run2 } = setup();
            run2.complete();
            let isSettled = false;

            const prefetched = resource.prefetch(undefined, { force: true }).then(() => {
                isSettled = true;
            });
            expect(state.subscribeCount).toBeGreaterThan(2);
            state.subscriber!.next({ items: [{ n: 5 }] });

            await flushMicrotasks();
            await flushMicrotasks();
            expect(isSettled).toBe(true);
            await prefetched;
        });
    });

    it("after the stream completed, invalidate() re-queries as usual", () => {
        const { stream, state } = trackedStream<string>();
        const resource = createResource({ queryFn: () => stream, invalidateInFlight: "join" });

        const entry = resource.getEntry(undefined, true);
        entry.hold();
        state.subscriber!.next("run1-value");
        state.subscriber!.complete();

        resource.invalidate();

        expect(state.subscribeCount).toBe(2);
        expect(entry.state$.peek()).toMatchObject({ status: "invalidating", data: "run1-value" });
    });
});

// ==================== Optimistic patches over an open stream ====================

describe("stream queryFn — optimistic patches", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("an emission rebases over an active patch (patched fields keep their recorded values)", () => {
        const subject = new Subject<{ likes: number; title: string }>();
        const resource = createResource<void, { likes: number; title: string }>({
            queryFn: () => subject.asObservable(),
            allowStreamPatches: true,
        });

        const entry = resource.getEntry(undefined, true);
        subject.next({ likes: 1, title: "v1" });

        entry.createPatch((draft) => {
            draft.likes += 1;
        });
        expect(entry.state$.peek().data).toEqual({ likes: 2, title: "v1" });

        subject.next({ likes: 5, title: "v2" });

        // Pending patch replayed on the new base. Immer patches are absolute
        // replacements: the recorded `likes = 2` wins over the emitted 5,
        // while untouched fields take the new base's values.
        expect(entry.state$.peek().data).toEqual({ likes: 2, title: "v2" });
    });

    it("committing a patch during a stream folds it into the data", () => {
        const subject = new Subject<{ likes: number }>();
        const resource = createResource<void, { likes: number }>({
            queryFn: () => subject.asObservable(),
            allowStreamPatches: true,
        });

        const entry = resource.getEntry(undefined, true);
        subject.next({ likes: 1 });

        const handle = entry.createPatch((draft) => {
            draft.likes += 1;
        })!;
        handle.commit();

        expect(entry.state$.peek().data).toEqual({ likes: 2 });

        // The next emission is the new base — the committed patch dissolved into it.
        subject.next({ likes: 10 });
        expect(entry.state$.peek().data).toEqual({ likes: 10 });
    });

    it("warns once per resource when patching while the stream is open", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const subject = new Subject<{ likes: number }>();
        const resource = createResource<number, { likes: number }>({
            queryFn: () => subject.asObservable(),
            key: "stream-res",
        });

        const entry = resource.getEntry(1, true);
        subject.next({ likes: 1 });

        entry.createPatch((draft) => {
            draft.likes += 1;
        });
        entry.createPatch((draft) => {
            draft.likes += 1;
        });

        const streamWarnings = warn.mock.calls.filter(([msg]) => String(msg).includes("allowStreamPatches"));
        expect(streamWarnings).toHaveLength(1);
        expect(String(streamWarnings[0]![0])).toContain("stream-res");
    });

    it("allowStreamPatches: true suppresses the warning", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const subject = new Subject<{ likes: number }>();
        const resource = createResource<void, { likes: number }>({
            queryFn: () => subject.asObservable(),
            allowStreamPatches: true,
        });

        const entry = resource.getEntry(undefined, true);
        subject.next({ likes: 1 });
        entry.createPatch((draft) => {
            draft.likes += 1;
        });

        expect(warn).not.toHaveBeenCalled();
    });

    it("does not warn when patching after the stream completed", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const subject = new Subject<{ likes: number }>();
        const resource = createResource<void, { likes: number }>({
            queryFn: () => subject.asObservable(),
        });

        const entry = resource.getEntry(undefined, true);
        subject.next({ likes: 1 });
        subject.complete();

        entry.createPatch((draft) => {
            draft.likes += 1;
        });

        expect(warn).not.toHaveBeenCalled();
    });

    it("does not warn for promise-based queries", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const resource = createResource<void, { likes: number }>({
            queryFn: async () => ({ likes: 1 }),
        });

        const entry = resource.getEntry(undefined, true);
        await flushMicrotasks();

        entry.createPatch((draft) => {
            draft.likes += 1;
        });

        expect(warn).not.toHaveBeenCalled();
    });
});

// ==================== Imperative API over streams ====================

describe("stream queryFn — ensure / fetch", () => {
    it("fetch() resolves with the first emission", async () => {
        const subject = new Subject<string>();
        const resource = createResource({ queryFn: () => subject.asObservable() });

        const promise = resource.fetch();
        subject.next("live-1");

        await expect(promise).resolves.toBe("live-1");
    });

    it("ensure() resolves immediately from an open stream's data", async () => {
        const subject = new Subject<string>();
        const resource = createResource({ queryFn: () => subject.asObservable() });

        resource.getEntry(undefined, true);
        subject.next("live-1");

        await expect(resource.ensure()).resolves.toBe("live-1");
    });

    it("fetch() rejects when the stream errors before data", async () => {
        const subject = new Subject<string>();
        const resource = createResource({ queryFn: () => subject.asObservable() });

        const promise = resource.fetch();
        const boom = new Error("boom");
        subject.error(boom);

        await expect(promise).rejects.toBe(boom);
    });

    it.each(["cancel", "trail", "join"] as const)(
        "fetch() on an open stream at success resubscribes and resolves with the new first emission (invalidateInFlight: %s)",
        async (invalidateInFlight) => {
            const { stream, state } = trackedStream<string>();
            const resource = createResource({ queryFn: () => stream, invalidateInFlight });
            const entry = resource.getEntry(undefined, true);
            entry.hold();
            state.subscriber!.next("live-1");
            expect(entry.state$.peek()).toMatchObject({ status: "success", data: "live-1" });

            // An open stream at `success` has already delivered: `fetch` means a
            // fresh run, so the stream is resubscribed whatever the policy —
            // under `trail` a bare invalidate() would only mark the entry and
            // the promise would settle on the data just declared suspect.
            const promise = resource.fetch();

            expect(state.teardownCount).toBe(1);
            expect(state.subscribeCount).toBe(2);
            expect(entry.isInvalidated).toBe(false);
            expect(entry.state$.peek().status).toBe("invalidating");

            state.subscriber!.next("live-2");
            await expect(promise).resolves.toBe("live-2");
            expect(entry.state$.peek()).toMatchObject({ status: "success", data: "live-2" });
        },
    );
});

// ==================== onQueryStarted lifecycle ====================

describe("stream queryFn — onQueryStarted lifecycle", () => {
    function captureContext<TData>() {
        const captured: TQueryStartedContext<void, TData>[] = [];
        const onQueryStarted = (_args: void, ctx: TQueryStartedContext<void, TData>) => {
            captured.push(ctx);
        };
        return { captured, onQueryStarted };
    }

    it("$queryFulfilled and $queryStream.firstReceived resolve with the first emission", async () => {
        const subject = new Subject<string>();
        const { captured, onQueryStarted } = captureContext<string>();
        const resource = createResource({ queryFn: () => subject.asObservable(), onQueryStarted });

        resource.getEntry(undefined, true);
        subject.next("live-1");
        subject.next("live-2");

        expect(captured).toHaveLength(1);
        await expect(captured[0]!.$queryFulfilled).resolves.toEqual({ data: "live-1" });
        await expect(captured[0]!.$queryStream.firstReceived).resolves.toBe("live-1");
    });

    it("$queryStream.allReceived resolves with the last emission at completion", async () => {
        const subject = new Subject<string>();
        const { captured, onQueryStarted } = captureContext<string>();
        const resource = createResource({ queryFn: () => subject.asObservable(), onQueryStarted });

        resource.getEntry(undefined, true);
        subject.next("live-1");
        subject.next("live-2");
        subject.complete();

        await expect(captured[0]!.$queryStream.allReceived).resolves.toBe("live-2");
    });

    it("stream milestones reject with the raw producer error", async () => {
        const subject = new Subject<string>();
        const { captured, onQueryStarted } = captureContext<string>();
        const resource = createResource({
            queryFn: () => subject.asObservable(),
            mapError: (error) => ({ mapped: error }),
            onQueryStarted,
        });

        resource.getEntry(undefined, true);
        const boom = new Error("boom");
        subject.error(boom);

        // Raw error, deliberately upstream of mapError (like $queryFulfilled).
        await expect(captured[0]!.$queryStream.firstReceived).rejects.toBe(boom);
        await expect(captured[0]!.$queryStream.allReceived).rejects.toBe(boom);
    });

    it("an empty completion rejects the milestones with EmptyStreamError", async () => {
        const subject = new Subject<string>();
        const { captured, onQueryStarted } = captureContext<string>();
        const resource = createResource({ queryFn: () => subject.asObservable(), onQueryStarted });

        resource.getEntry(undefined, true);
        subject.complete();

        await expect(captured[0]!.$queryStream.firstReceived).rejects.toBeInstanceOf(EmptyStreamError);
        await expect(captured[0]!.$queryStream.allReceived).rejects.toBeInstanceOf(EmptyStreamError);
    });

    it("teardown before completion rejects the pending allReceived", async () => {
        const subject = new Subject<string>();
        const { captured, onQueryStarted } = captureContext<string>();
        const resource = createResource({ queryFn: () => subject.asObservable(), onQueryStarted });

        resource.getEntry(undefined, true);
        subject.next("live-1");
        resource.reset();

        await expect(captured[0]!.$queryStream.allReceived).rejects.toBeTruthy();
        await expect(captured[0]!.$queryStream.firstReceived).resolves.toBe("live-1");
    });

    it("promise queryFn: both milestones coincide with the run's result", async () => {
        const { captured, onQueryStarted } = captureContext<string>();
        const resource = createResource({ queryFn: async () => "one-shot", onQueryStarted });

        resource.getEntry(undefined, true);
        await flushMicrotasks();

        await expect(captured[0]!.$queryStream.firstReceived).resolves.toBe("one-shot");
        await expect(captured[0]!.$queryStream.allReceived).resolves.toBe("one-shot");
        await expect(captured[0]!.$queryFulfilled).resolves.toEqual({ data: "one-shot" });
    });

    it("invalidate() fires the hook again for the new run", () => {
        const subject = new Subject<string>();
        const { captured, onQueryStarted } = captureContext<string>();
        const resource = createResource({ queryFn: () => subject.asObservable(), onQueryStarted });

        const entry = resource.getEntry(undefined, true);
        entry.hold();
        subject.next("live-1");
        entry.invalidate();

        expect(captured).toHaveLength(2);
    });

    it("unconsumed rejecting milestones never surface as unhandled rejections", async () => {
        const tracker = await trackUnhandledRejections();
        try {
            const subject = new Subject<string>();
            const { onQueryStarted } = captureContext<string>();
            const resource = createResource({ queryFn: () => subject.asObservable(), onQueryStarted });

            resource.getEntry(undefined, true);
            subject.error(new Error("nobody-awaits-me"));

            await flushUnhandledRejections();
            expect(tracker.unhandled).toEqual([]);
        } finally {
            tracker.stop();
        }
    });
});
