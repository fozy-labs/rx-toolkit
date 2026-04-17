import { type SyntheticEvent, useMemo, useState } from 'react';
import { inject } from '@fozy-labs/simplest-di';
import { Card, CardBody, Input, Pagination, Skeleton } from '@heroui/react';
import { Link } from 'react-router-dom';

import { PokemonApi } from '@/entities/pokemon';

const LIMIT = 24;

function handlePokemonImageError(event: SyntheticEvent<HTMLImageElement>, fallbackImageUrl: string) {
    const image = event.currentTarget;

    if (image.dataset.fallbackApplied === 'true') {
        image.onerror = null;
        return;
    }

    image.dataset.fallbackApplied = 'true';
    image.src = fallbackImageUrl;
}

export function PokemonListPage() {
    const pokemonApi = inject(PokemonApi);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');

    const offset = (page - 1) * LIMIT;
    const query = pokemonApi.list.useResource({ offset, limit: LIMIT });

    const totalPages = query.data ? Math.ceil(query.data.count / LIMIT) : 1;

    const filtered = useMemo(() => {
        if (!query.data) return [];
        if (!search) return query.data.results;
        return query.data.results.filter(p =>
            p.name.toLowerCase().includes(search.toLowerCase())
        );
    }, [query.data, search]);

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h1 className="text-2xl font-bold">Pokemon</h1>
                <Input
                    placeholder="Filter current page..."
                    value={search}
                    onValueChange={setSearch}
                    isClearable
                    onClear={() => setSearch('')}
                    variant="bordered"
                    size="sm"
                    className="max-w-xs"
                />
            </div>

            {query.isError && (
                <div className="text-center py-12">
                    <p className="text-danger text-lg">Failed to load pokemon</p>
                    <p className="text-default-400 text-sm mt-1">{String(query.error)}</p>
                </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {query.isLoading && Array.from({ length: LIMIT }, (_, i) => (
                    <Card key={i} shadow="sm">
                        <CardBody className="items-center gap-6 p-1 h-44 w-44">
                            <Skeleton className="rounded-lg w-30 h-30 opacity-50"/>
                            <Skeleton className="h-4 w-16 rounded-lg"/>
                        </CardBody>
                    </Card>
                ))}
                {!query.isLoading && filtered.map(pokemon => (
                    <Card
                        key={pokemon.name}
                        as={Link}
                        to={`/pokemon/${pokemon.id}`}
                        isPressable
                        shadow="sm"
                    >
                        <CardBody className="items-center gap-1 p-1 h-44 w-44">
                            <img
                                src={pokemon.imageUrl}
                                alt={pokemon.name}
                                className="h-30 w-30 object-contain"
                                onErrorCapture={(e) => handlePokemonImageError(e, '/pokemon-fallback.png')}
                            />
                            <p className="capitalize text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis max-w-32">{pokemon.name}</p>
                            <p className="text-xs text-default-400">#{pokemon.id}</p>
                        </CardBody>
                    </Card>
                ))}
            </div>

            {filtered.length === 0 && search && (
                <p className="text-center text-default-400 py-8">No pokemon match "{search}"</p>
            )}

            <div className="flex justify-center pt-4">
                <Pagination
                    total={totalPages}
                    page={page}
                    onChange={setPage}
                    showControls
                    color="primary"
                />
            </div>
        </div>
    );
}
