import { Observable } from "rxjs";
import { useSyncObservable } from "@/common/react";

type SignalLike<T> = {
    obsv$: Observable<T>;
};

export function useSignal<T>(signal$: SignalLike<T>): T {
    return useSyncObservable(signal$.obsv$);
}
