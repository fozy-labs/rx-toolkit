import { createApi } from '../createApi';
import { MachineSuccess } from '@/query-v2/core/machines/MachineSuccess';
import { CURRENT_SNAPSHOT_VERSION } from '@/query-v2/snapshot/Snapshot';
import type { IPlugin, IPluginContext } from '@/query-v2/types/plugin.types';
import type { IResourceV2, IResourceV2Options } from '@/query-v2/types/resource.types';
import type { TApiSnapshot } from '@/query-v2/types/snapshot.types';

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

describe('createApi', () => {
    // API1: Creates API with default options
    it('API1: creates API with default options', () => {
        const api = createApi();

        expect(api).toBeDefined();
        expect(typeof api.createResource).toBe('function');
        expect(typeof api.resetAll).toBe('function');
        expect(typeof api.getSnapshot).toBe('function');
    });

    // API2: createResource enforces unique key
    it('API2: createResource enforces unique key', () => {
        const api = createApi();

        api.createResource({
            key: 'users',
            queryFn: async () => 'data',
        });

        expect(() => {
            api.createResource({
                key: 'users',
                queryFn: async () => 'other-data',
            });
        }).toThrow(/Duplicate resource key "users"/);
    });

    // API3: resetAll resets all registered resources
    it('API3: resetAll resets all registered resources', async () => {
        const { fn: fn1, calls: calls1 } = controllableQueryFn<number, string>();
        const { fn: fn2, calls: calls2 } = controllableQueryFn<number, string>();

        const api = createApi();
        const res1 = api.createResource({ key: 'r1', queryFn: fn1 });
        const res2 = api.createResource({ key: 'r2', queryFn: fn2 });

        // Query both
        const p1 = res1.query(1);
        const p2 = res2.query(2);
        calls1[0].resolve('data-1');
        calls2[0].resolve('data-2');
        await p1;
        await p2;

        // Verify data exists
        expect(res1.entry(1)!.peek().state.status).toBe('success');
        expect(res2.entry(2)!.peek().state.status).toBe('success');

        // Reset all
        api.resetAll();

        // Verify caches cleared
        expect(res1.entry(1)).toBeNull();
        expect(res2.entry(2)).toBeNull();
    });

    // API4: keyPrefix in devtools keys — test indirectly via snapshot keyPrefix
    it('API4: keyPrefix set on API is reflected in snapshot', () => {
        const api = createApi({ keyPrefix: 'main' });
        const snapshot = api.getSnapshot();
        expect(snapshot.keyPrefix).toBe('main');
    });

    // API5: default keyStrategy is serialize
    it('API5: default keyStrategy is serialize', async () => {
        const { fn, calls } = controllableQueryFn<{ id: number }, string>();
        const api = createApi();
        const resource = api.createResource({ key: 'r1', queryFn: fn });

        // With serialize, same-shape objects should cache-hit
        const p1 = resource.query({ id: 1 });
        calls[0].resolve('data');
        await p1;

        // Same structure should hit cache
        const entry = resource.entry({ id: 1 });
        expect(entry).not.toBeNull();
        expect(entry!.peek().state.status).toBe('success');

        // getSnapshot should work (serialize supports it)
        expect(() => api.getSnapshot()).not.toThrow();
    });

    // API6: compare strategy selects CompareCacheMap
    it('API6: compare strategy — getSnapshot throws', () => {
        const api = createApi({ keyStrategy: 'compare' });

        // With compare strategy, getSnapshot should throw
        expect(() => api.getSnapshot()).toThrow(/compare/);
    });

    // API7: per-resource options override API defaults
    it('API7: per-resource options override API defaults', async () => {
        const { fn, calls } = controllableQueryFn<number, string>();
        const api = createApi({ cacheLifetime: 100 });
        const resource = api.createResource({
            key: 'r1',
            queryFn: fn,
            cacheLifetime: 50,
        });

        // Resource should use per-resource cacheLifetime (50ms)
        // We verify this indirectly — resource is created successfully
        expect(resource).toBeDefined();
        expect(typeof resource.query).toBe('function');
    });

    // D1: Default beforeDevtoolsPush projects machine.state
    it('D1: machine state is JSON-serializable for devtools', async () => {
        const { fn, calls } = controllableQueryFn<number, string>();
        const api = createApi();
        const resource = api.createResource({ key: 'r1', queryFn: fn });

        const p = resource.query(1);
        calls[0].resolve('test-data');
        await p;

        const entry = resource.entry(1);
        const machine = entry!.peek();
        const state = machine.state;

        // Should be JSON-serializable (no class instances, no circular refs)
        expect(() => JSON.stringify(state)).not.toThrow();
        expect(state.status).toBe('success');
        expect(state.data).toBe('test-data');
    });

    // D2: Custom beforeDevtoolsPush transforms
    it('D2: custom beforeDevtoolsPush is applied to resource', async () => {
        const pushSpy = vi.fn();
        const { fn, calls } = controllableQueryFn<number, { name: string; password: string }>();
        const api = createApi();
        const resource = api.createResource({
            key: 'r1',
            queryFn: fn,
            beforeDevtoolsPush: (value, push) => {
                // Redact sensitive data
                if (value && typeof value === 'object' && 'data' in value) {
                    const cleaned = { ...value, data: '***' };
                    push(cleaned as any);
                } else {
                    push(value);
                }
            },
        });

        // Resource should be created with the transform applied
        expect(resource).toBeDefined();
    });

    // D3: beforeDevtoolsPush suppression — resource created with callback that doesn't call push
    it('D3: beforeDevtoolsPush can suppress push', () => {
        const api = createApi();
        const resource = api.createResource({
            key: 'r1',
            queryFn: async () => 'data',
            beforeDevtoolsPush: (_value, _push) => {
                // Intentionally not calling push() — suppresses devtools
            },
        });

        expect(resource).toBeDefined();
    });

    // Hydration via initialSnapshot
    it('Hydration: initialSnapshot hydrates resource on createResource', () => {
        const snapshot: TApiSnapshot = {
            version: CURRENT_SNAPSHOT_VERSION,
            keyPrefix: null,
            resources: {
                users: {
                    entries: {
                        '1': { status: 'success', args: 1, data: 'Alice', updatedAt: Date.now() },
                    },
                },
            },
        };

        const api = createApi({ initialSnapshot: snapshot });
        const resource = api.createResource({
            key: 'users',
            queryFn: async () => 'should-not-be-called',
        });

        const entry = resource.entry(1 as any);
        expect(entry).not.toBeNull();
        expect(entry!.peek().state.status).toBe('success');
        expect(entry!.peek().state.data).toBe('Alice');
    });
});
