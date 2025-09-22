import { MonoTypeOperatorFunction, SubscriptionLike } from "rxjs";
import { createOperatorSubscriber } from "rxjs/internal/operators/OperatorSubscriber";
import { ReadonlySignal, Batcher } from "../base";

export function batched<T>(): MonoTypeOperatorFunction<T> {
    return (source) => {
        let lockSubscription: SubscriptionLike | null = null;
        let lastResult: T | undefined = undefined;

        return new ReadonlySignal<T>((destination) => source.subscribe(
            createOperatorSubscriber(
                destination,
                (value) => {
                    if (lockSubscription) {
                        lastResult = value;
                        return;
                    }

                    if (Batcher.isLocked$.value) {
                        lastResult = value;

                        lockSubscription = Batcher.isLocked$.subscribe((isLocked) => {
                            if (!isLocked) {
                                lockSubscription!.unsubscribe();
                                lockSubscription = null;

                                destination.next(lastResult as T);
                                lastResult = undefined;
                            }
                        });

                        return;
                    }

                    destination.next(value);
                },
            )
        ));
    }
}
