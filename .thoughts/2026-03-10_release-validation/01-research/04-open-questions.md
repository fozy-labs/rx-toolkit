# Открытые вопросы

## Высокий приоритет

### Q1: Нужно ли добавлять тесты для query-модуля перед релизом?

**Контекст**: Весь `src/query/` не имеет ни одного unit-теста. Coverage в vitest.config.ts явно исключает `src/query/**`. Это 31 файл с ~2500 строк кода, включая сложную транзакционную логику (patch commit/abort/reapply).

**Варианты**:
1. **Добавить минимальный набор тестов** — core/Resource, core/Command, lib/ReactiveCache, lib/IndirectMap. Покроет ~60% критических путей.
2. **Добавить только smoke-тесты** — проверить что createResource/createCommand/hooks работают без ошибок. Быстрее, но меньше уверенности.
3. **Релизить как RC** (текущий подход) — query-модуль считается experimental. Тесты добавить позже.

**Риски варианта 3**: Пользователи, сообщающие о багах, могут потерять доверие к библиотеке. Регрессии при рефакторинге невозможно отловить.

**Рекомендация исследователя**: Вариант 1 — минимальный набор unit-тестов для core + smoke-тесты для hooks.

---

### Q2: Как поступить с опечатками в публичных типах?

**Контекст**: `ResourceRefInstanse` написано с ошибкой. Исправление — breaking change (потребители, использующие тип по имени, получат TS-ошибку).

**Варианты**:
1. **Исправить сейчас** (до стабильного релиза) — пока версия 0.x, breaking changes допустимы по semver.
2. **Добавить deprecated alias** — `export type ResourceRefInstanse = ResourceRefInstance` с пометкой deprecated.
3. **Оставить как есть** — и жить с опечаткой в API навсегда.

**Рекомендация**: Вариант 1 — исправить сейчас, пока 0.x. Публичный API с опечатками подрывает профессиональное восприятие.

---

### Q3: Нужно ли экспортировать query-типы?

**Контекст**: `src/query/index.ts` не содержит `export * from './types'`. Потребители не могут типизировать свой код:
```typescript
import type { ResourceDefinition, CommandDefinition } from '@fozy-labs/rx-toolkit';
// ❌ Error: Module has no exported member 'ResourceDefinition'
```

**Следствие**: невозможно создать generic-обёртки, utility-типы, или аннотировать свои функции.

**Рекомендация**: Добавить реэкспорт типов. Это не breaking change, а additive изменение.

---

## Средний приоритет

### Q4: Нужны ли sub-path exports?

**Контекст**: Сейчас единственная точка входа `"."`. Потребители, использующие только signals, получают транзитивную зависимость на immer, observable-hooks, и все query-операторы.

**Варианты**:
1. **Добавить `"./signals"`, `"./query"`** — потребители выбирают нужный модуль.
2. **Оставить как есть** — полагаться на tree-shaking bundler-а.

**Рекомендация**: Для v1.0 — добавить sub-path exports. Для текущего 0.5.x — оставить как есть, если tree-shaking работает.

---

### Q5: Расширять ли React peerDependency до ^18.0.0?

**Контекст**: `"react": "^19.0.0"` — потребители на React 18 не могут использовать библиотеку. Код не использует React 19-specific API.

**Варианты**:
1. **Расширить до `^18.0.0 || ^19.0.0`** — максимальная аудитория.
2. **Оставить `^19.0.0`** — меньше тестовой матрицы, focus на latest.

**Рекомендация**: Требуется проверить useSignal и observable-hooks на совместимость с React 18. Если совместимы — расширить.

---

### Q6: Как поступить с `sideEffects: false` и `enablePatches()`?

**Контекст**: `ResourceRef.ts` вызывает `enablePatches()` из immer при импорте — глобальный side-effect. Но `package.json` заявляет `sideEffects: false`.

**Варианты**:
1. **Убрать `sideEffects: false`** — честно, но ухудшает tree-shaking для всего пакета.
2. **Перенести `enablePatches()` в explicit init** — например, вызывать в `createCommand()` при наличии link.
3. **Добавить `sideEffects` список** — `"sideEffects": ["./dist/query/core/Resource/ResourceRef.js"]`.

---

### Q7: Что делать с deprecated `d_init()` в ResourceDuplicator?

**Контекст**: Метод помечен `@deprecated`, но активно используется в `createCache()`. Нет альтернативы.

**Варианты**:
1. **Убрать `@deprecated`** — если удаление не планируется.
2. **Рефакторить** — вынести логику в private метод.
3. **Оставить** — если планируется полный рефакторинг ResourceDuplicator.

---

## Низкий приоритет

### Q8: Нужна ли поддержка `zod` как optional peer dependency?

**Контекст**: `zod: ^4.0.0` — peer dependency. Используется только в `LocalState`. Потребители, не использующие LocalState с zod, получают warning при `npm install`.

**Вариант**: Сделать zod optional peer dependency через `peerDependenciesMeta`:
```json
"peerDependenciesMeta": {
  "zod": { "optional": true }
}
```

---

### Q9: Нужен ли `@vitest/ui` в devDependencies?

**Контекст**: Скрипт `"test:ui": "vitest --ui"` существует, но `@vitest/ui` не установлен.

**Рекомендация**: Добавить `@vitest/ui` в devDependencies или удалить скрипт.

---

### Q10: Стоит ли удалить пустую experimental директорию?

**Контекст**: `src/query/experimental/resource_de_god/` — пустая директория без кода.

**Рекомендация**: Удалить перед релизом. Мёртвый код / артефакты не должны попадать в публичный репозиторий.

---

## Trade-offs

### T1: Стабильность vs. скорость релиза

**Дилемма**: Query-модуль без тестов, но уже используется (rc.2). Добавление тестов задерживает релиз, но повышает уверенность.

### T2: Breaking changes vs. чистый API

**Дилемма**: Исправление опечаток (`ResourceRefInstanse`) — breaking, но 0.x semver позволяет. Откладывание — цементирует ошибку.

### T3: Минимализм vs. полнота

**Дилемма**: Экспорт типов, sub-path exports, retry logic, pagination — каждая фича увеличивает surface area. Для 0.x версии мб лучше оставить minimum viable API.

---

## Неоднозначности

### A1: isLocked поведение

TODO-комментарии в `ResourceAgent.ts` (строка 31) и `ResourceDuplicatorAgent.ts` (строка 35) говорят: "вообще нет точного представления, как блокировка должна работать". Это означает, что **lock API экспонирован потребителям, но его семантика не определена**. Потребители, полагающиеся на `isLocked`, могут получить неожиданное поведение.

### A2: Render-phase side effects в useResourceAgent

`agent.initiate(args)` вызывается в render-фазе (не в useEffect). Это нарушает React strict mode patterns, но может быть намеренным design decision для immediate data fetching (аналог Suspense data fetching pattern).

### A3: Promise в optimisticUpdate

`optimisticUpdate` в LinkOptions поддерживает `Promise<RD["Data"]>` return type. Но оптимистичные обновления по определению синхронны (обновить UI сразу, до ответа сервера). Promise return — логическое противоречие.
