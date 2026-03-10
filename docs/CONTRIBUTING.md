# Contributing

Руководство для контрибьюторов проекта **@fozy-labs/rx-toolkit**.

## Содержание

- [Быстрый старт](#быстрый-старт)
- [Структура проекта](#структура-проекта)
- [Разработка](#разработка)
- [Исходный код (src/)](#исходный-код-src)
- [Интерактивные примеры (apps/demos/)](#интерактивные-примеры-appsdemos)
- [Документация (docs/)](#документация-docs)
- [Тесты](#тесты)
- [Соглашения](#соглашения)
- [AI-assisted разработка](#ai-assisted-разработка)
- [Релиз](#релиз)

---

## Быстрый старт

```bash
# Клонирование
git clone https://github.com/fozy-labs/rx-toolkit.git
cd rx-toolkit

# Установка зависимостей
npm install

# Проверка типов
npm run ts-check

# Запуск тестов
npm run test

# Сборка
npm run build
```

---

## Структура проекта

```
rx-toolkit/
├── src/                  # Исходный код библиотеки
│   ├── signals/          # Реактивные примитивы (Signal, Computed, Effect)
│   ├── query/            # Кеш-менеджер (Resource, Command)
│   └── common/           # Утилиты, devtools, React-хуки
├── apps/
│   └── demos/            # Интерактивные примеры (React + Vite + MDX)
├── docs/                 # Документация
├── .github/              # AI-промпты, инструкции, скиллы
└── dist/                 # Результат сборки (не коммитится)
```

---

## Разработка

### Исходный код (`src/`)

Библиотека состоит из трёх модулей:

| Модуль | Путь | Описание |
|--------|------|----------|
| **Signals** | `src/signals/` | Реактивные примитивы: `State`, `Computed`, `Effect`, операторы |
| **Query** | `src/query/` | Кеш-менеджер: `Resource`, `Command`, агенты, `SKIP_TOKEN` |
| **Common** | `src/common/` | Redux DevTools, `DefaultOptions`, `useConstant`, `deepEqual` |

**Алиас путей:** `@/` → `src/` (настроен в `tsconfig.json`).

**Команды:**

```bash
npm run build          # Разовая сборка (tsc → tsc-alias → dist/)
npm run build:watch    # Сборка в watch-режиме
npm run ts-check       # Проверка типов без эмита
```

### Интерактивные примеры (`apps/demos/`)

Демо-приложение на **React 19 + Vite + MDX + Tailwind CSS + HeroUI**.
Примеры можно запускать прямо в браузере благодаря `react-live`.

```bash
cd apps/demos
npm install
npm run dev            # http://localhost:3000
```

**Структура примеров:**

```
apps/demos/src/
├── pages/             # MDX-страницы (SignalsPage, QueriesPage, HomePage)
├── examples/
│   ├── signals/       # Примеры для сигналов
│   └── query/         # Примеры для query
├── components/        # LiveExample, QueryTabs и другие компоненты
└── utils/             # Утилиты для fetch-запросов
```

При добавлении новой фичи в `src/` — добавляйте интерактивный пример в `apps/demos/`.

### Документация (`docs/`)

Документация на **русском языке**:

| Файл | Содержание |
|------|-----------|
| `docs/signals/README.md` | State, Computed, Effect — реактивные примитивы |
| `docs/query/README.md` | Resource, Command, агенты — кеш-менеджер |
| `docs/usage/react/README.md` | React-хуки: `useSignal`, `useResourceAgent`, `useCommandAgent` |
| `docs/devtools/README.md` | Интеграция с Redux DevTools |
| `docs/options/README.md` | `DefaultOptions` — глобальные настройки |
| `docs/CHANGELOG.md` | История изменений |
| `docs/migrations/` | Гайды миграции между версиями |

При изменении публичного API — обновляйте соответствующий раздел документации.

---

## Тесты

Используется **Vitest** с окружением `jsdom`.

```bash
npm run test            # Однократный запуск
npm run test:watch      # Watch-режим
npm run test:coverage   # Отчёт о покрытии
npm run test:ui         # Vitest UI в браузере
```

**Правила:**

- Тесты размещаются рядом с кодом: `MyModule.test.ts`
- Интеграционные — в `src/__tests__/integration/`
- Целевое покрытие: **80%** (statements, branches, functions, lines)
- Каждый тест начинается с чистого состояния (`resetSharedOptions()` в setup)

---

## Соглашения

### Именование файлов

- Классы/типы — **PascalCase**: `Signal.ts`, `ReadonlySignal.ts`
- Фабрики/утилиты — **camelCase**: `createResource.ts`, `deepEqual.ts`
- Типы — суффиксы: `XDefinition`, `XInstance`, `XAgentInstance`, `XCreateOptions`

### Протокол сигналов

```typescript
signal.get()   // или signal() — получить значение с подпиской
signal.peek()  // получить без подписки
signal.set(v)  // установить значение
signal.obs     // RxJS Observable
```

### Код и документация

- Код и комментарии в коде — **на английском**
- Документация (`docs/`) — **на русском**

### Коммиты

Используются [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add resource deduplication
fix: correct computed dependency tracking
docs: update signals README
test: add Command agent tests
refactor: simplify batcher logic
```

---

## AI-assisted разработка

Проект настроен для работы с **GitHub Copilot** (VS Code). Ниже описаны файлы, которые автоматически подключаются к AI-ассистенту.

### Файлы конфигурации

| Файл | Назначение |
|------|-----------|
| `.github/copilot-instructions.md` | Основные правила проекта (стек, именование, протоколы). Загружается всегда. |
| `.github/instructions/thoughts-workflow.instructions.md` | Правила для файлов в `.thoughts/` (applyTo: `.thoughts/**`). |
| `.github/skills/delegate/SKILL.md` | Скилл делегирования задач субагентам. |
| `.github/prompts/01-research.prompt.md` | Промпт фазы исследования. |
| `.github/prompts/02-design.prompt.md` | Промпт фазы проектирования. |
| `.github/prompts/03-plan.prompt.md` | Промпт фазы планирования. |
| `.github/prompts/04-implement.prompt.md` | Промпт фазы реализации. |

### Workflow разработки фичей

Для крупных фич используется поэтапный AI-workflow:

```
Research → [review] → Design → [review] → Plan → [review] → Implement
```

Артефакты каждой фазы сохраняются в:

```
.thoughts/<YYYY-MM-DD>_<feature-name>/
├── 01-research/
├── 02-design/
├── 03-plan/
└── 04-implement/
```

Каждый этап проходит **ревью человеком** перед переходом к следующему.

### Как начать

1. Убедитесь, что установлен **GitHub Copilot** в VS Code
2. Файлы в `.github/` подхватываются автоматически — дополнительной настройки не требуется
3. Для запуска полного workflow фичи — используйте промпт `00-compined.prompt.md`
4. Для отдельных фаз — соответствующий промпт (`01-research`, `02-design`, и т.д.)

---

## Релиз

Подробный процесс описан в [`docs/contributing/release/README.md`](contributing/release/README.md).

Краткая версия:

```bash
npm run ts-check       # Проверка типов
npm run build          # Сборка
npm version <patch|minor|major>
npm publish
git push origin develop --tags
```

Для RC-версий:

```bash
npm version prerelease --preid=rc
npm publish --tag rc
```