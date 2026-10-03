import { cleanup as cleanupRenderStream } from "@testing-library/react-render-stream/pure";

import { resetSharedOptions } from "./helpers/singleton-reset";

beforeEach(() => {
    resetSharedOptions();
});

afterEach(() => {
    // Roots created by @testing-library/react-render-stream live in the
    // package's own registry, so RTL's auto-cleanup never unmounts them.
    // Leftover containers would pollute later tests: a stream's domSnapshot
    // re-parses all of document.body. A no-op for tests without a stream.
    cleanupRenderStream();
});
