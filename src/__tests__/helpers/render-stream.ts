import type { RenderStream } from "@testing-library/react-render-stream/pure";
import { WaitForRenderTimeoutError } from "@testing-library/react-render-stream/pure";

/**
 * Commit-synchronized React testing on `@testing-library/react-render-stream`:
 * the tree renders under React's `<Profiler>`, every commit is buffered, and
 * the test consumes commits one at a time with `await takeRender()`.
 * Assertions run against the commit's frozen DOM snapshot (`withinDOM()`), so
 * they can never race a later commit. This replaces wall-clock waits, which
 * lose to React's own scheduling — React 19 throttles a commit replacing a
 * Suspense fallback shown less than ~300 ms ago, so a fixed `sleep(300)`
 * races it.
 *
 * A stream test body must run with the act environment off — the stream
 * renders through its own React roots, which throw while
 * `IS_REACT_ACT_ENVIRONMENT` is true:
 *
 * ```ts
 * const actEnv = disableActEnvironment();
 * try {
 *     const stream = createRenderStream({ snapshotDOM: true });
 *     await stream.render(tree);
 *     const { withinDOM } = await stream.takeRender({ timeout: COMMIT_TIMEOUT });
 *     expect(withinDOM().queryByTestId("fallback")).not.toBeNull();
 * } finally {
 *     actEnv.cleanup();
 * }
 * ```
 *
 * Do not combine with RTL `act()` or the repo's `outsideAct` around stream
 * calls: `disableActEnvironment` freezes the flag for its lifetime. Stream
 * roots are unmounted by an `afterEach` in `src/__tests__/setup.ts` — RTL's
 * auto-cleanup never reaches them.
 */
export {
    createRenderStream,
    disableActEnvironment,
    useTrackRenders,
    WaitForRenderTimeoutError,
} from "@testing-library/react-render-stream/pure";

/**
 * Generous `takeRender` timeout for commits React itself delays (the ~300 ms
 * throttle on replacing a freshly shown Suspense fallback): the wait still
 * ends the moment the commit lands, this only bounds failure on a loaded CI.
 */
export const COMMIT_TIMEOUT = 5_000;

/**
 * Assert that no further commit arrives within `timeout` — the vitest-safe
 * replacement for the package's `toRerender` matcher (the matcher module
 * extends jest's standalone `expect`, not vitest's, so it cannot run here).
 * The default deliberately outlasts React's ~300 ms Suspense-fallback
 * throttle, so even a throttled straggler commit surfaces.
 */
export async function expectNoMoreRenders(
    stream: Pick<RenderStream<void>, "peekRender">,
    timeout = 400,
): Promise<void> {
    await expect(stream.peekRender({ timeout })).rejects.toThrow(WaitForRenderTimeoutError);
}
