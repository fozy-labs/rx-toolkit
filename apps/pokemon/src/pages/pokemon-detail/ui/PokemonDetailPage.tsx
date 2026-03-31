import { useParams, Link } from 'react-router-dom';
import { useSignal } from '@fozy-labs/rx-toolkit';

import { pokemonDetailResource, SKIP } from '@/entities/pokemon';
import { CatchButton, caughtSet$, toggleCatch } from '@/features/catch-pokemon';
import { Spinner, ErrorBanner } from '@/shared/ui';

const TYPE_COLORS: Record<string, string> = {
    fire: 'bg-orange-400',
    water: 'bg-blue-400',
    grass: 'bg-green-400',
    electric: 'bg-yellow-400',
    psychic: 'bg-pink-400',
    ice: 'bg-cyan-300',
    dragon: 'bg-indigo-500',
    dark: 'bg-gray-700 text-white',
    fairy: 'bg-pink-300',
    normal: 'bg-gray-300',
    fighting: 'bg-red-600 text-white',
    flying: 'bg-sky-300',
    poison: 'bg-purple-400',
    ground: 'bg-amber-600 text-white',
    rock: 'bg-yellow-700 text-white',
    bug: 'bg-lime-500',
    ghost: 'bg-purple-700 text-white',
    steel: 'bg-gray-400',
};

export function PokemonDetailPage() {
    const { id } = useParams<{ id: string }>();
    const pokemonId = id ? Number(id) : null;

    const detail = pokemonDetailResource.useResourceAgent(
        pokemonId ? { id: pokemonId } : SKIP,
    );

    const caught = useSignal(caughtSet$);

    if (!pokemonId) {
        return <p className="p-8 text-center text-gray-500">Invalid Pokémon ID</p>;
    }

    return (
        <div className="mx-auto max-w-2xl px-4 py-8">
            <Link to="/" className="mb-4 inline-block text-blue-500 hover:underline">
                ← Back to list
            </Link>

            {detail.isInitialLoading && <Spinner />}
            {detail.isError && <ErrorBanner error={detail.error} />}

            {detail.data && (
                <div className="overflow-hidden rounded-2xl bg-white shadow-lg">
                    <div className="flex flex-col items-center bg-gradient-to-b from-gray-50 to-white p-8">
                        <img
                            src={detail.data.sprites.other['official-artwork'].front_default}
                            alt={detail.data.name}
                            className="h-48 w-48 object-contain"
                        />
                        <h1 className="mt-4 text-3xl font-bold capitalize text-gray-900">
                            {detail.data.name}
                        </h1>
                        <span className="text-gray-400">#{String(detail.data.id).padStart(3, '0')}</span>

                        <div className="mt-3 flex gap-2">
                            {detail.data.types.map((t) => (
                                <span
                                    key={t.type.name}
                                    className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${
                                        TYPE_COLORS[t.type.name] ?? 'bg-gray-200'
                                    }`}
                                >
                                    {t.type.name}
                                </span>
                            ))}
                        </div>

                        <CatchButton
                            pokemonId={pokemonId}
                            isCaught={caught.has(pokemonId)}
                            className="mt-4"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4 p-6 text-sm text-gray-600">
                        <div>
                            <span className="font-medium text-gray-800">Height</span>
                            <p>{(detail.data.height / 10).toFixed(1)} m</p>
                        </div>
                        <div>
                            <span className="font-medium text-gray-800">Weight</span>
                            <p>{(detail.data.weight / 10).toFixed(1)} kg</p>
                        </div>
                    </div>

                    <div className="border-t p-6">
                        <h2 className="mb-3 font-semibold text-gray-800">Base Stats</h2>
                        <div className="space-y-2">
                            {detail.data.stats.map((s) => (
                                <div key={s.stat.name} className="flex items-center gap-3">
                                    <span className="w-28 text-xs capitalize text-gray-500">
                                        {s.stat.name}
                                    </span>
                                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                                        <div
                                            className="h-full rounded-full bg-blue-500 transition-all"
                                            style={{ width: `${Math.min(100, (s.base_stat / 255) * 100)}%` }}
                                        />
                                    </div>
                                    <span className="w-8 text-right text-xs font-medium">
                                        {s.base_stat}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
