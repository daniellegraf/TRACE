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

const SUPABASE_URL = String(process.env.SUPABASE_URL || "")
  .trim()
  .replace(/\/+$/, "");
const SUPABASE_SECRET_KEY = String(
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  ""
).trim();

const SUPABASE_KEY_KIND =
  SUPABASE_SECRET_KEY.startsWith("sb_secret_")
    ? "secret"
    : SUPABASE_SECRET_KEY.startsWith("eyJ")
      ? "legacy_service_role"
      : SUPABASE_SECRET_KEY.startsWith("sb_publishable_")
        ? "publishable"
        : SUPABASE_SECRET_KEY
          ? "unknown"
          : "missing";

const PROOF_REGISTRY_CONFIGURED = Boolean(
  SUPABASE_URL &&
  SUPABASE_SECRET_KEY &&
  (SUPABASE_KEY_KIND === "secret" ||
   SUPABASE_KEY_KIND === "legacy_service_role")
);

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
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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
    const error = new Error(
      SUPABASE_KEY_KIND === "publishable"
        ? "SUPABASE_SECRET_KEY contains a publishable key, not a secret key"
        : "Proof registry is not configured"
    );
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
    const error = new Error(
      SUPABASE_KEY_KIND === "publishable"
        ? "SUPABASE_SECRET_KEY contains a publishable key, not a secret key"
        : "Proof registry is not configured"
    );
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
        error: "Proof registry is not configured",
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
.item{padding:14px;border-radius:17px;border:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.22);min-width:0}
.item span{display:block;color:var(--muted);font-size:12px;margin-bottom:5px}
.item b{display:block;overflow-wrap:anywhere;font-size:14px}
.full{grid-column:1/-1}
.ok{color:var(--green)}.info{color:var(--blue)}.badText{color:var(--red)}.warn{color:var(--amber)}
.footer{text-align:center;color:rgba(237,246,255,.42);font-size:12px;margin-top:15px}
.cta{margin-top:16px;padding:20px;border-radius:24px;border:1px solid rgba(52,215,255,.24);background:linear-gradient(135deg,rgba(52,215,255,.08),rgba(140,92,255,.08));box-shadow:0 18px 54px rgba(0,0,0,.30)}
.cta h2{margin:0 0 7px;font-size:clamp(21px,4.5vw,29px)}
.cta p{margin:0 0 15px;color:var(--muted);line-height:1.5}
.ctaButton{display:flex;align-items:center;justify-content:center;min-height:52px;border-radius:16px;text-decoration:none;font-weight:900;color:#02110c;background:linear-gradient(135deg,#35f0a3,#54dfff);box-shadow:0 12px 34px rgba(53,240,163,.18)}
.ctaButton:active{transform:translateY(1px)}
@media(max-width:560px){.grid{grid-template-columns:1fr}.full{grid-column:auto}.card{padding:17px;border-radius:23px}.cta{padding:17px;border-radius:21px}}
</style>
</head>
<body>
<main>
<div class="brand">TRACE</div>
<section class="card">
<div id="seal" class="seal">…</div>
<h1 id="title">Checking proof</h1>
<p id="sub" class="sub">Loading the public cryptographic record.</p>
<div id="details" class="grid"></div>
</section>
<section class="cta" aria-label="Create your TRACE artist profile">
  <h2>Create your artist profile</h2>
  <p>Start rendering TRACE badges for your own work and build a verifiable creator identity.</p>
  <a class="ctaButton" href="/?cta=create-profile">Create profile &amp; render badges</a>
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
    return {label:"No image scanned",tone:"warn",score:"—"};
  }
  if(o.local_fallback||o.ok===false){
    return {label:"Origin scan unavailable",tone:"warn",score:"—"};
  }
  const score=Number(o.score_0_1);
  if(!Number.isFinite(score)){
    return {label:"Origin scan unavailable",tone:"warn",score:"—"};
  }
  const scoreText=(score*100).toFixed(1)+"%";
  if(score<=0.35){
    return {label:"Human visual signal",tone:"ok",score:scoreText};
  }
  if(score>=0.65){
    return {label:"Strong AI-like visual signal",tone:"badText",score:scoreText};
  }
  return {label:"Mixed / inconclusive visual signal",tone:"info",score:scoreText};
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
  const valid=serverValid;
  const seal=document.getElementById("seal");
  seal.textContent=valid?"✓":"!";
  seal.className="seal "+(valid?"good":"bad");
  document.getElementById("title").textContent=valid
    ?"Valid TRACE signature"
    :"Invalid TRACE proof";

  if(valid){
    if(checks.browserVerified){
      document.getElementById("sub").textContent=checks.active
        ?"Signature and creator identity were verified by both TRACE and this device."
        :"The signature is valid, but the active window has expired.";
    }else{
      document.getElementById("sub").textContent=checks.active
        ?"The TRACE server verified the signature and creator identity. This device could not run the optional local crypto check."
        :"The TRACE server verified the signature, but the active window has expired.";
    }
  }else{
    document.getElementById("sub").textContent=
      "The cryptographic proof did not validate.";
  }

  const originInfo=originPresentation(proof.origin);
  const provenanceStrong=Boolean(
    proof.sig_b64 &&
    proof.creator_id &&
    proof.mindprint_profile?.textHash &&
    proof.mindprint_badge?.textHash
  );
  const created=Number.isFinite(Number(proof.ts))
    ? new Date(Number(proof.ts)).toLocaleString()
    : "Unknown";
  const registered=data.registered_at
    ? new Date(data.registered_at).toLocaleString()
    : "Unknown";
  const browserCheck=checks.browserVerified
    ?"Valid"
    :(checks.browserError?"Unavailable":"Not run");

  document.getElementById("details").innerHTML=\`
    <div class="item"><span>Signature</span><b class="\${serverValid?"ok":"badText"}">\${serverValid?"Valid · TRACE server":"Invalid"}</b></div>
    <div class="item"><span>Device crypto check</span><b class="\${checks.browserVerified?"ok":"warn"}">\${browserCheck}</b></div>
    <div class="item"><span>Active window</span><b class="\${checks.active?"ok":"warn"}">\${checks.active?"Active":"Expired"}</b></div>
    <div class="item full"><span>Badge ID</span><b>\${esc(proof.badge_key||proof.badge_id||PROOF_ID)}</b></div>
    <div class="item full"><span>Creator ID</span><b>\${esc(proof.creator_id||"—")}</b></div>
    <div class="item"><span>Visual origin signal</span><b class="\${originInfo.tone}">\${esc(originInfo.label)}</b></div>
    <div class="item"><span>AI-likeness score</span><b>\${originInfo.score}</b></div>
    <div class="item full"><span>Human provenance</span><b class="\${provenanceStrong?"ok":"warn"}">\${provenanceStrong?"Strong · signed creator + profile and badge mindprints":"Partial"}</b></div>
    <div class="item"><span>Created</span><b>\${esc(created)}</b></div>
    <div class="item"><span>Registered</span><b>\${esc(registered)}</b></div>
    <div class="item full"><span>Image hash</span><b>\${esc(proof.img_hash||"No image hash")}</b></div>
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
    build: "trace-qr-v19-public-verify-cta",
    ts: Date.now(),
    frontend_found: fs.existsSync(indexPath),
    scanner_configured: Boolean(WINSTON_TOKEN),
    proof_registry_configured: PROOF_REGISTRY_CONFIGURED,
    proof_registry_key_kind: SUPABASE_KEY_KIND,
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
      proof_publish_limit_per_ip: CONFIG.proofPublishLimitPerIp,
      proof_global_daily_limit: CONFIG.proofGlobalDailyLimit,
    })
  );
});
