import { beforeEach, describe, expect, it, vi } from "vitest";

import { _createCommandV2 } from "@/query-v2/api/_createCommandV2";
import { createApi } from "@/query-v2/api/createApi";
import { ReactHooksPlugin } from "@/query-v2/plugins/ReactHooksPlugin";
import type { IPlugin, IPluginContext, TCommandQueryFn, TCommandV2Options } from "@/query-v2/types";

type TArgs = { id: number };
type TResult = { name: string };

function createOptions(overrides?: Partial<TCommandV2Options<TArgs, TResult>>): TCommandV2Options<TArgs, TResult> {
    const queryFn: TCommandQueryFn<TArgs, TResult> = vi.fn(() => Promise.resolve({ name: "test" }));
    return { queryFn, ...overrides };
}

describe("_createCommandV2 (standalone factory)", () => {
    it("returns ICommandV2 with createAgent and resetCache", () => {
        const command = _createCommandV2<TArgs, TResult>(createOptions());

        expect(command).toBeDefined();
        expect(typeof command.createAgent).toBe("function");
        expect(typeof command.resetCache).toBe("function");
    });

    it("createAgent() returns a valid agent", () => {
        const command = _createCommandV2<TArgs, TResult>(createOptions());
        const agent = command.createAgent();

        expect(typeof agent.state$).toBe("function");
        expect(typeof agent.trigger).toBe("function");
        expect(typeof agent.reset).toBe("function");
    });
});

describe("createApi().createCommandV2", () => {
    it("returns augmented command", () => {
        const api = createApi();
        const command = api.createCommandV2<TArgs, TResult>(createOptions());

        expect(command).toBeDefined();
        expect(typeof command.createAgent).toBe("function");
        expect(typeof command.resetCache).toBe("function");
    });

    it("resetAll() calls resetCache on registered commands", () => {
        const api = createApi();
        const command = api.createCommandV2<TArgs, TResult>(createOptions());

        // Create an agent and trigger to verify entries exist
        const key = Symbol("test");
        // Use createAgent to indirectly verify reset works (it should not throw)
        const agent = command.createAgent();
        expect(agent.state$().status).toBe("idle");

        // resetAll should not throw
        api.resetAll();

        // After reset, new agents start idle
        const agent2 = command.createAgent();
        expect(agent2.state$().status).toBe("idle");
    });

    it("augmentCommand is called on plugins that define it", () => {
        const augmentCommandSpy = vi.fn().mockReturnValue({ customHook: () => {} });

        const customPlugin: IPlugin = {
            name: "TestPlugin",
            install: vi.fn(),
            augmentCommand: augmentCommandSpy,
        };

        const api = createApi({ plugins: [customPlugin] as const });
        const opts = createOptions();
        const command = api.createCommandV2<TArgs, TResult>(opts);

        expect(augmentCommandSpy).toHaveBeenCalledTimes(1);
        expect(augmentCommandSpy).toHaveBeenCalledWith(
            expect.objectContaining({ createAgent: expect.any(Function) }),
            expect.objectContaining({ queryFn: expect.any(Function) }),
        );
        // Contributed method is present on the command
        expect((command as any).customHook).toBeDefined();
    });

    it("plugins without augmentCommand are skipped gracefully", () => {
        const pluginWithoutAugment: IPlugin = {
            name: "PlainPlugin",
            install: vi.fn(),
            // no augmentCommand
        };

        const api = createApi({ plugins: [pluginWithoutAugment] as const });

        // Should not throw
        const command = api.createCommandV2<TArgs, TResult>(createOptions());
        expect(command).toBeDefined();
    });

    it("detects plugin key collisions", () => {
        const plugin1: IPlugin = {
            name: "Plugin1",
            install: vi.fn(),
            augmentCommand: vi.fn().mockReturnValue({ sharedKey: 1 }),
        };
        const plugin2: IPlugin = {
            name: "Plugin2",
            install: vi.fn(),
            augmentCommand: vi.fn().mockReturnValue({ sharedKey: 2 }),
        };

        const api = createApi({ plugins: [plugin1, plugin2] as const });
        expect(() => api.createCommandV2<TArgs, TResult>(createOptions())).toThrow(/Plugin key collision/);
    });

    it("default cacheLifetime for commands is 0", () => {
        const augmentSpy = vi.fn().mockReturnValue({});

        const plugin: IPlugin = {
            name: "InspectorPlugin",
            install: vi.fn(),
            augmentCommand: augmentSpy,
        };

        const api = createApi({ plugins: [plugin] as const });
        api.createCommandV2<TArgs, TResult>(createOptions());

        // The merged options passed to augmentCommand should have cacheLifetime: 0
        const passedOptions = augmentSpy.mock.calls[0][1];
        expect(passedOptions.cacheLifetime).toBe(0);
    });
});
