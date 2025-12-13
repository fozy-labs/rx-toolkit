import { Observable } from "rxjs";
import { useSyncObservable } from "@/common/react";

type SignalLike<T> = {
    obs: Observable<T>;
};

export function useSignal<T>(signal$: SignalLike<T>): T {
    return useSyncObservable(signal$.obs);
}
