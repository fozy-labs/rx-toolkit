import { Observable } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { DefaultOptions } from "@/common/options";
import { createApi } from "@/query/api/createApi";

/** Let every microtask chain in flight run to completion. */
function settle(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

class MappedError extends Error {
    constructor(readonly original: unknown) {
        super("mapped");
    }
}

describe("DefaultOptions.onQueryError", () => {
    it("is called with the failure of a resource query", async () => {
        const onQueryError = vi.fn();
        DefaultOptions.update({ onQueryError });
        const boom = new Error("boom");
        const resource = createApi().createResource<number, number>({ queryFn: () => Promise.reject(boom) });

        await expect(resource.fetch(1)).rejects.toBe(boom);

        expect(onQueryError).toHaveBeenCalledTimes(1);
        expect(onQueryError).toHaveBeenCalledWith(boom);
    });

    it("is called with the failure of a command", async () => {
        const onQueryError = vi.fn();
        DefaultOptions.update({ onQueryError });
        const boom = new Error("boom");
        const command = createApi().createCommand<number, number>({ queryFn: () => Promise.reject(boom) });

        await expect(command.execute(1)).rejects.toBe(boom);

        expect(onQueryError).toHaveBeenCalledTimes(1);
        expect(onQueryError).toHaveBeenCalledWith(boom);
    });

    it("is called with the error of a stream query", async () => {
        const onQueryError = vi.fn();
        DefaultOptions.update({ onQueryError });
        const boom = new Error("boom");
        const resource = createApi().createResource<number, number>({
            queryFn: () => new Observable<number>((subscriber) => subscriber.error(boom)),
        });

        await expect(resource.fetch(1)).rejects.toBe(boom);

        expect(onQueryError).toHaveBeenCalledWith(boom);
    });

    it("receives the error as the api's mapError normalized it", async () => {
        const onQueryError = vi.fn();
        DefaultOptions.update({ onQueryError });
        const boom = new Error("boom");
        const resource = createApi({ mapError: (error) => new MappedError(error) }).createResource<number, number>({
            queryFn: () => Promise.reject(boom),
        });

        await resource.fetch(1).catch(() => {});

        expect(onQueryError).toHaveBeenCalledTimes(1);
        const [reported] = onQueryError.mock.calls[0]!;
        expect(reported).toBeInstanceOf(MappedError);
        expect((reported as MappedError).original).toBe(boom);
        expect(reported).toBe(resource.getState(1).error);
    });

    it("is called on every failed run, retries included", async () => {
        const onQueryError = vi.fn();
        DefaultOptions.update({ onQueryError });
        const resource = createApi().createResource<number, number>({
            queryFn: () => Promise.reject(new Error("boom")),
        });

        await resource.fetch(1).catch(() => {});
        await resource.fetch(1).catch(() => {});

        expect(onQueryError).toHaveBeenCalledTimes(2);
    });

    it("is not called for an aborted run or a removed command entry", async () => {
        const onQueryError = vi.fn();
        DefaultOptions.update({ onQueryError });
        const api = createApi();
        const resource = api.createResource<number, number>({
            queryFn: (_, signal) =>
                new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
        });
        const command = api.createCommand<number, number>({ queryFn: () => new Promise(() => {}) });

        const entry = resource.getEntry(1, true);
        const release = entry.hold();
        const executed = command.execute(1);
        api.resetAll();
        await executed.catch(() => {});
        release();
        await settle();

        expect(onQueryError).not.toHaveBeenCalled();
    });

    it("reports a projection failure once, at the wrapped resource", async () => {
        const onQueryError = vi.fn();
        DefaultOptions.update({ onQueryError });
        const api = createApi();
        const boom = new Error("boom");
        const userResource = api.createResource<{ userIds: number[] }, { id: number }[]>({
            queryFn: () => Promise.reject(boom),
        });
        const projection = api.unstable_createProjectionResource({
            resource: userResource,
            parseData: (data) => data.map((item) => ({ id: item.id, item })),
            makeArgs: (ids) => ({ userIds: ids }),
        });

        await projection.fetch([1]).catch(() => {});
        await settle();

        expect(projection.getState([1]).error).toBe(boom);
        expect(onQueryError).toHaveBeenCalledTimes(1);
        expect(onQueryError).toHaveBeenCalledWith(boom);
    });

    it("a throwing handler neither breaks the entry nor escapes", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        DefaultOptions.update({
            onQueryError: () => {
                throw new Error("handler bug");
            },
        });
        const boom = new Error("boom");
        const resource = createApi().createResource<number, number>({ queryFn: () => Promise.reject(boom) });

        await expect(resource.fetch(1)).rejects.toBe(boom);

        expect(resource.getState(1).error).toBe(boom);
        expect(consoleError).toHaveBeenCalled();
        consoleError.mockRestore();
    });
});
