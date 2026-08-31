import { createApi, reactHooksPlugin } from '@fozy-labs/rx-toolkit';
import { Button, Card, CardBody, CardHeader, Chip, Divider, Spinner } from '@heroui/react';
import React from 'react';
import { fetches } from '../../utils/fetches';

const api = createApi({
    plugins: [reactHooksPlugin()],
});

const postsResource = api.createResource({
    key: 'feed-posts',
    queryFn: async (args: { ids: number[] }) => fetches.getPostsByIds(args),
});

// useInfiniteResource доступен только на проекционных ресурсах: страницы ленты —
// обычные записи проекции, элементы разделяются через общий кэш
const postsProjection = api.unstable_createProjectionResource({
    resource: postsResource,
    key: 'feed-posts-projection',
    parseData: (posts) => posts.map((item) => ({ id: item.id, item })),
    makeArgs: (ids) => ({ ids }),
});

const PAGE_SIZE = 5;
const TOTAL_POSTS = 23;

// «Пагинатор»: id страницы n (в реальном приложении их отдал бы сервер)
function pageIds(page: number): number[] {
    const start = page * PAGE_SIZE + 1;
    const end = Math.min(start + PAGE_SIZE - 1, TOTAL_POSTS);
    const ids: number[] = [];
    for (let id = start; id <= end; id++) ids.push(id);
    return ids;
}

export function Base() {
    const firstPage = React.useMemo(() => pageIds(0), []);
    const feed = postsProjection.useInfiniteResource(firstPage);

    const loadedCount = feed.data?.length ?? 0;
    const hasNext = loadedCount < TOTAL_POSTS;

    return (
        <Card>
            <CardHeader className="text-xl font-bold">
                📰 Бесконечная лента (useInfiniteResource)
            </CardHeader>
            <Divider />
            <CardBody className="space-y-4">
                {feed.isInitialLoading && (
                    <div className="text-sm text-default-500">⏳ Загрузка ленты...</div>
                )}

                {feed.data && (
                    <div className="space-y-2">
                        {feed.data.map((post) => (
                            <div key={post.id} className="p-3 bg-default-100 rounded-lg">
                                <p className="font-semibold">{post.title}</p>
                                <p className="text-sm text-default-500">{post.text}</p>
                            </div>
                        ))}
                    </div>
                )}

                <div className="flex items-center gap-2">
                    <Button
                        size="sm"
                        variant="flat"
                        color="primary"
                        isDisabled={!hasNext || feed.isFetchingNext || feed.isInitialLoading}
                        onPress={() => feed.fetchNext(pageIds(feed.pages.length))}
                    >
                        {feed.isFetchingNext ? <Spinner size="sm" /> : hasNext ? '⬇️ Загрузить ещё' : 'Это всё'}
                    </Button>
                    <Button size="sm" variant="flat" onPress={() => feed.refresh()}>
                        🔄 Обновить ленту
                    </Button>
                    <Button size="sm" variant="flat" color="warning" onPress={() => feed.reset()}>
                        ⤴ Свернуть до первой страницы
                    </Button>
                    <Chip size="sm" variant="flat">
                        {loadedCount}/{TOTAL_POSTS} · страниц: {feed.pages.length}
                    </Chip>
                </div>

                <p className="text-xs text-default-400">
                    Каждая страница — отдельная кэш-запись проекционного ресурса: догрузка хвоста
                    не перерисовывает загруженные страницы, id следующей страницы передаёт
                    вызывающий код. «Обновить» перевалидирует все страницы разом.
                </p>
            </CardBody>
        </Card>
    );
}
