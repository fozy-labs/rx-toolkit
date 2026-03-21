import { createApi } from "@/query-v2/api/createApi";
import { ReactHooksPlugin } from "@/query-v2/plugins/ReactHooksPlugin";
import type { IPlugin, IPluginContext } from "@/query-v2/types/plugin.types";
import type { IResourceV2, IResourceV2Options } from "@/query-v2/types/resource.types";

/** Mock plugin for testing multi-plugin composition */
class CustomTestPlugin implements IPlugin {
    readonly name = "CustomTestPlugin";
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
        return {
            customMethod: () => "custom-value",
            customProp: 42,
        };
    }
}

/** Another mock plugin to test 2+ plugins */
class AnotherPlugin implements IPlugin {
    readonly name = "AnotherPlugin";
    installSpy = vi.fn();
    augmentSpy = vi.fn();

    install(context: IPluginContext): void {
        this.installSpy(context);
    }

    augmentResource<TArgs, TData, TError>(
        _resource: IResourceV2<TArgs, TData, TError>,
        _options: IResourceV2Options<TArgs, TData, TError>,
    ): Record<string, unknown> {
        this.augmentSpy(_resource, _options);
        return {
            anotherMethod: () => "another-value",
        };
    }
}

describe("Integration: Plugin Augmentation", () => {
    // Type test: resource WITH ReactHooksPlugin has hooks, WITHOUT doesn't
    describe("type-level augmentation", () => {
        it("resource with ReactHooksPlugin has useResourceV2Agent and useResourceV2Ref", () => {
            const api = createApi({ plugins: [new ReactHooksPlugin()] });
            const resource = api.createResource<number, string>({
                key: "typed-resource",
                queryFn: async () => "data",
            });

            // Type-level: these methods should exist
            expectTypeOf(resource.useResourceV2Agent).toBeFunction();
            expectTypeOf(resource.useResourceV2Ref).toBeFunction();

            // Runtime: these methods should exist
            expect(typeof resource.useResourceV2Agent).toBe("function");
            expect(typeof resource.useResourceV2Ref).toBe("function");
        });

        it("resource WITHOUT ReactHooksPlugin does NOT have hook methods", () => {
            const api = createApi();
            const resource = api.createResource<number, string>({
                key: "no-plugin-resource",
                queryFn: async () => "data",
            });

            // Runtime: methods should not exist
            expect((resource as any).useResourceV2Agent).toBeUndefined();
            expect((resource as any).useResourceV2Ref).toBeUndefined();

            // Type-level: accessing these should be a type error
            // @ts-expect-error — useResourceV2Agent should not exist without plugin
            resource.useResourceV2Agent;
        });
    });

    // Runtime: 2 plugins → both contributions available
    describe("runtime augmentation with multiple plugins", () => {
        it("two plugins contribute methods that are both available on resource", () => {
            const customPlugin = new CustomTestPlugin();
            const anotherPlugin = new AnotherPlugin();

            const api = createApi({
                plugins: [customPlugin, anotherPlugin] as any,
            });

            const resource = api.createResource({
                key: "multi-plugin",
                queryFn: async () => "data",
            });

            // Both plugin contributions should be present
            expect(typeof (resource as any).customMethod).toBe("function");
            expect((resource as any).customMethod()).toBe("custom-value");
            expect((resource as any).customProp).toBe(42);
            expect(typeof (resource as any).anotherMethod).toBe("function");
            expect((resource as any).anotherMethod()).toBe("another-value");
        });

        it("install() called once per plugin during createApi", () => {
            const customPlugin = new CustomTestPlugin();
            const anotherPlugin = new AnotherPlugin();

            createApi({
                plugins: [customPlugin, anotherPlugin] as any,
            });

            expect(customPlugin.installSpy).toHaveBeenCalledTimes(1);
            expect(anotherPlugin.installSpy).toHaveBeenCalledTimes(1);

            // Both receive plugin context
            expect(customPlugin.installSpy).toHaveBeenCalledWith(expect.objectContaining({ keyStrategy: "serialize" }));
            expect(anotherPlugin.installSpy).toHaveBeenCalledWith(
                expect.objectContaining({ keyStrategy: "serialize" }),
            );
        });

        it("augmentResource() called for each createResource", () => {
            const customPlugin = new CustomTestPlugin();
            const anotherPlugin = new AnotherPlugin();

            const api = createApi({
                plugins: [customPlugin, anotherPlugin] as any,
            });

            api.createResource({ key: "r1", queryFn: async () => 1 });
            api.createResource({ key: "r2", queryFn: async () => 2 });

            expect(customPlugin.augmentSpy).toHaveBeenCalledTimes(2);
            expect(anotherPlugin.augmentSpy).toHaveBeenCalledTimes(2);
        });

        it("plugins do not conflict — contributions from both are independent", () => {
            const customPlugin = new CustomTestPlugin();
            const anotherPlugin = new AnotherPlugin();

            const api = createApi({
                plugins: [customPlugin, anotherPlugin] as any,
            });

            const res1 = api.createResource({
                key: "res1",
                queryFn: async () => "data1",
            });

            const res2 = api.createResource({
                key: "res2",
                queryFn: async () => "data2",
            });

            // Both resources have both sets of augmentations
            expect((res1 as any).customMethod()).toBe("custom-value");
            expect((res1 as any).anotherMethod()).toBe("another-value");
            expect((res2 as any).customMethod()).toBe("custom-value");
            expect((res2 as any).anotherMethod()).toBe("another-value");
        });
    });

    // ReactHooksPlugin + custom plugin together
    it("ReactHooksPlugin + custom plugin compose without conflict", () => {
        const customPlugin = new CustomTestPlugin();

        const api = createApi({
            plugins: [new ReactHooksPlugin(), customPlugin] as any,
        });

        const resource = api.createResource({
            key: "composed",
            queryFn: async () => "data",
        });

        // ReactHooksPlugin contributions
        expect(typeof (resource as any).useResourceV2Agent).toBe("function");
        expect(typeof (resource as any).useResourceV2Ref).toBe("function");

        // Custom plugin contributions
        expect(typeof (resource as any).customMethod).toBe("function");
        expect((resource as any).customMethod()).toBe("custom-value");
    });
});
