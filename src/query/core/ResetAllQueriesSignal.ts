import { Subject } from "rxjs";
import { Batcher } from "@/signals";

export class ResetAllQueriesSignal {
    private static subject$ = new Subject<void>();

    static clean$ = ResetAllQueriesSignal.subject$;

    static clean() {
        Batcher.run(() => {
            ResetAllQueriesSignal.subject$.next();
        });
    }
}
