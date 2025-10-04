import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

import { DefaultOptions, combineDevtools, reduxDevtools } from '@fozy-labs/rx-toolkit';
import { createDevtools as reatomDevtools } from "@reatom/devtools";

import { Navigation } from './components/Navigation';

const SignalsPage = React.lazy(() => import('./pages/SignalsPage').then(module => ({ default: module.SignalsPage })));
const OperationsPage = React.lazy(() => import('./pages/OperationsPage').then(module => ({ default: module.OperationsPage })));
const PatchesPage = React.lazy(() => import('./pages/PatchesPage').then(module => ({ default: module.PatchesPage })));


DefaultOptions.update({
    DEVTOOLS: combineDevtools(
        reduxDevtools(),
        reatomDevtools({
            initVisibility: true,
        }),
    )
});

export function App() {
  return (
    <Router>
      <div className="app">
        <Navigation />
        <main className="main">
          <Routes>
            <Route path="/" element={<Navigate to="/signals" replace />} />
            <Route path="/signals" element={<SignalsPage />} />
            <Route path="/operations" element={<OperationsPage />} />
            <Route path="/patches" element={<PatchesPage />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}
