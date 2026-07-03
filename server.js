import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
app.use((req, res, next) => {
  res.setHeader("X-TRACE-Build", "trace-v42-login-create-no-vault-alert");
  next();
});
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "64kb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const indexPath = path.join(__dirname, "index.html");
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
  resultCacheMs: envInt("TRACE_RESULT_CACHE_MS", 24 * 60 * 60 * 1000, 60_000),
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
  "NEXT_PUBLIC_SUPABASE_URL",
  "PUBLIC_SUPABASE_URL",
]);

const supabaseKeyEnv = firstConfiguredEnv(
  [
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SERVICE_KEY",
    "SUPABASE_KEY",
    "SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ],
  { stripBearer: true }
);

const SUPABASE_URL = supabaseUrlEnv.value.replace(/\/+$/, "");
const SUPABASE_SECRET_KEY = supabaseKeyEnv.value;
const SUPABASE_URL_SOURCE = supabaseUrlEnv.source;
const SUPABASE_KEY_SOURCE = supabaseKeyEnv.source;

const SUPABASE_KEY_KIND =
  SUPABASE_SECRET_KEY.startsWith("sb_secret_")
    ? "secret"
    : SUPABASE_SECRET_KEY.startsWith("eyJ")
      ? "legacy_jwt"
      : SUPABASE_SECRET_KEY.startsWith("sb_publishable_")
        ? "publishable"
        : SUPABASE_SECRET_KEY
          ? "present_unclassified"
          : "missing";

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
          headers: {
            "X-Client-Info": "trace-render-proof-registry/1.0",
          },
        },
      }
    )
  : null;

const supabaseAuthKeyEnv = firstConfiguredEnv(
  [
    "SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ],
  { stripBearer: true }
);
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
const resultCache = new Map();
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

function normalizeScore(value) {
  if (value === null || value === undefined) return null;

  let candidate = value;

  if (typeof candidate === "string") {
    const cleaned = candidate.replace("%", "").trim();
    candidate = Number.parseFloat(cleaned);
  }

  if (typeof candidate !== "number" || !Number.isFinite(candidate)) return null;
  if (candidate > 1 && candidate <= 100) return candidate / 100;
  if (candidate >= 0 && candidate <= 1) return candidate;

  return null;
}

function extractWinstonResult(obj) {
  if (!obj || typeof obj !== "object") return null;

  return {
    ai_probability: normalizeScore(obj.ai_probability),
    human_probability: normalizeScore(obj.human_probability),
    human_score: normalizeScore(obj.score),
    version: obj.version ?? null,
    mime_type: obj.mime_type ?? null,
    credits_used: obj.credits_used ?? null,
    credits_remaining: obj.credits_remaining ?? null,
    ai_watermark_detected: obj.ai_watermark_detected ?? null,
  };
}

function labelFromAiScore(aiScore) {
  if (aiScore >= 0.65) return "AI";
  if (aiScore <= 0.35) return "Human";
  return "Mixed";
}

async function callWinstonImage(imageUrl) {
  if (!WINSTON_TOKEN) {
    return {
      ok: false,
      status: 500,
      data: { error: "Missing WINSTONAI_API_KEY" },
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    CONFIG.winstonTimeoutMs
  );

  try {
    /*
     * Deliberately one upstream call only.
     * Automatic retries could multiply paid API usage.
     */
    const response = await fetch(
      "https://api.gowinston.ai/v2/image-detection",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Bearer ${WINSTON_TOKEN}`,
        },
        body: JSON.stringify({
          url: imageUrl,
          version: "3",
        }),
        signal: controller.signal,
      }
    );

    const data = await response.json().catch(() => null);

    return {
      ok: response.ok,
      status: response.status || 0,
      data,
    };
  } catch (error) {
    const timedOut = error?.name === "AbortError";

    return {
      ok: false,
      status: timedOut ? 504 : 502,
      data: {
        error: timedOut
          ? "Winston request timed out"
          : "Winston request failed",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getCachedResult(hash) {
  const cached = resultCache.get(hash);

  if (!cached) return null;

  if (cached.expiresAt <= Date.now()) {
    resultCache.delete(hash);
    return null;
  }

  return cached.value;
}

function setCachedResult(hash, value) {
  if (resultCache.size >= 500) {
    const oldestKey = resultCache.keys().next().value;
    if (oldestKey) resultCache.delete(oldestKey);
  }

  resultCache.set(hash, {
    expiresAt: Date.now() + CONFIG.resultCacheMs,
    value,
  });
}

function scheduleDelete(filePath) {
  const timer = setTimeout(() => {
    fs.promises.unlink(filePath).catch(() => {});
  }, CONFIG.uploadedFileLifetimeMs);

  timer.unref?.();
}

async function performPaidScan(req, filePath, imageUrl, requestId) {
  const winston = await callWinstonImage(imageUrl);

  console.log(
    JSON.stringify({
      event: "trace_scan",
      request_id: requestId,
      status: winston.status,
      scans_today: globalScansToday,
      active_scans: activeScans,
      credits_remaining: winston.data?.credits_remaining ?? null,
    })
  );

  if (!winston.ok) {
    const description =
      winston.data?.description ||
      winston.data?.error ||
      winston.data?.message ||
      "Upstream scan failed";

    const status =
      winston.status === 429
        ? 429
        : winston.status === 504
          ? 504
          : 502;

    const error = new Error(description);
    error.httpStatus = status;
    error.upstreamStatus = winston.status;
    throw error;
  }

  const parsed = extractWinstonResult(winston.data) || {
    ai_probability: null,
    human_probability: null,
    human_score: null,
    version: null,
    mime_type: null,
    credits_used: null,
    credits_remaining: null,
    ai_watermark_detected: null,
  };

  let aiScore = parsed.ai_probability;

  if (aiScore === null && parsed.human_probability !== null) {
    aiScore = 1 - parsed.human_probability;
  }

  if (aiScore === null && parsed.human_score !== null) {
    aiScore = 1 - parsed.human_score;
  }

  if (aiScore === null) aiScore = 0.5;

  return {
    ok: true,
    ai_score: aiScore,
    label: labelFromAiScore(aiScore),
    request_id: requestId,
    parsed,
  };
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
@media(max-width:560px){.grid{grid-template-columns:1fr}.full{grid-column:auto}.card{padding:17px;border-radius:23px}.cta{padding:17px;border-radius:21px}.verifySection{padding:13px;border-radius:17px}}
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
<div id="seal" class="seal">…</div>
<h1 id="title">Checking proof</h1>
<p id="sub" class="sub">Loading the public cryptographic record.</p>
<div id="details" class="sections"></div>
</section>
<div class="footer">Public proof registry · Private creator keys are never uploaded</div>
</main>
<script>
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
  const o=origin||{};
  if(o.reason==="no_image"){
    return {label:"Not scanned",tone:"warn",score:"—"};
  }
  if(o.local_fallback||o.ok===false){
    return {label:"Unavailable",tone:"warn",score:"—"};
  }
  const score=Number(o.score_0_1);
  if(!Number.isFinite(score)){
    return {label:"Unavailable",tone:"warn",score:"—"};
  }
  const scoreText=(score*100).toFixed(1)+"%";
  if(score<=0.35){
    return {label:"Human-leaning",tone:"ok",score:scoreText};
  }
  if(score>=0.65){
    return {label:"AI-like",tone:"badText",score:scoreText};
  }
  return {label:"Mixed",tone:"info",score:scoreText};
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
      <h2>7. Visual analysis</h2>
      <div class="grid">
        <div class="item full"><span>Technical signal</span><b class="visualTag \${originInfo.tone}">\${esc(originInfo.label)}</b></div>
        <div class="item note full">This probabilistic result is one component of the TRACE proof and does not determine authorship by itself.</div>
      </div>
    </section>
    <section class="verifySection">
      <h2>8. AI-likeness estimate</h2>
      <div class="grid">
        <div class="item full"><span>Estimate</span><b>\${originInfo.score}</b></div>
        <div class="item note full">An estimate of visual similarity, not a statement that the artwork is a specific percentage AI-generated.</div>
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

const SOCIAL_BUILD = "trace-v42-login-create-no-vault-alert";
const SOCIAL_AUTH_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_AUTH_KEY);
const SOCIAL_ADMIN_CONFIGURED = Boolean(
  SUPABASE_URL &&
  SUPABASE_SECRET_KEY &&
  supabaseAdmin &&
  !["SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"].includes(SUPABASE_KEY_SOURCE)
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
      global: { headers: { "X-Client-Info": "trace-social-auth/1.0" } },
    })
  : null;

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
  if (!SOCIAL_ADMIN_CONFIGURED) {
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

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    const authError = new Error("Invalid or expired session");
    authError.httpStatus = 401;
    throw authError;
  }

  return { user: data.user, token };
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

function sendSocialError(res, error) {
  const status = Number(error?.httpStatus) || 500;
  const safeMessage = status >= 500 ? "Social action could not be completed" : error?.message || "Request failed";
  if (status >= 500) console.error("TRACE social error:", error);
  return res.status(status).json({ ok: false, error: safeMessage });
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
    output.push({
      ...work,
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
    social_enabled: SOCIAL_AUTH_CONFIGURED && SOCIAL_ADMIN_CONFIGURED,
    auth_enabled: SOCIAL_AUTH_CONFIGURED,
    account_creation_enabled: SOCIAL_AUTH_CONFIGURED,
    account_creation_mode: SOCIAL_ADMIN_CONFIGURED ? "server_admin" : (SOCIAL_AUTH_CONFIGURED ? "supabase_signup_trigger" : "disabled"),
    public_registry_enabled: PROOF_REGISTRY_CONFIGURED,
    diagnostics: {
      supabase_url_source: SUPABASE_URL_SOURCE,
      auth_key_source: SUPABASE_AUTH_KEY_SOURCE,
      server_key_source: SUPABASE_KEY_SOURCE,
      server_key_kind: SUPABASE_KEY_KIND,
    },
  });
});

app.post("/api/auth/signup", socialAuthLimit, async (req, res) => {
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
      const { data: existing } = await profileReader.from("profiles").select("id").ilike("handle", handle).maybeSingle();
      if (existing) return res.status(409).json({ ok: false, error: "That creator handle is already taken" });
    }

    if (SOCIAL_ADMIN_CONFIGURED) {
      const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { handle, display_name: displayName },
      });
      if (createError || !created?.user) {
        const rawCreate = String(createError?.message || "").toLowerCase();
        const createMessage = rawCreate.includes("already") || rawCreate.includes("registered") ? "An account already exists for this email. Use Log in." : (createError?.message || "Account could not be created");
        const error = new Error(createMessage);
        error.httpStatus = createError?.status || 400;
        throw error;
      }

      const userId = created.user.id;
      const { error: profileError } = await supabaseAdmin.from("profiles").upsert({
        id: userId,
        handle,
        display_name: displayName,
      }, { onConflict: "id" });
      if (profileError) {
        await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
        throw proofRegistryError("Creator profile could not be created", profileError, 400);
      }

      const { data: login, error: loginError } = await socialAuthClient.auth.signInWithPassword({ email, password });
      if (loginError || !login?.session) {
        const error = new Error(loginError?.message || "Account created, but automatic login failed");
        error.httpStatus = 400;
        throw error;
      }
      const profile = await getProfileById(userId);
      return res.status(201).json({ ok: true, session: login.session, profile });
    }

    // Fallback for projects that expose only the publishable/anon key to this service.
    // TRACE_v34_supabase_patch.sql installs a security-definer auth.users trigger
    // that creates the matching public.profiles row without exposing server secrets.
    const { data: signedUp, error: signUpError } = await socialAuthClient.auth.signUp({
      email,
      password,
      options: { data: { handle, display_name: displayName } },
    });
    if (signUpError || !signedUp?.user) {
      const rawSignup = String(signUpError?.message || "").toLowerCase();
      const signupMessage = rawSignup.includes("already") || rawSignup.includes("registered") ? "An account already exists for this email. Use Log in." : (signUpError?.message || "Account could not be created");
      const error = new Error(signupMessage);
      error.httpStatus = signUpError?.status || 400;
      throw error;
    }
    if (!signedUp.session) {
      return res.status(202).json({ ok: true, requires_email_confirmation: true, email });
    }
    const { data: profile, error: profileError } = await socialAuthClient
      .from("profiles")
      .select("*")
      .eq("id", signedUp.user.id)
      .maybeSingle();
    if (profileError || !profile) {
      const error = new Error("Account created, but the creator profile trigger is missing. Run TRACE_v34_supabase_patch.sql.");
      error.httpStatus = 500;
      throw error;
    }
    return res.status(201).json({ ok: true, session: signedUp.session, profile });
  } catch (error) {
    return sendSocialError(res, error);
  }
});

app.post("/api/auth/login", socialAuthLimit, async (req, res) => {
  try {
    if (!SOCIAL_AUTH_CONFIGURED) return socialUnavailable(res, "Login");
    const email = cleanText(req.body?.email, 254).toLowerCase();
    const password = String(req.body?.password || "");
    if (!validEmail(email) || !password) return res.status(400).json({ ok: false, error: "Enter the email and password used for this creator profile" });
    const { data, error } = await socialAuthClient.auth.signInWithPassword({ email, password });
    if (error || !data?.session || !data?.user) {
      const raw = String(error?.message || "").toLowerCase();
      const message = raw.includes("email not confirmed")
        ? "Confirm the Supabase email before logging in"
        : raw.includes("invalid login credentials")
          ? "Incorrect email or password"
          : (error?.message || "Login failed");
      const authError = new Error(message);
      authError.httpStatus = raw.includes("email not confirmed") ? 403 : 401;
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
    const { data, error } = await socialAuthClient.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data?.session) {
      const authError = new Error("Session could not be refreshed");
      authError.httpStatus = 401;
      throw authError;
    }
    return res.json({ ok: true, session: data.session });
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
    if (profile.creator_id && profile.creator_id !== creatorId) {
      const { count, error: countError } = await supabaseAdmin
        .from("works")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", user.id);
      if (countError) throw proofRegistryError("Creator proof count failed", countError);
      if (Number(count || 0) > 0) {
        return res.status(409).json({ ok: false, error: "This creator profile already has published signed proofs. Restore the original device key to preserve continuity." });
      }
      // Recovery path: a profile with no published works may replace a failed or abandoned local setup.
    }
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .update({ creator_id: creatorId })
      .eq("id", user.id)
      .select(publicProfileColumns())
      .single();
    if (error) throw proofRegistryError("Creator identity link failed", error, 400);
    return res.json({ ok: true, profile: data });
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
    build: "trace-v42-login-create-no-vault-alert",
    ts: Date.now(),
    frontend_found: fs.existsSync(indexPath),
    social_build: typeof SOCIAL_BUILD !== "undefined" ? SOCIAL_BUILD : null,
    social_enabled: typeof SOCIAL_AUTH_CONFIGURED !== "undefined" ? (SOCIAL_AUTH_CONFIGURED && SOCIAL_ADMIN_CONFIGURED) : false,
    supabase_auth_key_source: typeof SUPABASE_AUTH_KEY_SOURCE !== "undefined" ? SUPABASE_AUTH_KEY_SOURCE : "missing",
    scanner_configured: Boolean(WINSTON_TOKEN),
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
    cached_results: resultCache.size,
  });
});

app.post(
  "/detect-image",
  burstLimit,
  upload.single("image"),
  async (req, res) => {
    const requestId = crypto.randomBytes(6).toString("hex");
    const ip = clientIp(req);

    try {
      if (!req.file) {
        return res.status(400).json({
          ok: false,
          error: "No image uploaded",
          request_id: requestId,
        });
      }

      const detectedType = detectImageType(req.file.buffer);

      if (!detectedType || detectedType.mime !== req.file.mimetype) {
        return res.status(415).json({
          ok: false,
          error: "The uploaded file is not a valid JPEG, PNG or WebP image.",
          request_id: requestId,
        });
      }

      const imageHash = crypto
        .createHash("sha256")
        .update(req.file.buffer)
        .digest("hex");

      const cached = getCachedResult(imageHash);

      if (cached) {
        console.log(
          JSON.stringify({
            event: "trace_scan_cache_hit",
            request_id: requestId,
            image_hash_prefix: imageHash.slice(0, 12),
          })
        );

        return res.json({
          ...cached,
          request_id: requestId,
          cached: true,
        });
      }

      const existingScan = inflightScans.get(imageHash);

      if (existingScan) {
        const sharedResult = await existingScan;

        return res.json({
          ...sharedResult,
          request_id: requestId,
          cached: true,
          shared_inflight: true,
        });
      }

      const budget = checkAndReserveDailyBudget(ip);

      if (!budget.ok) {
        if (budget.retryAfterSeconds) {
          res.setHeader("Retry-After", String(budget.retryAfterSeconds));
        }

        return res.status(budget.status).json({
          ok: false,
          error: budget.error,
          request_id: requestId,
        });
      }

      const filename = `${crypto.randomBytes(20).toString("hex")}.${detectedType.ext}`;
      const filePath = path.join(uploadDir, filename);
      await fs.promises.writeFile(filePath, req.file.buffer);

      const imageUrl = makePublicUrl(req, filename);

      const scanPromise = performPaidScan(
        req,
        filePath,
        imageUrl,
        requestId
      );

      inflightScans.set(imageHash, scanPromise);

      try {
        const result = await scanPromise;
        setCachedResult(imageHash, result);

        return res.json({
          ...result,
          image_url: imageUrl,
          cached: false,
        });
      } finally {
        inflightScans.delete(imageHash);
        releaseConcurrencySlot();
        scheduleDelete(filePath);
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "trace_scan_error",
          request_id: requestId,
          message: String(error?.message || error),
        })
      );

      return res.status(error.httpStatus || 500).json({
        ok: false,
        error: error.message || "Server error",
        request_id: requestId,
        upstream_status: error.upstreamStatus || null,
      });
    }
  }
);

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        ok: false,
        error: `Image is too large. Maximum size is ${Math.floor(
          CONFIG.maxImageBytes / (1024 * 1024)
        )} MB.`,
      });
    }

    return res.status(400).json({
      ok: false,
      error: `Upload rejected: ${error.code}`,
    });
  }

  if (error?.code === "UNSUPPORTED_IMAGE_TYPE") {
    return res.status(415).json({
      ok: false,
      error: error.message,
    });
  }

  console.error("Unhandled server error:", error);
  return res.status(500).json({
    ok: false,
    error: "Server error",
  });
});

const maintenanceTimer = setInterval(() => {
  const now = Date.now();

  for (const [ip, bucket] of burstBuckets) {
    if (now >= bucket.resetAt) burstBuckets.delete(ip);
  }

  for (const [hash, cached] of resultCache) {
    if (now >= cached.expiresAt) resultCache.delete(hash);
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

const PORT = process.env.PORT || 10000;

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
      proof_registry_configured: PROOF_REGISTRY_CONFIGURED,
      proof_registry_url_source: SUPABASE_URL_SOURCE,
      proof_registry_key_source: SUPABASE_KEY_SOURCE,
      proof_registry_key_kind: SUPABASE_KEY_KIND,
      proof_publish_limit_per_ip: CONFIG.proofPublishLimitPerIp,
      proof_global_daily_limit: CONFIG.proofGlobalDailyLimit,
    })
  );
});
