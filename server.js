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
app.disable("etag");

// Browser + filer
app.use(cors({ origin: true }));
app.options("*", cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// Winston MCP
const WINSTON_API_KEY = process.env.WINSTON_API_KEY;
const WINSTON_MCP_URL = "https://api.gowinston.ai/mcp/v1";

// Temp uploads (Render funkar med /tmp)
const uploadDir = "/tmp/uploads";
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Gör bilderna publikt nåbara för Winston (via URL)
app.use(
  "/uploads",
  express.static(uploadDir, {
    etag: false,
    lastModified: false,
    setHeaders(res) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache");
    },
  })
);

app.get("/healthz", (req, res) => res.json({ status: "ok" }));

function sniffType(buffer) {
  if (!buffer || buffer.length < 12) return "unknown";
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return "png";
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
  )
    return "webp";
  return "unknown";
}

function getImageSize(buffer) {
  // PNG
  if (buffer.length > 24 && buffer[0] === 0x89 && buffer[1] === 0x50) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), type: "png" };
  }
  // JPEG (basic SOF0/SOF2 scan)
  if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let i = 2;
    while (i < buffer.length) {
      if (buffer[i] !== 0xff) { i++; continue; }
      const marker = buffer[i + 1];
      const size = buffer.readUInt16BE(i + 2);
      if (marker === 0xc0 || marker === 0xc2) {
        return {
          height: buffer.readUInt16BE(i + 5),
          width: buffer.readUInt16BE(i + 7),
          type: "jpeg",
        };
      }
      i += 2 + size;
    }
  }
  return null;
}

async function selfFetchCheck(url) {
  try {
    const r = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 15000,
      headers: { "User-Agent": "SignAiSelfCheck/1.0", Accept: "image/*,*/*" },
      validateStatus: () => true,
    });
    return { ok: r.status >= 200 && r.status < 300, status: r.status, contentType: r.headers?.["content-type"] };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

app.post("/detect-image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ai_score: 0.5, label: "Error: no image uploaded" });
    }
    if (!WINSTON_API_KEY) {
      return res.status(500).json({ ai_score: 0.5, label: "Error: WINSTON_API_KEY missing" });
    }

    const realType = sniffType(req.file.buffer);
    const size = getImageSize(req.file.buffer);

    if (!["jpeg", "png", "webp"].includes(realType)) {
      return res.status(400).json({
        ai_score: 0.5,
        label: `Error: unsupported image type (${realType})`,
        raw: { detected: realType },
      });
    }

    if (size && (size.width < 256 || size.height < 256)) {
      return res.status(400).json({
        ai_score: 0.5,
        label: `Error: image too small (${size.width}x${size.height})`,
        raw: { size },
      });
    }

    // Spara fil
    const ext = realType === "png" ? ".png" : realType === "webp" ? ".webp" : ".jpg";
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    const filePath = path.join(uploadDir, filename);
    fs.writeFileSync(filePath, req.file.buffer);

    // Bygg publik URL (Render)
    const proto = (req.headers["x-forwarded-proto"] || "https").toString().split(",")[0].trim();
    const baseUrl = `${proto}://${req.get("host")}`;
    const imageUrl = `${baseUrl}/uploads/${encodeURIComponent(filename)}?v=${Date.now()}`;

    // Snabb koll att din server kan hämta bilden (bra debug)
    const selfFetch = await selfFetchCheck(imageUrl);

    // Winston MCP request (enligt deras docs: apiKey i arguments) :contentReference[oaicite:1]{index=1}
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
      },
      timeout: 30000,
      validateStatus: () => true,
    });

    const data = winstonRes.data;

    // Om Winston skickar fel
    if (data?.error || data?.result?.isError) {
      return res.status(502).json({
        ai_score: 0.5,
        label: "Winston error",
        raw: { winston: data, debug: { imageUrl, realType, size, selfFetch } },
      });
    }

    // Winston returnerar ofta text i result.content eller output
    const result = data?.result ?? data;
    const payload = result?.output ?? result?.content ?? result;

    // Försök hitta score i några vanliga fält (fallback = 0.5)
    let aiScore =
      typeof payload?.ai_score === "number" ? payload.ai_score :
      typeof payload?.ai_probability === "number" ? payload.ai_probability :
      typeof payload?.score === "number" ? payload.score :
      null;

    if (aiScore !== null && aiScore > 1) aiScore = aiScore / 100;
    if (aiScore === null) aiScore = 0.5;

    let label =
      payload?.label ??
      (typeof payload?.is_ai === "boolean" ? (payload.is_ai ? "AI" : "Human") : null) ??
      "Unknown";

    return res.json({
      ai_score: aiScore,
      label,
      raw: { winston: data, debug: { imageUrl, realType, size, selfFetch } },
    });
  } catch (err) {
    return res.status(500).json({
      ai_score: 0.5,
      label: "Server error",
      error: err.response?.data || err.message,
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Backend running on port", PORT));
