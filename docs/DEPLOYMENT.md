# GitHub + Railway

GitHub хранит исходники с текущей историей и запускает CI. Railway собирает существующий Dockerfile, запускает Node-сервис и предоставляет HTTPS-домен. Для SQLite нужен постоянный volume; одного ephemeral filesystem недостаточно. Подготовка в репозитории выполнена; сам внешний сервис ещё не создан без подключения аккаунтов.

GitHub Pages не выполняет backend-код: [документация GitHub](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site). Разделять только ради Pages frontend и API здесь не требуется.

## Репозиторий GitHub

Создать пустой репозиторий `ryadom-voice-planner`, затем отправить существующую ветку `main` с историей. Авторизация — через GitHub CLI, SSH или интеграцию GitHub; токены не должны попадать в URL remote, исходники или коммиты.

```bash
# Вместо YOUR_ACCOUNT указать владельца созданного репозитория.
git remote add github git@github.com:YOUR_ACCOUNT/ryadom-voice-planner.git
git push -u github main
```

Текущий `origin` сохранён; команда добавляет отдельный remote. Если remote `github` уже существует, проверить его адрес, прежде чем менять. Новый GitHub-репозиторий не должен содержать отдельно созданные README или начальную историю, чтобы push сохранил существующие коммиты без конфликтов.

## Railway

1. Создать проект из GitHub-репозитория, выбрать ветку `main`. Сборка использует Dockerfile и `railway.json` автоматически. В настройках сервиса оставить одну реплику: SQLite хранится на одном volume.
2. Добавить persistent volume с mount path **`/app/.local`**. Его содержимое должно сохраняться при redeploy. Операцию создания volume нельзя заменить одной записью в `railway.json`.
3. Установить переменные сервиса:

   | Переменная | Значение |
   | --- | --- |
   | `HOST` | `0.0.0.0` |
   | `DATABASE_PATH` | `/app/.local/ryadom.sqlite` |
   | `RAILWAY_RUN_UID` | `0`, требование прав на root-owned volume для текущего Docker-образа |
   | `LLM_SEARCH` | `false` |

   `SKIP_BUILD=1`, `NODE_ENV=production` уже заданы в образе. Railway может назначать `PORT`; сервер и Docker healthcheck используют его. `RAILWAY_RUN_UID=0` — настройка только облачного сервиса, локальный Compose по-прежнему работает от пользователя `node`. Для запуска в Railway от непривилегированного пользователя потребуется заранее обеспечить права записи UID 1000 на volume.

4. В Networking создать публичный Railway domain. Приложение использует `RAILWAY_PUBLIC_DOMAIN` как внешний HTTPS-origin. Для собственного домена задать `PUBLIC_BASE_URL=https://your-domain.example` без пути. После смены домена повторить deploy.
5. При необходимости настроить `LLM_BASE_URL`, `LLM_MODEL`, секрет `LLM_API_KEY`. Без них работает локальный режим. Секреты хранятся в Railway Variables, а не в GitHub-репозитории.
6. Запустить deploy и дождаться проверки `/health`. При первом открытии в браузере создаётся отдельное пространство и импортируются исходные 1 000 записей. Сервис запускает миграции при старте, когда volume уже смонтирован; отдельный pre-deploy для SQLite не нужен.

Railway оплачивается по условиям аккаунта и использованным ресурсам; наличие trial не означает постоянный бесплатный хостинг. Перед запуском следует проверить тариф и лимиты аккаунта. Эта инструкция не включает покупку плана.

## Проверка после публикации

```bash
curl --fail https://YOUR_GENERATED_DOMAIN/health
```

Ожидается `{"status":"ok","version":"1.0.0"}`. Затем проверить создание задачи, уточнение времени встречи, поиск по договору и перезагрузку страницы. После redeploy убедиться, что запись и история диалога сохранились — это проверяет подключение volume. В DevTools cookie `ryadom_session` на HTTPS должна иметь `HttpOnly`, `Secure`, `SameSite=Lax`; отправка текста с того же домена не должна получать 403.

При переезде старая база не переносится автоматически: локальная SQLite, D1 в Sites и Railway volume — отдельные хранилища. Исходный CSV загрузится на новом месте; пользовательские записи из прежнего хранилища требуют отдельного переноса. Старый Site в рамках подготовки не удалялся.

## Другие хостинги

Тот же Docker-образ можно разместить на VPS с HTTPS reverse proxy и постоянным томом. Задать `PUBLIC_BASE_URL` внешнему HTTPS-origin; заголовки `X-Forwarded-*` от произвольного клиента приложение не использует. Для Cloudflare Workers напрямую серверный ESM уже подходит, но потребуются отдельные аккаунт, D1 binding и применение миграций. Прямой Workers-деплой в этой инструкции не создаётся.

## Документация провайдера

- [Railway: конфигурация в репозитории](https://docs.railway.com/config-as-code/reference)
- [Railway: persistent volumes и права](https://docs.railway.com/volumes)
- [Railway: публичные домены](https://docs.railway.com/networking/public-networking)
- [Railway: healthchecks](https://docs.railway.com/deployments/healthchecks)
