import { useSignal } from '@fozy-labs/rx-toolkit';
import { Signal } from '@fozy-labs/rx-toolkit';

import { toggleCatch } from '../model';

// We need a reactive read so React re-renders when the set changes.
// The Signal is defined in the model layer; we just import the toggle.

interface CatchButtonProps {
    pokemonId: number;
    isCaught: boolean;
    className?: string;
}

export function CatchButton({ pokemonId, isCaught, className = '' }: CatchButtonProps) {
    return (
        <button
            onClick={() => toggleCatch(pokemonId)}
            className={`rounded-lg px-4 py-2 font-medium transition ${
                isCaught
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : 'bg-yellow-400 text-gray-900 hover:bg-yellow-500'
            } ${className}`}
        >
            {isCaught ? '★ Release' : '☆ Catch!'}
        </button>
    );
}
