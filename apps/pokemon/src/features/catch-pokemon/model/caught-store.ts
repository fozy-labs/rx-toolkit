import { Signal } from '@fozy-labs/rx-toolkit';

/**
 * Caught Pokémon set — kept in-memory for the demo.
 * A production app would persist this server-side or in localStorage.
 */
const caughtSet$ = Signal.state<ReadonlySet<number>>(new Set());

export { caughtSet$ };

export function toggleCatch(id: number): void {
    const current = caughtSet$.peek();
    const next = new Set(current);
    if (next.has(id)) {
        next.delete(id);
    } else {
        next.add(id);
    }
    caughtSet$.set(next);
}
