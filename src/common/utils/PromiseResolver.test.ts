import { PromiseResolver } from "./PromiseResolver";

describe("PromiseResolver", () => {
    it("resolve() resolves the promise with the given value", async () => {
        const resolver = new PromiseResolver<number>();
        resolver.resolve(42);
        await expect(resolver.promise).resolves.toBe(42);
    });

    it("reject() rejects the promise with the given error", async () => {
        const resolver = new PromiseResolver<string>();
        const error = new Error("test error");
        resolver.reject(error);
        await expect(resolver.promise).rejects.toBe(error);
    });

    it(".promise returns the same Promise instance each time", () => {
        const resolver = new PromiseResolver<void>();
        expect(resolver.promise).toBe(resolver.promise);
    });

    it("works with generic types", async () => {
        const resolver = new PromiseResolver<{ id: number; name: string }>();
        const value = { id: 1, name: "test" };
        resolver.resolve(value);
        await expect(resolver.promise).resolves.toEqual(value);
    });
});
