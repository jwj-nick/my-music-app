// 서비스 워커 — PWA 오프라인 지원 + 홈 화면 추가 (Phase 3 준비, 2026-08-30)
//
// 전략: 네트워크 우선(network-first). 온라인이면 항상 최신 코드를 받고, 오프라인일 때만
// 캐시로 대체한다. 계속 개발 중인 앱이라 "캐시 우선"으로 하면 배포해도 옛날 버전이 계속
// 보이는 문제가 생기기 쉬워서, 신선함을 기본으로 하고 오프라인 대비만 캐시가 맡는다.
// 같은 출처(우리 앱 파일)만 다룬다 — 폰트·YouTube·Claude/YouTube API 같은 외부 요청은
// 서비스 워커가 손대지 않고 그대로 네트워크로 흘려보낸다(POST도 그대로 통과).

const CACHE_NAME = "mma-cache-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./style.css",
  "./manifest.json",
  "./data/seed.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
