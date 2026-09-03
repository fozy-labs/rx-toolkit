import { act, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { outsideAct, sleep, withSlowSiblings } from "@/__tests__/helpers/concurrent-react";
import { createApi } from "@/query/api/createApi";
import { SKIP } from "@/query/constants";
import { reactHooksPlugin } from "@/query/react/ReactHooksPlugin";
import type { TResourceAgentState } from "@/query/types";

const h = React.createElement;

// ==================== Helpers ====================

type TUser = { id: number; name: string };
type TArgs = { id: number };

function createSetup() {
    const api = createApi({ plugins: [reactHooksPlugin()] });
    const resource = api.createResource<TArgs, TUser>({
        queryFn: async ({ id }) => ({ id, name: `user-${id}` }),
    });
    return { api, resource };
}

interface Captured {
    state: TResourceAgentState<TArgs, TUser>;
    /** Every state seen by the probe, one per render. */
    history: TResourceAgentState<TArgs, TUser>[];
    rerender: (args: TArgs | typeof SKIP) => void;
}

/** Render a probe component around useResource and expose the live state. */
function setup(
    useResource: (args: TArgs | typeof SKIP) => TResourceAgentState<TArgs, TUser>,
    initialArgs: TArgs | typeof SKIP,
): Captured {
    const captured = { history: [] } as unknown as Captured;

    function Probe({ args }: { args: TArgs | typeof SKIP }) {
        captured.state = useResource(args);
        captured.history.push(captured.state);
        return null;
    }

    const view = render(h(Probe, { args: initialArgs }));
    captured.rerender = (args) => view.rerender(h(Probe, { args }));
    return captured;
}

async function settle(): Promise<void> {
    await act(async () => {
        await flushMicrotasks();
        await flushMicrotasks();
    });
}

// ==================== Tests ====================

describe("useResource", () => {
    it("reports pending on the first render and success once the query settles", async () => {
        const { resource } = createSetup();

        const c = setup(resource.useResource, { id: 1 });
        expect(c.state.status).toBe("pending");
        expect(c.state.args).toEqual({ id: 1 });

        await settle();

        expect(c.state.status).toBe("success");
        expect(c.state.data).toEqual({ id: 1, name: "user-1" });
    });

    it("keeps the previous data as refreshing while the new args load (SWR), with no pending flash", async () => {
        const { resource } = createSetup();

        const c = setup(resource.useResource, { id: 1 });
        await settle();
        expect(c.state.status).toBe("success");

        c.history.length = 0;
        c.rerender({ id: 2 });

        // The very first render on the new args already carries the stale data.
        expect(c.history[0].status).toBe("refreshing");
        expect(c.history[0].data).toEqual({ id: 1, name: "user-1" });
        expect(c.history[0].args).toEqual({ id: 2 });
        expect(c.history.map((s) => s.status)).not.toContain("pending");

        await settle();

        expect(c.state.status).toBe("success");
        expect(c.state.data).toEqual({ id: 2, name: "user-2" });
    });

    it("switching back to cached args shows their data right away", async () => {
        const { resource } = createSetup();

        const c = setup(resource.useResource, { id: 1 });
        await settle();
        c.rerender({ id: 2 });
        await settle();
        expect(c.state.data).toEqual({ id: 2, name: "user-2" });

        c.history.length = 0;
        c.rerender({ id: 1 });

        expect(c.history[0].status).toBe("success");
        expect(c.history[0].data).toEqual({ id: 1, name: "user-1" });
    });

    it("SKIP drops to idle and a later args change resumes loading", async () => {
        const { resource } = createSetup();

        const c = setup(resource.useResource, SKIP);
        expect(c.state.status).toBe("idle");

        c.rerender({ id: 1 });
        expect(c.state.status).toBe("pending");
        await settle();
        expect(c.state.status).toBe("success");

        c.rerender(SKIP);
        expect(c.state.status).toBe("idle");
        expect(c.state.data).toBeNull();
    });

    it("re-rendering with an equal args literal keeps the same agent state", async () => {
        const { resource } = createSetup();

        const c = setup(resource.useResource, { id: 1 });
        await settle();
        const before = c.state;

        c.rerender({ id: 1 });

        expect(c.state).toBe(before);
    });

    it("settles an args change made inside startTransition without a render loop", async () => {
        const { resource } = createSetup();

        let setId!: (id: number) => void;
        let renders = 0;

        function View({ id }: { id: number }) {
            renders++;
            const state = resource.useResource({ id });
            return h("span", { "data-testid": "args" }, String(state.args?.id ?? "none"));
        }

        function App() {
            const [id, set] = React.useState(1);
            setId = set;
            return withSlowSiblings(h(View, { id }), id);
        }

        render(h(App));
        expect(screen.getByTestId("args").textContent).toBe("1");

        await outsideAct(async () => {
            renders = 0;
            React.startTransition(() => setId(2));
            await sleep(300);
        });

        expect(screen.getByTestId("args").textContent).toBe("2");
        // The transition render plus, at most, a couple of store-driven follow-ups.
        // A render-phase mutation of a shared agent makes this ping-pong between
        // the transition lane (id=2) and the committed tree (id=1) instead.
        expect(renders).toBeLessThanOrEqual(4);

        await act(async () => {});
    });
});
