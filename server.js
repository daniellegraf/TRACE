import express from "express";
import cors from "cors";
import multer from "multer";
import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

const app = express();
app.set("trust proxy", 1);

// VIKTIGT: undvik 304/ETag-caching (Winston kan faila på sånt)
app.disable("etag");

const upload = multer({ storage: multer.memoryStorage() });

app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

app.options("/detect-image", cors());
app.use(express.json());

const WINSTON_API_KEY = process.env.WINSTON_API_KEY;
const WINSTON_MCP_URL = "https://api.gowinston.ai/mcp/v1";

const uploadDir = "/tmp/uploads";
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

app.use(
  "/uploads",
  express.static(uploadDir, {
    etag: false,
    lastModified: false,
    setHeaders(res) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      // vi vill hellre ha 200 varje gång än cache/304
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache");
    },
  })
);

app.get("/healthz", (req, res) => {
  res.json({ status: "ok", service: "signai-backend", path: "/healthz" });
});

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "signai-backend" });
});

function sniffType(buffer) {
  if (!buffer || buffer.length < 12) return { type: "unknown" };

  // PNG
  if (
    buffer.length > 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return { type: "png" };
  }

  // JPEG
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return { type: "jpeg" };
  }

  // WEBP
  if (
    buffer.length > 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { type: "webp" };
  }

  return { type: "unknown" };
}

function getImageSize(buffer) {
  // PNG
  if (buffer.length > 24 && buffer[0] === 0x89 && buffer[1] === 0x50) {
    const w = buffer.readUInt32BE(16);
    const h = buffer.readUInt32BE(20);
    return { width: w, height: h, type: "png" };
  }

  // JPEG
  if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let i = 2;
    while (i < buffer.length) {
      if (buffer[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buffer[i + 1];
      const size = buffer.readUInt16BE(i + 2);
      if (marker === 0xc0 || marker === 0xc2) {
        const h = buffer.readUInt16BE(i + 5);
        const w = buffer.readUInt16BE(i + 7);
        return { width: w, height: h, type: "jpeg" };
      }
      i += 2 + size;
    }
  }

  return null;
}

function firstBytesHex(buffer, n) {
  const len = Math.min(buffer.length, n);
  return Buffer.from(buffer.slice(0, len)).toString("hex");
}

async function selfFetchCheck(url) {
  try {
    const r = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 15000,
      headers: { "User-Agent": "SignAiSelfCheck/1.0", Accept: "image/*,*/*" },
      validateStatus: () => true,
    });

    const buf = Buffer.from(r.data || []);
    const sniff = sniffType(buf);

    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      contentType: r.headers?.["content-type"] || null,
      contentLength: r.headers?.["content-length"] || null,
      sniffedType: sniff.type,
      firstBytesHex: buf.length ? firstBytesHex(buf, 24) : null,
      bytes: buf.length,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

app.post("/detect-image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.json({
        ai_score: 0.5,
        label: "Error: no image uploaded",
        version: "signai-backend",
        raw: { error: "No image uploaded" },
      });
    }

    if (!WINSTON_API_KEY) {
      return res.json({
        ai_score: 0.5,
        label: "Error: WINSTON_API_KEY missing",
        version: "signai-backend",
        raw: { error: "WINSTON_API_KEY not set in environment" },
      });
    }

    const realType = sniffType(req.file.buffer).type;
    const size = getImageSize(req.file.buffer);

    if (realType !== "jpeg" && realType !== "png") {
      return res.json({
        ai_score: 0.5,
        label: "Error: uploaded file is not a PNG/JPEG image (detected: " + realType + ")",
        version: "signai-backend",
        raw: { error: "NOT_PNG_JPEG", detected: realType, size },
      });
    }

    if (size && (size.width < 256 || size.height < 256)) {
      return res.json({
        ai_score: 0.5,
        label: `Error: image too small (${size.width}x${size.height}). Winston requires >=256x256.`,
        version: "signai-backend",
        raw: { error: "IMAGE_TOO_SMALL", size, realType },
      });
    }

    const originalName = req.file.originalname || "image.jpg";
    const ext = path.extname(originalName) || (realType === "png" ? ".png" : ".jpg");
    const filename = Date.now() + "-" + Math.random().toString(36).slice(2) + ext;
    const filePath = path.join(uploadDir, filename);
    fs.writeFileSync(filePath, req.file.buffer);

    const proto = (req.headers["x-forwarded-proto"] || "https").toString().split(",")[0].trim();
    const baseUrl = `${proto}://${req.get("host")}`;

    // cache-bust så Winston inte riskerar 304/cached fetch
    const imageUrl = `${baseUrl}/uploads/${encodeURIComponent(filename)}?v=${Date.now()}`;

    const selfFetch = await selfFetchCheck(imageUrl);

    const rpcBody = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "ai-image-detection",
        arguments: {
          url: imageUrl,
          apiKey: WINSTON_API_KEY,
        },
      },
    };

    const winstonRes = await axios.post(WINSTON_MCP_URL, rpcBody, {
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        jsonrpc: "2.0",
      },
      timeout: 30000,
      validateStatus: () => true,
    });

    const data = winstonRes.data;

    // Winston text-fel
    let winstonText = null;
    try {
      const arr = data?.result?.content;
      if (Array.isArray(arr) && arr[0]?.type === "text") winstonText = arr[0]?.text;
    } catch (_) {}

    if (data?.error) {
      return res.json({
        ai_score: 0.5,
        label: "Winston error: " + data.error.message,
        version: "winston-ai-image-mcp",
        raw: { winston: data, debug: { imageUrl, realType, size, selfFetch } },
      });
    }

    // Om Winston bara skickar text-error, bubbla upp den
    if (winstonText && winstonText.toLowerCase().includes("there was an error")) {
      return res.json({
        ai_score: 0.5,
        label: "Winston error: " + winstonText,
        version: "winston-ai-image-mcp",
        raw: { winston: data, debug: { imageUrl, realType, size, selfFetch } },
      });
    }

    // Försök tolka "riktig" payload om den finns
    const result = data?.result ?? data;
    const payload = result?.output ?? result?.content ?? result;

    let aiScore = null;
    if (typeof payload?.ai_score === "number") aiScore = payload.ai_score;
    else if (typeof payload?.ai_probability === "number") aiScore = payload.ai_probability;
    else if (typeof payload?.score === "number") aiScore = payload.score;

    if (aiScore !== null && aiScore > 1) aiScore = aiScore / 100;

    let label = payload?.label ?? null;
    if (!label && typeof payload?.is_ai === "boolean") label = payload.is_ai ? "AI" : "Human";
    if (!label && typeof payload?.is_human === "boolean") label = payload.is_human ? "Human" : "AI";

    if (aiScore === null) aiScore = 0.5;
    if (!label) label = "Unknown";

    const version = payload?.version || payload?.model || "winston-ai-image-mcp";

    return res.json({
      ai_score: aiScore,
      label,
      version,
      raw: { winston: data, debug: { imageUrl, realType, size, selfFetch } },
    });
  } catch (err) {
    return res.json({
      ai_score: 0.5,
      label: "Error contacting Winston: " + (err.response?.status || err.code || "unknown"),
      version: "winston-ai-image-mcp",
      raw: err.response?.data || { message: err.message },
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Backend running on port", PORT));
