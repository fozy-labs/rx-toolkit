# Fix: Split super-diagram in architecture.md

Stage: **Implement**

---

## Анализ текущего состояния

Секция «Поток данных» содержит **одну** sequence-диаграмму на ~40 строк, пытающуюся показать **4 сценария**:

1. `SKIP` — ранний возврат `{ status: idle }`
2. Cache hit — запись уже есть, `status: success`
3. Cache miss — создание записи, запрос к серверу, `success` / `error`
4. Refresh — инвалидация существующей записи, повторный запрос, `success(newData)` / `success(staleData, lastError)`

Это нарушает правило #6 (common-mistakes.md): *«Each Mermaid diagram should cover ONE scenario or ONE logical flow.»*

### Проблемы текущей диаграммы
- Вложенные `alt` внутри `alt` — тяжело читать
- Refresh визуально «приклеен» к основному потоку через `rect`, хотя это отдельный сценарий
- SKIP и cache hit — тривиальные кейсы, утопающие среди более сложной логики

---

## Решение: разбивка на 3 подсекции

### 1. Основной поток (cache miss) — `### Первый запрос`
- Участники: React → Agent → Resource → CacheEntry → Сервер
- SKIP показан как `opt` (короткий ранний возврат), а не полноценный `alt`
- Cache hit — `Note` под диаграммой, не отдельный сценарий (он слишком прост)
- Основной сценарий: cache miss → pending → queryFn → success / error

### 2. Refresh (инвалидация) — `### Обновление (refresh)`
- Отдельная диаграмма, начинающаяся с `invalidate(args)`
- Два исхода: success(newData) и success(staleData, lastError)
- Ключевое отличие от первого запроса: при ошибке **данные сохраняются**

### 3. Попадание в кеш
- НЕ отдельная диаграмма — слишком прост для sequence diagram
- Показан текстом-примечанием после первой диаграммы

---

## Checklist

- [x] Анализ текущей диаграммы
- [x] Определение split-стратегии
- [x] Редактирование `docs/query/concepts/architecture.md` — секция «Поток данных»
