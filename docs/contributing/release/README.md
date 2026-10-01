# Релиз

Процесс выпуска новой версии RxToolkit. Релиз выпускается с ветки `main` и публикуется в npm вручную.

## Подготовка

1. Проверьте документацию
2. Перенесите записи из `[Unreleased]` в CHANGELOG в раздел новой версии
3. Закоммитьте все изменения: `pnpm version` не работает с грязным рабочим деревом

## Команды релиза

```bash
# 1. Проверки: типы, тесты, линтер, форматирование
pnpm run check:all

# 2. Сборка проекта
pnpm run build

# 3. Обновление версии: коммит и тег v<версия>
pnpm version patch --message "chore(release): v%s"   # 0.4.18 -> 0.4.19
pnpm version minor --message "chore(release): v%s"   # 0.4.18 -> 0.5.0
pnpm version major --message "chore(release): v%s"   # 0.4.18 -> 1.0.0

# 4. Публикация в npm
pnpm publish

# 5. Пуш коммита и тегов
git push origin main --tags
```

## rc

### Выпуск релиза-кандидата (RC)

```bash
# 1. Проверки
pnpm run check:all

# 2. Сборка проекта
pnpm run build

# 3. Обновление версии до RC
pnpm version preminor --preid=rc --message "chore(release): v%s"     # первый RC: 1.2.3 -> 1.3.0-rc.0 (или prepatch / premajor)
pnpm version prerelease --preid=rc --message "chore(release): v%s"   # следующий RC: 1.3.0-rc.0 -> 1.3.0-rc.1

# 4. Публикация под тегом rc, чтобы RC не стал latest
pnpm publish --tag rc

# 5. Пуш коммита и тегов
git push origin main --tags
```

### Переход с RC на stable

```bash
pnpm run check:all
pnpm run build
pnpm version <версия> --message "chore(release): v%s"   # 1.3.0-rc.1 -> 1.3.0
pnpm publish
git push origin main --tags
```
