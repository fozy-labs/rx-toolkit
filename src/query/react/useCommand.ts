import { useConstant, useEventHandler } from "@/common/react";
import type { ICommand, TCommandClutchState, TTriggerPromise } from "@/query/types";
import { useSignal } from "@/signals/react";

/**
 * The returned `trigger` never rejects: it resolves with a `TTriggerResult`
 * envelope (`{ status: "success", data }` / `{ status: "error", error }`), so
 * fire-and-forget usage (`onClick={() => trigger(args)}`) cannot produce an
 * unhandled rejection — the failure also surfaces through `state`. Call
 * `.unwrap()` for the raw throwing promise.
 */
export function useCommand<TArgs, TData, TError = unknown>(
    command: ICommand<TArgs, TData, TError>,
    entryKey?: string,
): [trigger: (args: TArgs) => TTriggerPromise<TData, TError>, state: TCommandClutchState<TArgs, TData, TError>] {
    // The clutch is keyed by entryKey during render — a key change rebuilds
    // it (useConstant re-creates on dep change), so the first commit under a
    // new key already observes that key's entry, and `undefined` binds a
    // fresh clutch that triggers under a generated key rather than reusing
    // the previous one.
    const clutch = useConstant(() => command.createClutch(entryKey), [command, entryKey]);

    const state = useSignal(clutch.state$);

    const trigger = useEventHandler((args: TArgs) => clutch.trigger(args));

    return [trigger, state];
}
