import { Subject } from "rxjs";
import { Batcher } from "@/signals";

export class CleanAllQueriesSignal {
    private static subject$ = new Subject<void>();

    static clean$ = CleanAllQueriesSignal.subject$;

    static clean() {
        Batcher.batch(() => {
            CleanAllQueriesSignal.subject$.next();
        });
    }
}
