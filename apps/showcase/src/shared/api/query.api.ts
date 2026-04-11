import { createApi, reactHooksPlugin } from '@fozy-labs/rx-toolkit';

export const api = createApi({
    plugins: [reactHooksPlugin()],
});
