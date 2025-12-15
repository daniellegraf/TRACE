import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import crypto from "crypto";

dotenv.config();

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

const WINSTON_API_KEY = process.env.WINSTONAI_API_KEY;

// ✅ Winston MCP endpoint
const WINSTON_MCP_URL = "https://api.gowinston.ai/mcp/v1";

// temp uploads
const uploadDir = "/tmp/uploads";
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// public images
app.use("/uploads", express.static(uploadDir));

app.get("/", (req, res) => {
  res.send("SignAi backend running");
});

function makePublicUrl(req, filename) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.get("host");
  return `${proto}://${host}/uploads/${filename}`;
}

/** Gör om Winston-värden till 0..1 eller null */
function normalizeScore(x) {
  if (x === null || x === undefined) return null;

  // String -> number, t.ex. "0.87", "87", "87%"
  if (typeof x === "string") {
    const cleaned = x.replace("%", "").trim();
    const n = parseFloat(cleaned);
    if (!Number.isFinite(n)) return null;
    x = n;
  }

  if (typeof x !== "number" || !Number.isFinite(x)) return null;

  // 0..100 -> 0..1
  if (x > 1 && x <= 100) return x / 100;

  // 0..1 ok
  if (x >= 0 && x <= 1) return x;

  return null;
}

/** Försök hitta en score i Winston-svaret (MCP kan variera) */
function extractScore(obj) {
  if (!obj || typeof obj !== "object") return null;

  // vanliga nycklar
  const candidates = [
    obj.ai_probability,
    obj.aiProbability,
    obj.probability,
    obj.score,
    obj.aiScore,
    obj.ai_score,
    obj.ai,
    obj.human_probability ? (1 - obj.human_probability) : null, // om de råkar ge "human_probability"
  ];

  for (const c of candidates) {
    const s = normalizeScore(c);
    if (s !== null) return s;
  }

  // ibland ligger resultatet nested
  if (obj.data) {
    const s = extractScore(obj.data);
    if (s !== null) return s;
  }
  if (obj.result) {
    const s = extractScore(obj.result);
    if (s !== null) return s;
  }
  if (obj.output) {
    const s = extractScore(obj.output);
    if (s !== null) return s;
  }

  return null;
}

// ✅ Kallar Winston via MCP (JSON-RPC)
async function callWinstonImage(imageUrl) {
  if (!WINSTON_API_KEY) {
    return {
      ok: false,
      status: 500,
      data: { error: "Missing WINSTONAI_API_KEY in Render Environment" },
    };
  }

  const resp = await fetch(WINSTON_MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "ai-image-detection",
        arguments: {
          url: imageUrl,
          apiKey: WINSTON_API_KEY,
        },
      },
    }),
  });

  const data = await resp.json().catch(() => null);

  if (!resp.ok || data?.error) {
    return { ok: false, status: resp.status, data };
  }

  return { ok: true, status: 200, data: data.result };
}

app.post("/detect-image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        ai_score: 0.5,
        label: "No image uploaded",
      });
    }

    const filename = crypto.randomBytes(16).toString("hex") + ".jpg";
    const filePath = path.join(uploadDir, filename);
    fs.writeFileSync(filePath, req.file.buffer);

    const imageUrl = makePublicUrl(req, filename);

    const w = await callWinstonImage(imageUrl);

    // logga exakt vad Winston svarar
    console.log("Winston response:", JSON.stringify(w, null, 2));

    if (!w.ok) {
      return res.status(502).json({
        ai_score: 0.5,
        label: "Winston error",
        status: w.status,
        raw: w.data,
        image_url: imageUrl,
      });
    }

    // ✅ plocka ut score robust
    const extracted = extractScore(w.data);

    // Om vi inte hittar score → var ärlig: Unknown (inte fejka 50%)
    if (extracted === null) {
      return res.json({
        ai_score: 0.5,
        label: "Unknown",
        image_url: imageUrl,
        raw: w.data,
        note: "Could not extract a numeric score from Winston response.",
      });
    }

    const aiScore = extracted;

    // bättre trösklar än “>=0.5 är AI”
    let label = "Mixed";
    if (aiScore >= 0.65) label = "AI";
    else if (aiScore <= 0.35) label = "Human";

    return res.json({
      ai_score: aiScore,
      label,
      image_url: imageUrl,
      raw: w.data,
    });
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({
      ai_score: 0.5,
      label: "Server error",
      error: err.message,
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Backend running on port", PORT);
});
