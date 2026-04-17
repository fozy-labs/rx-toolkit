import type { PokemonListItem } from './types';

const OFFICIAL_ARTWORK_BASE_URL = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork';
const FALLBACK_SPRITE_BASE_URL = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';

export function parsePokemonId(url: string): number {
    const match = url.match(/\/pokemon\/(\d+)\/?$/);

    if (!match) {
        throw new Error(`Invalid pokemon url: ${url}`);
    }

    return Number(match[1]);
}

export function getPokemonImageUrl(id: number): string {
    return `${OFFICIAL_ARTWORK_BASE_URL}/${id}.png`;
}

export function getPokemonFallbackImageUrl(id: number): string {
    return `${FALLBACK_SPRITE_BASE_URL}/${id}.png`;
}

export function normalizePokemonListItem(
    item: Pick<PokemonListItem, 'name' | 'url'>,
): PokemonListItem {
    const id = parsePokemonId(item.url);

    return {
        ...item,
        id,
        imageUrl: getPokemonImageUrl(id),
        fallbackImageUrl: getPokemonFallbackImageUrl(id),
    };
}