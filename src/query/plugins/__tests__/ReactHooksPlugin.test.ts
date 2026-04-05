import { vi } from "vitest";

import { createApi } from "@/query/api/createApi";
import { ReactHooksPlugin } from "@/query/plugins/ReactHooksPlugin";
import type { IPlugin, IResource, TResourceOptions } from "@/query/types";

function createMockPlugin(name: string, contributions?: Record<string, unknown>): IPlugin {
    return {
        name,
        install: vi.fn(),
        augmentResource: contributions ? vi.fn(() => contributions) : vi.fn(() => ({})),
    };
}

describe("ReactHooksPlugin", () => {
    // PL01: plugin.install(context) called during createApi()
    it("PL01: install is called with context during createApi()", () => {
        const plugin = new ReactHooksPlugin();
        const installSpy = vi.spyOn(plugin, "install");

        createApi({ plugins: [plugin] as const });

        expect(installSpy).toHaveBeenCalledTimes(1);
        expect(installSpy).toHaveBeenCalledWith(expect.objectContaining({ strategy: "serialize" }));
    });

    // PL02: plugin.augmentResource called per createResource()
    it("PL02: augmentResource is called per createResource()", () => {
        const plugin = new ReactHooksPlugin();
        const augmentSpy = vi.spyOn(plugin, "augmentResource");

        const api = createApi({ plugins: [plugin] as const });
        api.createResource({ queryFn: () => Promise.resolve("data"), cacheLifetime: false as never });

        expect(augmentSpy).toHaveBeenCalledTimes(1);
    });

    // PL03: contributions merged via Object.assign onto resource
    it("PL03: contributions are merged onto resource instance", () => {
        const mockPlugin = createMockPlugin("TestPlugin", { testMethod: () => 42 });

        const api = createApi({ plugins: [mockPlugin] as const });
        const resource = api.createResource({
            queryFn: () => Promise.resolve("data"),
            cacheLifetime: false as never,
        });

        expect((resource as any).testMethod).toBeDefined();
        expect((resource as any).testMethod()).toBe(42);
    });

    // PL04: plugins installed in registration order
    it("PL04: plugins are installed in registration order", () => {
        const order: string[] = [];
        const pluginA: IPlugin = {
            name: "PluginA",
            install: vi.fn(() => {
                order.push("A");
            }),
        };
        const pluginB: IPlugin = {
            name: "PluginB",
            install: vi.fn(() => {
                order.push("B");
            }),
        };

        createApi({ plugins: [pluginA, pluginB] as const });

        expect(order).toEqual(["A", "B"]);
    });

    // PL05: key collision detection throws on duplicate contribution keys
    it("PL05: throws on duplicate contribution keys from different plugins", () => {
        const pluginA = createMockPlugin("PluginA", { sharedKey: () => "a" });
        const pluginB = createMockPlugin("PluginB", { sharedKey: () => "b" });

        const api = createApi({ plugins: [pluginA, pluginB] as const });

        expect(() => {
            api.createResource({ queryFn: () => Promise.resolve("data"), cacheLifetime: false as never });
        }).toThrow(/Plugin key collision.*sharedKey/);
    });

    // PL06: ReactHooksPlugin contributes useResourceAgent method
    it("PL06: ReactHooksPlugin adds useResourceAgent method to resource", () => {
        const plugin = new ReactHooksPlugin();

        const api = createApi({ plugins: [plugin] as const });
        const resource = api.createResource({
            queryFn: () => Promise.resolve("data"),
            cacheLifetime: false as never,
        });

        expect((resource as any).useResourceAgent).toBeDefined();
        expect(typeof (resource as any).useResourceAgent).toBe("function");
    });

    // PL07: plugin error in install propagates
    it("PL07: error in plugin.install propagates from createApi", () => {
        const badPlugin: IPlugin = {
            name: "BadPlugin",
            install: () => {
                throw new Error("install failed");
            },
        };

        expect(() => {
            createApi({ plugins: [badPlugin] as const });
        }).toThrow("install failed");
    });

    // PL08: plugin error in augmentResource propagates
    it("PL08: error in plugin.augmentResource propagates from createResource", () => {
        const badPlugin: IPlugin = {
            name: "BadPlugin",
            install: vi.fn(),
            augmentResource: () => {
                throw new Error("augment failed");
            },
        };

        const api = createApi({ plugins: [badPlugin] as const });

        expect(() => {
            api.createResource({ queryFn: () => Promise.resolve("data"), cacheLifetime: false as never });
        }).toThrow("augment failed");
    });

    // PL11: later plugin's augmentResource can access earlier plugin's contributions
    it("PL11: later plugin sees earlier plugin's contributions on resource", () => {
        let sawEarlierContribution = false;

        const pluginA: IPlugin = {
            name: "PluginA",
            install: vi.fn(),
            augmentResource: vi.fn((): Record<string, unknown> => ({ fromA: () => "hello" })),
        };

        const pluginB = {
            name: "PluginB",
            install: vi.fn(),
            augmentResource: vi.fn(
                <TArgs, TData>(
                    resource: IResource<TArgs, TData>,
                    _options: TResourceOptions<TArgs, TData>,
                ): Record<string, unknown> => {
                    // By the time pluginB runs, pluginA's contributions should be merged
                    sawEarlierContribution = typeof (resource as any).fromA === "function";
                    return { fromB: () => "world" };
                },
            ),
        } as IPlugin;

        const api = createApi({ plugins: [pluginA, pluginB] as const });
        api.createResource({ queryFn: () => Promise.resolve("data"), cacheLifetime: false as never });

        expect(sawEarlierContribution).toBe(true);
    });
});
