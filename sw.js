// sw.js — 花花食界 CRM Service Worker
// ════════════════════════════════════════════════════════════════
// ⚠ 每次发版必须 bump 此版本号(与 App 版本对应),否则浏览器不会
//   认为 SW 变了 → "发现新版本"提示不触发,用户卡在旧缓存。
const SW_VERSION = 'huahua-crm-v33.0.8';
const CACHE = SW_VERSION;

// 部署在 GitHub Pages 子路径 /foodvio-china-minicrm/,以下全部用相对路径
// (相对 sw.js 所在目录解析,即仓库根目录 = App 根)。
const SHELL = [
  '.',                              // 目录入口(导航到 / 时命中)
  'index.html',                     // HTML 本体
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-512-maskable.png',
  'icons/apple-touch-icon.png'
];

// 唯一允许缓存的外部 CDN(QRCode.js),其余跨源请求一律放行。
const QRCODE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';

// ── install:预缓存外壳。不 skipWaiting,等页面提示用户确认后再激活。
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .catch(() => { /* 单个资源失败不阻断安装 */ })
  );
});

// ── activate:清理所有旧版本缓存,立即接管页面。
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// ── message:页面点"立即更新"后才激活新版本。
self.addEventListener('message', (e) => {
  const d = e.data;
  if (d === 'SKIP_WAITING' || (d && d.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});

// ════════════════════════════════════════════════════════════════
// fetch 策略
//   红线:绝不缓存/拦截 Supabase(/rest /auth /realtime)与 AI 接口。
//   实现:除 QRCode.js 这一个 CDN 外,所有跨源请求一律放行(直接 return,
//         不 respondWith)。Supabase 与全部 AI 接口都是跨源,自动被放行。
// ════════════════════════════════════════════════════════════════
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // 非 GET(写操作)一律放行

  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  // QRCode.js:stale-while-revalidate(唯一缓存的外部资源)
  if (req.url === QRCODE_URL) { e.respondWith(staleWhileRevalidate(req)); return; }

  // 仅处理同源请求;其余跨源(含所有 Supabase/AI/实时)放行,绝不拦截。
  if (url.origin !== self.location.origin) return;

  // 图标:cache-first(基本不变)
  if (url.pathname.includes('/icons/')) { e.respondWith(cacheFirst(req)); return; }

  // HTML 外壳 / manifest:network-first(在线优先取新版,离线回退缓存)
  if (req.mode === 'navigate' || isShellPath(url.pathname)) {
    e.respondWith(networkFirst(req));
    return;
  }

  // 其它同源请求:放行(不缓存业务相关的任何东西)
});

function isShellPath(p) {
  return p.endsWith('/') ||
         p.endsWith('/index.html') ||
         p.endsWith('/manifest.webmanifest');
}

// ── network-first:在线取新版并回写缓存;离线回退缓存(含外壳兜底)。
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req, { cache: 'no-store' });
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(req)
      || await cache.match('index.html')
      || await cache.match('.');
    if (cached) return cached;
    throw err;
  }
}

// ── cache-first:命中即返回,未命中取网络并缓存。
async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
  return res;
}

// ── stale-while-revalidate:先返缓存,后台静默更新。
async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const fetching = fetch(req)
    .then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return hit || (await fetching) || fetch(req);
}
