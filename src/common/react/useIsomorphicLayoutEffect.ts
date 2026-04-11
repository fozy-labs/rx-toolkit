import React from "react";

/**
 * A hook that resolves to `useLayoutEffect` on the client and `useEffect` on the server.
 *
 * Used to prevent React hydration warnings when using layout effects with
 * Server-Side Rendering (SSR).
 *
 * @param {React.EffectCallback} effect - Imperative function that can return a cleanup function.
 * @param {React.DependencyList} [deps] - If present, effect will only activate if the values in the list change.
 *
 * @see {@link https://react.dev React Docs: useLayoutEffect}
 * @example
 * useIsomorphicLayoutEffect(() => {
 *   console.log("Synchronous on client, standard on server");
 * }, [data]);
 */
export const useIsomorphicLayoutEffect = typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;
