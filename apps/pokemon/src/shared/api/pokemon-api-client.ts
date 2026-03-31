import { injectable } from '@fozy-labs/simplest-di';

export interface PokemonListItem {
    name: string;
    url: string;
    id: number;
}

export interface PokemonDetail {
    id: number;
    name: string;
    sprites: {
        front_default: string;
        other: {
            'official-artwork': {
                front_default: string;
            };
        };
    };
    types: Array<{ type: { name: string } }>;
    stats: Array<{ base_stat: number; stat: { name: string } }>;
    height: number;
    weight: number;
}

const BASE_URL = 'https://pokeapi.co/api/v2';

@injectable('SINGLETON')
export class PokemonApiClient {
    async fetchList(offset: number, limit: number): Promise<{ results: PokemonListItem[]; count: number }> {
        const res = await fetch(`${BASE_URL}/pokemon?offset=${offset}&limit=${limit}`);
        if (!res.ok) throw new Error(`Failed to fetch pokemon list: ${res.status}`);
        const data = await res.json();
        return {
            count: data.count,
            results: data.results.map((p: { name: string; url: string }) => ({
                ...p,
                id: Number(p.url.split('/').filter(Boolean).pop()),
            })),
        };
    }

    async fetchDetail(id: number): Promise<PokemonDetail> {
        const res = await fetch(`${BASE_URL}/pokemon/${id}`);
        if (!res.ok) throw new Error(`Failed to fetch pokemon ${id}: ${res.status}`);
        return res.json();
    }
}
