// The public classes of the signals module show their API only: the engine
// node behind each of them is private, so none of its members leaks into the
// declarations. Checked by the type check of the tests (`@ts-expect-error`
// fails there if the member it guards is public).
import { of } from "rxjs";

import { SourceSignal } from "../base/SourceSignal";
import { Computed } from "../signals/Computed";
import { Effect } from "../signals/Effect";
import { FromSignal } from "../signals/FromSignal";
import { State } from "../signals/State";

describe("public surface of the signal classes", () => {
    it("engine members are not public", () => {
        const state = new State(1);
        const computed = new Computed(() => 1);
        const effect = new Effect(() => {});
        const from = new FromSignal(of(1));
        const source = new SourceSignal<number>((subscriber) => subscriber.next(1));

        // @ts-expect-error - an engine field
        void state._value;
        // @ts-expect-error - an engine method
        void state._write;
        // @ts-expect-error - an engine field
        void computed._flags;
        // @ts-expect-error - an engine field
        void computed._equals;
        // @ts-expect-error - an engine field
        void effect._sources;
        // @ts-expect-error - an engine method
        void from._refresh;
        // @ts-expect-error - an engine method
        void source._subscribe;

        expect([state.peek(), computed.peek(), from.peek(), source.peek(), effect.closed]).toEqual([1, 1, 1, 1, false]);
        effect.unsubscribe();
        expect(effect.closed).toBe(true);
    });
});
