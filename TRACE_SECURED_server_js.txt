import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import crypto from "crypto";
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
});

const WINSTON_TOKEN_RAW = process.env.WINSTONAI_API_KEY || "";
const WINSTON_TOKEN = WINSTON_TOKEN_RAW.trim().toLowerCase().startsWith("bearer ")
  ? WINSTON_TOKEN_RAW.trim().slice(7).trim()
  : WINSTON_TOKEN_RAW.trim();

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

app.get("/health", (req, res) => {
  resetDailyUsageIfNeeded();

  return res.json({
    ok: true,
    ts: Date.now(),
    frontend_found: fs.existsSync(indexPath),
    scanner_configured: Boolean(WINSTON_TOKEN),
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
    })
  );
});
