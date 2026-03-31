import { inject } from '@fozy-labs/simplest-di';
import { createApi, ReactHooksPlugin, SKIP } from '@fozy-labs/rx-toolkit';

import { PokemonApiClient } from '@/shared/api';

export { SKIP };

const client = inject(PokemonApiClient);

export const pokemonApi = createApi({
    plugins: [new ReactHooksPlugin()],
});

export const pokemonListResource = pokemonApi.createResource<
    { offset: number; limit: number },
    { results: Array<{ name: string; url: string; id: number }>; count: number }
>({
    key: 'pokemon-list',
    queryFn: async (args) => client.fetchList(args.offset, args.limit),
    cacheLifetime: 60_000,
});

export const pokemonDetailResource = pokemonApi.createResource<
    { id: number },
    import('@/shared/api').PokemonDetail
>({
    key: 'pokemon-detail',
    queryFn: async (args) => client.fetchDetail(args.id),
    cacheLifetime: 120_000,
});
