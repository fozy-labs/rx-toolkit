import { useState } from 'react';
import { useSignal } from '@fozy-labs/rx-toolkit';

import { pokemonListResource, PokemonCard } from '@/entities/pokemon';
import { toggleCatch, caughtSet$ } from '@/features/catch-pokemon';
import { Spinner, ErrorBanner } from '@/shared/ui';

const PAGE_SIZE = 20;

export function PokemonListPage() {
    const [page, setPage] = useState(0);

    const list = pokemonListResource.useResourceAgent({
        offset: page * PAGE_SIZE,
        limit: PAGE_SIZE,
    });

    const caught = useSignal(caughtSet$);

    const totalPages = list.data ? Math.ceil(list.data.count / PAGE_SIZE) : 0;

    return (
        <div className="mx-auto max-w-5xl px-4 py-8">
            <h1 className="mb-6 text-3xl font-bold text-gray-900">Pokédex</h1>

            {list.isInitialLoading && <Spinner />}
            {list.isError && <ErrorBanner error={list.error} />}

            {list.data && (
                <>
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                        {list.data.results.map((p) => (
                            <PokemonCard
                                key={p.id}
                                id={p.id}
                                name={p.name}
                                isCaught={caught.has(p.id)}
                                onToggleCatch={() => toggleCatch(p.id)}
                            />
                        ))}
                    </div>

                    <div className="mt-8 flex items-center justify-center gap-4">
                        <button
                            disabled={page === 0}
                            onClick={() => setPage((p) => p - 1)}
                            className="rounded bg-blue-500 px-4 py-2 text-white disabled:opacity-40"
                        >
                            ← Prev
                        </button>
                        <span className="text-sm text-gray-600">
                            Page {page + 1} / {totalPages}
                        </span>
                        <button
                            disabled={page >= totalPages - 1}
                            onClick={() => setPage((p) => p + 1)}
                            className="rounded bg-blue-500 px-4 py-2 text-white disabled:opacity-40"
                        >
                            Next →
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
