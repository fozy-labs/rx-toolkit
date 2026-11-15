import { DefaultOptions } from "./DefaultOptions";
import { SharedOptions } from "./SharedOptions";

describe("DefaultOptions", () => {
    describe("update()", () => {
        it("updates DEVTOOLS on SharedOptions", () => {
            const mockDevtools = { state: () => () => {} } as any;
            DefaultOptions.update({ DEVTOOLS: mockDevtools });
            expect(SharedOptions.DEVTOOLS).toBe(mockDevtools);
        });

        it("sets DEVTOOLS to null", () => {
            SharedOptions.DEVTOOLS = { state: () => () => {} } as any;
            DefaultOptions.update({ DEVTOOLS: null });
            expect(SharedOptions.DEVTOOLS).toBe(null);
        });

        it("updates MACHINE_DEVTOOLS on SharedOptions and accepts null", () => {
            const inspector = { actor: () => ({ event() {}, snapshot() {}, stop() {} }) };
            DefaultOptions.update({ MACHINE_DEVTOOLS: inspector });
            expect(SharedOptions.MACHINE_DEVTOOLS).toBe(inspector);

            DefaultOptions.update({ MACHINE_DEVTOOLS: null });
            expect(SharedOptions.MACHINE_DEVTOOLS).toBe(null);
        });

        it("updates getScopeName on SharedOptions", () => {
            const fn = () => "my-scope";
            DefaultOptions.update({ getScopeName: fn });
            expect(SharedOptions.getScopeName).toBe(fn);
        });

        it("updates multiple fields at once", () => {
            const mockDevtools = { state: () => () => {} } as any;
            const getScopeName = () => "my-scope";
            DefaultOptions.update({ DEVTOOLS: mockDevtools, getScopeName });
            expect(SharedOptions.DEVTOOLS).toBe(mockDevtools);
            expect(SharedOptions.getScopeName).toBe(getScopeName);
        });

        it("does not overwrite fields not included in the partial", () => {
            const getScopeName = () => "my-scope";
            SharedOptions.getScopeName = getScopeName;
            DefaultOptions.update({ DEVTOOLS: null });
            expect(SharedOptions.getScopeName).toBe(getScopeName);
        });
    });
});
