import { inject } from '@fozy-labs/simplest-di';
import { SKIP } from '@fozy-labs/rx-toolkit';
import { Card, CardBody, Skeleton, Button, Chip } from '@heroui/react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { PostApi } from '@/entities/post';

export function PostDetailPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const postApi = inject(PostApi);
    const query = postApi.detail.useResource(id ? Number(id) : SKIP);
    const [triggerDelete, deleteState] = postApi.delete.useCommand();

    if (!id) {
        return (
            <div className="text-center py-20">
                <p className="text-danger text-lg">No post specified</p>
                <Button as={Link} to="/posts" variant="light" className="mt-4">← Back</Button>
            </div>
        );
    }

    const handleDelete = async () => {
        try {
            await triggerDelete(Number(id));
            navigate('/posts');
        } catch (err) {
            console.error(err);
        }
    };

    if (query.isInitialLoading || (!query.data && !query.isError)) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-8 w-40 rounded-lg" />
                <Skeleton className="h-6 w-full rounded-lg" />
                <Skeleton className="h-40 w-full rounded-lg" />
            </div>
        );
    }

    if (query.isError) {
        return (
            <div className="text-center py-20">
                <p className="text-danger text-lg">Post not found</p>
                <Button as={Link} to="/posts" variant="light" className="mt-4">← Back</Button>
            </div>
        );
    }

    const post = query.data!;
    const title = post.title?.trim() || 'Untitled post';
    const body = post.body?.trim() || 'No content available.';

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <Button as={Link} to="/posts" variant="light" size="sm">← Back to posts</Button>
                <Button
                    color="danger"
                    variant="flat"
                    size="sm"
                    onPress={handleDelete}
                    isLoading={deleteState.isLoading}
                >
                    Delete
                </Button>
            </div>

            <Card shadow="sm">
                <CardBody className="gap-4 p-6">
                    <div className="flex items-start justify-between gap-4">
                        <h1 className="text-2xl font-bold">{title}</h1>
                        <Chip variant="flat" size="sm" className="flex-none">#{post.id}</Chip>
                    </div>
                    <p className="text-default-600 leading-relaxed whitespace-pre-line">{body}</p>
                    <div className="pt-2 border-t border-divider">
                        <p className="text-xs text-default-400">Posted by User #{post.userId}</p>
                    </div>
                </CardBody>
            </Card>
        </div>
    );
}
