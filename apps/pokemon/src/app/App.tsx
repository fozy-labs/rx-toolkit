import { setupReactDi, DiScopeProvider } from '@fozy-labs/simplest-di';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

import { PokemonApiClient } from '@/shared/api';
import { PokemonListPage } from '@/pages/pokemon-list';
import { PokemonDetailPage } from '@/pages/pokemon-detail';

setupReactDi();

export function App() {
    return (
        <DiScopeProvider provide={[PokemonApiClient]}>
            <BrowserRouter>
                <div className="min-h-screen bg-gray-50">
                    <header className="border-b bg-white shadow-sm">
                        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
                            <span className="text-xl">⚡</span>
                            <h1 className="text-lg font-bold text-gray-800">
                                rx-toolkit Pokédex
                            </h1>
                            <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-600">
                                FSD + DI demo
                            </span>
                        </div>
                    </header>

                    <Routes>
                        <Route path="/" element={<PokemonListPage />} />
                        <Route path="/pokemon/:id" element={<PokemonDetailPage />} />
                    </Routes>
                </div>
            </BrowserRouter>
        </DiScopeProvider>
    );
}
