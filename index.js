// ЧМ-2026 → Slack: уведомления о старте матчей (время по Алматы) и о результатах.
// Без внешних зависимостей. Node 18+ (нужен глобальный fetch).

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

// ---------- Конфиг из переменных окружения ----------
const FOOTBALL_TOKEN = process.env.FOOTBALL_DATA_TOKEN;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const POLL_MINUTES = Number(process.env.POLL_INTERVAL_MINUTES || 5);
const PRE_START_MINUTES = Number(process.env.PRE_START_MINUTES || 10);
const STATE_FILE = process.env.STATE_FILE || new URL("./state.json", import.meta.url).pathname;

// Код турнира во football-data.org: WC = FIFA World Cup
const MATCHES_URL = "https://api.football-data.org/v4/competitions/WC/matches";
const TZ = "Asia/Almaty"; // UTC+5

if (!FOOTBALL_TOKEN || !SLACK_WEBHOOK_URL) {
  console.error("Нужны переменные окружения FOOTBALL_DATA_TOKEN и SLACK_WEBHOOK_URL");
  process.exit(1);
}

// ---------- Состояние (что уже отправляли) ----------
const DEFAULT_STATE = { notifiedStart: [], notifiedResult: [], seeded: false, lastDigestDate: null };

async function loadState() {
  if (!existsSync(STATE_FILE)) return { ...DEFAULT_STATE };
  try {
    return { ...DEFAULT_STATE, ...JSON.parse(await readFile(STATE_FILE, "utf8")) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

async function saveState(state) {
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

// ---------- Форматирование ----------
function formatAlmaty(isoDate) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoDate));
}

// Названия сборных на русском (ключи — как их отдаёт football-data)
const TEAMS_RU = {
  Algeria: "Алжир",
  Argentina: "Аргентина",
  Australia: "Австралия",
  Austria: "Австрия",
  Belgium: "Бельгия",
  "Bosnia-Herzegovina": "Босния и Герцеговина",
  Brazil: "Бразилия",
  Canada: "Канада",
  "Cape Verde Islands": "Кабо-Верде",
  Colombia: "Колумбия",
  "Congo DR": "ДР Конго",
  Croatia: "Хорватия",
  "Curaçao": "Кюрасао",
  Czechia: "Чехия",
  Ecuador: "Эквадор",
  Egypt: "Египет",
  England: "Англия",
  France: "Франция",
  Germany: "Германия",
  Ghana: "Гана",
  Haiti: "Гаити",
  Iran: "Иран",
  Iraq: "Ирак",
  "Ivory Coast": "Кот-д’Ивуар",
  Japan: "Япония",
  Jordan: "Иордания",
  Mexico: "Мексика",
  Morocco: "Марокко",
  Netherlands: "Нидерланды",
  "New Zealand": "Новая Зеландия",
  Norway: "Норвегия",
  Panama: "Панама",
  Paraguay: "Парагвай",
  Portugal: "Португалия",
  Qatar: "Катар",
  "Saudi Arabia": "Саудовская Аравия",
  Scotland: "Шотландия",
  Senegal: "Сенегал",
  "South Africa": "ЮАР",
  "South Korea": "Южная Корея",
  Spain: "Испания",
  Sweden: "Швеция",
  Switzerland: "Швейцария",
  Tunisia: "Тунис",
  Turkey: "Турция",
  "United States": "США",
  Uruguay: "Уругвай",
  Uzbekistan: "Узбекистан",
};

function teamName(team) {
  const en = team?.name || team?.shortName || team?.tla;
  if (!en) return "TBD";
  return TEAMS_RU[en] || en; // незнакомые (плей-офф placeholder'ы) остаются как есть
}

// Дата матча в зоне Алматы как "YYYY-MM-DD" — для группировки по дням
function almatyDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// Перевод ключа даты "YYYY-MM-DD" в человекочитаемый "DD-MM-YYYY"
function humanDate(key) {
  const [y, m, d] = key.split("-");
  return `${d}-${m}-${y}`;
}

// Только время "ЧЧ:ММ" по Алматы
function almatyTime(isoDate) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoDate));
}

// Дайджест: все матчи указанного дня (по Алматы)
async function sendDailyDigest(matches, dateStr) {
  const todays = matches
    .filter((m) => almatyDate(new Date(m.utcDate)) === dateStr)
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  const human = humanDate(dateStr);
  if (todays.length === 0) {
    await sendSlack(`📅 *Матчи ЧМ-2026 на сегодня (${human})*\nСегодня матчей нет.`);
    return;
  }

  const lines = todays.map(
    (m) => `🕐 ${almatyTime(m.utcDate)} — ${teamName(m.homeTeam)} 🆚 ${teamName(m.awayTeam)}`
  );
  await sendSlack(
    `📅 *Матчи ЧМ-2026 на сегодня (${human}, Алматы)* — всего ${todays.length}\n${lines.join("\n")}`
  );
}

// ---------- Slack ----------
async function sendSlack(text) {
  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    console.error(`Slack ответил ${res.status}: ${await res.text().catch(() => "")}`);
  }
}

// ---------- Данные о матчах ----------
async function fetchMatches() {
  const res = await fetch(MATCHES_URL, { headers: { "X-Auth-Token": FOOTBALL_TOKEN } });
  if (!res.ok) {
    throw new Error(`football-data ответил ${res.status}: ${await res.text().catch(() => "")}`);
  }
  const data = await res.json();
  return data.matches || [];
}

// Стартовое уведомление при каждом запуске/редеплое: версия + матчи на завтра
async function sendStartupNotice(matches) {
  const sha = (process.env.RAILWAY_GIT_COMMIT_SHA || "").slice(0, 7);
  const commitMsg = (process.env.RAILWAY_GIT_COMMIT_MESSAGE || "").split("\n")[0];
  const version = sha
    ? `\`${sha}\`${commitMsg ? ` — ${commitMsg}` : ""}`
    : "локальный запуск";

  const tomorrow = almatyDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const list = matches
    .filter((m) => almatyDate(new Date(m.utcDate)) === tomorrow)
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  const body = list.length
    ? list
        .map((m) => `🕐 ${almatyTime(m.utcDate)} — ${teamName(m.homeTeam)} 🆚 ${teamName(m.awayTeam)}`)
        .join("\n")
    : "Матчей нет.";

  await sendSlack(
    `🔄 *Бот перезапущен — новая версия*\n` +
      `Версия: ${version}\n\n` +
      `📅 *Матчи на завтра (${humanDate(tomorrow)}, Алматы):*\n${body}`
  );
}

// ---------- Основной проход ----------
async function check() {
  const state = await loadState();
  const matches = await fetchMatches();
  const now = Date.now();
  const preStartMs = PRE_START_MINUTES * 60 * 1000;

  // Первый запуск: помечаем уже идущие/сыгранные матчи как «обработанные»,
  // чтобы не завалить Slack историей. Уведомляем только о будущем.
  if (!state.seeded) {
    for (const m of matches) {
      const kickoff = new Date(m.utcDate).getTime();
      if (m.status === "FINISHED") state.notifiedResult.push(m.id);
      if (kickoff <= now + preStartMs) state.notifiedStart.push(m.id);
    }
    state.seeded = true;
    // Сразу шлём дайджест на сегодня и фиксируем дату, чтобы не дублировать
    const today = almatyDate();
    await sendDailyDigest(matches, today);
    state.lastDigestDate = today;
    await saveState(state);
    console.log(`[${new Date().toISOString()}] Инициализация: ${matches.length} матчей, отправлен дайджест на ${today}.`);
    return;
  }

  let changed = false;

  // Ежедневный дайджест в 00:00 по Алматы (срабатывает при первом опросе нового дня)
  const today = almatyDate();
  if (state.lastDigestDate !== today) {
    await sendDailyDigest(matches, today);
    state.lastDigestDate = today;
    changed = true;
  }

  for (const m of matches) {
    const home = teamName(m.homeTeam);
    const away = teamName(m.awayTeam);
    const kickoff = new Date(m.utcDate).getTime();

    // 1) Скоро старт
    const startWindowOpen = now >= kickoff - preStartMs && now <= kickoff + 30 * 60 * 1000;
    if (startWindowOpen && !state.notifiedStart.includes(m.id)) {
      await sendSlack(
        `⚽ *Скоро матч ЧМ-2026*\n${home} 🆚 ${away}\n🕐 Начало: ${formatAlmaty(m.utcDate)} (Алматы)`
      );
      state.notifiedStart.push(m.id);
      changed = true;
    }

    // 2) Финальный счёт
    if (m.status === "FINISHED" && !state.notifiedResult.includes(m.id)) {
      const hs = m.score?.fullTime?.home ?? "-";
      const as = m.score?.fullTime?.away ?? "-";
      await sendSlack(
        `🏁 *Матч завершён — ЧМ-2026*\n${home} *${hs} : ${as}* ${away}`
      );
      state.notifiedResult.push(m.id);
      changed = true;
    }
  }

  if (changed) await saveState(state);
  console.log(`[${new Date().toISOString()}] Проверено матчей: ${matches.length}`);
}

// ---------- Цикл ----------
async function loop() {
  try {
    await check();
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Ошибка проверки:`, err.message);
  }
}

console.log(`WC2026 → Slack запущен. Опрос каждые ${POLL_MINUTES} мин, предупреждение за ${PRE_START_MINUTES} мин до старта.`);

// При каждом запуске/редеплое: сообщить о новой версии и показать матчи на завтра
try {
  const matches = await fetchMatches();
  await sendStartupNotice(matches);
} catch (err) {
  console.error(`[${new Date().toISOString()}] Не удалось отправить стартовое уведомление:`, err.message);
}

loop();
setInterval(loop, POLL_MINUTES * 60 * 1000);
