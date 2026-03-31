import type { CommandLink, ICommandLinkOptions } from "@/query/types";

/**
 * Creates a type-safe link definition for `createCommand`.
 *
 * Infers `RArgs` and `RData` from the provided `resource`, ensuring that
 * `draft` in `update` / `optimisticUpdate` callbacks is fully typed.
 *
 * @example
 * ```ts
 * const cmd = api.createCommand({
 *   queryFn: (args: { id: number; title: string }) => fetch(...),
 *   link: [
 *     commandLink({
 *       resource: myResource,                      // IResource<{ id: number }, { title: string }>
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
    options: ICommandLinkOptions<any, any, RArgs, RData>,
): CommandLink<any, any> {
    return options as CommandLink<any, any>;
}
