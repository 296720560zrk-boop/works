/* ---------------- 音效 ----------------

   全部用 WebAudio 现场合成，不加载任何音频文件 ——
   这个页面要能在离线、弱网、U 盘里跑起来，多一个 mp3 就多一个坑。

   三声音，对应召唤的三个瞬间：
     sfxCloud()  掌心渗气：白噪过带通，从闷到亮再散掉，像"呼——"
     sfxChime()  现形：三声不和谐的正弦叠一起快速衰减，是寺庙磬的泛音结构
     sfxHop()    弹跳：短促的上滑正弦，像脚尖离地那一下

   浏览器要求有用户手势才能出声，所以 Ac 在点击卡片时才真正创建。
   之后就算由"张手"触发（不是手势事件里），也已经解禁了。 */

let actx = null;
let masterGain = null;       // 总线增益：静音/音量统一走这里
let muted = false;

function ac() {
  if (!actx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    actx = new C();
    /* 建一个总线：所有声音连到这里，再进 destination。
       这样静音/音量只改一个节点，不用动每个音效。 */
    masterGain = actx.createGain();
    masterGain.gain.value = muted ? 0 : 0.9;
    /* 总线限幅：多声叠加时不削波、不破音 */
    const comp = actx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    masterGain.connect(comp).connect(actx.destination);
  }
  if (actx.state === 'suspended') {
    actx.resume().catch(() => {});
  }
  return actx;
}

/* 所有音效的最终出口：连到 masterGain，而不是直接 destination */
function out(a) {
  return masterGain ? masterGain : a.destination;
}

/* 静音开关（课堂多台设备一起响时，老师一键静音）。状态记在 localStorage。 */
export function setMuted(v) {
  muted = !!v;
  if (masterGain) masterGain.gain.value = muted ? 0 : 0.9;
  try { localStorage.setItem('songjin_muted', muted ? '1' : '0'); } catch (e) { /* 忽略 */ }
}
export function isMuted() { return muted; }
/* 每次打开默认有声 —— 老师要静音时再点右上角「声」按钮。
   不读回 localStorage，避免上次误设静音后，这次一进来就没声音、以为音效丢了。 */
muted = false;

/* 用户在第一次点击时就把它解开，免得后面张手触发时被静音。
   iOS 上 AudioContext 必须由用户手势直接触发 resume 才进入 running，
   所以这里 resume 是异步的，要 .catch 吞掉错误；并播一个极短可闻的
   "哒"声（不是 0.0001 的静音），让 iOS 确认"真的在出声"、真正解锁。 */
export function unlockAudio() {
  const a = ac();
  if (!a) return Promise.resolve();
  /* 返回 resume 的 Promise，调用方可以 await，确保 iOS 上真正唤醒后才出声 */
  let p = Promise.resolve();
  if (a.state === 'suspended') {
    p = a.resume().catch(() => {});
  }
  try {
    const g = a.createGain();
    g.gain.value = 0.0001;
    g.connect(out(a));
    const o = a.createOscillator();
    o.connect(g);
    o.start();
    o.stop(a.currentTime + 0.02);
  } catch (e) { /* 忽略 */ }
  return p;
}

/* 一段白噪声（缓存起来，每次新建 buffer 会卡） */
let noiseBuf = null;
function noise(a, dur = 1.6) {
  if (!noiseBuf) {
    const n = Math.floor(a.sampleRate * dur);
    noiseBuf = a.createBuffer(1, n, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = a.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  return s;
}

/* 掌心渗气 */
export function sfxCloud(vol = 1) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;

  const src = noise(a);
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.2;
  // 从闷到亮再回落：气"涌出来"再"散掉"
  bp.frequency.setValueAtTime(320, t);
  bp.frequency.exponentialRampToValueAtTime(1150, t + 0.55);
  bp.frequency.exponentialRampToValueAtTime(420, t + 1.5);

  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.085 * vol, t + 0.42);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);

  src.connect(bp).connect(g).connect(out(a));
  src.start(t);
  src.stop(t + 1.7);
}

/* 现形：磬 + 一记闷响 */
export function sfxChime(vol = 1) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;

  /* 磬的音色不是纯正弦，是一组不太协和的泛音一起衰减，
     高次泛音衰减更快 —— 所以每个分量的时间常数不一样。 */
  const parts = [
    [1046.5, 0.075, 1.9],   // C6
    [1568.0, 0.048, 1.25],  // G6
    [2093.0, 0.030, 0.85],  // C7
    [2637.0, 0.018, 0.55],  // E7
  ];
  for (const [f, amp, dur] of parts) {
    const o = a.createOscillator();
    o.type = 'sine';
    o.frequency.value = f * (0.997 + Math.random() * 0.006);  // 轻微失谐才不呆板
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp * vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out(a));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // 落地的闷响：低频短促下滑
  const o2 = a.createOscillator();
  o2.type = 'sine';
  o2.frequency.setValueAtTime(180, t);
  o2.frequency.exponentialRampToValueAtTime(70, t + 0.22);
  const g2 = a.createGain();
  g2.gain.setValueAtTime(0.0001, t);
  g2.gain.exponentialRampToValueAtTime(0.13 * vol, t + 0.012);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o2.connect(g2).connect(out(a));
  o2.start(t);
  o2.stop(t + 0.32);
}

/* 弹跳 */
export function sfxHop(vol = 1) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  const o = a.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(420, t);
  o.frequency.exponentialRampToValueAtTime(880, t + 0.09);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.055 * vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
  o.connect(g).connect(out(a));
  o.start(t);
  o.stop(t + 0.15);
}

/* 退场 / 收起：云"收回去"的短促下行气声。
   和 cloud 反向 —— cloud 是涌出来，这个是收拢、消散。 */
export function sfxWhooshOut(vol = 1) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  const src = noise(a, 1.0);
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.0;
  bp.frequency.setValueAtTime(1200, t);
  bp.frequency.exponentialRampToValueAtTime(300, t + 0.5);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.05 * vol, t + 0.06);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  src.connect(bp).connect(g).connect(out(a));
  src.start(t);
  src.stop(t + 0.55);
}

/* 选中卡片：一声短促的"古筝/瑟"拨弦，让幼儿知道"选到了" */
export function sfxSelect(vol = 1) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  const o = a.createOscillator();
  o.type = 'triangle';
  o.frequency.value = 660;           // E5，宫调里的徵音，干净
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.06 * vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  o.connect(g).connect(out(a));
  o.start(t);
  o.stop(t + 0.1);
}
