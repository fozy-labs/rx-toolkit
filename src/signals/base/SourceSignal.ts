import { Observable, Subscriber, TeardownLogic } from "rxjs";

import { type ReadonlySignal } from "@/signals/types";

import { ReceiverNode } from "./ReceiverNode";

function producerNode<T>(
    subscribe: ((subscriber: Subscriber<T>) => TeardownLogic) | undefined,
    defaultValue: [defaultValue?: T],
): ReceiverNode<T> {
    return new ReceiverNode(new Observable<T>(subscribe), "none", defaultValue.length > 0, defaultValue[0], undefined);
}

/**
 * A read-only signal over a producer function: the producer starts on the
 * first observer and stops when the last one leaves; a read without
 * observers starts and stops it around the read. Without `defaultValue`, a
 * read before the producer emitted throws `"No value emitted"`.
 */
export class SourceSignal<T> {
    private readonly _node: ReceiverNode<T>;
    readonly obs: Observable<T>;

    constructor(subscribe?: (subscriber: Subscriber<T>) => TeardownLogic, ...defaultValue: [defaultValue?: T]) {
        this._node = producerNode(subscribe, defaultValue);
        this.obs = this._node.obs;
    }

    get(): T {
        return this._node.get();
    }

    peek(): T {
        return this._node.peek();
    }

    static create<T>(
        subscribe?: (subscriber: Subscriber<T>) => TeardownLogic,
        ...defaultValue: [defaultValue?: T]
    ): ReadonlySignal<T> {
        const signal = producerNode(subscribe, defaultValue);

        function readonlySignalFn(): T {
            return signal.get();
        }

        readonlySignalFn.obs = signal.obs;
        readonlySignalFn.peek = () => signal.peek();
        readonlySignalFn.get = () => signal.get();

        return readonlySignalFn;
    }
}
