import { useSignal } from '@fozy-labs/rx-toolkit';
import { inject } from '@fozy-labs/simplest-di';
import { Card, CardBody, Button, Chip } from '@heroui/react';
import { Link } from 'react-router-dom';
import { AuthStore } from '@/features/auth';

export function HomePage() {
    const authStore = inject(AuthStore);
    const authenticated = useSignal(authStore.isAuthenticated$);
    const user = useSignal(authStore.currentUser$);

    if (!authenticated) {
        return (
            <div className="flex flex-col items-center justify-center gap-6 py-20">
                <h1 className="text-4xl font-bold text-center">RX Toolkit Showcase</h1>
                <p className="text-lg text-default-500 text-center max-w-lg">
                    A demo app showcasing reactive state management with Signals, Resource queries, Commands, and DI.
                </p>
                <Button as={Link} to="/login" color="primary" size="lg">
                    Get Started
                </Button>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-3xl font-bold">Welcome, {user?.name}</h1>
                <p className="text-default-500 mt-1">Explore the rx-toolkit features below</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <Card shadow="sm" isPressable as={Link} to="/pokemon" className="border-none">
                    <CardBody className="gap-3 p-6">
                        <span className="text-4xl">🐾</span>
                        <div>
                            <h2 className="text-xl font-semibold">Pokemon Explorer</h2>
                            <p className="text-sm text-default-500">
                                Browse pokemon with paginated Resource queries and search filtering.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-2">
                            <Chip size="sm" variant="flat" color="primary">Resource</Chip>
                            <Chip size="sm" variant="flat" color="secondary">Signal.state</Chip>
                            <Chip size="sm" variant="flat" color="success">React hooks</Chip>
                        </div>
                    </CardBody>
                </Card>
                <Card shadow="sm" isPressable as={Link} to="/posts" className="border-none">
                    <CardBody className="gap-3 p-6">
                        <span className="text-4xl">📝</span>
                        <div>
                            <h2 className="text-xl font-semibold">Posts Manager</h2>
                            <p className="text-sm text-default-500">
                                Full CRUD with Commands, optimistic updates, and linked cache patches.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-2">
                            <Chip size="sm" variant="flat" color="primary">Command</Chip>
                            <Chip size="sm" variant="flat" color="warning">Links</Chip>
                            <Chip size="sm" variant="flat" color="success">React hooks</Chip>
                        </div>
                    </CardBody>
                </Card>
            </div>
        </div>
    );
}
