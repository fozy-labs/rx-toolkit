---
stage: 01-research
status: Draft
---

# cache.md — resource-only bias audit

Source: `docs/query/concepts/cache.md`

## Findings (line → fix)

1. **L3** `Каждый ресурс владеет собственной картой кеша (CacheMap), где записи индексируются по ключу, вычисленному из аргументов запроса.`
   → "Каждый ресурс или команда владеет собственной картой кеша…". Split key explanation: resources — serialized args, commands — explicit `key` parameter.

2. **L25** `Повторное обращение к тем же аргументам в фазе retention возвращает существующую запись`
   → "Повторное обращение с тем же ключом кеша…" (generic wording; args for resources, explicit key for commands).

3. **§ Ключ кеша (L27-29)** Entire section describes only `serializeArgs`/`stableStringify` path.
   → Add second paragraph: commands use an explicit `key` parameter passed to `execute()`; no serialization involved. Mention that `serializeArgs` override applies only to resources.

4. **L29** `Функцию сериализации можно переопределить на уровне API или отдельного ресурса.`
   → "…на уровне API или отдельного ресурса. Команды не используют `serializeArgs` — ключ передаётся явно."

5. **§ Время жизни записи — table (L33-37)** Default shown as `60_000` only.
   → Add row or note: "Для команд значение по умолчанию — `0` (запись удаляется сразу после отписки последнего подписчика)."

6. **L39** `Задаётся на уровне API и может быть переопределён для конкретного ресурса.`
   → "…для конкретного ресурса или команды." Add link `[api-cmd]`.

7. **§ Связь с другими компонентами (L41-47)** No mention of commands at all.
   → No content change strictly needed (statements are generic), but add a bullet: "Команды разделяют ту же инфраструктуру кеша; отличия в ключе и дефолтном `cacheRetentionTime` описаны выше."

8. **Link refs (L49-55)** Only `[api-res]` exists, no `[api-cmd]`.
   → Add `[api-cmd]: ../api/command.md`.

## Summary

- 6 explicit resource-only phrases need broadening.
- Cache key section needs a dual explanation (serializeArgs vs explicit key).
- Default `cacheRetentionTime` table must show both defaults (60 s for resources, 0 for commands).
