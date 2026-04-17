import { useSignal } from '@fozy-labs/rx-toolkit';
import { inject } from '@fozy-labs/simplest-di';
import { Providers } from './Providers';
import { AppRouter } from './AppRouter';
import { Header } from '@/widgets';
import { ThemeStore } from '@/shared/lib';

function AppContent() {
    const themeStore = inject(ThemeStore);
    const theme = useSignal(themeStore.theme$);

    return (
        <div className={`${theme} min-h-full bg-background text-foreground`}>
            <Header />
            <main className="mx-auto max-w-6xl px-4 py-8">
                <AppRouter />
            </main>
        </div>
    );
}

export function App() {
    return (
        <Providers>
            <AppContent />
        </Providers>
    );
}
