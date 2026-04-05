# Analyst 2 — api/README.md cross-doc consistency

1. **Имя опции**: api/README `cacheRetentionTime` ≠ architecture.md `cacheLifetime` — нужно унифицировать (проверить исходник и выбрать одно).
2. **machine.md рассинхрон**: старая версия на диске — 5 состояний (`refresh-error`, `refresh()`, `finishAllPatches()`); architecture.md глоссарий описывает 4-переходную модель. Новая machine.md (4 состояния, `invalidate()`, `abortAllPendingPatches()`) совпадает с architecture — после записи старую версию считать невалидной.
3. **Мёртвые ссылки api/README**: `../usage/snapshot.md`, `../usage/broadcast.md` — ещё не созданы (плановые). `../usage/resource.md`, `../usage/command.md` — существуют, OK.
4. **Терминология**: «ресурс», «команда», «снимок», «гидрация» — согласованы между api/README, landing и architecture. Конфликтов нет.
5. **`start(newArgs)`**: появился только в новой machine.md (success→pending, error→pending); api/README и architecture его не упоминают — не конфликт, но при написании usage-доков учесть.
