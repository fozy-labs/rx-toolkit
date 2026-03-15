# Contributing

Руководство для контрибьюторов проекта **@fozy-labs/rx-toolkit**.

## Содержание

- [Contributing](#contributing)
  - [Содержание](#содержание)
  - [Быстрый старт](#быстрый-старт)
  - [Структура проекта](#структура-проекта)
  - [Разработка](#разработка)
    - [Исходный код (`src/`)](#исходный-код-src)
    - [Интерактивные примеры (`apps/demos/`)](#интерактивные-примеры-appsdemos)
    - [Документация (`docs/`)](#документация-docs)
  - [Тесты](#тесты)
  - [Соглашения](#соглашения)
    - [Именование файлов](#именование-файлов)
    - [Протокол сигналов](#протокол-сигналов)
    - [Код и документация](#код-и-документация)
    - [Коммиты](#коммиты)
    - [CHANGELOG](#changelog)
    - [index.ts](#indexts)
  - [AI-assisted разработка](#ai-assisted-разработка)
  - [Релиз](#релиз)


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


## Структура проекта

```
rx-toolkit/
├── .github/              # AI-промпты, инструкции, скиллы
├── src/                  # Исходный код библиотеки
│   ├── signals/          # Реактивные примитивы (Signal, Computed, Effect)
│   ├── query/            # Кеш-менеджер (Resource, Command)
│   └── common/           # Утилиты, devtools, React-хуки
├── apps/
│   └── demos/            # Интерактивные примеры (React + Vite + MDX)
├── docs/                 # Документация
└── dist/                 # Результат сборки (не коммитится)
```


## Разработка

### Исходный код (`src/`)

Библиотека состоит из трёх "модулей":

| Модуль | Путь | Описание                                                            |
|--------|------|---------------------------------------------------------------------|
| **Signals** | `src/signals/` | Реактивные примитивы: `State`, `Computed`, `Effect`, операторы и тд |
| **Query** | `src/query/` | Кеш-менеджер: `Resource`, `Command`, агенты, `SKIP_TOKEN` и тд      |
| **Common** | `src/common/` | Общие утилиты, интеграция с DevTools, React-хуки и тд                 |

> **Алиас путей:** `@/` → `src/`.


### Интерактивные примеры (`apps/demos/`)

Демо-приложение на **React 19 + Vite + MDX + Tailwind CSS + HeroUI**.
Примеры можно запускать и редактировать прямо в браузере благодаря `react-live`.

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

> При изменении кода в `src/` рассмотрите необходимость добавления интерактивного примера в `apps/demos/`.


### Документация (`docs/`)

Документация на **русском языке**:

| Файл                   | Содержание                     |
|------------------------|--------------------------------|
| `docs/signals/`        | Реактивные примитивы           |
| `docs/query/`          | Query кеш-менеджер             |
| `docs/usage/react/`    | React-хуки                     |
| `docs/devtools/`       | Интеграция с Redux DevTools    |
| `docs/options/`        | Глобальные настройки           |
| `docs/migrations/`     | Гайды миграции между версиями  |
| `docs/contributing/`   | Руководства для контрибьюторов |
| `docs/CHANGELOG.md`    | История изменений              |
| `docs/CONTRIBUTING.md` | Руководство для контрибьюторов |

> При изменении кода в `src/` рассмотрите необходимость обновления соответствующей документации в `docs/`.


## Тесты

Используется **Vitest** с окружением `jsdom`.

```bash
npm run test            # Однократный запуск
npm run test:watch      # Watch-режим
npm run test:coverage   # Отчёт о покрытии
npm run test:ui         # Vitest UI в браузере
```

- Тесты размещаются рядом с кодом: `MyModule.test.ts`
- Интеграционные — в `src/__tests__/integration/`


## Соглашения

### Именование файлов

- Классы/типы — **PascalCase**: `Signal.ts`, `ReadonlySignal.ts`
- Фабрики/утилиты — **camelCase**: `createResource.ts`, `deepEqual.ts`
- Типы — суффиксы: `XDefinition`, `XInstance` и тд


### Протокол сигналов

```typescript
signal()       // или signal.get()
signal.peek()  // получить без подписки
signal.set(v)  // установить значение
signal.obs     // RxJS Observable
```


### Код и документация

- Код и комментарии в коде — **на английском**
- Документация (`docs/`) — **на русском**
- AI кастомизация (`.github/`) — **на английском**


### Коммиты

Используются [Conventional Commits](https://www.conventionalcommits.org/), но со следующими адоптациями:
- `chore(..)` (вместо `docs(..)`) - при настройке AI окружения (промпты, инструкции, скиллы и тд)
- `thoughts(..)` (вместо `docs(..)`) - коммиты сгенерированные AI при работе над `.thoughts`


### CHANGELOG

Используется формат [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

### index.ts

- `src/index.ts` — единственная точка экспорта публичного API.
- `<module>/index.ts` — точка экспорта для конкретного "модуля".


## AI-assisted разработка

Проект настроен для работы с **GitHub Copilot**.

[//]: # (For humans only guide:)
Описание подхода: [docs/contributing/ai-assisted-development.md](contributing/ai-assisted-development.md).


## Релиз

Релизы делятся на:
- **RC** — не стабильные релизы
- **Stable** — стабильные релизы

[//]: # (For humans only guide:)
Инструкция по выпуску описана тут [docs/contributing/release/README.md](contributing/release/README.md).

