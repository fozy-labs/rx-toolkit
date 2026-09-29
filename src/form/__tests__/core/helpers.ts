// Helpers of the instance tests: internal access for what only later stages drive publicly.
import type { StandardSchemaV1 } from "@/common/standard-schema";
import type { ReadonlySignal } from "@/signals";

import { coreOf } from "../../core/nodes/NodeCore";
import type { Issue } from "../../index";

/** The server issues a submit would lay out on `node` (Stage 5). */
export function addServerIssue(node: object, message: string, path: Issue["path"] = ["server-path"]): Issue {
    const issue: Issue = { path, message, severity: "error", source: { type: "server" } };
    coreOf(node)!.addServerIssues([issue]);
    return issue;
}

/** The `submitted` flag a submit sets on the whole tree (Stage 5). */
export function markSubmitted(node: object): void {
    coreOf(node)!.markSubmitted();
}

/** Subscribes to `signal` and records every emission. */
export function record<T>(signal: ReadonlySignal<T>) {
    const values: T[] = [];
    const subscription = signal.obs.subscribe((value) => values.push(value));
    return { values, unsubscribe: () => subscription.unsubscribe() };
}

/** A Standard Schema from a plain function; `validate` is a spy. */
export function schemaOf<I, O = I>(validate: (value: unknown) => unknown) {
    const spy = vi.fn(validate);
    const schema = {
        "~standard": {
            version: 1,
            vendor: "test",
            validate: spy,
            types: undefined as unknown as { input: I; output: O },
        },
    } as unknown as StandardSchemaV1<I, O>;
    return { schema, validate: spy };
}
