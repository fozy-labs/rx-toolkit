// Differential tests against @preact/signals-core 1.14.3 (the reference push-pull
// engine). Each test builds the same seeded random graph of state / computed /
// effect on both engines, applies the same writes (single writes and batches)
// and requires every observer to see the same sequence:
//
// - each effect: the tuple of values it read, per run — so no intermediate
//   values and no extra runs; effects are compared one by one, not in their
//   global order (independent effects of a batch may run in any order);
// - each subscribed computed `.obs`: its emissions, against a preact effect
//   over the same computed — one value per settled change;
// - reads (`peek`) of computeds inside a batch, after its writes;
// - every node's value while hot and again cold, after all observers left.
//
// Batches never write a state A -> B -> A: preact reconciles that as "no
// change" and skips the effects, which the core proposal does not require.
//
// A failure names the seed, the first diverging observer and the whole graph;
// `expectSameAsPreact(options, seed, 1)` replays one seed.
import { expectSameAsPreact } from "./harness";

const SEEDS = 400;

describe("differential: rx-toolkit vs @preact/signals-core on random graphs", () => {
    describe("static dependencies", () => {
        it("effects see the same values, run the same number of times; final values match", () => {
            expectSameAsPreact({ dynamic: false, obs: false, batchReads: false }, 1, SEEDS);
        });

        it("computed .obs emits the same values as an effect over the computed", () => {
            expectSameAsPreact({ dynamic: false, obs: true, batchReads: false }, 1, SEEDS);
        });

        // defects.md, "read inside a batch": a hot computed read between a
        // write and the flush returns the value computed before the write.
        it("a computed read inside a batch sees the batch's writes", () => {
            expectSameAsPreact({ dynamic: false, obs: false, batchReads: true }, 1, SEEDS);
        });
    });

    describe("dynamic dependencies", () => {
        // defects.md, "new dependency" and "stale rank": a node that starts
        // reading a hot node changed in the same write first sees its stale
        // value, so effects run twice and see an intermediate value.
        it("effects see no intermediate values and run once per write or batch", () => {
            expectSameAsPreact({ dynamic: true, obs: false, batchReads: false }, 1, SEEDS);
        });

        it("computed .obs emits no intermediate values", () => {
            expectSameAsPreact({ dynamic: true, obs: true, batchReads: false }, 1, SEEDS);
        });

        it("a computed read inside a batch sees the batch's writes", () => {
            expectSameAsPreact({ dynamic: true, obs: false, batchReads: true }, 1, SEEDS);
        });
    });
});
