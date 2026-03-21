import { vi } from "vitest";

import { ResourceV2, type ResourceV2Config } from "@/query-v2/core/resource/ResourceV2";

export function controllableQueryFn<TArgs = unknown, TData = unknown>() {
    const calls: Array<{
        args: TArgs;
        resolve: (data: TData) => void;
        reject: (error: Error) => void;
    }> = [];

    const fn = vi.fn((args: TArgs, { abortSignal }: { abortSignal: AbortSignal }) => {
        return new Promise<TData>((resolve, reject) => {
            let settled = false;
            const wrappedResolve = (data: TData) => {
                if (!settled) {
                    settled = true;
                    resolve(data);
                }
            };
            const wrappedReject = (error: Error) => {
                if (!settled) {
                    settled = true;
                    reject(error);
                }
            };
            calls.push({ args, resolve: wrappedResolve, reject: wrappedReject });
            abortSignal.addEventListener("abort", () => {
                wrappedReject(new DOMException("Aborted", "AbortError"));
            });
        });
    });

    return { fn, calls };
}

export function createTestResource<TArgs = unknown, TData = unknown, TError = Error>(
    config: Partial<ResourceV2Config<TArgs, TData, TError>> & Pick<ResourceV2Config<TArgs, TData, TError>, "queryFn">,
): ResourceV2<TArgs, TData, TError> {
    return new ResourceV2<TArgs, TData, TError>({
        key: "test-resource",
        ...config,
    });
}
