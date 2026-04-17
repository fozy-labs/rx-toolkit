import { useState } from 'react';
import { inject } from '@fozy-labs/simplest-di';
import {
    Card, CardBody, Skeleton, Button, Input, Textarea,
    Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
    useDisclosure, Chip,
} from '@heroui/react';
import { Link } from 'react-router-dom';

import { PostApi } from '@/entities/post';

export function PostsListPage() {
    const postApi = inject(PostApi);
    const query = postApi.list.useResource(undefined);
    const [triggerCreate, createState] = postApi.create.useCommand();
    const { isOpen, onOpen, onClose } = useDisclosure();
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');

    const handleCreate = async () => {
        if (!title.trim()) return;
        try {
            await triggerCreate({ tempId: -Date.now(), title, body, userId: 1 });
            setTitle('');
            setBody('');
            onClose();
        } catch (err) {
            console.error(err);
        }
    };

    const posts = query.data?.slice(0, 30) ?? [];

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">Posts</h1>
                <Button color="primary" onPress={onOpen}>+ New Post</Button>
            </div>

            <Modal isOpen={isOpen} onClose={onClose} size="lg">
                <ModalContent>
                    <ModalHeader>Create New Post</ModalHeader>
                    <ModalBody className="gap-4">
                        <Input
                            label="Title"
                            value={title}
                            onValueChange={setTitle}
                            variant="bordered"
                            isRequired
                        />
                        <Textarea
                            label="Body"
                            value={body}
                            onValueChange={setBody}
                            variant="bordered"
                            minRows={4}
                        />
                        {createState.isError && (
                            <p className="text-sm text-danger">{String(createState.error)}</p>
                        )}
                    </ModalBody>
                    <ModalFooter>
                        <Button variant="light" onPress={onClose}>Cancel</Button>
                        <Button
                            color="primary"
                            onPress={handleCreate}
                            isLoading={createState.isLoading}
                            isDisabled={!title.trim()}
                        >
                            Create
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>

            {query.isInitialLoading ? (
                <div className="space-y-3">
                    {Array.from({ length: 8 }, (_, i) => (
                        <Card key={i} shadow="sm">
                            <CardBody className="gap-2 p-5">
                                <Skeleton className="h-5 w-3/4 rounded-lg" />
                                <Skeleton className="h-4 w-full rounded-lg" />
                                <Skeleton className="h-4 w-2/3 rounded-lg" />
                            </CardBody>
                        </Card>
                    ))}
                </div>
            ) : query.isError ? (
                <div className="text-center py-12">
                    <p className="text-danger text-lg">Failed to load posts</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {posts.map(post => {
                        const title = post.title?.trim() || 'Untitled post';
                        const body = post.body?.trim() || 'No content available.';

                        return (
                            <Card
                                key={post.id}
                                as={Link}
                                to={`/posts/${post.id}`}
                                isPressable
                                shadow="sm"
                            >
                                <CardBody className="gap-1 p-5">
                                    <div className="flex items-center gap-2">
                                        <h2 className="font-semibold line-clamp-1">{title}</h2>
                                        <Chip size="sm" variant="flat" className="flex-none">#{post.id}</Chip>
                                    </div>
                                    <p className="text-sm text-default-500 line-clamp-2">{body}</p>
                                </CardBody>
                            </Card>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
