import type { CommandV2Link, ICommandV2LinkOptions } from "@/query-v2/types";

/**
 * Creates a type-safe link definition for `createCommandV2`.
 *
 * Infers `RArgs` and `RData` from the provided `resource`, ensuring that
 * `draft` in `update` / `optimisticUpdate` callbacks is fully typed.
 *
 * @example
 * ```ts
 * const cmd = api.createCommandV2({
 *   queryFn: (args: { id: number; title: string }) => fetch(...),
 *   link: [
 *     commandLink({
 *       resource: myResource,                      // IResourceV2<{ id: number }, { title: string }>
 *       forwardArgs: (args) => ({ id: args.id }),   // args: any (TArgs flows from command context)
 *       invalidate: true,
 *       optimisticUpdate: ({ draft }) => {          // draft: { title: string } — fully typed!
 *         draft.title = "Optimistic";
 *       },
 *     }),
 *   ],
 * });
 * ```
 */
export function commandLink<RArgs, RData>(
    options: ICommandV2LinkOptions<any, any, RArgs, RData>,
): CommandV2Link<any, any> {
    return options as CommandV2Link<any, any>;
}
