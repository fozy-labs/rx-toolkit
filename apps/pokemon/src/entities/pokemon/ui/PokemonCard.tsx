import { Link } from 'react-router-dom';

interface PokemonCardProps {
    id: number;
    name: string;
    isCaught: boolean;
    onToggleCatch: () => void;
}

const spriteUrl = (id: number) =>
    `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;

export function PokemonCard({ id, name, isCaught, onToggleCatch }: PokemonCardProps) {
    return (
        <div className="group relative overflow-hidden rounded-xl bg-white shadow-md transition hover:shadow-lg">
            <Link to={`/pokemon/${id}`} className="block p-4">
                <img
                    src={spriteUrl(id)}
                    alt={name}
                    className="mx-auto h-32 w-32 object-contain transition group-hover:scale-110"
                    loading="lazy"
                />
                <p className="mt-2 text-center text-sm font-semibold capitalize text-gray-800">
                    {name}
                </p>
                <span className="block text-center text-xs text-gray-400">#{String(id).padStart(3, '0')}</span>
            </Link>

            <button
                onClick={(e) => {
                    e.preventDefault();
                    onToggleCatch();
                }}
                className={`absolute right-2 top-2 rounded-full p-1.5 text-lg transition ${
                    isCaught
                        ? 'bg-red-500 text-white hover:bg-red-600'
                        : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                }`}
                title={isCaught ? 'Release' : 'Catch!'}
            >
                {isCaught ? '★' : '☆'}
            </button>
        </div>
    );
}
