import React from 'react';
import { Link, useLocation } from 'react-router-dom';

export function Navigation() {
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className="nav">
      <h1>🚀 RxToolkit Примеры</h1>
      <div className="nav-links">
        <Link
          to="/signals"
          className={`nav-link ${isActive('/signals') ? 'active' : ''}`}
        >
          Реактивные сигналы
        </Link>
        <Link
          to="/operations"
          className={`nav-link ${isActive('/operations') ? 'active' : ''}`}
        >
          Операции и запросы
        </Link>
        <Link
          to="/resource"
          className={`nav-link ${isActive('/resource') ? 'active' : ''}`}
        >
          Динамические ресурсы
        </Link>
        <Link
          to="/patches"
          className={`nav-link ${isActive('/patches') ? 'active' : ''}`}
        >
          Патчи ресурсов
        </Link>
      </div>
    </nav>
  );
}
