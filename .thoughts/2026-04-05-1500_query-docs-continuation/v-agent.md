# Verification: agent.md

## Result: PASS with 2 minor fixes

### Rules checklist
1. README≠Arch — N/A ✅
2. Reference-style links — ✅ все ссылки `[text][ref]`, определения внизу, все 6 определены
3. No duplication — ✅ статусы кратко, флаги делегированы в usage-res/usage-cmd
4. No desc+diagram overlap — ✅ текст и диаграмма покрывают разные аспекты
5–8. Process rules — N/A
9. Natural SKIP — ✅ «Специальный символ `SKIP`» — естественная формулировка
10. Concepts can have flows — ✅
11. No code-only additions — ✅
12. Both Resource & Command — ✅ упомянуты оба в intro, статусах и ссылках; диаграмма — Resource-only, но это cache-miss flow, уместно

### Fixes needed
1. **Подпись диаграммы** — `> Cache hit:` → `> **Попадание в кеш (cache hit):** если запись уже существует…` (русский язык + bold, как в оригинале moved-flow-diagrams.md)
2. **Ссылка в подписи** — `агент возвращает` → `[агент][agent]` (пропущена ref-ссылка на самого себя, нужно определение `[agent]: agent.md` или убрать ссылку, т.к. мы уже в agent.md — лучше просто «агент» строчными без ссылки, но восстановить русскую формулировку)
