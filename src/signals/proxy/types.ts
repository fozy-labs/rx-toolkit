import type { StateSignal } from "@/signals/types";

type IsNullish<T> = Extract<T, null | undefined> extends never ? false : true;

interface PathCallRequired<T> {
    (): T;
}

interface PathCallOptional<T> {
    (): T | undefined;
    <I>(initialValue: I): Exclude<T, undefined> | I;
}

/**
 * Optional-chaining semantics: a segment is "optional" if any ancestor on the
 * path may be null/undefined/missing. Index access into arrays is always
 * optional (out-of-bounds), regardless of the user's tsconfig.
 */
type PathChildren<T, TOptional extends boolean> = T extends Map<any, any> | Set<any>
    ? unknown // Map/Set are atomic leaves for path traversal
    : T extends readonly (infer E)[]
      ? { readonly [index: number]: PathNode<E, true> }
      : T extends object
        ? {
              readonly [K in keyof T]-?: PathNode<T[K], TOptional extends true ? true : IsNullish<T[K]>>;
          }
        : unknown;

export type PathNode<T, TOptional extends boolean = false> = (TOptional extends true
    ? PathCallOptional<T>
    : PathCallRequired<T>) &
    PathChildren<NonNullable<T>, TOptional extends true ? true : IsNullish<T>>;

export interface ProxyStateSignal<T extends object> extends StateSignal<T> {
    mutate(recipe: (draft: T) => void, actionName?: string): void;
    readonly root: PathNode<T, false>;
}
