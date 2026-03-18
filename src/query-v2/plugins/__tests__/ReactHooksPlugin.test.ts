import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { expectTypeOf } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createApi } from '@/query-v2/api/createApi';
import { ReactHooksPlugin } from '../ReactHooksPlugin';
import type { IReactHooksPluginContributions } from '../ReactHooksPlugin';
import type { IPlugin, IPluginContext } from '@/query-v2/types/plugin.types';
import type { IResourceV2, IResourceV2Options } from '@/query-v2/types/resource.types';
import type { IResourceV2AgentState, IResourceV2Ref } from '@/query-v2/types/agent.types';

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

/** Mock plugin for testing multi-plugin composition */
class MockPlugin implements IPlugin {
    readonly name = 'MockPlugin';
    installSpy = vi.fn();
    augmentSpy = vi.fn();

    install(context: IPluginContext): void {
        this.installSpy(context);
    }

    augmentResource<TArgs, TData, TError>(
        resource: IResourceV2<TArgs, TData, TError>,
        options: IResourceV2Options<TArgs, TData, TError>,
    ): Record<string, unknown> {
        this.augmentSpy(resource, options);
        return { mockMethod: () => 'mock-value' };
    }
}

describe('ReactHooksPlugin', () => {
    // PL1: ReactHooksPlugin adds useResourceV2Agent to resource
    it('PL1: ReactHooksPlugin adds useResourceV2Agent to resource', () => {
        const api = createApi({ plugins: [new ReactHooksPlugin()] });
        const resource = api.createResource({
            key: 'users',
            queryFn: async () => 'data',
        });

        expect(typeof resource.useResourceV2Agent).toBe('function');
        expect(typeof resource.useResourceV2Ref).toBe('function');
    });

    // PL2: Without ReactHooksPlugin, hooks not present
    it('PL2: without ReactHooksPlugin, hooks not present', () => {
        const api = createApi();
        const resource = api.createResource({
            key: 'users',
            queryFn: async () => 'data',
        });

        expect((resource as any).useResourceV2Agent).toBeUndefined();
        expect((resource as any).useResourceV2Ref).toBeUndefined();
    });

    // PL3: install called once
    it('PL3: plugin.install called once during createApi', () => {
        const plugin = new ReactHooksPlugin();
        const installSpy = vi.spyOn(plugin, 'install');

        createApi({ plugins: [plugin] });

        expect(installSpy).toHaveBeenCalledTimes(1);
        expect(installSpy).toHaveBeenCalledWith(
            expect.objectContaining({ keyStrategy: 'serialize' }),
        );
    });

    // PL4: augmentResource called per createResource
    it('PL4: augmentResource called per createResource', () => {
        const plugin = new ReactHooksPlugin();
        const augmentSpy = vi.spyOn(plugin, 'augmentResource');

        const api = createApi({ plugins: [plugin] });

        api.createResource({ key: 'r1', queryFn: async () => 1 });
        api.createResource({ key: 'r2', queryFn: async () => 2 });
        api.createResource({ key: 'r3', queryFn: async () => 3 });

        expect(augmentSpy).toHaveBeenCalledTimes(3);
    });

    // PL5: Multiple plugins compose contributions
    it('PL5: multiple plugins compose contributions', () => {
        const mockPlugin = new MockPlugin();
        const api = createApi({ plugins: [new ReactHooksPlugin(), mockPlugin] as any });
        const resource = api.createResource({
            key: 'r1',
            queryFn: async () => 'data',
        });

        expect(typeof (resource as any).useResourceV2Agent).toBe('function');
        expect(typeof (resource as any).useResourceV2Ref).toBe('function');
        expect(typeof (resource as any).mockMethod).toBe('function');
        expect((resource as any).mockMethod()).toBe('mock-value');
    });

    // PL6: Type test — plugin contributions appear in return type
    it('PL6: type test — plugin contributions in return type', () => {
        const api = createApi({ plugins: [new ReactHooksPlugin()] });
        const resource = api.createResource<number, string>({
            key: 'r1',
            queryFn: async () => 'data',
        });

        // Resource should have the hook methods at the type level
        expectTypeOf(resource.useResourceV2Agent).toBeFunction();
        expectTypeOf(resource.useResourceV2Ref).toBeFunction();

        // Without plugin, these shouldn't exist
        const api2 = createApi();
        const resource2 = api2.createResource<number, string>({
            key: 'r2',
            queryFn: async () => 'data',
        });

        // @ts-expect-error — useResourceV2Agent should not exist on resource without plugin
        resource2.useResourceV2Agent;
    });
});

describe('ReactHooksPlugin — useResourceV2Agent hook', () => {
    it('useResourceV2Agent returns reactive state', async () => {
        const { fn, calls } = controllableQueryFn<number, string>();
        const api = createApi({ plugins: [new ReactHooksPlugin()] });
        const resource = api.createResource({
            key: 'users',
            queryFn: fn,
        });

        const { result } = renderHook(() =>
            resource.useResourceV2Agent(1),
        );

        // Initially loading
        expect(result.current.isLoading).toBe(true);
        expect(result.current.data).toBeNull();

        // Resolve the query
        await act(async () => {
            calls[0].resolve('Alice');
            await new Promise(r => setTimeout(r, 10));
        });

        // After resolution
        expect(result.current.isLoading).toBe(false);
        expect(result.current.data).toBe('Alice');
        expect(result.current.isSuccess).toBe(true);
    });

    it('useResourceV2Agent updates on query resolution', async () => {
        const { fn, calls } = controllableQueryFn<number, string>();
        const api = createApi({ plugins: [new ReactHooksPlugin()] });
        const resource = api.createResource({
            key: 'items',
            queryFn: fn,
        });

        const { result, rerender } = renderHook(
            ({ args }) => resource.useResourceV2Agent(args),
            { initialProps: { args: 1 as number } },
        );

        // Resolve first query
        await act(async () => {
            calls[0].resolve('item-1');
            await new Promise(r => setTimeout(r, 10));
        });

        expect(result.current.data).toBe('item-1');
        expect(result.current.status).toBe('success');
    });
});

describe('ReactHooksPlugin — useResourceV2Ref hook', () => {
    it('useResourceV2Ref returns imperative handle', () => {
        const api = createApi({ plugins: [new ReactHooksPlugin()] });
        const resource = api.createResource({
            key: 'items',
            queryFn: async () => 'data',
        });

        const { result } = renderHook(() =>
            resource.useResourceV2Ref(1),
        );

        expect(result.current).toBeDefined();
        expect(typeof result.current.has).toBe('boolean');
        expect(typeof result.current.lock).toBe('function');
        expect(typeof result.current.invalidate).toBe('function');
        expect(typeof result.current.createPatch).toBe('function');
        expect(typeof result.current.create).toBe('function');
    });

    it('useResourceV2Ref.has reflects cache state', async () => {
        const { fn, calls } = controllableQueryFn<number, string>();
        const api = createApi({ plugins: [new ReactHooksPlugin()] });
        const resource = api.createResource({
            key: 'items',
            queryFn: fn,
        });

        const { result } = renderHook(() =>
            resource.useResourceV2Ref(1),
        );

        // Initially no entry
        expect(result.current.has).toBe(false);

        // Populate via query
        await act(async () => {
            resource.query(1);
            calls[0].resolve('data');
            await new Promise(r => setTimeout(r, 10));
        });

        // Now has entry — but ref is memoized, need to re-render
        expect(result.current.has).toBe(true);
    });
});
