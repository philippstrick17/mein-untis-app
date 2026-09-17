// CORS-Proxy für WebUntis (Cloudflare Worker).
//
// Zweck: Der Browser darf WebUntis nicht direkt aufrufen (kein CORS, SameSite-Cookies).
// Dieser Worker ruft WebUntis serverseitig auf und reicht die Antwort mit passenden
// CORS-Headern an die PWA zurück. Cookies werden NICHT über den Browser gehalten,
// sondern über den Header "X-MU-Cookie" zum Client transportiert (ITP-sicher).
//
// Aufruf:  GET/POST/PUT/DELETE  https://<worker>/?url=<absolute WebUntis-URL>
// Request-Header:  X-MU-Cookie: name=value; name2=value2   (optional)
// Response-Header: X-MU-Cookie: name=value; ...            (gemergter Cookie-Jar)

const DEFAULT_ALLOWED_HOSTS = "webuntis.com,webuntis.de,webuntis.at,webuntis.ch";
const DEFAULT_ALLOWED_ORIGINS =
  "https://philippstrick17.github.io,http://localhost,http://127.0.0.1";

function splitList(value, fallback) {
  const raw = value === undefined || value === null || value === "" ? fallback : value;
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isAllowedHost(hostname, env) {
  const list = splitList(env && env.ALLOWED_HOSTS, DEFAULT_ALLOWED_HOSTS);
  const host = String(hostname || "").toLowerCase();
  return list.some((entry) => {
    const e = entry.toLowerCase().replace(/^\*\./, "");
    return host === e || host.endsWith("." + e);
  });
}

function isAllowedOrigin(origin, env) {
  if (!origin) return true; // z.B. native Clients ohne Origin
  const list = splitList(env && env.ALLOWED_ORIGINS, DEFAULT_ALLOWED_ORIGINS);
  return list.some((entry) => origin === entry || origin.startsWith(entry + ":"));
}

function corsHeaders(origin, env) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, X-MU-Cookie",
    "Access-Control-Expose-Headers": "X-MU-Cookie",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin && isAllowedOrigin(origin, env)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function jsonResponse(obj, status, extraHeaders) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, extraHeaders || {}),
  });
}

function parseJar(raw) {
  const jar = {};
  if (!raw) return jar;
  String(raw)
    .split(";")
    .forEach((part) => {
      const idx = part.indexOf("=");
      if (idx <= 0) return;
      const name = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      if (!name) return;
      if (value) jar[name] = value;
    });
  return jar;
}

function serializeJar(jar) {
  return Object.keys(jar)
    .map((k) => k + "=" + jar[k])
    .join("; ");
}

function mergeSetCookie(jar, setCookie) {
  if (!setCookie) return;
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const raw of list) {
    const first = String(raw).split(";")[0];
    const idx = first.indexOf("=");
    if (idx <= 0) continue;
    const name = first.slice(0, idx).trim();
    const value = first.slice(idx + 1).trim();
    if (!name) continue;
    if (value && value !== "DELETED") jar[name] = value;
    else delete jar[name];
  }
}

function readSetCookies(upstream) {
  if (typeof upstream.headers.getSetCookie === "function") {
    return upstream.headers.getSetCookie();
  }
  const combined = upstream.headers.get("set-cookie");
  return combined ? [combined] : [];
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (origin && !isAllowedOrigin(origin, env)) {
      return jsonResponse({ error: "Origin nicht erlaubt" }, 403, cors);
    }

    const reqUrl = new URL(request.url);
    const target = reqUrl.searchParams.get("url");
    if (!target) {
      return jsonResponse({ error: "Parameter 'url' fehlt" }, 400, cors);
    }

    let parsed;
    try {
      parsed = new URL(target);
    } catch (e) {
      return jsonResponse({ error: "Ungültige 'url'" }, 400, cors);
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return jsonResponse({ error: "Nur http(s) erlaubt" }, 400, cors);
    }
    if (!isAllowedHost(parsed.hostname, env)) {
      return jsonResponse({ error: "Host nicht erlaubt" }, 403, cors);
    }

    const outHeaders = new Headers();
    outHeaders.set("Accept", request.headers.get("Accept") || "application/json");
    const reqContentType = request.headers.get("Content-Type");
    if (reqContentType) outHeaders.set("Content-Type", reqContentType);
    const reqAuth = request.headers.get("Authorization");
    if (reqAuth) outHeaders.set("Authorization", reqAuth);
    outHeaders.set("User-Agent", "MeinUntisProxy/1.0");

    const jar = parseJar(request.headers.get("X-MU-Cookie"));
    if (Object.keys(jar).length) outHeaders.set("Cookie", serializeJar(jar));

    const init = {
      method: request.method,
      headers: outHeaders,
      redirect: "manual",
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.arrayBuffer();
    }

    let upstream;
    try {
      upstream = await fetch(parsed.toString(), init);
    } catch (e) {
      return jsonResponse({ error: "WebUntis nicht erreichbar: " + (e && e.message) }, 502, cors);
    }

    for (const sc of readSetCookies(upstream)) mergeSetCookie(jar, sc);

    const respHeaders = new Headers(cors);
    const upstreamType = upstream.headers.get("Content-Type");
    if (upstreamType) respHeaders.set("Content-Type", upstreamType);
    if (Object.keys(jar).length) respHeaders.set("X-MU-Cookie", serializeJar(jar));

    const buffer = await upstream.arrayBuffer();
    return new Response(buffer, { status: upstream.status, headers: respHeaders });
  },
};
