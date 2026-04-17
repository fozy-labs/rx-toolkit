import { useSignal } from '@fozy-labs/rx-toolkit';
import { inject } from '@fozy-labs/simplest-di';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthStore } from '@/features/auth';
import { HomePage } from '@/pages/home';
import { LoginPage } from '@/pages/login';
import { PokemonListPage } from '@/pages/pokemon';
import { PokemonDetailPage } from '@/pages/pokemon-detail';
import { PostsListPage } from '@/pages/posts';
import { PostDetailPage } from '@/pages/post-detail';

function RequireAuth({ children }: { children: React.ReactNode }) {
    const authStore = inject(AuthStore);
    const ok = useSignal(authStore.isAuthenticated$);
    return ok ? <>{children}</> : <Navigate to="/login" replace />;
}

function GuestOnly({ children }: { children: React.ReactNode }) {
    const authStore = inject(AuthStore);
    const ok = useSignal(authStore.isAuthenticated$);
    return ok ? <Navigate to="/" replace /> : <>{children}</>;
}

export function AppRouter() {
    return (
        <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
            <Route path="/pokemon" element={<RequireAuth><PokemonListPage /></RequireAuth>} />
            <Route path="/pokemon/:id" element={<RequireAuth><PokemonDetailPage /></RequireAuth>} />
            <Route path="/posts" element={<RequireAuth><PostsListPage /></RequireAuth>} />
            <Route path="/posts/:id" element={<RequireAuth><PostDetailPage /></RequireAuth>} />
        </Routes>
    );
}
