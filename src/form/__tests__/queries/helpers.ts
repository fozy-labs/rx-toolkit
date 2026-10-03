// Helpers of the query tests: a real resource on a fresh api, answering on fake timers.
import { createApi } from "@/query";
import type { IResource } from "@/query/types";

/** How long a query takes. */
export const LATENCY = 100;
/** How long an entry nobody holds stays in the cache. */
export const RETENTION = 1000;

export interface EmailInfo {
    isValid: boolean;
    isCorporate: boolean;
}

/**
 * The email check of the design's Field example: `taken…` is taken, `…@corp.com` is corporate.
 * Emails in `failing` fail. Every call is recorded in `queryFn`; `onQuery` runs synchronously in it.
 */
export function emailResource(onQuery?: (email: string) => void) {
    const failing = new Set<string>();
    const queryFn = vi.fn(async (email: string): Promise<EmailInfo> => {
        onQuery?.(email);
        await new Promise((resolve) => setTimeout(resolve, LATENCY));
        if (failing.has(email)) throw new Error(`Could not check ${email}`);
        return { isValid: !email.startsWith("taken"), isCorporate: email.endsWith("@corp.com") };
    });
    const api = createApi();
    const resource = api.createResource<string, EmailInfo>({ queryFn, retentionTime: RETENTION });
    return { api, resource, queryFn, failing };
}

/** The args of the cache entries that exist now. */
export function entryArgs<A>(resource: IResource<A, unknown>): A[] {
    return [...resource.getEntries()].map((entry) => entry.keyedArgs.value);
}

/** Lets the microtasks and the timers due within `ms` run. */
export function advance(ms = 0): Promise<void> {
    return vi.advanceTimersByTimeAsync(ms).then(() => {});
}
