import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import http from "http";
import https from "https";
import dns from "dns";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "url";

dotenv.config();

// Render/Node can occasionally prefer an unreachable IPv6 route for external
// services. Prefer IPv4 and provide a native HTTPS fallback for Supabase.
try { dns.setDefaultResultOrder?.("ipv4first"); } catch {}

function nodeFetchIpv4(input, init = {}) {
  return new Promise(async (resolve, reject) => {
    try {
      const target = new URL(typeof input === "string" ? input : input.url);
      const transport = target.protocol === "http:" ? http : https;
      const method = String(init.method || input?.method || "GET").toUpperCase();
      const headers = new Headers(init.headers || input?.headers || {});
      let body = init.body;
      if (body === undefined && input && typeof input !== "string" && input.body) {
        body = Buffer.from(await input.arrayBuffer());
      }
      if (body instanceof Uint8Array && !Buffer.isBuffer(body)) body = Buffer.from(body);

      const request = transport.request({
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method,
        headers: Object.fromEntries(headers.entries()),
        family: 4,
        timeout: 25_000,
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(response.headers)) {
            if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(key, item));
            else if (value !== undefined) responseHeaders.set(key, String(value));
          }
          resolve(new Response(Buffer.concat(chunks), {
            status: response.statusCode || 500,
            statusText: response.statusMessage || "",
            headers: responseHeaders,
          }));
        });
      });

      request.on("timeout", () => request.destroy(Object.assign(new Error("Supabase request timed out"), { code: "ETIMEDOUT" })));
      request.on("error", reject);
      if (init.signal) {
        if (init.signal.aborted) request.destroy(Object.assign(new Error("Request aborted"), { name: "AbortError" }));
        else init.signal.addEventListener("abort", () => request.destroy(Object.assign(new Error("Request aborted"), { name: "AbortError" })), { once: true });
      }
      if (body !== undefined && body !== null) request.write(body);
      request.end();
    } catch (error) {
      reject(error);
    }
  });
}

function withTimeoutSignal(init = {}, timeoutMs = 25_000) {
  const upstreamSignal = init.signal;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(Object.assign(new Error("Supabase request timed out"), { code: "ETIMEDOUT" })), timeoutMs);
  if (upstreamSignal) {
    if (upstreamSignal.aborted) controller.abort(upstreamSignal.reason || Object.assign(new Error("Request aborted"), { name: "AbortError" }));
    else upstreamSignal.addEventListener("abort", () => controller.abort(upstreamSignal.reason || Object.assign(new Error("Request aborted"), { name: "AbortError" })), { once: true });
  }
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

async function standardFetchWithTimeout(input, init = {}) {
  const timeout = withTimeoutSignal(init, 25_000);
  try {
    return await globalThis.fetch(input, { ...init, signal: timeout.signal });
  } finally {
    timeout.done();
  }
}

async function resilientSupabaseFetch(input, init = {}) {
  // Try the platform/native fetch first. If Render/undici fails with the opaque
  // "fetch failed" error, fall back to a direct HTTPS request pinned to IPv4.
  let firstError = null;
  try {
    return await standardFetchWithTimeout(input, init);
  } catch (fetchError) {
    firstError = fetchError;
  }

  try {
    return await nodeFetchIpv4(input, init);
  } catch (nativeError) {
    const cause =
      nativeError?.code || nativeError?.cause?.code ||
      firstError?.cause?.code || firstError?.code ||
      nativeError?.message || firstError?.message ||
      "NETWORK_ERROR";
    const error = new Error(`Supabase network connection failed (${cause})`);
    error.code = "SUPABASE_NETWORK_ERROR";
    error.cause = nativeError;
    error.firstError = firstError;
    throw error;
  }
}

const app = express();
app.use((req, res, next) => {
  res.setHeader("X-TRACE-Build", "trace-v50.4-glyph-spec-about-landing-cleanup");
  next();
});
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "64kb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const indexPath = path.join(__dirname, "index.html");
const glyphEnginePath = path.join(__dirname, "trace-glyph-v1.js");
const uploadDir = "/tmp/trace-uploads";

fs.mkdirSync(uploadDir, { recursive: true });

function envInt(name, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const CONFIG = Object.freeze({
  maxImageBytes: envInt("TRACE_MAX_IMAGE_BYTES", 8 * 1024 * 1024, 1024, 20 * 1024 * 1024),
  burstWindowMs: envInt("TRACE_BURST_WINDOW_MS", 15 * 60 * 1000, 60_000),
  burstLimitPerIp: envInt("TRACE_BURST_LIMIT_PER_IP", 5, 1, 100),
  dailyLimitPerIp: envInt("TRACE_DAILY_LIMIT_PER_IP", 20, 1, 10_000),
  globalDailyLimit: envInt("TRACE_GLOBAL_DAILY_LIMIT", 100, 1, 1_000_000),
  maxConcurrentScans: envInt("TRACE_MAX_CONCURRENT_SCANS", 2, 1, 20),
  winstonTimeoutMs: envInt("TRACE_WINSTON_TIMEOUT_MS", 35_000, 5_000, 120_000),
  uploadedFileLifetimeMs: envInt("TRACE_UPLOAD_LIFETIME_MS", 3 * 60 * 1000, 30_000),
  proofPublishWindowMs: envInt("TRACE_PROOF_PUBLISH_WINDOW_MS", 60 * 60 * 1000, 60_000),
  proofPublishLimitPerIp: envInt("TRACE_PROOF_PUBLISH_LIMIT_PER_IP", 20, 1, 500),
  proofGlobalDailyLimit: envInt("TRACE_PROOF_GLOBAL_DAILY_LIMIT", 1000, 1, 1_000_000),
});

const WINSTON_TOKEN_RAW = process.env.WINSTONAI_API_KEY || "";
const WINSTON_TOKEN = WINSTON_TOKEN_RAW.trim().toLowerCase().startsWith("bearer ")
  ? WINSTON_TOKEN_RAW.trim().slice(7).trim()
  : WINSTON_TOKEN_RAW.trim();

function cleanEnvValue(value, { stripBearer = false } = {}) {
  let cleaned = String(value || "").trim();

  // Render values are sometimes pasted with wrapping quotes/backticks.
  for (let pass = 0; pass < 2; pass += 1) {
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    const wrapped =
      cleaned.length >= 2 &&
      ((first === '"' && last === '"') ||
       (first === "'" && last === "'") ||
       (first === "`" && last === "`"));

    if (!wrapped) break;
    cleaned = cleaned.slice(1, -1).trim();
  }

  if (stripBearer && /^bearer\s+/i.test(cleaned)) {
    cleaned = cleaned.replace(/^bearer\s+/i, "").trim();
  }

  return cleaned;
}

function firstConfiguredEnv(names, options = {}) {
  for (const name of names) {
    const value = cleanEnvValue(process.env[name], options);
    if (value) return { value, source: name };
  }
  return { value: "", source: "missing" };
}

const supabaseUrlEnv = firstConfiguredEnv([
  "SUPABASE_URL",
  "SUPABASE_PROJECT_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PROJECT_URL",
  "PUBLIC_SUPABASE_URL",
  "VITE_SUPABASE_URL",
  "REACT_APP_SUPABASE_URL",
]);

const supabaseKeyEnv = firstConfiguredEnv(
  [
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SERVICE_ROLE",
    "SUPABASE_SECRET",
    "SUPABASE_SERVICE_KEY",
    "SUPABASE_KEY",
    "SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_PUBLIC_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_ANON_KEY",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
  ],
  { stripBearer: true }
);

const supabasePublicKeyCandidate = firstConfiguredEnv(
  [
    "SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_PUBLIC_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_ANON_KEY",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "REACT_APP_SUPABASE_ANON_KEY",
  ],
  { stripBearer: true }
);

function decodeJwtPayload(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return null;
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function supabaseProjectRefFromKey(key) {
  const payload = decodeJwtPayload(key);
  const direct = String(payload?.ref || "").trim().toLowerCase();
  if (/^[a-z0-9]{12,32}$/.test(direct)) return direct;
  try {
    const issuer = new URL(String(payload?.iss || ""));
    const hostMatch = issuer.hostname.match(/^([a-z0-9-]{12,32})\.supabase\.co$/i);
    return hostMatch ? hostMatch[1].toLowerCase() : "";
  } catch {
    return "";
  }
}

function supabaseProjectRefFromUrl(rawValue) {
  const raw = cleanEnvValue(rawValue);
  if (!raw) return "";
  if (/^[a-z0-9]{12,32}$/i.test(raw)) return raw.toLowerCase();
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    let match = host.match(/^([a-z0-9-]{12,32})\.supabase\.co$/i);
    if (match) return match[1].toLowerCase();
    match = host.match(/^db\.([a-z0-9-]{12,32})\.supabase\.co$/i);
    if (match) return match[1].toLowerCase();
    match = parsed.pathname.match(/\/project\/([a-z0-9-]{12,32})(?:\/|$)/i);
    if (match) return match[1].toLowerCase();
    const optionProject = String(parsed.searchParams.get("project") || parsed.searchParams.get("ref") || "").toLowerCase();
    if (/^[a-z0-9-]{12,32}$/.test(optionProject)) return optionProject;
    const userMatch = decodeURIComponent(parsed.username || "").match(/(?:^|\.)([a-z0-9-]{12,32})$/i);
    if (userMatch) return userMatch[1].toLowerCase();
  } catch {
    return "";
  }
  return "";
}

function classifySupabaseKey(key) {
  const value = String(key || "");
  if (!value) return "missing";
  if (value.startsWith("sb_secret_")) return "secret";
  if (value.startsWith("sb_publishable_")) return "publishable";
  const role = String(decodeJwtPayload(value)?.role || "").toLowerCase();
  if (role === "service_role") return "service_role";
  if (role === "anon" || role === "authenticated") return role;
  if (value.startsWith("eyJ")) return "legacy_jwt_unclassified";
  return "present_unclassified";
}

function resolveSupabaseProjectUrl(rawValue, keys = []) {
  const raw = cleanEnvValue(rawValue).replace(/\/+$/, "");
  const auxiliaryRef = [
    process.env.SUPABASE_PROJECT_REF,
    process.env.SUPABASE_DB_URL,
    process.env.SUPABASE_DATABASE_URL,
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
  ].map(supabaseProjectRefFromUrl).find(Boolean) || "";
  const keyRef = keys.map(supabaseProjectRefFromKey).find(Boolean) || auxiliaryRef;
  const rawRef = supabaseProjectRefFromUrl(raw);
  let directOrigin = "";
  let directHost = "";

  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      directOrigin = parsed.origin;
      directHost = parsed.hostname.toLowerCase();
    }
  } catch {}

  const isDashboardUrl = /(^|\.)supabase\.com$/i.test(directHost) || /\/dashboard\/project\//i.test(raw);
  const isDatabaseHost = /^db\./i.test(directHost) || /pooler\.supabase\.com$/i.test(directHost);
  const directProjectMatch = directHost.match(/^([a-z0-9-]{12,32})\.supabase\.co$/i);

  const allowCustomDomain = /^(1|true|yes)$/i.test(String(process.env.SUPABASE_ALLOW_CUSTOM_DOMAIN || ""));
  const isCanonicalProjectHost = Boolean(directProjectMatch);
  if (keyRef && (
    !directOrigin ||
    isDashboardUrl ||
    isDatabaseHost ||
    (directProjectMatch && directProjectMatch[1].toLowerCase() !== keyRef) ||
    (!isCanonicalProjectHost && !allowCustomDomain)
  )) {
    return {
      url: `https://${keyRef}.supabase.co`,
      ref: keyRef,
      source: "derived_from_key",
      corrected: Boolean(raw),
      raw_host: directHost,
    };
  }

  if (rawRef && (isDashboardUrl || isDatabaseHost || !directOrigin)) {
    return {
      url: `https://${rawRef}.supabase.co`,
      ref: rawRef,
      source: "derived_from_url",
      corrected: true,
      raw_host: directHost,
    };
  }

  if (directOrigin && !isDashboardUrl && !isDatabaseHost) {
    return {
      url: directOrigin,
      ref: rawRef || keyRef,
      source: "environment_url",
      corrected: directOrigin !== raw,
      raw_host: directHost,
    };
  }

  if (keyRef) {
    return {
      url: `https://${keyRef}.supabase.co`,
      ref: keyRef,
      source: "derived_from_key",
      corrected: Boolean(raw),
      raw_host: directHost,
    };
  }

  return { url: "", ref: "", source: "missing_or_invalid", corrected: Boolean(raw), raw_host: directHost };
}

const SUPABASE_URL_RESOLUTION = resolveSupabaseProjectUrl(
  supabaseUrlEnv.value,
  [supabasePublicKeyCandidate.value, supabaseKeyEnv.value]
);
const SUPABASE_URL = SUPABASE_URL_RESOLUTION.url;
const SUPABASE_SECRET_KEY = supabaseKeyEnv.value;
const SUPABASE_URL_SOURCE = SUPABASE_URL_RESOLUTION.source;
const SUPABASE_KEY_SOURCE = supabaseKeyEnv.source;
const SUPABASE_KEY_KIND = classifySupabaseKey(SUPABASE_SECRET_KEY);

/*
 * A non-empty URL and key are sufficient to initialize the client. Permission
 * problems must be reported as actual Supabase errors, not mislabelled as a
 * missing registry configuration. This also keeps compatibility with new key
 * formats and projects whose RLS policies intentionally permit publishable-key
 * access.
 */
const PROOF_REGISTRY_CONFIGURED = Boolean(
  SUPABASE_URL && SUPABASE_SECRET_KEY
);

function proofRegistryConfigurationMessage() {
  if (!SUPABASE_URL && !SUPABASE_SECRET_KEY) {
    return "Supabase URL and key are missing from this Render service";
  }
  if (!SUPABASE_URL) {
    return "Supabase project URL is missing from this Render service";
  }
  if (!SUPABASE_SECRET_KEY) {
    return "Supabase registry key is missing from this Render service";
  }
  return "Proof registry client could not be initialized";
}

const supabaseAdmin = PROOF_REGISTRY_CONFIGURED
  ? createClient(
      SUPABASE_URL,
      SUPABASE_SECRET_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        db: {
          schema: "public",
        },
        global: {
          fetch: resilientSupabaseFetch,
          headers: {
            "X-Client-Info": "trace-render-proof-registry/1.0",
          },
        },
      }
    )
  : null;

const supabaseAuthKeyEnv = supabasePublicKeyCandidate;
// Prefer the public/anon key for password auth, but allow the already configured
// server-side Supabase key as a fallback. The fallback never leaves this service.
const SUPABASE_AUTH_KEY = supabaseAuthKeyEnv.value || SUPABASE_SECRET_KEY;
const SUPABASE_AUTH_KEY_SOURCE = supabaseAuthKeyEnv.value
  ? supabaseAuthKeyEnv.source
  : (SUPABASE_SECRET_KEY ? `${SUPABASE_KEY_SOURCE} (server fallback)` : "missing");

const ALLOWED_ORIGINS = new Set(
  String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean)
);

function requestBase(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();

  const protocol = forwardedProto || req.protocol || "https";
  const host = forwardedHost || req.get("host");

  return `${protocol}://${host}`.replace(/\/+$/, "");
}

/*
 * Same-origin requests are allowed automatically.
 * Add comma-separated extra origins through ALLOWED_ORIGINS only when needed.
 */
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  const origin = String(req.headers.origin || "").replace(/\/+$/, "");

  if (!origin) return next();

  const sameOrigin = origin === requestBase(req);
  const explicitlyAllowed = ALLOWED_ORIGINS.has(origin);

  if (!sameOrigin && !explicitlyAllowed) {
    return res.status(403).json({
      ok: false,
      error: "Origin not allowed",
    });
  }

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") return res.sendStatus(204);
  return next();
});

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: CONFIG.maxImageBytes,
    files: 1,
    fields: 5,
  },
  fileFilter(req, file, callback) {
    const mime = String(file.mimetype || "").toLowerCase();

    if (!allowedMimeTypes.has(mime)) {
      const error = new Error("Only JPEG, PNG and WebP images are allowed");
      error.code = "UNSUPPORTED_IMAGE_TYPE";
      return callback(error);
    }

    return callback(null, true);
  },
});

app.use(
  "/uploads",
  express.static(uploadDir, {
    fallthrough: false,
    setHeaders(res) {
      res.setHeader("Cache-Control", "public, max-age=120, immutable");
      res.setHeader("X-Content-Type-Options", "nosniff");
    },
  })
);

app.get("/", (req, res) => {
  if (!fs.existsSync(indexPath)) {
    return res.status(500).send("index.html not found");
  }

  res.setHeader("Cache-Control", "no-store");
  return res.sendFile(indexPath);
});

app.get("/trace-glyph-v1.js", (req, res) => {
  if (!fs.existsSync(glyphEnginePath)) {
    return res.status(500).type("text/plain").send("TRACE glyph engine not found");
  }
  res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  return res.sendFile(glyphEnginePath);
});

const publicAssets = new Set(["logo.png", "1.png.png"]);

app.get("/:filename", (req, res, next) => {
  const filename = String(req.params.filename || "");

  if (!publicAssets.has(filename)) return next();

  const assetPath = path.join(__dirname, filename);

  if (!fs.existsSync(assetPath)) {
    return res.status(404).send("Asset not found");
  }

  res.setHeader("Cache-Control", "public, max-age=3600");
  return res.sendFile(assetPath);
});

function utcDayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

let usageDay = utcDayKey();
let globalScansToday = 0;
let activeScans = 0;

const burstBuckets = new Map();
const dailyIpUsage = new Map();
const inflightScans = new Map();

const proofPublishBuckets = new Map();
let proofPublishDay = utcDayKey();
let proofsPublishedToday = 0;

function resetDailyUsageIfNeeded() {
  const today = utcDayKey();

  if (today !== usageDay) {
    usageDay = today;
    globalScansToday = 0;
    dailyIpUsage.clear();
  }
}

function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || "unknown");
}

function burstLimit(req, res, next) {
  const now = Date.now();
  const ip = clientIp(req);
  const existing = burstBuckets.get(ip);

  let bucket = existing;
  if (!bucket || now >= bucket.resetAt) {
    bucket = {
      count: 0,
      resetAt: now + CONFIG.burstWindowMs,
    };
  }

  bucket.count += 1;
  burstBuckets.set(ip, bucket);

  const remaining = Math.max(0, CONFIG.burstLimitPerIp - bucket.count);
  res.setHeader("X-RateLimit-Limit", String(CONFIG.burstLimitPerIp));
  res.setHeader("X-RateLimit-Remaining", String(remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

  if (bucket.count > CONFIG.burstLimitPerIp) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.resetAt - now) / 1000)
    );

    res.setHeader("Retry-After", String(retryAfterSeconds));

    return res.status(429).json({
      ok: false,
      error: "Too many scans. Try again later.",
      retry_after_seconds: retryAfterSeconds,
    });
  }

  return next();
}

function checkAndReserveDailyBudget(ip) {
  resetDailyUsageIfNeeded();

  const ipUsed = dailyIpUsage.get(ip) || 0;

  if (ipUsed >= CONFIG.dailyLimitPerIp) {
    return {
      ok: false,
      status: 429,
      error: "Daily scan limit reached for this connection.",
    };
  }

  if (globalScansToday >= CONFIG.globalDailyLimit) {
    return {
      ok: false,
      status: 503,
      error: "TRACE daily scan budget has been reached.",
    };
  }

  if (activeScans >= CONFIG.maxConcurrentScans) {
    return {
      ok: false,
      status: 503,
      error: "Scanner is busy. Try again shortly.",
      retryAfterSeconds: 10,
    };
  }

  dailyIpUsage.set(ip, ipUsed + 1);
  globalScansToday += 1;
  activeScans += 1;

  return { ok: true };
}

function releaseConcurrencySlot() {
  activeScans = Math.max(0, activeScans - 1);
}

function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  if (
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { mime: "image/jpeg", ext: "jpg" };
  }

  if (
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
  ) {
    return { mime: "image/png", ext: "png" };
  }

  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { mime: "image/webp", ext: "webp" };
  }

  return null;
}

function makePublicUrl(req, filename) {
  return `${requestBase(req)}/uploads/${encodeURIComponent(filename)}`;
}

const TRACE_ORIGIN_CONTRACT_VERSION = "trace-origin-v1";
const TRACE_ORIGIN_SCORE_SEMANTICS = "ai_probability";
const TRACE_ORIGIN_THRESHOLDS = Object.freeze({ humanMax: 0.35, aiMin: 0.65 });
const TRACE_ORIGIN_SCORE_TOLERANCE = 0.03;
// V50 deliberately ignores the legacy WINSTON_IMAGE_VERSION variable so an
// old Render value such as "3" cannot silently break parity again. Pin a model
// only through TRACE_WINSTON_IMAGE_VERSION; otherwise Winston "latest" is used.
const WINSTON_IMAGE_VERSION = cleanEnvValue(
  process.env.TRACE_WINSTON_IMAGE_VERSION || "latest"
);
const ORIGIN_INPUT_LIFETIME_MS = envInt(
  "TRACE_ORIGIN_INPUT_LIFETIME_MS",
  3 * 60 * 1000,
  30_000,
  15 * 60 * 1000
);
const ORIGIN_IDEMPOTENCY_MS = envInt(
  "TRACE_ORIGIN_IDEMPOTENCY_MS",
  5 * 60 * 1000,
  30_000,
  30 * 60 * 1000
);

/*
 * Winston's documented image-detection endpoint accepts a public image URL,
 * not multipart image bytes. TRACE therefore exposes the exact Multer Buffer
 * through a short-lived opaque URL. The provider receives the original bytes:
 * no canvas, preview, resizing, watermarking or re-encoding is involved.
 */
const originInputStore = new Map();
const originRequestResults = new Map();
const originInflightRequests = new Map();

function sha256HexBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function normalizeFilename(value, fallback = "artwork") {
  const clean = path.basename(String(value || fallback))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 180);
  return clean || fallback;
}

function classifyAiProbability(aiProbability) {
  if (!Number.isFinite(aiProbability) || aiProbability < 0 || aiProbability > 1) {
    return null;
  }
  if (aiProbability <= TRACE_ORIGIN_THRESHOLDS.humanMax) return "human_leaning";
  if (aiProbability >= TRACE_ORIGIN_THRESHOLDS.aiMin) return "ai_like";
  return "inconclusive";
}

function parseProbability(value, scaleHint = "auto") {
  const originalValue = value;

  if (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    Array.isArray(value) ||
    (typeof value === "object" && value !== null)
  ) {
    return { ok: false, error_code: "invalid_probability_value", original_value: originalValue };
  }

  let numeric;
  let explicitPercent = false;

  if (typeof value === "number") {
    numeric = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return { ok: false, error_code: "invalid_probability_value", original_value: originalValue };
    }
    explicitPercent = trimmed.endsWith("%");
    const rawNumeric = explicitPercent ? trimmed.slice(0, -1).trim() : trimmed;
    if (!rawNumeric || !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(rawNumeric)) {
      return { ok: false, error_code: "invalid_probability_value", original_value: originalValue };
    }
    numeric = Number(rawNumeric);
  } else {
    return { ok: false, error_code: "invalid_probability_value", original_value: originalValue };
  }

  if (!Number.isFinite(numeric)) {
    return { ok: false, error_code: "invalid_probability_value", original_value: originalValue };
  }

  let scale = scaleHint;
  if (explicitPercent) scale = "0_to_100";
  if (scale === "auto") {
    if (numeric >= 0 && numeric <= 1) scale = "0_to_1";
    else if (numeric > 1 && numeric <= 100) scale = "0_to_100";
  }

  let normalized;
  if (scale === "0_to_1" && numeric >= 0 && numeric <= 1) {
    normalized = numeric;
  } else if (scale === "0_to_100" && numeric >= 0 && numeric <= 100) {
    normalized = numeric / 100;
  } else {
    return {
      ok: false,
      error_code: "probability_out_of_range",
      original_value: originalValue,
      interpreted_scale: scale,
    };
  }

  return {
    ok: true,
    original_value: originalValue,
    interpreted_scale: scale,
    normalized: Number(normalized.toFixed(12)),
  };
}

function normalizeHumanProbability(value, scaleHint = "auto") {
  const parsed = parseProbability(value, scaleHint);
  if (!parsed.ok) return parsed;
  return {
    ...parsed,
    interpreted_semantics: "human_probability",
    human_probability: parsed.normalized,
    ai_probability: Number((1 - parsed.normalized).toFixed(12)),
  };
}

function normalizeAiProbability(value, scaleHint = "auto") {
  const parsed = parseProbability(value, scaleHint);
  if (!parsed.ok) return parsed;
  return {
    ...parsed,
    interpreted_semantics: "ai_probability",
    ai_probability: parsed.normalized,
    human_probability: Number((1 - parsed.normalized).toFixed(12)),
  };
}

function getOwnPath(object, pathParts) {
  let current = object;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return { present: false, value: undefined };
    }
    if (!Object.prototype.hasOwnProperty.call(current, part)) {
      return { present: false, value: undefined };
    }
    current = current[part];
  }
  return { present: true, value: current };
}

function winstonCandidateContainers(rawResponse) {
  const allowedWrappers = new Set(["data", "result", "analysis", "prediction", "output"]);
  const containers = [];
  const queue = [{ path: [], object: rawResponse, depth: 0 }];
  const seen = new Set();

  while (queue.length) {
    const current = queue.shift();
    if (!current?.object || typeof current.object !== "object" || Array.isArray(current.object)) continue;
    if (seen.has(current.object)) continue;
    seen.add(current.object);
    containers.push({ path: current.path, object: current.object });
    if (current.depth >= 3) continue;

    for (const key of allowedWrappers) {
      const candidate = current.object[key];
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
        queue.push({ path: [...current.path, key], object: candidate, depth: current.depth + 1 });
      }
    }
  }
  return containers;
}

function canonicalOriginError({
  requestId,
  confidenceState,
  errorCode,
  errorMessage,
  input,
  providerResult = null,
  latencyMs = null,
}) {
  return {
    ok: false,
    provider: "WinstonAI",
    contract_version: TRACE_ORIGIN_CONTRACT_VERSION,
    score_semantics: TRACE_ORIGIN_SCORE_SEMANTICS,
    ai_probability: null,
    human_probability: null,
    classification: "unavailable",
    confidence_state: confidenceState,
    input: input || null,
    provider_result: providerResult,
    request_id: requestId,
    error_code: errorCode,
    error_message: errorMessage,
    diagnostics: {
      latency_ms: Number.isFinite(latencyMs) ? latencyMs : null,
      fallback_used: false,
    },
  };
}

function normalizeWinstonOriginResponse(rawResponse, {
  requestId = crypto.randomUUID(),
  input = null,
  latencyMs = null,
  rawScoreSemantics = null,
} = {}) {
  if (!rawResponse || typeof rawResponse !== "object" || Array.isArray(rawResponse)) {
    return canonicalOriginError({
      requestId,
      confidenceState: "invalid_provider_response",
      errorCode: "invalid_provider_response",
      errorMessage: "Winston returned a non-object response",
      input,
      latencyMs,
    });
  }

  const fieldSpecs = [
    { name: "ai_probability", semantics: "ai_probability", scale: "auto", priority: 10 },
    { name: "human_probability", semantics: "human_probability", scale: "auto", priority: 20 },
    { name: "ai_score", semantics: "ai_probability", scale: "auto", priority: 30 },
    { name: "aiScore", semantics: "ai_probability", scale: "auto", priority: 31 },
    { name: "human_score", semantics: "human_probability", scale: "auto", priority: 40 },
    { name: "score", semantics: rawScoreSemantics, scale: "0_to_100", priority: 50, generic: true },
  ];

  const candidates = [];
  const invalidCandidates = [];

  for (const container of winstonCandidateContainers(rawResponse)) {
    for (const spec of fieldSpecs) {
      const found = getOwnPath(container.object, [spec.name]);
      if (!found.present) continue;

      if (spec.generic && !rawScoreSemantics) {
        invalidCandidates.push({
          source_field: [...container.path, spec.name].join("."),
          error_code: "ambiguous_provider_score",
          original_value: found.value,
        });
        continue;
      }

      const normalized = spec.semantics === "human_probability"
        ? normalizeHumanProbability(found.value, spec.scale)
        : normalizeAiProbability(found.value, spec.scale);

      const sourceField = [...container.path, spec.name].join(".");
      if (!normalized.ok) {
        invalidCandidates.push({
          source_field: sourceField,
          error_code: normalized.error_code,
          original_value: found.value,
        });
        continue;
      }

      candidates.push({
        source_field: sourceField,
        source_semantics: spec.semantics,
        source_scale: normalized.interpreted_scale,
        original_value: normalized.original_value,
        normalized_ai_probability: normalized.ai_probability,
        normalized_human_probability: normalized.human_probability,
        priority: spec.priority + container.path.length,
      });
    }
  }

  if (!candidates.length) {
    const ambiguous = invalidCandidates.some((candidate) => candidate.error_code === "ambiguous_provider_score");
    return canonicalOriginError({
      requestId,
      confidenceState: ambiguous ? "ambiguous_provider_response" : "invalid_provider_response",
      errorCode: ambiguous ? "ambiguous_provider_score" : "invalid_provider_response",
      errorMessage: ambiguous
        ? "Winston returned a generic score whose semantics were not confirmed"
        : "Winston returned no valid supported probability fields",
      input,
      providerResult: {
        invalid_fields: invalidCandidates.map(({ source_field, error_code }) => ({ source_field, error_code })),
      },
      latencyMs,
    });
  }

  const aiValues = candidates.map((candidate) => candidate.normalized_ai_probability);
  const minAi = Math.min(...aiValues);
  const maxAi = Math.max(...aiValues);
  if (maxAi - minAi > TRACE_ORIGIN_SCORE_TOLERANCE) {
    return canonicalOriginError({
      requestId,
      confidenceState: "ambiguous_provider_response",
      errorCode: "provider_score_conflict",
      errorMessage: "Winston probability fields contradict each other",
      input,
      providerResult: {
        candidates: candidates.map((candidate) => ({
          source_field: candidate.source_field,
          source_semantics: candidate.source_semantics,
          source_scale: candidate.source_scale,
          normalized_ai_probability: candidate.normalized_ai_probability,
          normalized_human_probability: candidate.normalized_human_probability,
        })),
      },
      latencyMs,
    });
  }

  candidates.sort((a, b) => a.priority - b.priority);
  const selected = candidates[0];
  const aiProbability = Number(selected.normalized_ai_probability.toFixed(12));
  const humanProbability = Number((1 - aiProbability).toFixed(12));
  const classification = classifyAiProbability(aiProbability);

  return {
    ok: true,
    provider: "WinstonAI",
    contract_version: TRACE_ORIGIN_CONTRACT_VERSION,
    score_semantics: TRACE_ORIGIN_SCORE_SEMANTICS,
    ai_probability: aiProbability,
    human_probability: humanProbability,
    classification,
    confidence_state: "available",
    input: input || null,
    provider_result: {
      source_field: selected.source_field,
      source_semantics: selected.source_semantics,
      source_scale: selected.source_scale,
      original_value: selected.original_value,
      normalized_result: selected.source_semantics === "human_probability"
        ? humanProbability
        : aiProbability,
      provider_version: rawResponse.version ?? rawResponse.data?.version ?? null,
      provider_mime_type: rawResponse.mime_type ?? rawResponse.data?.mime_type ?? null,
      candidate_count: candidates.length,
    },
    request_id: requestId,
    error_code: null,
    error_message: null,
    diagnostics: {
      latency_ms: Number.isFinite(latencyMs) ? latencyMs : null,
      fallback_used: false,
    },
  };
}

function storeOriginInput({ buffer, mimeType, filename, sha256, requestId }) {
  const token = crypto.randomBytes(24).toString("hex");
  const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  originInputStore.set(token, {
    buffer,
    mimeType,
    filename,
    sha256,
    requestId,
    expiresAt: Date.now() + ORIGIN_INPUT_LIFETIME_MS,
    accessCount: 0,
    lastAccessAt: null,
  });
  return { token, ext };
}

function deleteOriginInputLater(token, delayMs = 30_000) {
  const timer = setTimeout(() => originInputStore.delete(token), delayMs);
  timer.unref?.();
}

async function callWinstonImage(imageUrl) {
  if (!WINSTON_TOKEN) {
    return {
      ok: false,
      status: 500,
      data: { error: "Missing WINSTONAI_API_KEY" },
      latencyMs: 0,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.winstonTimeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch("https://api.gowinston.ai/v2/image-detection", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${WINSTON_TOKEN}`,
      },
      body: JSON.stringify({
        url: imageUrl,
        version: WINSTON_IMAGE_VERSION,
      }),
      signal: controller.signal,
    });

    const responseText = await response.text();
    let data = null;
    try { data = responseText ? JSON.parse(responseText) : null; } catch {}

    return {
      ok: response.ok,
      status: response.status || 0,
      data,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    return {
      ok: false,
      status: timedOut ? 504 : 502,
      data: {
        error: timedOut ? "Winston request timed out" : "Winston request failed",
      },
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function performPaidScan({ imageUrl, requestId, input, token }) {
  const winston = await callWinstonImage(imageUrl);
  const inputRecord = originInputStore.get(token);

  console.log(JSON.stringify({
    event: "trace_origin_provider_response",
    request_id: requestId,
    provider: "WinstonAI",
    provider_status: winston.status,
    provider_version_requested: WINSTON_IMAGE_VERSION,
    input_sha256_prefix: String(input.sha256 || "").slice(0, 12),
    input_bytes: input.bytes,
    provider_fetch_count: inputRecord?.accessCount ?? 0,
    latency_ms: winston.latencyMs,
    credits_remaining: winston.data?.credits_remaining ?? winston.data?.data?.credits_remaining ?? null,
  }));

  if (!winston.ok) {
    const description =
      winston.data?.description ||
      winston.data?.error ||
      winston.data?.message ||
      "Upstream scan failed";

    const confidenceState = winston.status === 400 || winston.status === 415
      ? "invalid_provider_response"
      : "provider_unavailable";

    return canonicalOriginError({
      requestId,
      confidenceState,
      errorCode: winston.status === 504 ? "provider_timeout" : "provider_unavailable",
      errorMessage: String(description),
      input,
      providerResult: {
        http_status: winston.status,
        provider_version_requested: WINSTON_IMAGE_VERSION,
      },
      latencyMs: winston.latencyMs,
    });
  }

  const normalized = normalizeWinstonOriginResponse(winston.data, {
    requestId,
    input,
    latencyMs: winston.latencyMs,
    // Official Winston v2 image-detection defines score as Human 0..100.
    rawScoreSemantics: "human_probability",
  });

  normalized.provider_result = {
    ...(normalized.provider_result || {}),
    http_status: winston.status,
    provider_version_requested: WINSTON_IMAGE_VERSION,
    provider_fetch_count: inputRecord?.accessCount ?? 0,
  };

  return normalized;
}

function sanitizeOriginRequestId(value) {
  const text = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{12,96}$/.test(text) ? text : crypto.randomUUID();
}

function originInputMetadata(req, file, detectedType, serverHash, clientHash, requestId) {
  return {
    sha256: serverHash,
    server_sha256: serverHash,
    client_sha256: clientHash || null,
    hash_match: clientHash ? clientHash === serverHash : null,
    bytes: file.buffer.length,
    mime_type: detectedType.mime,
    filename: normalizeFilename(file.originalname, `artwork.${detectedType.ext}`),
    request_id: requestId,
  };
}

function cleanupOriginRuntime(now = Date.now()) {
  for (const [token, record] of originInputStore) {
    if (record.expiresAt <= now) originInputStore.delete(token);
  }
  for (const [requestId, record] of originRequestResults) {
    if (record.expiresAt <= now) originRequestResults.delete(requestId);
  }
}

function resetProofDailyUsageIfNeeded() {
  const today = utcDayKey();

  if (today !== proofPublishDay) {
    proofPublishDay = today;
    proofsPublishedToday = 0;
  }
}

function proofPublishLimit(req, res, next) {
  resetProofDailyUsageIfNeeded();

  const now = Date.now();
  const ip = clientIp(req);
  let bucket = proofPublishBuckets.get(ip);

  if (!bucket || now >= bucket.resetAt) {
    bucket = {
      count: 0,
      resetAt: now + CONFIG.proofPublishWindowMs,
    };
  }

  bucket.count += 1;
  proofPublishBuckets.set(ip, bucket);

  if (bucket.count > CONFIG.proofPublishLimitPerIp) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.resetAt - now) / 1000)
    );

    res.setHeader("Retry-After", String(retryAfterSeconds));

    return res.status(429).json({
      ok: false,
      error: "Too many proof publications. Try again later.",
      retry_after_seconds: retryAfterSeconds,
    });
  }

  if (proofsPublishedToday >= CONFIG.proofGlobalDailyLimit) {
    return res.status(503).json({
      ok: false,
      error: "TRACE proof registry daily limit has been reached.",
    });
  }

  return next();
}

function normalizeProofId(value) {
  const id = String(value || "")
    .trim()
    .replace(/^sha256:/i, "")
    .toLowerCase();

  return /^[a-f0-9]{64}$/.test(id) ? id : "";
}

function canonicalizeProofValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalizeProofValue);
  }

  if (value && typeof value === "object") {
    const output = {};

    for (const key of Object.keys(value).sort()) {
      output[key] = canonicalizeProofValue(value[key]);
    }

    return output;
  }

  return value;
}

function traceSignaturePayload(proof) {
  const payload = JSON.parse(JSON.stringify(proof || {}));

  delete payload.sig_b64;
  delete payload.pub_jwk;

  if (payload.sig_scope === "TRACE_CORE_V1") {
    delete payload.img_data_url;
    delete payload.wm_data_url;
    delete payload.img_preview_url;
    delete payload.thumb_data_url;
  }

  return payload;
}

const TRACE_GLYPH_SPEC_VERSION = "trace-glyph-v1";
const TRACE_GLYPH_LAYER_COUNTS = Object.freeze({ minimal: 1, structured: 2, layered: 3, complex: 4 });
const TRACE_GLYPH_STYLE_RULES = Object.freeze({
  hash_shards: Object.freeze({ structures: ["woven_paths", "interlocked_arcs"], motions: ["convergent_flow", "braided_rotation"] }),
  spiro_flow: Object.freeze({ structures: ["woven_paths", "interlocked_arcs"], motions: ["convergent_flow", "braided_rotation"] }),
  helix_clean: Object.freeze({ structures: ["axial_strands", "woven_paths"], motions: ["braided_rotation", "convergent_flow"] }),
  orbit_ring: Object.freeze({ structures: ["orbital_rings", "interlocked_arcs"], motions: ["divergent_orbit", "braided_rotation"] }),
  dna_braid: Object.freeze({ structures: ["braided_strands", "woven_paths"], motions: ["braided_rotation", "convergent_flow"] }),
  minimal_pulse: Object.freeze({ structures: ["pulse_loops", "interlocked_arcs"], motions: ["pulse_breath", "convergent_flow"] }),
});

function validateTraceGlyphSpecification(candidate, origin = null) {
  const fail = (reason) => ({ ok: false, reason });
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return fail("glyph_spec_missing_or_invalid");
  if (candidate.version !== TRACE_GLYPH_SPEC_VERSION) return fail("glyph_spec_version_unsupported");
  const rule = TRACE_GLYPH_STYLE_RULES[candidate.style];
  if (!rule) return fail("glyph_spec_style_invalid");
  if (!rule.structures.includes(candidate.structure)) return fail("glyph_spec_structure_invalid");
  if (!rule.motions.includes(candidate.motion)) return fail("glyph_spec_motion_invalid");
  if (!Object.hasOwn(TRACE_GLYPH_LAYER_COUNTS, candidate.complexity)) return fail("glyph_spec_complexity_invalid");
  if (candidate.layer_count !== TRACE_GLYPH_LAYER_COUNTS[candidate.complexity]) return fail("glyph_spec_layer_count_mismatch");
  if (!Number.isInteger(candidate.primary_path_count) || candidate.primary_path_count < 4 || candidate.primary_path_count > 22) return fail("glyph_spec_primary_path_count_invalid");
  if (!Number.isInteger(candidate.symmetry) || candidate.symmetry < 1 || candidate.symmetry > 6) return fail("glyph_spec_symmetry_invalid");
  if (!Number.isFinite(candidate.density) || candidate.density < 0.25 || candidate.density > 0.95) return fail("glyph_spec_density_invalid");
  if (!Number.isFinite(candidate.animation_speed) || candidate.animation_speed < 0.18 || candidate.animation_speed > 0.9) return fail("glyph_spec_animation_speed_invalid");
  if (!["clockwise", "counterclockwise"].includes(candidate.rotation_direction)) return fail("glyph_spec_rotation_invalid");
  if (!["fine", "balanced", "bold"].includes(candidate.stroke_profile)) return fail("glyph_spec_stroke_profile_invalid");
  if (!/^[a-f0-9]{64}$/.test(String(candidate.palette_seed || ""))) return fail("glyph_spec_palette_seed_invalid");
  if (!/^[a-f0-9]{64}$/.test(String(candidate.geometry_seed || ""))) return fail("glyph_spec_geometry_seed_invalid");
  const influence = candidate.visual_signal_influence;
  if (!influence || influence.kind !== "aesthetic_only") return fail("glyph_spec_visual_signal_role_invalid");
  if (!Number.isFinite(influence.ai_probability) || influence.ai_probability < 0 || influence.ai_probability > 1) return fail("glyph_spec_visual_signal_invalid");
  if (!Number.isFinite(influence.palette_tension) || influence.palette_tension < 0 || influence.palette_tension > 0.22) return fail("glyph_spec_palette_tension_invalid");
  const originAi = Number(origin?.ai_probability);
  if (Number.isFinite(originAi) && Math.abs(originAi - influence.ai_probability) > 0.000001) return fail("glyph_spec_origin_signal_mismatch");
  return { ok: true, version: TRACE_GLYPH_SPEC_VERSION };
}

function compactPublicProof(proof) {
  const compact = JSON.parse(JSON.stringify(proof || {}));

  delete compact.img_data_url;
  delete compact.wm_data_url;
  delete compact.img_preview_url;
  delete compact.thumb_data_url;

  return compact;
}

/*
 * Supabase stores JSON as jsonb, which can reorder object keys.
 * Registry retries must therefore compare canonical proof content rather than
 * raw JSON.stringify output. Old routing fields are ignored because the public
 * verification URL is always derived server-side from the verified Badge ID.
 */
function registryProofIdentity(proof) {
  const identity = traceSignaturePayload(proof);

  delete identity.verification_url;
  delete identity.verify_url;
  delete identity.trace_url;
  delete identity.public_url;
  delete identity.public_verification_url;
  delete identity.qr_url;

  return canonicalizeProofValue(identity);
}

function registryProofIdentityHash(proof) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(registryProofIdentity(proof)))
    .digest("hex");
}

function decodeBase64(value) {
  try {
    return Buffer.from(String(value || ""), "base64");
  } catch {
    return Buffer.alloc(0);
  }
}

async function sha256HexText(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""), "utf8")
    .digest("hex");
}

async function verifyTraceProofCryptographically(proof) {
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) {
    return { ok: false, reason: "invalid_proof" };
  }

  const id = normalizeProofId(proof.badge_key || proof.badge_id);
  const alg = String(proof.sig_alg || "");
  const signature = decodeBase64(proof.sig_b64);
  const publicJwk = proof.pub_jwk;

  if (!id) return { ok: false, reason: "invalid_badge_id" };
  if (!signature.length) return { ok: false, reason: "missing_signature" };
  if (!publicJwk || typeof publicJwk !== "object") {
    return { ok: false, reason: "missing_public_key" };
  }

  if (alg !== "Ed25519" && alg !== "ECDSA_P256_SHA256") {
    return { ok: false, reason: "unsupported_signature_algorithm" };
  }

  /*
   * Existing TRACE identities were derived from the browser's original JWK
   * property order. Also accept canonical JWK order so transport/parsing cannot
   * create a false creator-ID mismatch.
   */
  const rawCreatorId = await sha256HexText(
    `${alg}|${JSON.stringify(publicJwk)}`
  );
  const canonicalCreatorId = await sha256HexText(
    `${alg}|${JSON.stringify(canonicalizeProofValue(publicJwk))}`
  );
  const claimedCreatorId = String(proof.creator_id || "")
    .trim()
    .replace(/^sha256:/i, "")
    .toLowerCase();

  if (
    claimedCreatorId !== rawCreatorId.toLowerCase() &&
    claimedCreatorId !== canonicalCreatorId.toLowerCase()
  ) {
    return { ok: false, reason: "creator_id_mismatch" };
  }

  const payload = traceSignaturePayload(proof);
  const canonical = JSON.stringify(canonicalizeProofValue(payload));
  const bytes = Buffer.from(canonical, "utf8");

  try {
    const publicKey = crypto.createPublicKey({
      key: publicJwk,
      format: "jwk",
    });

    let valid = false;

    if (alg === "Ed25519") {
      valid = crypto.verify(
        null,
        bytes,
        publicKey,
        signature
      );
    } else {
      /*
       * Browser WebCrypto ECDSA signatures use IEEE-P1363 r||s encoding.
       */
      valid = crypto.verify(
        "sha256",
        bytes,
        {
          key: publicKey,
          dsaEncoding: "ieee-p1363",
        },
        signature
      );
    }

    return {
      ok: Boolean(valid),
      reason: valid ? "ok" : "bad_signature",
      id,
      alg,
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "trace_signature_verification_error",
        message: String(error?.message || error),
        algorithm: alg,
      })
    );

    return {
      ok: false,
      reason: "signature_verification_error",
    };
  }
}

function proofRegistryError(prefix, error, fallbackStatus = 502) {
  const code = String(error?.code || "unknown");
  const message = String(
    error?.message ||
    error?.details ||
    error?.hint ||
    "Unknown Supabase error"
  );

  const wrapped = new Error(`${prefix} [${code}]: ${message}`);
  wrapped.httpStatus =
    code === "23505"
      ? 409
      : Number(error?.status) || fallbackStatus;
  wrapped.registryCode = code;
  return wrapped;
}

async function readProofFromSupabase(id) {
  if (!PROOF_REGISTRY_CONFIGURED || !supabaseAdmin) {
    const error = new Error(proofRegistryConfigurationMessage());
    error.httpStatus = 503;
    throw error;
  }

  const {
    data,
    error,
  } = await supabaseAdmin
    .from("trace_proofs")
    .select("id, proof, created_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw proofRegistryError("Proof registry read failed", error);
  }

  return data || null;
}

async function insertProofIntoSupabase(id, proof) {
  if (!PROOF_REGISTRY_CONFIGURED || !supabaseAdmin) {
    const error = new Error(proofRegistryConfigurationMessage());
    error.httpStatus = 503;
    throw error;
  }

  /*
   * No return=representation here. A successful insert only needs INSERT
   * permission, and this avoids an unnecessary second permission check.
   */
  const {
    error,
  } = await supabaseAdmin
    .from("trace_proofs")
    .insert({
      id,
      proof,
    });

  if (error) {
    throw proofRegistryError(
      error.code === "23505"
        ? "Proof already exists"
        : "Proof registry write failed",
      error
    );
  }

  return true;
}

function publicVerificationUrl(req, id) {
  const browserOrigin = String(req.headers.origin || "")
    .trim()
    .replace(/\/+$/, "");

  const base = /^https?:\/\//i.test(browserOrigin)
    ? browserOrigin
    : requestBase(req);

  return `${base}/verify/${encodeURIComponent(id)}`;
}

function verificationPathForId(id) {
  return `/verify/${encodeURIComponent(id)}`;
}

function verificationUrlHasCorrectPath(value, id, req) {
  if (!value) return true;

  try {
    const parsed = new URL(
      String(value),
      publicVerificationUrl(req, id)
    );

    return parsed.pathname === verificationPathForId(id);
  } catch {
    return false;
  }
}

app.post("/proofs", proofPublishLimit, async (req, res) => {
  const requestId = crypto.randomBytes(6).toString("hex");

  try {
    if (!PROOF_REGISTRY_CONFIGURED) {
      return res.status(503).json({
        ok: false,
        error: proofRegistryConfigurationMessage(),
        registry_url_source: SUPABASE_URL_SOURCE,
        registry_key_source: SUPABASE_KEY_SOURCE,
        request_id: requestId,
      });
    }

    const proof = compactPublicProof(req.body);
    const verification = await verifyTraceProofCryptographically(proof);

    if (!verification.ok) {
      console.warn(
        JSON.stringify({
          event: "trace_proof_rejected",
          request_id: requestId,
          reason: verification.reason,
          badge_id_prefix: String(
            proof.badge_key || proof.badge_id || ""
          ).slice(0, 12),
        })
      );

      return res.status(400).json({
        ok: false,
        error: "Proof signature validation failed",
        reason: verification.reason,
        request_id: requestId,
      });
    }

    const requiresOriginAnalysis = Boolean(proof.img_hash);
    const origin = proof && typeof proof.origin === "object" ? proof.origin : null;
    if (proof.glyph_spec !== undefined && proof.glyph_spec !== null) {
      const glyphValidation = validateTraceGlyphSpecification(proof.glyph_spec, origin);
      if (!glyphValidation.ok) {
        return res.status(422).json({
          ok: false,
          error: "The signed TRACE glyph specification is invalid",
          reason: glyphValidation.reason,
          request_id: requestId,
        });
      }
    }
    const aiProbability = typeof origin?.ai_probability === "number"
      ? origin.ai_probability
      : null;
    const humanProbability = typeof origin?.human_probability === "number"
      ? origin.human_probability
      : null;
    const expectedClassification = aiProbability === null
      ? null
      : classifyAiProbability(aiProbability);
    const expectedVisualClass = expectedClassification === "human_leaning"
      ? "human"
      : expectedClassification === "inconclusive"
        ? "mixed"
        : expectedClassification === "ai_like"
          ? "ai_like"
          : null;
    const originAnalysisComplete = Boolean(
      origin &&
      origin.ok === true &&
      origin.analysis_available === true &&
      origin.local_fallback !== true &&
      origin.provider === "WinstonAI" &&
      origin.contract_version === TRACE_ORIGIN_CONTRACT_VERSION &&
      origin.score_semantics === TRACE_ORIGIN_SCORE_SEMANTICS &&
      Number.isFinite(aiProbability) &&
      aiProbability >= 0 &&
      aiProbability <= 1 &&
      Number.isFinite(humanProbability) &&
      humanProbability >= 0 &&
      humanProbability <= 1 &&
      Math.abs((aiProbability + humanProbability) - 1) <= TRACE_ORIGIN_SCORE_TOLERANCE &&
      Number(origin.score_0_1) === aiProbability &&
      origin.classification === expectedClassification &&
      origin.visual_class === expectedVisualClass &&
      /^[a-f0-9]{64}$/.test(String(origin.input_sha256 || "")) &&
      String(origin.input_sha256) === String(proof.img_hash) &&
      String(origin.input?.server_sha256 || origin.input?.sha256 || "") === String(proof.img_hash) &&
      origin.input?.hash_match === true &&
      typeof origin.request_id === "string" &&
      origin.request_id.length >= 12
    );

    const legacyOriginRecord = Boolean(
      requiresOriginAnalysis &&
      proof.origin_contract_required !== true &&
      origin &&
      !origin.contract_version &&
      !origin.score_semantics
    );

    if (requiresOriginAnalysis && !originAnalysisComplete && !legacyOriginRecord) {
      return res.status(422).json({
        ok: false,
        error: "A signed artwork proof requires a valid TRACE Origin Scan contract",
        reason: "origin_contract_required",
        request_id: requestId,
      });
    }

    if (legacyOriginRecord) {
      console.warn(JSON.stringify({
        event: "trace_legacy_origin_proof_published",
        request_id: requestId,
        badge_id_prefix: String(proof.badge_key || proof.badge_id || "").slice(0, 12),
        visual_interpretation: "unavailable",
      }));
    }

    const id = verification.id;
    const expectedUrl = publicVerificationUrl(req, id);

    /*
     * The public verification URL is always derived server-side from the
     * cryptographically verified Badge ID. Any legacy verification_url field
     * inside the signed proof is preserved but never trusted for routing.
     */
    const serialized = JSON.stringify(proof);

    if (Buffer.byteLength(serialized, "utf8") > 64 * 1024) {
      return res.status(413).json({
        ok: false,
        error: "Public proof is too large",
        request_id: requestId,
      });
    }

    const existing = await readProofFromSupabase(id);

    if (existing) {
      const existingVerification =
        await verifyTraceProofCryptographically(existing.proof);

      if (!existingVerification.ok) {
        return res.status(500).json({
          ok: false,
          error: "The stored proof failed registry integrity verification",
          reason: existingVerification.reason,
          request_id: requestId,
        });
      }

      const existingHash = registryProofIdentityHash(existing.proof);
      const incomingHash = registryProofIdentityHash(proof);

      if (existingHash !== incomingHash) {
        return res.status(409).json({
          ok: false,
          error: "A different signed proof already exists for this Badge ID",
          request_id: requestId,
        });
      }

      /*
       * This is a normal idempotent retry: the proof was already stored during
       * automatic publication and Share is asking for the same QR URL again.
       */
      return res.json({
        ok: true,
        id,
        verification_url: expectedUrl,
        already_registered: true,
        request_id: requestId,
      });
    }

    await insertProofIntoSupabase(id, proof);
    proofsPublishedToday += 1;

    console.log(
      JSON.stringify({
        event: "trace_proof_published",
        request_id: requestId,
        badge_id_prefix: id.slice(0, 12),
        proofs_published_today: proofsPublishedToday,
      })
    );

    return res.status(201).json({
      ok: true,
      id,
      verification_url: expectedUrl,
      already_registered: false,
      request_id: requestId,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "trace_proof_publish_error",
        request_id: requestId,
        message: String(error?.message || error),
        registry_status: error?.registryStatus || null,
        registry_code: error?.registryCode || null,
      })
    );

    return res.status(error.httpStatus || 500).json({
      ok: false,
      error: error.message || "Proof publication failed",
      request_id: requestId,
    });
  }
});

app.get("/proofs/:id", async (req, res) => {
  const id = normalizeProofId(req.params.id);

  if (!id) {
    return res.status(400).json({
      ok: false,
      error: "Invalid Badge ID",
    });
  }

  try {
    const row = await readProofFromSupabase(id);

    if (!row) {
      return res.status(404).json({
        ok: false,
        error: "Proof not found",
      });
    }

    const verification = await verifyTraceProofCryptographically(row.proof);

    if (!verification.ok) {
      return res.status(500).json({
        ok: false,
        error: "Stored proof failed integrity verification",
      });
    }

    res.setHeader(
      "Cache-Control",
      "public, max-age=60, stale-while-revalidate=300"
    );

    return res.json({
      ok: true,
      id,
      proof: row.proof,
      registered_at: row.created_at,
      server_signature_valid: true,
    });
  } catch (error) {
    return res.status(error.httpStatus || 500).json({
      ok: false,
      error: error.message || "Proof lookup failed",
    });
  }
});

const PUBLIC_VERIFY_GLYPH_RUNTIME = "function makeHelixSvg(seedInput, aiFlag, scoreOrImg, maybeImg, mode){\n  // mode can be string (\"badge\"/\"profile\"/\"primitive\"/\"avatar\") or object {mode, style, evo, meta}\n  const _modeRaw = (mode && typeof mode === \"object\") ? (mode.mode || \"badge\") : (mode || \"badge\");\n  const isAvatar = (_modeRaw === \"avatar\");\n  const _mode = isAvatar ? \"profile\" : _modeRaw;\n\n  // Evolution controls (for smoother, less \"random\" progression)\n  const EVO  = (mode && typeof mode === \"object\" && mode.evo)  ? mode.evo  : null; // {stage, epoch, aiRatio, humanRatio, diversity, avgPayload, ...}\n  const META = (mode && typeof mode === \"object\" && mode.meta) ? mode.meta : null; // {payloadLen, hasImg, ...}\n\n  // style resolution: explicit -> live override -> stored default (override is admin-gated elsewhere)\n  const _style = (mode && typeof mode === \"object\" && mode.style)\n    ? mode.style\n    : (window.__traceGlyphStyleOverride || (typeof window.__traceGetGlyphStyle === \"function\" ? window.__traceGetGlyphStyle() : \"spiro_flow\"));\n  const STYLE = String(_style || \"spiro_flow\");\n\n  // Dimensions\n  const W = isAvatar ? 64 : 142;\n  const H = isAvatar ? 64 : 92;\n\n  // Primitive: fewer signals (no image + no score + not flagged)\n  const primitive = (_mode === \"primitive\") || (!maybeImg && (!isFinite(scoreOrImg) || scoreOrImg===null || scoreOrImg===undefined) && !aiFlag);\n\n  // ---- deterministic seed -> uint32 (FNV-1a) ----\n  // IMPORTANT: for profile/avatar evolution we keep the seed STABLE and feed progression via EVO,\n  // so the glyph changes smoothly instead of \"jumping\" due to a reseed.\n  const evoStable = !!(EVO && (_modeRaw === \"avatar\" || _modeRaw === \"profile\"));\n  const seedStr = String(seedInput ?? \"\")\n    + \"|\" + STYLE\n    + \"|\" + (evoStable ? \"stable\" : (\"ai=\"+String(aiFlag?1:0)))\n    + \"|\" + (evoStable ? \"\" : (\"score=\"+String(scoreOrImg ?? \"\")))\n    + \"|\" + (maybeImg ? (\"img:\"+maybeImg.length) : \"noimg\")\n    + \"|\" + _modeRaw;\n\n  let h = 2166136261 >>> 0;\n  for(let i=0;i<seedStr.length;i++){\n    h ^= seedStr.charCodeAt(i);\n    h = Math.imul(h, 16777619);\n  }\n  const S = h >>> 0;\n\n  // Small PRNG\n  function rnd(){\n    let x = (rnd.s = (rnd.s + 0x6D2B79F5) >>> 0);\n    x ^= x >>> 15; x = Math.imul(x, 1 | x);\n    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);\n    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;\n  }\n  rnd.s = S;\n\n  const clamp01 = (x)=>Math.max(0, Math.min(1, Number(x)||0));\n  const lerp = (a,b,t)=>a + (b-a)*t;\n\n  // Evolution metrics\n  const stage = EVO ? (Number(EVO.stage)||0) : 0;\n  const epoch = EVO ? (Number(EVO.epoch)||0) : 0;\n  const aiR   = EVO ? clamp01(EVO.aiRatio) : (aiFlag ? 1 : 0);\n  const huR   = EVO ? clamp01(EVO.humanRatio) : (aiFlag ? 0 : 1);\n  const divR  = EVO ? clamp01(EVO.diversity) : 0;\n\n  // Complexity: logical progression (badges/history => more structure, more signals => more detail)\n  const badgeHasImg = META ? !!META.hasImg : !!maybeImg;\n  const payloadLen = META ? (Number(META.payloadLen)||0) : 0;\n\n  const baseComplex =\n    primitive ? 0.10 :\n    EVO ? ( // profile complexity: grows smoothly with stage, slightly with diversity/avgPayload\n      clamp01(Math.log1p(stage) / Math.log1p(42)) * 0.78\n      + clamp01(divR) * 0.12\n      + clamp01((Number(EVO.avgPayload)||0)/260) * 0.10\n    ) :\n    ( // badge complexity: more inputs -> more detail (still clean)\n      0.22\n      + (badgeHasImg ? 0.28 : 0.00)\n      + (isFinite(scoreOrImg) ? clamp01(scoreOrImg)*0.14 : 0.00)\n      + clamp01(payloadLen/260)*0.18\n      + (aiFlag ? 0.06 : 0.00)\n    );\n\n  const COMPLEX = clamp01(baseComplex);\n\n  // Thin strokes (keep look)\n  const STROKE = (primitive ? 0.62 : (isAvatar ? 0.86 : 0.74)) * (0.95 + COMPLEX*0.06);\n  const HALO   = (primitive ? 2.1  : (isAvatar ? 2.6  : 2.1));\n  const HALO_A = (primitive ? 0.045 : (isAvatar ? 0.065 : 0.050)) * (0.92 + COMPLEX*0.18);\n\n  // Seeded multi-color palette (clean neon) + smooth drift with stage (profile)\n  let baseHue = Math.floor(rnd()*360);\n  if(EVO){\n    baseHue = (baseHue + Math.floor(stage*11 + epoch*3 + divR*80)) % 360;\n  }else{\n    // badge: small drift from payload length (still deterministic)\n    baseHue = (baseHue + Math.floor((payloadLen%97)*1.3)) % 360;\n  }\n\n  const spread = 62 + Math.floor(rnd()*14);\n  const h1 = baseHue;\n  const h2 = (baseHue + spread + Math.floor(rnd()*18)) % 360;\n  const h3 = (baseHue + 2*spread + Math.floor(rnd()*18)) % 360;\n  const h4 = (baseHue + 240 + Math.floor(rnd()*18)) % 360;\n  const h5 = (baseHue + 300 + Math.floor(rnd()*18)) % 360;\n\n  const c1 = `hsl(${h1}, 96%, 62%)`;\n  const c2 = `hsl(${h2}, 96%, 64%)`;\n  const c3 = `hsl(${h3}, 96%, 62%)`;\n  const c4 = `hsl(${h4}, 96%, 63%)`;\n  const c5 = `hsl(${h5}, 96%, 62%)`;\n\n  const coreA = isAvatar ? 0.26 : 0.18;\n  const coreB = isAvatar ? 0.12 : 0.08;\n\n  const uid = (S.toString(16).padStart(8,\"0\"));\n  const g1 = `grad_${uid}_1`;\n  const g2 = `grad_${uid}_2`;\n  const g3 = `grad_${uid}_3`;\n\n  let svg = '';\n  svg += `<svg class=\"glyph3d\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 ${W} ${H}\" width=\"${W}\" height=\"${H}\" role=\"img\" aria-label=\"glyph\" preserveAspectRatio=\"xMidYMid slice\">`;\n  svg += `<defs>\n    <radialGradient id=\"core_${uid}\" cx=\"50%\" cy=\"50%\" r=\"80%\">\n      <stop offset=\"0%\" stop-color=\"${c3}\" stop-opacity=\"${coreA}\"/>\n      <stop offset=\"42%\" stop-color=\"${c1}\" stop-opacity=\"${coreB}\"/>\n      <stop offset=\"100%\" stop-color=\"#000\" stop-opacity=\"1\"/>\n    </radialGradient>\n\n    <linearGradient id=\"${g1}\" gradientUnits=\"userSpaceOnUse\" x1=\"0\" y1=\"0\" x2=\"${W}\" y2=\"${H}\">\n      <stop offset=\"0%\"   stop-color=\"${c1}\"/>\n      <stop offset=\"28%\"  stop-color=\"${c2}\"/>\n      <stop offset=\"55%\"  stop-color=\"${c3}\"/>\n      <stop offset=\"80%\"  stop-color=\"${c4}\"/>\n      <stop offset=\"100%\" stop-color=\"${c5}\"/>\n    </linearGradient>\n\n    <linearGradient id=\"${g2}\" gradientUnits=\"userSpaceOnUse\" x1=\"${W}\" y1=\"0\" x2=\"0\" y2=\"${H}\">\n      <stop offset=\"0%\"   stop-color=\"${c5}\"/>\n      <stop offset=\"28%\"  stop-color=\"${c4}\"/>\n      <stop offset=\"55%\"  stop-color=\"${c3}\"/>\n      <stop offset=\"80%\"  stop-color=\"${c2}\"/>\n      <stop offset=\"100%\" stop-color=\"${c1}\"/>\n    </linearGradient>\n\n    <linearGradient id=\"${g3}\" gradientUnits=\"userSpaceOnUse\" x1=\"0\" y1=\"${H}\" x2=\"${W}\" y2=\"0\">\n      <stop offset=\"0%\"   stop-color=\"${c2}\"/>\n      <stop offset=\"28%\"  stop-color=\"${c5}\"/>\n      <stop offset=\"55%\"  stop-color=\"${c3}\"/>\n      <stop offset=\"80%\"  stop-color=\"${c1}\"/>\n      <stop offset=\"100%\" stop-color=\"${c4}\"/>\n    </linearGradient>\n\n    <filter id=\"glow_${uid}\" x=\"-40%\" y=\"-40%\" width=\"180%\" height=\"180%\">\n      <feGaussianBlur stdDeviation=\"${isAvatar ? 1.25 : 1.45}\" result=\"b\"/>\n      <feMerge>\n        <feMergeNode in=\"b\"/>\n        <feMergeNode in=\"SourceGraphic\"/>\n      </feMerge>\n    </filter>\n  </defs>`;\n\n  svg += `<rect x=\"0\" y=\"0\" width=\"${W}\" height=\"${H}\" fill=\"#000\"/>`;\n  svg += `<rect x=\"0\" y=\"0\" width=\"${W}\" height=\"${H}\" fill=\"url(#core_${uid})\" opacity=\"0.95\"/>`;\n\n  svg += `<g class=\"motion\" data-seed=\"${S}\" data-w=\"${W}\" data-h=\"${H}\" data-mode=\"${_modeRaw}\" data-style=\"${STYLE}\">`;\n\n  const cx = W/2, cy = H/2;\n  const minR = Math.min(W,H);\n  const R = isAvatar ? minR*0.36 : minR*0.38;\n\n  function pickGrad(i){\n    return (i % 3 === 0) ? g1 : (i % 3 === 1 ? g2 : g3);\n  }\n\n  function addStrand(kind, params, opacity=0.90, gradId=null){\n    const pA = params.map(v=>Number(v).toFixed(6)).join(\",\");\n    const gid = gradId || pickGrad((addStrand.i = (addStrand.i||0) + 1));\n    svg += `<path class=\"strand\" data-kind=\"${kind}\" data-p=\"${pA}\" fill=\"none\" stroke=\"url(#${gid})\" stroke-width=\"${STROKE}\" stroke-linecap=\"round\" stroke-linejoin=\"round\" filter=\"url(#glow_${uid})\" opacity=\"${opacity}\" d=\"M0 0\"/>`;\n    svg += `<path class=\"strandHalo\" data-kind=\"${kind}\" data-p=\"${pA}\" fill=\"none\" stroke=\"${c1}\" stroke-width=\"${HALO}\" stroke-linecap=\"round\" stroke-linejoin=\"round\" opacity=\"${HALO_A}\" d=\"M0 0\"/>`;\n  }\n\n  const phi = 1.61803398875;\n  const golden = 2.399963229728653;\n  const drift = (EVO ? (stage*0.18 + epoch*0.07) : 0); // smooth phase drift, not reseeding\n\n  // --- Styles: same families, but complexity grows logically instead of random jumps ---\n  if(STYLE === \"orbit_ring\"){\n    // Always create up to 3 rings, but fade-in + tighten with COMPLEX\n    const t1 = clamp01((COMPLEX-0.18)/0.62);\n    const t2 = clamp01((COMPLEX-0.55)/0.40);\n\n    // main ring\n    {\n      const phase = rnd()*Math.PI*2 + drift*0.25;\n      const a = R*(0.96);\n      const b = R*(0.67);\n      const wob = lerp(0.014, 0.030, COMPLEX);\n      const freq = 2.0 + COMPLEX*1.25;\n      const tilt = (rnd()-0.5)*0.18 + (aiR-0.5)*0.10;\n      addStrand(\"orbit\", [phase,a,b,wob,freq,tilt], 0.92, g1);\n    }\n\n    // secondary ring (fades in)\n    {\n      const phase = rnd()*Math.PI*2 + golden + drift*0.22;\n      const a = R*(0.84);\n      const b = R*(0.58);\n      const wob = lerp(0.010, 0.024, COMPLEX);\n      const freq = 2.4 + COMPLEX*1.55;\n      const tilt = (rnd()-0.5)*0.16 - (aiR-0.5)*0.08;\n      addStrand(\"orbit_inner\", [phase,a,b,wob,freq,tilt], 0.18 + 0.70*t1, g2);\n    }\n\n    // tertiary thin orbit (late-stage, very faint)\n    {\n      const phase = rnd()*Math.PI*2 + golden*2 + drift*0.18;\n      const a = R*(0.62);\n      const b = R*(0.44);\n      const wob = lerp(0.008, 0.016, COMPLEX);\n      const freq = 3.0 + COMPLEX*1.85;\n      const tilt = (rnd()-0.5)*0.12;\n      addStrand(\"orbit_inner\", [phase,a,b,wob,freq,tilt], 0.08 + 0.55*t2, g3);\n    }\n  }else if(STYLE === \"spiro_flow\"){\n    // Spirograph: add layers as COMPLEX grows (opacity ramps, not hard jumps)\n    const t2 = clamp01((COMPLEX-0.18)/0.62);\n    const t3 = clamp01((COMPLEX-0.68)/0.30);\n\n    const bigR  = 36 + rnd()*12 + COMPLEX*6;\n    const smallr= 10 + rnd()*7;\n    const d     = 14 + rnd()*18 + COMPLEX*6;\n    const rot   = (rnd()-0.5)*0.85 + (huR-0.5)*0.12;\n    const phase = rnd()*Math.PI*2 + drift*0.14;\n    const scale = (isAvatar? 1.02 : 1.07) * (0.98 + COMPLEX*0.08);\n\n    addStrand(\"spiro\", [bigR, smallr, d, phase, rot, scale], 0.93, g1);\n\n    // secondary spiro (fades in)\n    addStrand(\"spiro2\", [bigR*0.92, smallr*1.08, d*0.72, phase+phi, rot*0.62, scale*0.98], 0.10 + 0.70*t2, g2);\n\n    // tertiary micro-spiro (late-stage)\n    if(t3>0.02){\n      addStrand(\"spiro2\", [bigR*0.62, smallr*0.88, d*0.48, phase+phi*2.0, rot*0.38, scale*0.92], 0.02 + 0.45*t3, g3);\n    }\n  }else if(STYLE === \"helix_clean\"){\n    // Helix snakes: 1 -> 2 -> 3 with smooth opacity ramp\n    const t2 = clamp01((COMPLEX-0.20)/0.60);\n    const t3 = clamp01((COMPLEX-0.72)/0.28);\n\n    const basePhase = rnd()*Math.PI*2 + drift*0.20;\n    const twist = 1.02 + rnd()*0.22 + (aiR*0.08);\n    const wob1  = 0.09 + rnd()*0.08 + COMPLEX*0.03;\n    const wob2  = 0.028 + rnd()*0.040;\n    const k1    = 2.0 + rnd()*1.0;\n    const k2    = 5.0 + rnd()*2.2;\n\n    addStrand(\"helix\", [basePhase,twist,wob1,wob2,k1,k2], 0.90, g1);\n    addStrand(\"helix\", [basePhase+golden,twist*0.98,wob1*0.92,wob2*1.05,k1*1.08,k2*0.96], 0.10 + 0.72*t2, g2);\n\n    if(t3>0.02){\n      addStrand(\"helix\", [basePhase+golden*2,twist*1.03,wob1*0.80,wob2*0.90,k1*0.92,k2*1.10], 0.02 + 0.50*t3, g3);\n    }\n  }else if(STYLE === \"dna_braid\"){\n    const t2 = clamp01((COMPLEX-0.24)/0.56);\n\n    const phase = rnd()*Math.PI*2 + drift*0.24;\n    const turns = 2.5 + rnd()*1.35 + COMPLEX*0.6;\n    const sep   = R*(0.40);\n    const amp   = R*(0.30);\n\n    addStrand(\"dna\", [phase, turns, sep, amp, +1, 0], 0.90, g1);\n    addStrand(\"dna\", [phase, turns, sep, amp, -1, 0], 0.12 + 0.74*t2, g2);\n    addStrand(\"dna_back\", [phase+1.2, turns*0.72, sep*0.55, amp*0.18, 0, 0], 0.10 + 0.46*t2, g3);\n  }else if(STYLE === \"minimal_pulse\"){\n    const t2 = clamp01((COMPLEX-0.55)/0.40);\n\n    const phase = rnd()*Math.PI*2 + drift*0.20;\n    const a = R*0.82;\n    const b = R*0.54;\n    addStrand(\"pulse\", [phase,a,b, (rnd()<0.5?1:-1), 0, 0], 0.92, g1);\n\n    // late-stage: faint orbit halo around pulse (still minimal)\n    if(t2>0.02){\n      const ph2 = phase + golden*0.6;\n      addStrand(\"orbit_inner\", [ph2,R*0.56,R*0.40,0.010,3.0,(rnd()-0.5)*0.10], 0.02 + 0.38*t2, g2);\n    }\n  }else if(STYLE === \"hash_shards\"){\n    const t2 = clamp01((COMPLEX-0.22)/0.56);\n    const t3 = clamp01((COMPLEX-0.68)/0.24);\n    const phase = rnd()*Math.PI*2 + drift*0.18;\n    const spokes = 10 + Math.floor(rnd()*5) + Math.round(COMPLEX*6);\n    const inner = R*(0.16 + rnd()*0.06);\n    const outer = R*(0.88 + rnd()*0.07);\n    const jitter = 0.10 + rnd()*0.06;\n    const bloom = 0.18 + rnd()*0.10;\n    addStrand(\"shards\", [phase,spokes,inner,outer,jitter,bloom,0], 0.94, g1);\n    addStrand(\"shards\", [phase+golden*0.38,spokes+2,inner*0.92,outer*0.78,jitter*0.78,bloom*0.86,1], 0.10 + 0.70*t2, g2);\n    if(t3>0.02){\n      addStrand(\"shards\", [phase+golden,spokes+4,inner*0.80,outer*0.62,jitter*0.58,bloom*0.74,2], 0.02 + 0.45*t3, g3);\n    }\n  }else{\n    const phase = rnd()*Math.PI*2 + drift*0.18;\n    addStrand(\"orbit\", [phase,R*0.92,R*0.66,0.026,2.2,(rnd()-0.5)*0.22], 0.90, g1);\n  }\n\n  svg += `</g></svg>`;\n  return svg;\n}\n\nfunction startGlyphMotion(svg){\n  if(!svg) return;\n  if(svg.dataset && svg.dataset.traceMotionStarted === \"1\") return;\n  if(svg.dataset) svg.dataset.traceMotionStarted = \"1\";\n  const g = svg.querySelector(\"g.motion\");\n  if(!g) return;\n\n  const W = +g.dataset.w || 142;\n  const H = +g.dataset.h || 92;\n  const cx = W/2, cy = H/2;\n  const minR = Math.min(W,H);\n  const R = (g.dataset.mode===\"avatar\") ? minR*0.36 : minR*0.38;\n\n  const seed = (+g.dataset.seed) >>> 0;\n  const mode = g.dataset.mode || \"badge\";\n  const style = g.dataset.style || \"orbit_ring\";\n\n  const speedMap = {\n    orbit_ring: 0.55,\n    spiro_flow: 0.70,\n    helix_clean:0.78,\n    dna_braid:  0.62,\n    minimal_pulse:0.48,\n    hash_shards: 0.66\n  };\n  const baseSpeed = speedMap[style] ?? 0.65;\n  const speed = (mode===\"avatar\") ? baseSpeed*0.78 : baseSpeed;\n\n  const strands = Array.from(svg.querySelectorAll(\"path.strand\"));\n  const halos   = Array.from(svg.querySelectorAll(\"path.strandHalo\"));\n\n  function dOrbit(params, t, inner=false){\n    const [phase,a,b,wob,freq,tilt] = params;\n    const steps = (mode===\"avatar\") ? 180 : 210;\n    let d=\"\";\n    for(let i=0;i<=steps;i++){\n      const u = (i/steps) * Math.PI*2;\n      const breath = 1 + Math.sin(t*0.9 + phase)* (inner?0.006:0.010);\n      const ww = wob * Math.sin(u*freq + t*0.85 + phase);\n      const rrA = a * breath * (1+ww);\n      const rrB = b * breath * (1+ww*0.85);\n      // ellipse with a tiny tilt skew\n      const x = cx + Math.cos(u + tilt*Math.sin(t*0.6+phase))*rrA;\n      const y = cy + Math.sin(u)*rrB;\n      d += (i===0?\"M\":\"L\") + x.toFixed(2) + \" \" + y.toFixed(2) + \" \";\n    }\n    return d;\n  }\n\n  function dHelix(params, t){\n    const [phase, twist, wob1, wob2, k1, k2] = params;\n    const turns = (mode===\"avatar\") ? 5.1 : 5.6;\n    const steps = (mode===\"avatar\") ? 200 : 220;\n    let d = \"\";\n    for(let s=0;s<=steps;s++){\n      const u = (s/steps) * Math.PI*2*turns;\n      const wob = wob1*Math.sin(u*k1 + phase + t*0.95) + wob2*Math.sin(u*k2 + phase*1.7 - t*1.15);\n      const rr  = R*(0.93 + wob);\n      const x = cx + Math.cos(u*twist + phase)*rr;\n      const y = cy + Math.sin(u + phase*0.6)*rr*0.70 + Math.sin(u*0.5 + phase)*R*0.030;\n      d += (s===0 ? \"M\" : \"L\") + x.toFixed(2) + \" \" + y.toFixed(2) + \" \";\n    }\n    return d;\n  }\n\n  function dSpiro(params, t, alt=false){\n    let [RR, r, d, phase, rot, scale] = params;\n    const steps = (mode===\"avatar\") ? 520 : 620;\n    const k = (RR - r) / r;\n    let path = \"\";\n    const sc = (Math.min(W,H)/2) / 52 * scale;\n    const tt = t * (alt?0.75:1.0);\n    for(let i=0;i<=steps;i++){\n      const u = (i/steps) * Math.PI*2 * (alt?7.0:8.0);\n      const x0 = (RR-r)*Math.cos(u+tt*0.22) + d*Math.cos(k*u + phase - tt*0.35);\n      const y0 = (RR-r)*Math.sin(u+tt*0.22) - d*Math.sin(k*u + phase - tt*0.35);\n      // rotate\n      const xr = x0*Math.cos(rot) - y0*Math.sin(rot);\n      const yr = x0*Math.sin(rot) + y0*Math.cos(rot);\n      const x = cx + xr*sc;\n      const y = cy + yr*sc;\n      path += (i===0?\"M\":\"L\") + x.toFixed(2) + \" \" + y.toFixed(2) + \" \";\n    }\n    return path;\n  }\n\n  function dDNA(params, t){\n    const [phase, turns, sep, amp, sign] = params;\n    const steps = (mode===\"avatar\") ? 160 : 190;\n    const height = (mode===\"avatar\") ? H*0.82 : H*0.86;\n    const y0 = cy - height/2;\n    let d=\"\";\n    for(let i=0;i<=steps;i++){\n      const u = i/steps;\n      const y = y0 + u*height;\n      const a = (u*turns*Math.PI*2) + phase + t*0.85;\n      const x = cx + sign*sep*Math.cos(a) + (sep*0.18)*Math.sin(a*0.5);\n      const xx = x + (sign*0.6)*Math.sin(t*0.6+phase)*0.5;\n      const yy = y + amp*0.02*Math.sin(a*0.7);\n      d += (i===0?\"M\":\"L\") + xx.toFixed(2) + \" \" + yy.toFixed(2) + \" \";\n    }\n    return d;\n  }\n\n  function dPulse(params, t){\n    const [phase,a,b,flip] = params;\n    const steps = (mode===\"avatar\") ? 240 : 280;\n    let d=\"\";\n    const p = 1 + Math.sin(t*0.9 + phase)*0.020;\n    for(let i=0;i<=steps;i++){\n      const u = (i/steps) * Math.PI*2;\n      // Bernoulli lemniscate-ish (clean infinity)\n      const denom = 1 + Math.sin(u)**2;\n      const x0 = (a * Math.cos(u) / denom) * p;\n      const y0 = (b * Math.sin(u) * Math.cos(u) / denom) * p;\n      const x = cx + x0;\n      const y = cy + y0*flip;\n      d += (i===0?\"M\":\"L\") + x.toFixed(2) + \" \" + y.toFixed(2) + \" \";\n    }\n    return d;\n  }\n\n\n  function dShards(params, t){\n    const [phase,spokes,inner,outer,jitter,bloom,layer] = params;\n    const steps = (mode===\"avatar\") ? 260 : 320;\n    let d=\"\";\n    const tilt = bloom * Math.sin(t*0.42 + phase) * 0.18;\n    for(let i=0;i<=steps;i++){\n      const u = (i/steps) * Math.PI*2;\n      const shardWave = Math.abs(Math.sin(u*spokes + phase + t*0.62));\n      const petal = Math.pow(shardWave, 0.68 + layer*0.08);\n      const micro = 1 + jitter*0.22*Math.sin(u*(spokes*0.5+2.4) - t*0.74 + phase*0.6);\n      const rr = (inner + (outer-inner)*petal) * micro;\n      const wobY = 0.92 + 0.07*Math.cos(u*2 + phase*0.6 + layer*0.4);\n      const x = cx + Math.cos(u + tilt)*rr;\n      const y = cy + Math.sin(u)*rr*wobY;\n      d += (i===0?\"M\":\"L\") + x.toFixed(2) + \" \" + y.toFixed(2) + \" \";\n    }\n    return d;\n  }\n\n  function build(kind, params, t){\n    switch(kind){\n      case \"orbit\": return dOrbit(params, t, false);\n      case \"orbit_inner\": return dOrbit(params, t, true);\n      case \"helix\": return dHelix(params, t);\n      case \"spiro\": return dSpiro(params, t, false);\n      case \"spiro2\": return dSpiro(params, t, true);\n      case \"dna\": return dDNA(params, t);\n      case \"dna_back\": return dDNA(params, t*0.65);\n      case \"pulse\": return dPulse(params, t);\n      case \"shards\": return dShards(params, t);\n      default: return dHelix(params, t);\n    }\n  }\n\n  let raf = 0;\n  function tick(ms){\n    if(!svg || !svg.isConnected){\n      if(raf) cancelAnimationFrame(raf);\n      return;\n    }\n    const t = (ms/1000) * speed + (seed % 997)/997;\n    for(let i=0;i<strands.length;i++){\n      const kind = strands[i].dataset.kind || \"helix\";\n      const p = (strands[i].dataset.p || \"\").split(\",\").map(Number);\n      const d = build(kind, p, t + i*0.14);\n      strands[i].setAttribute(\"d\", d);\n      if(halos[i]) halos[i].setAttribute(\"d\", d);\n    }\n    raf = requestAnimationFrame(tick);\n  }\n  tick((window.performance && performance.now) ? performance.now() : Date.now());\n}";

function verifyPageHtml(id) {
  const safeId = JSON.stringify(id);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>TRACE Public Verification</title>
<style>
:root{color-scheme:dark;--bg:#030507;--card:#090d13;--line:rgba(255,255,255,.11);--text:#edf6ff;--muted:rgba(237,246,255,.64);--green:#35f0a3;--red:#ff5d78;--amber:#ffd36a;--blue:#34d7ff}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--text);background:radial-gradient(700px 460px at 50% -10%,rgba(53,240,163,.12),transparent 60%),linear-gradient(180deg,#020304,#06090e);padding:18px}
main{width:min(760px,100%);margin:5vh auto}
.brand{letter-spacing:.22em;font-weight:900;color:rgba(237,246,255,.72);margin-bottom:16px}
.card{background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.025));border:1px solid var(--line);border-radius:28px;padding:22px;box-shadow:0 24px 80px rgba(0,0,0,.45)}
.seal{width:112px;height:112px;border-radius:50%;display:grid;place-items:center;margin:4px auto 18px;border:1px solid rgba(255,255,255,.16);font-size:54px;background:rgba(255,255,255,.04)}
.seal.good{border-color:rgba(53,240,163,.58);color:var(--green);box-shadow:0 0 0 10px rgba(53,240,163,.05)}
.seal.bad{border-color:rgba(255,93,120,.58);color:var(--red)}

.proofMarks{display:flex;align-items:center;justify-content:center;gap:18px;flex-wrap:wrap;margin:4px auto 18px}
.proofMarks .seal{margin:0}
.glyphUnit{display:grid;gap:7px;justify-items:center}
.glyphLabel{font-size:10px;font-weight:900;letter-spacing:.15em;text-transform:uppercase;color:rgba(237,246,255,.48)}
.glyphDescription{max-width:220px;text-align:center;font-size:10px;line-height:1.4;color:rgba(237,246,255,.56)}
.glyphPreview{width:158px;aspect-ratio:142/92;border-radius:20px;overflow:hidden;background:#000;border:1px solid rgba(52,215,255,.20);box-shadow:0 15px 42px rgba(0,0,0,.42),0 0 28px rgba(52,215,255,.07);isolation:isolate}
.glyphPreview[hidden]{display:none}
.glyphPreview svg.glyph3d{display:block;width:100%!important;height:100%!important;shape-rendering:geometricPrecision;text-rendering:geometricPrecision;image-rendering:auto;filter:none;transform:translateZ(0);backface-visibility:hidden}
h1{text-align:center;margin:0 0 8px;font-size:clamp(28px,6vw,44px)}
.sub{text-align:center;color:var(--muted);line-height:1.5;margin:0 0 22px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.sections{display:grid;gap:12px}
.verifySection{padding:16px;border-radius:20px;border:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.18)}
.verifySection h2{margin:0 0 12px;font-size:14px;letter-spacing:.02em;color:rgba(237,246,255,.86)}
.item{padding:13px;border-radius:15px;border:1px solid rgba(255,255,255,.07);background:rgba(0,0,0,.20);min-width:0}
.item span{display:block;color:var(--muted);font-size:11px;margin-bottom:5px}
.item b{display:block;overflow-wrap:anywhere;font-size:13px}
.item.note{color:var(--muted);font-size:12px;line-height:1.45}
.full{grid-column:1/-1}
.visualTag{display:inline-flex!important;width:max-content;max-width:100%;padding:4px 8px;border-radius:999px;border:1px solid rgba(255,255,255,.10)}
.ok{color:var(--green)}.info{color:var(--blue)}.badText{color:var(--red)}.warn{color:var(--amber)}
.footer{text-align:center;color:rgba(237,246,255,.42);font-size:12px;margin-top:15px}
.cta{margin:0 0 16px;padding:20px;border-radius:24px;border:1px solid rgba(52,215,255,.24);background:linear-gradient(135deg,rgba(52,215,255,.08),rgba(140,92,255,.08));box-shadow:0 18px 54px rgba(0,0,0,.30)}
.cta h2{margin:0 0 7px;font-size:clamp(21px,4.5vw,29px)}
.cta p{margin:0 0 15px;color:var(--muted);line-height:1.5}
.ctaButton{display:flex;align-items:center;justify-content:center;min-height:52px;border-radius:16px;text-decoration:none;font-weight:900;color:#02110c;background:linear-gradient(135deg,#35f0a3,#54dfff);box-shadow:0 12px 34px rgba(53,240,163,.18)}
.ctaButton:active{transform:translateY(1px)}
@media(max-width:560px){.grid{grid-template-columns:1fr}.full{grid-column:auto}.card{padding:17px;border-radius:23px}.cta{padding:17px;border-radius:21px}.verifySection{padding:13px;border-radius:17px}.proofMarks{gap:14px}.glyphPreview{width:142px;border-radius:18px}.seal{width:98px;height:98px;font-size:48px}}
</style>
</head>
<body>
<main>
<div class="brand">TRACE</div>
<section class="cta" aria-label="Create your TRACE artist profile">
  <h2>Create your artist profile</h2>
  <p>Start rendering TRACE badges for your own work and build a verifiable creator identity.</p>
  <a class="ctaButton" href="/?cta=create-profile">Create profile &amp; render badges</a>
</section>
<section class="card">
<div class="proofMarks">
  <div id="seal" class="seal">…</div>
  <div class="glyphUnit" id="glyphUnit" hidden>
    <div class="glyphLabel">Badge glyph</div>
    <div id="glyphPreview" class="glyphPreview" aria-label="Rendered TRACE badge glyph"></div>
    <div id="glyphDescription" class="glyphDescription"></div>
  </div>
</div>
<h1 id="title">Checking proof</h1>
<p id="sub" class="sub">Loading the public cryptographic record.</p>
<div id="details" class="sections"></div>
</section>
<div class="footer">Public proof registry · Private creator keys are never uploaded</div>
</main>
<script src="/trace-glyph-v1.js"></script>
<script>
${PUBLIC_VERIFY_GLYPH_RUNTIME}
const PROOF_ID=${safeId};
const enc=new TextEncoder();

function esc(value){
  return String(value??"")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;");
}
function canonicalize(value){
  if(Array.isArray(value)) return value.map(canonicalize);
  if(value&&typeof value==="object"){
    const output={};
    for(const key of Object.keys(value).sort()) output[key]=canonicalize(value[key]);
    return output;
  }
  return value;
}
function signaturePayload(proof){
  const p=JSON.parse(JSON.stringify(proof||{}));
  delete p.sig_b64;
  delete p.pub_jwk;
  if(p.sig_scope==="TRACE_CORE_V1"){
    delete p.img_data_url;
    delete p.wm_data_url;
    delete p.img_preview_url;
    delete p.thumb_data_url;
  }
  return p;
}
function originPresentation(origin){
  const o=origin&&typeof origin==="object"?origin:{};
  if(o.reason==="no_image"){
    return {label:"Not scanned",tone:"warn",ai:"—",human:"—",provider:"—"};
  }
  const explicitSemantics=o.score_semantics==="ai_probability";
  const canonical=o.contract_version==="trace-origin-v1"&&explicitSemantics;
  const explicitLegacy=!o.contract_version&&explicitSemantics;
  if(!canonical&&!explicitLegacy){
    if(Object.prototype.hasOwnProperty.call(o,"score_0_1")||Object.prototype.hasOwnProperty.call(o,"visual_class")){
      return {label:"Legacy visual score — interpretation unavailable",tone:"warn",ai:"—",human:"—",provider:"—"};
    }
    return {label:"Visual analysis unavailable",tone:"warn",ai:"—",human:"—",provider:"—"};
  }
  const ai=typeof o.ai_probability==="number"?o.ai_probability:Number(o.score_0_1);
  const human=typeof o.human_probability==="number"?o.human_probability:1-ai;
  if(!Number.isFinite(ai)||!Number.isFinite(human)||ai<0||ai>1||human<0||human>1||Math.abs((ai+human)-1)>.03||o.analysis_available===false||o.ok===false){
    return {label:"Visual analysis unavailable",tone:"warn",ai:"—",human:"—",provider:"—"};
  }
  const label=ai<=.35?"Human-leaning":ai>=.65?"AI-like":"Inconclusive";
  const tone=ai<=.35?"ok":ai>=.65?"badText":"info";
  return {
    label,
    tone,
    ai:(ai*100).toFixed(1)+"%",
    human:(human*100).toFixed(1)+"%",
    provider:String(o.provider||"WinstonAI")
  };
}


function traceImageLengthHint(proof){
  const direct=proof?.img_data_url||proof?.img_preview_url||proof?.thumb_data_url;
  if(direct&&typeof direct.length==="number") return direct;

  const input=proof?.origin?.input||proof?.origin?.diagnostics?.input||null;
  const bytes=Number(input?.bytes);
  const mime=String(input?.mime_type||input?.mimeType||"").trim().toLowerCase();
  if(Number.isFinite(bytes)&&bytes>0&&/^image\\/(?:png|jpeg|webp|gif)$/.test(mime)){
    const prefixLength=("data:"+mime+";base64,").length;
    return {length:prefixLength+(4*Math.ceil(bytes/3))};
  }
  return null;
}
function renderBadgeGlyph(proof){
  const unit=document.getElementById("glyphUnit");
  const host=document.getElementById("glyphPreview");
  const description=document.getElementById("glyphDescription");
  if(!unit||!host){return;}

  const hasSignedSpec=proof?.glyph_spec?.version==="trace-glyph-v1";
  if(hasSignedSpec){
    if(!window.TraceGlyphV1){
      unit.hidden=true;
      if(description)description.textContent="Signed glyph specification present · renderer unavailable";
      return;
    }
    host.innerHTML=window.TraceGlyphV1.renderGlyphFromSpecification(proof.glyph_spec,{mode:"public",width:180,height:180});
    const label=window.TraceGlyphV1.describeGlyphSpecification(proof.glyph_spec);
    if(description)description.textContent=label.family+" · "+label.summary+" · "+label.layer_detail;
  }else if(proof?.glyph_seed){
    const ai=Number(proof?.origin?.ai_probability??proof?.origin?.score_0_1);
    const aiLike=String(proof?.origin?.classification||proof?.origin?.visual_class||"")==="ai_like"||(Number.isFinite(ai)&&ai>=.65);
    host.innerHTML=makeHelixSvg(proof.glyph_seed,aiLike,Number.isFinite(ai)?ai:NaN,traceImageLengthHint(proof),{
      mode:"badge",style:String(proof.glyph_style||"spiro_flow"),meta:{payloadLen:String(proof.payload_text||"").length,hasImg:Boolean(proof.img_hash)}
    });
    if(description)description.textContent="Legacy glyph · Detailed formation metadata unavailable";
  }else{
    unit.hidden=true;
    return;
  }

  const svg=host.querySelector("svg.glyph3d");
  if(!svg){unit.hidden=true;return;}
  svg.removeAttribute("width");svg.removeAttribute("height");svg.setAttribute("focusable","false");unit.hidden=false;

  if(hasSignedSpec){
    window.TraceGlyphV1.startGlyphMotion(svg);
  }else if(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches){
    const originalRAF=window.requestAnimationFrame;let captured=null;
    window.requestAnimationFrame=(callback)=>{captured=callback;return 0;};
    try{startGlyphMotion(svg);}finally{window.requestAnimationFrame=originalRAF;}
    if(captured)captured((window.performance&&performance.now)?performance.now():Date.now());
  }else{
    startGlyphMotion(svg);
  }
}

function b64(value){
  const raw=atob(String(value||""));
  return Uint8Array.from(raw,ch=>ch.charCodeAt(0));
}
function hex(bytes){
  return [...new Uint8Array(bytes)]
    .map(v=>v.toString(16).padStart(2,"0"))
    .join("");
}
function proofIsActive(proof){
  const now=Date.now();
  return Number.isFinite(Number(proof.ts))&&Number.isFinite(Number(proof.window_s))
    ? now>=Number(proof.ts)&&now-Number(proof.ts)<=Number(proof.window_s)*1000
    : false;
}

async function verifyInBrowser(proof){
  if(!window.crypto||!crypto.subtle){
    throw new Error("WebCrypto is unavailable on this device");
  }

  const alg=String(proof.sig_alg||"");
  const bytes=enc.encode(JSON.stringify(canonicalize(signaturePayload(proof))));
  const importJwk=JSON.parse(JSON.stringify(proof.pub_jwk||{}));

  /*
   * Some mobile browsers reject the non-standard JWK alg value "Ed25519".
   * It is not required for importing the public key.
   */
  if(importJwk.alg==="Ed25519") delete importJwk.alg;

  let key,params;

  if(alg==="Ed25519"){
    key=await crypto.subtle.importKey(
      "jwk",
      importJwk,
      {name:"Ed25519"},
      false,
      ["verify"]
    );
    params={name:"Ed25519"};
  }else if(alg==="ECDSA_P256_SHA256"){
    key=await crypto.subtle.importKey(
      "jwk",
      importJwk,
      {name:"ECDSA",namedCurve:"P-256"},
      false,
      ["verify"]
    );
    params={name:"ECDSA",hash:"SHA-256"};
  }else{
    throw new Error("Unsupported signature algorithm");
  }

  const sigOk=await crypto.subtle.verify(
    params,
    key,
    b64(proof.sig_b64),
    bytes
  );

  const creatorHash=hex(
    await crypto.subtle.digest(
      "SHA-256",
      enc.encode(alg+"|"+JSON.stringify(proof.pub_jwk))
    )
  );
  const claimedCreatorId=String(proof.creator_id||"")
    .trim()
    .replace(/^sha256:/i,"")
    .toLowerCase();
  const creatorOk=creatorHash.toLowerCase()===claimedCreatorId;

  return {
    sigOk,
    creatorOk,
    active:proofIsActive(proof),
    alg,
    browserVerified:Boolean(sigOk&&creatorOk),
    browserError:""
  };
}
function render(data,checks){
  const proof=data.proof;
  const serverValid=data.server_signature_valid===true;
  const active=checks.active;
  const seal=document.getElementById("seal");
  seal.textContent=serverValid?"✓":"!";
  seal.className="seal "+(serverValid?"good":"bad");
  document.getElementById("title").textContent=serverValid
    ?"TRACE proof verified"
    :"Invalid TRACE proof";

  if(serverValid){
    document.getElementById("sub").textContent=active
      ?"This artwork has a valid, creator-linked TRACE proof record."
      :"Verification period expired. The historical proof record is preserved.";
  }else{
    document.getElementById("sub").textContent=
      "The cryptographic proof did not validate.";
  }

  const originInfo=originPresentation(proof.origin);
  renderBadgeGlyph(proof);
  const created=Number.isFinite(Number(proof.ts))
    ?new Date(Number(proof.ts)).toLocaleString()
    :"Unknown";
  const registered=data.registered_at
    ?new Date(data.registered_at).toLocaleString()
    :"Unknown";
  const browserCheck=checks.browserVerified
    ?"Valid"
    :(checks.browserError?"Unavailable":"Not run");
  const profileMindprint=proof.mindprint_profile?.textHash?"Linked":"Not recorded";
  const badgeMindprint=proof.mindprint_badge?.textHash?"Linked":"Not recorded";
  const artworkTitle=String(proof.payload_text||proof.title||"Artwork linked by file hash").trim()||"Artwork linked by file hash";
  const integrity=serverValid
    ?(proof.img_hash?"Signature valid · file hash recorded":"Signature valid · proof package intact")
    :(proof.img_hash?"File hash recorded":"Integrity unavailable");
  const badgeId=proof.badge_key||proof.badge_id||PROOF_ID;
  const glyphInfo=proof?.glyph_spec?.version==="trace-glyph-v1"&&window.TraceGlyphV1
    ?window.TraceGlyphV1.describeGlyphSpecification(proof.glyph_spec)
    :{legacy:true,family:"Legacy glyph",summary:"Detailed formation metadata unavailable",layer_detail:"—"};

  document.getElementById("details").innerHTML=\`
    <section class="verifySection">
      <h2>1. TRACE verification status</h2>
      <div class="grid">
        <div class="item"><span>Proof status</span><b class="\${serverValid?"ok":"badText"}">\${serverValid?"Verified by TRACE server":"Invalid"}</b></div>
        <div class="item"><span>Verification period</span><b class="\${active?"ok":"warn"}">\${active?"Active":"Expired · proof record preserved"}</b></div>
      </div>
    </section>
    <section class="verifySection">
      <h2>2. Artwork</h2>
      <div class="grid">
        <div class="item full"><span>Artwork record</span><b>\${esc(artworkTitle)}</b></div>
        <div class="item full"><span>Image hash</span><b>\${esc(proof.img_hash||"No image hash recorded")}</b></div>
      </div>
    </section>
    <section class="verifySection">
      <h2>3. Creator</h2>
      <div class="grid">
        <div class="item full"><span>Creator linkage</span><b>\${proof.creator_id?"Creator-linked proof":"Creator link unavailable"}</b></div>
        <div class="item full"><span>Creator ID</span><b>\${esc(proof.creator_id||"—")}</b></div>
      </div>
    </section>
    <section class="verifySection">
      <h2>4. Proof details</h2>
      <div class="grid">
        <div class="item full"><span>Badge ID</span><b>\${esc(badgeId)}</b></div>
        <div class="item"><span>Created</span><b>\${esc(created)}</b></div>
        <div class="item"><span>Registered</span><b>\${esc(registered)}</b></div>
      </div>
    </section>
    <section class="verifySection">
      <h2>5. Integrity</h2>
      <div class="grid">
        <div class="item"><span>TRACE server signature</span><b class="\${serverValid?"ok":"badText"}">\${serverValid?"Valid":"Invalid"}</b></div>
        <div class="item"><span>Device crypto check</span><b class="\${checks.browserVerified?"ok":"warn"}">\${browserCheck}</b></div>
        <div class="item full"><span>Proof package</span><b>\${esc(integrity)}</b></div>
      </div>
    </section>
    <section class="verifySection">
      <h2>6. Mindprint</h2>
      <div class="grid">
        <div class="item"><span>Profile Mindprint</span><b>\${profileMindprint}</b></div>
        <div class="item"><span>Badge Mindprint</span><b>\${badgeMindprint}</b></div>
      </div>
    </section>
    <section class="verifySection">
      <h2>7. Visual Origin Analysis</h2>
      <div class="grid">
        <div class="item full"><span>Probabilistic visual signal</span><b class="visualTag \${originInfo.tone}">\${esc(originInfo.label)}</b></div>
        <div class="item"><span>Human-likeness</span><b>\${originInfo.human}</b></div>
        <div class="item"><span>AI-likeness</span><b>\${originInfo.ai}</b></div>
        <div class="item full"><span>Provider</span><b>\${esc(originInfo.provider)}</b></div>
        <div class="item note full">Visual Origin Analysis is an external probabilistic signal. Creator Proof remains the separate cryptographic identity, signature, image-hash and registry layer.</div>
      </div>
    </section>
    <section class="verifySection">
      <h2>8. Proof glyph</h2>
      <div class="grid">
        <div class="item"><span>Glyph family</span><b>\${esc(glyphInfo.family)}</b></div>
        <div class="item"><span>Specification</span><b>\${proof?.glyph_spec?.version==="trace-glyph-v1"?"Signed TRACE-GLYPH-V1":"Legacy"}</b></div>
        <div class="item full"><span>Formation</span><b>\${esc(glyphInfo.summary)}</b></div>
        <div class="item full"><span>Rendering stack</span><b>\${esc(glyphInfo.layer_detail)}</b></div>
      </div>
    </section>
  \`;
}
async function start(){
  try{
    const response=await fetch(
      "/proofs/"+encodeURIComponent(PROOF_ID),
      {headers:{accept:"application/json"}}
    );
    const data=await response.json();

    if(!response.ok||!data.ok){
      throw new Error(data.error||"Proof not found");
    }

    /*
     * GET /proofs/:id returns a proof only after the Node server has verified
     * its signature and creator identity. Browser verification is an optional
     * second check, not a requirement for displaying a valid proof.
     */
    let checks={
      sigOk:data.server_signature_valid===true,
      creatorOk:data.server_signature_valid===true,
      active:proofIsActive(data.proof),
      alg:String(data.proof?.sig_alg||""),
      browserVerified:false,
      browserError:""
    };

    try{
      const localChecks=await verifyInBrowser(data.proof);
      checks={...checks,...localChecks};
    }catch(error){
      checks.browserVerified=false;
      checks.browserError=error?.message||String(error);
    }

    render(data,checks);
  }catch(error){
    const seal=document.getElementById("seal");
    seal.textContent="!";
    seal.className="seal bad";
    document.getElementById("title").textContent="Proof unavailable";
    document.getElementById("sub").textContent=error.message||String(error);
  }
}
start();
</script>
</body>
</html>`;
}

/* --------------------------------------------------------------------------
 * TRACE v33 social creator network
 * Social metadata is deliberately separate from the signed TRACE proof.
 * Every mutating endpoint authenticates a real Supabase user. Cosmetic/social
 * failures never change proof publication or verification behavior.
 * -------------------------------------------------------------------------- */

const SOCIAL_BUILD = "trace-v50.2-public-verify-glyph";
const SOCIAL_AUTH_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_AUTH_KEY);
const SOCIAL_ADMIN_CONFIGURED = Boolean(
  SUPABASE_URL &&
  SUPABASE_SECRET_KEY &&
  supabaseAdmin &&
  ["secret", "service_role"].includes(SUPABASE_KEY_KIND)
);
const SOCIAL_GLYPH_STYLES = new Set([
  "spiro_flow",
  "hash_shards",
  "helix_clean",
  "orbit_ring",
  "dna_braid",
  "minimal_pulse",
]);

const socialAuthClient = SOCIAL_AUTH_CONFIGURED
  ? createClient(SUPABASE_URL, SUPABASE_AUTH_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      db: { schema: "public" },
      global: { fetch: resilientSupabaseFetch, headers: { "X-Client-Info": "trace-social-auth/1.0" } },
    })
  : null;

function supabaseAuthErrorMessage(payload, fallback = "Supabase authentication failed") {
  return payload?.msg || payload?.message || payload?.error_description || payload?.error || fallback;
}

async function supabaseAuthRest(pathname, {
  method = "POST",
  body = null,
  accessToken = "",
  apiKey = SUPABASE_AUTH_KEY,
} = {}) {
  if (!SUPABASE_URL || !apiKey) {
    const error = new Error("Supabase authentication is not configured");
    error.httpStatus = 503;
    error.code = "SUPABASE_CONFIG_INVALID";
    throw error;
  }

  const response = await resilientSupabaseFetch(`${SUPABASE_URL}/auth/v1${pathname}`, {
    method,
    headers: {
      apikey: apiKey,
      authorization: `Bearer ${accessToken || apiKey}`,
      accept: "application/json",
      ...(body === null ? {} : { "content-type": "application/json" }),
      "x-client-info": "trace-auth-rest/1.0",
    },
    body: body === null ? undefined : JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(supabaseAuthErrorMessage(payload, `Supabase request failed (${response.status})`));
    error.httpStatus = response.status || 502;
    error.status = response.status || 0;
    error.code = payload?.code || payload?.error_code || "SUPABASE_AUTH_ERROR";
    error.data = payload;
    throw error;
  }
  return payload || {};
}

function normalizeSupabaseSession(payload) {
  const session = payload?.session || payload;
  if (!session?.access_token || !session?.refresh_token) return null;
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    token_type: session.token_type || "bearer",
    user: session.user || payload?.user || null,
  };
}

async function supabasePasswordLogin(email, password) {
  const payload = await supabaseAuthRest("/token?grant_type=password", {
    body: { email, password },
  });
  const session = normalizeSupabaseSession(payload);
  const user = payload?.user || session?.user || null;
  if (!session || !user) {
    const error = new Error("Supabase did not return a valid login session");
    error.httpStatus = 502;
    error.code = "SUPABASE_SESSION_MISSING";
    throw error;
  }
  return { session, user };
}

async function supabasePublicSignup(email, password, metadata) {
  const payload = await supabaseAuthRest("/signup", {
    body: { email, password, data: metadata },
  });
  return {
    user: payload?.user || null,
    session: normalizeSupabaseSession(payload),
    raw: payload,
  };
}

async function supabaseAdminCreateUser(email, password, metadata) {
  if (!SOCIAL_ADMIN_CONFIGURED) {
    const error = new Error("Supabase admin authentication is not configured");
    error.httpStatus = 503;
    throw error;
  }
  const payload = await supabaseAuthRest("/admin/users", {
    body: {
      email,
      password,
      email_confirm: true,
      user_metadata: metadata,
    },
    apiKey: SUPABASE_SECRET_KEY,
    accessToken: SUPABASE_SECRET_KEY,
  });
  return payload?.user || payload;
}

async function supabaseRefreshToken(refreshToken) {
  const payload = await supabaseAuthRest("/token?grant_type=refresh_token", {
    body: { refresh_token: refreshToken },
  });
  const session = normalizeSupabaseSession(payload);
  if (!session) {
    const error = new Error("Session could not be refreshed");
    error.httpStatus = 401;
    throw error;
  }
  return session;
}

async function supabaseUserFromAccessToken(accessToken) {
  const payload = await supabaseAuthRest("/user", {
    method: "GET",
    body: null,
    accessToken,
  });
  return payload?.user || payload || null;
}

function socialUnavailable(res, feature = "Social creator network") {
  const missing = [];
  if (!SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!SUPABASE_AUTH_KEY) missing.push("SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY");
  return res.status(503).json({
    ok: false,
    error: missing.length ? `${feature} needs ${missing.join(" and ")}` : `${feature} could not connect to Supabase`,
    requires: missing,
    diagnostics: {
      supabase_url_source: SUPABASE_URL_SOURCE,
      auth_key_source: SUPABASE_AUTH_KEY_SOURCE,
      server_key_source: SUPABASE_KEY_SOURCE,
      server_key_kind: SUPABASE_KEY_KIND,
    },
  });
}

function cleanText(value, max = 500) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

function normalizeHandle(value) {
  return cleanText(value, 32)
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_.-]/g, "");
}

function validHandle(value) {
  return /^[a-z0-9][a-z0-9_.-]{2,31}$/.test(String(value || ""));
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

function validProofId(value) {
  return /^[a-f0-9]{64}$/.test(String(value || "").replace(/^sha256:/i, "").toLowerCase());
}

function normalizeProofIdSocial(value) {
  const id = String(value || "").replace(/^sha256:/i, "").trim().toLowerCase();
  return validProofId(id) ? id : "";
}

function cleanUrl(value, max = 1000) {
  const raw = cleanText(value, max);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : "";
  } catch {
    return "";
  }
}

function cleanStringArray(value, maxItems = 12, maxLength = 40) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanText(item, maxLength).toLowerCase()).filter(Boolean))].slice(
    0,
    maxItems
  );
}

function publicProfileColumns() {
  return "id,handle,display_name,bio,location,website,avatar_url,creator_fields,social_links,glyph_style,profile_mindprint_active,creator_id,public_profile,show_follower_count,show_activity_stats,created_at,updated_at";
}

function publicWorkColumns() {
  return "id,owner_id,proof_id,title,caption,artwork_url,thumbnail_url,alt_text,medium,tags,glyph_style,featured,is_public,hidden_from_profile,created_at,updated_at";
}

function bearerToken(req) {
  const raw = String(req.headers.authorization || "");
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function socialAuthContext(req, { required = true } = {}) {
  if (!SOCIAL_AUTH_CONFIGURED) {
    const error = new Error("Social authentication is not configured");
    error.httpStatus = 503;
    throw error;
  }

  const token = bearerToken(req);
  if (!token) {
    if (!required) return { user: null, token: "" };
    const error = new Error("Authentication required");
    error.httpStatus = 401;
    throw error;
  }

  try {
    const user = await supabaseUserFromAccessToken(token);
    if (!user?.id) throw new Error("User missing from session");
    return { user, token };
  } catch (error) {
    if (isSupabaseNetworkFailure(error)) throw error;
    const authError = new Error("Invalid or expired session");
    authError.httpStatus = 401;
    throw authError;
  }
}

async function optionalSocialUser(req) {
  try {
    return (await socialAuthContext(req, { required: false })).user;
  } catch {
    return null;
  }
}

function makeMemoryLimiter({ windowMs, max, keyPrefix }) {
  const buckets = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = `${keyPrefix}:${clientIp(req)}`;
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return res.status(429).json({ ok: false, error: "Too many requests. Try again shortly." });
    }
    return next();
  };
}

const socialAuthLimit = makeMemoryLimiter({ windowMs: 15 * 60 * 1000, max: 30, keyPrefix: "auth" });
const socialWriteLimit = makeMemoryLimiter({ windowMs: 60 * 1000, max: 80, keyPrefix: "social" });
const socialCommentLimit = makeMemoryLimiter({ windowMs: 10 * 60 * 1000, max: 20, keyPrefix: "comment" });

function isSupabaseNetworkFailure(error) {
  const message = String(error?.message || error?.cause?.message || "").toLowerCase();
  const code = String(error?.code || error?.cause?.code || "").toUpperCase();
  return code.includes("SUPABASE_NETWORK") ||
    ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENETUNREACH"].some((item) => code.includes(item)) ||
    /fetch failed|network connection failed|network request failed|timed out|socket|dns/.test(message);
}

function sendSocialError(res, error) {
  const networkFailure = isSupabaseNetworkFailure(error);
  const configFailure = error?.code === "SUPABASE_CONFIG_INVALID" || !SUPABASE_URL || !SUPABASE_AUTH_KEY;
  const status = configFailure || networkFailure ? 503 : (Number(error?.httpStatus) || 500);
  const code = configFailure ? "SUPABASE_CONFIG_INVALID" : networkFailure ? "SUPABASE_UNREACHABLE" : (error?.code || "SOCIAL_ACTION_FAILED");
  const safeMessage = configFailure
    ? "TRACE account service is not configured with a valid Supabase project URL and auth key."
    : networkFailure
      ? "TRACE account service could not reach Supabase after retrying."
      : status >= 500
        ? "The account service could not complete this action."
        : error?.message || "Request failed";
  if (status >= 500) console.error("TRACE social error:", {
    code,
    message: error?.message,
    cause: error?.cause?.message,
    resolvedHost: (() => { try { return new URL(SUPABASE_URL).hostname; } catch { return ""; } })(),
    urlSource: SUPABASE_URL_SOURCE,
  });
  const payload = { ok: false, error: safeMessage, code };
  if (status >= 500) payload.diagnostics = socialErrorDiagnostics(error);
  return res.status(status).json(payload);
}

function socialErrorDiagnostics(error = null) {
  return {
    build: SOCIAL_BUILD,
    supabase_url_source: SUPABASE_URL_SOURCE,
    supabase_resolved_host: (() => { try { return new URL(SUPABASE_URL).hostname; } catch { return ""; } })(),
    supabase_project_ref: SUPABASE_URL_RESOLUTION.ref || "",
    supabase_url_corrected: Boolean(SUPABASE_URL_RESOLUTION.corrected),
    auth_key_source: SUPABASE_AUTH_KEY_SOURCE,
    auth_key_kind: classifySupabaseKey(SUPABASE_AUTH_KEY),
    server_key_source: SUPABASE_KEY_SOURCE,
    server_key_kind: SUPABASE_KEY_KIND,
    error_code: error?.code || "",
    error_message: error?.message || "",
    error_cause: error?.cause?.message || error?.firstError?.message || "",
  };
}

async function supabaseConnectivityProbe() {
  const out = {
    ok: false,
    configured: Boolean(SUPABASE_URL && SUPABASE_AUTH_KEY),
    diagnostics: socialErrorDiagnostics(),
    dns4: [],
    dns_error: "",
    auth_settings_status: 0,
    auth_settings_ok: false,
    auth_settings_error: "",
  };
  if (!SUPABASE_URL || !SUPABASE_AUTH_KEY) {
    out.auth_settings_error = "Missing Supabase URL or auth key";
    return out;
  }
  let host = "";
  try { host = new URL(SUPABASE_URL).hostname; } catch {}
  if (host) {
    try { out.dns4 = await dns.promises.resolve4(host); }
    catch (error) { out.dns_error = `${error?.code || "DNS_ERROR"}: ${error?.message || error}`; }
  }
  try {
    const response = await resilientSupabaseFetch(`${SUPABASE_URL}/auth/v1/settings`, {
      method: "GET",
      headers: {
        apikey: SUPABASE_AUTH_KEY,
        authorization: `Bearer ${SUPABASE_AUTH_KEY}`,
        accept: "application/json",
        "x-client-info": "trace-auth-probe/1.0",
      },
    });
    out.auth_settings_status = response.status || 0;
    out.auth_settings_ok = response.ok;
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      out.auth_settings_error = text.slice(0, 220);
    }
    out.ok = response.ok || (response.status >= 400 && response.status < 500);
  } catch (error) {
    out.auth_settings_error = `${error?.code || "NETWORK_ERROR"}: ${error?.message || error}`;
    out.diagnostics = socialErrorDiagnostics(error);
  }
  return out;
}

function socialUserClient(accessToken) {
  if (!SUPABASE_URL || !SUPABASE_AUTH_KEY || !accessToken) return null;
  return createClient(SUPABASE_URL, SUPABASE_AUTH_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    db: { schema: "public" },
    global: {
      fetch: resilientSupabaseFetch,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Client-Info": "trace-social-user/1.0",
      },
    },
  });
}

async function getProfileById(id, client = supabaseAdmin) {
  if (!client) {
    const error = new Error("Creator profile database is not configured");
    error.httpStatus = 503;
    throw error;
  }
  const { data, error } = await client
    .from("profiles")
    .select(publicProfileColumns())
    .eq("id", id)
    .maybeSingle();
  if (error) throw proofRegistryError("Profile read failed", error);
  return data || null;
}

async function getProfileByHandle(handle, { includePrivateForUser = "" } = {}) {
  let query = supabaseAdmin
    .from("profiles")
    .select(publicProfileColumns())
    .ilike("handle", normalizeHandle(handle))
    .limit(1);
  const { data, error } = await query.maybeSingle();
  if (error) throw proofRegistryError("Profile read failed", error);
  if (!data) return null;
  if (!data.public_profile && data.id !== includePrivateForUser) return null;
  return data;
}

async function countRows(table, column, value, extra = null) {
  let query = supabaseAdmin.from(table).select("*", { count: "exact", head: true }).eq(column, value);
  if (typeof extra === "function") query = extra(query);
  const { count, error } = await query;
  if (error) throw proofRegistryError(`${table} count failed`, error);
  return Number(count || 0);
}

async function profileStats(profile) {
  const [followers, following, works, views] = await Promise.all([
    countRows("follows", "following_id", profile.id),
    countRows("follows", "follower_id", profile.id),
    countRows("works", "owner_id", profile.id, (query) => query.eq("is_public", true).eq("hidden_from_profile", false)),
    (async () => {
      const { data: ownedWorks, error } = await supabaseAdmin.from("works").select("id").eq("owner_id", profile.id);
      if (error) throw proofRegistryError("Work view lookup failed", error);
      const ids = (ownedWorks || []).map((row) => row.id);
      if (!ids.length) return 0;
      const { count, error: viewError } = await supabaseAdmin
        .from("proof_views")
        .select("*", { count: "exact", head: true })
        .in("work_id", ids);
      if (viewError) return 0;
      return Number(count || 0);
    })(),
  ]);

  return {
    proofs: works,
    followers: profile.show_follower_count ? followers : null,
    following,
    proof_views: profile.show_activity_stats ? views : null,
    verification_opens: null,
  };
}

async function blockedProfileIds(viewerId) {
  if (!viewerId) return new Set();
  const { data, error } = await supabaseAdmin
    .from("blocks")
    .select("blocker_id,blocked_id")
    .or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`);
  if (error) return new Set();
  const ids = new Set();
  for (const row of data || []) {
    ids.add(row.blocker_id === viewerId ? row.blocked_id : row.blocker_id);
  }
  return ids;
}

async function enrichProfiles(profiles, viewerId = "") {
  const blocked = await blockedProfileIds(viewerId);
  const filtered = (profiles || []).filter((profile) => !blocked.has(profile.id));
  return Promise.all(
    filtered.map(async (profile) => {
      const stats = await profileStats(profile);
      let is_following = false;
      if (viewerId && viewerId !== profile.id) {
        const { data } = await supabaseAdmin
          .from("follows")
          .select("following_id")
          .eq("follower_id", viewerId)
          .eq("following_id", profile.id)
          .maybeSingle();
        is_following = Boolean(data);
      }
      return { ...profile, stats, is_following, is_owner: viewerId === profile.id };
    })
  );
}

async function workCounts(workId) {
  const [appreciations, saves, comments] = await Promise.all([
    countRows("appreciations", "work_id", workId),
    countRows("saved_works", "work_id", workId),
    countRows("comments", "work_id", workId, (query) => query.eq("hidden", false)),
  ]);
  return { appreciations, saves, comments };
}

async function enrichWorks(works, viewerId = "") {
  const rows = works || [];
  const ownerIds = [...new Set(rows.map((row) => row.owner_id).filter(Boolean))];
  let profiles = [];
  if (ownerIds.length) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select(publicProfileColumns())
      .in("id", ownerIds);
    if (error) throw proofRegistryError("Work creator lookup failed", error);
    profiles = data || [];
  }
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const proofIds = [...new Set(rows.map((row) => normalizeProofId(row.proof_id)).filter(Boolean))];
  const proofMap = new Map();
  for (let offset = 0; offset < proofIds.length; offset += 100) {
    const batch = proofIds.slice(offset, offset + 100);
    const { data: proofRows, error: proofError } = await supabaseAdmin
      .from("trace_proofs")
      .select("id, proof")
      .in("id", batch);
    if (proofError) throw proofRegistryError("Work proof lookup failed", proofError);
    for (const row of proofRows || []) proofMap.set(row.id, row.proof || null);
  }
  const blocked = await blockedProfileIds(viewerId);

  const output = [];
  for (const work of rows) {
    if (blocked.has(work.owner_id)) continue;
    const counts = await workCounts(work.id);
    let appreciated = false;
    let saved = false;
    if (viewerId) {
      const [{ data: appreciation }, { data: save }] = await Promise.all([
        supabaseAdmin
          .from("appreciations")
          .select("work_id")
          .eq("user_id", viewerId)
          .eq("work_id", work.id)
          .maybeSingle(),
        supabaseAdmin
          .from("saved_works")
          .select("work_id")
          .eq("user_id", viewerId)
          .eq("work_id", work.id)
          .maybeSingle(),
      ]);
      appreciated = Boolean(appreciation);
      saved = Boolean(save);
    }
    const signedProof = proofMap.get(normalizeProofId(work.proof_id)) || null;
    output.push({
      ...work,
      glyph_spec: signedProof?.glyph_spec || null,
      glyph_seed: signedProof?.glyph_seed || null,
      creator: profileMap.get(work.owner_id) || null,
      stats: counts,
      viewer: { appreciated, saved, is_owner: viewerId === work.owner_id },
    });
  }
  return output;
}

async function createNotification({ recipientId, actorId = null, type, workId = null, commentId = null, payload = {} }) {
  if (!recipientId || recipientId === actorId) return;
  try {
    await supabaseAdmin.from("notifications").insert({
      recipient_id: recipientId,
      actor_id: actorId,
      type,
      work_id: workId,
      comment_id: commentId,
      payload,
    });
  } catch (error) {
    console.warn("TRACE notification insert failed", error?.message || error);
  }
}

async function assertNotBlocked(userId, otherId) {
  if (!userId || !otherId) return;
  const { data, error } = await supabaseAdmin
    .from("blocks")
    .select("blocker_id")
    .or(
      `and(blocker_id.eq.${userId},blocked_id.eq.${otherId}),and(blocker_id.eq.${otherId},blocked_id.eq.${userId})`
    )
    .limit(1);
  if (error) throw proofRegistryError("Block check failed", error);
  if (data?.length) {
    const blocked = new Error("This interaction is unavailable");
    blocked.httpStatus = 403;
    throw blocked;
  }
}

app.get("/api/config", (req, res) => {
  res.json({
    ok: true,
    build: SOCIAL_BUILD,
    social_enabled: SOCIAL_AUTH_CONFIGURED,
    auth_enabled: SOCIAL_AUTH_CONFIGURED,
    account_creation_enabled: SOCIAL_AUTH_CONFIGURED,
    account_creation_mode: SOCIAL_ADMIN_CONFIGURED ? "server_admin" : (SOCIAL_AUTH_CONFIGURED ? "supabase_signup_trigger" : "disabled"),
    public_registry_enabled: PROOF_REGISTRY_CONFIGURED,
    browser_auth_fallback_enabled: false,
    diagnostics: {
      supabase_url_source: SUPABASE_URL_SOURCE,
      supabase_resolved_host: (() => { try { return new URL(SUPABASE_URL).hostname; } catch { return ""; } })(),
      supabase_project_ref: SUPABASE_URL_RESOLUTION.ref || "",
      supabase_url_corrected: Boolean(SUPABASE_URL_RESOLUTION.corrected),
      auth_key_source: SUPABASE_AUTH_KEY_SOURCE,
      auth_key_kind: classifySupabaseKey(SUPABASE_AUTH_KEY),
      server_key_source: SUPABASE_KEY_SOURCE,
      server_key_kind: SUPABASE_KEY_KIND,
    },
  });
});

app.get("/api/auth/diagnose", async (req, res) => {
  const probe = await supabaseConnectivityProbe();
  return res.status(probe.ok ? 200 : 503).json(probe);
});

const handleSocialSignup = async (req, res) => {
  try {
    if (!SOCIAL_AUTH_CONFIGURED) return socialUnavailable(res, "Account creation");
    const email = cleanText(req.body?.email, 254).toLowerCase();
    const password = String(req.body?.password || "");
    const handle = normalizeHandle(req.body?.handle);
    const displayName = cleanText(req.body?.display_name || handle, 80);

    if (!validEmail(email)) return res.status(400).json({ ok: false, error: "Enter a valid email address" });
    if (!validHandle(handle)) return res.status(400).json({ ok: false, error: "Handle must be 3–32 characters using letters, numbers, dots, underscores or hyphens" });
    if (password.length < 8 || password.length > 128) return res.status(400).json({ ok: false, error: "Password must be 8–128 characters" });

    const profileReader = supabaseAdmin || socialAuthClient;
    if (profileReader) {
      try {
        const { data: existing, error: lookupError } = await profileReader.from("profiles").select("id").ilike("handle", handle).maybeSingle();
        if (lookupError) throw lookupError;
        if (existing) return res.status(409).json({ ok: false, error: "That creator handle is already taken" });
      } catch (lookupError) {
        if (!isSupabaseNetworkFailure(lookupError)) throw lookupError;
        console.warn("TRACE handle preflight skipped due to Supabase network lookup failure; signup will continue to auth step", lookupError?.message || lookupError);
      }
    }

    if (SOCIAL_ADMIN_CONFIGURED) {
      let createdUser;
      try {
        createdUser = await supabaseAdminCreateUser(email, password, { handle, display_name: displayName });
      } catch (createError) {
        const rawCreate = String(createError?.message || "").toLowerCase();
        const createMessage = rawCreate.includes("already") || rawCreate.includes("registered") || createError?.status === 422
          ? "An account already exists for this email. Use Log in."
          : (createError?.message || "Account could not be created");
        const error = new Error(createMessage);
        error.httpStatus = createError?.status || createError?.httpStatus || 400;
        error.code = createError?.code || "ACCOUNT_CREATE_FAILED";
        throw error;
      }

      const userId = createdUser?.id;
      if (!userId) {
        const error = new Error("Supabase created no user ID");
        error.httpStatus = 502;
        throw error;
      }
      const { error: profileError } = await supabaseAdmin.from("profiles").upsert({
        id: userId,
        handle,
        display_name: displayName,
      }, { onConflict: "id" });
      if (profileError) {
        try {
          await supabaseAuthRest(`/admin/users/${encodeURIComponent(userId)}`, {
            method: "DELETE",
            apiKey: SUPABASE_SECRET_KEY,
            accessToken: SUPABASE_SECRET_KEY,
          });
        } catch {}
        throw proofRegistryError("Creator profile could not be created", profileError, 400);
      }

      const login = await supabasePasswordLogin(email, password);
      const profile = await getProfileById(userId);
      return res.status(201).json({ ok: true, session: login.session, profile });
    }

    // Fallback for projects that expose only the publishable/anon key to this service.
    // TRACE_v34_supabase_patch.sql installs a security-definer auth.users trigger
    // that creates the matching public.profiles row without exposing server secrets.
    let signedUp;
    try {
      signedUp = await supabasePublicSignup(email, password, { handle, display_name: displayName });
    } catch (signUpError) {
      const rawSignup = String(signUpError?.message || "").toLowerCase();
      const signupMessage = rawSignup.includes("already") || rawSignup.includes("registered") || signUpError?.status === 422
        ? "An account already exists for this email. Use Log in."
        : (signUpError?.message || "Account could not be created");
      const error = new Error(signupMessage);
      error.httpStatus = signUpError?.status || signUpError?.httpStatus || 400;
      error.code = signUpError?.code || "ACCOUNT_CREATE_FAILED";
      throw error;
    }
    if (!signedUp?.user) {
      const error = new Error("Supabase did not return a user after signup");
      error.httpStatus = 502;
      throw error;
    }
    if (!signedUp.session) {
      return res.status(202).json({ ok: true, requires_email_confirmation: true, email });
    }
    const userClient = socialUserClient(signedUp.session.access_token);
    let profile = userClient ? await getProfileById(signedUp.user.id, userClient).catch(() => null) : null;
    if (!profile && supabaseAdmin) {
      const { error: profileInsertError } = await supabaseAdmin.from("profiles").upsert({
        id: signedUp.user.id,
        handle,
        display_name: displayName,
      }, { onConflict: "id" });
      if (!profileInsertError) profile = await getProfileById(signedUp.user.id, supabaseAdmin);
    }
    if (!profile) {
      const error = new Error("Account created, but the creator profile row could not be created. Apply the TRACE profiles trigger or RLS policy.");
      error.httpStatus = 409;
      throw error;
    }
    return res.status(201).json({ ok: true, session: signedUp.session, profile });
  } catch (error) {
    return sendSocialError(res, error);
  }
};
app.post("/api/auth/signup", socialAuthLimit, handleSocialSignup);
app.post("/api/auth/register", socialAuthLimit, handleSocialSignup);

app.post("/api/auth/login", socialAuthLimit, async (req, res) => {
  try {
    if (!SOCIAL_AUTH_CONFIGURED) return socialUnavailable(res, "Login");
    const email = cleanText(req.body?.email, 254).toLowerCase();
    const password = String(req.body?.password || "");
    if (!validEmail(email) || !password) return res.status(400).json({ ok: false, error: "Enter the email and password used for this creator profile" });
    let data;
    try {
      data = await supabasePasswordLogin(email, password);
    } catch (error) {
      const raw = String(error?.message || "").toLowerCase();
      const message = raw.includes("email not confirmed")
        ? "Confirm the Supabase email before logging in"
        : raw.includes("invalid login credentials") || raw.includes("invalid credentials")
          ? "Incorrect email or password"
          : (error?.message || "Login failed");
      const authError = new Error(message);
      authError.httpStatus = raw.includes("email not confirmed") ? 403 : (error?.status || error?.httpStatus || 401);
      authError.code = error?.code || "LOGIN_FAILED";
      throw authError;
    }
    // Read the profile through the authenticated user's session first. This
    // avoids turning a valid password login into an apparent failure when the
    // server admin client is absent or temporarily misconfigured.
    let profile = null;
    const userClient = socialUserClient(data.session.access_token);
    if (userClient) {
      try {
        profile = await getProfileById(data.user.id, userClient);
      } catch (profileReadError) {
        console.warn("TRACE user-scoped profile read failed; trying admin fallback", profileReadError?.message || profileReadError);
      }
    }
    if (!profile && supabaseAdmin) {
      try {
        profile = await getProfileById(data.user.id, supabaseAdmin);
      } catch (profileReadError) {
        console.warn("TRACE admin profile read failed during login", profileReadError?.message || profileReadError);
      }
    }
    if (!profile && supabaseAdmin) {
      const requested = normalizeHandle(data.user.user_metadata?.handle || email.split("@")[0]);
      const fallbackHandle = validHandle(requested) ? requested : `creator_${data.user.id.replace(/-/g, "").slice(0, 6)}`;
      const displayName = cleanText(data.user.user_metadata?.display_name || fallbackHandle, 80);
      const { error: repairError } = await supabaseAdmin.from("profiles").upsert({
        id: data.user.id,
        handle: fallbackHandle,
        display_name: displayName,
      }, { onConflict: "id" });
      if (!repairError) profile = await getProfileById(data.user.id, supabaseAdmin);
    }
    if (!profile) {
      const missing = new Error("Login worked, but the creator profile is missing. Run the v34 Supabase profile patch once.");
      missing.httpStatus = 409;
      throw missing;
    }
    return res.json({ ok: true, session: data.session, profile });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

app.post("/api/auth/refresh", socialAuthLimit, async (req, res) => {
  try {
    if (!SOCIAL_AUTH_CONFIGURED) return socialUnavailable(res, "Session refresh");
    const refreshToken = String(req.body?.refresh_token || "");
    if (!refreshToken) return res.status(400).json({ ok: false, error: "Refresh token required" });
    const session = await supabaseRefreshToken(refreshToken);
    return res.json({ ok: true, session });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

app.get("/api/auth/me", async (req, res) => {
  try {
    const { user, token } = await socialAuthContext(req);
    let profile = null;
    const userClient = socialUserClient(token);
    if (userClient) {
      try { profile = await getProfileById(user.id, userClient); } catch (_) {}
    }
    if (!profile && supabaseAdmin) profile = await getProfileById(user.id, supabaseAdmin);
    const stats = profile && supabaseAdmin ? await profileStats(profile) : null;
    return res.json({ ok: true, user: { id: user.id, email: user.email }, profile: profile ? { ...profile, stats } : null });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

app.patch("/api/profile", socialWriteLimit, async (req, res) => {
  try {
    const { user } = await socialAuthContext(req);
    const patch = {};
    if (Object.hasOwn(req.body || {}, "display_name")) patch.display_name = cleanText(req.body.display_name, 80);
    if (Object.hasOwn(req.body || {}, "bio")) patch.bio = cleanText(req.body.bio, 500);
    if (Object.hasOwn(req.body || {}, "location")) patch.location = cleanText(req.body.location, 100);
    if (Object.hasOwn(req.body || {}, "website")) patch.website = cleanUrl(req.body.website, 500);
    if (Object.hasOwn(req.body || {}, "avatar_url")) patch.avatar_url = cleanUrl(req.body.avatar_url, 1000) || null;
    if (Object.hasOwn(req.body || {}, "creator_fields")) patch.creator_fields = cleanStringArray(req.body.creator_fields, 8, 40);
    if (Object.hasOwn(req.body || {}, "social_links")) {
      const input = req.body.social_links && typeof req.body.social_links === "object" ? req.body.social_links : {};
      const links = {};
      for (const [key, value] of Object.entries(input).slice(0, 8)) {
        const safeKey = cleanText(key, 30).toLowerCase().replace(/[^a-z0-9_-]/g, "");
        const safeUrl = cleanUrl(value, 500);
        if (safeKey && safeUrl) links[safeKey] = safeUrl;
      }
      patch.social_links = links;
    }
    if (Object.hasOwn(req.body || {}, "glyph_style")) {
      const style = cleanText(req.body.glyph_style, 30);
      if (!SOCIAL_GLYPH_STYLES.has(style)) return res.status(400).json({ ok: false, error: "Unknown glyph style" });
      patch.glyph_style = style;
    }
    for (const field of ["public_profile", "show_follower_count", "show_activity_stats", "profile_mindprint_active"]) {
      if (Object.hasOwn(req.body || {}, field)) patch[field] = Boolean(req.body[field]);
    }
    if (!Object.keys(patch).length) return res.status(400).json({ ok: false, error: "No profile fields supplied" });

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .update(patch)
      .eq("id", user.id)
      .select(publicProfileColumns())
      .single();
    if (error) throw proofRegistryError("Profile update failed", error, 400);
    return res.json({ ok: true, profile: data });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

app.post("/api/profile/link-creator", socialWriteLimit, async (req, res) => {
  try {
    const { user } = await socialAuthContext(req);
    const creatorId = cleanText(req.body?.creator_id, 200);
    if (!creatorId) return res.status(400).json({ ok: false, error: "Creator ID required" });
    const profile = await getProfileById(user.id);
    if (!profile) return res.status(404).json({ ok: false, error: "Creator profile not found" });
    const previousCreatorId = cleanText(profile.creator_id, 200);
    const creatorChanged = Boolean(previousCreatorId && previousCreatorId !== creatorId);
    let proofCount = 0;

    if (creatorChanged) {
      const { count, error: countError } = await supabaseAdmin
        .from("works")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", user.id);
      if (countError) throw proofRegistryError("Creator proof count failed", countError);
      proofCount = Math.max(0, Number(count || 0));

      if (proofCount > 0 && req.body?.allow_rotation !== true) {
        return res.status(409).json({
          ok: false,
          code: "CREATOR_KEY_MISMATCH",
          error: "This browser has a different signing key from the one used for earlier proofs.",
          can_rotate: true,
          proof_count: proofCount,
          current_creator_id: previousCreatorId,
          requested_creator_id: creatorId,
        });
      }
    }

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .update({ creator_id: creatorId })
      .eq("id", user.id)
      .select(publicProfileColumns())
      .single();
    if (error) throw proofRegistryError("Creator identity link failed", error, 400);
    return res.json({
      ok: true,
      profile: data,
      rotated: creatorChanged,
      previous_creator_id: creatorChanged ? previousCreatorId : null,
      proof_count: proofCount,
    });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

app.post("/api/uploads/artwork", socialWriteLimit, upload.single("image"), async (req, res) => {
  try {
    if (!SOCIAL_ADMIN_CONFIGURED) return socialUnavailable(res, "Artwork upload");
    const { user } = await socialAuthContext(req);
    if (!req.file) return res.status(400).json({ ok: false, error: "Artwork image required" });
    const detectedType = detectImageType(req.file.buffer);
    if (!detectedType || detectedType.mime !== req.file.mimetype) {
      return res.status(400).json({ ok: false, error: "Uploaded artwork bytes do not match the declared image type" });
    }
    const ext = detectedType.ext;
    const objectName = `${user.id}/${Date.now()}-${crypto.randomBytes(10).toString("hex")}.${ext}`;
    const { error } = await supabaseAdmin.storage.from("trace-artworks").upload(objectName, req.file.buffer, {
      contentType: req.file.mimetype,
      cacheControl: "31536000",
      upsert: false,
    });
    if (error) throw proofRegistryError("Artwork upload failed", error, 400);
    const { data } = supabaseAdmin.storage.from("trace-artworks").getPublicUrl(objectName);
    return res.status(201).json({ ok: true, url: data?.publicUrl || "", path: objectName });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

app.post("/api/works", socialWriteLimit, async (req, res) => {
  try {
    const { user } = await socialAuthContext(req);
    const proofId = normalizeProofIdSocial(req.body?.proof_id);
    if (!proofId) return res.status(400).json({ ok: false, error: "Valid Badge ID required" });

    const registryRow = await readProofFromSupabase(proofId);
    if (!registryRow) return res.status(404).json({ ok: false, error: "The public proof is not registered" });
    const verification = await verifyTraceProofCryptographically(registryRow.proof);
    if (!verification.ok || verification.id !== proofId) {
      return res.status(400).json({ ok: false, error: "The registered proof failed integrity validation" });
    }

    const profile = await getProfileById(user.id);
    if (!profile) return res.status(404).json({ ok: false, error: "Creator profile not found" });
    const proofCreatorId = cleanText(registryRow.proof?.creator_id, 200);
    if (!proofCreatorId) return res.status(400).json({ ok: false, error: "The proof has no Creator ID" });
    if (profile.creator_id && profile.creator_id !== proofCreatorId) {
      return res.status(403).json({ ok: false, error: "This proof belongs to a different Creator ID" });
    }
    if (!profile.creator_id) {
      const { error: linkError } = await supabaseAdmin.from("profiles").update({ creator_id: proofCreatorId }).eq("id", user.id);
      if (linkError) throw proofRegistryError("Creator identity link failed", linkError, 400);
    }

    const existing = await supabaseAdmin.from("works").select(publicWorkColumns()).eq("proof_id", proofId).maybeSingle();
    if (existing.error) throw proofRegistryError("Published work lookup failed", existing.error);
    if (existing.data) {
      if (existing.data.owner_id !== user.id) return res.status(409).json({ ok: false, error: "This proof is already published by another creator profile" });
      const [enriched] = await enrichWorks([existing.data], user.id);
      return res.json({ ok: true, work: enriched, already_published: true });
    }

    const artworkUrl = cleanUrl(req.body?.artwork_url, 1200);
    const thumbnailUrl = cleanUrl(req.body?.thumbnail_url, 1200) || artworkUrl;
    const allowedStoragePrefix = `${SUPABASE_URL}/storage/v1/object/public/trace-artworks/`;
    for (const candidate of [artworkUrl, thumbnailUrl].filter(Boolean)) {
      if (!candidate.startsWith(allowedStoragePrefix)) {
        return res.status(400).json({ ok: false, error: "Artwork URL must come from the TRACE artwork upload service" });
      }
    }

    const inferredTitle = cleanText(registryRow.proof?.payload_text, 140).split(/\r?\n/)[0] || "Untitled work";
    const glyphStyle = SOCIAL_GLYPH_STYLES.has(registryRow.proof?.glyph_style)
      ? registryRow.proof.glyph_style
      : "spiro_flow";
    const row = {
      owner_id: user.id,
      proof_id: proofId,
      title: cleanText(req.body?.title || inferredTitle, 140) || "Untitled work",
      caption: cleanText(req.body?.caption, 2000),
      artwork_url: artworkUrl || null,
      thumbnail_url: thumbnailUrl || null,
      alt_text: cleanText(req.body?.alt_text, 500),
      medium: cleanText(req.body?.medium, 80),
      tags: cleanStringArray(req.body?.tags, 12, 40),
      glyph_style: glyphStyle,
      is_public: req.body?.is_public !== false,
    };

    const { data, error } = await supabaseAdmin.from("works").insert(row).select(publicWorkColumns()).single();
    if (error) throw proofRegistryError("Work publication failed", error, 400);

    const { data: followers } = await supabaseAdmin.from("follows").select("follower_id").eq("following_id", user.id).limit(1000);
    const notifications = (followers || [])
      .filter((follower) => follower.follower_id !== user.id)
      .map((follower) => ({
        recipient_id: follower.follower_id,
        actor_id: user.id,
        type: "work_published",
        work_id: data.id,
        payload: { title: data.title },
      }));
    if (notifications.length) {
      try { await supabaseAdmin.from("notifications").insert(notifications); } catch {}
    }

    const [enriched] = await enrichWorks([data], user.id);
    return res.status(201).json({ ok: true, work: enriched, already_published: false });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

app.patch("/api/works/:id", socialWriteLimit, async (req, res) => {
  try {
    const { user } = await socialAuthContext(req);
    const id = String(req.params.id || "");
    if (!validUuid(id)) return res.status(400).json({ ok: false, error: "Invalid work ID" });
    const patch = {};
    if (Object.hasOwn(req.body || {}, "title")) patch.title = cleanText(req.body.title, 140) || "Untitled work";
    if (Object.hasOwn(req.body || {}, "caption")) patch.caption = cleanText(req.body.caption, 2000);
    if (Object.hasOwn(req.body || {}, "alt_text")) patch.alt_text = cleanText(req.body.alt_text, 500);
    if (Object.hasOwn(req.body || {}, "medium")) patch.medium = cleanText(req.body.medium, 80);
    if (Object.hasOwn(req.body || {}, "tags")) patch.tags = cleanStringArray(req.body.tags, 12, 40);
    for (const key of ["featured", "is_public", "hidden_from_profile"]) if (Object.hasOwn(req.body || {}, key)) patch[key] = Boolean(req.body[key]);
    if (!Object.keys(patch).length) return res.status(400).json({ ok: false, error: "No work fields supplied" });
    const { data, error } = await supabaseAdmin
      .from("works")
      .update(patch)
      .eq("id", id)
      .eq("owner_id", user.id)
      .select(publicWorkColumns())
      .maybeSingle();
    if (error) throw proofRegistryError("Work update failed", error, 400);
    if (!data) return res.status(404).json({ ok: false, error: "Work not found or not owned by this account" });
    const [enriched] = await enrichWorks([data], user.id);
    return res.json({ ok: true, work: enriched });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

app.get("/api/discover", async (req, res) => {
  try {
    if (!SOCIAL_ADMIN_CONFIGURED) return socialUnavailable(res, "Discover");
    const viewer = await optionalSocialUser(req);
    const limit = Math.min(24, Math.max(1, Number.parseInt(req.query.limit || "12", 10) || 12));
    const offset = Math.max(0, Number.parseInt(req.query.offset || "0", 10) || 0);
    const [{ data: profileRows, error: profileError }, { data: workRows, error: workError }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select(publicProfileColumns())
        .eq("public_profile", true)
        .order("created_at", { ascending: false })
        .range(offset, offset + Math.min(12, limit) - 1),
      supabaseAdmin
        .from("works")
        .select(publicWorkColumns())
        .eq("is_public", true)
        .eq("hidden_from_profile", false)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1),
    ]);
    if (profileError) throw proofRegistryError("Discover creators failed", profileError);
    if (workError) throw proofRegistryError("Discover works failed", workError);
    const [profiles, works] = await Promise.all([
      enrichProfiles(profileRows || [], viewer?.id || ""),
      enrichWorks(workRows || [], viewer?.id || ""),
    ]);
    return res.json({ ok: true, creators: profiles, works, next_offset: works.length === limit ? offset + limit : null });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

app.get("/api/feed", async (req, res) => {
  try {
    const { user } = await socialAuthContext(req);
    const limit = Math.min(30, Math.max(1, Number.parseInt(req.query.limit || "12", 10) || 12));
    const offset = Math.max(0, Number.parseInt(req.query.offset || "0", 10) || 0);
    const { data: follows, error: followError } = await supabaseAdmin
      .from("follows")
      .select("following_id")
      .eq("follower_id", user.id);
    if (followError) throw proofRegistryError("Following feed lookup failed", followError);
    const ids = (follows || []).map((row) => row.following_id);
    if (!ids.length) return res.json({ ok: true, works: [], next_offset: null });
    const { data, error } = await supabaseAdmin
      .from("works")
      .select(publicWorkColumns())
      .in("owner_id", ids)
      .eq("is_public", true)
      .eq("hidden_from_profile", false)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw proofRegistryError("Following feed failed", error);
    const works = await enrichWorks(data || [], user.id);
    return res.json({ ok: true, works, next_offset: works.length === limit ? offset + limit : null });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

app.get("/api/search", async (req, res) => {
  try {
    if (!SOCIAL_ADMIN_CONFIGURED) return socialUnavailable(res, "Search");
    const viewer = await optionalSocialUser(req);
    const q = cleanText(req.query.q, 80).replace(/^@/, "");
    const limit = Math.min(20, Math.max(1, Number.parseInt(req.query.limit || "12", 10) || 12));
    if (q.length < 2) return res.json({ ok: true, creators: [], works: [], collections: [] });
    const pattern = `%${q.replace(/[%_]/g, "\\$&")}%`;
    const [{ data: profiles, error: profileError }, { data: works, error: workError }, { data: collections, error: collectionError }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select(publicProfileColumns())
        .eq("public_profile", true)
        .or(`handle.ilike.${pattern},display_name.ilike.${pattern},bio.ilike.${pattern}`)
        .limit(limit),
      supabaseAdmin
        .from("works")
        .select(publicWorkColumns())
        .eq("is_public", true)
        .or(`title.ilike.${pattern},caption.ilike.${pattern},medium.ilike.${pattern}`)
        .order("created_at", { ascending: false })
        .limit(limit),
      supabaseAdmin
        .from("collections")
        .select("id,owner_id,name,description,is_public,created_at")
        .eq("is_public", true)
        .or(`name.ilike.${pattern},description.ilike.${pattern}`)
        .limit(limit),
    ]);
    if (profileError) throw proofRegistryError("Creator search failed", profileError);
    if (workError) throw proofRegistryError("Work search failed", workError);
    if (collectionError) throw proofRegistryError("Collection search failed", collectionError);
    const enrichedProfiles = await enrichProfiles(profiles || [], viewer?.id || "");
    const enrichedWorks = await enrichWorks(works || [], viewer?.id || "");
    return res.json({ ok: true, creators: enrichedProfiles, works: enrichedWorks, collections: collections || [] });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

app.get("/api/creators/:handle", async (req, res) => {
  try {
    const viewer = await optionalSocialUser(req);
    const profile = await getProfileByHandle(req.params.handle, { includePrivateForUser: viewer?.id || "" });
    if (!profile) return res.status(404).json({ ok: false, error: "Creator not found" });
    const blocked = await blockedProfileIds(viewer?.id || "");
    if (blocked.has(profile.id)) return res.status(404).json({ ok: false, error: "Creator not found" });
    const [enriched] = await enrichProfiles([profile], viewer?.id || "");
    return res.json({ ok: true, creator: enriched });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

app.get("/api/creators/:handle/works", async (req, res) => {
  try {
    const viewer = await optionalSocialUser(req);
    const profile = await getProfileByHandle(req.params.handle, { includePrivateForUser: viewer?.id || "" });
    if (!profile) return res.status(404).json({ ok: false, error: "Creator not found" });
    const limit = Math.min(30, Math.max(1, Number.parseInt(req.query.limit || "18", 10) || 18));
    const offset = Math.max(0, Number.parseInt(req.query.offset || "0", 10) || 0);
    let query = supabaseAdmin
      .from("works")
      .select(publicWorkColumns())
      .eq("owner_id", profile.id)
      .eq("hidden_from_profile", false)
      .order("featured", { ascending: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (viewer?.id !== profile.id) query = query.eq("is_public", true);
    const { data, error } = await query;
    if (error) throw proofRegistryError("Creator works failed", error);
    const works = await enrichWorks(data || [], viewer?.id || "");
    return res.json({ ok: true, works, next_offset: works.length === limit ? offset + limit : null });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

app.get("/api/works/:id", async (req, res) => {
  try {
    const viewer = await optionalSocialUser(req);
    const id = String(req.params.id || "");
    if (!validUuid(id)) return res.status(400).json({ ok: false, error: "Invalid work ID" });
    const { data, error } = await supabaseAdmin.from("works").select(publicWorkColumns()).eq("id", id).maybeSingle();
    if (error) throw proofRegistryError("Work read failed", error);
    if (!data || (!data.is_public && data.owner_id !== viewer?.id)) return res.status(404).json({ ok: false, error: "Work not found" });
    const blocked = await blockedProfileIds(viewer?.id || "");
    if (blocked.has(data.owner_id)) return res.status(404).json({ ok: false, error: "Work not found" });
    const [work] = await enrichWorks([data], viewer?.id || "");
    return res.json({ ok: true, work });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

app.post("/api/works/:id/view", async (req, res) => {
  try {
    if (!SOCIAL_ADMIN_CONFIGURED) return socialUnavailable(res, "View tracking");
    const viewer = await optionalSocialUser(req);
    const id = String(req.params.id || "");
    if (!validUuid(id)) return res.status(400).json({ ok: false, error: "Invalid work ID" });
    const eventType = ["work_open", "proof_open", "verification_open"].includes(req.body?.event_type)
      ? req.body.event_type
      : "work_open";
    await supabaseAdmin.from("proof_views").insert({ work_id: id, viewer_id: viewer?.id || null, event_type: eventType });
    return res.status(204).end();
  } catch {
    return res.status(204).end();
  }
});

app.post("/api/follows/:profileId", socialWriteLimit, async (req, res) => {
  try {
    const { user } = await socialAuthContext(req);
    const profileId = String(req.params.profileId || "");
    if (!validUuid(profileId) || profileId === user.id) return res.status(400).json({ ok: false, error: "Invalid creator" });
    await assertNotBlocked(user.id, profileId);
    const { error } = await supabaseAdmin.from("follows").upsert(
      { follower_id: user.id, following_id: profileId },
      { onConflict: "follower_id,following_id", ignoreDuplicates: true }
    );
    if (error) throw proofRegistryError("Follow failed", error, 400);
    await createNotification({ recipientId: profileId, actorId: user.id, type: "follow" });
    return res.json({ ok: true, following: true });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

app.delete("/api/follows/:profileId", socialWriteLimit, async (req, res) => {
  try {
    const { user } = await socialAuthContext(req);
    const profileId = String(req.params.profileId || "");
    if (!validUuid(profileId)) return res.status(400).json({ ok: false, error: "Invalid creator" });
    const { error } = await supabaseAdmin.from("follows").delete().eq("follower_id", user.id).eq("following_id", profileId);
    if (error) throw proofRegistryError("Unfollow failed", error, 400);
    return res.json({ ok: true, following: false });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

async function workReaction(req, res, table, notificationType, enabled) {
  try {
    const { user } = await socialAuthContext(req);
    const workId = String(req.params.id || "");
    if (!validUuid(workId)) return res.status(400).json({ ok: false, error: "Invalid work ID" });
    const { data: work, error: workError } = await supabaseAdmin
      .from("works")
      .select("id,owner_id,title,is_public")
      .eq("id", workId)
      .maybeSingle();
    if (workError) throw proofRegistryError("Work lookup failed", workError);
    if (!work || !work.is_public) return res.status(404).json({ ok: false, error: "Work not found" });
    await assertNotBlocked(user.id, work.owner_id);
    if (enabled) {
      const { error } = await supabaseAdmin.from(table).upsert(
        { user_id: user.id, work_id: workId },
        { onConflict: "user_id,work_id", ignoreDuplicates: true }
      );
      if (error) throw proofRegistryError("Social action failed", error, 400);
      await createNotification({ recipientId: work.owner_id, actorId: user.id, type: notificationType, workId, payload: { title: work.title } });
    } else {
      const { error } = await supabaseAdmin.from(table).delete().eq("user_id", user.id).eq("work_id", workId);
      if (error) throw proofRegistryError("Social action removal failed", error, 400);
    }
    const counts = await workCounts(workId);
    return res.json({ ok: true, enabled, stats: counts });
  } catch (error) {
    return sendSocialError(res, error);
  }
}

app.post("/api/works/:id/appreciate", socialWriteLimit, (req, res) => workReaction(req, res, "appreciations", "appreciation", true));
app.delete("/api/works/:id/appreciate", socialWriteLimit, (req, res) => workReaction(req, res, "appreciations", "appreciation", false));
app.post("/api/works/:id/save", socialWriteLimit, (req, res) => workReaction(req, res, "saved_works", "save", true));
app.delete("/api/works/:id/save", socialWriteLimit, (req, res) => workReaction(req, res, "saved_works", "save", false));

app.get("/api/works/:id/comments", async (req, res) => {
  try {
    const viewer = await optionalSocialUser(req);
    const workId = String(req.params.id || "");
    if (!validUuid(workId)) return res.status(400).json({ ok: false, error: "Invalid work ID" });
    const { data, error } = await supabaseAdmin
      .from("comments")
      .select("id,work_id,author_id,parent_id,body,hidden,created_at,updated_at")
      .eq("work_id", workId)
      .eq("hidden", false)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw proofRegistryError("Comments read failed", error);
    const authorIds = [...new Set((data || []).map((row) => row.author_id))];
    let authors = [];
    if (authorIds.length) {
      const result = await supabaseAdmin.from("profiles").select("id,handle,display_name,avatar_url,public_profile").in("id", authorIds);
      if (result.error) throw proofRegistryError("Comment authors failed", result.error);
      authors = result.data || [];
    }
    const authorMap = new Map(authors.map((author) => [author.id, author]));
    const blocked = await blockedProfileIds(viewer?.id || "");
    const comments = (data || [])
      .filter((comment) => !blocked.has(comment.author_id))
      .map((comment) => ({ ...comment, author: authorMap.get(comment.author_id) || null, is_owner: viewer?.id === comment.author_id }));
    return res.json({ ok: true, comments });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

app.post("/api/works/:id/comments", socialCommentLimit, async (req, res) => {
  try {
    const { user } = await socialAuthContext(req);
    const workId = String(req.params.id || "");
    const body = cleanText(req.body?.body, 1000);
    const parentId = req.body?.parent_id ? String(req.body.parent_id) : null;
    if (!validUuid(workId)) return res.status(400).json({ ok: false, error: "Invalid work ID" });
    if (!body) return res.status(400).json({ ok: false, error: "Comment cannot be empty" });
    if (parentId && !validUuid(parentId)) return res.status(400).json({ ok: false, error: "Invalid reply target" });
    const { data: work, error: workError } = await supabaseAdmin
      .from("works")
      .select("id,owner_id,title,is_public")
      .eq("id", workId)
      .maybeSingle();
    if (workError) throw proofRegistryError("Work lookup failed", workError);
    if (!work || !work.is_public) return res.status(404).json({ ok: false, error: "Work not found" });
    await assertNotBlocked(user.id, work.owner_id);

    let parent = null;
    if (parentId) {
      const result = await supabaseAdmin
        .from("comments")
        .select("id,author_id,work_id")
        .eq("id", parentId)
        .eq("work_id", workId)
        .maybeSingle();
      if (result.error) throw proofRegistryError("Reply target lookup failed", result.error);
      if (!result.data) return res.status(404).json({ ok: false, error: "Reply target not found" });
      parent = result.data;
      await assertNotBlocked(user.id, parent.author_id);
    }

    const { data, error } = await supabaseAdmin
      .from("comments")
      .insert({ work_id: workId, author_id: user.id, parent_id: parentId, body })
      .select("id,work_id,author_id,parent_id,body,hidden,created_at,updated_at")
      .single();
    if (error) throw proofRegistryError("Comment could not be posted", error, 400);
    await createNotification({
      recipientId: parent ? parent.author_id : work.owner_id,
      actorId: user.id,
      type: parent ? "reply" : "comment",
      workId,
      commentId: data.id,
      payload: { title: work.title },
    });
    const author = await getProfileById(user.id);
    return res.status(201).json({ ok: true, comment: { ...data, author, is_owner: true } });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

app.delete("/api/comments/:id", socialWriteLimit, async (req, res) => {
  try {
    const { user } = await socialAuthContext(req);
    const id = String(req.params.id || "");
    if (!validUuid(id)) return res.status(400).json({ ok: false, error: "Invalid comment ID" });
    const { data, error } = await supabaseAdmin
      .from("comments")
      .delete()
      .eq("id", id)
      .eq("author_id", user.id)
      .select("id")
      .maybeSingle();
    if (error) throw proofRegistryError("Comment deletion failed", error, 400);
    if (!data) return res.status(404).json({ ok: false, error: "Comment not found or not owned by this account" });
    return res.json({ ok: true });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

app.get("/api/notifications", async (req, res) => {
  try {
    const { user } = await socialAuthContext(req);
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit || "30", 10) || 30));
    const { data, error } = await supabaseAdmin
      .from("notifications")
      .select("id,recipient_id,actor_id,type,work_id,comment_id,payload,read_at,created_at")
      .eq("recipient_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw proofRegistryError("Notifications read failed", error);
    const actorIds = [...new Set((data || []).map((row) => row.actor_id).filter(Boolean))];
    let actors = [];
    if (actorIds.length) {
      const result = await supabaseAdmin.from("profiles").select("id,handle,display_name,avatar_url").in("id", actorIds);
      if (result.error) throw proofRegistryError("Notification actors failed", result.error);
      actors = result.data || [];
    }
    const actorMap = new Map(actors.map((actor) => [actor.id, actor]));
    const notifications = (data || []).map((row) => ({ ...row, actor: actorMap.get(row.actor_id) || null }));
    return res.json({ ok: true, notifications, unread: notifications.filter((row) => !row.read_at).length });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

app.post("/api/notifications/read", socialWriteLimit, async (req, res) => {
  try {
    const { user } = await socialAuthContext(req);
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(validUuid).slice(0, 100) : [];
    let query = supabaseAdmin.from("notifications").update({ read_at: new Date().toISOString() }).eq("recipient_id", user.id).is("read_at", null);
    if (ids.length) query = query.in("id", ids);
    const { error } = await query;
    if (error) throw proofRegistryError("Notification update failed", error, 400);
    return res.json({ ok: true });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

app.get("/api/collections", async (req, res) => {
  try {
    const viewer = await optionalSocialUser(req);
    const ownerId = String(req.query.owner_id || viewer?.id || "");
    if (!validUuid(ownerId)) return res.status(400).json({ ok: false, error: "Owner ID required" });
    let query = supabaseAdmin
      .from("collections")
      .select("id,owner_id,name,description,is_public,created_at,updated_at")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false });
    if (viewer?.id !== ownerId) query = query.eq("is_public", true);
    const { data, error } = await query;
    if (error) throw proofRegistryError("Collections read failed", error);
    const output = [];
    for (const collection of data || []) {
      const count = await countRows("collection_items", "collection_id", collection.id);
      output.push({ ...collection, item_count: count, is_owner: viewer?.id === ownerId });
    }
    return res.json({ ok: true, collections: output });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

app.post("/api/collections", socialWriteLimit, async (req, res) => {
  try {
    const { user } = await socialAuthContext(req);
    const name = cleanText(req.body?.name, 80);
    if (!name) return res.status(400).json({ ok: false, error: "Collection name required" });
    const { data, error } = await supabaseAdmin
      .from("collections")
      .insert({ owner_id: user.id, name, description: cleanText(req.body?.description, 500), is_public: Boolean(req.body?.is_public) })
      .select("id,owner_id,name,description,is_public,created_at,updated_at")
      .single();
    if (error) throw proofRegistryError("Collection creation failed", error, 400);
    return res.status(201).json({ ok: true, collection: { ...data, item_count: 0, is_owner: true } });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

app.patch("/api/collections/:id", socialWriteLimit, async (req, res) => {
  try {
    const { user } = await socialAuthContext(req);
    const id = String(req.params.id || "");
    if (!validUuid(id)) return res.status(400).json({ ok: false, error: "Invalid collection ID" });
    const patch = {};
    if (Object.hasOwn(req.body || {}, "name")) patch.name = cleanText(req.body.name, 80);
    if (Object.hasOwn(req.body || {}, "description")) patch.description = cleanText(req.body.description, 500);
    if (Object.hasOwn(req.body || {}, "is_public")) patch.is_public = Boolean(req.body.is_public);
    if (!patch.name && Object.hasOwn(patch, "name")) return res.status(400).json({ ok: false, error: "Collection name required" });
    const { data, error } = await supabaseAdmin
      .from("collections")
      .update(patch)
      .eq("id", id)
      .eq("owner_id", user.id)
      .select("id,owner_id,name,description,is_public,created_at,updated_at")
      .maybeSingle();
    if (error) throw proofRegistryError("Collection update failed", error, 400);
    if (!data) return res.status(404).json({ ok: false, error: "Collection not found" });
    return res.json({ ok: true, collection: data });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

app.delete("/api/collections/:id", socialWriteLimit, async (req, res) => {
  try {
    const { user } = await socialAuthContext(req);
    const id = String(req.params.id || "");
    if (!validUuid(id)) return res.status(400).json({ ok: false, error: "Invalid collection ID" });
    const { error } = await supabaseAdmin.from("collections").delete().eq("id", id).eq("owner_id", user.id);
    if (error) throw proofRegistryError("Collection deletion failed", error, 400);
    return res.json({ ok: true });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

app.post("/api/collections/:id/items", socialWriteLimit, async (req, res) => {
  try {
    const { user } = await socialAuthContext(req);
    const collectionId = String(req.params.id || "");
    const workId = String(req.body?.work_id || "");
    if (!validUuid(collectionId) || !validUuid(workId)) return res.status(400).json({ ok: false, error: "Invalid collection or work ID" });
    const { data: collection } = await supabaseAdmin
      .from("collections")
      .select("id,owner_id")
      .eq("id", collectionId)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (!collection) return res.status(404).json({ ok: false, error: "Collection not found" });
    const { error } = await supabaseAdmin.from("collection_items").upsert(
      { collection_id: collectionId, work_id: workId, added_by: user.id },
      { onConflict: "collection_id,work_id", ignoreDuplicates: true }
    );
    if (error) throw proofRegistryError("Could not add work to collection", error, 400);
    return res.json({ ok: true });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

app.delete("/api/collections/:id/items/:workId", socialWriteLimit, async (req, res) => {
  try {
    const { user } = await socialAuthContext(req);
    const collectionId = String(req.params.id || "");
    const workId = String(req.params.workId || "");
    if (!validUuid(collectionId) || !validUuid(workId)) return res.status(400).json({ ok: false, error: "Invalid collection or work ID" });
    const { data: collection } = await supabaseAdmin
      .from("collections")
      .select("id")
      .eq("id", collectionId)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (!collection) return res.status(404).json({ ok: false, error: "Collection not found" });
    const { error } = await supabaseAdmin
      .from("collection_items")
      .delete()
      .eq("collection_id", collectionId)
      .eq("work_id", workId);
    if (error) throw proofRegistryError("Could not remove work from collection", error, 400);
    return res.json({ ok: true });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

app.get("/api/collections/:id/items", async (req, res) => {
  try {
    const viewer = await optionalSocialUser(req);
    const id = String(req.params.id || "");
    if (!validUuid(id)) return res.status(400).json({ ok: false, error: "Invalid collection ID" });
    const { data: collection, error: collectionError } = await supabaseAdmin
      .from("collections")
      .select("id,owner_id,name,description,is_public,created_at")
      .eq("id", id)
      .maybeSingle();
    if (collectionError) throw proofRegistryError("Collection lookup failed", collectionError);
    if (!collection || (!collection.is_public && collection.owner_id !== viewer?.id)) return res.status(404).json({ ok: false, error: "Collection not found" });
    const { data: items, error } = await supabaseAdmin.from("collection_items").select("work_id,created_at").eq("collection_id", id).order("created_at", { ascending: false });
    if (error) throw proofRegistryError("Collection items failed", error);
    const ids = (items || []).map((item) => item.work_id);
    let works = [];
    if (ids.length) {
      const result = await supabaseAdmin.from("works").select(publicWorkColumns()).in("id", ids);
      if (result.error) throw proofRegistryError("Collection works failed", result.error);
      works = await enrichWorks((result.data || []).filter((work) => work.is_public || work.owner_id === viewer?.id), viewer?.id || "");
    }
    return res.json({ ok: true, collection, works });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

app.post("/api/blocks/:profileId", socialWriteLimit, async (req, res) => {
  try {
    const { user } = await socialAuthContext(req);
    const profileId = String(req.params.profileId || "");
    if (!validUuid(profileId) || profileId === user.id) return res.status(400).json({ ok: false, error: "Invalid creator" });
    await supabaseAdmin.from("follows").delete().or(
      `and(follower_id.eq.${user.id},following_id.eq.${profileId}),and(follower_id.eq.${profileId},following_id.eq.${user.id})`
    );
    const { error } = await supabaseAdmin.from("blocks").upsert(
      { blocker_id: user.id, blocked_id: profileId },
      { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true }
    );
    if (error) throw proofRegistryError("Block failed", error, 400);
    return res.json({ ok: true, blocked: true });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

app.delete("/api/blocks/:profileId", socialWriteLimit, async (req, res) => {
  try {
    const { user } = await socialAuthContext(req);
    const profileId = String(req.params.profileId || "");
    if (!validUuid(profileId)) return res.status(400).json({ ok: false, error: "Invalid creator" });
    const { error } = await supabaseAdmin.from("blocks").delete().eq("blocker_id", user.id).eq("blocked_id", profileId);
    if (error) throw proofRegistryError("Unblock failed", error, 400);
    return res.json({ ok: true, blocked: false });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

app.post("/api/reports", socialWriteLimit, async (req, res) => {
  try {
    const { user } = await socialAuthContext(req);
    const targetType = cleanText(req.body?.target_type, 20);
    const targetId = cleanText(req.body?.target_id, 100);
    const reason = cleanText(req.body?.reason, 100);
    const details = cleanText(req.body?.details, 1000);
    if (!new Set(["profile", "work", "comment"]).has(targetType) || !targetId || reason.length < 2) {
      return res.status(400).json({ ok: false, error: "Valid report target and reason required" });
    }
    const { error } = await supabaseAdmin.from("reports").insert({
      reporter_id: user.id,
      target_type: targetType,
      target_id: targetId,
      reason,
      details,
    });
    if (error) throw proofRegistryError("Report submission failed", error, 400);
    return res.status(201).json({ ok: true });
  } catch (error) {
    return sendSocialError(res, error);
  }
});


app.get("/verify/:id", (req, res) => {
  const id = normalizeProofId(req.params.id);

  if (!id) {
    return res.status(400).send("Invalid Badge ID");
  }

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.send(verifyPageHtml(id));
});

app.get("/health", (req, res) => {
  resetDailyUsageIfNeeded();

  return res.json({
    ok: true,
    build: "trace-v50.4-glyph-spec-about-landing-cleanup",
    ts: Date.now(),
    frontend_found: fs.existsSync(indexPath),
    glyph_engine_found: fs.existsSync(glyphEnginePath),
    glyph_contract_version: TRACE_GLYPH_SPEC_VERSION,
    social_build: typeof SOCIAL_BUILD !== "undefined" ? SOCIAL_BUILD : null,
    social_enabled: typeof SOCIAL_AUTH_CONFIGURED !== "undefined" ? SOCIAL_AUTH_CONFIGURED : false,
    supabase_resolved_host: (() => { try { return new URL(SUPABASE_URL).hostname; } catch { return ""; } })(),
    supabase_project_ref: SUPABASE_URL_RESOLUTION.ref || "",
    supabase_url_corrected: Boolean(SUPABASE_URL_RESOLUTION.corrected),
    supabase_url_resolution_source: SUPABASE_URL_RESOLUTION.source,
    supabase_auth_key_source: typeof SUPABASE_AUTH_KEY_SOURCE !== "undefined" ? SUPABASE_AUTH_KEY_SOURCE : "missing",
    supabase_auth_key_kind: classifySupabaseKey(SUPABASE_AUTH_KEY),
    scanner_configured: Boolean(WINSTON_TOKEN),
    origin_contract_version: TRACE_ORIGIN_CONTRACT_VERSION,
    origin_score_semantics: TRACE_ORIGIN_SCORE_SEMANTICS,
    winston_image_version: WINSTON_IMAGE_VERSION,
    origin_inputs_active: originInputStore.size,
    origin_idempotency_records: originRequestResults.size,
    origin_inflight_requests: originInflightRequests.size,
    proof_registry_configured: PROOF_REGISTRY_CONFIGURED,
    proof_registry_url_present: Boolean(SUPABASE_URL),
    proof_registry_key_present: Boolean(SUPABASE_SECRET_KEY),
    proof_registry_url_source: SUPABASE_URL_SOURCE,
    proof_registry_key_source: SUPABASE_KEY_SOURCE,
    proof_registry_key_kind: SUPABASE_KEY_KIND,
    proof_registry_config_error: PROOF_REGISTRY_CONFIGURED
      ? null
      : proofRegistryConfigurationMessage(),
    scans_today: globalScansToday,
    scans_remaining_today: Math.max(
      0,
      CONFIG.globalDailyLimit - globalScansToday
    ),
    active_scans: activeScans,
  });
});

app.get("/api/origin/input/:token.:ext", (req, res) => {
  const token = String(req.params.token || "");
  const record = originInputStore.get(token);

  if (!record || record.expiresAt <= Date.now()) {
    originInputStore.delete(token);
    return res.status(404).send("Origin input expired");
  }

  record.accessCount += 1;
  record.lastAccessAt = Date.now();

  res.setHeader("Content-Type", record.mimeType);
  res.setHeader("Content-Length", String(record.buffer.length));
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(200).send(record.buffer);
});

async function originAnalyzeHandler(req, res) {
  const requestId = sanitizeOriginRequestId(
    req.body?.client_request_id || req.headers["x-trace-request-id"]
  );
  const ip = clientIp(req);
  let concurrencyReserved = false;
  let inputToken = null;

  try {
    cleanupOriginRuntime();

    if (!req.file) {
      return res.status(400).json(canonicalOriginError({
        requestId,
        confidenceState: "invalid_provider_response",
        errorCode: "missing_image",
        errorMessage: "No image uploaded",
        input: null,
      }));
    }

    const detectedType = detectImageType(req.file.buffer);
    if (!detectedType || detectedType.mime !== req.file.mimetype) {
      return res.status(415).json(canonicalOriginError({
        requestId,
        confidenceState: "invalid_provider_response",
        errorCode: "unsupported_image_type",
        errorMessage: "The uploaded file is not a valid JPEG, PNG or WebP image",
        input: {
          bytes: req.file.buffer.length,
          mime_type: String(req.file.mimetype || ""),
          filename: normalizeFilename(req.file.originalname),
        },
      }));
    }

    const serverHash = sha256HexBuffer(req.file.buffer);
    // Older TRACE crypto helpers return "sha256:<hex>" while the Origin Scan
    // v1 wire contract uses raw 64-character hexadecimal. Accept either form
    // at the HTTP boundary, then store and compare only the canonical raw hex.
    const clientHashRaw = String(req.body?.client_sha256 || "")
      .trim()
      .replace(/^sha256:/i, "")
      .toLowerCase();
    const clientHash = /^[a-f0-9]{64}$/.test(clientHashRaw) ? clientHashRaw : "";
    const input = originInputMetadata(
      req,
      req.file,
      detectedType,
      serverHash,
      clientHash,
      requestId
    );

    if (!clientHash) {
      return res.status(400).json(canonicalOriginError({
        requestId,
        confidenceState: "input_integrity_mismatch",
        errorCode: "client_hash_missing",
        errorMessage: "Client SHA-256 is required for Origin Scan integrity",
        input,
      }));
    }

    if (clientHash !== serverHash) {
      return res.status(409).json(canonicalOriginError({
        requestId,
        confidenceState: "input_integrity_mismatch",
        errorCode: "input_integrity_mismatch",
        errorMessage: "Client and server image hashes do not match",
        input,
      }));
    }

    const previous = originRequestResults.get(requestId);
    if (previous) {
      if (previous.sha256 !== serverHash) {
        return res.status(409).json(canonicalOriginError({
          requestId,
          confidenceState: "input_integrity_mismatch",
          errorCode: "request_id_hash_conflict",
          errorMessage: "This request ID was already used for different image bytes",
          input,
        }));
      }
      return res.status(previous.httpStatus).json({
        ...previous.result,
        diagnostics: {
          ...(previous.result.diagnostics || {}),
          idempotent_replay: true,
        },
      });
    }

    const activeRequest = originInflightRequests.get(requestId);
    if (activeRequest) {
      if (activeRequest.sha256 !== serverHash) {
        return res.status(409).json(canonicalOriginError({
          requestId,
          confidenceState: "input_integrity_mismatch",
          errorCode: "request_id_hash_conflict",
          errorMessage: "This request ID is already analyzing different image bytes",
          input,
        }));
      }
      const shared = await activeRequest.promise;
      return res.status(shared.httpStatus).json({
        ...shared.result,
        diagnostics: {
          ...(shared.result.diagnostics || {}),
          shared_inflight: true,
        },
      });
    }

    const budget = checkAndReserveDailyBudget(ip);
    if (!budget.ok) {
      if (budget.retryAfterSeconds) {
        res.setHeader("Retry-After", String(budget.retryAfterSeconds));
      }
      return res.status(budget.status).json(canonicalOriginError({
        requestId,
        confidenceState: "provider_unavailable",
        errorCode: "scan_budget_unavailable",
        errorMessage: budget.error,
        input,
      }));
    }
    concurrencyReserved = true;

    const stored = storeOriginInput({
      buffer: req.file.buffer,
      mimeType: detectedType.mime,
      filename: input.filename,
      sha256: serverHash,
      requestId,
    });
    inputToken = stored.token;
    const imageUrl = `${requestBase(req)}/api/origin/input/${stored.token}.${stored.ext}`;

    const scanPromise = (async () => {
      const result = await performPaidScan({
        imageUrl,
        requestId,
        input,
        token: stored.token,
      });

      const inputRecord = originInputStore.get(stored.token);
      if (result.ok && (!inputRecord || inputRecord.accessCount < 1)) {
        return {
          httpStatus: 502,
          result: canonicalOriginError({
            requestId,
            confidenceState: "invalid_provider_response",
            errorCode: "provider_input_not_fetched",
            errorMessage: "Winston returned a result without fetching the TRACE input URL",
            input,
            providerResult: result.provider_result,
            latencyMs: result.diagnostics?.latency_ms,
          }),
        };
      }

      const httpStatus = result.ok
        ? 200
        : result.confidence_state === "input_integrity_mismatch"
          ? 409
          : result.confidence_state === "ambiguous_provider_response" ||
              result.confidence_state === "invalid_provider_response"
            ? 422
            : 502;

      return { httpStatus, result };
    })();

    originInflightRequests.set(requestId, { sha256: serverHash, promise: scanPromise });
    const completed = await scanPromise;

    originRequestResults.set(requestId, {
      sha256: serverHash,
      result: completed.result,
      httpStatus: completed.httpStatus,
      expiresAt: Date.now() + ORIGIN_IDEMPOTENCY_MS,
    });

    console.log(JSON.stringify({
      event: "trace_origin_contract_result",
      request_id: requestId,
      ok: completed.result.ok,
      confidence_state: completed.result.confidence_state,
      error_code: completed.result.error_code,
      classification: completed.result.classification,
      ai_probability: completed.result.ai_probability,
      human_probability: completed.result.human_probability,
      input_sha256_prefix: serverHash.slice(0, 12),
      source_field: completed.result.provider_result?.source_field || null,
      source_semantics: completed.result.provider_result?.source_semantics || null,
      source_scale: completed.result.provider_result?.source_scale || null,
      fallback_used: false,
    }));

    return res.status(completed.httpStatus).json(completed.result);
  } catch (error) {
    console.error(JSON.stringify({
      event: "trace_origin_error",
      request_id: requestId,
      error_code: String(error?.code || "origin_server_error"),
      message: String(error?.message || error),
    }));

    return res.status(error.httpStatus || 500).json(canonicalOriginError({
      requestId,
      confidenceState: "provider_unavailable",
      errorCode: String(error?.code || "origin_server_error"),
      errorMessage: error?.message || "Origin Scan server error",
      input: req.file ? {
        bytes: req.file.buffer?.length || 0,
        mime_type: req.file.mimetype || "",
        filename: normalizeFilename(req.file.originalname),
      } : null,
    }));
  } finally {
    originInflightRequests.delete(requestId);
    if (concurrencyReserved) releaseConcurrencySlot();
    if (inputToken) deleteOriginInputLater(inputToken);
  }
}

app.post(
  "/api/origin/analyze",
  burstLimit,
  upload.single("image"),
  originAnalyzeHandler
);

/* Backward-compatible alias. V50 frontend uses /api/origin/analyze only. */
app.post(
  "/detect-image",
  burstLimit,
  upload.single("image"),
  originAnalyzeHandler
);

app.use((error, req, res, next) => {
  const isOriginRoute = req.path === "/api/origin/analyze" || req.path === "/detect-image";
  const requestId = sanitizeOriginRequestId(req.headers["x-trace-request-id"] || req.body?.client_request_id);

  if (error instanceof multer.MulterError) {
    const isTooLarge = error.code === "LIMIT_FILE_SIZE";
    const message = isTooLarge
      ? `Image is too large. Maximum size is ${Math.floor(CONFIG.maxImageBytes / (1024 * 1024))} MB.`
      : `Upload rejected: ${error.code}`;
    if (isOriginRoute) {
      return res.status(isTooLarge ? 413 : 400).json(canonicalOriginError({
        requestId,
        confidenceState: "invalid_provider_response",
        errorCode: isTooLarge ? "image_too_large" : "upload_rejected",
        errorMessage: message,
        input: null,
      }));
    }
    return res.status(isTooLarge ? 413 : 400).json({ ok: false, error: message });
  }

  if (error?.code === "UNSUPPORTED_IMAGE_TYPE") {
    if (isOriginRoute) {
      return res.status(415).json(canonicalOriginError({
        requestId,
        confidenceState: "invalid_provider_response",
        errorCode: "unsupported_image_type",
        errorMessage: error.message,
        input: null,
      }));
    }
    return res.status(415).json({ ok: false, error: error.message });
  }

  console.error("Unhandled server error:", error);
  if (isOriginRoute) {
    return res.status(500).json(canonicalOriginError({
      requestId,
      confidenceState: "provider_unavailable",
      errorCode: "origin_server_error",
      errorMessage: "Origin Scan server error",
      input: null,
    }));
  }
  return res.status(500).json({ ok: false, error: "Server error" });
});

const maintenanceTimer = setInterval(() => {
  const now = Date.now();
  cleanupOriginRuntime(now);

  for (const [ip, bucket] of burstBuckets) {
    if (now >= bucket.resetAt) burstBuckets.delete(ip);
  }

  for (const [ip, bucket] of proofPublishBuckets) {
    if (now >= bucket.resetAt) proofPublishBuckets.delete(ip);
  }

  fs.promises
    .readdir(uploadDir)
    .then(async (files) => {
      for (const filename of files) {
        const filePath = path.join(uploadDir, filename);

        try {
          const stat = await fs.promises.stat(filePath);

          if (now - stat.mtimeMs > 60 * 60 * 1000) {
            await fs.promises.unlink(filePath);
          }
        } catch {}
      }
    })
    .catch(() => {});
}, 15 * 60 * 1000);

maintenanceTimer.unref?.();

function runOriginNormalizationTests() {
  const results = [];
  const input = {
    sha256: "a".repeat(64),
    server_sha256: "a".repeat(64),
    client_sha256: "a".repeat(64),
    hash_match: true,
    bytes: 1234,
    mime_type: "image/png",
    filename: "test.png",
  };

  const check = (name, raw, expected, options = {}) => {
    const result = normalizeWinstonOriginResponse(raw, {
      requestId: `test_${results.length}_${crypto.randomUUID().replace(/-/g, "")}`,
      input,
      rawScoreSemantics: options.rawScoreSemantics ?? null,
    });
    assert.equal(result.ok, expected.ok ?? true, `${name}: unexpected ok state`);
    if (expected.error_code !== undefined) assert.equal(result.error_code, expected.error_code, `${name}: error code`);
    if (expected.ai !== undefined) assert.ok(Math.abs(result.ai_probability - expected.ai) < 1e-12, `${name}: AI probability`);
    if (expected.human !== undefined) assert.ok(Math.abs(result.human_probability - expected.human) < 1e-12, `${name}: Human probability`);
    if (expected.classification !== undefined) assert.equal(result.classification, expected.classification, `${name}: classification`);
    results.push({ name, ok: true });
    return result;
  };

  check("AI probability 0", { ai_probability: 0 }, { ai: 0, human: 1, classification: "human_leaning" });
  check("AI probability 1", { ai_probability: 1 }, { ai: 1, human: 0, classification: "ai_like" });
  check("AI probability 0.6", { ai_probability: 0.6 }, { ai: 0.6, human: 0.4, classification: "inconclusive" });
  check("Human probability 1", { human_probability: 1 }, { ai: 0, human: 1, classification: "human_leaning" });
  check("Human probability 0.74", { human_probability: 0.74 }, { ai: 0.26, human: 0.74, classification: "human_leaning" });
  check("Human score 100", { human_score: 100 }, { ai: 0, human: 1, classification: "human_leaning" });
  check("Human score 74", { human_score: 74 }, { ai: 0.26, human: 0.74, classification: "human_leaning" });
  check("Winston score 100 declared Human", { score: 100 }, { ai: 0, human: 1, classification: "human_leaning" }, { rawScoreSemantics: "human_probability" });
  check("Winston score 40 declared Human", { score: 40 }, { ai: 0.6, human: 0.4, classification: "inconclusive" }, { rawScoreSemantics: "human_probability" });
  check("Human score numeric string", { human_score: "100" }, { ai: 0, human: 1 });
  check("Human score percent string", { human_score: "100%" }, { ai: 0, human: 1 });
  check("AI probability numeric string", { ai_probability: "0.12" }, { ai: 0.12, human: 0.88 });
  check("Null is invalid", { score: null }, { ok: false, error_code: "invalid_provider_response" }, { rawScoreSemantics: "human_probability" });
  check("Empty string is invalid", { score: "" }, { ok: false, error_code: "invalid_provider_response" }, { rawScoreSemantics: "human_probability" });
  check("Nonnumeric string is invalid", { score: "unknown" }, { ok: false, error_code: "invalid_provider_response" }, { rawScoreSemantics: "human_probability" });
  check("NaN is invalid", { ai_probability: Number.NaN }, { ok: false, error_code: "invalid_provider_response" });
  check("Generic score is ambiguous without declared semantics", { score: 100 }, { ok: false, error_code: "ambiguous_provider_score" });
  check("Conflicting Human and AI values", { human_probability: 0.95, ai_probability: 0.80 }, { ok: false, error_code: "provider_score_conflict" });
  check("Complementary Human and AI values", { human_probability: 0.95, ai_probability: 0.05 }, { ai: 0.05, human: 0.95 });

  const bytes = Buffer.from("TRACE repeatability fixture", "utf8");
  const hashOne = sha256HexBuffer(bytes);
  const hashTwo = sha256HexBuffer(Buffer.from(bytes));
  assert.equal(hashOne, hashTwo, "Repeatability: identical bytes must hash identically");

  const firstRequestId = `repeat_a_${crypto.randomUUID().replace(/-/g, "")}`;
  const secondRequestId = `repeat_b_${crypto.randomUUID().replace(/-/g, "")}`;
  const repeatInput = { ...input, sha256: hashOne, server_sha256: hashOne, client_sha256: hashOne };
  const first = normalizeWinstonOriginResponse({ score: 100 }, {
    requestId: firstRequestId,
    input: repeatInput,
    rawScoreSemantics: "human_probability",
  });
  const second = normalizeWinstonOriginResponse({ score: 100 }, {
    requestId: secondRequestId,
    input: repeatInput,
    rawScoreSemantics: "human_probability",
  });
  assert.equal(first.ai_probability, second.ai_probability, "Repeatability: score interpretation changed");
  assert.equal(first.human_probability, second.human_probability, "Repeatability: Human interpretation changed");
  assert.equal(first.input.sha256, second.input.sha256, "Repeatability: input association changed");
  assert.notEqual(first.request_id, second.request_id, "Repeatability: request IDs must remain distinct");

  const staleA = normalizeWinstonOriginResponse({ ai_probability: 0.12 }, { requestId: "stale_request_a", input });
  const staleB = normalizeWinstonOriginResponse({ ai_probability: 0.80 }, { requestId: "stale_request_b", input });
  assert.equal(staleA.ai_probability, 0.12, "Stale-state test A");
  assert.equal(staleB.ai_probability, 0.80, "Stale-state test B");
  assert.notEqual(staleA.request_id, staleB.request_id, "Stale-state request association");
  results.push({ name: "Repeatability and request association", ok: true });

  return {
    ok: true,
    contract_version: TRACE_ORIGIN_CONTRACT_VERSION,
    tests_passed: results.length,
    results,
  };
}


function loadTraceGlyphEngineForTests({ reducedMotion = false } = {}) {
  const source = fs.readFileSync(glyphEnginePath, "utf8");
  const context = {
    console,
    matchMedia: () => ({ matches: reducedMotion }),
    requestAnimationFrame: () => { throw new Error("requestAnimationFrame must not run in reduced-motion test"); },
    cancelAnimationFrame: () => {},
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "trace-glyph-v1.js" });
  assert.ok(context.TraceGlyphV1, "TRACE glyph engine did not initialize");
  return context.TraceGlyphV1;
}

function runGlyphSpecificationTests() {
  const results = [];
  const pass = (name, fn) => { fn(); results.push({ name, ok: true }); };
  const api = loadTraceGlyphEngineForTests();
  const inputs = {
    creator_id: "creator-test",
    image_sha256: "1".repeat(64),
    profile_mindprint_hash: "2".repeat(64),
    badge_mindprint_hash: "3".repeat(64),
    proof_id: "4".repeat(64),
    glyph_seed: "5".repeat(64),
    ai_probability: 0.12,
    style: "hash_shards",
  };

  let spec;
  pass("Same proof inputs generate identical glyph_spec", () => {
    const first = api.createGlyphSpecification(inputs);
    const second = api.createGlyphSpecification({ ...inputs });
    assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
    spec = first;
  });

  const specimen = api.exampleSpecification();
  let svg;
  pass("Same glyph_spec generates identical normalized SVG geometry", () => {
    const first = api.renderGlyphFromSpecification(specimen, { mode: "badge", width: 568, height: 368 });
    const second = api.renderGlyphFromSpecification(JSON.parse(JSON.stringify(specimen)), { mode: "badge", width: 568, height: 368 });
    assert.equal(first, second);
    svg = first;
  });
  pass("primary_path_count 10 produces exactly ten primary structural paths", () => {
    assert.equal((svg.match(/class="trace-glyph-primary strand"/g) || []).length, 10);
  });
  pass("Glow duplicates do not affect primary path count", () => {
    assert.equal((svg.match(/class="trace-glyph-halo"/g) || []).length, 10);
    assert.equal((svg.match(/class="trace-glyph-primary strand"/g) || []).length, specimen.primary_path_count);
  });
  pass("Convergent flow activates the convergent motion model", () => {
    assert.match(svg, /data-motion-model="convergent_flow"/);
    assert.match(svg, /data-active-motion="convergent_flow"/);
  });
  pass("Layered complexity creates the documented three-layer stack", () => {
    assert.equal((svg.match(/data-glyph-layer=/g) || []).length, 3);
    assert.equal(specimen.layer_count, 3);
  });
  pass("Description text reads directly from glyph_spec", () => {
    const description = api.describeGlyphSpecification(specimen);
    assert.equal(description.structure, "10 woven paths");
    assert.equal(description.motion, "Convergent flow");
    assert.equal(description.complexity, "Layered");
    assert.equal(description.layer_detail, "3 rendering layers");
  });
  pass("Badge, profile, share and public Verify carry identical specification values", () => {
    const modes = ["badge", "avatar", "share", "public"];
    const encoded = modes.map((mode) => {
      const rendered = api.renderGlyphFromSpecification(spec, { mode });
      const match = rendered.match(/data-glyph-spec="([^"]+)"/);
      assert.ok(match, `${mode}: missing signed specification metadata`);
      return JSON.parse(decodeURIComponent(match[1]));
    });
    for (const value of encoded.slice(1)) assert.deepEqual(value, encoded[0]);
  });
  pass("Public verification uses the shared signed specification engine", () => {
    const page = verifyPageHtml("a".repeat(64));
    assert.match(page, /<script src="\/trace-glyph-v1\.js"><\/script>/);
    assert.match(page, /proof\?\.glyph_spec\?\.version===\"trace-glyph-v1\"/);
  });
  pass("Reduced motion disables animation without changing geometry", () => {
    const reducedApi = loadTraceGlyphEngineForTests({ reducedMotion: true });
    const before = reducedApi.renderGlyphFromSpecification(specimen, { mode: "badge" });
    const encoded = before.match(/data-glyph-spec="([^"]+)"/)[1];
    const fakeSvg = { dataset: { glyphSpec: encoded }, getAttribute: () => "0 0 142 92" };
    reducedApi.startGlyphMotion(fakeSvg);
    assert.equal(fakeSvg.dataset.motionReduced, "1");
    assert.equal(reducedApi.renderGlyphFromSpecification(specimen, { mode: "badge" }), before);
  });
  pass("Legacy proofs remain honestly labelled", () => {
    const description = api.describeGlyphSpecification(null);
    assert.equal(description.legacy, true);
    assert.match(description.summary, /Detailed formation metadata unavailable/);
  });
  pass("Registry boundary validates the signed glyph specification", () => {
    const valid = validateTraceGlyphSpecification(spec, { ai_probability: spec.visual_signal_influence.ai_probability });
    assert.equal(valid.ok, true);
    const invalid = validateTraceGlyphSpecification({ ...spec, primary_path_count: 23 }, { ai_probability: spec.visual_signal_influence.ai_probability });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.reason, "glyph_spec_primary_path_count_invalid");
  });

  const html = fs.readFileSync(indexPath, "utf8");
  pass("Demo and test badge code is no longer reachable", () => {
    for (const pattern of [/demoDraft/i, /pendingDemo/i, /renderDemo\s*\(/i, /demoResultMarkup/i, /demoSeed\s*\(/i, /Create demo badge/i, /Try a TRACE badge/i, /Unsigned preview/i, /trace-social-demo/i]) {
      assert.doesNotMatch(html, pattern);
    }
  });
  pass("Landing creation and authentication actions are limited to Log in and Sign up & create", () => {
    const actions = [...html.matchAll(/data-public-action="([^"]+)"/g)].map((match) => match[1]);
    assert.ok(actions.length >= 2);
    for (const action of actions) assert.ok(["login", "signup_create"].includes(action), `Unexpected public action: ${action}`);
    assert.match(html, />LOG IN</);
    assert.match(html, />SIGN UP &amp; CREATE</);
  });
  pass("Signup continues into the real Create flow", () => {
    assert.match(html, /state\.pendingCreate=true;openAuth\("signup"\)/);
    assert.match(html, /if\(state\.pendingCreate\)/);
    assert.match(html, /showCreate\(\)/);
  });
  pass("About TRACE is available to logged-out visitors", () => {
    assert.match(html, /id="trace_about"/);
    assert.match(html, /TRACE links a creator, a digital work and a moment in time/);
    assert.match(html, /What TRACE is for right now|Who TRACE is for right now/);
  });

  return { ok: true, contract_version: TRACE_GLYPH_SPEC_VERSION, tests_passed: results.length, results };
}

const PORT = process.env.PORT || 10000;
const ORIGIN_TEST_MODE = process.argv.includes("--test-origin");
const GLYPH_TEST_MODE = process.argv.includes("--test-glyph");

if (ORIGIN_TEST_MODE || GLYPH_TEST_MODE) {
  try {
    const origin = ORIGIN_TEST_MODE ? runOriginNormalizationTests() : null;
    const glyph = runGlyphSpecificationTests();
    const report = {
      ok: true,
      build: "trace-v50.4-glyph-spec-about-landing-cleanup",
      tests_passed: Number(origin?.tests_passed || 0) + Number(glyph.tests_passed || 0),
      origin,
      glyph,
    };
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 0;
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      build: "trace-v50.4-glyph-spec-about-landing-cleanup",
      error: error?.stack || String(error),
    }, null, 2));
    process.exitCode = 1;
  }
} else {
  app.listen(PORT, "0.0.0.0", () => {
  console.log(
    JSON.stringify({
      event: "trace_server_started",
      port: Number(PORT),
      global_daily_limit: CONFIG.globalDailyLimit,
      daily_limit_per_ip: CONFIG.dailyLimitPerIp,
      burst_limit_per_ip: CONFIG.burstLimitPerIp,
      max_concurrent_scans: CONFIG.maxConcurrentScans,
      max_image_mb: Math.floor(CONFIG.maxImageBytes / (1024 * 1024)),
      origin_contract_version: TRACE_ORIGIN_CONTRACT_VERSION,
      origin_score_semantics: TRACE_ORIGIN_SCORE_SEMANTICS,
      winston_image_version: WINSTON_IMAGE_VERSION,
      proof_registry_configured: PROOF_REGISTRY_CONFIGURED,
      proof_registry_url_source: SUPABASE_URL_SOURCE,
      proof_registry_key_source: SUPABASE_KEY_SOURCE,
      proof_registry_key_kind: SUPABASE_KEY_KIND,
      proof_publish_limit_per_ip: CONFIG.proofPublishLimitPerIp,
      proof_global_daily_limit: CONFIG.proofGlobalDailyLimit,
    })
  );
});
}
