export interface PokemonListItem {
    id: number;
    name: string;
    url: string;
    imageUrl: string;
    fallbackImageUrl: string;
}

export interface PokemonListResponse {
    count: number;
    results: PokemonListItem[];
}

export interface PokemonDetail {
    id: number;
    name: string;
    height: number;
    weight: number;
    sprites: {
        front_default: string | null;
        other?: {
            'official-artwork'?: {
                front_default: string | null;
            };
        };
    };
    types: { slot: number; type: { name: string } }[];
    stats: { base_stat: number; stat: { name: string } }[];
    abilities: { ability: { name: string }; is_hidden: boolean }[];
}
