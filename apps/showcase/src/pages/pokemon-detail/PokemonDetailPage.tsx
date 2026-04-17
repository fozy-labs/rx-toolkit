import { useParams, Link } from 'react-router-dom';
import {
    Card, CardBody, Chip, Progress, Skeleton, Button, Image,
} from '@heroui/react';
import { inject } from '@fozy-labs/simplest-di';
import { SKIP } from '@fozy-labs/rx-toolkit';
import { PokemonApi } from '@/entities/pokemon';

const TYPE_COLORS: Record<string, 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger'> = {
    fire: 'danger',
    water: 'primary',
    grass: 'success',
    electric: 'warning',
    poison: 'secondary',
    normal: 'default',
    fighting: 'danger',
    ground: 'warning',
    rock: 'default',
    bug: 'success',
    ghost: 'secondary',
    psychic: 'secondary',
    ice: 'primary',
    dragon: 'secondary',
    fairy: 'secondary',
    dark: 'default',
    steel: 'default',
    flying: 'primary',
};

export function PokemonDetailPage() {
    const { id } = useParams<{ id: string }>();
    const pokemonApi = inject(PokemonApi);
    const query = pokemonApi.detail.useResource(id ?? SKIP);

    if (!id) {
        return (
            <div className="text-center py-20">
                <p className="text-danger text-lg">No Pokemon specified</p>
                <Button as={Link} to="/pokemon" variant="light" className="mt-4">← Back</Button>
            </div>
        );
    }

    if (query.isInitialLoading || (!query.data && !query.isError)) {
        return (
            <div className="space-y-6">
                <Skeleton className="h-8 w-40 rounded-lg" />
                <div className="flex flex-col sm:flex-row gap-8">
                    <Skeleton className="w-64 h-64 rounded-2xl" />
                    <div className="flex-1 space-y-4">
                        {Array.from({ length: 6 }, (_, i) => (
                            <Skeleton key={i} className="h-6 w-full rounded-lg" />
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    if (query.isError) {
        return (
            <div className="text-center py-20">
                <p className="text-danger text-lg">Pokemon not found</p>
                <Button as={Link} to="/pokemon" variant="light" className="mt-4">← Back</Button>
            </div>
        );
    }

    const p = query.data!;
    const artwork = p.sprites.other?.['official-artwork']?.front_default ?? p.sprites.front_default;

    return (
        <div className="space-y-6">
            <Button as={Link} to="/pokemon" variant="light" size="sm">← Back to list</Button>

            <div className="flex flex-col sm:flex-row gap-8">
                <Card shadow="sm" className="sm:w-72 sm:flex-none">
                    <CardBody className="items-center p-6">
                        {artwork ? (
                            <Image src={artwork} alt={p.name} width={220} height={220} className="object-contain" />
                        ) : (
                            <div className="flex h-[220px] w-[220px] items-center justify-center rounded-2xl bg-default-100 text-center text-sm text-default-500">
                                Image unavailable
                            </div>
                        )}
                        <h1 className="text-2xl font-bold capitalize mt-2">{p.name}</h1>
                        <p className="text-default-400">#{String(p.id).padStart(3, '0')}</p>
                        <div className="flex gap-2 mt-3">
                            {p.types.map(t => (
                                <Chip key={t.type.name} color={TYPE_COLORS[t.type.name] ?? 'default'} variant="flat" size="sm">
                                    {t.type.name}
                                </Chip>
                            ))}
                        </div>
                    </CardBody>
                </Card>

                <div className="flex-1 space-y-6">
                    <Card shadow="sm">
                        <CardBody className="gap-2 p-6">
                            <h2 className="font-semibold text-lg">Info</h2>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <p className="text-default-400">Height</p>
                                    <p className="font-medium">{(p.height / 10).toFixed(1)} m</p>
                                </div>
                                <div>
                                    <p className="text-default-400">Weight</p>
                                    <p className="font-medium">{(p.weight / 10).toFixed(1)} kg</p>
                                </div>
                            </div>
                        </CardBody>
                    </Card>

                    <Card shadow="sm">
                        <CardBody className="gap-2 p-6">
                            <h2 className="font-semibold text-lg">Abilities</h2>
                            <div className="flex flex-wrap gap-2">
                                {p.abilities.map(a => (
                                    <Chip
                                        key={a.ability.name}
                                        variant={a.is_hidden ? 'bordered' : 'flat'}
                                        size="sm"
                                    >
                                        {a.ability.name}{a.is_hidden ? ' (hidden)' : ''}
                                    </Chip>
                                ))}
                            </div>
                        </CardBody>
                    </Card>

                    <Card shadow="sm">
                        <CardBody className="gap-3 p-6">
                            <h2 className="font-semibold text-lg">Base Stats</h2>
                            {p.stats.map(s => (
                                <div key={s.stat.name} className="space-y-1">
                                    <div className="flex justify-between text-sm">
                                        <span className="capitalize text-default-600">{s.stat.name.replace('-', ' ')}</span>
                                        <span className="font-mono font-medium">{s.base_stat}</span>
                                    </div>
                                    <Progress
                                        value={s.base_stat}
                                        maxValue={255}
                                        color={s.base_stat > 100 ? 'success' : s.base_stat > 50 ? 'primary' : 'warning'}
                                        size="sm"
                                        aria-label={`${s.stat.name.replace('-', ' ')} stat: ${s.base_stat} out of 255`}
                                    />
                                </div>
                            ))}
                        </CardBody>
                    </Card>
                </div>
            </div>
        </div>
    );
}
