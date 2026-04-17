import { type ReactNode } from 'react';
import { HeroUIProvider } from '@heroui/react';
import { BrowserRouter } from 'react-router-dom';
import { setupReactDi, DiScopeProvider } from '@fozy-labs/simplest-di';
import { DefaultOptions, reduxDevtools } from '@fozy-labs/rx-toolkit';
import { AuthStore } from '@/features/auth';
import { ThemeStore } from '@/shared/lib';

setupReactDi();
DefaultOptions.update({ DEVTOOLS: reduxDevtools() });

export function Providers({ children }: { children: ReactNode }) {
    return (
        <BrowserRouter>
            <HeroUIProvider className="min-h-full max-h-0 h-full">
                <DiScopeProvider provide={[ThemeStore, AuthStore]}>
                    {children}
                </DiScopeProvider>
            </HeroUIProvider>
        </BrowserRouter>
    );
}
