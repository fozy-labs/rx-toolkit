import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { createControllableQueryFn } from "@/query-v2/__tests__/helpers";
import { createApi } from "@/query-v2/api/createApi";

type TArgs = { id: number };
type TData = { name: string };

describe("Integration: reset-and-multi-agent", () => {
    // ── INT10: resetAll → all agents see idle, all entries cleared ──
    it("INT10: resetAll resets all resources — agents see idle, caches empty", async () => {
        const api = createApi();
        const { queryFn: qf1, calls: c1 } = createControllableQueryFn<TArgs, TData>();
        const { queryFn: qf2, calls: c2 } = createControllableQueryFn<TArgs, TData>();

        const r1 = api.createResourceV2<TArgs, TData>({ key: "users", queryFn: qf1, cacheLifetime: false });
        const r2 = api.createResourceV2<TArgs, TData>({ key: "posts", queryFn: qf2, cacheLifetime: false });

        const agent1 = r1.createAgent();
        const agent2 = r2.createAgent();

        // Start all agents
        agent1.start({ id: 1 });
        agent2.start({ id: 2 });

        // Trigger lazy entry creation
        expect(agent1.state$().status).toBe("pending");
        expect(agent2.state$().status).toBe("pending");

        // Resolve all
        c1[0].resolve({ name: "User" });
        c2[0].resolve({ name: "Post" });

        await flushMicrotasks();

        expect(agent1.state$().status).toBe("success");
        expect(agent2.state$().status).toBe("success");

        // Reset all
        api.resetAll();

        // All agents immediately re-create entries (pending)
        expect(agent1.state$().status).toBe("pending");
        expect(agent2.state$().status).toBe("pending");

        // Old caches should be empty (new entries created on state$ read)
        // Resolve new fetches to clean up
        c1[1].resolve({ name: "User" });
        c2[1].resolve({ name: "Post" });
        await flushMicrotasks();
    });

    // ── INT11: Multiple agents on same resource — shared cache, independent SWR ──
    it("INT11: multiple agents share cache but have independent SWR tracking", async () => {
        const api = createApi();
        const { queryFn, calls } = createControllableQueryFn<TArgs, TData>();
        const resource = api.createResourceV2<TArgs, TData>({
            key: "users",
            queryFn,
            cacheLifetime: false as never,
        });

        const agentA = resource.createAgent();
        const agentB = resource.createAgent();

        // Agent A starts with args {id: 1}
        agentA.start({ id: 1 });
        expect(agentA.state$().status).toBe("pending");
        expect(queryFn).toHaveBeenCalledTimes(1);

        // Agent B starts with same args {id: 1} — shared cache, no new fetch
        agentB.start({ id: 1 });
        expect(agentB.state$().status).toBe("pending");
        expect(queryFn).toHaveBeenCalledTimes(1); // Still 1 — dedup

        // Resolve the shared fetch
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        expect(agentA.state$().data).toEqual({ name: "Alice" });
        expect(agentB.state$().data).toEqual({ name: "Alice" });

        // Agent A switches to {id: 2} — independent SWR
        agentA.start({ id: 2 });
        expect(agentA.state$().status).not.toBe("idle"); // trigger entry creation
        expect(queryFn).toHaveBeenCalledTimes(2);

        // Agent A sees SWR (previous data from {id:1})
        expect(agentA.state$().isLoading).toBe(true);
        expect(agentA.state$().data).toEqual({ name: "Alice" });

        // Agent B still shows {id:1} data
        expect(agentB.state$().status).toBe("success");
        expect(agentB.state$().data).toEqual({ name: "Alice" });

        // Resolve agent A's new fetch
        calls[1].resolve({ name: "Bob" });
        await flushMicrotasks();

        expect(agentA.state$().data).toEqual({ name: "Bob" });
        // Agent B still on {id:1}
        expect(agentB.state$().data).toEqual({ name: "Alice" });
    });
});
