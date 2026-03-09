import { SharedOptions } from '@/common/options/SharedOptions';

/**
 * Reset SharedOptions to default values.
 * Called in beforeEach for test isolation.
 */
export function resetSharedOptions(): void {
  SharedOptions.reset();
}
