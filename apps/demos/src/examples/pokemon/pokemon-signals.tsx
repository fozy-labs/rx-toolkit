import React from "react";
import { createApi, reactHooksPlugin, SKIP, Signal, useSignal } from "@fozy-labs/rx-toolkit";
import { Button, Card, CardBody, CardHeader, Chip, Divider, Input } from "@heroui/react";

// ── Types ──────────────────────────────────────────────
interface Pokemon {
    name: string;
    url: string;
}
interface PokemonList {
    count: number;
    results: Pokemon[];
}
interface User {
    username: string;
    loggedInAt: number;
}

// ── Signals (state management) ─────────────────────────
const currentUser$ = Signal.state<User | null>(null, "pokemon/currentUser");
const caughtPokemon$ = Signal.state<string[]>([], "pokemon/caughtPokemon");

const isLoggedIn$ = Signal.compute(
    () => currentUser$.get() !== null,
    "pokemon/isLoggedIn",
);
const caughtCount$ = Signal.compute(
    () => caughtPokemon$.get().length,
    "pokemon/caughtCount",
);

// ── Query API ──────────────────────────────────────────
const api = createApi({
    plugins: [reactHooksPlugin()],
});

const authResource = api.createResource<void, User | null>({
    key: "pokemon-auth",
    queryFn: async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return currentUser$.peek();
    },
});

const loginCommand = api.createCommand<{ username: string }, User>({
    queryFn: async (args) => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const user: User = {
            username: args.username,
            loggedInAt: Date.now(),
        };
        currentUser$.set(user);
        return user;
    },
    links: (link) =>
        link({
            resource: authResource,
            forwardArgs: () => undefined,
            invalidate: true,
        }),
});

const logoutCommand = api.createCommand<void, null>({
    queryFn: async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        currentUser$.set(null);
        caughtPokemon$.set([]);
        return null;
    },
    links: (link) =>
        link({
            resource: authResource,
            forwardArgs: () => undefined,
            invalidate: true,
        }),
});

const pokemonListResource = api.createResource<boolean, PokemonList>({
    key: "pokemon-list",
    queryFn: async () => {
        const res = await fetch("https://pokeapi.co/api/v2/pokemon?limit=12");
        return res.json();
    },
});

const caughtResource = api.createResource<boolean, { pokemons: string[] }>({
    key: "pokemon-caught",
    queryFn: async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { pokemons: [...caughtPokemon$.peek()] };
    },
});

const catchPokemonCommand = api.createCommand<
    { name: string },
    { name: string }
>({
    queryFn: async (args) => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        const current = caughtPokemon$.peek();
        if (!current.includes(args.name)) {
            caughtPokemon$.set([...current, args.name]);
        }
        return args;
    },
    links: (link) =>
        link({
            resource: caughtResource,
            forwardArgs: () => true,
            optimisticUpdate: (draft, args) => {
                const current = draft.pokemons;
                if (!current.includes(args.name)) {
                    draft.pokemons = [...current, args.name];
                }
            },
            invalidate: true,
        }),
});

// ── Username input signal ──────────────────────────────
const username$ = Signal.state("", "pokemon/username");

// ── Page component ─────────────────────────────────────
export function Base() {
    const user = useSignal(currentUser$);
    const isLoggedIn = useSignal(isLoggedIn$);
    const caughtCount = useSignal(caughtCount$);
    const username = useSignal(username$);

    const authState = authResource.useResource();
    const listState = pokemonListResource.useResource(isLoggedIn || SKIP);
    const caughtState = caughtResource.useResource(isLoggedIn || SKIP);

    const [loginTrigger, loginState] = loginCommand.useCommand();
    const [logoutTrigger, logoutState] = logoutCommand.useCommand();
    const [catchTrigger, catchState] = catchPokemonCommand.useCommand();

    const handleLogin = () => {
        const trimmed = username.trim();
        if (trimmed) {
            loginTrigger({ username: trimmed });
        }
    };

    const handleCatch = (name: string) => {
        catchTrigger({ name });
    };

    const caughtList = caughtState.data?.pokemons || [];

    return (
        <div className="not-prose max-w-4xl mx-auto">
            <Card>
                <CardHeader className="text-xl font-bold flex justify-between items-center">
                    <span>🎮 Pokémon Demo — Query + Signals</span>
                    {isLoggedIn && user && (
                        <div className="flex gap-2 items-center">
                            <Chip color="success" size="sm">
                                👋 {user.username}
                            </Chip>
                            <Chip color="primary" size="sm">
                                🏆 Поймано: {caughtCount}
                            </Chip>
                            <Button
                                size="sm"
                                color="danger"
                                variant="flat"
                                onPress={() => logoutTrigger()}
                                isLoading={logoutState.isLoading}
                            >
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
                            <p className="text-lg">
                                🔐 Войдите, чтобы увидеть покемонов
                            </p>
                            <div className="flex gap-2 max-w-sm w-full">
                                <Input
                                    size="sm"
                                    placeholder="Имя тренера"
                                    value={username}
                                    onValueChange={(v) => username$.set(v)}
                                    onKeyDown={(e) =>
                                        e.key === "Enter" && handleLogin()
                                    }
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
                    {(authState.isInitialLoading ||
                        listState.isInitialLoading) && (
                        <div className="text-center py-8">⏳ Загрузка...</div>
                    )}

                    {/* Pokemon grid */}
                    {isLoggedIn && listState.isSuccess && listState.data && (
                        <div className="grid grid-cols-3 gap-3">
                            {listState.data.results.map((p: Pokemon) => {
                                const id = p.url
                                    .split("/")
                                    .filter(Boolean)
                                    .pop();
                                const isCaught = caughtList.includes(p.name);
                                return (
                                    <div
                                        key={p.name}
                                        className={`p-3 rounded-lg text-center ${isCaught ? "bg-success-50 border-2 border-success-200" : "bg-default-100"}`}
                                    >
                                        <img
                                            src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`}
                                            alt={p.name}
                                            className="w-16 h-16 mx-auto"
                                        />
                                        <p className="font-semibold capitalize text-sm">
                                            {p.name}
                                        </p>
                                        <Button
                                            size="sm"
                                            color={
                                                isCaught
                                                    ? "success"
                                                    : "primary"
                                            }
                                            variant={
                                                isCaught ? "flat" : "solid"
                                            }
                                            onPress={() =>
                                                handleCatch(p.name)
                                            }
                                            isDisabled={
                                                isCaught ||
                                                catchState.isLoading
                                            }
                                            className="mt-1"
                                        >
                                            {isCaught
                                                ? "✅ Пойман"
                                                : "🔴 Поймать"}
                                        </Button>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <Divider />
                    <p className="text-xs text-default-400 text-center">
                        createApi + SKIP + createCommand + links + State +
                        Computed + useSignal — демо с псевдо-авторизацией и
                        Pokémon API
                    </p>
                </CardBody>
            </Card>
        </div>
    );
}
