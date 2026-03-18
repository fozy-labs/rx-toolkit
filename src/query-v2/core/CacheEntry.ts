import { Subject } from "rxjs";

import type { TBeforeDevtoolsPushFn } from "@/query-v2/types/shared.types";
import { Signal } from "@/signals";
import type { SignalFn, SignalOptions } from "@/signals";

import type { TMachineInstance } from "./machines/Machine";
import { MachineIdle } from "./machines/MachineIdle";
import { MachineWithData } from "./machines/MachineWithData";

export interface CacheEntryOptions {
    keyParts?: string[];
    beforeDevtoolsPush?: TBeforeDevtoolsPushFn<unknown>;
}

export class CacheEntry<TData = unknown, TError = Error> {
    private readonly _signal: SignalFn<TMachineInstance<TData, TError>>;
    private readonly _onClean$ = new Subject<void>();
    private _completed = false;

    constructor(initialMachine: TMachineInstance<TData, TError>, options?: CacheEntryOptions) {
        const userCallback = options?.beforeDevtoolsPush;

        // Default beforeDevtoolsPush projects machine → machine.state for devtools (ADR-8).
        // The push function types are mismatched intentionally: we push plain state objects
        // instead of machine instances to keep devtools output JSON-friendly.
        const beforeDevtoolsPush = ((newValue: unknown, push: (v: unknown) => void) => {
            const machine = newValue as TMachineInstance<TData, TError>;
            const state = machine.state;
            if (userCallback) {
                userCallback(state, push);
            } else {
                push(state);
            }
        }) as SignalOptions<TMachineInstance<TData, TError>>["beforeDevtoolsPush"];

        this._signal = Signal.state<TMachineInstance<TData, TError>>(initialMachine, {
            key: options?.keyParts?.join("/"),
            beforeDevtoolsPush,
        });
    }

    get machine$(): () => TMachineInstance<TData, TError> {
        return this._signal;
    }

    peek(): TMachineInstance<TData, TError> {
        return this._signal.peek();
    }

    set(machine: TMachineInstance<TData, TError>): void {
        if (this._completed) return;
        this._signal.set(machine);
    }

    get onClean$() {
        return {
            subscribe: (cb: () => void) => {
                const sub = this._onClean$.subscribe(cb);
                return { unsubscribe: () => sub.unsubscribe() };
            },
        };
    }

    complete(): void {
        if (this._completed) return;
        this._completed = true;

        // Layer 3 (ADR-4): Abort all pending patches on MachineWithData instances
        const current = this._signal.peek();
        if (current instanceof MachineWithData) {
            current.abortAllPendingPatches();
        }

        // Set to idle to release data references
        this._signal.set(MachineIdle.create() as unknown as TMachineInstance<TData, TError>);

        // Notify cleanup listeners
        this._onClean$.next();
        this._onClean$.complete();
    }
}
