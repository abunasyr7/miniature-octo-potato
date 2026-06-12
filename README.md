# WC2026 → Slack notifier

Уведомления о матчах ЧМ-2026 в Slack:

- 📅 **каждый день в 00:00 по Алматы** — дайджест со всеми матчами этого дня;
- ⚽ **за 10 минут до старта** — соперники и время начала по Алматы (UTC+5);
- 🏁 **после матча** — финальный счёт.

Без внешних зависимостей. Node 18+.

## 1. Получить ключи

1. **football-data.org** — зарегистрируйся на https://www.football-data.org/client/register, получи `X-Auth-Token`. Турнир ЧМ есть на бесплатном тарифе (код соревнования `WC`).
2. **Slack Incoming Webhook** — https://api.slack.com/messaging/webhooks: создай приложение → Incoming Webhooks → Add New Webhook → выбери канал → скопируй URL.

## 2. Настроить окружение

```bash
cp .env.example .env
# впиши FOOTBALL_DATA_TOKEN и SLACK_WEBHOOK_URL
```

## 3. Запуск локально

```bash
node --env-file=.env index.js
```

При первом запуске скрипт «засеивает» состояние (запоминает уже сыгранные/идущие матчи), чтобы не слать историю — уведомления приходят только о будущих матчах.

## Деплой на хостинг

Любой хостинг, где процесс работает постоянно (Railway, Render, fly.io, VPS).

**Railway / Render:**
- Start command: `node index.js`
- Переменные окружения: `FOOTBALL_DATA_TOKEN`, `SLACK_WEBHOOK_URL` (и при желании `POLL_INTERVAL_MINUTES`, `PRE_START_MINUTES`).
- ⚠️ `state.json` пишется на диск. На serverless без постоянного диска состояние сбрасывается при рестарте (возможны повторные уведомления). Для Railway/Render/VPS с постоянным процессом всё ок; для надёжности можно подключить volume или вынести состояние в БД/Redis.

**VPS (systemd / pm2):**

```bash
npm i -g pm2
pm2 start index.js --name wc2026 --node-args="--env-file=.env"
pm2 save
```

## Настройки

| Переменная | По умолчанию | Что делает |
|---|---|---|
| `POLL_INTERVAL_MINUTES` | 5 | как часто опрашивать API |
| `PRE_START_MINUTES` | 10 | за сколько минут до старта слать уведомление |
| `STATE_FILE` | `./state.json` | путь к файлу состояния |
