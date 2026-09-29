import type { ReadonlySignal } from "@/signals/types";

import type { SubmitStatus } from "../../types";
import { notImplemented } from "../runtime/guard";

import { derived } from "./NodeCore";

/**
 * The submit members of the root (Stage 5). Until then the form never submits, so the state is
 * the idle one and `submit()` / `entryKey` are not implemented.
 */
export interface SubmitState {
    readonly submission$: ReadonlySignal<unknown>;
    readonly isSubmitting$: ReadonlySignal<boolean>;
    readonly status$: ReadonlySignal<SubmitStatus>;
    readonly submitAttempts$: ReadonlySignal<number>;
    readonly submitCount$: ReadonlySignal<number>;
    readonly canSubmit$: ReadonlySignal<boolean>;
    readonly entryKey: string;
    submit(options?: { force?: boolean }): Promise<boolean>;
    /** Resets the submit state: `status$ → idle`, a new `entryKey`, `submission$ → null`. */
    reset(): void;
}

export function createSubmitState(key: string): SubmitState {
    const isSubmitting$ = derived(`${key}/isSubmitting$`, () => false);
    return {
        submission$: derived(`${key}/submission$`, () => null),
        isSubmitting$,
        status$: derived(`${key}/status$`, (): SubmitStatus => "idle"),
        submitAttempts$: derived(`${key}/submitAttempts$`, () => 0),
        submitCount$: derived(`${key}/submitCount$`, () => 0),
        canSubmit$: derived(`${key}/canSubmit$`, () => !isSubmitting$()),
        get entryKey(): string {
            throw notImplemented("submit");
        },
        submit() {
            throw notImplemented("submit");
        },
        reset() {},
    };
}
