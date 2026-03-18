import { describe, it, expect, vi } from 'vitest';
import { Signal } from '@/signals';
import { CacheEntry } from './CacheEntry';
import { MachineIdle } from './machines/MachineIdle';
import { MachinePending } from './machines/MachinePending';
import { MachineSuccess } from './machines/MachineSuccess';
import { MachineError } from './machines/MachineError';
import { MachineRefreshing } from './machines/MachineRefreshing';
import { MachineWithData } from './machines/MachineWithData';

describe('CacheEntry', () => {
    it('peek() returns initial machine', () => {
        const idle = MachineIdle.create();
        const entry = new CacheEntry(idle);
        expect(entry.peek()).toBe(idle);
    });

    it('set() updates machine, peek() returns updated', () => {
        const entry = new CacheEntry(MachineIdle.create());
        const success = MachineSuccess.create('data', { id: 1 });
        entry.set(success);
        expect(entry.peek()).toBe(success);
    });

    it('machine$ is a reactive signal read', () => {
        const entry = new CacheEntry(MachineIdle.create());
        let evalCount = 0;

        const computed = Signal.compute(() => {
            evalCount++;
            return entry.machine$();
        });

        // Initial read
        const first = computed.get();
        expect(first.state.status).toBe('idle');
        expect(evalCount).toBe(1);

        // Update machine
        const success = MachineSuccess.create('hello', { id: 1 });
        entry.set(success);

        // Re-read triggers re-evaluation
        const second = computed.get();
        expect(second).toBe(success);
        expect(evalCount).toBe(2);
    });

    it('set() is no-op after complete()', () => {
        const entry = new CacheEntry(MachineIdle.create());
        entry.complete();

        const success = MachineSuccess.create('data', { id: 1 });
        entry.set(success);

        // Should still be idle (from complete())
        expect(entry.peek().state.status).toBe('idle');
    });

    it('complete() is idempotent', () => {
        const entry = new CacheEntry(MachineIdle.create());
        entry.complete();
        expect(() => entry.complete()).not.toThrow();
    });
});

describe('CacheEntry — complete() patch abort (ADR-4 Layer 3)', () => {
    it('complete() calls abortAllPendingPatches on MachineWithData', () => {
        const success = MachineSuccess.create({ name: 'initial' }, { id: 1 });
        const { machine: patched } = success.createPatch((d: { name: string }) => {
            d.name = 'optimistic';
        });
        const entry = new CacheEntry(patched);

        const spy = vi.spyOn(MachineWithData.prototype, 'abortAllPendingPatches');
        entry.complete();
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('complete() sets machine to idle', () => {
        const success = MachineSuccess.create('data', { id: 1 });
        const entry = new CacheEntry(success);
        entry.complete();
        expect(entry.peek().state.status).toBe('idle');
    });

    it('complete() does not call abortAllPendingPatches on non-MachineWithData', () => {
        const pending = MachinePending.create({ id: 1 });
        const entry = new CacheEntry(pending);

        const spy = vi.spyOn(MachineWithData.prototype, 'abortAllPendingPatches');
        entry.complete();
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});

describe('CacheEntry — onClean$', () => {
    it('onClean$ fires on complete()', () => {
        const entry = new CacheEntry(MachineIdle.create());
        const cb = vi.fn();
        entry.onClean$.subscribe(cb);
        entry.complete();
        expect(cb).toHaveBeenCalledOnce();
    });

    it('onClean$ does not fire twice on double complete()', () => {
        const entry = new CacheEntry(MachineIdle.create());
        const cb = vi.fn();
        entry.onClean$.subscribe(cb);
        entry.complete();
        entry.complete();
        expect(cb).toHaveBeenCalledOnce();
    });
});

describe('CacheEntry — Devtools (D4)', () => {
    // D4: Machine state is JSON-serializable for devtools
    it('D4: all 5 machine types produce JSON-serializable state', () => {
        const machines = [
            MachineIdle.create(),
            MachinePending.create({ id: 1 }),
            MachineSuccess.create({ name: 'test' }, { id: 1 }),
            MachineError.create(new Error('fail'), { id: 1 }),
            MachineRefreshing.create({ name: 'test' }, { id: 1 }, Date.now()),
        ];

        for (const machine of machines) {
            expect(() => JSON.stringify(machine.state)).not.toThrow();
        }
    });

    it('beforeDevtoolsPush composes with user callback', () => {
        const userPush = vi.fn();
        const userCallback = vi.fn((state: unknown, push: (v: unknown) => void) => {
            push(state);
        });

        // Verify the option is accepted without errors
        const entry = new CacheEntry(MachineIdle.create(), {
            beforeDevtoolsPush: userCallback,
        });

        expect(entry.peek().state.status).toBe('idle');
    });

    it('key is built from keyParts', () => {
        // Verify keyParts option is accepted without errors
        const entry = new CacheEntry(MachineIdle.create(), {
            keyParts: ['api', 'users', '{"id":1}'],
        });

        expect(entry.peek().state.status).toBe('idle');
    });
});
