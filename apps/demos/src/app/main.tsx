import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { HeroUIProvider } from '@heroui/react';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
    <HeroUIProvider>
        <BrowserRouter>
            <App />
        </BrowserRouter>
    </HeroUIProvider>
);
