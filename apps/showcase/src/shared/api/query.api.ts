import { createApi, ReactHooksPlugin } from '@fozy-labs/rx-toolkit';

export const api = createApi({
    plugins: [new ReactHooksPlugin()],
});
