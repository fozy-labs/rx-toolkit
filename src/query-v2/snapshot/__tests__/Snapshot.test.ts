import { getSnapshot, hydrateSnapshot, CURRENT_SNAPSHOT_VERSION } from '../Snapshot';
import { ResourceV2, type ResourceV2Config } from '@/query-v2/core/ResourceV2';
import { MachineSuccess } from '@/query-v2/core/machines/MachineSuccess';
import { MachineIdle } from '@/query-v2/core/machines/MachineIdle';
import { Machine } from '@/query-v2/core/machines/Machine';
import type { TApiSnapshot } from '@/query-v2/types/snapshot.types';

function createResource<TArgs = number, TData = string>(
    overrides: Partial<ResourceV2Config<TArgs, TData>> = {},
): ResourceV2<TArgs, TData> {
    return new ResourceV2<TArgs, TData>({
        queryFn: vi.fn(async () => 'data' as TData),
        key: 'testResource',
        keyStrategy: 'serialize',
        cacheLifetime: 60_000,
        ...overrides,
    });
}

function controllableQueryFn<TArgs = unknown, TData = unknown>() {
    const calls: Array<{
        args: TArgs;
        resolve: (data: TData) => void;
        reject: (error: Error) => void;
    }> = [];

    const fn = vi.fn((args: TArgs, { abortSignal }: { abortSignal: AbortSignal }) => {
        return new Promise<TData>((resolve, reject) => {
            let settled = false;
            const wrappedResolve = (data: TData) => { if (!settled) { settled = true; resolve(data); } };
            const wrappedReject = (error: Error) => { if (!settled) { settled = true; reject(error); } };
            calls.push({ args, resolve: wrappedResolve, reject: wrappedReject });
            abortSignal.addEventListener('abort', () => {
                wrappedReject(new DOMException('Aborted', 'AbortError'));
            });
        });
    });

    return { fn, calls };
}

describe('Snapshot', () => {
    // S1: getSnapshot captures only MachineSuccess entries
    it('S1: getSnapshot captures only MachineSuccess entries', async () => {
        const { fn, calls } = controllableQueryFn<number, string>();
        const resource = createResource({ queryFn: fn, key: 'res1' });

        // Query 3 entries: resolve one, leave one pending, error one
        const p1 = resource.query(1);
        const p2 = resource.query(2);
        const p3 = resource.query(3);

        // Resolve first → MachineSuccess
        calls[0].resolve('data-1');
        await p1;

        // Leave second as pending

        // Reject third → MachineError
        calls[2].reject(new Error('fail'));
        await p3.catch(() => {});

        const registry = new Map<string, ResourceV2<any, any, any>>();
        registry.set('res1', resource);

        const snapshot = getSnapshot(registry, null, 'serialize');

        expect(snapshot.version).toBe(CURRENT_SNAPSHOT_VERSION);
        expect(snapshot.keyPrefix).toBe(null);
        expect(Object.keys(snapshot.resources)).toEqual(['res1']);

        const entries = snapshot.resources['res1'].entries;
        // Only the resolved entry should be in snapshot
        const entryKeys = Object.keys(entries);
        expect(entryKeys).toHaveLength(1);

        const entry = Object.values(entries)[0];
        expect(entry.status).toBe('success');
        expect(entry.data).toBe('data-1');
    });

    // S2: initialSnapshot hydrates entries to MachineSuccess
    it('S2: initialSnapshot hydrates entries to MachineSuccess', () => {
        const resource = createResource({ key: 'res1' });
        const registry = new Map<string, ResourceV2<any, any, any>>();
        registry.set('res1', resource);

        const snapshot: TApiSnapshot = {
            version: CURRENT_SNAPSHOT_VERSION,
            keyPrefix: null,
            resources: {
                res1: {
                    entries: {
                        '1': { status: 'success', args: 1, data: 'hydrated-data', updatedAt: Date.now() },
                    },
                },
            },
        };

        hydrateSnapshot(snapshot, registry, null, 300_000);

        const entry = resource.entry(1 as any);
        expect(entry).not.toBeNull();
        const machine = entry!.peek();
        expect(machine.state.status).toBe('success');
        expect(machine.state.data).toBe('hydrated-data');
    });

    // S3: maxSnapshotDataAge triggers invalidation for stale entries
    it('S3: maxSnapshotDataAge triggers invalidation for stale entries', () => {
        const { fn, calls } = controllableQueryFn<number, string>();
        const resource = createResource({ queryFn: fn, key: 'res1' });
        const registry = new Map<string, ResourceV2<any, any, any>>();
        registry.set('res1', resource);

        const staleTime = Date.now() - 400_000; // 400s ago
        const snapshot: TApiSnapshot = {
            version: CURRENT_SNAPSHOT_VERSION,
            keyPrefix: null,
            resources: {
                res1: {
                    entries: {
                        '1': { status: 'success', args: 1, data: 'stale-data', updatedAt: staleTime },
                    },
                },
            },
        };

        hydrateSnapshot(snapshot, registry, null, 300_000); // maxAge = 300s

        const entry = resource.entry(1 as any);
        expect(entry).not.toBeNull();
        // Should have been invalidated → MachineRefreshing (or at least not idle)
        const machine = entry!.peek();
        expect(machine.state.status).toBe('refreshing');
        expect(machine.state.data).toBe('stale-data');
    });

    // S4: version mismatch → snapshot ignored
    it('S4: version mismatch — snapshot ignored', () => {
        const resource = createResource({ key: 'res1' });
        const registry = new Map<string, ResourceV2<any, any, any>>();
        registry.set('res1', resource);

        const snapshot: TApiSnapshot = {
            version: 999, // wrong version
            keyPrefix: null,
            resources: {
                res1: {
                    entries: {
                        '1': { status: 'success', args: 1, data: 'data', updatedAt: Date.now() },
                    },
                },
            },
        };

        hydrateSnapshot(snapshot, registry, null, 300_000);

        const entry = resource.entry(1 as any);
        expect(entry).toBeNull(); // Not hydrated
    });

    // S5: keyPrefix mismatch → silent skip
    it('S5: keyPrefix mismatch — snapshot silently skipped', () => {
        const resource = createResource({ key: 'res1' });
        const registry = new Map<string, ResourceV2<any, any, any>>();
        registry.set('res1', resource);

        const snapshot: TApiSnapshot = {
            version: CURRENT_SNAPSHOT_VERSION,
            keyPrefix: 'other-prefix', // mismatch
            resources: {
                res1: {
                    entries: {
                        '1': { status: 'success', args: 1, data: 'data', updatedAt: Date.now() },
                    },
                },
            },
        };

        hydrateSnapshot(snapshot, registry, 'main', 300_000); // API has keyPrefix='main'

        const entry = resource.entry(1 as any);
        expect(entry).toBeNull(); // Not hydrated
    });

    // S6: compare strategy throws on getSnapshot
    it('S6: getSnapshot throws for compare strategy', () => {
        const registry = new Map<string, ResourceV2<any, any, any>>();

        expect(() => {
            getSnapshot(registry, null, 'compare');
        }).toThrow(/compare/);
    });

    // S7: Snapshot round-trip
    it('S7: round-trip — getSnapshot → initialSnapshot produces identical data', async () => {
        const { fn, calls } = controllableQueryFn<number, string>();
        const resource = createResource({ queryFn: fn, key: 'res1' });
        const registry = new Map<string, ResourceV2<any, any, any>>();
        registry.set('res1', resource);

        // Populate data
        const p1 = resource.query(1);
        const p2 = resource.query(2);
        calls[0].resolve('data-1');
        calls[1].resolve('data-2');
        await p1;
        await p2;

        // Dehydrate
        const snapshot = getSnapshot(registry, 'test', 'serialize');
        expect(snapshot.version).toBe(CURRENT_SNAPSHOT_VERSION);
        expect(snapshot.keyPrefix).toBe('test');

        // Rehydrate into fresh resource
        const resource2 = createResource({ key: 'res1' });
        const registry2 = new Map<string, ResourceV2<any, any, any>>();
        registry2.set('res1', resource2);

        hydrateSnapshot(snapshot, registry2, 'test', 300_000);

        // Verify data matches
        const entry1 = resource2.entry(1 as any);
        const entry2 = resource2.entry(2 as any);
        expect(entry1).not.toBeNull();
        expect(entry2).not.toBeNull();
        expect(entry1!.peek().state.data).toBe('data-1');
        expect(entry2!.peek().state.data).toBe('data-2');
    });

    // S8: Machine.fromSnapshot reconstructs correct class
    it('S8: Machine.fromSnapshot reconstructs MachineSuccess instance', () => {
        const restored = Machine.fromSnapshot({
            status: 'success',
            data: 'test-data',
            args: 42,
            updatedAt: 100,
        });

        expect(restored).toBeInstanceOf(MachineSuccess);
        expect(restored.state.status).toBe('success');
        expect(restored.state.data).toBe('test-data');
        expect(restored.state.args).toBe(42);
        expect(restored.state.updatedAt).toBe(100);
    });
});
