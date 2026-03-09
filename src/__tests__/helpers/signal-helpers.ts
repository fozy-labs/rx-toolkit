import type { Observable } from 'rxjs';

/**
 * Collect all values emitted by a signal's observable into an array.
 * Returns the array and an unsubscribe function.
 */
export function collectValues<T>(signal: { obs: Observable<T> }): {
  values: T[];
  unsubscribe: () => void;
} {
  const values: T[] = [];
  const sub = signal.obs.subscribe(v => values.push(v));
  return { values, unsubscribe: () => sub.unsubscribe() };
}
