import React from 'react'
import { BehaviorSubject, Observable } from 'rxjs'
import { useEventHandler } from "./useEventHandler";
import { useConstant } from "./useConstant";

const NONE = Symbol('NONE')

/**
 * Hook for automatically subscribing and unsubscribing from an Observable.
 * If the Observable synchronously returns a value, it returns it.
 * Else returns initialValue.
 * If the value of the Observable changes, it resubscribes.
 * If a value equal to the previous one arrives in the Observable,
 *   the previous value is returned without triggering a re-render.
 * @param input$ Observable.
 * @param initialValue Initial value that will be used before the Observable emits a value.
 */
export function useObservable<T>(
    input$: Observable<T>,
    initialValue: T,
): T {
    const { subject$, subscription } = useConstant(() => {
        const subject = new BehaviorSubject<T | typeof NONE>(NONE)

        /**
         * Check if the Observable synchronously returns a value,
         *  like BehaviorSubject or etc.
         */
        const subscription = input$
            .subscribe((value) => subject.next(value))

        return {
            subject$: subject,
            subscription,
        }
    }, [input$])

    React.useEffect(() => {
        return () => {
            subscription.unsubscribe()
            subject$.complete()
        }
    }, [subject$])

    const subscribe = React.useCallback((updateStore: () => void) => {
        const subjectSubscription = subject$.subscribe(updateStore)

        return () => {
            subjectSubscription.unsubscribe()
        }
    }, [input$, subject$])

    const getSnapshot = useEventHandler(() => subject$.getValue())

    let value = React.useSyncExternalStore(subscribe, getSnapshot)

    if (value === NONE) {
        value = initialValue
    }

    return value
}
