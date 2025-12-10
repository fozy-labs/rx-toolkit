import { createResource, createOperation } from '@fozy-labs/rx-toolkit';
import { createBenchmark } from '@/utils/benchmark';

// Моки для API запросов
const mockApi = {
  getUser: async (id: number) => {
    return { id, name: `User ${id}`, email: `user${id}@example.com` };
  },
  getUsers: async () => {
    return Array.from({ length: 10 }, (_, i) => ({
      id: i,
      name: `User ${i}`,
      email: `user${i}@example.com`,
    }));
  },
  updateUser: async (id: number, data: any) => {
    return { id, ...data };
  },
};

export async function runQueryBench() {
  // 1. Создание ресурсов
  await createBenchmark('Query: Создание ресурсов')
    .add('rx-toolkit - создание Resource', () => {
      const userResource = createResource({
        queryFn: async ({ id }: { id: number }) => mockApi.getUser(id),
      });
    })
    .add('rx-toolkit - создание Resource с select', () => {
      void createResource<{ id: number }, { id: number; name: string; email: string }, string>({
        queryFn: async ({ id }: { id: number }) => mockApi.getUser(id),
        select: (data) => data.name,
      });
    })
    .run();

  // 2. Создание агентов
  await createBenchmark('Query: Создание агентов')
    .add('rx-toolkit - создание ResourceAgent', () => {
      const userResource = createResource({
        queryFn: async ({ id }: { id: number }) => mockApi.getUser(id),
      });
      const agent = userResource.createAgent();
      agent.complete();
    })
    .add('rx-toolkit - создание ResourceRef', () => {
      const userResource = createResource({
        queryFn: async ({ id }: { id: number }) => mockApi.getUser(id),
      });
      const ref = userResource.createRef({ id: 1 });
    })
    .run();

  // 3. Выполнение запросов
  await createBenchmark('Query: Выполнение запросов')
    .add('rx-toolkit Resource - initiate', async () => {
      const userResource = createResource({
        queryFn: async ({ id }: { id: number }) => mockApi.getUser(id),
        cacheLifetime: false,
      });
      const agent = userResource.createAgent();
      agent.initiate({ id: 1 });
      await new Promise(resolve => setTimeout(resolve, 10));
      agent.complete();
    })
    .add('rx-toolkit Resource - initiate с кешем', async () => {
      const userResource = createResource({
        queryFn: async ({ id }: { id: number }) => mockApi.getUser(id),
        cacheLifetime: 60000,
      });
      const agent = userResource.createAgent();
      agent.initiate({ id: 1 });
      await new Promise(resolve => setTimeout(resolve, 10));
      // Второй запрос должен использовать кеш
      agent.initiate({ id: 1 });
      agent.complete();
    })
    .run();

  // 4. Операции (Mutations)
  await createBenchmark('Query: Операции')
    .add('rx-toolkit Operation - создание', () => {
      const updateUserOp = createOperation({
        queryFn: async ({ id, name }: { id: number; name: string }) =>
          mockApi.updateUser(id, { name }),
      });
    })
    .add('rx-toolkit Operation - выполнение', async () => {
      const updateUserOp = createOperation({
        queryFn: async ({ id, name }: { id: number; name: string }) =>
          mockApi.updateUser(id, { name }),
        cacheLifetime: false,
      });
      const agent = updateUserOp.createAgent();
      agent.initiate({ id: 1, name: 'New Name' });
      await new Promise(resolve => setTimeout(resolve, 10));
      agent.complete();
    })
    .run();

  // 5. Связь операций с ресурсами
  await createBenchmark('Query: Связь Operation с Resource')
    .add('rx-toolkit - Operation с invalidate', async () => {
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

      const resourceAgent = userResource.createAgent();
      resourceAgent.initiate({ id: 1 });
      await new Promise(resolve => setTimeout(resolve, 10));

      const opAgent = updateUserOp.createAgent();
      opAgent.initiate({ id: 1, name: 'Updated' });
      await new Promise(resolve => setTimeout(resolve, 10));

      opAgent.complete();
      resourceAgent.complete();
    })
    .add('rx-toolkit - Operation с update', async () => {
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
            update: ({ draft, data }) => {
              Object.assign(draft, data);
            },
          });
        },
      });

      const resourceAgent = userResource.createAgent();
      resourceAgent.initiate({ id: 1 });
      await new Promise(resolve => setTimeout(resolve, 10));

      const opAgent = updateUserOp.createAgent();
      opAgent.initiate({ id: 1, name: 'Updated' });
      await new Promise(resolve => setTimeout(resolve, 10));

      opAgent.complete();
      resourceAgent.complete();
    })
    .run();

  // 6. Множественные ресурсы (уменьшено)
  await createBenchmark('Query: Множественные ресурсы (5 ресурсов)')
    .add('rx-toolkit - 5 ресурсов параллельно', async () => {
      const userResource = createResource({
        queryFn: async ({ id }: { id: number }) => mockApi.getUser(id),
        cacheLifetime: 60000,
      });

      const agents = Array.from({ length: 5 }, () => userResource.createAgent());
      agents.forEach((agent, i) => agent.initiate({ id: i }));

      await new Promise(resolve => setTimeout(resolve, 15));

      agents.forEach(agent => agent.complete());
    })
    .run();

  // 7. Кеширование
  await createBenchmark('Query: Кеширование (5+5 запросов)')
    .add('rx-toolkit - запросы с кешем', async () => {
      const userResource = createResource({
        queryFn: async ({ id }: { id: number }) => mockApi.getUser(id),
        cacheLifetime: 60000,
      });

      const agent = userResource.createAgent();

      // Первые 5 запросов создадут кеш
      for (let i = 0; i < 5; i++) {
        agent.initiate({ id: i });
      }

      await new Promise(resolve => setTimeout(resolve, 10));

      // Следующие 5 запросов будут из кеша
      for (let i = 0; i < 5; i++) {
        agent.initiate({ id: i });
      }

      agent.complete();
    })
    .run();

  // 8. Подписка на состояние
  await createBenchmark('Query: Подписка на состояние (5 запросов)')
    .add('rx-toolkit - подписка на state$', async () => {
      const userResource = createResource({
        queryFn: async ({ id }: { id: number }) => mockApi.getUser(id),
        cacheLifetime: false,
      });

      const agent = userResource.createAgent();
      let updates = 0;
      const sub = agent.state$.subscribe(() => { updates++; });

      // 5 запросов
      for (let i = 0; i < 5; i++) {
        agent.initiate({ id: i });
      }

      await new Promise(resolve => setTimeout(resolve, 10));

      sub.unsubscribe();
      agent.complete();
    })
    .run();
}

