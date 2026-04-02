import { injectable } from '@fozy-labs/simplest-di';
import { api } from '@/shared/api';
import type { PokemonDetail, PokemonListItem, PokemonListResponse } from './types';
import { normalizePokemonListItem } from './pokemon.utils';

@injectable('SINGLETON')
export class PokemonApi {
    list = api.createResource<{ offset: number; limit: number }, PokemonListResponse>({
        key: 'pokemon-list',
        queryFn: async ({ offset, limit }) => {
            const res = await fetch(`https://pokeapi.co/api/v2/pokemon?offset=${offset}&limit=${limit}`);
            if (!res.ok) throw new Error('Failed to fetch pokemon list');

            const data = await res.json() as {
                count: number;
                results: Array<Pick<PokemonListItem, 'name' | 'url'>>;
            };

            return {
                ...data,
                results: data.results.map(normalizePokemonListItem),
            };
        },
    });

    detail = api.createResource<string, PokemonDetail>({
        key: 'pokemon-detail',
        queryFn: async (nameOrId) => {
            const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${nameOrId}`);
            if (!res.ok) throw new Error(`Pokemon "${nameOrId}" not found`);
            return res.json();
        },
    });
}
