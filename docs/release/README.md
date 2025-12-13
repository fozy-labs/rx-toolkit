# Релиз

Процесс выпуска новой версии RxToolkit.

## Подготовка

1. Убедитесь, что все изменения закоммичены
2. Обновите CHANGELOG (если есть)
3. Проверьте документацию

## Команды релиза

```bash
# 1. Проверка типов
npm run ts-check 

# 2. Сборка проекта
npm run build     

# 3. Обновление версии
npm version patch   # для патч-версии (0.4.18 -> 0.4.19)
npm version minor   # для минорной версии (0.4.18 -> 0.5.0)
npm version major   # для мажорной версии (0.4.18 -> 1.0.0)

# 4. Публикация в npm
npm publish 

# 5. Пуш тегов в репозиторий
git push origin develop --tags
```

## rc

### Выпуск релиза-кандидата (RC)

```bash
# 1. Проверка типов
npm run ts-check

# 2. Сборка проекта
npm run build

# 3. Обновление версии до RC
npm version prerelease --preid=rc
# пример: 1.2.0 → 1.2.0-rc.0

# 4. Публикация RC (НЕ latest!)
npm publish --tag rc

# 5. Пуш тегов
git push origin develop --tags
```

### Переход с RC на stable
```bash
npm version <latest_version>
npm publish
git push origin develop --tags
```
