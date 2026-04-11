import type { TLinkConfig, TLinksInput } from "@/query/types";

export function normalizeLinks<TArgs, TData>(
    input: TLinksInput<TArgs, TData> | undefined,
): TLinkConfig<TArgs, TData, any, any>[] {
    if (!input) return [];
    if (Array.isArray(input)) return input;
    const collected: TLinkConfig<TArgs, TData, any, any>[] = [];
    input((config) => {
        collected.push(config);
    });
    return collected;
}
