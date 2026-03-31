import React from 'react';
import { createApi, ReactHooksPlugin, commandLink, SKIP } from '@fozy-labs/rx-toolkit';
import { Button, Card, CardBody, CardHeader, Divider, Input, Chip } from '@heroui/react';

// Types
interface Pokemon { name: string; url: string; }
interface PokemonList { count: number; results: Pokemon[]; }
interface User { username: string; loggedInAt: number; }

// Fake auth state
let currentUser: User | null = null;
let caughtPokemon: string[] = [];

const api = createApi({
    plugins: [new ReactHooksPlugin()],
});

// Auth resource - returns currently logged in user
const authResource = api.createResource<void, User | null>({
    key: 'pokemon-auth',
    queryFn: async () => {
        await new Promise(resolve => setTimeout(resolve, 300));
        return currentUser;
    },
});

// Login command
const loginCommand = api.createCommand<{ username: string }, User>({
    queryFn: async (args) => {
        await new Promise(resolve => setTimeout(resolve, 500));
        currentUser = { username: args.username, loggedInAt: Date.now() };
        return currentUser;
    },
    link: [
        commandLink({
            resource: authResource,
            forwardArgs: () => undefined as void,
            invalidate: true,
        }),
    ],
});

// Logout command
const logoutCommand = api.createCommand<void, null>({
    queryFn: async () => {
        await new Promise(resolve => setTimeout(resolve, 300));
        currentUser = null;
        caughtPokemon = [];
        return null;
    },
    link: [
        commandLink({
            resource: authResource,
            forwardArgs: () => undefined as void,
            invalidate: true,
        }),
    ],
});

// Pokemon list resource - only fetches when logged in
const pokemonListResource = api.createResource<boolean, PokemonList>({
    key: 'pokemon-list',
    queryFn: async () => {
        const res = await fetch('https://pokeapi.co/api/v2/pokemon?limit=12');
        return res.json();
    },
});

// Caught pokemon resource
const caughtResource = api.createResource<boolean, { pokemons: string[] }>({
    key: 'pokemon-caught',
    queryFn: async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return { pokemons: [...caughtPokemon] };
    },
});

// Catch command
const catchPokemonCommand = api.createCommand<{ name: string }, { name: string }>({
    queryFn: async (args) => {
        await new Promise(resolve => setTimeout(resolve, 400));
        if (!caughtPokemon.includes(args.name)) {
            caughtPokemon.push(args.name);
        }
        return args;
    },
    link: [
        commandLink({
            resource: caughtResource,
            forwardArgs: () => true,
            invalidate: true,
        }),
    ],
});

export function Base() {
    const authState = authResource.useResourceAgent();
    const user = authState.data;
    const isLoggedIn = !!user;

    // Use SKIP when not logged in
    const listState = pokemonListResource.useResourceAgent(isLoggedIn || SKIP);
    const caughtState = caughtResource.useResourceAgent(isLoggedIn || SKIP);

    const [loginTrigger, loginState] = loginCommand.useCommandAgent();
    const [logoutTrigger, logoutState] = logoutCommand.useCommandAgent();
    const [catchTrigger, catchState] = catchPokemonCommand.useCommandAgent();

    const [username, setUsername] = React.useState('');

    const handleLogin = () => {
        if (username.trim()) loginTrigger({ username: username.trim() });
    };

    const handleCatch = (name: string) => {
        catchTrigger({ name });
    };

    const caughtList = caughtState.data?.pokemons || [];

    return (
        <Card>
            <CardHeader className="text-xl font-bold flex justify-between items-center">
                <span>🎮 Pokémon Demo</span>
                {isLoggedIn && (
                    <div className="flex gap-2 items-center">
                        <Chip color="success" size="sm">👋 {user.username}</Chip>
                        <Chip color="primary" size="sm">🏆 Caught: {caughtList.length}</Chip>
                        <Button size="sm" color="danger" variant="flat" onPress={() => logoutTrigger()} isLoading={logoutState.isLoading}>
                            Выйти
                        </Button>
                    </div>
                )}
            </CardHeader>
            <Divider />
            <CardBody className="space-y-4">
                {/* Auth section */}
                {!isLoggedIn && !authState.isInitialLoading && (
                    <div className="flex flex-col items-center gap-4 py-6">
                        <p className="text-lg">🔐 Войдите, чтобы увидеть покемонов</p>
                        <div className="flex gap-2 max-w-sm w-full">
                            <Input
                                size="sm"
                                placeholder="Имя тренера"
                                value={username}
                                onValueChange={setUsername}
                                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                            />
                            <Button
                                color="primary"
                                size="sm"
                                onPress={handleLogin}
                                isLoading={loginState.isLoading}
                            >
                                Войти
                            </Button>
                        </div>
                    </div>
                )}

                {/* Loading */}
                {(authState.isInitialLoading || listState.isInitialLoading) && (
                    <div className="text-center py-8">⏳ Загрузка...</div>
                )}

                {/* Pokemon grid */}
                {isLoggedIn && listState.isSuccess && listState.data && (
                    <div className="grid grid-cols-3 gap-3">
                        {listState.data.results.map((p: Pokemon) => {
                            const id = p.url.split('/').filter(Boolean).pop();
                            const isCaught = caughtList.includes(p.name);
                            return (
                                <div
                                    key={p.name}
                                    className={`p-3 rounded-lg text-center ${isCaught ? 'bg-success-50 border-2 border-success-200' : 'bg-default-100'}`}
                                >
                                    <img
                                        src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`}
                                        alt={p.name}
                                        className="w-16 h-16 mx-auto"
                                    />
                                    <p className="font-semibold capitalize text-sm">{p.name}</p>
                                    <Button
                                        size="sm"
                                        color={isCaught ? 'success' : 'primary'}
                                        variant={isCaught ? 'flat' : 'solid'}
                                        onPress={() => handleCatch(p.name)}
                                        isDisabled={isCaught || catchState.isLoading}
                                        className="mt-1"
                                    >
                                        {isCaught ? '✅ Пойман' : '🔴 Поймать'}
                                    </Button>
                                </div>
                            );
                        })}
                    </div>
                )}

                <Divider />
                <p className="text-xs text-default-400 text-center">
                    createApi + SKIP token + createCommand + commandLink — демо с псевдо-авторизацией и Pokémon API
                </p>
            </CardBody>
        </Card>
    );
}
