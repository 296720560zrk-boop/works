/* ==========================================================
   宋锦小灵兽 · 纹样小兽
   摄像头 + 姿态锚点 + 合成贴片
   ---------------------------------------------------------
   第一版：所有小兽落在「头顶」这一个锚点上。
   目标是把「贴上去」做成「长在身上」——
   靠四件事：位置跟随、弹簧迟滞、接触阴影、色温匹配。
   ========================================================== */

import { FilesetResolver, HandLandmarker, ImageSegmenter } from './vendor/vision_bundle.mjs';
import { stats, fmtTime, exportCsv } from './ledger.js';
import { sfxCloud, sfxChime, sfxHop, sfxWhooshOut, sfxSelect, unlockAudio, setMuted, isMuted } from './sfx.js';

/* ---------------- 十只小兽 ---------------- */

const BEASTS = [
  { id: 'guibei',    name: '龟背纹', img: 'assets/01_guibei_turtle.webp',      w: 0.74, y: 0.01, ao: 0.46, bp: 0.85, at: 'right', light: false,
    lore: '小乌龟背上有个六边形的壳。龟背纹是祝大家健健康康、活到一百岁。' },
  { id: 'yunwen',    name: '云纹',   img: 'assets/02_yunwen_cloud.webp',       w: 0.94, y: -0.02, ao: 0.30, bp: 0.5, at: 'chest', light: true,
    lore: '云朵软软地飘在天上。云纹是祝好运像云一样，飘到你身边。' },
  { id: 'pantao',    name: '盘绦纹', img: 'assets/03_pantao_snake.webp',       w: 0.66, y: -0.04, ao: 0.40, bp: 0.8, at: 'right', light: false,
    lore: '小蛇盘成一个圆圆的结。盘绦纹是祝一家人团团圆圆，永远不分开。' },
  { id: 'qiulu',     name: '球路纹', img: 'assets/04_qiulu_ball.webp',         w: 0.50, y: -0.03, ao: 0.42, bp: 0.75, at: 'left', light: true,
    lore: '好多小圆球排成一排，滚来滚去。球路纹是祝好运一个接一个，滚滚来。' },
  { id: 'badayun',   name: '八达晕', img: 'assets/05_badayun_octopus.webp',    w: 0.72, y: -0.03, ao: 0.44, bp: 0.8, at: 'left', light: false,
    lore: '花纹往中间晕开，像太阳发光。八达晕是祝四面八方的好事都来找你。' },
  { id: 'qushui',    name: '曲水纹', img: 'assets/06_qushui_fish.webp',        w: 0.68, y: -0.05, ao: 0.34, bp: 0.7, at: 'chest', light: false,
    lore: '水波弯弯绕绕地流。曲水纹是祝福气像水一样，一直流、一直有。' },
  { id: 'wanzhi',    name: '万字纹', img: 'assets/07_wanzhi_pinwheel.webp',    w: 0.70, y: -0.04, ao: 0.40, bp: 0.55, at: 'right', light: false,
    lore: '一个"卍"字转个不停，像小风车。万字纹是祝福气转不停、好运不断。' },
  { id: 'suozi',     name: '锁子纹', img: 'assets/08_suozi_crab.webp',         w: 0.68, y: -0.02, ao: 0.44, bp: 0.85, at: 'left', light: false,
    lore: '一个个小环扣在一起，像小锁链。锁子纹是祝平安锁得牢牢的。' },
  { id: 'fangsheng', name: '方胜纹', img: 'assets/09_fangsheng_dragonfly.webp', w: 0.84, y: -0.12, ao: 0.32, bp: 0.55, at: 'right', light: true,
    lore: '两个小菱形叠在一起，像手拉手。方胜纹是祝两颗心永远在一起。' },
  { id: 'chanzhi',   name: '缠枝纹', img: 'assets/10_chanzhi_bee.webp',        w: 0.62, y: -0.03, ao: 0.40, bp: 0.6, at: 'left', light: true,
    lore: '花枝绕着藤蔓往上长。缠枝纹是祝像小花一样，天天向上、越长越棒。' },
];
BEASTS.forEach(b => {
  b.ready = false; b.imgEl = null;
  // 浮雕光影图与主图同尺寸，运行时按同一套 ox/oy/dw/dh 叠上去
  b.bumpEl = new Image();
  b.bumpEl.src = b.img.replace(/^assets\//, 'assets/bump/').replace(/\.webp$/, '_bump.png');
  // 寓意童声：文件名 = id.mp3（如 guibei → 01_guibei.mp3）
  b.audio = 'assets/audio/' + b.img.match(/assets\/(\d+)_/)[1] + '_' + b.id + '.mp3';
});

/* ---------------- DOM ---------------- */

const $ = id => document.getElementById(id);
const loom = $('loom');
const heart = $('heart');
const video = $('cam');
const canvas = $('fx');
const ctx = canvas.getContext('2d');
const railL = $('railL');          // 底部那条横向滑轨
const tray = $('tray');
const hint = $('hint');
const hintP = hint.querySelector('p');
const hintSub = hint.querySelector('.hint-sub');
const toastEl = $('toast');
const loreEl = $('lore');
const loreNameEl = $('loreName');
const loreTextEl = $('loreText');
const loreReplayEl = $('loreReplay');
const veil = $('veil');
const veilNote = $('veilNote');
const btnStart = $('btnStart');

/* ---------------- 状态 ---------------- */

const view = { w: 1, h: 1, dpr: 1 };

const state = {
  running: false,
  hasPerson: false,
  pose: null,          // 当前归一化关键点
  smooth: null,        // EMA 平滑后的关键点
  active: null,        // 当前召唤的小兽
  enter: 1,            // 0→1 飞入进度
  enterFrom: null,     // 飞入起点（画心内像素坐标）
  lastAnchor: null,    // 最后一次有效锚点（像素）
  palm: null,          // 掌心：{ x, y, w(掌宽), roll(朝向), ok }
  magic: null,         // 云纹出场：{ t, on }
  headW: 120,
  tilt: 0,             // 身体倾斜（弧度）
  tint: { r: 0, g: 0, b: 0, a: 0, bright: 1 },
};

/* 弹簧：位置、缩放各自一条 */
class Spring {
  constructor(v, k, damp) { this.value = v; this.target = v; this.v = 0; this.k = k; this.damp = damp; }
  update(dt) {
    const a = (this.target - this.value) * this.k - this.v * this.damp;
    this.v += a * dt;
    this.value += this.v * dt;
  }
  snap(v) { this.value = v; this.target = v; this.v = 0; }
}

/* 显式欧拉在小步长下才稳。外面给的是真实 dt（可能到 0.25），
   这里切成 ~60Hz 的子步，既准又不会算飞。 */
function stepSpring(s, dt) {
  const n = Math.min(12, Math.max(1, Math.ceil(dt / 0.0167)));
  const h = dt / n;
  for (let i = 0; i < n; i++) s.update(h);
}

const spring = {
  // 130/17 太硬，几乎等于刚性跟随 —— 刚性就是"轻"。
  // 105/13.5 跟得更慢一点，手停住时会回弹两下。
  x: new Spring(0, 105, 13.5),
  y: new Spring(0, 105, 13.5),
  s: new Spring(1, 78, 10.5),   // 出场撑开用：ζ≈0.59，过冲约 9%，0.7s 收住
  r: new Spring(0, 110, 15),
  a: new Spring(0, 62, 13),     // 透明度：出场渐显要慢，太快就变成啪地一下
  /* 落定下沉：落下来那一下往下压、再弹回去。
     硬一点（k 大）才有"磕"的手感，太软就成了果冻。 */
  dip: new Spring(0, 190, 15),
};

/* ---------------- 工具 ---------------- */

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - Math.pow(1 - t, 3);

let toastTimer = 0;
function toast(msg, ms = 1600) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

/* 纹样寓意说明：小灵兽出来后，底部浮现一句给小朋友听的话。
   等兽现形（云散开、撑出来）再露出来，几秒后自动淡去。
   寓意语音用提前生成好的童声 mp3（云夏可爱男声），点「听一听」播放。 */
let loreTimer = null;
let loreAudio = null;      // 当前寓意音频
let lorePlaying = false;   // 是否正在播

function setReplayLabel() {
  /* 印章里放不下图标：只留两个字，播的时候换成「暂停」 */
  loreReplayEl.textContent = lorePlaying ? '暂停' : '听一听';
}

function playLore(beast) {
  /* 播对应小兽的童声 mp3。先停掉上一次，免得叠着念。 */
  try {
    if (loreAudio) { loreAudio.pause(); loreAudio = null; }
    if (!beast || !beast.audio) return;
    const a = new Audio(beast.audio);
    a.addEventListener('ended', () => {
      lorePlaying = false;
      setReplayLabel();
    });
    a.play().catch(() => { /* 未解锁时静默忽略 */ });
    loreAudio = a;
    lorePlaying = true;
    setReplayLabel();
  } catch (e) { /* 音频加载失败也不影响文字 */ }
}

function pauseLore() {
  try {
    if (loreAudio) { loreAudio.pause(); }
    lorePlaying = false;
    setReplayLabel();
  } catch (e) { /* 忽略 */ }
}

function showLore(beast) {
  if (!beast || !beast.lore) { hideLore(); return; }
  loreNameEl.textContent = beast.name;
  loreTextEl.textContent = beast.lore;
  loreEl.hidden = false;
  // 先清掉上一次的显示态，强制重触发渐入动画
  loreEl.classList.remove('show');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => loreEl.classList.add('show'));
  });
  /* 不自动念语音 —— 小兽现形时的"云声/磬声"是主角，
     需要听的时候点「听一听」按钮才播童声 mp3。 */
  clearTimeout(loreTimer);
  loreTimer = setTimeout(hideLore, 10000);   // 10 秒后淡去
}
function hideLore() {
  loreEl.classList.remove('show');
  clearTimeout(loreTimer);
  lorePlaying = false;
  setReplayLabel();
  try { if (loreAudio) { loreAudio.pause(); loreAudio = null; } } catch (e) { /* 忽略 */ }
}

/* 「听一听 / 暂停」：播或停当前小兽的童声。点一下播、再点一下暂停。 */
loreReplayEl.addEventListener('click', () => {
  if (!state.active || !state.active.audio) return;
  if (lorePlaying) {
    pauseLore();
  } else {
    playLore(state.active);
  }
  clearTimeout(loreTimer);
  loreTimer = setTimeout(hideLore, 10000);
});

/* 归一化坐标 → 画心像素（处理 cover 裁切 + 水平镜像） */
function mapPt(nx, ny) {
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  const s = Math.max(view.w / vw, view.h / vh);
  const dw = vw * s, dh = vh * s;
  const ox = (view.w - dw) / 2, oy = (view.h - dh) / 2;
  return {
    x: ox + (1 - nx) * dw,
    y: oy + ny * dh,
    dw, dh,
  };
}

/* ---------------- 画布尺寸 ---------------- */

function resize() {
  const r = heart.getBoundingClientRect();
  view.w = Math.max(1, r.width);
  view.h = Math.max(1, r.height);
  view.dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = Math.round(view.w * view.dpr);
  canvas.height = Math.round(view.h * view.dpr);
  canvas.style.width = view.w + 'px';
  canvas.style.height = view.h + 'px';
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);

  // 首帧把弹簧放到合理位置，避免从 0,0 飞进来
  if (!state.lastAnchor) spring.x.snap(view.w / 2), spring.y.snap(view.h * 0.3);
}

new ResizeObserver(resize).observe(heart);
window.addEventListener('orientationchange', () => setTimeout(resize, 260));

/* ---------------- 卡片 ---------------- */

function buildCards() {
  BEASTS.forEach((b) => {
    const card = document.createElement('button');
    card.className = 'card';
    card.type = 'button';
    card.dataset.id = b.id;
    card.innerHTML =
      `<span class="pic"><img src="${b.img}" alt="" draggable="false"></span>` +
      `<span class="nm">${b.name}</span>`;
    card.addEventListener('click', () => {
      if (stripDragged) return;        // 刚才是在拖动，不算点击
      pick(b, card);
    });
    railL.appendChild(card);
    b.card = card;

    const img = card.querySelector('img');
    const mark = () => { b.imgEl = img; b.ready = true; };
    if (img.complete && img.naturalWidth) mark();
    else img.addEventListener('load', mark, { once: true });
  });
  buildStripDrag();
}

/* 滑轨：拖动时按住就能横着滑，松手不触发点击 */
let stripDragged = false;

function buildStripDrag() {
  let down = false, moved = false, startX = 0, startLeft = 0, pid = null;

  railL.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') return;      // 触屏交给原生滚动
    down = true; moved = false; pid = e.pointerId;
    startX = e.clientX; startLeft = railL.scrollLeft;
    stripDragged = false;
  });
  railL.addEventListener('pointermove', e => {
    if (!down) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 6 && !moved) {
      moved = true;
      railL.classList.add('dragging');
      try { railL.setPointerCapture(pid); } catch (err) { /* 忽略 */ }
    }
    if (moved) {
      railL.scrollLeft = startLeft - dx;
      e.preventDefault();
    }
  });
  const up = () => {
    if (!down) return;
    down = false;
    railL.classList.remove('dragging');
    // 拖动结束的这一下 click 要吞掉，否则会误召唤
    stripDragged = moved;
    setTimeout(() => { stripDragged = false; }, 60);
  };
  railL.addEventListener('pointerup', up);
  railL.addEventListener('pointercancel', up);
  railL.addEventListener('pointerleave', up);
}

/* 点一张题签：揭走它，换上一只 */
/* ---------------- 一次完整的「从掌心召唤」 ----------------

   老师要的节奏：手掌先飘出一点云气 → 云慢慢散开 →
   东西才从云里"钻"出来（渐隐渐显 + 弹一下）。
   不是一按就蹦出来，也不要往下压。

   时间轴（SUMMON_DUR = 2.4s）：
     0.00–0.34  只有云。掌心先渗出一小缕，范围小、浓度低
     0.34 起    兽从 5% 大小撑开，alpha 0→1，弹簧过冲那一下就是"弹"
     0.42 起    云开始淡，2.16s 左右散尽

   用墙上时钟而不是 dt —— dt 被钳在 0.05 保护弹簧，
   低帧率设备上时间会被拉长，云飘五六秒都散不掉。 */
const SUMMON_DUR  = 2.0;
const REVEAL_AT   = 0.32;     // 云走到这儿（0.64s）兽才开始现形
const REVEAL_SPAN = 0.09;     // 现形过渡宽度（占全程比例）

function startSummon(force) {
  const now = performance.now();
  /* 张手阈值附近抖动会反复重播，给个最小间隔。
     攥拳时会把 summonT0 清成 0，所以"攥了再张"一定重播。 */
  if (!force && now - (state.summonT0 || 0) < 1000) return;

  state.summonT0 = now;
  state.summonV = state.vclock || 0;
  state.released = false;
  state.enter = 0;
  state.magic = { t0: now, on: true };
  state.cloudVis = 1;             // 这一刻云是全可见的
  sfxCloud();                     // "呼——" 掌心渗气

  // 先缩到几乎看不见、按着不放 —— 等云起来了才放出
  spring.s.snap(0.05);
  spring.s.target = 0.05;
  spring.a.snap(0);
  spring.a.target = 0;
  spring.dip.snap(0);
  spring.dip.target = 0;
}

function pick(beast, card) {
  // 上一张还回来
  if (state.active && state.active.card) state.active.card.classList.remove('on');
  card.classList.add('on');
  try {
    card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  } catch (e) { /* 老浏览器 */ }

  const cr = card.getBoundingClientRect();
  const hr = heart.getBoundingClientRect();
  state.enterFrom = {
    x: cr.left + cr.width / 2 - hr.left,
    y: cr.top + cr.height / 2 - hr.top,
  };
  state.active = beast;
  unlockAudio();       // 浏览器要求先有一次用户手势，才能出声
  sfxSelect();         // 选中卡片"叮"一声，幼儿知道选到了

  /* 老师要的流程：点卡片只是「选中」这只，先记住，别急着放出来。
     真正召唤要等「张开手掌」那一瞬间（drawFrame 里 openOK 触发）。
     所以这里清掉上一次的出场状态，让兽退场，等张手再重播。 */
  state.pendingSummon = true;
  state.summonT0 = 0;       // 清空 = 本次出场作废，等张手才重新计时
  state.released = false;
  state.cloudVis = 0;
  state.prevOpen = false;   // 这样张手时 openOK&&!prevOpen 一定成立，触发召唤

  /* 寓意文案不在点卡片时弹（那时兽还没出来，会前后矛盾）。
     改挂到 drawFrame 里兽「现形」那一瞬（reveal 触发处）再浮现。 */

  // 首帧若还没有锚点，先给个中间位置
  if (!state.lastAnchor) {
    const ax = view.w / 2, ay = view.h * 0.52;
    spring.x.snap(ax); spring.y.snap(ay);
    state.lastAnchor = { x: ax, y: ay };
  }
  /* 「XX纹 · 落到手上了」这句 toast 已删 —— 它会和底部浮现的
     寓意祝福文字重叠，读起来打架。寓意说明本身就够了。 */
}

/* ---------------- 姿态 → 锚点 ---------------- */

const idx = {
  NOSE: 0, L_EYE: 2, R_EYE: 5, L_EAR: 7, R_EAR: 8, L_SH: 11, R_SH: 12,
  // 手腕 / 小指根 / 食指根 —— 这三点足以定出掌心、掌宽、手掌朝向
  W_L: 15, W_R: 16, P_L: 17, P_R: 18, I_L: 19, I_R: 20,
};

/* ---------------- 手：掌心锚点 ----------------
   手部模型 21 个点：
     0 腕 · 1-4 拇指 · 5-8 食指 · 9-12 中指 · 13-16 无名 · 17-20 小指
   用 5(食指根) 和 17(小指根) 的连线定掌宽和朝向，
   比姿态模型那 4 个粗略点准得多。                              */

const H = { WRIST: 0, INDEX_MCP: 5, MID_MCP: 9, RING_MCP: 13, PINKY_MCP: 17,
            THUMB_TIP: 4, INDEX_TIP: 8, MID_TIP: 12, RING_TIP: 16, PINKY_TIP: 20 };

/* 四指尖。判"伸没伸出去"量的是【指尖到掌心】的距离，除以掌宽归一。
   为什么不用「指尖到腕 / 指中节到腕」：手指卷起来的时候指尖是绕回掌心的，
   但它到腕的距离仍然比指中节远，那个比值判不出来（剪刀手实测四指全过）。
   指尖到掌心的距离才是"伸出去多远"本身：张开约 0.8 掌宽，攥拳约 0.3。 */
const TIPS = [H.INDEX_TIP, H.MID_TIP, H.RING_TIP, H.PINKY_TIP];
const OPEN_R = 0.50;      // 指尖离掌心超过 0.5 掌宽 = 这根伸出去了

function readHand(hands) {
  /* 调试钩子：页面里设 window.__lockPalm = {x,y,w,roll,ok} 就锁住掌心。
     假摄像头的手总是举在画面底部，下半截被签条挡着，没法判断落点好不好；
     锁一个画面中间的位置才能真正看清。不设这个变量时完全不影响正常逻辑。 */
  if (window.__lockPalm) { state.palm = window.__lockPalm; return; }

  if (!hands || !hands.length) {
    if (state.palm) state.palm.ok = false;
    return;
  }

  // 取张开得最大的那只（孩子可能两只手都举着）
  let best = null;
  for (const h of hands) {
    const a = mapPt(h[H.INDEX_MCP].x, h[H.INDEX_MCP].y);
    const b = mapPt(h[H.PINKY_MCP].x, h[H.PINKY_MCP].y);
    const span = Math.hypot(a.x - b.x, a.y - b.y);
    if (!best || span > best.span) best = { h, span };
  }
  if (!best || best.span < view.w * 0.016) {
    if (state.palm) state.palm.ok = false;
    return;
  }

  const h = best.h;
  const I = mapPt(h[H.INDEX_MCP].x, h[H.INDEX_MCP].y);
  const P = mapPt(h[H.PINKY_MCP].x, h[H.PINKY_MCP].y);
  const M = mapPt(h[H.MID_MCP].x, h[H.MID_MCP].y);
  const Wp = mapPt(h[H.WRIST].x, h[H.WRIST].y);

  /* 掌心：以四指根为准，往手腕方向让 0.18 个掌宽。
     不能拿手腕和中点取平均 —— 手举高时手腕常常出画，
     模型会把腕点外推到画面外，算出来的掌心就跑到屏幕底下了。 */
  const mx = (I.x + P.x) / 2, my = (I.y + P.y) / 2;
  const palmW = best.span * 1.25;

  // 往腕方向走的单位向量（指根 → 腕）
  let dx = Wp.x - mx, dy = Wp.y - my;
  const dl = Math.hypot(dx, dy) || 1;
  dx /= dl; dy /= dl;

  let px = mx + dx * palmW * 0.18;
  let py = my + dy * palmW * 0.18;

  // 再夹一次画面：掌心必须在画里，否则兽会画到看不见的地方
  px = clamp(px, view.w * 0.12, view.w * 0.88);
  py = clamp(py, view.h * 0.20, view.h * 0.88);

  /* 张开度：四指的「指尖到腕」除以「指根到腕」。
     张开手掌约 1.9~2.3，攥拳约 0.85~1.05。
     用比值而不是绝对像素 —— 手离镜头远近会同时放大分子分母，
     所以比值对距离不敏感，站着坐着、手伸远伸近都判得准。 */
  let ext = 0, votes = 0;
  for (const t of TIPS) {
    const Tp = mapPt(h[t].x, h[t].y);
    const d = Math.hypot(Tp.x - mx, Tp.y - my) / palmW;
    ext += d;
    if (d > OPEN_R) votes++;        // 离掌心够远 = 这根伸出去了
  }
  ext /= TIPS.length;

  // 朝向：食指根 → 小指根
  let roll = Math.atan2(I.y - P.y, I.x - P.x);
  if (roll > Math.PI / 2) roll -= Math.PI;
  if (roll < -Math.PI / 2) roll += Math.PI;

  const first = !state.palm || !state.palm.ok;
  const k = first ? 1 : 0.45;
  if (!state.palm) state.palm = { x: px, y: py, w: palmW, roll, ok: true };
  const s = state.palm;
  s.x += (px - s.x) * k;
  s.y += (py - s.y) * k;
  s.w += (palmW - s.w) * k;
  s.roll += (roll - s.roll) * k;
  /* 张开度单独平滑：这个量决定"出不出东西"，抖一下就会闪。
     0.28 的系数比位置更钝一点，它不需要灵敏，只需要稳。 */
  s.open = s.open === undefined ? ext : s.open + (ext - s.open) * 0.28;
  /* 伸出去几根。用投票而不是平均值 —— 平均值会被外推的指尖拉高，
     攥拳也会算成"张开"。投票是"几根手指真的伸着"，更接近人的直觉。

     滞回：只有「明确张开(≥3 根)」和「明确攥拳(≤1 根)」才切换状态，
     中间那档保持原样。手在阈值附近晃的时候不会一闪一闪。 */
  /* 老师定的规矩：「只要握成一个拳头，没有任何一根手指伸出来，
     就不能出现小灵兽」。攥拳时手指往往没并拢、或检测偶尔抖一下，
     把某一根指尖判成"伸出"，所以——
       · 至少要 2 根手指明确伸出才算"张开"（单根抖动不触发）
       · 攥拳连续 2 帧 ≤1 根就认 —— 比 3 帧更快，握拳"嗖"地收走，
         同时又不至于被单帧抖动误判。 */
  if (votes >= 2) {
    s.votes = 4;
    s.zero = 0;
  } else {
    s.zero = (s.zero || 0) + 1;
    if (s.zero >= 2) s.votes = 0;
  }
  s.votesRaw = votes;
  s.ok = true;
}

function readPose(landmarks) {
  if (!landmarks || !landmarks.length) { state.hasPerson = false; return; }
  const lm = landmarks[0];

  // 先取手：手举在胸前、脸出画的时候，也是要能玩的
  readHand(lm);

  const shL = lm[idx.L_SH], shR = lm[idx.R_SH], nose = lm[idx.NOSE];
  const vis = Math.min(shL.visibility ?? 1, shR.visibility ?? 1, nose.visibility ?? 1);
  if (vis < 0.45) {
    state.hasPerson = !!(state.palm && state.palm.ok);
    return;
  }

  state.hasPerson = true;

  // EMA 平滑（检测本身有抖动）
  if (!state.smooth) state.smooth = {};
  state.smooth.shL = ema(state.smooth.shL, shL, 0.55);
  state.smooth.shR = ema(state.smooth.shR, shR, 0.55);
  state.smooth.nose = ema(state.smooth.nose, nose, 0.55);
  state.smooth.earL = ema(state.smooth.earL, lm[idx.L_EAR], 0.55);
  state.smooth.earR = ema(state.smooth.earR, lm[idx.R_EAR], 0.55);

  const sL = state.smooth.shL, sR = state.smooth.shR, sn = state.smooth.nose;
  const eL = state.smooth.earL, eR = state.smooth.earR;

  const p0 = mapPt(0, 0);
  const shMidX = (sL.x + sR.x) / 2;
  const shMidY = (sL.y + sR.y) / 2;

  // 头宽与头顶：
  // 站得近时肩膀常常出画，用肩宽推头宽会严重偏小（小兽跟着缩成一点）。
  // 所以优先用两耳距离——孩子的头在画面里总是完整的。
  const earVis = Math.min(eL ? (eL.visibility ?? 1) : 0, eR ? (eR.visibility ?? 1) : 0);
  let headWpx, topN;

  if (earVis > 0.45) {
    const earPx = Math.hypot((eL.x - eR.x) * p0.dw, (eL.y - eR.y) * p0.dh);
    headWpx = earPx * 1.42;                       // 耳距约等于头宽的 0.7
    topN = {
      x: (eL.x + eR.x) / 2,
      // 0.74 而不是 0.56：耳中点到「头发外轮廓最高点」，中间还隔着发量
      y: (eL.y + eR.y) / 2 - (headWpx * 0.74) / p0.dh,
    };
  } else {
    headWpx = Math.hypot(sL.x - sR.x, sL.y - sR.y) * p0.dw * 0.50;
    const dx = sn.x - shMidX, dy = sn.y - shMidY;
    const len = Math.hypot(dx, dy) || 0.001;
    const up = 0.42;            // 头顶在鼻子上方多远（相对肩中→鼻长度）
    topN = { x: sn.x + (dx / len) * len * up, y: sn.y + (dy / len) * len * up };
  }

  const p = mapPt(topN.x, topN.y);

  // 夹一个范围，避免站远时小成一点、站太近撑满屏
  const headW = clamp(headWpx, view.w * 0.085, view.w * 0.30);

  // 身体倾斜：肩线角度（画面做了水平镜像，所以 x 分量取反），只取三成
  let tilt = Math.atan2((sL.y - sR.y) * p.dh, -(sL.x - sR.x) * p.dw);
  while (tilt > Math.PI / 2) tilt -= Math.PI;
  while (tilt < -Math.PI / 2) tilt += Math.PI;

  state.headW = headW;
  state.tilt = clamp(tilt * 0.32, -0.34, 0.34);
  state.anchor = p;

  // 转头角度：鼻子相对两耳中点的横向偏移。
  // 孩子转头时小兽跟着“转过去”一点点，这是贴片最缺的三维线索之一。
  const earMidX = (eL.x + eR.x) / 2;
  const earDist = Math.hypot((eL.x - eR.x) * p.dw, (eL.y - eR.y) * p.dh) || 0.001;
  const yaw = ((sn.x - earMidX) * p.dw) / earDist;
  state.yaw = state.yaw === undefined
    ? yaw
    : state.yaw + (clamp(yaw, -0.7, 0.7) - state.yaw) * 0.22;

  // 真正的锚点要送到渲染层：早先这里只在点卡片时给过一次占位值，
  // 小兽便一直钉在画面中央，孩子动它不动。弹簧负责阻尼，这里直接给目标。

  // 肩与胸的锚点。
  // 头顶那块地方永远不够：孩子一站近，头顶就贴着画框，兽一放大必顶出画面。
  // 放到肩上，空间够了，「趴在肩上」也比「顶在头上」更像真的。
  const slp = mapPt(sL.x, sL.y), srp = mapPt(sR.x, sR.y);
  const leftPt = slp.x < srp.x ? slp : srp;
  const rightPt = slp.x < srp.x ? srp : slp;
  const sw = Math.hypot(srp.x - slp.x, srp.y - slp.y);
  state.shoulderW = sw;
  const nextA = {
    left:  { x: leftPt.x - sw * 0.24, y: leftPt.y - sw * 0.06 },
    right: { x: rightPt.x + sw * 0.24, y: rightPt.y - sw * 0.06 },
    chest: { x: (leftPt.x + rightPt.x) / 2, y: (leftPt.y + rightPt.y) / 2 + sw * 0.36 },
  };
  if (!state.anchors) state.anchors = nextA;
  else {
    for (const k in nextA) {
      state.anchors[k].x += (nextA[k].x - state.anchors[k].x) * 0.35;
      state.anchors[k].y += (nextA[k].y - state.anchors[k].y) * 0.35;
    }
  }

  if (!state.lastAnchor) state.lastAnchor = { x: p.x, y: p.y };
  else {
    state.lastAnchor.x += (p.x - state.lastAnchor.x) * 0.35;
    state.lastAnchor.y += (p.y - state.lastAnchor.y) * 0.35;
  }
}

/* ---------------- 色温采样 ---------------- */

const tintCanvas = document.createElement('canvas');
tintCanvas.width = tintCanvas.height = 48;
const tintCtx = tintCanvas.getContext('2d', { willReadFrequently: true });
let tintTick = 0;

function lumOf(sx, sy, sw, sh) {
  tintCtx.drawImage(video, sx, sy, sw, sh, 0, 0, 16, 16);
  const d = tintCtx.getImageData(0, 0, 16, 16).data;
  let l = 0;
  for (let i = 0; i < d.length; i += 4) {
    l += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  }
  return l / (d.length / 4) / 255;
}

function sampleTint() {
  if (!video.videoWidth) return;
  try {
    const vw = video.videoWidth, vh = video.videoHeight;
    tintCtx.drawImage(video, vw * 0.28, vh * 0.12, vw * 0.44, vh * 0.6, 0, 0, 48, 48);
    const d = tintCtx.getImageData(0, 0, 48, 48).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    r /= n; g /= n; b /= n;

    // 画面偏暖多少，就把这层暖色铺到兽身上多少
    const warm = (r - b) / 255;
    const a = clamp(warm * 0.95, 0, 0.24);
    // 亮度对齐：教室暗就压一档，别让兽"发光"（下限压到 0.55，浅色兽在亮背景更稳）
    const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
    const bright = clamp(0.55 + lum * 0.34, 0.55, 1.02);

    // 主光从哪边来：画面做了镜像，视频左半边 = 屏幕右半边
    const vL = lumOf(vw * 0.06, vh * 0.22, vw * 0.20, vh * 0.46);
    const vR = lumOf(vw * 0.74, vh * 0.22, vw * 0.20, vh * 0.46);
    const dir = clamp((vL - vR) * 2.4, -1, 1);

    state.tint = { r, g, b, a, bright, dir };
  } catch (e) { /* 跨域或未就绪，忽略 */ }
}

/* ---------------- 绘制 ---------------- */

let bobT = 0;

/* 立体化开关：?solid=0 退回旧版（一张平贴的图），方便对比 */
const SOLID = new URLSearchParams(location.search).get('solid') !== '0';
/* ?magicp=0.35 → 把祥云定格在 35% 那一帧，用来截图检查形状 */
const MAGIC_HOLD = (() => {
  const v = new URLSearchParams(location.search).get('magicp');
  return v === null ? null : clamp(parseFloat(v) || 0, 0, 1);
})();
/* ?freeze=1200 → 出场跑到 1200ms 就把画面冻住。
   headless 里一次截图要四五秒，2.4 秒的出场根本抓不住 ——
   必须先让画面停下来，再慢慢拍。 */
const FREEZE_AT = (() => {
  const v = new URLSearchParams(location.search).get('freeze');
  return v === null ? null : (parseFloat(v) || 0) / 1000;
})();
/* ?vdt=0.2 → 每帧固定推进 0.2 秒虚拟时间（慢放）。
   这台机器渲染只有 2fps 左右，用真实时间的话 2.4 秒的出场
   只能抓到两三帧，根本看不清中间过程。固定步长后就完全可复现。
   不传这个参数时，虚拟时钟等于真实经过时间，对正常使用零影响。 */
const VDT = (() => {
  const v = new URLSearchParams(location.search).get('vdt');
  return v === null ? null : (parseFloat(v) || 0);
})();
/* 排查开关：?occ=0 关手掌遮挡层，?contact=0 关接触阴影，?bend=0 关切片弯曲 */
const DBG = new URLSearchParams(location.search);
const NO_OCC = DBG.get('occ') === '0';
const NO_CONTACT = DBG.get('contact') === '0';
const NO_BEND = DBG.get('bend') === '0';

/* ---------------------------------------------------------------
   手感参数

   这几项原来是散在 drawFrame 里的魔法数字。每改一次就得重新
   截图、再由我看图判断 —— 一张 headless 截图两秒多，而且我看
   小图会看错（这一轮就把龟自己的后腿当成残留地面折腾了四轮）。

   抽出来之后：地址加 ?tune=1 出滑块，当场拖、当场看。
   拖到满意的数值告诉我，我再固化成默认值。
   地址上也能直接给，方便一次出一组对照：?tune=1&size=1.5&sink=0.10
   --------------------------------------------------------------- */

const TUNE_DEF = {
  /* 这一组是老师在平板上拖定的（第二版）：
     size=2.56 hug=0.26 sink=0.2 cDark=0.88 cWide=0.78
     dip=0 bob=0.02 open=0 cloudA=1.15 cloudR=0.85

     尺寸 / 压扁 / 陷入 三项都顶到上限 —— 他要的就是"大到压得住手"。
     云反而调小了（浓 1.8→1.15，范围 1.35→0.85）：云一大就糊住脸。
     dip 恒为 0 —— 不要"落下来沉一下"那个动作。 */
  size:  { v: 2.56,   min: 0.60, max: 2.80, step: 0.02,   name: '比手掌（倍宽）' },
  hug:   { v: 0.260,  min: 0.00, max: 0.260, step: 0.002, name: '底部压扁' },
  sink:  { v: 0.200,  min: 0.00, max: 0.200, step: 0.002, name: '陷进手掌' },
  cDark: { v: 0.88,   min: 0.00, max: 1.60, step: 0.02,   name: '阴影·浓' },
  /* 阴影·宽从 0.78 收到 0.52：0.78 会在小灵兽脚下摊开一块浅色垫片，
     像"垫了张纸"，不像"站在手上"。0.52 让阴影紧贴底缘、短而深。 */
  cWide: { v: 0.52,   min: 0.30, max: 0.95, step: 0.01,   name: '阴影·宽' },
  dip:   { v: 0.000,  min: 0.00, max: 0.220, step: 0.002, name: '落定下沉' },
  bob:   { v: 0.0200, min: 0.00, max: 0.030, step: 0.0004, name: '呼吸起伏' },
  /* 攥拳判定：伸出的手指 ≤ 这个值就算"攥着，什么也不给"。
     老师定的规矩是「只要握成拳头，没有任何一根手指伸出来」——
     所以默认 0：五根全握紧才收，伸出一根就已经算伸手了。 */
  open:  { v: 0,      min: 0,    max: 2,    step: 1,      name: '握拳：伸出≤' },
  cloudA:{ v: 1.15,   min: 0.20, max: 2.20, step: 0.05,   name: '云气·浓' },
  cloudR:{ v: 0.85,   min: 0.50, max: 2.20, step: 0.05,   name: '云气·范围' },
};

const TUNE = {};
for (const k in TUNE_DEF) TUNE[k] = TUNE_DEF[k].v;
for (const k in TUNE_DEF) {
  const raw = DBG.get(k);
  if (raw === null) continue;
  const v = parseFloat(raw);
  if (Number.isFinite(v)) TUNE[k] = Math.min(TUNE_DEF[k].max, Math.max(TUNE_DEF[k].min, v));
}

/* ---------------------------------------------------------------
   把一张精灵烘成「有厚度的布偶」

   贴片之所以像纸，不是图不好，是它零厚度、零形变、不接二次光。
   这三件在 2D canvas 里都能伪造，而且不花帧——全烘进离屏缓存：

   ① 侧壁：同一剪影压暗后朝「光的下方」错开几像素画在底下，
      露出来那一圈就是布的厚度。右下半毫米的暗边，比任何滤镜
      都更能让眼睛相信它有侧面。
   ② 织纹：宋锦是经纬织出来的，表面有一层极细的斜向颗粒。
      叠 5% 的织纹，塑料感立刻退掉——这一步是「AI 公仔」变成
      「一块宋锦缝的玩偶」的分水岭。
   ③ 轮廓光：背光侧一条 2px 暖白细边（rim），把体积从背景里
      剥出来，否则深色毛衣上的深色兽会糊成一片。
   ④ 布边压线：沿轮廓内侧一圈极窄的暗线 + 更里侧一条亮线，
      是缝纫压脚的痕迹。

   以上都按「色温 + 光向」分档缓存在 BOX+PAD 的画布上，
   每帧只贴一次；形变由 drawBeastSliced 负责。
   --------------------------------------------------------------- */

const BOX = 512;         // 内容区（原图 fit 进来）
const PAD = 30;          // 厚度外扩，够侧壁和轮廓光用
const FULL = BOX + PAD * 2;

const beastCv = document.createElement('canvas');
const beastCtx = beastCv.getContext('2d');

/* 剪影与轮廓光的临时层（一次性，不进帧循环） */
const silCv = document.createElement('canvas');
const silCtx = silCv.getContext('2d');
const rimCv = document.createElement('canvas');
const rimCtx = rimCv.getContext('2d');

let beastKey = '';

/* 程序化织纹：8px 一个循环的斜纹 + 纤维毛糙。
   overlay 混合下 128 为不动，所以让数值在 108~148 之间晃，
   只改明暗不改色相——宋锦的经纬就是这么起伏的。 */
let weavePat = null;
function weavePattern() {
  if (weavePat) return weavePat;
  const S = 32;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  const img = c.createImageData(S, S);
  const d = img.data;
  let seed = 20261120;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      let v = 128;
      v += Math.sin((x * Math.PI) / 4) * 9;              // 经线
      v += Math.sin((y * Math.PI) / 4) * 9;              // 纬线
      v += ((x + y) % 8) < 4 ? 7 : -7;                   // 斜纹的织点
      v += (rnd() - 0.5) * 14;                            // 纤维毛糙
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      d[i] = d[i + 1] = d[i + 2] = v | 0;
      d[i + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  weavePat = beastCtx.createPattern(cv, 'repeat');
  return weavePat;
}

function paintBeast(beast, tint) {
  const iw = beast.imgEl.naturalWidth || 512;
  const ih = beast.imgEl.naturalHeight || 512;
  const ratio = Math.min(BOX / iw, BOX / ih);
  const dw = iw * ratio, dh = ih * ratio;
  const ox = PAD + (BOX - dw) / 2, oy = PAD + (BOX - dh) / 2;

  const dirBucket = Math.round(clamp(tint.dir || 0, -1, 1) * 4) / 4;
  /* 缓存键量化：色温每 20 帧都会微变，若键精确到 3 位小数，几乎每帧都重烘焙
     （572px 离屏 + 十几步 filter/gradient），低端平板周期性卡顿。
     量化成粗档（亮度 0.05 档、暖度 0.02 档、rgb 8 阶），同场景不再重画。 */
  const key = [
    beast.id,
    Math.round(tint.bright / 0.05),
    Math.round(tint.a / 0.02),
    (tint.r >> 5), (tint.g >> 5), (tint.b >> 5),
    (tint.ao ?? 0).toFixed(2),
    dirBucket.toFixed(2),
    beast.bumpEl && beast.bumpEl.naturalWidth ? 'B' : 'b',
  ].join('|');

  if (beastCv.width !== FULL) {
    beastCv.width = beastCv.height = FULL;
    silCv.width = silCv.height = FULL;
    rimCv.width = rimCv.height = FULL;
    beastKey = '';
  }

  if (key !== beastKey) {
    const dir = clamp(tint.dir || 0, -1, 1);

    /* ---- 剪影：白色，供侧壁 / 轮廓光复用 ---- */
    silCtx.setTransform(1, 0, 0, 1, 0, 0);
    silCtx.globalCompositeOperation = 'source-over';
    silCtx.clearRect(0, 0, FULL, FULL);
    silCtx.drawImage(beast.imgEl, ox, oy, dw, dh);
    silCtx.globalCompositeOperation = 'source-in';
    silCtx.fillStyle = '#ffffff';
    silCtx.fillRect(0, 0, FULL, FULL);
    silCtx.globalCompositeOperation = 'source-over';

    beastCtx.setTransform(1, 0, 0, 1, 0, 0);
    beastCtx.globalCompositeOperation = 'source-over';
    beastCtx.clearRect(0, 0, FULL, FULL);

    /* ---- ① 侧壁：主光在上方，壁面朝下露出来 ----
       以前是「白色剪影铺底 + 罩一层棕」：罩不实就剩一圈米白，
       在手上像垫了张卡纸。改成先把剪影整个染暗再画，
       得到的是布料自身的厚度，而不是垫底的东西。 */
    if (SOLID) {
      const th = Math.max(1.6, dw * 0.005);
      const sx2 = -dir * th * 0.75;
      const sy2 = th;

      rimCtx.setTransform(1, 0, 0, 1, 0, 0);
      rimCtx.globalCompositeOperation = 'source-over';
      rimCtx.clearRect(0, 0, FULL, FULL);
      rimCtx.drawImage(silCv, 0, 0);
      rimCtx.globalCompositeOperation = 'source-in';
      rimCtx.fillStyle = '#2b1b0e';
      rimCtx.fillRect(0, 0, FULL, FULL);
      rimCtx.globalCompositeOperation = 'source-over';

      beastCtx.save();
      beastCtx.globalAlpha = 0.8;
      beastCtx.drawImage(rimCv, sx2, sy2);
      beastCtx.restore();
    }

    /* ---- ② 本体 ---- */
    beastCtx.filter = `brightness(${tint.bright.toFixed(3)})`;
    beastCtx.drawImage(beast.imgEl, ox, oy, dw, dh);
    beastCtx.filter = 'none';

    // 环境色：画面偏暖，兽也跟着暖
    if (tint.a > 0.006) {
      beastCtx.globalCompositeOperation = 'source-atop';
      beastCtx.fillStyle = `rgba(${tint.r | 0},${tint.g | 0},${tint.b | 0},${tint.a.toFixed(3)})`;
      beastCtx.fillRect(0, 0, FULL, FULL);
    }

    /* ---- ②.5 浮雕光影：让纹样本身鼓起来 ----
       这张图是离线算的：把剪影做距离变换当高度场，按左上来光求
       法线明暗。叠上去之后，龟壳是「鼓的」而不是「印上去的」，
       而纹样一根线都没有被改。 */
    if (SOLID && beast.bumpEl && beast.bumpEl.naturalWidth) {
      /* 浮雕图必须先按当前剪影裁一遍再叠。
         overlay 遇到透明底不会"什么都不做"，而是把那一块压成灰 ——
         素材改过之后，旧浮雕图里残留的轮廓（比如已经擦掉的地面）
         就会在手上摊出一块灰片。裁一次，永远不可能漏。 */
      rimCtx.setTransform(1, 0, 0, 1, 0, 0);
      rimCtx.globalCompositeOperation = 'source-over';
      rimCtx.clearRect(0, 0, FULL, FULL);
      rimCtx.drawImage(beast.bumpEl, ox, oy, dw, dh);
      rimCtx.globalCompositeOperation = 'destination-in';
      rimCtx.drawImage(silCv, 0, 0);
      rimCtx.globalCompositeOperation = 'source-over';

      beastCtx.globalCompositeOperation = 'overlay';
      // 浅色的（云、风车、蜻蜓）浮雕要收着点，压重了会发灰
      beastCtx.globalAlpha = (beast.bp ?? 0.80) * 0.72;
      beastCtx.drawImage(rimCv, 0, 0);
      beastCtx.globalAlpha = 1;
    }

    /* ---- ③ 织纹：把「AI 公仔」变成「一块锦缎」 ----
       overlay 在透明底上会直接留下一整块灰 —— 因为 backdrop 的
       alpha 是 0，混合结果是源本身。所以织纹必须先裁进剪影，
       再以 overlay 叠上去。 */
    if (SOLID) {
      const pat = weavePattern();
      rimCtx.setTransform(1, 0, 0, 1, 0, 0);
      rimCtx.globalCompositeOperation = 'source-over';
      rimCtx.clearRect(0, 0, FULL, FULL);
      rimCtx.fillStyle = pat;
      rimCtx.fillRect(0, 0, FULL, FULL);
      rimCtx.globalCompositeOperation = 'destination-in';
      rimCtx.drawImage(silCv, 0, 0);
      rimCtx.globalCompositeOperation = 'source-over';

      beastCtx.globalCompositeOperation = 'overlay';
      beastCtx.globalAlpha = 0.16;
      beastCtx.drawImage(rimCv, 0, 0);
      beastCtx.globalAlpha = 1;
    }

    /* ---- ④ 底部环境光遮蔽 + 顶部受光 ---- */
    const ao = beast.ao ?? 0.42;
    if (ao > 0.01) {
      beastCtx.globalCompositeOperation = 'source-atop';
      const gy0 = oy + dh * 0.58;
      const g = beastCtx.createLinearGradient(0, gy0, 0, oy + dh);
      g.addColorStop(0, 'rgba(26,16,6,0)');
      g.addColorStop(0.55, `rgba(26,16,6,${(ao * 0.35).toFixed(3)})`);
      g.addColorStop(1, `rgba(26,16,6,${ao.toFixed(3)})`);
      beastCtx.fillStyle = g;
      beastCtx.fillRect(ox, gy0, dw, dh * 0.42);

      // 顶部一点受光，让体积感出来
      const g2 = beastCtx.createLinearGradient(0, oy, 0, oy + dh * 0.34);
      g2.addColorStop(0, 'rgba(255,246,224,0.16)');
      g2.addColorStop(1, 'rgba(255,246,224,0)');
      beastCtx.fillStyle = g2;
      beastCtx.fillRect(ox, oy, dw, dh * 0.34);
    }

    /* ---- ⑤ 主光方向 ---- */
    if (Math.abs(dir) > 0.08) {
      const lit = Math.min(0.24, Math.abs(dir) * 0.24);
      const gx = beastCtx.createLinearGradient(ox, 0, ox + dw, 0);
      const dark = `rgba(26,16,6,${(lit * 0.7).toFixed(3)})`;
      const lite = `rgba(255,246,220,${lit.toFixed(3)})`;
      if (dir > 0) {
        gx.addColorStop(0, dark);
        gx.addColorStop(0.52, 'rgba(26,16,6,0)');
        gx.addColorStop(1, lite);
      } else {
        gx.addColorStop(0, lite);
        gx.addColorStop(0.48, 'rgba(26,16,6,0)');
        gx.addColorStop(1, dark);
      }
      beastCtx.globalCompositeOperation = 'source-atop';
      beastCtx.fillStyle = gx;
      beastCtx.fillRect(ox, oy, dw, dh);
    }

    /* ---- ⑥ 轮廓光：背光侧一条暖白细边 ---- */
    if (SOLID) {
      /* 这条边要窄、要暗。宽一点、亮一点，整只就浮起来变成贴纸 ——
         真实的毛绒玩具边上是绒线打散的一点点光，不是白描边。 */
      const rw = Math.max(1.4, dw * 0.0045);
      // 光从左边来（dir<0）→ 背光在右 → 剪影往右错
      const rx = -dir * rw;
      rimCtx.setTransform(1, 0, 0, 1, 0, 0);
      rimCtx.globalCompositeOperation = 'source-over';
      rimCtx.clearRect(0, 0, FULL, FULL);
      rimCtx.drawImage(silCv, rx, -rw * 0.35);
      rimCtx.globalCompositeOperation = 'destination-out';
      rimCtx.drawImage(silCv, 0, 0);
      rimCtx.globalCompositeOperation = 'source-over';

      beastCtx.globalCompositeOperation = 'source-atop';
      beastCtx.globalAlpha = 0.10;
      beastCtx.drawImage(rimCv, 0, 0);
      beastCtx.globalAlpha = 1;
    }

    /* ---- ⑦ 布边压线：内侧一圈极窄暗线 ----
       这条线原来是白的，等于在剪影里再描一圈白边，最显"贴纸"。
       布偶的压线是凹进去的一条暗线，所以染暗。 */
    if (SOLID) {
      rimCtx.setTransform(1, 0, 0, 1, 0, 0);
      rimCtx.globalCompositeOperation = 'source-over';
      rimCtx.clearRect(0, 0, FULL, FULL);
      rimCtx.drawImage(silCv, 0, 0);
      rimCtx.globalCompositeOperation = 'destination-out';
      const inset = Math.max(2, dw * 0.006);
      rimCtx.drawImage(silCv, inset, inset, FULL - inset * 2, FULL - inset * 2);
      rimCtx.globalCompositeOperation = 'source-in';
      rimCtx.fillStyle = '#33200f';
      rimCtx.fillRect(0, 0, FULL, FULL);
      rimCtx.globalCompositeOperation = 'source-over';

      beastCtx.globalCompositeOperation = 'source-atop';
      beastCtx.globalAlpha = 0.18;
      beastCtx.drawImage(rimCv, 0, 0);
      beastCtx.globalAlpha = 1;
    }

    beastCtx.globalCompositeOperation = 'source-over';
    beastKey = key;
  }

  return { cv: beastCv, ox, oy, dw, dh };
}

/* ---------------------------------------------------------------
   把烘好的图按「肩的弧度」弯一下再贴

   一张刚性图贴在肩上，怎么会不像纸？因为肩膀是个圆柱，
   而图是平的。解法很便宜：把图竖着切成若干条，两侧的条
   抬起来一点，整只就顺着圆柱弯过去了。

   底缘中间最低（接触点）、两端上翘，弧度随兽的宽度走。
   --------------------------------------------------------------- */

const SLICES = 10;

function drawBeastSliced(c, cv, x, y, w, h, curv, squash) {
  const sq = clamp(squash || 0, 0, 0.30);

  /* 底部坐实：只把最底部一小条（8%）压矮一点点，其余 92% 完全不动。
     之前把 cut 设成 0.62（压下面 38%），hug 一调大，下段花纹被
     明显压扁，和上段对不上，龟身中间就裂开一条横缝。
     改成只压最底部 8%：接缝落在脚趾附近，压缩量又小，
     肉眼根本看不出分界，也不会有"整只被压扁"的变形。 */
  if (sq > 0.004) {
    const cut = 0.92;                     // 只在最底部 8% 动手
    const shTop = cv.height * cut;
    const yTop = y;                        // 上段顶
    const ySeam = y + h * cut;             // 接缝位置
    const hBotDraw = h * (1 - cut) * (1 - sq);  // 底部一小条压矮

    // 上段（92%）：源 [0, shTop)，画满 [y, ySeam)
    c.drawImage(cv, 0, 0, cv.width, shTop, x, yTop, w, ySeam - yTop);
    // 下段（8%）：源 [shTop, cv.height)，压矮画在 [ySeam, ySeam+hBotDraw)
    c.drawImage(cv, 0, shTop, cv.width, cv.height - shTop,
                x, ySeam, w, hBotDraw);
    return;
  }

  if (!SOLID || Math.abs(curv) < 0.5) {
    c.drawImage(cv, x, y, w, h);
    return;
  }
  slicedRun(c, cv, 0, cv.height, x, y, w, h, curv);
}

/* 横向切片：把整只顺着肩 / 掌的圆弧弯过去 */
function slicedRun(c, cv, sy0, sh, x, y, w, h, curv) {
  const n = SLICES;
  const sw = cv.width / n;
  const dw = w / n;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const lift = curv * Math.pow(2 * u - 1, 2);
    const sxi = Math.round(i * sw);
    const swi = Math.round((i + 1) * sw) - sxi;
    c.drawImage(cv, sxi, sy0, swi, sh, x + i * dw, y - lift, dw + 0.6, h);
  }
}

/* ---------------- 接触阴影 ---------------- */

/* 紧贴接触面的一小圈。短、深、形状跟着手掌倾角走。
   浮着的东西没有这一圈 —— 这是"放上去"和"印上去"的第一道分界。
   物件比手掌大的时候，这一圈要跟着变宽变深：受压的面积大、
   离手越近的地方越暗。半径给 0.62 兽宽，再大就从兽底下"漫"出来，
   变成一团糊影；真正压出来的影子是贴着底缘、颜色很深、扩散很短的。 */
function drawContact(c, cx, cy, bw, bh, rot, alpha, beast) {
  /* 浅色小兽（云纹/球路/方胜/缠枝）在亮背景上会糊成一团，
     这里把它的接触阴影半径和浓度调大一圈，当"软暗底衬"托住，
     让浅色兽在白墙/窗边也能和背景分开。 */
  const isLight = !!(beast && beast.light);
  const rx = bw * TUNE.cWide * (isLight ? 1.28 : 1);
  const ry = Math.max(6, bw * TUNE.cWide * (isLight ? 0.24 : 0.185));
  c.save();
  c.globalAlpha = clamp(
    alpha * (isLight ? 0.62 : (0.86 + (beast.ao ?? 0.4) * 0.16)) * TUNE.cDark,
    0, 1);
  c.translate(cx, cy - bh * 0.004);
  c.rotate(rot);
  c.scale(1, ry / rx);
  const g = c.createRadialGradient(0, 0, rx * 0.04, 0, 0, rx);
  g.addColorStop(0, 'rgba(14,7,2,0.94)');
  g.addColorStop(0.26, 'rgba(16,8,3,0.70)');
  g.addColorStop(0.58, 'rgba(20,11,4,0.30)');
  g.addColorStop(1, 'rgba(24,14,6,0)');
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, rx, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/* ---------------- 云气 ---------------- */

/* 一团云气：只有浓淡，没有轮廓。
   上一版用金线勾了云的边 —— 那是"卡通"的来源。真正的中国画云气
   是不描边的：靠一层层极淡的墨/粉叠出浓淡，边缘自己化进背景里。
   所以这里全部用径向渐变，从中心的不透明一路化到 0，一个硬边都不留。 */
function cloudPuff(c, x, y, r, rgb, a) {
  const g = c.createRadialGradient(x, y, r * 0.04, x, y, r);
  g.addColorStop(0,    `rgba(${rgb},${a})`);
  g.addColorStop(0.34, `rgba(${rgb},${a * 0.66})`);
  g.addColorStop(0.64, `rgba(${rgb},${a * 0.26})`);
  g.addColorStop(1,    `rgba(${rgb},0)`);
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
}

/* 云团的排布：dx/dy 是相对位置，r 是大小，sp 是散开速度，a 是浓度。
   每个团的速度都不一样 —— 速度一样就会像同一张图在缩放，很假。 */
const PUF = [
  [ 0.00,  0.04, 0.52, 1.00, 1.00, 0],
  [-0.38,  0.10, 0.40, 1.26, 0.86, 0],
  [ 0.40, -0.02, 0.38, 1.22, 0.82, 1],
  [-0.18, -0.30, 0.34, 1.34, 0.70, 0],
  [ 0.20,  0.26, 0.32, 1.30, 0.64, 1],
  [-0.58, -0.14, 0.27, 1.48, 0.50, 1],
  [ 0.60,  0.16, 0.26, 1.44, 0.46, 0],
  [ 0.02,  0.44, 0.25, 1.38, 0.40, 0],
  [-0.30, -0.50, 0.21, 1.58, 0.30, 1],
];

const RIM_DIRS = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)];
});

/* 云气出场。
   想要的是：从掌心里"破"出来，一团气散开、飘走。
   做法是三层叠加，全部柔边：
     ① 底雾：一大团极淡的暖白，把掌心那块提亮；
     ② 云团：九个大小不一的软团，各自以不同速度向外散、边散边淡；
     ③ 气丝：几道向上飘的细气，只有线、没有形状；
     ④ 金屑：十几粒随气散开的小光点，宋锦的底色。
   参数 w 是目标宽度，云要略大于兽 —— 不然整团都躲在兽背后，等于没画。 */
function drawCloud(c, cx, cy, w, p, alpha) {
  const t = clamp(p, 0, 1);
  /* 分三段，不能一段走完：
     0 – 0.42   从掌心**渗**出来，smoothstep 起头是慢的 ——
                老师要的"先飘出一点云雾"，靠的就是这个慢起头；
     0.42 – 1   一边散、一边淡；
     全程不描边，只靠浓淡 —— 这是"不卡通"的根本。 */
  const bu = Math.min(1, t / 0.52);
  const burst = bu * bu * (3 - 2 * bu);
  const fade = t > 0.46 ? Math.pow(Math.max(0, 1 - (t - 0.46) / 0.54), 1.5) : 1;
  const A = alpha * fade;
  /* 云的展开半径单独走一条曲线，不跟 burst 绑。
     原因是兽一出来（宽约 1.55 掌宽）会把整朵云盖住 ——
     云必须散到**比兽更宽**，两侧和下缘才露得出来，
     才像"从云里钻出来"，而不是"云散了它才出现"。
     0.14w 起步（掌心一小缕）→ 0.76w 展开（比兽宽一圈）。 */
  const buoy = Math.min(1, t / 0.55);
  const grow = buoy * buoy * (3 - 2 * buoy);
  const R = w * (0.14 + 0.62 * grow) * TUNE.cloudR;
  /* 上升量给得很小：云心必须和兽中心重合，才像"兽从这团气里长出来"。
     原来 -0.13w 会让云飘到掌心上方半个兽高，兽就落在云的下缘外面了。 */
  const rise = -w * 0.07 * burst - w * 0.09 * (1 - fade);

  c.save();
  c.translate(cx, cy + rise);

  // ① 底雾：掌心那块先亮起来，云气才有"从这里出来"的落点
  cloudPuff(c, 0, 0, R * 1.05, '255,248,232', 0.085 * A * TUNE.cloudA);

  /* ② 云团：九团，各自散、各自淡。
     整组绕中心缓慢转一点 —— 气是翻着涌的，不转就是一坨死白。 */
  c.save();
  c.rotate(t * 0.45);
  for (const [dx, dy, rr, sp, aa, tone] of PUF) {
    const spread = 1 + (t * 0.52) * (sp - 1);        // 越往后散得越开
    /* 每团各自微微漂：相位按 dx/dy 错开，整团才会"翻"。
       只靠整体旋转没用 —— 云是圆的，转起来看不出。 */
    const wobX = Math.sin(t * 3.2 + dx * 6.1) * R * 0.055;
    const wobY = Math.cos(t * 2.6 + dy * 5.3) * R * 0.055;
    const px = dx * R * spread + wobX;
    const py = dy * R * spread * 0.92 + wobY;        // 纵向压一点，云是扁的
    const pr = rr * R * (0.62 + 0.62 * burst) * (0.85 + 0.35 * t);
    const rgb = tone ? '238,245,242' : '255,251,242';
    cloudPuff(c, px, py, pr, rgb, 0.56 * aa * A * TUNE.cloudA);
  }
  c.restore();

  /* 原来这里画了五道"气丝"，想表现烟缕。实际渲染出来是几条细白线，
     在视频画面上看着像刮痕 —— 那正是"生硬"的来源。
     云气不需要线，浓淡本身就是气。 */

  // ④ 金屑：随气散开的小光点
  for (let i = 0; i < 16; i++) {
    const ang = -Math.PI * 0.92 + (i / 15) * Math.PI * 0.84
              + Math.sin(i * 2.7) * 0.5;
    const dist = R * (0.55 + 1.05 * burst) * (0.55 + 0.45 * Math.sin(i * 1.9 + t * 2));
    const px = Math.cos(ang) * dist * 1.15;
    const py = Math.sin(ang) * dist * 0.95 - R * (0.25 * burst + 0.55 * t * t);
    const r = Math.max(0.9, w * 0.004 * (1 - t * 0.45) * (i % 4 === 0 ? 1.7 : 1));
    c.fillStyle = i % 4 === 0
      ? `rgba(255,244,206,${(0.80 * A).toFixed(3)})`
      : `rgba(226,186,96,${(0.50 * A).toFixed(3)})`;
    c.beginPath();
    c.arc(px, py, r, 0, Math.PI * 2);
    c.fill();
  }

  c.restore();
}

/* 前景雾：几缕极淡的气从兽**前面**掠过。
   只有"从雾里出来"才有穿越感 —— 云全在背后，就只是贴了张背景。
   浓度给得很低（0.20），高了就把兽糊住了。 */
function drawCloudFront(c, cx, cy, w, p, alpha) {
  const t = clamp(p, 0, 1);
  const burst = easeOut(Math.min(1, t / 0.30));
  const fade = t > 0.40 ? Math.pow(Math.max(0, 1 - (t - 0.40) / 0.60), 1.7) : 1;
  const A = alpha * fade;
  if (A < 0.02) return;
  const R = w * (0.15 + 0.40 * burst) * TUNE.cloudR * 1.15;

  c.save();
  c.translate(cx, cy);
  // 左、右、下三缕，各自朝外掠过；中路留空，别糊住兽的脸
  const lobes = [
    [-0.58,  0.12, 0.50, 1.34],
    [ 0.60, -0.02, 0.46, 1.28],
    [ 0.02,  0.54, 0.42, 1.20],
    [-0.30, -0.44, 0.34, 1.42],
  ];
  for (const [dx, dy, rr, sp] of lobes) {
    const spread = 1 + t * (sp - 1) * 1.55;
    const pr = rr * R * (0.78 + 0.55 * t);
    cloudPuff(c, dx * R * spread, dy * R * spread, pr, '255,251,240', 0.30 * A * TUNE.cloudA);
  }
  c.restore();
}

/* 合成用的两张离屏：阴影层、遮挡层 */
const shCv = document.createElement('canvas');
const shCtx = shCv.getContext('2d');
const ocCv = document.createElement('canvas');
const ocCtx = ocCv.getContext('2d');

function ensureTemps() {
  const bw = Math.round(view.w * view.dpr);
  const bh = Math.round(view.h * view.dpr);
  if (shCv.width !== bw || shCv.height !== bh) {
    shCv.width = bw; shCv.height = bh;
    shCtx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ocCv.width = bw; ocCv.height = bh;
    ocCtx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  }
}

/* ---------------- 主循环 ---------------- */

let lastT = performance.now();
let detectBusy = false;

function loop(now) {
  /* 以前这里把 dt 钳在 0.05 —— 那是为了弹簧稳定（显式欧拉步长太大就炸）。
     但钳住的后果是：帧率越低，仿真时间走得越慢。教室里的平板跑 10fps 时，
     整套动画都变成慢动作，点一张题签要等两秒才看清，云也散在兽出现之前。
     现在改成：dt 用真实时间，只防切标签页；弹簧自己在内部切成小步长积分。 */
  const dt = VDT !== null ? VDT : Math.min(0.25, (now - lastT) / 1000);
  lastT = now;
  state.vclock = (state.vclock || 0) + dt;

  // 手部点每帧重算一次（检测本身是异步的，这里只做平滑和几何换算）
  readHand(state.hands);
  state.hasPerson = !!(state.palm && state.palm.ok);

  tuneSegGap(dt);

  // 色温每 40 帧采一次（约 0.7s@60fps），配合缓存键量化，避免频繁重烘焙
  if (++tintTick % 40 === 0) sampleTint();

  drawFrame(dt);

  /* 画完这一帧才判定冻结 —— 冻住的就是"刚好跑到 freeze 点"那张 */
  if (FREEZE_AT !== null && !state.frozen && state.summonT0 &&
      ((state.vclock || 0) - (state.summonV || 0)) >= FREEZE_AT) {
    state.frozen = true;
  }

  updateHint();

  requestAnimationFrame(loop);
}

let hintMode = '';
function updateHint() {
  let mode = 'hidden';
  if (!state.running) mode = 'hidden';
  else if (!state.palm || !state.palm.ok) mode = 'hand';
  else if (state.palm.w < view.w * 0.055) mode = 'near';
  else if (state.active && state.palm.votes === 0) mode = 'fist';
  if (mode === hintMode) return;
  hintMode = mode;
  const handEl = hint.querySelector('.hint-hand');
  if (mode === 'hidden') {
    hint.classList.remove('show');
    return;
  }
  /* 三种引导，虚线的"张开手掌"图只在还没比划对的时候出现：
     - hand（没看到手）：虚线手掌 + 主文案 + 副文案"对准屏幕中央"
     - near（手太远）：虚线手掌 + "手再靠近一点"，副文案隐藏
     - fist（攥拳）：已经有了真手，虚线图收起，只留一行提示 */
  hintP.textContent = mode === 'hand'
    ? '把手掌张开'
    : mode === 'near' ? '手再靠近一点'
    : '攥拳它就收了，张手它才出来';
  if (hintSub) hintSub.style.display = (mode === 'hand') ? '' : 'none';
  if (handEl) handEl.style.display = (mode === 'fist') ? 'none' : '';
  hint.classList.add('show');
}

function drawFrame(dt) {
  if (state.frozen) return;          // ?freeze 定格后保留上一帧，不重绘
  ctx.clearRect(0, 0, view.w, view.h);

  const beast = state.active;
  if (!beast || !beast.ready) return;

  // ---- 目标 ----
  let tx, ty, sTarget, rTarget;

  /* 落点：掌心正中。
     以前是「兽的底缘压在掌心偏下方」—— 那套是为"坐在手上"服务的。
     现在改成从掌心里穿越出来，锚点必须是掌心本身，而不是掌心的下沿：
     东西是从这儿长出去的，重心就落在这儿。 */
  const palmOK = !!(state.palm && state.palm.ok && state.palm.w > view.w * 0.024);

  /* 攥拳 = 什么都没有。
     palmOK 依然是 true —— 位置和尺寸还要按这只手算，
     否则兽会突然飞向肩膀；只是显示被压掉。 */
  /* 伸出去的指数：0~4。张开手掌是 4，攥拳是 0~1。
     阈值放在「三根以上算打开」—— 四指伸三根已经能看出是在伸手，
     一根都没伸才算"攥着，什么也不给"。 */
  /* 伸出去几根。0 = 一根都没有（真攥拳）→ 什么都不给；
     ≥1 就已经算"伸手" → 云可以飘、兽可以出来。 */
  const votes = (state.palm && state.palm.ok && state.palm.votes !== undefined)
    ? state.palm.votes : 4;
  const fist = palmOK && votes <= TUNE.open;
  const openOK = palmOK && !fist;

  /* 手一攥紧，云也跟着收 —— 老师说的是"手指伸出时云才飘出来"，
     所以攥拳时云和兽一起退场。0.3 秒淡掉，不是"啪"地一下没了。 */
  const cv = state.cloudVis === undefined ? 1 : state.cloudVis;
  state.cloudVis = clamp(cv + ((fist ? 0 : 1) - cv) * Math.min(1, dt / 0.14), 0, 1);

  /* 张开手掌的那一瞬间 → 召唤一次。
     所以"攥起来 → 摊开"本身就是一次出场，不用再点卡片。
     攥过拳的话 force 一次，绕过下面的防抖间隔。 */
  if (openOK && !state.prevOpen) startSummon(!!state.pendingSummon);
  state.prevOpen = openOK;
  if (openOK) state.pendingSummon = false;

  /* 出场进度走墙上时钟（SUMMON_DUR 内走完）。 */
  const sumT = MAGIC_HOLD !== null
    ? MAGIC_HOLD
    : (state.summonT0
        ? clamp(((state.vclock || 0) - (state.summonV || 0)) / SUMMON_DUR, 0, 1)
        : 1);
  const reveal = clamp((sumT - REVEAL_AT) / REVEAL_SPAN, 0, 1);

  /* 云散到 REVEAL_AT 才把兽放出来。放的那一刻弹簧从 5% 撑到 100%，
     会过冲到 ~1.08 再收回来 —— 那一下就是"它弹了一下"。 */
  if (reveal > 0 && !state.released && !fist) {
    state.released = true;
    state.releasedV = state.vclock || 0;   // 小动作（弹跳/扭头）从这一刻起算
    spring.s.snap(0.05);
    spring.s.target = 1;
    spring.a.snap(0);
    spring.a.target = 1;
    sfxChime();                            // 磬：它现形了
    sfxHop();                              // 脚尖离地那一下
    showLore(beast);                       // 寓意祝福：兽真的现形了才念
  }

  const anchorImg = beast.imgEl;
  const ar0 = (anchorImg && anchorImg.naturalWidth)
    ? anchorImg.naturalHeight / anchorImg.naturalWidth : 1;
  const estBh = (state.palm && palmOK)
    ? state.palm.w * TUNE.size * (beast.w / 0.74) * ar0
    : 0;

  const ancPalm = palmOK
    ? (() => {
        /* 稳态：底缘略高于掌心（0.06 兽高），整只朝掌心上方长。
           但缩到 5% 的时候还按这个算，一只小东西会沉在掌心下方
           一指远的地方，看着就不是从手里出来的 ——
           所以按 (1 - 当前缩放) 把底缘往下补，让【兽的中心】落在掌心上。 */
        const estSink = estBh * TUNE.sink;
        /* 上下可用区。木轴从 32px 加粗到 64px 之后，
           这两个数必须跟着改，否则兽会钻到轴后面、或者被卡片条切掉一截。
           上：木轴下沿（64/600 ≈ 0.107，留一点余量取 0.105）
           下：卡片条上沿（底部 64 + 8 + 104 ≈ 176px，600 高时 0.707） */
        const topLimit = view.h * 0.105;
        const botLimit = view.h * 0.735;
        const sNow = Math.min(1, Math.max(0, spring.s.value));
        let ay = state.palm.y - estBh * 0.06 + (1 - sNow) * estBh * 0.09;
        // 先保证进不了签条，再保证顶不出画面；两条都满足不了就靠上边
        if (ay + estSink > botLimit) ay = botLimit - estSink;
        if (ay - estBh + estSink < topLimit) ay = topLimit + estBh - estSink;
        return { x: state.palm.x, y: ay };
      })()
    : null;
  const ancOld = (state.anchors && beast.at && state.anchors[beast.at])
              || state.lastAnchor;
  const anc = ancPalm || ancOld;

  if (anc && state.hasPerson) {
    tx = anc.x;
    ty = anc.y + (palmOK ? 0 : state.headW * beast.y);
    sTarget = 1;
    rTarget = state.tilt;
  } else {
    tx = spring.x.target;
    ty = spring.y.target;
    sTarget = 1;
    rTarget = spring.r.target * 0.94;
  }

  spring.x.target = tx;
  spring.y.target = ty;
  /* 云没散开之前把尺寸按住（0.05），不许提前长出来 */
  spring.s.target = (state.summonT0 && !state.released) ? 0.05 : sTarget;
  spring.r.target = rTarget;

  /* 显示与否，三件事分开管：
     ① 手离开了画面 —— 留 0.55s 延迟，检测偶尔丢一两帧不该闪；
     ② 攥拳 —— 原地淡掉，位置不动（手还在，只是不出东西了）；
     ③ 摊开 —— 等云散到 REVEAL_AT 才露面。 */
  if (!palmOK) {
    state.palmLost = (state.palmLost || 0) + dt;
    if (state.palmLost > 0.55) spring.a.target = 0;
  } else if (fist) {
    state.palmLost = 0;
    /* 握拳 = 把兽召回去。老师要它「嗖」地收走、别赖在画面上，
       所以这里不靠慢悠悠的弹簧淡出，而是直接把 alpha 掐到 0
       （spring.a.target=0 + snap 让当前值立刻归零），云也一起收掉。 */
    /* 只在「刚攥拳」的那一刻播一次退场音，别每帧重复响 */
    if (!state.wasFist && state.released) sfxWhooshOut();
    state.wasFist = true;
    spring.a.target = 0;
    spring.a.snap(0);
    state.cloudVis = 0;
    state.released = false;      // 收走后，下次张手重新走一遍召唤
    state.summonT0 = 0;          // 出场进度清零，下一次是全新一轮
    state.pendingSummon = true;  // 攥过了，下次摊开必定重播
  } else {
    state.palmLost = 0;
    state.wasFist = false;
    spring.a.target = state.released ? 1 : 0;
  }

  stepSpring(spring.x, dt); stepSpring(spring.y, dt);
  stepSpring(spring.s, dt); stepSpring(spring.r, dt); stepSpring(spring.a, dt);
  stepSpring(spring.dip, dt);

  // ---- 呼吸 ----
  bobT += dt;

  /* 尺寸：有手就按掌宽定，没手才按头宽。
     1.32 倍掌宽 —— 比手大一圈。这一条是「分量」的来源：
     托着的东西比手掌小，那就只是个轻飘飘的小玩意儿；
     比手掌大、边缘还压在手外面的，才叫"抱着""坠着"。
     早先 1.06 倍之所以像贴纸，不是因为大，是因为那时候
     边缘还有一圈白描边和一块灰垫片 —— 边缘干净了，大才不会露怯。 */
  const baseW = palmOK
    ? state.palm.w * TUNE.size * (beast.w / 0.74)
    : state.headW * beast.w * 1.42;

  const img0 = beast.imgEl;
  const ar = img0.naturalHeight / img0.naturalWidth || 1;
  let bw = baseW * spring.s.value;
  let bh = bw * ar;
  /* 高度上限。木轴加粗后可用区变窄了，所以这里从 0.86h 收到
     可用区的 1.15 倍 —— 允许兽稍微探出上轴一点（像从画里钻出来），
     但不许整只压到轴上。 */
  const availH = view.h * (0.735 - 0.105);
  const capH = clamp(spring.y.value * 1.15, view.h * 0.22, availH * 1.15);
  if (bh > capH) {
    const k = capH / bh;
    bw *= k; bh *= k;
  }

  const w = bw;
  /* 呼吸：越大越沉，起伏就得越小、越慢。
     沉甸甸的东西不会上下轻快地漂 —— 那是氢气球。
     幅度和频率一起收，剩下的那点起伏才像"活着"，不像"飘着"。 */
  const bob = Math.sin(bobT * 1.15) * w * TUNE.bob;
  const sway = Math.sin(bobT * 0.72 + 1.1) * 0.0085;

  // 转头时兽跟着侧过去：横向收一点，整体略微滞后（视差），投影方向也跟着偏
  /* ---- 出场小动作 ----
     从现形那一刻（releasedV）起算，全部走虚拟时钟，低帧率也不会变慢：
       0 ~ 0.46s    落地弹一下 —— 弹簧管"撑开"，这一段管"跳"
       0.50 ~ 1.7s  扭头看两下 —— 幅度递减，像它刚出来在打量四周
     没有这两下，它就是个"啪"地出现的贴纸 —— 有动静才像个活物。 */
  const actT = state.releasedV !== undefined
    ? (state.vclock || 0) - state.releasedV
    : 99;
  const hop = (actT >= 0 && actT < 0.46)
    ? Math.sin((actT / 0.46) * Math.PI) * bh * 0.055
    : 0;
  const actYaw = (actT > 0.50 && actT < 1.70)
    ? Math.sin((actT - 0.50) * Math.PI * 1.7) * 0.28
      * Math.max(0, 1 - (actT - 0.50) / 1.2)
    : 0;

  // 头朝哪边本来是跟着人走的，出场时叠一下"扭头"
  const yaw = clamp((state.yaw || 0) + actYaw, -0.85, 0.85);
  const squeeze = 1 - Math.min(0.20, Math.abs(yaw) * 0.30);

  /* 手掌本身的倾角：手横过来，兽就跟着躺过去。
     只取六成，全跟会像焊死在手上，不像"坐在上面"。 */
  const palmRot = palmOK ? clamp(state.palm.roll, -0.9, 0.9) * 0.6 : 0;

  /* 惯性：手快速移动的一瞬间，身子往后仰一点。
     这一条专治"轻"——真东西有质量，跟着手走时会滞后。 */
  const leanX = clamp(-spring.x.v * 0.00042, -0.085, 0.085);
  const leanY = clamp(spring.y.v * 0.00022, -0.05, 0.05);

  const cx = spring.x.value - yaw * w * 0.055;
  /* 落定下沉不能全走位移。
     兽高 605、画面 900，上下木轴和底部卡片条要吃掉 200px；
     0.14 的下沉量折成整只位移是 85px，底缘会直接掉到卡片条后面，
     「沉一下」这个动作等于被 UI 吃掉，白做了。
     所以一半走位移、一半转成压扁 —— 东西压在手上本来就是
     底缘被压塌、重心下沉，不是整只往下掉。 */
  const dipNow = spring.dip.value;
  const cy = spring.y.value + bob + dipNow * bh * TUNE.dip * 0.55 - hop;
  const rot = spring.r.value + sway + palmRot + leanX;
  const alpha = clamp(spring.a.value, 0, 1);

  /* 底部坐实：被掌心压住的那一圈向内收。
     东西越大，掌心的那点承托越托不住，底缘就会被压得更塌 ——
     所以这个量和尺寸一起放大，不能还是 0.062。 */
  const squash = palmOK
    ? TUNE.hug + Math.max(0, dipNow) * TUNE.dip * 0.55
    : 0.024;

  const img = beast.imgEl;

  // ---- 兽本体（连同侧壁 / 织纹 / 轮廓光一起烘好的那张） ----
  const baked = paintBeast(beast, state.tint);
  if (window.__dbgBaked) window.__baked = baked;   // 调试：把烘焙层挂出去，方便导出检查
  /* 陷进手掌的深度。比 0.055 更深 —— 大件东西的重量首先体现在这里：
     底缘不是"贴"在掌面上，而是"压"进去一点，被手接住了。 */
  const sink = bh * (TUNE.sink + Math.min(0.035, Math.abs(yaw) * 0.05));

  const useMask = seg.ok && !!seg.cv && state.hasPerson;
  if (useMask) ensureTemps();

  // ---- 0) 祥云：从掌心升起来的那一团 ----
  /* 云不跟兽的透明度走。兽是「从云里被托出来」的，本来就应该
     云先到、兽后现 —— 乘同一个 alpha，等于让云在兽清楚之前就散完，
     白白花掉一次出场。尺寸也用目标宽度，云才"含得住"整只。 */
  /* 云气从**掌心**冒，不是从兽的底缘冒。
     cy 是兽的底缘，掌心在它上方 0.26 兽高处 —— 也就是这套锚点
     反推出来的 palm.y。云不从掌心出，就不是"从手里变出来"。 */
  const cloudY = palmOK ? state.palm.y : cy + bh * 0.06;
  let magicP = -1;                          // <0 表示这次不出云
  if (MAGIC_HOLD !== null) {
    magicP = MAGIC_HOLD;                    // 调试定格（?magicp=0.35）
  } else if (state.magic && state.magic.on) {
    /* 云在全程 90% 处散尽（2.4s × 0.9 ≈ 2.16s）。
       攥拳时不必特意掐掉它 —— 那时兽已经淡了，云自己飘完就行。 */
    magicP = clamp(sumT / 0.78, 0, 1);
    if (sumT >= 1) state.magic.on = false;
  }
  if (magicP >= 0) drawCloud(ctx, cx, cloudY, baseW * 1.26, magicP, state.cloudVis);

  // ---- 0.5) 接触阴影：紧贴掌心的一圈短影 ----
  // 这一层和"糊一圈黑边"是两回事：半径小、颜色深、贴着接触面，
  // 而且跟着手掌倾角走。浮着的东西没有这一圈。
  // 注意要加上 sink —— 兽的底缘被往下压了 sink，阴影留在原地就被整只盖住了，
  // 看上去就是"没有阴影、悬在半空"。
  if (palmOK && !NO_CONTACT) drawContact(ctx, cx, cy + sink, bw, bh, rot, alpha, beast);

  // ---- 1) 旧阴影层：只在「没有手」的老场景里用 ----
  // 有手的时候它坏事：模糊的大团暗影会从兽身轮廓外漏出来，
  // 在手掌上摊成一块灰褐色的板子，看着像垫了块石头。
  // 手部场景改用 drawContact() 那一圈紧贴的短影。
  if (useMask && !palmOK) {
    const sp = shadowOf(beast);
    const k = (bw / sp.dw) * 1.04;
    const ox = -bw / 2 + w * 0.015 - yaw * w * 0.16;
    const oy = -bh + sink + bh * 0.11;

    shCtx.setTransform(1, 0, 0, 1, 0, 0);
    shCtx.clearRect(0, 0, shCv.width, shCv.height);
    shCtx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    shCtx.save();
    shCtx.translate(cx, cy);
    shCtx.rotate(rot);
    shCtx.scale(squeeze, 1);
    shCtx.drawImage(sp.cv,
      ox - sp.pad * k, oy - sp.pad * k,
      sp.cv.width * k, sp.cv.height * k);
    shCtx.restore();

    shCtx.globalCompositeOperation = 'destination-in';
    drawMaskTo(shCtx);

    /* 再用兽自己的形状裁一次。
       分割遮罩经常把整面墙都算成「人」（孩子站得近、占满画面时尤其明显），
       只靠遮罩的话，一圈糊开的阴影会顺着铺到半面墙上去，
       在墙上留下一条颜色不一样的带子。用兽形当上限就绝不会漏。 */
    shCtx.save();
    shCtx.translate(cx, cy);
    shCtx.rotate(rot);
    shCtx.scale(squeeze, 1);
    shCtx.globalCompositeOperation = 'destination-in';
    {
      const kk = bw / baked.dw;
      shCtx.drawImage(
        baked.cv,
        -bw / 2 - baked.ox * kk, -bh + sink - baked.oy * kk,
        baked.cv.width * kk, baked.cv.height * kk
      );
    }
    shCtx.restore();

    // 只往下留：把阴影上缘削掉，否则糊一圈会变成“贴纸黑边”
    const gTop = cy - bh * 0.42;
    const gBot = cy + sink + bh * 0.16;
    const gs = shCtx.createLinearGradient(0, gTop, 0, gBot);
    gs.addColorStop(0, 'rgba(0,0,0,0)');
    gs.addColorStop(0.55, 'rgba(0,0,0,0.45)');
    gs.addColorStop(1, 'rgba(0,0,0,1)');
    shCtx.fillStyle = gs;
    shCtx.fillRect(0, gTop, view.w, gBot - gTop);
    shCtx.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.globalAlpha = alpha * 0.60;
    ctx.drawImage(shCv, 0, 0, view.w, view.h);
    ctx.restore();
  }

  // ---- 2) 兽本体 ----
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.scale(squeeze, 1);
  if (!useMask) {
    // 没有分割时退回原来的轮廓投影
    ctx.shadowColor = `rgba(20,11,4,${(0.62 * (beast.ao ?? 0.42) / 0.42).toFixed(2)})`;
    ctx.shadowBlur = Math.max(6, w * 0.075);
    ctx.shadowOffsetY = Math.max(3, bh * 0.06);
  }
  {
    /* 缓存画布里，内容并不总在正中央（图有留白时会居中）。
       所以不能假设「画布左上 = 内容左上 - PAD」，
       必须按 paintBeast 回报的内容矩形做真正的映射，
       否则兽会被悄悄压扁、挪位。 */
    const k = bw / baked.dw;                       // 源像素 → 屏幕像素
    const allX = -bw / 2 - baked.ox * k;
    const allY = (-bh + sink) - baked.oy * k;
    // 肩是个圆柱，图是平的：两侧抬 4.5%，整只就顺着肩弯过去
    const curv = (SOLID && !NO_BEND) ? bw * 0.030 : 0;
    drawBeastSliced(
      ctx, baked.cv,
      allX, allY, baked.cv.width * k, baked.cv.height * k,
      curv, squash
    );
  }
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.restore();

  // ---- 2.5) 前景雾：几缕气从兽前面掠过 ----
  // 云全在背后就只是"贴了张背景"；得有一层盖在它前面，才叫"从雾里出来"。
  if (magicP >= 0) drawCloudFront(ctx, cx, cloudY, baseW * 1.26, magicP, state.cloudVis);

  // ---- 3) 真遮挡：头发 / 肩膀压住底座，露出的是摄像头原像素 ----
  // 这一段是“长在身上”的关键：底座不再是硬边，而是被前景吃掉。
  if (useMask && !NO_OCC) {
    ocCtx.setTransform(1, 0, 0, 1, 0, 0);
    ocCtx.clearRect(0, 0, ocCv.width, ocCv.height);
    ocCtx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);

    drawVideoTo(ocCtx);
    ocCtx.globalCompositeOperation = 'destination-in';
    drawMaskTo(ocCtx);

    ocCtx.save();
    ocCtx.translate(cx, cy);
    ocCtx.rotate(rot);
    ocCtx.scale(squeeze, 1);

    /* 头发/肩膀压住兽的底座 —— 但只能压兽自己那一块。
       先按兽形裁，再叠底部渐变；顺序反过来，就会把旁边半面墙
       一起「盖」回画面上，露出一块颜色不一样的方块。 */
    ocCtx.globalCompositeOperation = 'destination-in';
    {
      const kk = bw / baked.dw;
      ocCtx.drawImage(
        baked.cv,
        -bw / 2 - baked.ox * kk, -bh + sink - baked.oy * kk,
        baked.cv.width * kk, baked.cv.height * kk
      );
    }
    /* 手掌从前面托住它：把「兽 ∩ 掌心」这一小块换成摄像头像素。
       有了这一步，手和兽才有前后关系 —— 有前后才有体积。
       椭圆必须压得很扁（高度只取 0.055 兽高，且圆心压到兽底缘以下）：
       给它 0.125 的时候，物件一大，椭圆的绝对高度就到 45px，
       一大块兽底被换成半透明的手指像素，像肚皮下插了张纸片。
       注意是先按椭圆裁、再叠底部渐变，两个都只是"限制"，不会画出新东西。 */
    if (palmOK) {
      ocCtx.globalCompositeOperation = 'destination-in';
      ocCtx.beginPath();
      ocCtx.ellipse(0, bh * 0.006, bw * 0.66, bh * 0.055, 0, 0, Math.PI * 2);
      ocCtx.fillStyle = '#000';
      ocCtx.fill();
    }

    /* 只在最下缘一点点替换成摄像头像素。
       范围给大了，整只兽会被"洗淡"，在半透明里透出后面的毛衣 ——
       那不是被压住，是变成玻璃了。真正的遮挡只发生在接触的那几毫米。 */
    const g = ocCtx.createLinearGradient(0, -bh * 0.038, 0, sink);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0.92)');
    ocCtx.fillStyle = g;
    ocCtx.fillRect(-bw, -bh * 0.038, bw * 2, bh * 0.038 + sink);
    ocCtx.restore();
    ocCtx.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(ocCv, 0, 0, view.w, view.h);
    ctx.restore();
  }
}

/* ---------------- 摄像头 ---------------- */

/* 摄像头失败时，告诉老师到底卡在哪一步，而不是留一块黑屏 */
function camReason(err) {
  if (!window.isSecureContext || !navigator.mediaDevices) {
    return '这个地址浏览器不给开摄像头。请用启动窗口里的 https 地址打开。';
  }
  const n = (err && err.name) || '';
  if (n === 'NotAllowedError' || n === 'SecurityError') {
    return '摄像头权限被拒了。点地址栏左边的小锁 / 相机图标，允许后刷新。';
  }
  if (n === 'NotFoundError' || n === 'OverconstrainedError') {
    return '没找到摄像头，检查一下摄像头有没有插好。';
  }
  if (n === 'NotReadableError' || n === 'AbortError') {
    return '摄像头被别的程序占着，先关掉微信 / 钉钉 / 相机再试。';
  }
  return '摄像头没打开，点下面按钮再试。';
}

async function startCamera() {
  if (!window.isSecureContext || !navigator.mediaDevices) {
    throw new DOMException('insecure context', 'SecurityError');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: 'user',
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 },
    },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  await new Promise(res => {
    if (video.videoWidth) return res();
    video.onloadedmetadata = () => res();
  });
  resize();
}

/* ---------------- 姿态模型 ---------------- */

let handLandmarker = null;

/* ---------------- 人体分割（让贴片“长”在身上） ----------------
   Xmax 那种融合之所以真，靠三件事：投影落在人身上、遮挡对、
   光色一致。这三件都不需要大模型，一张 244KB 的分割模型就够。
   所以这里跑一个人像分割，把人的轮廓当遮罩用。            */

let segmenter = null;
const seg = { cv: null, ctx: null, busy: false, last: 0, ok: false };
/* 先把画面缩到 256×144 再分割：
   1) 模型输入本来就只有 256，喂大图是浪费；
   2) 遮罩尺寸跟着输入走，原尺寸 1280×720 每帧读回 92 万像素，光这一项就掉到 4 帧。 */
const segIn = document.createElement('canvas');
segIn.width = 256;
segIn.height = 144;
const segInCtx = segIn.getContext('2d', { willReadFrequently: true });
/* 帧率自适应：平板/大屏性能差时自动放慢分割，宁可遮罩糙一点也别卡 */
let segGap = 110;
let segDt = 0.02;
function tuneSegGap(dt) {
  segDt = segDt * 0.9 + dt * 0.1;
  segGap = segDt > 0.045 ? 260 : segDt > 0.030 ? 170 : 110;
}

async function initSeg() {
  const fileset = await FilesetResolver.forVisionTasks('./vendor/wasm');
  segmenter = await ImageSegmenter.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: './vendor/selfie_segmenter.tflite',
      delegate: 'CPU',
    },
    runningMode: 'VIDEO',
    outputCategoryMask: true,
    outputConfidenceMasks: false,
  });
  seg.ok = true;
}

function runSeg(now) {
  if (!segmenter || seg.busy || now - seg.last < segGap) return;
  if (!video.videoWidth) return;
  seg.last = now;
  seg.busy = true;
  try {
    segInCtx.drawImage(video, 0, 0, segIn.width, segIn.height);
    segmenter.segmentForVideo(segIn, now, (res) => {
      const m = res && res.categoryMask;
      if (m) {
        const w = m.width, h = m.height;
        const arr = m.getAsUint8Array();
        if (!seg.cv) {
          seg.cv = document.createElement('canvas');
          seg.ctx = seg.cv.getContext('2d');
        }
        if (seg.cv.width !== w || seg.cv.height !== h) {
          seg.cv.width = w; seg.cv.height = h;
        }
        const img = seg.ctx.createImageData(w, h);
        const d = img.data;
        for (let i = 0, j = 0; i < arr.length; i++, j += 4) {
          // 分割结果：0 背景，非 0 是人
          d[j] = d[j + 1] = d[j + 2] = 255;
          d[j + 3] = arr[i] ? 255 : 0;
        }
        seg.ctx.putImageData(img, 0, 0);
        if (m.close) m.close();
      }
      seg.busy = false;
    });
  } catch (e) {
    seg.busy = false;
  }
}

/* 把人物遮罩按“cover + 镜像”贴到目标画布，和摄像头画面严丝合缝 */
function drawMaskTo(c) {
  if (!seg.cv) return false;
  const p = mapPt(0, 0);           // p.x 是画面右缘，p.dw / p.dh 是铺满后的尺寸
  c.save();
  c.translate(p.x, p.y);
  c.scale(-1, 1);
  c.drawImage(seg.cv, 0, 0, p.dw, p.dh);
  c.restore();
  return true;
}

/* 把摄像头画面按同样变换贴进离屏（用于“头发盖住底座”的真遮挡） */
function drawVideoTo(c) {
  const p = mapPt(0, 0);
  c.save();
  c.translate(p.x, p.y);
  c.scale(-1, 1);
  c.drawImage(video, 0, 0, p.dw, p.dh);
  c.restore();
}

/* 兽的剪影，预先糊一次，之后每帧只管贴 —— 省得每帧做高斯模糊 */
function shadowOf(beast) {
  if (beast._sh) return beast._sh;
  const iw = beast.imgEl.naturalWidth || 512;
  const ih = beast.imgEl.naturalHeight || 512;
  const S = 256;
  const k = S / Math.max(iw, ih);
  const dw = iw * k, dh = ih * k;
  const pad = 32;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(dw + pad * 2);
  cv.height = Math.ceil(dh + pad * 2);
  const c = cv.getContext('2d');
  c.filter = 'blur(17px)';
  c.drawImage(beast.imgEl, pad, pad, dw, dh);
  c.filter = 'none';
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = 'rgb(28,17,8)';
  c.fillRect(0, 0, cv.width, cv.height);
  c.globalCompositeOperation = 'source-over';
  beast._sh = { cv, dw, dh, pad };
  return beast._sh;
}

async function initHand() {
  const fileset = await FilesetResolver.forVisionTasks('./vendor/wasm');
  const opts = {
    baseOptions: { modelAssetPath: './vendor/hand_landmarker.task' },
    runningMode: 'VIDEO',
    numHands: 2,
    /* 放宽检测置信度：3-6 岁孩子手小、站得散、弱光下，0.45 容易判不出来。
       降到 0.35 让小手更好识别，代价是偶发误检（可接受）。 */
    minHandDetectionConfidence: 0.35,
    minHandPresenceConfidence: 0.35,
    minTrackingConfidence: 0.4,
  };
  try {
    handLandmarker = await HandLandmarker.createFromOptions(
      fileset, { ...opts, baseOptions: { ...opts.baseOptions, delegate: 'GPU' } });
  } catch (e) {
    /* GPU 起不来（无 WebGL2 的低端平板/旧 iOS）就回退 CPU，别让设备直接不能用 */
    console.warn('GPU 手势模型失败，回退 CPU', e);
    handLandmarker = await HandLandmarker.createFromOptions(
      fileset, { ...opts, baseOptions: { ...opts.baseOptions, delegate: 'CPU' } });
  }
}

let lastDetect = 0;
async function detectLoop(now) {
  if (!handLandmarker || !video.videoWidth) {
    requestAnimationFrame(detectLoop);
    return;
  }
  /* 手势检测降到 ~30Hz（33ms 一次）—— 手势是慢动作，30Hz 足够，
     每帧同步跑 detectForVideo 会阻塞主线程、和绘制抢时间，低端平板掉帧。 */
  const ts = now || performance.now();
  if (!detectBusy && ts - lastDetect >= 33) {
    lastDetect = ts;
    detectBusy = true;
    try {
      const res = handLandmarker.detectForVideo(video, ts);
      state.hands = res && res.landmarks && res.landmarks.length
        ? res.landmarks
        : null;
    } catch (e) { /* 单帧失败不致命 */ }
    detectBusy = false;
  }
  runSeg(ts);
  requestAnimationFrame(detectLoop);
}

/* ---------------- 拍照 ---------------- */

let shooting = false;
function shoot() {
  if (shooting) return;               // 防连点
  shooting = true;
  setTimeout(() => { shooting = false; }, 800);

  if (!video.videoWidth) return toast('画面还没准备好');

  const W = Math.round(view.w * view.dpr);
  const H = Math.round(view.h * view.dpr);
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const c = out.getContext('2d');

  // 1) 摄像头画面，按 cover + 镜像还原
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  const s = Math.max(W / vw, H / vh);
  const dw = vw * s, dh = vh * s;
  const ox = (W - dw) / 2, oy = (H - dh) / 2;

  c.save();
  c.translate(W, 0);
  c.scale(-1, 1);
  c.drawImage(video, W - ox - dw, oy, dw, dh);
  c.restore();

  // 2) 兽层（就是屏幕上那层）
  c.drawImage(canvas, 0, 0, W, H);

  // 3) 落款：右下角一方小印
  const fs = Math.max(16, W * 0.016);
  c.font = `600 ${fs}px "Songti SC", serif`;
  c.textBaseline = 'bottom';
  const label = '宋锦小灵兽';
  const tw = c.measureText(label).width;
  const padX = fs * 0.5, padY = fs * 0.35;
  const bw = tw + padX * 2, bh = fs + padY * 2;
  const bx = W - bw - W * 0.035, by = H - bh - H * 0.04;
  c.fillStyle = 'rgba(178,58,46,0.92)';
  c.fillRect(bx, by, bw, bh);
  c.fillStyle = '#FBEFE6';
  c.fillText(label, bx + padX, by + bh - padY * 0.85);

  const flash = document.createElement('div');
  flash.className = 'flash go';
  heart.appendChild(flash);
  setTimeout(() => flash.remove(), 400);

  out.toBlob(blob => {
    if (!blob) return toast('没存下来，再试一次');
    const url = URL.createObjectURL(blob);
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const fname = `宋锦小灵兽-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;

    /* iOS Safari 上 a.download 不会真正存进相册，只会新开标签或无效。
       优先走系统分享（navigator.share 支持文件分享），iOS 会弹出"存储图像"。
       不支持分享的老设备再退回 download。 */
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (navigator.canShare && navigator.canShare({ files: [] })) {
      const file = new File([blob], fname, { type: 'image/png' });
      navigator.share({ files: [file] })
        .then(() => toast('已保存，可在相册查看', 1800))
        .catch(err => { if (err.name !== 'AbortError') fallbackDownload(); });
    } else if (isIOS) {
      // iOS 老版本：长按图片保存（打开一个新窗口展示，提示长按）
      const w = window.open(url, '_blank');
      toast('长按图片即可保存到相册', 2600);
    } else {
      fallbackDownload();
    }

    function fallbackDownload() {
      const a = document.createElement('a');
      a.download = fname;
      a.href = url;
      a.click();
      toast('已下载', 1600);
    }
    setTimeout(() => URL.revokeObjectURL(url), 8000);
  }, 'image/png');
}

/* ---------------- 手感调试面板 ---------------- */

/* 只在 ?tune=1 时出现。滑块直接改 TUNE，drawFrame 每帧都读 TUNE，
   所以拖动是实时的，不需要重建任何东西。 */
function initTune() {
  if (!DBG.get('tune')) return;
  const panel = $('tune'), body = $('tuneBody'), openBtn = $('tuneOpen');
  if (!panel || !body) return;

  const rows = {};
  for (const k in TUNE_DEF) {
    const d = TUNE_DEF[k];
    const row = document.createElement('div');
    row.className = 'tune-row';

    const lab = document.createElement('div');
    lab.className = 'tune-lab';
    const nm = document.createElement('span');
    nm.textContent = d.name;
    const val = document.createElement('i');
    lab.append(nm, val);

    const inp = document.createElement('input');
    inp.type = 'range';
    inp.min = d.min; inp.max = d.max; inp.step = d.step;
    inp.value = TUNE[k];

    const dec = d.step < 0.001 ? 4 : 3;
    const show = () => { val.textContent = TUNE[k].toFixed(dec); };
    show();

    inp.addEventListener('input', () => {
      TUNE[k] = parseFloat(inp.value);
      show();
    });

    row.append(lab, inp);
    body.appendChild(row);
    rows[k] = { inp, show };
  }

  $('tuneReset').addEventListener('click', () => {
    for (const k in TUNE_DEF) {
      TUNE[k] = TUNE_DEF[k].v;
      rows[k].inp.value = TUNE[k];
      rows[k].show();
    }
    toast('已复位');
  });

  $('tuneCopy').addEventListener('click', async () => {
    const txt = Object.keys(TUNE_DEF).map(k => `${k}=${TUNE[k]}`).join('&');
    try {
      await navigator.clipboard.writeText(txt);
      toast('参数已复制，发给我就行');
    } catch (e) {
      // http 下没有剪贴板权限，退回一个可选中的框
      window.prompt('把这一串发给我：', txt);
    }
  });

  $('tuneClose').addEventListener('click', () => {
    panel.hidden = true; openBtn.hidden = false;
  });
  openBtn.addEventListener('click', () => {
    panel.hidden = false; openBtn.hidden = true;
  });

  panel.hidden = false;
}

/* ---------------- 启动 ---------------- */

async function boot() {
  buildCards();
  resize();
  initTune();

  /* 默认先选中第一只（龟背纹），孩子第一次张手就有兽出来，
     不用先琢磨「要先点下面选一只」—— 那是给大人/想换兽时用的。
     注意：这里静默选中，不调 pick() 的音效/解锁 —— 启动时还没点「开始」，
     提前创建 AudioContext 会被 iOS 判成"非用户手势"，之后解锁会失效、音效全静音。 */
  if (BEASTS.length) {
    state.active = BEASTS[0];
    state.pendingSummon = true;
    state.summonT0 = 0;
    state.released = false;
    state.cloudVis = 0;
    state.prevOpen = false;
    BEASTS[0].card.classList.add('on');
  }

  try {
    veilNote.textContent = '小灵兽正在赶来…';
    await startCamera();
    veilNote.textContent = '正在学习你的小手…';
    await initHand();
    // 分割模型失败不影响游戏，只是立体感退一档
    if (!seg.ok) {
      try { await initSeg(); } catch (e) { console.warn('分割模型没起来', e); }
    }
    state.running = true;
    /* 加载完成，不直接进游戏 —— 显示「开始」按钮，等老师/孩子点一下。
       这一下点击是 iOS 上唯一可靠的音频解锁手势，也是教室场景的"开始"闸门
       （老师确认环境 OK 了再让孩子玩）。 */
    veilNote.textContent = '准备好啦';
    const ld = $('veilLoading'); if (ld) ld.classList.add('off');
    btnStart.hidden = false;
    btnStart.onclick = async () => {
      await unlockAudio();         // 用户手势里解锁音频，await 确保 iOS 真正唤醒
      btnStart.hidden = true;
      veil.classList.add('hide');
      requestAnimationFrame(loop);
      detectLoop();
      toast('张开手掌，选一只小兽试试吧', 2600);
    };
    /* iOS 自动播放策略兜底：就算没点「开始」，第一次任意触摸也解锁 */
    ['pointerdown', 'touchstart', 'keydown'].forEach(ev =>
      document.addEventListener(ev, unlockAudio, { once: true, passive: true }));
    /* 切后台再回来，把可能被挂起的 AudioContext 唤回来 */
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { try { unlockAudio(); } catch (e) { /* 忽略 */ } }
    });
  } catch (err) {
    console.error(err);
    state.running = true;
    requestAnimationFrame(loop);
    veilNote.textContent = camReason(err);
    const ld = $('veilLoading'); if (ld) ld.classList.add('off');
    btnStart.hidden = false;
    btnStart.onclick = async () => {
      try {
        btnStart.hidden = true;
        const ld2 = $('veilLoading'); if (ld2) ld2.classList.remove('off');
        veilNote.textContent = '小灵兽正在赶来…';
        await startCamera();
        if (!handLandmarker) await initHand();
        if (!seg.ok) {
          try { await initSeg(); } catch (e) { /* 忽略 */ }
        }
        veil.classList.add('hide');
        detectLoop();
        unlockAudio();   // 点「开始」本身就是一次用户手势，顺手解锁音频
      } catch (e2) {
        veilNote.textContent = camReason(e2);
        const ld3 = $('veilLoading'); if (ld3) ld3.classList.add('off');
        btnStart.hidden = false;
      }
    };
  }
}

/* ---------------- 用量条 ---------------- */

const meterBar = $('meterBar');
const meterPanel = $('meterPanel');
const btnLock = $('btnLock');
let locked = false;

function paintMeter() {
  const s = stats();
  $('mTime').textContent = fmtTime(s.secs);
  if (!meterPanel.hidden) {
    $('pTime').textContent = fmtTime(s.secs);
  }
}
paintMeter();
setInterval(paintMeter, 1000);

meterBar.addEventListener('click', () => {
  if (locked) { toast('课时锁已上，先解锁', 1200); return; }
  meterPanel.hidden = !meterPanel.hidden;
  paintMeter();
});

$('btnCsv').addEventListener('click', () => {
  if (locked) { toast('课时锁已上，先解锁', 1200); return; }
  exportCsv();
  toast('记录已导出', 1400);
});

/* 课时锁：按住一小会儿才切换，免得孩子乱点把设置改了 */
let lockTimer = 0;
function toggleLock() {
  locked = !locked;
  btnLock.textContent = locked ? '已锁定' : '课时锁';
  toast(locked ? '已锁定 · 孩子只能玩，改不了设置' : '已解锁', 1600);
}
btnLock.addEventListener('pointerdown', e => {
  e.preventDefault();
  clearTimeout(lockTimer);
  lockTimer = setTimeout(toggleLock, 900);
});
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev =>
  btnLock.addEventListener(ev, () => clearTimeout(lockTimer)));

$('btnShot').addEventListener('click', shoot);

/* 静音开关：课堂多台设备一起响时，老师一键静音。按钮文字「声/静」切换。 */
const btnMute = $('btnMute');
function paintMute() {
  btnMute.classList.toggle('off', isMuted());
  btnMute.querySelector('span').textContent = isMuted() ? '静' : '声';
}
btnMute.addEventListener('click', () => {
  setMuted(!isMuted());
  paintMute();
  toast(isMuted() ? '已静音' : '已开声音', 1100);
});
paintMute();

$('btnClear').addEventListener('click', () => {
  if (state.active && state.active.card) {
    state.active.card.classList.remove('gone');
    state.active.card.classList.remove('on');   // 取消卡片高亮
  }
  state.active = null;
  state.pendingSummon = false;
  state.summonT0 = 0;
  state.released = false;
  hideLore();               // 寓意文字也一起收掉
  toast('已收起', 1000);
});

$('btnFull').addEventListener('click', async () => {
  try {
    if (!document.fullscreenElement && !video.webkitDisplayingFullscreen) {
      /* iOS Safari 不支持元素级全屏，但支持 video 原生全屏；
         其它浏览器走标准 requestFullscreen。 */
      if (video.webkitEnterFullscreen && /iPad|iPhone|iPod/.test(navigator.userAgent)) {
        video.webkitEnterFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } else {
      if (video.webkitDisplayingFullscreen && video.webkitExitFullscreen) {
        video.webkitExitFullscreen();
      } else {
        await document.exitFullscreen();
      }
    }
  } catch (e) {
    toast('这个浏览器不让全屏');
  }
});

boot();

/* 调试口：控制台里可以直接摆位置试效果 */
window.__songjin = { state, spring, view, BEASTS, pick, seg, shadowOf, readHand,
  layers: { beastCv, shCv, ocCv, get seg() { return seg.cv; } } };
