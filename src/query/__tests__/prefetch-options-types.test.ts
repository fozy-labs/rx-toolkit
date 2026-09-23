import { describe, expectTypeOf, it } from "vitest";

import { createApi } from "@/query/api/createApi";
import type { TInFlightPolicy, TResourcePrefetchOptions } from "@/query/types";

// ==================== prefetch options: type-level tests ====================

/**
 * `inFlight` only means something with `force: true`: without it `prefetch`
 * reuses cached data and never touches a run in flight. The options are a
 * union discriminated by `force`, so an `inFlight` that would be ignored is a
 * compile error instead of a silent no-op.
 */
describe("TResourcePrefetchOptions", () => {
    const api = createApi();
    const resource = api.createResource({ queryFn: async (id: number) => ({ id }) });

    it("accepts inFlight together with force: true", () => {
        void resource.prefetch(1, { force: true, inFlight: "trail" });
        void resource.prefetch(1, { force: true });
        expectTypeOf<{ force: true; inFlight: "join" }>().toMatchTypeOf<TResourcePrefetchOptions>();
    });

    it("accepts the cache warm-up forms", () => {
        void resource.prefetch(1);
        void resource.prefetch(1, {});
        void resource.prefetch(1, { force: false });
    });

    it("accepts a force held in a boolean variable, without inFlight", () => {
        const force: boolean = Math.random() > 0.5;
        void resource.prefetch(1, { force });
    });

    it("rejects inFlight without force: true", () => {
        const inFlight: TInFlightPolicy = "join";
        const force: boolean = Math.random() > 0.5;

        // @ts-expect-error — `inFlight` would be ignored without `force: true`.
        void resource.prefetch(1, { inFlight });
        // @ts-expect-error — `inFlight` would be ignored with `force: false`.
        void resource.prefetch(1, { force: false, inFlight });
        // @ts-expect-error — `force` may be `false` here, where `inFlight` would be ignored.
        void resource.prefetch(1, { force, inFlight });

        expectTypeOf<{ inFlight: "join" }>().not.toMatchTypeOf<TResourcePrefetchOptions>();
    });
});
