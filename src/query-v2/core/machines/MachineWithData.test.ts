import { describe, it, expect } from 'vitest';
import { MachineSuccess } from './MachineSuccess';
import { MachineRefreshing } from './MachineRefreshing';
import { NO_VALUE } from '@/query-v2/lib/NO_VALUE';

describe('MachineWithData', () => {
    describe('on MachineSuccess', () => {
        it('createPatch returns new machine and patch', () => {
            const success = MachineSuccess.create({ name: 'Alice', age: 30 }, { id: 1 });
            const { machine, patch } = success.createPatch(draft => {
                draft.name = 'Bob';
            });

            expect(machine).toBeInstanceOf(MachineSuccess);
            expect(machine).not.toBe(success);
            expect(machine.state.data).toEqual({ name: 'Bob', age: 30 });
            expect(patch.status).toBe('pending');
            expect(patch.patches.length).toBeGreaterThan(0);
            expect(patch.inversePatches.length).toBeGreaterThan(0);

            // Original unchanged
            expect(success.state.data).toEqual({ name: 'Alice', age: 30 });
        });

        it('addPatch stores originalData on first patch', () => {
            const success = MachineSuccess.create({ name: 'Alice' }, { id: 1 });
            expect(success.state.originalData).toBe(NO_VALUE);

            const { machine } = success.createPatch(draft => {
                draft.name = 'Bob';
            });

            expect(machine.state.originalData).toEqual({ name: 'Alice' });
            expect(machine.state.data).toEqual({ name: 'Bob' });
        });

        it('finishPatch commit clears originalData when no pending remain', () => {
            const success = MachineSuccess.create({ name: 'Alice' }, { id: 1 });
            const { machine, patch } = success.createPatch(draft => {
                draft.name = 'Bob';
            });

            const committed = machine.finishPatch('commit', patch);
            expect(committed.state.originalData).toBe(NO_VALUE);
            expect(committed.state.patches).toBeNull();
            expect(committed.state.data).toEqual({ name: 'Bob' });
        });

        it('finishPatch abort reverts data', () => {
            const success = MachineSuccess.create({ name: 'Alice' }, { id: 1 });
            const { machine, patch } = success.createPatch(draft => {
                draft.name = 'Bob';
            });

            const aborted = machine.finishPatch('abort', patch);
            expect(aborted.state.originalData).toBe(NO_VALUE);
            expect(aborted.state.patches).toBeNull();
            expect(aborted.state.data).toEqual({ name: 'Alice' });
        });

        it('abortAllPendingPatches reverts all pending patches', () => {
            const success = MachineSuccess.create({ name: 'Alice', age: 30 }, { id: 1 });
            const { machine: m1 } = success.createPatch(draft => { draft.name = 'Bob'; });
            const { machine: m2 } = m1.createPatch(draft => { draft.age = 99; });

            expect(m2.state.data).toEqual({ name: 'Bob', age: 99 });

            const cleaned = m2.abortAllPendingPatches();
            expect(cleaned.state.data).toEqual({ name: 'Alice', age: 30 });
            expect(cleaned.state.originalData).toBe(NO_VALUE);
            expect(cleaned.state.patches).toBeNull();
        });

        it('patch methods return new instances (immutability)', () => {
            const success = MachineSuccess.create({ name: 'Alice' }, { id: 1 });
            const { machine } = success.createPatch(draft => { draft.name = 'Bob'; });

            expect(machine).not.toBe(success);
            expect(success.state.data).toEqual({ name: 'Alice' });
            expect(machine.state.data).toEqual({ name: 'Bob' });
        });
    });

    describe('on MachineRefreshing', () => {
        it('createPatch works on MachineRefreshing', () => {
            const refreshing = MachineRefreshing.create({ name: 'Alice' }, { id: 1 }, 1000);
            const { machine, patch } = refreshing.createPatch(draft => {
                draft.name = 'Bob';
            });

            expect(machine).toBeInstanceOf(MachineRefreshing);
            expect(machine).not.toBe(refreshing);
            expect(machine.state.data).toEqual({ name: 'Bob' });
            expect(patch.status).toBe('pending');
        });

        // E11: MachineRefreshing.successHappened() aborts pending patches
        it('E11: successHappened() aborts pending patches', () => {
            const refreshing = MachineRefreshing.create({ name: 'Alice' }, { id: 1 }, 1000);
            const { machine: withPatch } = refreshing.createPatch(draft => {
                draft.name = 'Optimistic';
            });

            expect(withPatch.state.data).toEqual({ name: 'Optimistic' });

            // withPatch is MachineRefreshing since createPatch preserves the type
            const success = withPatch.successHappened({ name: 'Fresh' });
            expect(success.state.data).toEqual({ name: 'Fresh' });
            expect(success.state.patches).toBeNull();
            expect(success.state.originalData).toBe(NO_VALUE);
        });
    });
});
