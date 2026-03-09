import { describe, it, expect } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { ReadonlySignal } from './ReadonlySignal';

describe('ReadonlySignal', () => {
    describe('ReadonlySignal.create(subscribe)', () => {
        it('creates a callable signal from subscribe function', () => {
            const signal = ReadonlySignal.create<number>((subscriber) => {
                subscriber.next(42);
            });

            expect(typeof signal).toBe('function');
            expect(signal()).toBe(42);
        });
    });

    describe('peek()', () => {
        it('returns current value synchronously', () => {
            const signal = ReadonlySignal.create<string>((subscriber) => {
                subscriber.next('hello');
            });

            expect(signal.peek()).toBe('hello');
        });
    });

    describe('obs', () => {
        it('returns Observable that emits values on subscription', () => {
            const subject = new BehaviorSubject(10);
            const signal = ReadonlySignal.create<number>((subscriber) => {
                subject.subscribe(subscriber);
            });

            const values: number[] = [];
            const sub = signal.obs.subscribe((v: number) => values.push(v));

            subject.next(20);
            subject.next(30);
            sub.unsubscribe();

            expect(values).toEqual([10, 20, 30]);
        });
    });

    describe('calling signal()', () => {
        it('returns the current value (equivalent to get())', () => {
            const signal = ReadonlySignal.create<number>((subscriber) => {
                subscriber.next(99);
            });

            expect(signal()).toBe(99);
            expect(signal.get()).toBe(99);
            expect(signal.peek()).toBe(99);
        });
    });

    describe('readonly contract', () => {
        it('has no set() method', () => {
            const signal = ReadonlySignal.create<number>((subscriber) => {
                subscriber.next(1);
            });

            expect(signal).not.toHaveProperty('set');
        });
    });
});
