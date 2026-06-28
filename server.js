import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();

app.set("trust proxy", 1);
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const indexPath = path.join(__dirname, "index.html");

const WINSTON_TOKEN_RAW =
  process.env.WINSTONAI_API_KEY ||
  process.env.WINSTON_API_KEY ||
  process.env.WINSTON_TOKEN ||
  "";

const WINSTON_TOKEN = WINSTON_TOKEN_RAW
  .trim()
  .replace(/^bearer\s+/i, "")
  .trim();

const uploadDir = "/tmp/uploads";

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

app.use(
  "/uploads",
  express.static(uploadDir, {
    fallthrough: false,
    setHeaders(res) {
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.setHeader("X-Content-Type-Options", "nosniff");
    },
  })
);

app.get("/health", (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  res.json({
    ok: true,
    ts: Date.now(),
    has_token: Boolean(WINSTON_TOKEN),
    frontend_found: fs.existsSync(indexPath),
    service_url:
      process.env.RENDER_EXTERNAL_URL ||
      `${req.protocol}://${req.get("host")}`,
  });
});

app.get("/", (req, res) => {
  if (!fs.existsSync(indexPath)) {
    return res
      .status(500)
      .send("index.html not found");
  }

  res.setHeader("Cache-Control", "no-store");
  return res.sendFile(indexPath);
});

const publicAssets = new Set([
  "logo.png",
  "1.png.png",
]);

app.get("/:filename", (req, res, next) => {
  const filename = String(
    req.params.filename || ""
  );

  if (!publicAssets.has(filename)) {
    return next();
  }

  const assetPath = path.join(
    __dirname,
    filename
  );

  if (!fs.existsSync(assetPath)) {
    return res
      .status(404)
      .send("Asset not found");
  }

  return res.sendFile(assetPath);
});

function detectImageType(buffer, originalName, mimeType) {
  const mime = String(mimeType || "")
    .toLowerCase();

  const name = String(originalName || "")
    .toLowerCase();

  if (
    buffer?.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return {
      ext: "png",
      mime: "image/png",
    };
  }

  if (
    buffer?.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return {
      ext: "jpg",
      mime: "image/jpeg",
    };
  }

  if (
    buffer?.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return {
      ext: "webp",
      mime: "image/webp",
    };
  }

  if (
    mime.includes("png") ||
    name.endsWith(".png")
  ) {
    return {
      ext: "png",
      mime: "image/png",
    };
  }

  if (
    mime.includes("webp") ||
    name.endsWith(".webp")
  ) {
    return {
      ext: "webp",
      mime: "image/webp",
    };
  }

  if (
    mime.includes("jpeg") ||
    mime.includes("jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".jpg")
  ) {
    return {
      ext: "jpg",
      mime: "image/jpeg",
    };
  }

  return null;
}

function publicBase(req) {
  const renderUrl = String(
    process.env.RENDER_EXTERNAL_URL || ""
  )
    .trim()
    .replace(/\/+$/, "");

  if (renderUrl) {
    return renderUrl;
  }

  const forwardedHost = String(
    req.headers["x-forwarded-host"] || ""
  )
    .split(",")[0]
    .trim();

  const host =
    forwardedHost ||
    req.get("host");

  const forwardedProto = String(
    req.headers["x-forwarded-proto"] || ""
  )
    .split(",")[0]
    .trim();

  const protocol =
    forwardedProto ||
    req.protocol ||
    "https";

  return `${protocol}://${host}`;
}

function makePublicUrl(req, filename, requestId) {
  return (
    `${publicBase(req)}/uploads/` +
    `${encodeURIComponent(filename)}` +
    `?trace=${encodeURIComponent(requestId)}`
  );
}

function normalizeScore(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (typeof value === "string") {
    const cleaned = value
      .replace("%", "")
      .trim();

    const parsed = Number.parseFloat(cleaned);

    if (!Number.isFinite(parsed)) {
      return null;
    }

    value = parsed;
  }

  if (
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    return null;
  }

  if (value > 1 && value <= 100) {
    return value / 100;
  }

  if (value >= 0 && value <= 1) {
    return value;
  }

  return null;
}

function extractWinstonResult(data) {
  if (
    !data ||
    typeof data !== "object"
  ) {
    return null;
  }

  return {
    ai_probability: normalizeScore(
      data.ai_probability
    ),
    human_probability: normalizeScore(
      data.human_probability
    ),
    human_score: normalizeScore(
      data.score
    ),
    raw: data,
  };
}

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}

async function waitUntilPublic(imageUrl) {
  let last = {
    ok: false,
    status: 0,
    content_type: "",
  };

  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const response = await fetch(imageUrl, {
        method: "GET",
        headers: {
          "cache-control": "no-cache",
        },
      });

      const contentType =
        response.headers.get("content-type") ||
        "";

      last = {
        ok:
          response.ok &&
          contentType.startsWith("image/"),
        status: response.status,
        content_type: contentType,
      };

      if (last.ok) {
        return last;
      }
    } catch (error) {
      last = {
        ok: false,
        status: 0,
        content_type: "",
        error: String(
          error?.message || error
        ),
      };
    }

    await sleep(250 * attempt);
  }

  return last;
}

async function callWinstonImage(imageUrl) {
  if (!WINSTON_TOKEN) {
    return {
      ok: false,
      status: 500,
      data: {
        error:
          "Missing WINSTONAI_API_KEY in Render Environment",
      },
    };
  }

  const endpoint =
    "https://api.gowinston.ai/v2/image-detection";

  const maxAttempts = 3;

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt++
  ) {
    const controller =
      new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      65000
    );

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type":
            "application/json",
          accept: "application/json",
          authorization:
            `Bearer ${WINSTON_TOKEN}`,
        },
        body: JSON.stringify({
          url: imageUrl,
          version: "3",
        }),
        signal: controller.signal,
      });

      const responseText =
        await response.text();

      let data = null;

      try {
        data = responseText
          ? JSON.parse(responseText)
          : null;
      } catch {}

      if (response.ok) {
        return {
          ok: true,
          status: response.status,
          data,
        };
      }

      const status =
        response.status || 0;

      const retryable =
        [429, 500, 502, 503, 504]
          .includes(status);

      if (
        retryable &&
        attempt < maxAttempts
      ) {
        await sleep(700 * attempt);
        continue;
      }

      return {
        ok: false,
        status,
        data:
          data || {
            error:
              responseText ||
              `Winston HTTP ${status}`,
          },
      };
    } catch (error) {
      if (attempt < maxAttempts) {
        await sleep(700 * attempt);
        continue;
      }

      return {
        ok: false,
        status: 0,
        data: {
          error:
            error?.name === "AbortError"
              ? "Winston request timed out"
              : String(
                  error?.message || error
                ),
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    ok: false,
    status: 0,
    data: {
      error: "Unknown Winston error",
    },
  };
}

function labelFromAiScore(aiScore) {
  if (aiScore >= 0.65) {
    return "AI";
  }

  if (aiScore <= 0.35) {
    return "Human";
  }

  return "Mixed";
}

app.post(
  "/detect-image",
  upload.single("image"),
  async (req, res) => {
    const requestId = crypto
      .randomBytes(6)
      .toString("hex");

    let filePath = null;

    res.setHeader("Cache-Control", "no-store");

    try {
      if (!req.file) {
        return res.status(400).json({
          ok: false,
          ai_score: 0.5,
          label: "No image uploaded",
          request_id: requestId,
        });
      }

      const type = detectImageType(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );

      if (!type) {
        return res.status(415).json({
          ok: false,
          ai_score: 0.5,
          label: "Unsupported image type",
          request_id: requestId,
          error:
            "Use JPG, JPEG, PNG or WEBP.",
          received_mime:
            req.file.mimetype || "",
          received_name:
            req.file.originalname || "",
        });
      }

      const safeFilename =
        `${crypto
          .randomBytes(16)
          .toString("hex")}.${type.ext}`;

      filePath = path.join(
        uploadDir,
        safeFilename
      );

      fs.writeFileSync(
        filePath,
        req.file.buffer
      );

      const imageUrl = makePublicUrl(
        req,
        safeFilename,
        requestId
      );

      const publicCheck =
        await waitUntilPublic(imageUrl);

      if (!publicCheck.ok) {
        return res.status(502).json({
          ok: false,
          ai_score: 0.5,
          label:
            "Uploaded image is not publicly reachable",
          request_id: requestId,
          image_url: imageUrl,
          server_can_fetch: publicCheck,
          error:
            "Render could not serve the temporary image to Winston.",
        });
      }

      const winston =
        await callWinstonImage(imageUrl);

      console.log(
        `[${requestId}]`,
        JSON.stringify({
          publicCheck,
          winstonStatus:
            winston.status,
          imageUrl,
          inputMime:
            req.file.mimetype,
          detectedMime:
            type.mime,
        })
      );

      if (!winston.ok) {
        const description =
          winston.data?.description ||
          winston.data?.error ||
          winston.data?.message ||
          null;

        const status =
          winston.status >= 400 &&
          winston.status <= 599
            ? winston.status
            : 502;

        return res.status(status).json({
          ok: false,
          ai_score: 0.5,
          label: "Winston error",
          request_id: requestId,
          upstream_status:
            winston.status,
          upstream_description:
            description,
          image_url: imageUrl,
          server_can_fetch:
            publicCheck,
          raw: winston.data,
        });
      }

      const parsed =
        extractWinstonResult(
          winston.data
        ) || {
          ai_probability: null,
          human_probability: null,
          human_score: null,
        };

      let aiScore =
        parsed.ai_probability;

      if (
        aiScore === null &&
        parsed.human_probability !== null
      ) {
        aiScore =
          1 -
          parsed.human_probability;
      }

      if (
        aiScore === null &&
        parsed.human_score !== null
      ) {
        aiScore =
          1 - parsed.human_score;
      }

      if (
        aiScore === null ||
        !Number.isFinite(aiScore)
      ) {
        return res.status(502).json({
          ok: false,
          ai_score: 0.5,
          label:
            "Invalid Winston response",
          request_id: requestId,
          error:
            "Winston returned no usable score.",
          raw: winston.data,
        });
      }

      aiScore = Math.max(
        0,
        Math.min(1, aiScore)
      );

      return res.json({
        ok: true,
        ai_score: aiScore,
        label:
          labelFromAiScore(aiScore),
        request_id: requestId,
        image_url: imageUrl,
        server_can_fetch:
          publicCheck,
        parsed: {
          ai_probability:
            parsed.ai_probability,
          human_probability:
            parsed.human_probability,
          human_score:
            parsed.human_score,
          version:
            winston.data?.version,
          mime_type:
            winston.data?.mime_type,
          credits_used:
            winston.data
              ?.credits_used,
          credits_remaining:
            winston.data
              ?.credits_remaining,
          ai_watermark_detected:
            winston.data
              ?.ai_watermark_detected,
        },
        raw: winston.data,
      });
    } catch (error) {
      console.error(
        `[${requestId}] Server error:`,
        error
      );

      return res.status(500).json({
        ok: false,
        ai_score: 0.5,
        label: "Server error",
        request_id: requestId,
        error: String(
          error?.message || error
        ),
      });
    } finally {
      if (filePath) {
        setTimeout(() => {
          try {
            if (
              fs.existsSync(filePath)
            ) {
              fs.unlinkSync(filePath);
            }
          } catch {}
        }, 15 * 60 * 1000);
      }
    }
  }
);

setInterval(() => {
  try {
    const files =
      fs.readdirSync(uploadDir);

    const now = Date.now();

    for (const filename of files) {
      const filePath = path.join(
        uploadDir,
        filename
      );

      try {
        const stat =
          fs.statSync(filePath);

        if (
          now - stat.mtimeMs >
          60 * 60 * 1000
        ) {
          fs.unlinkSync(filePath);
        }
      } catch {}
    }
  } catch {}
}, 15 * 60 * 1000);

const PORT =
  process.env.PORT || 10000;

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `TRACE running on port ${PORT}`
    );

    console.log(
      `Winston token loaded: ${Boolean(
        WINSTON_TOKEN
      )}`
    );
  }
);
