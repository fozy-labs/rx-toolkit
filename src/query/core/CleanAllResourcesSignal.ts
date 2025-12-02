import { Subject } from "rxjs";
import { Batcher } from "@/signals";

export class CleanAllResourcesSignal {
    private static subject$ = new Subject<void>();

    static clean$ = CleanAllResourcesSignal.subject$;

    static clean() {
        Batcher.batch(() => {
            CleanAllResourcesSignal.subject$.next();
        });
    }
}
