import type { ReadonlySignal } from "@/signals/types";

import { useSignalWithServerSnapshot } from "./useSignalWithServerSnapshot";

export function useSignal<T>(signal$: ReadonlySignal<T>): T {
    // The server snapshot is the current value too: on the server it is what
    // gets rendered, on the client it matches the server once the state is
    // restored before hydration (a query cache from its snapshot).
    return useSignalWithServerSnapshot(signal$, signal$);
}
