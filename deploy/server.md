# Сервер демонстрации

- Адрес: `83.147.192.229`
- Каталог: `/opt/manufacturing-demo`
- Compose-проект: `manufacturing-demo`
- Конфигурация: `compose.demo.yaml`
- Серверные настройки: `.env.demo` (права 600, не копировать в репозиторий)
- Публичный вход: nginx, HTTP порт 80
- PostgreSQL и FastAPI доступны только внутри сети Docker проекта
- Данные: том `manufacturing-demo_demo_data`
- Автозапуск контейнеров: `unless-stopped`

После первого успешного CI/CD в каталоге проекта на сервере (текущий образ выбран в `compose.release.json`):

```sh
docker compose --env-file .env.demo -f compose.demo.yaml -f compose.release.json ps
docker compose --env-file .env.demo -f compose.demo.yaml -f compose.release.json logs --tail=100 dashboard
docker compose --env-file .env.demo -f compose.demo.yaml -f compose.release.json up -d --no-build
```

Остановка без удаления данных:

```sh
docker compose --env-file .env.demo -f compose.demo.yaml -f compose.release.json stop
```

Первичная установка использует синтетические данные из SQL-скриптов. Изменения этих скриптов не применяются автоматически к уже созданному тому — для изменения схемы нужна миграция. При обновлении файлов сохраняйте серверный `.env.demo`.

Миграция `db/migrations/05-claims.sql` добавляет таблицу `claims` и пять учебных обращений. Для существующего сервера применяется администратором до публикации версии, читающей `queries/claims.sql`, после создания резервной копии. Скрипт транзакционный и допускает повторный запуск. CI/CD по-прежнему обновляет только приложение; схему и данные не меняет.

Миграция `06-return-scenario.sql` исправляет синтетический заказ №102: переносит существующую отгрузку на 6 сентября, добавляет отгрузку второй позиции и очищает старую причину задержки. Применяется администратором после резервного копирования; повторный запуск не дублирует документы.
