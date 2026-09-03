import React from "react";

/**
 * Helpers for exercising React's *own* concurrent scheduling — transition
 * lanes, yielding, sync interruptions — which `act()` deliberately flushes
 * away. Tests using them run a scenario outside the act environment and wait
 * with real timers.
 */

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/**
 * Burn CPU in render so the concurrent work loop yields to the host after
 * this fiber (Scheduler's ~5ms frame). Concurrent React then commits the
 * transition in a *later* macrotask, leaving room for microtasks — such as
 * the deferred `useSignal` notification — to run in between, exactly as in a
 * real page with a non-trivial tree. Takes the changing value as a prop so
 * React actually re-renders it inside the transition instead of bailing out.
 */
export function Slow(_props: { value: unknown }): null {
    const end = performance.now() + 10;
    while (performance.now() < end) {
        /* spin */
    }
    return null;
}

/** Two `Slow` siblings after `element`: the second one is where the work loop yields. */
export function withSlowSiblings(element: React.ReactNode, value: unknown): React.ReactElement {
    return React.createElement(
        React.Fragment,
        null,
        element,
        React.createElement(Slow, { value }),
        React.createElement(Slow, { value }),
    );
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `scenario` with React's act environment switched off, so updates are
 * scheduled by React itself rather than flushed by `act()`, and restore it
 * afterwards (React Testing Library's cleanup relies on it).
 */
export async function outsideAct(scenario: () => Promise<void>): Promise<void> {
    const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
    try {
        await scenario();
    } finally {
        globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
    }
}
