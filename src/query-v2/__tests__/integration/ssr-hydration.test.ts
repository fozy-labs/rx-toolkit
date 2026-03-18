import { createApi } from '@/query-v2/api/createApi';
import { MachineSuccess } from '@/query-v2/core/machines/MachineSuccess';
import { MachineRefreshing } from '@/query-v2/core/machines/MachineRefreshing';
import { Machine } from '@/query-v2/core/machines/Machine';
import { CURRENT_SNAPSHOT_VERSION } from '@/query-v2/snapshot/Snapshot';
import type { TApiSnapshot } from '@/query-v2/types/snapshot.types';

/** Controllable queryFn: returns a promise you can resolve/reject from outside */
function controllableQueryFn<TArgs = unknown, TData = unknown>() {
    const calls: Array<{
        args: TArgs;
        resolve: (data: TData) => void;
        reject: (error: Error) => void;
    }> = [];

    const fn = vi.fn((args: TArgs, { abortSignal }: { abortSignal: AbortSignal }) => {
        return new Promise<TData>((resolve, reject) => {
            let settled = false;
            const wrappedResolve = (data: TData) => {
                if (settled) return;
                settled = true;
                resolve(data);
            };
            const wrappedReject = (error: Error) => {
                if (settled) return;
                settled = true;
                reject(error);
            };
            calls.push({ args, resolve: wrappedResolve, reject: wrappedReject });
            abortSignal.addEventListener('abort', () => {
                wrappedReject(new DOMException('Aborted', 'AbortError'));
            });
        });
    });

    return { fn, calls };
}

describe('Integration: SSR Hydration Round-Trip', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // Correctness Verification #2: Server → Client data flow
    it('server → getSnapshot → JSON roundtrip → client createApi with initialSnapshot → data available', async () => {
        // --- SERVER SIDE ---
        const serverQueryFn = vi.fn(async (args: number) => ({ id: args, name: `User ${args}` }));
        const serverApi = createApi({ keyPrefix: 'app' });
        const serverResource = serverApi.createResource({
            key: 'users',
            queryFn: serverQueryFn,
        });

        // Execute queries on server
        await serverResource.query(1);
        await serverResource.query(2);

        // Dehydrate
        const snapshot = serverApi.getSnapshot();
        expect(snapshot.version).toBe(CURRENT_SNAPSHOT_VERSION);
        expect(snapshot.keyPrefix).toBe('app');

        // JSON round-trip (simulates embedding in HTML)
        const serialized = JSON.stringify(snapshot);
        const parsed: TApiSnapshot = JSON.parse(serialized);

        // --- CLIENT SIDE ---
        const clientQueryFn = vi.fn(async () => ({ id: 0, name: 'should-not-be-called' }));
        const clientApi = createApi({
            keyPrefix: 'app',
            initialSnapshot: parsed,
        });
        const clientResource = clientApi.createResource({
            key: 'users',
            queryFn: clientQueryFn,
        });

        // Verify data available immediately without fetch
        const entry1 = clientResource.entry(1 as any);
        const entry2 = clientResource.entry(2 as any);
        expect(entry1).not.toBeNull();
        expect(entry2).not.toBeNull();

        expect(entry1!.peek().state.status).toBe('success');
        expect(entry1!.peek().state.data).toEqual({ id: 1, name: 'User 1' });
        expect(entry2!.peek().state.data).toEqual({ id: 2, name: 'User 2' });

        // Client queryFn should NOT have been called (data from snapshot)
        expect(clientQueryFn).not.toHaveBeenCalled();

        // Verify Machine.fromSnapshot produces correct instanceof
        const machine = entry1!.peek();
        expect(machine).toBeInstanceOf(MachineSuccess);
    });

    // Version mismatch → snapshot skipped
    it('version mismatch → snapshot ignored, no hydration', () => {
        const snapshot: TApiSnapshot = {
            version: 999, // wrong version
            keyPrefix: null,
            resources: {
                items: {
                    entries: {
                        '1': { status: 'success', args: 1, data: 'stale', updatedAt: Date.now() },
                    },
                },
            },
        };

        const api = createApi({ initialSnapshot: snapshot });
        const resource = api.createResource({
            key: 'items',
            queryFn: async () => 'fresh',
        });

        // Should not be hydrated
        expect(resource.entry(1 as any)).toBeNull();
    });

    // KeyPrefix mismatch → snapshot skipped
    it('keyPrefix mismatch → snapshot ignored, no hydration', () => {
        const snapshot: TApiSnapshot = {
            version: CURRENT_SNAPSHOT_VERSION,
            keyPrefix: 'server-prefix',
            resources: {
                items: {
                    entries: {
                        '1': { status: 'success', args: 1, data: 'data', updatedAt: Date.now() },
                    },
                },
            },
        };

        const api = createApi({
            keyPrefix: 'client-prefix', // mismatch
            initialSnapshot: snapshot,
        });
        const resource = api.createResource({
            key: 'items',
            queryFn: async () => 'fresh',
        });

        expect(resource.entry(1 as any)).toBeNull();
    });

    // maxSnapshotDataAge → triggers refresh
    it('maxSnapshotDataAge → stale entries trigger refresh (MachineRefreshing)', () => {
        const { fn, calls } = controllableQueryFn<number, string>();
        const staleTime = Date.now() - 400_000; // 400s ago

        const snapshot: TApiSnapshot = {
            version: CURRENT_SNAPSHOT_VERSION,
            keyPrefix: null,
            resources: {
                items: {
                    entries: {
                        '1': { status: 'success', args: 1, data: 'stale-data', updatedAt: staleTime },
                    },
                },
            },
        };

        const api = createApi({
            initialSnapshot: snapshot,
            maxSnapshotDataAge: 300_000, // 5 min
        });

        const resource = api.createResource({
            key: 'items',
            queryFn: fn,
        });

        // Entry should exist and be refreshing (stale > maxSnapshotDataAge)
        const entry = resource.entry(1 as any);
        expect(entry).not.toBeNull();
        expect(entry!.peek().state.status).toBe('refreshing');
        expect(entry!.peek().state.data).toBe('stale-data'); // stale data preserved
    });

    // Fresh entries within maxSnapshotDataAge are NOT refreshed
    it('fresh entries within maxSnapshotDataAge stay as success', () => {
        const freshTime = Date.now() - 10_000; // 10s ago

        const snapshot: TApiSnapshot = {
            version: CURRENT_SNAPSHOT_VERSION,
            keyPrefix: null,
            resources: {
                items: {
                    entries: {
                        '1': { status: 'success', args: 1, data: 'fresh-data', updatedAt: freshTime },
                    },
                },
            },
        };

        const api = createApi({
            initialSnapshot: snapshot,
            maxSnapshotDataAge: 300_000,
        });

        const resource = api.createResource({
            key: 'items',
            queryFn: async () => 'should-not-be-called',
        });

        const entry = resource.entry(1 as any);
        expect(entry).not.toBeNull();
        expect(entry!.peek()).toBeInstanceOf(MachineSuccess);
        expect(entry!.peek().state.status).toBe('success');
        expect(entry!.peek().state.data).toBe('fresh-data');
    });
});
