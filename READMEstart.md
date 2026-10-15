# READMEstart — запуск проекта с нуля (памятка по командам)

Цель: за минимум команд получить работающую CRM. Два пути: **локальная разработка**
и **продакшен на своём сервере**. Облачный вариант (Vercel) — пошагово в README.md.

---
## 0. Что должно быть установлено (один раз)
| Инструмент | Проверка | Где взять |
|---|---|---|
| Node.js 22+ | `node -v` | https://nodejs.org |
| Git | `git -v` | https://git-scm.com |
| PM2 (только прод) | `pm2 -v` | `npm i -g pm2` |
| Supabase CLI (только прод) | `supabase -v` | `npm i -g supabase` |

---
## 1. ЛОКАЛЬНЫЙ ЗАПУСК (разработка / демо)

```bash
# 1. Клонируем репозиторий
git clone <ВАШ_РЕПОЗИТОРИЙ> vzcrm
cd vzcrm

# 2. Ставим зависимости
npm ci            # (или npm install)

# 3. Создаём .env из шаблона
cp .env.example .env
#    вариант А (своё облако Supabase): заполните VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY
#    вариант Б (демо без сервера):    добавьте строку VITE_DEMO_MODE=true

# 4. Стартуем dev-сервер (http://localhost:5173)
npm run dev
```
Остановить: `Ctrl+C`.

Полезное при разработке:
```bash
npm run lint        # проверка ESLint
npm run build       # production-сборка в dist/
npm run preview     # посмотреть собранную сборку локально
npm run build:strict# сборка с предварительной проверкой типов (tsc)
```

---
## 2. ПОДНЯТИЕ SUPABASE-БЭКЕНДА (нужно для обоих вариантов)

```bash
# 1. Аккаунт и проект: https://supabase.com → New project (запомните пароль БД)

# 2. Применяем схему: Dashboard → SQL Editor → New query
#    открываем файл supabase/schema.sql, копируем ВЕСЬ текст, вставляем, Run.

# 3. Edge Functions (терминал):
supabase login
supabase link --project-ref <REF из URL проекта: https://<REF>.supabase.co>
supabase functions deploy public-form
supabase functions deploy create-manager
supabase functions deploy update-manager
supabase functions deploy supplier-service
supabase functions deploy checko
supabase functions deploy monitor-proxy
supabase functions deploy telegram-bot        # опционально

# 4. Секреты функций: Dashboard → Edge Functions → Manage secrets
#    Дополнительно через CLI: supabase secrets set APP_ORIGINS="https://crm.example.com" (CORS-allowlist для create-manager / update-manager)
#    TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, MAX_BOT_TOKEN, MAX_CHAT_ID,
#    RESEND_API_KEY, NOTIFY_EMAIL, NOTIFY_EMAIL_FROM

# 5. Первый админ: Authentication → Add user → Create new user.
#    Проверьте в Table Editor → profiles, что role = admin (иначе поправьте).
```

---
## 3. ПРОДАКШЕН НА СВОЁМ СЕРВЕРЕ (Ubuntu)

```bash
# 1. Система
sudo apt update && sudo apt -y upgrade
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs nginx
sudo npm i -g pm2

# 2. Код
sudo mkdir -p /var/www/crm && sudo chown $USER:$USER /var/www/crm
git clone <ВАШ_РЕПОЗИТОРИЙ> /var/www/crm
cd /var/www/crm
cp .env.example .env && nano .env        # заполнить VITE_SUPABASE_*, PORT=3000,
                                         # SUPABASE_SERVICE_ROLE_KEY, пути логов
# 3. Сборка
npm ci
npm run build

# 4. PM2 (процесс + автозапуск)
pm2 start server/monitor-server.js --name crm
pm2 save
sudo pm2 startup systemd -u $USER --hp $HOME
pm2 status          # статус; pm2 logs crm — логи; pm2 restart crm — перезапуск

# 5. Nginx (прокси на 127.0.0.1:3000) — конфиг в README.md, раздел Вариант Б
sudo ln -s /etc/nginx/sites-available/crm /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 6. HTTPS
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d crm.вашдомен.ru
```

**Обновление продакшена:**
```bash
cd /var/www/crm && git pull && npm ci && npm run build && pm2 restart crm
```

---
## 4. ШПАРГАЛКА ПО КОМАНДАМ

| Задача | Команда |
|---|---|
| Дев-сервер | `npm run dev` |
| Линт | `npm run lint` |
| Сборка | `npm run build` |
| Локальный просмотр сборки | `npm run preview` |
| Проверка типов + сборка | `npm run build:strict` |
| Статус приложения | `pm2 status` |
| Логи приложения | `pm2 logs crm` |
| Перезапуск приложения | `pm2 restart crm` |
| Проверка Nginx | `sudo nginx -t` |
| Перечитать Nginx | `sudo systemctl reload nginx` |
| Статус Nginx | `systemctl status nginx` |
| Проверка порта 3000 | `curl -I http://127.0.0.1:3000` |
| SSL-сертификаты | `sudo certbot certificates` |
| Деплой функции | `supabase functions deploy <имя>` |
| Бэкап БД (CLI) | `supabase db dump -f backup.sql` |

---
## 5. ЧАСТЫЕ ПРОБЛЕМЫ

| Симптом | Решение |
|---|---|
| «Supabase is not configured» | Не заданы `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` → проверь `.env`, пересобери (`npm run build`) и перезапусти |
| Вход не работает, 401 | В Authentication отключён Email-провайдер или неверный пароль; проверь `profiles.role` |
| Файлы базы знаний не грузятся | В SQL Editor выполни `INSERT INTO storage.buckets (id, name, public) VALUES ('knowledge','knowledge', false) ON CONFLICT DO NOTHING;` (в свежей schema.sql это уже есть) |
| 500 при сохранении | `pm2 logs crm` и Dashboard → Logs (Supabase) |
| После git pull белый экран | Жёсткая перезагрузка (Ctrl+F5) — обновился service worker PWA |
