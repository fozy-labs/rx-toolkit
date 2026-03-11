import { describe, it, expect } from 'vitest';
import {
    // base
    Batcher,
    ComputeCache,
    DependencyTracker,
    Devtools,
    ReadonlySignal,
    SyncObservable,
    // operators
    signalize,
    // react
    useSignal,
    // signals
    State,
    Computed,
    Effect,
    Signal,
    LocalState,
    LocalSignal,
    // types
    normalizeSignalOptions,
} from '@/signals';
import type {
    SignalOptions,
    SignalOptionsOrKey,
    SignalLifecycleHook,
} from '@/signals';

describe('Signals module exports', () => {

    describe('base', () => {
        it('exports Batcher', () => {
            expect(Batcher).toBeDefined();
            expect(typeof Batcher.run).toBe('function');
            expect(typeof Batcher.scheduler).toBe('function');
        });

        it('exports ComputeCache', () => {
            expect(ComputeCache).toBeDefined();
            expect(typeof ComputeCache).toBe('function'); // class
        });

        it('exports DependencyTracker', () => {
            expect(DependencyTracker).toBeDefined();
            expect(typeof DependencyTracker.track).toBe('function');
            expect(typeof DependencyTracker.start).toBe('function');
        });

        it('exports Devtools', () => {
            expect(Devtools).toBeDefined();
            expect(typeof Devtools.createState).toBe('function');
        });

        it('exports ReadonlySignal', () => {
            expect(ReadonlySignal).toBeDefined();
            expect(typeof ReadonlySignal.create).toBe('function');
        });

        it('exports SyncObservable', () => {
            expect(SyncObservable).toBeDefined();
            expect(typeof SyncObservable).toBe('function'); // class
        });
    });

    describe('operators', () => {
        it('exports signalize', () => {
            expect(signalize).toBeDefined();
            expect(typeof signalize).toBe('function');
        });
    });

    describe('react', () => {
        it('exports useSignal', () => {
            expect(useSignal).toBeDefined();
            expect(typeof useSignal).toBe('function');
        });
    });

    describe('signals', () => {
        it('exports State', () => {
            expect(State).toBeDefined();
            expect(typeof State.create).toBe('function');
        });

        it('exports Computed', () => {
            expect(Computed).toBeDefined();
            expect(typeof Computed.create).toBe('function');
        });

        it('exports Effect', () => {
            expect(Effect).toBeDefined();
            expect(typeof Effect.create).toBe('function');
        });

        it('exports Signal', () => {
            expect(Signal).toBeDefined();
            expect(typeof Signal.state).toBe('function');
            expect(typeof Signal.compute).toBe('function');
            expect(typeof Signal.effect).toBe('function');
        });

        it('exports LocalState', () => {
            expect(LocalState).toBeDefined();
            expect(typeof LocalState.create).toBe('function');
        });

        it('exports LocalSignal (deprecated alias)', () => {
            expect(LocalSignal).toBeDefined();
            expect(LocalSignal).toBe(LocalState);
        });
    });

    describe('types', () => {
        it('exports normalizeSignalOptions', () => {
            expect(normalizeSignalOptions).toBeDefined();
            expect(typeof normalizeSignalOptions).toBe('function');
        });

        it('exports SignalOptions type', () => {
            const opts: SignalOptions = { key: 'test' };
            expect(opts.key).toBe('test');
        });

        it('exports SignalOptionsOrKey type', () => {
            const opts1: SignalOptionsOrKey = 'test';
            const opts2: SignalOptionsOrKey = { key: 'test' };
            expect(opts1).toBe('test');
            expect(opts2.key).toBe('test');
        });

        it('exports SignalLifecycleHook type', () => {
            const hook: SignalLifecycleHook = { onChange: () => {} };
            expect(hook.onChange).toBeTypeOf('function');
        });
    });

});
