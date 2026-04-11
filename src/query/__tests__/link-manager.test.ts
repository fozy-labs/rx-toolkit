import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { createApi } from "@/query/api/createApi";

describe("LinkManager", () => {
    // ── helpers ──

    function setupTodoApi() {
        const api = createApi();

        const todosResource = api.createResource<void, { items: string[] }>({
            key: "todos",
            queryFn: async () => ({ items: ["buy milk"] }),
        });

        return { api, todosResource };
    }

    // ── optimisticUpdate ──

    describe("applyOptimisticPatches", () => {
        it("applies optimistic patch to linked resource before mutation resolves", async () => {
            const { api, todosResource } = setupTodoApi();

            // Seed the resource with data
            todosResource.trigger(undefined as void);
            await flushMicrotasks();

            let resolveMutation!: (val: string) => void;
            const addTodo = api.createCommand<string, string>({
                queryFn: (item) =>
                    new Promise((r) => {
                        resolveMutation = r;
                    }),
                links: [
                    {
                        resource: todosResource,
                        forwardArgs: () => undefined as void,
                        optimisticUpdate: (draft, commandArgs) => {
                            draft.items.push(commandArgs);
                        },
                    },
                ],
            });

            // Trigger mutation (don't await — it's still pending)
            const promise = addTodo.trigger("buy eggs");
            await flushMicrotasks();

            // Resource should optimistically contain new item
            const entry = todosResource.getEntry(undefined as void);
            expect(entry).not.toBeNull();
            const machine = entry!.peek();
            expect(machine.state.data).toEqual({ items: ["buy milk", "buy eggs"] });

            // Resolve to clean up
            resolveMutation("ok");
            await promise;
            await flushMicrotasks();
        });

        it("rolls back optimistic patches on mutation failure", async () => {
            const { api, todosResource } = setupTodoApi();

            todosResource.trigger(undefined as void);
            await flushMicrotasks();

            let rejectMutation!: (err: Error) => void;
            const addTodo = api.createCommand<string, string>({
                queryFn: () =>
                    new Promise((_, rej) => {
                        rejectMutation = rej;
                    }),
                links: [
                    {
                        resource: todosResource,
                        forwardArgs: () => undefined as void,
                        optimisticUpdate: (draft, commandArgs) => {
                            draft.items.push(commandArgs);
                        },
                    },
                ],
            });

            const promise = addTodo.trigger("buy eggs").catch(() => {});
            await flushMicrotasks();

            // Optimistic data is applied
            expect(todosResource.getEntry(undefined as void)!.peek().state.data).toEqual({
                items: ["buy milk", "buy eggs"],
            });

            // Reject mutation
            rejectMutation(new Error("network error"));
            await promise;
            await flushMicrotasks();

            // Should roll back to original data
            const machine = todosResource.getEntry(undefined as void)!.peek();
            expect(machine.state.data).toEqual({ items: ["buy milk"] });
        });
    });

    // ── update ──

    describe("applyUpdatePatches", () => {
        it("applies update patch using mutation result after success", async () => {
            const { api, todosResource } = setupTodoApi();

            todosResource.trigger(undefined as void);
            await flushMicrotasks();

            const addTodo = api.createCommand<string, { added: string }>({
                queryFn: async (item) => ({ added: item }),
                links: [
                    {
                        resource: todosResource,
                        forwardArgs: () => undefined as void,
                        update: (draft, _args, result) => {
                            draft.items.push(result.added);
                        },
                    },
                ],
            });

            await addTodo.trigger("buy eggs");
            await flushMicrotasks();

            const machine = todosResource.getEntry(undefined as void)!.peek();
            expect(machine.state.data).toEqual({ items: ["buy milk", "buy eggs"] });
        });
    });

    // ── invalidate ──

    describe("invalidateResources", () => {
        it("re-fetches linked resource after successful mutation", async () => {
            const fetchCount = vi.fn();
            const api = createApi();

            const todosResource = api.createResource<void, string[]>({
                key: "todos",
                queryFn: async () => {
                    fetchCount();
                    return ["item"];
                },
            });

            todosResource.trigger(undefined as void);
            await flushMicrotasks();
            expect(fetchCount).toHaveBeenCalledTimes(1);

            const doSomething = api.createCommand<void, void>({
                queryFn: async () => {},
                links: [
                    {
                        resource: todosResource,
                        forwardArgs: () => undefined as void,
                        invalidate: true,
                    },
                ],
            });

            await doSomething.trigger(undefined as void);
            await flushMicrotasks();

            // Should have re-fetched
            expect(fetchCount).toHaveBeenCalledTimes(2);
        });

        it("does NOT invalidate linked resource on mutation failure", async () => {
            const fetchCount = vi.fn();
            const api = createApi();

            const todosResource = api.createResource<void, string[]>({
                key: "todos",
                queryFn: async () => {
                    fetchCount();
                    return ["item"];
                },
            });

            todosResource.trigger(undefined as void);
            await flushMicrotasks();
            expect(fetchCount).toHaveBeenCalledTimes(1);

            const doSomething = api.createCommand<void, void>({
                queryFn: async () => {
                    throw new Error("fail");
                },
                links: [
                    {
                        resource: todosResource,
                        forwardArgs: () => undefined as void,
                        invalidate: true,
                    },
                ],
            });

            await doSomething.trigger(undefined as void).catch(() => {});
            await flushMicrotasks();

            // Should NOT have re-fetched
            expect(fetchCount).toHaveBeenCalledTimes(1);
        });
    });

    // ── settle (combined behavior) ──

    describe("settle", () => {
        it("commits optimistic patches and applies update on success", async () => {
            const { api, todosResource } = setupTodoApi();

            todosResource.trigger(undefined as void);
            await flushMicrotasks();

            const addTodo = api.createCommand<string, { added: string }>({
                queryFn: async (item) => ({ added: item }),
                links: [
                    {
                        resource: todosResource,
                        forwardArgs: () => undefined as void,
                        optimisticUpdate: (draft, commandArgs) => {
                            draft.items.push(commandArgs + " (optimistic)");
                        },
                        update: (draft, _args, result) => {
                            // Replace optimistic entry with real result
                            draft.items = draft.items.filter((i: string) => !i.includes("(optimistic)"));
                            draft.items.push(result.added);
                        },
                    },
                ],
            });

            await addTodo.trigger("buy eggs");
            await flushMicrotasks();

            const machine = todosResource.getEntry(undefined as void)!.peek();
            expect(machine.state.data!.items).toContain("buy eggs");
            expect(machine.state.data!.items.some((i: string) => i.includes("(optimistic)"))).toBe(false);
        });
    });

    // ── forwardArgs targeting ──

    describe("forwardArgs targeting", () => {
        it("targets specific resource entry via forwardArgs", async () => {
            const api = createApi();

            const userResource = api.createResource<number, { name: string }>({
                key: "user",
                queryFn: async (id) => ({ name: `user-${id}` }),
            });

            // Seed two entries
            userResource.trigger(1);
            userResource.trigger(2);
            await flushMicrotasks();

            const rename = api.createCommand<{ id: number; name: string }, void>({
                queryFn: async () => {},
                links: [
                    {
                        resource: userResource,
                        forwardArgs: (args) => args.id,
                        update: (draft, args) => {
                            draft.name = args.name;
                        },
                    },
                ],
            });

            await rename.trigger({ id: 1, name: "Alice" });
            await flushMicrotasks();

            // Entry for id=1 should be updated
            const entry1 = userResource.getEntry(1);
            expect(entry1!.peek().state.data).toEqual({ name: "Alice" });

            // Entry for id=2 should be unchanged
            const entry2 = userResource.getEntry(2);
            expect(entry2!.peek().state.data).toEqual({ name: "user-2" });
        });
    });
});
