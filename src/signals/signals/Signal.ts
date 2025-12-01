import { BehaviorSubject, Observable, SubscriptionLike } from "rxjs";
import { Batcher, Tracker, Devtools, ReadableSignalLike, SignalLike, UnaryFunction } from "../base";
import { StateDevtoolsOptions } from "@/common/devtools";
import { SharedOptions } from "@/common/options/SharedOptions";

export class Signal<T> extends BehaviorSubject<T> implements SubscriptionLike, SignalLike<T> {
    private readonly _stateDevtools;
    protected _rang = 0;
    protected readonly _scopeDestroyedSub = SharedOptions.getScopeDestroyed$?.()?.subscribe(() => {
        this.complete();
    });

    constructor(initialValue: T, options?: StateDevtoolsOptions) {
        super(initialValue);

        this._stateDevtools = Devtools.createState(initialValue, {
            base: 'Signals',
            ...(typeof options === 'string' ? { name: options } : options)
        });
    }

    protected _onChange(value: T): void {
        Batcher.batch(() => {
            this._stateDevtools?.(value);
            super.next(value);
        });
    }

    get value(): T {
        Tracker.next(this._rang, this);
        return super.value;
    }

    set value(value: T) {
        this._onChange(value);
    }

    next(value: T): void {
        this._onChange(value);
    }

    peek(): T {
        return super.value;
    }

    /**
     * @deprecated use `value` instead.
     */
    get() {
        return this.value;
    }

    /**
     * @deprecated use `peek()` instead.
     */
    getValue(): T {
        return super.getValue();
    }

    /**
     * @deprecated use `next(value)` instead.
     */
    set(value: T) {
        return this.next(value);
    }

    complete() {
        this._stateDevtools?.('$COMPLETED' as any);
        this._scopeDestroyedSub?.unsubscribe();
        super.complete();
    }

    /**
     * @deprecated use `complete()` instead.
     */
    unsubscribe() {
        this.complete();
    }

    asReadonly(): ReadableSignalLike<T> {
        return this;
    }

    pipe(): Signal<T>;
    pipe<A extends Observable<any>>(op1: UnaryFunction<ReadableSignalLike<T>, A>): A

    pipe<
        A extends Observable<any>,
        B extends Observable<any>,
    >(
        op1: UnaryFunction<Signal<T>, A>,
        op2: UnaryFunction<A, B>,
    ): B;

    pipe<
        A extends Observable<any>,
        B extends Observable<any>,
        C extends Observable<any>,
    >(
        op1: UnaryFunction<Signal<T>, A>,
        op2: UnaryFunction<A, B>,
        op3: UnaryFunction<B, C>,
    ): C;

    pipe<
        A extends Observable<any>,
        B extends Observable<any>,
        C extends Observable<any>,
        D extends Observable<any>,
    >(
        op1: UnaryFunction<Signal<T>, A>,
        op2: UnaryFunction<A, B>,
        op3: UnaryFunction<B, C>,
        op4: UnaryFunction<C, D>,
    ): D;

    pipe<
        A extends Observable<any>,
        B extends Observable<any>,
        C extends Observable<any>,
        D extends Observable<any>,
        E extends Observable<any>,
    >(
        op1: UnaryFunction<Signal<T>, A>,
        op2: UnaryFunction<A, B>,
        op3: UnaryFunction<B, C>,
        op4: UnaryFunction<C, D>,
        op5: UnaryFunction<D, E>,
    ): E;

    pipe<
        A extends Observable<any>,
        B extends Observable<any>,
        C extends Observable<any>,
        D extends Observable<any>,
        E extends Observable<any>,
        F extends Observable<any>,
    >(
        op1: UnaryFunction<Signal<T>, A>,
        op2: UnaryFunction<A, B>,
        op3: UnaryFunction<B, C>,
        op4: UnaryFunction<C, D>,
        op5: UnaryFunction<D, E>,
        op6: UnaryFunction<E, F>,
    ): F;

    pipe<
        A extends Observable<any>,
        B extends Observable<any>,
        C extends Observable<any>,
        D extends Observable<any>,
        E extends Observable<any>,
        F extends Observable<any>,
        G extends Observable<any>,
    >(
        op1: UnaryFunction<Signal<T>, A>,
        op2: UnaryFunction<A, B>,
        op3: UnaryFunction<B, C>,
        op4: UnaryFunction<C, D>,
        op5: UnaryFunction<D, E>,
        op6: UnaryFunction<E, F>,
        op7: UnaryFunction<F, G>,
    ): G;

    pipe<
        A extends Observable<any>,
        B extends Observable<any>,
        C extends Observable<any>,
        D extends Observable<any>,
        E extends Observable<any>,
        F extends Observable<any>,
        G extends Observable<any>,
        H extends Observable<any>,
    >(
        op1: UnaryFunction<Signal<T>, A>,
        op2: UnaryFunction<A, B>,
        op3: UnaryFunction<B, C>,
        op4: UnaryFunction<C, D>,
        op5: UnaryFunction<D, E>,
        op6: UnaryFunction<E, F>,
        op7: UnaryFunction<F, G>,
        op8: UnaryFunction<G, H>,
    ): H;

    pipe<
        A extends Observable<any>,
        B extends Observable<any>,
        C extends Observable<any>,
        D extends Observable<any>,
        E extends Observable<any>,
        F extends Observable<any>,
        G extends Observable<any>,
        H extends Observable<any>,
        I extends Observable<any>
    >(
        op1: UnaryFunction<Signal<T>, A>,
        op2: UnaryFunction<A, B>,
        op3: UnaryFunction<B, C>,
        op4: UnaryFunction<C, D>,
        op5: UnaryFunction<D, E>,
        op6: UnaryFunction<E, F>,
        op7: UnaryFunction<F, G>,
        op8: UnaryFunction<G, H>,
        op9: UnaryFunction<H, I>,
    ): I;

    pipe<
        A extends Observable<any>,
        B extends Observable<any>,
        C extends Observable<any>,
        D extends Observable<any>,
        E extends Observable<any>,
        F extends Observable<any>,
        G extends Observable<any>,
        H extends Observable<any>,
        I extends Observable<any>
    >(
        op1: UnaryFunction<Signal<T>, A>,
        op2: UnaryFunction<A, B>,
        op3: UnaryFunction<B, C>,
        op4: UnaryFunction<C, D>,
        op5: UnaryFunction<D, E>,
        op6: UnaryFunction<E, F>,
        op7: UnaryFunction<F, G>,
        op8: UnaryFunction<G, H>,
        op9: UnaryFunction<H, I>,
        ...operations: UnaryFunction<Observable<any>, Observable<any>>[]
    ): Observable<unknown>;

    pipe(...operations: UnaryFunction<any, any>[]): unknown {
        return operations.reduce(pipeReducer, this as any);
    }
}

function pipeReducer(prev: any, fn: UnaryFunction<any, any>) {
    return fn(prev);
}
