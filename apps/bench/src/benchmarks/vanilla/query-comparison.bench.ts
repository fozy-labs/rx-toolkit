import { createResource, createOperation } from '@fozy-labs/rx-toolkit';
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query';
import { configureStore } from '@reduxjs/toolkit';
import { createBenchmark } from '@/utils/benchmark';

// Mock API
const mockApi = {
  getUser: async (id: number) => ({ id, name: `User ${id}`, email: `user${id}@example.com` }),
  updateUser: async (id: number, data: any) => ({ id, ...data }),
};

const mockFetch = (url: string) => {
  const id = parseInt(url.split('/').pop() || '0');
  return Promise.resolve({
    ok: true,
    json: async () => mockApi.getUser(id),
  });
};

(global as any).fetch = mockFetch;

interface User {
  id: number;
  name: string;
  email: string;
}

export async function runQueryComparisonBench() {
  // 1. Создание Resource/Query без запроса
  await createBenchmark('Query Comparison: Создание Resource/Query')
    .add('rx-toolkit Resource', () => {
      const userResource = createResource({
        queryFn: async ({ id }: { id: number }) => mockApi.getUser(id),
        cacheLifetime: 60000,
      });
      const agent = userResource.createAgent();
      agent.complete();
    })
    .add('RTK Query API', () => {
      const api = createApi({
        reducerPath: 'api',
        baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
        endpoints: (builder) => ({
          getUser: builder.query<User, number>({
            query: (id) => `/users/${id}`,
          }),
        }),
      });

      const store = configureStore({
        reducer: { [api.reducerPath]: api.reducer },
        middleware: (gDM) => gDM().concat(api.middleware),
      });
    })
    .run();

  // 2. Простой запрос (один раз)
  await createBenchmark('Query Comparison: Один запрос с ожиданием')
    .add('rx-toolkit Resource', async () => {
      const userResource = createResource({
        queryFn: async ({ id }: { id: number }) => mockApi.getUser(id),
        cacheLifetime: false,
      });
      const agent = userResource.createAgent();
      agent.initiate({ id: 1 });
      await new Promise(resolve => setTimeout(resolve, 10));
      agent.complete();
    })
    .add('RTK Query', async () => {
      const api = createApi({
        reducerPath: 'api',
        baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
        endpoints: (builder) => ({
          getUser: builder.query<User, number>({
            query: (id) => `/users/${id}`,
          }),
        }),
      });

      const store = configureStore({
        reducer: { [api.reducerPath]: api.reducer },
        middleware: (gDM) => gDM().concat(api.middleware),
      });

      const promise = store.dispatch(api.endpoints.getUser.initiate(1));
      await promise;
      promise.unsubscribe();
    })
    .run();

  // 3. Запросы с кешированием (5 повторных запросов)
  await createBenchmark('Query Comparison: Кеширование (5 запросов из кеша)')
    .add('rx-toolkit Resource', async () => {
      const userResource = createResource({
        queryFn: async ({ id }: { id: number }) => mockApi.getUser(id),
        cacheLifetime: 60000,
      });

      // Первый запрос для кеша
      const agent1 = userResource.createAgent();
      agent1.initiate({ id: 1 });
      await new Promise(resolve => setTimeout(resolve, 10));

      // 5 запросов из кеша
      const agents = Array.from({ length: 5 }, () => userResource.createAgent());
      agents.forEach(agent => agent.initiate({ id: 1 }));

      await new Promise(resolve => setTimeout(resolve, 5));

      agent1.complete();
      agents.forEach(a => a.complete());
    })
    .add('RTK Query', async () => {
      const api = createApi({
        reducerPath: 'api',
        baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
        endpoints: (builder) => ({
          getUser: builder.query<User, number>({
            query: (id) => `/users/${id}`,
            keepUnusedDataFor: 60,
          }),
        }),
      });

      const store = configureStore({
        reducer: { [api.reducerPath]: api.reducer },
        middleware: (gDM) => gDM().concat(api.middleware),
      });

      // Первый запрос для кеша
      const firstPromise = store.dispatch(api.endpoints.getUser.initiate(1));
      await firstPromise;

      // 5 запросов из кеша
      const promises = Array.from({ length: 5 }, () =>
        store.dispatch(api.endpoints.getUser.initiate(1))
      );
      await Promise.all(promises);

      firstPromise.unsubscribe();
      promises.forEach(p => p.unsubscribe());
    })
    .run();

  // 4. Mutations/Operations (одиночная операция)
  await createBenchmark('Query Comparison: Одна Mutation/Operation')
    .add('rx-toolkit Operation', async () => {
      const updateUserOp = createOperation({
        queryFn: async ({ id, name }: { id: number; name: string }) =>
          mockApi.updateUser(id, { name }),
        cacheLifetime: false,
      });
      const agent = updateUserOp.createAgent();
      agent.initiate({ id: 1, name: 'Updated' });
      await new Promise(resolve => setTimeout(resolve, 10));
      agent.complete();
    })
    .add('RTK Query Mutation', async () => {
      const api = createApi({
        reducerPath: 'api',
        baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
        endpoints: (builder) => ({
          updateUser: builder.mutation<User, { id: number; name: string }>({
            query: ({ id, name }) => ({
              url: `/users/${id}`,
              method: 'PATCH',
              body: { name },
            }),
          }),
        }),
      });

      const store = configureStore({
        reducer: { [api.reducerPath]: api.reducer },
        middleware: (gDM) => gDM().concat(api.middleware),
      });

      await store.dispatch(
        api.endpoints.updateUser.initiate({ id: 1, name: 'Updated' })
      ).unwrap();
    })
    .run();

  // 5. Invalidation (запрос + mutation с инвалидацией)
  await createBenchmark('Query Comparison: Query + Mutation с Invalidation')
    .add('rx-toolkit Operation с invalidate', async () => {
      const userResource = createResource({
        queryFn: async ({ id }: { id: number }) => mockApi.getUser(id),
        cacheLifetime: 60000,
      });

      const updateUserOp = createOperation({
        queryFn: async ({ id, name }: { id: number; name: string }) =>
          mockApi.updateUser(id, { name }),
        link: (link) => {
          link({
            resource: userResource,
            forwardArgs: (args) => ({ id: args.id }),
            invalidate: true,
          });
        },
      });

      const resAgent = userResource.createAgent();
      const resSub = resAgent.state$.subscribe(() => {});
      resAgent.initiate({ id: 1 });
      await new Promise(resolve => setTimeout(resolve, 10));

      const opAgent = updateUserOp.createAgent();
      opAgent.initiate({ id: 1, name: 'Updated' });
      await new Promise(resolve => setTimeout(resolve, 10));

      resSub.unsubscribe();
      opAgent.complete();
      resAgent.complete();
    })
    .add('RTK Query с invalidatesTags', async () => {
      const api = createApi({
        reducerPath: 'api',
        baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
        tagTypes: ['User'],
        endpoints: (builder) => ({
          getUser: builder.query<User, number>({
            query: (id) => `/users/${id}`,
            providesTags: (result, error, id) => [{ type: 'User', id }],
          }),
          updateUser: builder.mutation<User, { id: number; name: string }>({
            query: ({ id, name }) => ({
              url: `/users/${id}`,
              method: 'PATCH',
              body: { name },
            }),
            invalidatesTags: (result, error, { id }) => [{ type: 'User', id }],
          }),
        }),
      });

      const store = configureStore({
        reducer: { [api.reducerPath]: api.reducer },
        middleware: (gDM) => gDM().concat(api.middleware),
      });

      const queryPromise = store.dispatch(api.endpoints.getUser.initiate(1));
      await queryPromise;

      await store.dispatch(
        api.endpoints.updateUser.initiate({ id: 1, name: 'Updated' })
      ).unwrap();

      queryPromise.unsubscribe();
    })
    .run();

  // 6. Множественные параллельные запросы (5 разных ресурсов)
  await createBenchmark('Query Comparison: 5 параллельных запросов')
    .add('rx-toolkit Resources', async () => {
      const userResource = createResource({
        queryFn: async ({ id }: { id: number }) => mockApi.getUser(id),
        cacheLifetime: 60000,
      });

      const agents = Array.from({ length: 5 }, () => userResource.createAgent());
      agents.forEach((agent, i) => agent.initiate({ id: i }));

      await new Promise(resolve => setTimeout(resolve, 15));

      agents.forEach(agent => agent.complete());
    })
    .add('RTK Query', async () => {
      const api = createApi({
        reducerPath: 'api',
        baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
        endpoints: (builder) => ({
          getUser: builder.query<User, number>({
            query: (id) => `/users/${id}`,
          }),
        }),
      });

      const store = configureStore({
        reducer: { [api.reducerPath]: api.reducer },
        middleware: (gDM) => gDM().concat(api.middleware),
      });

      const promises = Array.from({ length: 5 }, (_, i) =>
        store.dispatch(api.endpoints.getUser.initiate(i))
      );

      await Promise.all(promises);
      promises.forEach(p => p.unsubscribe());
    })
    .run();

  // 7. Подписка на состояние запроса
  await createBenchmark('Query Comparison: Подписка на состояние (5 подписчиков)')
    .add('rx-toolkit Resource', async () => {
      const userResource = createResource({
        queryFn: async ({ id }: { id: number }) => mockApi.getUser(id),
        cacheLifetime: false,
      });

      const agent = userResource.createAgent();
      let updates = 0;
      const subs = Array.from({ length: 5 }, () =>
        agent.state$.subscribe(() => { updates++; })
      );

      agent.initiate({ id: 1 });
      await new Promise(resolve => setTimeout(resolve, 10));

      subs.forEach(sub => sub.unsubscribe());
      agent.complete();
    })
    .add('RTK Query', async () => {
      const api = createApi({
        reducerPath: 'api',
        baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
        endpoints: (builder) => ({
          getUser: builder.query<User, number>({
            query: (id) => `/users/${id}`,
          }),
        }),
      });

      const store = configureStore({
        reducer: { [api.reducerPath]: api.reducer },
        middleware: (gDM) => gDM().concat(api.middleware),
      });

      let updates = 0;
      const unsubs = Array.from({ length: 5 }, () =>
        store.subscribe(() => { updates++; })
      );

      const promise = store.dispatch(api.endpoints.getUser.initiate(1));
      await promise;

      unsubs.forEach(unsub => unsub());
      promise.unsubscribe();
    })
    .run();

  // 6. Setup overhead
  await createBenchmark('Query Comparison: Setup Overhead (создание API + store)')
    .add('rx-toolkit - создание 5 Resources', () => {
      const resources = Array.from({ length: 5 }, (_, i) =>
        createResource({
          queryFn: async ({ id }: { id: number }) => mockApi.getUser(id),
        })
      );
    })
    .add('RTK Query - создание API с 5 endpoints', () => {
      const api = createApi({
        reducerPath: 'api',
        baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
        endpoints: (builder) => ({
          getUser1: builder.query({ query: (id: number) => `/users/${id}` }),
          getUser2: builder.query({ query: (id: number) => `/users/${id}` }),
          getUser3: builder.query({ query: (id: number) => `/users/${id}` }),
          getUser4: builder.query({ query: (id: number) => `/users/${id}` }),
          getUser5: builder.query({ query: (id: number) => `/users/${id}` }),
        }),
      });

      const store = configureStore({
        reducer: { [api.reducerPath]: api.reducer },
        middleware: (gDM) => gDM().concat(api.middleware),
      });
    })
    .run();
}

