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
app.use(express.json());

const upload = multer({
storage: multer.memoryStorage(),
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const indexPath = path.join(__dirname, "index.html");

const WINSTON_TOKEN_RAW =
process.env.WINSTONAI_API_KEY || "";

const WINSTON_TOKEN = WINSTON_TOKEN_RAW
.trim()
.toLowerCase()
.startsWith("bearer ")
? WINSTON_TOKEN_RAW.trim().slice(7).trim()
: WINSTON_TOKEN_RAW.trim();

const uploadDir = "/tmp/uploads";

if (!fs.existsSync(uploadDir)) {
fs.mkdirSync(uploadDir, {
recursive: true,
});
}

app.use(
"/uploads",
express.static(uploadDir, {
setHeaders(res) {
res.setHeader(
"Cache-Control",
"public, max-age=600"
);
},
})
);

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

app.get("/health", (req, res) => {
res.json({
ok: true,
ts: Date.now(),
has_token: !!WINSTON_TOKEN,
frontend_found: fs.existsSync(indexPath),
});
});

function pickExt(mime) {
const m = String(mime || "").toLowerCase();

if (m.includes("png")) return "png";
if (m.includes("webp")) return "webp";

if (
m.includes("jpeg") ||
m.includes("jpg")
) {
return "jpg";
}

return "jpg";
}

function publicBase(req) {
const host =
req.headers["x-forwarded-host"] ||
req.get("host");

return "https://${host}";
}

function makePublicUrl(req, filename) {
return "${publicBase( req )}/uploads/${encodeURIComponent(filename)}";
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

const number = parseFloat(cleaned);

if (!Number.isFinite(number)) {
  return null;
}

value = number;

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

function extractWinstonResult(obj) {
if (
!obj ||
typeof obj !== "object"
) {
return null;
}

return {
ai_probability: normalizeScore(
obj.ai_probability
),
human_probability: normalizeScore(
obj.human_probability
),
human_score: normalizeScore(obj.score),
raw: obj,
};
}

async function sleep(ms) {
await new Promise((resolve) =>
setTimeout(resolve, ms)
);
}

async function callWinstonImage(imageUrl) {
if (!WINSTON_TOKEN) {
return {
ok: false,
status: 500,
data: {
error:
"Missing WINSTONAI_API_KEY",
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
const response = await fetch(endpoint, {
method: "POST",
headers: {
"content-type":
"application/json",
accept: "application/json",
authorization: "Bearer ${WINSTON_TOKEN}",
},
body: JSON.stringify({
url: imageUrl,
version: "3",
}),
});

const data = await response
  .json()
  .catch(() => null);

if (response.ok) {
  return {
    ok: true,
    status: 200,
    data,
  };
}

const status = response.status || 0;

const retryable =
  status === 429 ||
  status === 500 ||
  status === 503;

if (
  retryable &&
  attempt < maxAttempts
) {
  await sleep(400 * attempt);
  continue;
}

return {
  ok: false,
  status,
  data,
};

}

return {
ok: false,
status: 0,
data: {
error: "Unknown error",
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

async function canServerFetch(url) {
try {
const response = await fetch(url, {
method: "GET",
});

return {
  ok: response.ok,
  status: response.status,
};

} catch (error) {
return {
ok: false,
status: 0,
error: String(
error?.message || error
),
};
}
}

app.post(
"/detect-image",
upload.single("image"),
async (req, res) => {
const requestId = crypto
.randomBytes(6)
.toString("hex");

let filePath = null;

try {
  if (!req.file) {
    return res.status(400).json({
      ok: false,
      ai_score: 0.5,
      label: "No image uploaded",
    });
  }

  const extension = pickExt(
    req.file.mimetype
  );

  const filename = `${crypto
    .randomBytes(16)
    .toString("hex")}.${extension}`;

  filePath = path.join(
    uploadDir,
    filename
  );

  fs.writeFileSync(
    filePath,
    req.file.buffer
  );

  const imageUrl = makePublicUrl(
    req,
    filename
  );

  const selfFetch =
    await canServerFetch(imageUrl);

  await sleep(60);

  const winstonResult =
    await callWinstonImage(imageUrl);

  console.log(
    `[${requestId}]`,
    "selfFetch=",
    selfFetch,
    "winston_status=",
    winstonResult.status,
    "url=",
    imageUrl
  );

  if (!winstonResult.ok) {
    const description =
      winstonResult.data
        ?.description ||
      winstonResult.data?.error ||
      winstonResult.data?.message ||
      null;

    const status =
      winstonResult.status >= 400 &&
      winstonResult.status <= 599
        ? winstonResult.status
        : 502;

    return res.status(status).json({
      ok: false,
      ai_score: 0.5,
      label: "Winston error",
      request_id: requestId,
      upstream_status:
        winstonResult.status,
      upstream_description:
        description,
      image_url: imageUrl,
      server_can_fetch: selfFetch,
      raw: winstonResult.data,
    });
  }

  const parsed =
    extractWinstonResult(
      winstonResult.data
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

  if (aiScore === null) {
    aiScore = 0.5;
  }

  const label =
    labelFromAiScore(aiScore);

  return res.json({
    ok: true,
    ai_score: aiScore,
    label,
    request_id: requestId,
    image_url: imageUrl,
    server_can_fetch: selfFetch,
    parsed: {
      ai_probability:
        parsed.ai_probability,
      human_probability:
        parsed.human_probability,
      human_score:
        parsed.human_score,
      version:
        winstonResult.data?.version,
      mime_type:
        winstonResult.data?.mime_type,
      credits_used:
        winstonResult.data
          ?.credits_used,
      credits_remaining:
        winstonResult.data
          ?.credits_remaining,
      ai_watermark_detected:
        winstonResult.data
          ?.ai_watermark_detected,
    },
    raw: winstonResult.data,
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
    error: error.message,
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
    }, 10 * 60 * 1000);
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
    const stats =
      fs.statSync(filePath);

    if (
      now - stats.mtimeMs >
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
"TRACE running on port ${PORT}"
);
}
);