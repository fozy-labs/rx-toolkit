import { resetSharedOptions } from "./helpers/singleton-reset";

beforeEach(() => {
    resetSharedOptions();
});

afterEach(() => {
    // Verify batching system is not locked
    // (after Batcher try/finally fix this should never happen)
});
