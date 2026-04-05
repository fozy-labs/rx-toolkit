// TODO: написать нормально

Из rfc:

```ts
import { createApi } from '@fozy-labs/rx-toolkit';

const api = createApi({
    keyPrefix: 'my-api',
    syncDriver: broadcastSyncDriver({
       channel: 'my-api-channel',
    }),
});

const getUser = api.createResource({
    key: 'getUser',
});

//In a React component
getUser.useResourceAgent({ id: '1' }); // Рассылка запроса о наличии данных в других вкладках
```
