/* 我画的衣服 · 离线缓存
   ------------------------------------------------------------
   目标：教室里没网也能上课 —— 页面、10 件宋锦范例、姿态模型都存在本机。
   关键设计（线上实测教训）：
     install 只缓存 4 个小文件就立刻激活。
     17MB 的图片与模型一口气并发下载，线上会卡在 installing 几分钟，
     期间 Service Worker 根本没接管页面，断网反而打不开。
     所以大文件改成「激活后分批后台灌」，中断了下一次打开会接着补。
   策略：
     · 页面 HTML：网络优先（保证每次发布都是最新版），3.5 秒超时或失败回落缓存
     · 图片 / wasm / 模型：缓存优先 + 后台悄悄更新（断网也能立刻打开）
     · 云端 API、非同源请求：一律放行，绝不缓存（画面与画作不落盘）
     · 真模型 SDK 体积大且离线用不上，不做缓存，省设备配额
   ------------------------------------------------------------ */
const VERSION = 'tryon-20261121c';
const CACHE = VERSION;

const KEYS = ['m1','m2','m3','m4','w1','w2','w3','w4','w5','w6'];
const LOOKS = KEYS.reduce((a,k)=>a.concat(['./looks/'+k+'.webp','./looks/'+k+'-t.webp']), []);

/* 第一批：小，但要保证断网能立刻打开页面 */
const CORE = [
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

/* 第二批：体积大，激活后分批灌。范例图排前面（选衣就要用），模型排后面 */
const BULK = LOOKS.concat([
  './vendor/vision_bundle.mjs',
  './vendor/wasm/vision_wasm_internal.js',
  './vendor/pose_landmarker_lite.task',
  './vendor/wasm/vision_wasm_internal.wasm'
]);

const sleep = ms => new Promise(r => setTimeout(r, ms));

self.addEventListener('install', e=>{
  e.waitUntil((async()=>{
    const c = await caches.open(CACHE);
    // 单个失败不阻断：核心就 4 个，装完马上激活
    await Promise.allSettled(CORE.map(u=>c.add(new Request(u, {cache:'reload'}))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e=>{
  e.waitUntil((async()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=>k.indexOf('tryon-')===0 && k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
    // 自己把大件灌完：不依赖页面发消息，页面提前关掉也能补
    // （clients.claim 已经在前面，灌缓存期间页面照常可用）
    await prefetchAll();
  })());
});

/* 页面加载完后发一条 prefetch，让 SW 把大件慢慢补齐；重复发是安全的（已缓存会跳过） */
self.addEventListener('message', e=>{
  const d = e.data || {};
  if(d.type === 'prefetch') e.waitUntil(prefetchAll());
});

let prefetching = null;
function prefetchAll(){
  if(prefetching) return prefetching;
  prefetching = (async()=>{
    const c = await caches.open(CACHE);
    const todo = [];
    for(const u of BULK){
      try{ if(await c.match(u, {ignoreSearch:true})) continue; }catch(_){}
      todo.push(u);
    }
    // 每次并发 3 个：比串行快，又不至于把网关打到限流
    for(let i=0;i<todo.length;i+=3){
      await Promise.all(todo.slice(i, i+3).map(u=>cacheOne(u)));
      await sleep(120);
    }
    const cls = await self.clients.matchAll({includeUncontrolled:true});
    cls.forEach(cl=>cl.postMessage({type:'prefetch-done'}));
    prefetching = null;
  })().catch(()=>{ prefetching = null; });
  return prefetching;
}

async function cacheOne(url){
  const c = await caches.open(CACHE);
  try{ if(await c.match(url, {ignoreSearch:true})) return true; }catch(_){}
  for(let attempt=0; attempt<2; attempt++){
    try{
      const res = await fetch(url, {cache:'no-store'});
      if(res && res.ok && res.type === 'basic'){ await c.put(url, res.clone()); return true; }
    }catch(_){}
    await sleep(300);
  }
  return false;
}

self.addEventListener('fetch', e=>{
  const req = e.request;
  if(req.method !== 'GET') return;
  let url;
  try{ url = new URL(req.url); }catch(_){ return; }
  if(url.origin !== self.location.origin) return;      // Xmax / 其它外部请求放行

  if(req.mode === 'navigate'){ e.respondWith(htmlFirst(req)); return; }
  if(url.pathname.indexOf('/vendor/xmax-web.js') >= 0) return;  // 6.5MB，离线用不上

  if(url.pathname.indexOf('/looks/') >= 0 ||
     url.pathname.indexOf('/vendor/') >= 0 ||
     url.pathname.indexOf('/icons/') >= 0 ||
     url.pathname.slice(-14) === 'webmanifest'){
    e.respondWith(staleWhileRevalidate(req, e));
  }
});

/* 页面：网络优先；断网/超时就用缓存那一份 */
async function htmlFirst(req){
  const c = await caches.open(CACHE);
  try{
    const ac = new AbortController();
    const t = setTimeout(()=>ac.abort(), 3500);
    const res = await fetch(req, {signal:ac.signal, cache:'no-store'});
    clearTimeout(t);
    if(res && res.ok){
      c.put('./index.html', res.clone());   // 存成最新版，下次离线也是新的
      return res;
    }
  }catch(_){}
  const cached = await c.match('./index.html', {ignoreSearch:true});
  if(cached) return cached;
  return new Response(
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<body style="background:#1b1613;color:#f5e7d3;font:16px/1.7 -apple-system,sans-serif;padding:32px">'+
    '<h2>还没缓存好</h2><p>请先在有网时打开一次这个页面，把范例图和模型存到本机，之后断网也能上课。</p></body>',
    {headers:{'Content-Type':'text/html;charset=utf-8'}});
}

/* 静态资源：缓存立刻给，网络在后台把新版本补进来 */
async function staleWhileRevalidate(req, e){
  const c = await caches.open(CACHE);
  const hit = await c.match(req, {ignoreSearch:true});
  const net = fetch(req).then(async res=>{
    if(res && res.ok && res.type === 'basic') await c.put(req, res.clone());
    return res;
  }).catch(()=>null);
  if(hit){ try{ e.waitUntil(net); }catch(_){} return hit; }
  return (await net) || new Response('', {status:504, statusText:'offline'});
}
