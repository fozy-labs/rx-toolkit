import './style.css';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="container">
    <h1>⚡ RX-Toolkit Benchmarks</h1>
    <p class="subtitle">
      Комплексное тестирование производительности библиотеки реактивного программирования
    </p>

    <div class="card">
      <h2>🎯 Что тестируется</h2>
      <div class="features">
        <div class="feature">
          <div class="emoji">📦</div>
          <h3>Реактивные Сторы</h3>
          <ul>
            <li>rx-toolkit Signal</li>
            <li>rx-toolkit LazySignal</li>
            <li>Redux Toolkit</li>
          </ul>
        </div>
        
        <div class="feature">
          <div class="emoji">🔄</div>
          <h3>Query Менеджеры</h3>
          <ul>
            <li>rx-toolkit Resources</li>
            <li>rx-toolkit Operations</li>
            <li>RTK Query</li>
          </ul>
        </div>
        
        <div class="feature">
          <div class="emoji">⚛️</div>
          <h3>React Integration</h3>
          <ul>
            <li>Hooks overhead</li>
            <li>Re-render optimization</li>
            <li>State subscriptions</li>
          </ul>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>🚀 Запуск бенчмарков</h2>
      
      <h3>Vanilla JS бенчмарки:</h3>
      <div class="command">npm run bench:vanilla</div>
      
      <h3>React бенчмарки:</h3>
      <div class="command">npm run bench:react</div>
      
      <h3>Все бенчмарки:</h3>
      <div class="command">npm run bench:all</div>
      
      <p style="margin-top: 2rem; opacity: 0.8;">
        💡 Бенчмарки запускаются в терминале через Node.js для максимальной точности измерений.
      </p>
    </div>

    <div class="card">
      <h2>📊 Сценарии тестирования</h2>
      
      <div class="scenarios">
        <div class="scenario">
          <h3>1. Базовые операции</h3>
          <ul>
            <li>Создание и уничтожение примитивов</li>
            <li>Чтение и запись значений</li>
            <li>Подписки и отписки</li>
          </ul>
        </div>
        
        <div class="scenario">
          <h3>2. Производные значения</h3>
          <ul>
            <li>Computed signals</li>
            <li>Цепочки зависимостей</li>
            <li>Diamond dependency graph</li>
          </ul>
        </div>
        
        <div class="scenario">
          <h3>3. Реальные сценарии</h3>
          <ul>
            <li>Todo List (50-100 элементов)</li>
            <li>Shopping Cart</li>
            <li>User Profile управление</li>
          </ul>
        </div>
        
        <div class="scenario">
          <h3>4. Stress тесты</h3>
          <ul>
            <li>Множественные подписчики (10-100)</li>
            <li>Массовые обновления (100-1000 операций)</li>
            <li>Параллельные запросы</li>
          </ul>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>🛠️ Технологии</h2>
      <ul>
        <li><strong>Benchmark Engine:</strong> Tinybench (микробенчмарки)</li>
        <li><strong>Test Runner:</strong> TSX (TypeScript execution)</li>
        <li><strong>React Testing:</strong> React 19 + React DOM</li>
        <li><strong>Comparisons:</strong> Redux Toolkit & RTK Query</li>
      </ul>
    </div>

    <div class="footer">
      <p>Создано для тестирования производительности <strong>@fozy-labs/rx-toolkit</strong></p>
      <p><a href="https://github.com/fozy-labs/rx-toolkit" target="_blank">GitHub</a> | <a href="./README.md">Документация</a></p>
    </div>
  </div>
`;

