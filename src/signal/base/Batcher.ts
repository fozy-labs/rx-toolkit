import { BehaviorSubject } from "rxjs";

export const Batcher = {
    isLocked$: new BehaviorSubject(false),
    lock() {
        if (this.isLocked$.value) return;
        this.isLocked$.next(true);
    },
    unlock() {
        if (!this.isLocked$.value) return;
        this.isLocked$.next(false);
    },
    batch(fn: () => void) {
        if (this.isLocked$.value) return fn();
        this.lock();
        fn();
        this.unlock();
    },
}
