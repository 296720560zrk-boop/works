/* ==========================================================
   额度账本
   ---------------------------------------------------------
   贴图跟随是 0 点；只有「AI 重生一只」才计费（5 点 / 次）。
   这个文件只管记账，不碰界面。
   ========================================================== */

const KEY = 'songjin.ledger.v1';

export const COST_PER_GEN = 5;     // Xmax 一次 5 点
export const DEFAULT_LIMIT = 20;   // 每天最多生成几次
export const WARN_BALANCE = 500;   // 余额低于这个数就标红

const pad = n => String(n).padStart(2, '0');

export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function blank() {
  return {
    balance: null,          // 未知就先空着，别编一个数字骗人
    limit: DEFAULT_LIMIT,
    days: {},
    sessions: [],
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return blank();
    if (!o.days) o.days = {};
    if (!o.sessions) o.sessions = [];
    if (typeof o.limit !== 'number') o.limit = DEFAULT_LIMIT;
    return o;
  } catch (e) {
    return blank();
  }
}

let db = load();
let sessionStart = Date.now();

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* 无痕模式会失败 */ }
}

function todayRec() {
  const k = dayKey();
  if (!db.days[k]) db.days[k] = { gen: 0, pts: 0, secs: 0 };
  return db.days[k];
}

/* 这一节的时长：从进入算到现在，再叠上历史 */
export function sessionSeconds() {
  return Math.round((Date.now() - sessionStart) / 1000);
}

export function stats() {
  const t = todayRec();
  return {
    gen: t.gen,
    limit: db.limit,
    pts: t.pts,
    secs: t.secs + sessionSeconds(),
    balance: db.balance,
    warn: db.balance !== null && db.balance <= WARN_BALANCE,
    left: Math.max(0, db.limit - t.gen),
  };
}

export function canGen() {
  return todayRec().gen < db.limit;
}

/* 记一次生成。返回 true 表示记上了；false 表示超限、没让生成。 */
export function addGen(n = 1) {
  const t = todayRec();
  if (t.gen + n > db.limit) return false;
  t.gen += n;
  t.pts += COST_PER_GEN * n;
  if (db.balance !== null) db.balance = Math.max(0, db.balance - COST_PER_GEN * n);
  save();
  return true;
}

/* 校准余额（老师从后台看到的数字填进来） */
export function setBalance(v) {
  db.balance = Math.max(0, Math.round(v));
  save();
}

export function setLimit(v) {
  db.limit = Math.max(1, Math.round(v));
  save();
}

/* 退出时把这一节的时长并进当天 */
export function flushSession() {
  const s = sessionSeconds();
  if (s < 5) return;
  todayRec().secs += s;
  db.sessions.push({ at: new Date().toISOString(), secs: s });
  if (db.sessions.length > 200) db.sessions = db.sessions.slice(-200);
  sessionStart = Date.now();
  save();
}

export function fmtTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/* 导出成 CSV：一学期用了多少次、多少点、多长时间，一眼能看出来 */
export function exportCsv() {
  flushSession();
  const rows = [['日期', '生成次数', '消耗点数', '使用时长(秒)']];
  Object.keys(db.days).sort().forEach(k => {
    const d = db.days[k];
    rows.push([k, d.gen, d.pts, d.secs]);
  });
  const csv = '\ufeff' + rows.map(r => r.join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `宋锦入画-用量-${dayKey()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

window.addEventListener('beforeunload', flushSession);
