import type { IPlugin } from "./api";

// ==================== HKT Base Interfaces ====================

/**
 * Base Higher-Kinded Type for plugin resource augmentation.
 *
 * Plugin authors extend this and override `resourceType` / `commandType`
 * using `this['_TArgs']` and `this['_TData']` to refer to the resource's
 * type parameters.
 *
 * @example
 * ```ts
 * interface MyPluginHKT extends PluginHKT {
 *   readonly resourceType: { myHook: (args: this['_TArgs']) => this['_TData'] };
 * }
 * ```
 */
export interface PluginHKT {
    /** @phantom — substituted with the resource/command TArgs at application site */
    readonly _TArgs: unknown;
    /** @phantom — substituted with the resource/command TData at application site */
    readonly _TData: unknown;

    /** Override in subinterfaces to declare resource augmentation shape. */
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- intentional: {} ensures union-to-intersection collapses cleanly (see design doc)
    readonly resourceType: {};
    /** Override in subinterfaces to declare command augmentation shape. */
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- intentional: {} ensures union-to-intersection collapses cleanly (see design doc)
    readonly commandType: {};
}

// ==================== HKT Application ====================

/**
 * "Apply" a PluginHKT — substitute TArgs/TData and extract the resource augmentation type.
 *
 * Mechanism: intersect the HKT interface with concrete `{ _TArgs: TArgs; _TData: TData }`.
 * Because `resourceType` references `this['_TArgs']`/`this['_TData']`, and `this` in the
 * intersection resolves to the merged type, the phantom parameters become concrete.
 */
type ApplyPluginResourceHKT<F extends PluginHKT, TArgs, TData> = (F & {
    readonly _TArgs: TArgs;
    readonly _TData: TData;
})["resourceType"];

type ApplyPluginCommandHKT<F extends PluginHKT, TArgs, TData> = (F & {
    readonly _TArgs: TArgs;
    readonly _TData: TData;
})["commandType"];

// ==================== Plugin Augment Extraction ====================

/**
 * Extract and apply the resource augmentation from a single plugin type.
 * Returns `{}` if the plugin does not declare an HKT (graceful degradation).
 *
 * Uses bounded `infer H extends PluginHKT` to reject `undefined` from optional `_hkt`.
 */
type ExtractResourceAugment<P, TArgs, TData> = P extends { readonly _hkt: infer H extends PluginHKT }
    ? ApplyPluginResourceHKT<H, TArgs, TData>
    : // eslint-disable-next-line @typescript-eslint/no-empty-object-type
      {};

type ExtractCommandAugment<P, TArgs, TData> = P extends { readonly _hkt: infer H extends PluginHKT }
    ? ApplyPluginCommandHKT<H, TArgs, TData>
    : // eslint-disable-next-line @typescript-eslint/no-empty-object-type
      {};

// ==================== Multi-Plugin Combination ====================

/** Standard union-to-intersection utility. */
type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;

/**
 * Combine resource augmentations from all plugins in the tuple.
 * Maps each `TPlugins[number]` through `ExtractResourceAugment`, then intersects the results.
 *
 * - `readonly [ReactHooksPlugin, OtherPlugin]` → `{ useResource: ... } & { otherHook: ... }`
 * - `readonly IPlugin[]` (default) → `{}` (no augmentation)
 */
export type CombinePluginResourceAugments<TPlugins extends readonly IPlugin[], TArgs, TData> = UnionToIntersection<
    ExtractResourceAugment<TPlugins[number], TArgs, TData>
>;

export type CombinePluginCommandAugments<TPlugins extends readonly IPlugin[], TArgs, TData> = UnionToIntersection<
    ExtractCommandAugment<TPlugins[number], TArgs, TData>
>;

// ==================== Exports ====================

export type {
    ApplyPluginResourceHKT,
    ApplyPluginCommandHKT,
    ExtractResourceAugment,
    ExtractCommandAugment,
    UnionToIntersection,
};
