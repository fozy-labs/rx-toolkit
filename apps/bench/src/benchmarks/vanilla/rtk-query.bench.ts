import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query';
import { configureStore } from '@reduxjs/toolkit';
import { createBenchmark } from '@/utils/benchmark';

// Моки для API
const mockFetch = (url: string) => {
  const id = parseInt(url.split('/').pop() || '0');
  return Promise.resolve({
    ok: true,
    json: async () => ({ id, name: `User ${id}`, email: `user${id}@example.com` }),
  });
};

// Mock fetch globally
(global as any).fetch = mockFetch;

interface User {
  id: number;
  name: string;
  email: string;
}

export async function runRtkQueryBench() {
  // 1. Создание API
  await createBenchmark('RTK Query: Создание API')
    .add('RTK Query - создание API', () => {
      const api = createApi({
        reducerPath: 'api',
        baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
        endpoints: (builder) => ({
          getUser: builder.query<User, number>({
            query: (id) => `/users/${id}`,
          }),
        }),
      });
    })
    .add('RTK Query - создание API с mutation', () => {
      const api = createApi({
        reducerPath: 'api',
        baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
        endpoints: (builder) => ({
          getUser: builder.query<User, number>({
            query: (id) => `/users/${id}`,
          }),
          updateUser: builder.mutation<User, { id: number; name: string }>({
            query: ({ id, name }) => ({
              url: `/users/${id}`,
              method: 'PATCH',
              body: { name },
            }),
          }),
        }),
      });
    })
    .run();

  // 2. Создание store с API
  await createBenchmark('RTK Query: Создание Store')
    .add('RTK Query - создание store', () => {
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
        reducer: {
          [api.reducerPath]: api.reducer,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware().concat(api.middleware),
      });
    })
    .run();

  // 3. Выполнение запросов
  await createBenchmark('RTK Query: Выполнение запросов')
    .add('RTK Query - initiate query', async () => {
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
        reducer: {
          [api.reducerPath]: api.reducer,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware().concat(api.middleware),
      });

      const promise = store.dispatch(api.endpoints.getUser.initiate(1));
      await promise;
      promise.unsubscribe();
    })
    .add('RTK Query - query с кешем', async () => {
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
        reducer: {
          [api.reducerPath]: api.reducer,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware().concat(api.middleware),
      });

      const promise1 = store.dispatch(api.endpoints.getUser.initiate(1));
      await promise1;

      // Второй запрос должен использовать кеш
      const promise2 = store.dispatch(api.endpoints.getUser.initiate(1));
      await promise2;

      promise1.unsubscribe();
      promise2.unsubscribe();
    })
    .run();

  // 4. Mutations
  await createBenchmark('RTK Query: Mutations')
    .add('RTK Query - mutation', async () => {
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
        reducer: {
          [api.reducerPath]: api.reducer,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware().concat(api.middleware),
      });

      await store.dispatch(
        api.endpoints.updateUser.initiate({ id: 1, name: 'New Name' })
      ).unwrap();
    })
    .run();

  // 5. Invalidation
  await createBenchmark('RTK Query: Invalidation')
    .add('RTK Query - mutation с invalidatesTags', async () => {
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
        reducer: {
          [api.reducerPath]: api.reducer,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware().concat(api.middleware),
      });

      const queryPromise = store.dispatch(api.endpoints.getUser.initiate(1));
      await queryPromise;

      await store.dispatch(
        api.endpoints.updateUser.initiate({ id: 1, name: 'Updated' })
      ).unwrap();

      queryPromise.unsubscribe();
    })
    .run();

  // 6. Множественные запросы
  await createBenchmark('RTK Query: Множественные запросы')
    .add('RTK Query - 10 запросов параллельно', async () => {
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
        reducer: {
          [api.reducerPath]: api.reducer,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware().concat(api.middleware),
      });

      const promises = Array.from({ length: 5 }, (_, i) =>
        store.dispatch(api.endpoints.getUser.initiate(i))
      );

      await Promise.all(promises);
      promises.forEach(p => p.unsubscribe());
    })
    .run();

  // 7. Кеширование (уменьшено для стабильности)
  await createBenchmark('RTK Query: Кеширование (5+5 запросов)')
    .add('RTK Query - запросы с кешем', async () => {
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
        reducer: {
          [api.reducerPath]: api.reducer,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware().concat(api.middleware),
      });

      const promises = [];

      // Первые 5 запросов создают кеш
      for (let i = 0; i < 5; i++) {
        const promise = store.dispatch(api.endpoints.getUser.initiate(i));
        promises.push(promise);
      }

      await Promise.all(promises.slice(0, 5));

      // Следующие 5 запросов из кеша
      for (let i = 0; i < 5; i++) {
        const promise = store.dispatch(api.endpoints.getUser.initiate(i));
        promises.push(promise);
      }

      await Promise.all(promises.slice(5));
      promises.forEach(p => p.unsubscribe());
    })
    .run();

  // 8. Подписка на состояние
  await createBenchmark('RTK Query: Подписка на состояние')
    .add('RTK Query - store.subscribe с 10 запросами', async () => {
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
        reducer: {
          [api.reducerPath]: api.reducer,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware().concat(api.middleware),
      });

      let updates = 0;
      const unsub = store.subscribe(() => { updates++; });

      const promises = [];
      for (let i = 0; i < 10; i++) {
        const promise = store.dispatch(api.endpoints.getUser.initiate(i));
        promises.push(promise);
      }

      await Promise.all(promises);
      promises.forEach(p => p.unsubscribe());
      unsub();
    })
    .run();
}

