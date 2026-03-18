import { describe, it, expect } from 'vitest';
import { Patcher } from './Patcher';
import { NO_VALUE } from '@/query-v2/lib/NO_VALUE';
import type { TResourceV2Patch } from '@/query-v2/types/machine.types';

describe('Patcher', () => {
    // P1: createPatch produces patch and inverse
    it('P1: createPatch produces patches and inversePatches', () => {
        const data = { name: 'old', count: 0 };
        const patch = Patcher.createPatch<typeof data>(d => {
            d.name = 'new';
        }, data);

        expect(patch.status).toBe('pending');
        expect(patch.patches.length).toBeGreaterThan(0);
        expect(patch.inversePatches.length).toBeGreaterThan(0);
    });

    // P2: resolvePatches — single committed patch
    it('P2: resolvePatches with single committed patch applies and removes', () => {
        const original = { name: 'Alice' };
        const patch = Patcher.createPatch<typeof original>(d => {
            d.name = 'Bob';
        }, original);
        patch.status = 'committed';

        const result = Patcher.resolvePatches(original, [patch]);
        expect(result.data).toEqual({ name: 'Bob' });
        expect(result.patches).toEqual([]); // committed before any pending → removed
    });

    // P3: resolvePatches — single pending patch
    it('P3: resolvePatches with single pending patch applies and keeps', () => {
        const original = { name: 'Alice' };
        const patch = Patcher.createPatch<typeof original>(d => {
            d.name = 'Bob';
        }, original);
        // status is 'pending' by default

        const result = Patcher.resolvePatches(original, [patch]);
        expect(result.data).toEqual({ name: 'Bob' });
        expect(result.patches).toHaveLength(1);
        expect(result.patches[0]).toBe(patch);
    });

    // P4: resolvePatches — committed then pending
    it('P4: resolvePatches with committed then pending', () => {
        const original = { name: 'Alice', age: 30 };

        const committed = Patcher.createPatch<typeof original>(d => {
            d.name = 'Bob';
        }, original);
        committed.status = 'committed';

        // Apply committed to get data for pending patch
        const afterCommit = { name: 'Bob', age: 30 };
        const pending = Patcher.createPatch<typeof original>(d => {
            d.age = 99;
        }, afterCommit);

        const result = Patcher.resolvePatches(original, [committed, pending]);
        expect(result.data).toEqual({ name: 'Bob', age: 99 });
        // committed removed (before first pending), pending kept
        expect(result.patches).toHaveLength(1);
        expect(result.patches[0]).toBe(pending);
    });

    // P5: resolvePatches — aborted patch (no pending before)
    it('P5: resolvePatches with single aborted patch removes it', () => {
        const original = { name: 'Alice' };
        const patch = Patcher.createPatch<typeof original>(d => {
            d.name = 'Bob';
        }, original);
        patch.status = 'aborted';

        const result = Patcher.resolvePatches(original, [patch]);
        expect(result.data).toEqual({ name: 'Alice' }); // no changes applied
        expect(result.patches).toEqual([]);
    });

    // P6: resolvePatches — pending → aborted
    it('P6: resolvePatches with pending then aborted (no more pending after)', () => {
        const original = { name: 'Alice', age: 30 };

        const pending = Patcher.createPatch<typeof original>(d => {
            d.name = 'Bob';
        }, original);
        // status = 'pending'

        const aborted = Patcher.createPatch<typeof original>(d => {
            d.age = 99;
        }, { name: 'Bob', age: 30 }); // patch was made on data after pending
        aborted.status = 'aborted';

        const result = Patcher.resolvePatches(original, [pending, aborted]);
        // pending applied and kept; aborted has no pending after it → removed
        expect(result.patches).toHaveLength(1);
        expect(result.patches[0]).toBe(pending);
        // Data: original + pending applied = { name: 'Bob', age: 30 }
        // aborted is removed (no pending after)
        expect(result.data).toEqual({ name: 'Bob', age: 30 });
    });

    // P7: resolvePatches — committed after pending stays in queue
    it('P7: resolvePatches with pending then committed keeps both', () => {
        const original = { name: 'Alice', age: 30 };

        const pending = Patcher.createPatch<typeof original>(d => {
            d.name = 'Bob';
        }, original);

        const committed = Patcher.createPatch<typeof original>(d => {
            d.age = 99;
        }, { name: 'Bob', age: 30 });
        committed.status = 'committed';

        const result = Patcher.resolvePatches(original, [pending, committed]);
        expect(result.data).toEqual({ name: 'Bob', age: 99 });
        expect(result.patches).toHaveLength(2);
    });

    // P8: finishPatch commit — clears originalData when no pending remain
    it('P8: finishPatch commit clears originalData when no pending remain', () => {
        const original = { name: 'Alice' };
        const patch = Patcher.createPatch<typeof original>(d => {
            d.name = 'Bob';
        }, original);

        const result = Patcher.finishPatch(original, [patch], 'commit', patch);
        expect(result.originalData).toBe(NO_VALUE);
        expect(result.patches).toBeNull();
        expect(result.data).toEqual({ name: 'Bob' });
    });

    // P9: finishPatch abort — reverts to original
    it('P9: finishPatch abort reverts data to original', () => {
        const original = { name: 'Alice' };
        const patch = Patcher.createPatch<typeof original>(d => {
            d.name = 'Bob';
        }, original);

        const result = Patcher.finishPatch(original, [patch], 'abort', patch);
        expect(result.originalData).toBe(NO_VALUE);
        expect(result.patches).toBeNull();
        expect(result.data).toEqual({ name: 'Alice' });
    });

    // P10: finishPatch commit — keeps originalData when pending patches remain
    it('P10: finishPatch commit keeps originalData when pending remain', () => {
        const original = { name: 'Alice', age: 30 };

        const patchA = Patcher.createPatch<typeof original>(d => {
            d.name = 'Bob';
        }, original);

        const patchB = Patcher.createPatch<typeof original>(d => {
            d.age = 99;
        }, { name: 'Bob', age: 30 });

        const result = Patcher.finishPatch(original, [patchA, patchB], 'commit', patchA);
        // patchA committed → consumed and baked into baseData, originalData advances
        expect(result.originalData).toEqual({ name: 'Bob', age: 30 });
        expect(result.patches).not.toBeNull();
        // patchA consumed, patchB stays as pending
        expect(result.patches!).toHaveLength(1);
        expect(result.patches![0]).toBe(patchB);
    });

    // P11: Multiple patches: create, add, commit first, abort second
    it('P11: multi-patch sequence — commit first, abort second reverts to original', () => {
        const original = { name: 'Alice', age: 30 };

        const patch1 = Patcher.createPatch<typeof original>(d => {
            d.name = 'Bob';
        }, original);

        const patch2 = Patcher.createPatch<typeof original>(d => {
            d.age = 99;
        }, { name: 'Bob', age: 30 });

        // Commit patch1
        const r1 = Patcher.finishPatch(original, [patch1, patch2], 'commit', patch1);
        // patch1 committed, patch2 still pending
        expect(r1.patches).not.toBeNull();

        // Abort patch2
        const r2 = Patcher.finishPatch(r1.originalData as typeof original, r1.patches, 'abort', patch2);
        // Both resolved, queue empty
        expect(r2.originalData).toBe(NO_VALUE);
        expect(r2.patches).toBeNull();
        // Final data: original + commit(patch1) + abort(patch2) = { name: 'Bob', age: 30 }
        expect(r2.data).toEqual({ name: 'Bob', age: 30 });
    });

    // P12: abortAllPendingPatches cleans up all pending
    it('P12: abortAllPending aborts all pending patches', () => {
        const original = { name: 'Alice', age: 30, city: 'NY' };

        const p1 = Patcher.createPatch<typeof original>(d => { d.name = 'Bob'; }, original);
        const p2 = Patcher.createPatch<typeof original>(d => { d.age = 99; }, { ...original, name: 'Bob' });
        const p3 = Patcher.createPatch<typeof original>(d => { d.city = 'LA'; }, { ...original, name: 'Bob', age: 99 });

        const result = Patcher.abortAllPending(original, [p1, p2, p3]);
        expect(result.originalData).toBe(NO_VALUE);
        expect(result.patches).toBeNull();
        expect(result.data).toEqual(original);
    });
});
