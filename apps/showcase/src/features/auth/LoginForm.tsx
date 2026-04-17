import { useState, useCallback } from 'react';
import { inject } from '@fozy-labs/simplest-di';
import { Card, CardBody, CardHeader, Input, Button, Chip, Divider } from '@heroui/react';
import { AuthStore } from './auth.store';
import { MOCK_USERS } from './auth.utils';

export function LoginForm() {
    const authStore = inject(AuthStore);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = useCallback(async () => {
        setError('');
        setIsLoading(true);
        // fake delay for UX
        await new Promise(r => setTimeout(r, 400));
        const result = authStore.login(email);
        setIsLoading(false);
        if (!result.ok) setError(result.error ?? 'Login failed');
    }, [authStore, email]);

    return (
        <Card className="w-full max-w-md" shadow="lg">
            <CardHeader className="flex-col items-start gap-1 px-6 pt-6">
                <h1 className="text-2xl font-bold">Welcome back</h1>
                <p className="text-sm text-default-500">Sign in to explore the demo</p>
            </CardHeader>
            <CardBody className="gap-4 px-6 pb-6">
                <Input
                    label="Email"
                    type="email"
                    placeholder="Enter your email"
                    value={email}
                    onValueChange={setEmail}
                    autoComplete="email"
                    variant="bordered"
                    isRequired
                />
                <Input
                    label="Password"
                    type="password"
                    placeholder="Any password works"
                    value={password}
                    onValueChange={setPassword}
                    variant="bordered"
                />
                {error && (
                    <p className="text-sm text-danger">{error}</p>
                )}
                <Button
                    color="primary"
                    size="lg"
                    onPress={handleSubmit}
                    isLoading={isLoading}
                    isDisabled={!email}
                    fullWidth
                >
                    Sign In
                </Button>
                <Divider />
                <div className="space-y-2">
                    <p className="text-xs text-default-400">Try one of these accounts:</p>
                    <div className="flex flex-wrap gap-2">
                        {MOCK_USERS.map(u => (
                            <Chip
                                key={u.id}
                                variant="flat"
                                size="sm"
                                className="cursor-pointer"
                                onClick={() => setEmail(u.email)}
                            >
                                {u.email}
                            </Chip>
                        ))}
                    </div>
                </div>
            </CardBody>
        </Card>
    );
}
