# Edge Functions — ВСЕМЗАПЧАСТИ CRM

Деплой: `supabase functions deploy <имя>` (public-form и supplier-service — с `--no-verify-jwt`,
остальные — с verify_jwt по умолчанию).

| Функция | Доступ | Назначение | Секреты |
|---|---|---|---|
| public-form | публичная (`--no-verify-jwt`) | Приём заявок с сайта: создание lead + buyer/supplier + тикет + набор МК. Rate limit 5/10мин/IP + honeypot | TELEGRAM_*, MAX_*, RESEND_* |
| supplier-service | публичная (`--no-verify-jwt`) | Самообслуживание поставщика по PIN (5 попыток/15 мин) | — |
| create-manager | JWT + admin (внутри функции) | Создание менеджера (Supabase Auth) | APP_ORIGINS |
| update-manager | JWT + admin (внутри функции) | Бан/разбан, смена email/пароля менеджера | APP_ORIGINS |
| checko | JWT не требуется | Прокси api.checko.ru по ИНН; ключ — секрет CHECKO_API_KEY | CHECKO_API_KEY |
| monitor-proxy | JWT + admin | Мост к server/monitor-server.js для раздела «Сервер» (вариант Б) | — |
| telegram-bot | — | Уведомления о заявках с формы | TELEGRAM_BOT_TOKEN |

CORS: у create-manager/update-manager — allowlist из секрета `APP_ORIGINS`
(origin'ы через запятую). У public-form/checko/supplier-service wildcard
намеренный — они встраиваются/вызываются с внешних страниц.
