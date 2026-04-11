import { injectable } from '@fozy-labs/simplest-di';
import { api } from '@/shared/api';
import type { Post, CreatePostCommandArgs } from './types';

const BASE = 'https://jsonplaceholder.typicode.com';

@injectable('SINGLETON')
export class PostApi {
    list = api.createResource<void, Post[]>({
        key: 'posts-list',
        queryFn: async () => {
            const res = await fetch(`${BASE}/posts`);
            if (!res.ok) throw new Error('Failed to fetch posts');
            return res.json();
        },
    });

    detail = api.createResource<number, Post>({
        key: 'post-detail',
        queryFn: async (id) => {
            const res = await fetch(`${BASE}/posts/${id}`);
            if (!res.ok) throw new Error(`Post #${id} not found`);
            return res.json();
        },
    });

    create = api.createCommand<CreatePostCommandArgs, Post>({
        queryFn: async ({ tempId: _tempId, ...dto }) => {
            const res = await fetch(`${BASE}/posts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(dto),
            });

            if (!res.ok) {
                throw new Error('Failed to create post');
            }

            return res.json();
        },
        links: (link) => link({
            resource: this.list,
            forwardArgs: () => undefined as void,
            optimisticUpdate: (draft, args) => {
                draft.unshift({
                    id: args.tempId,
                    userId: args.userId,
                    title: args.title,
                    body: args.body,
                });
            },
            update: (draft, args, data) => {
                const tempPostIndex = draft.findIndex((post: Post) => post.id === args.tempId);

                if (tempPostIndex === -1) {
                    draft.unshift(data);
                    return;
                }

                draft[tempPostIndex] = data;
            },
        }),
    });

    delete = api.createCommand<number, void>({
        queryFn: async (id) => {
            const res = await fetch(`${BASE}/posts/${id}`, { method: 'DELETE' });

            if (!res.ok) {
                throw new Error(`Failed to delete post #${id}`);
            }
        },
        links: (link) => link({
            resource: this.list,
            forwardArgs: () => undefined as void,
            optimisticUpdate: (draft, args) => {
                const postIndex = draft.findIndex((post: Post) => post.id === args);

                if (postIndex !== -1) {
                    draft.splice(postIndex, 1);
                }
            },
        }),
    });
}
