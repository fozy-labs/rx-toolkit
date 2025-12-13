import React from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { Navbar, NavbarBrand, NavbarContent, NavbarItem } from '@heroui/react';
import { reduxDevtools, DefaultOptions } from "@fozy-labs/rx-toolkit";

DefaultOptions.update({
    DEVTOOLS: reduxDevtools({
        name: 'RxToolkit Demos',
    }),
});

import HomePage from '../pages/HomePage.mdx';
import SignalsPage from '../pages/SignalsPage.mdx';
import QueriesPage from '../pages/QueriesPage.mdx';

export default function App() {
    const location = useLocation();

    return (
        <div className="min-h-screen">
            <Navbar isBordered>
                <NavbarBrand>
                    <Link to="/" className="font-bold text-xl">
                        RxToolkit Demos
                    </Link>
                </NavbarBrand>

                <NavbarContent className="gap-4" justify="center">
                    <NavbarItem isActive={location.pathname === '/'}>
                        <Link to="/" className={location.pathname === '/' ? 'text-primary' : 'text-foreground'}>
                            Главная
                        </Link>
                    </NavbarItem>
                    <NavbarItem isActive={location.pathname === '/signals'}>
                        <Link to="/signals" className={location.pathname === '/signals' ? 'text-primary' : 'text-foreground'}>
                            Сигналы
                        </Link>
                    </NavbarItem>
                    <NavbarItem isActive={location.pathname === '/queries'}>
                        <Link to="/queries" className={location.pathname === '/queries' ? 'text-primary' : 'text-foreground'}>
                            Запросы
                        </Link>
                    </NavbarItem>
                </NavbarContent>
            </Navbar>

            <main className="container mx-auto px-4 py-8 max-w-7xl prose">
                <Routes>
                    <Route path="/" element={<HomePage />}/>
                    <Route path="/signals" element={<SignalsPage />}/>
                    <Route path="/queries" element={<QueriesPage />}/>
                </Routes>
            </main>
        </div>
    );
}

