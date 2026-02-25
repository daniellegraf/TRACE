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

// CORS: allow all (ok för din proxy). Du kan strama åt senare.
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

const WINSTON_API_KEY = process.env.WINSTONAI_API_KEY;

// Temp uploads (Render: /tmp är OK)
const uploadDir = "/tmp/uploads";
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Public route so Winston can fetch the image by URL
app.use("/uploads", express.static(uploadDir));

app.get("/", (req, res) => {
  res.send("SignAi backend running");
});

function makePublicUrl(req, filename) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.get("host");
  return `${proto}://${host}/uploads/${filename}`;
}

function normalizeScore(x) {
  if (x === null || x === undefined) return null;

  if (typeof x === "string") {
    const cleaned = x.replace("%", "").trim();
    const n = parseFloat(cleaned);
    if (!Number.isFinite(n)) return null;
    x = n;
  }

  if (typeof x !== "number" || !Number.isFinite(x)) return null;

  // if someone returns 0..100, convert to 0..1
  if (x > 1 && x <= 100) return x / 100;
  if (x >= 0 && x <= 1) return x;

  return null;
}

// Extract values from Winston response (direct fields)
function extractWinstonResult(obj) {
  if (!obj || typeof obj !== "object") return null;

  const ai = normalizeScore(obj.ai_probability);
  const human = normalizeScore(obj.human_probability);
  const humanScore = normalizeScore(obj.score); // docs say "score" is human score 0..100

  // if ai/human probability exists -> prefer that
  if (ai !== null || human !== null) {
    return {
      ai_probability: ai,
      human_probability: human,
      score: humanScore,
      raw: obj,
    };
  }

  // if only human score exists (0..100 or 0..1)
  if (humanScore !== null) {
    return {
      ai_probability: null,
      human_probability: null,
      score: humanScore,
      raw: obj,
    };
  }

  return null;
}

/**
 * Winston AI Image Detection (DOCS):
 * POST https://api.gowinston.ai/v2/image-detection
 * Headers: Authorization: Bearer <token>, Content-Type: application/json
 * Body: { url: "<public image url>", version: "3" }
 */
async function callWinstonImage(imageUrl) {
  if (!WINSTON_API_KEY) {
    return {
      ok: false,
      status: 500,
      data: { error: "Missing WINSTONAI_API_KEY in environment" },
    };
  }

  const resp = await fetch("https://api.gowinston.ai/v2/image-detection", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${WINSTON_API_KEY}`,
    },
    body: JSON.stringify({
      url: imageUrl,
      version: "3",
    }),
  });

  const data = await resp.json().catch(() => null);

  if (!resp.ok) {
    return { ok: false, status: resp.status, data };
  }
  return { ok: true, status: 200, data };
}

function pickExt(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  // default
  return "jpg";
}

app.post("/detect-image", upload.single("image"), async (req, res) => {
  let filePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({
        ok: false,
        ai_score: 0.5,
        label: "No image uploaded",
      });
    }

    const ext = pickExt(req.file.mimetype);
    const filename = crypto.randomBytes(16).toString("hex") + "." + ext;
    filePath = path.join(uploadDir, filename);

    fs.writeFileSync(filePath, req.file.buffer);

    const imageUrl = makePublicUrl(req, filename);

    const w = await callWinstonImage(imageUrl);

    // log minimal (Render logs)
    console.log("Winston status:", w.status, "image:", imageUrl);

    if (!w.ok) {
      return res.status(502).json({
        ok: false,
        ai_score: 0.5,
        label: "Winston error",
        status: w.status,
        image_url: imageUrl,
        raw: w.data,
      });
    }

    const parsed = extractWinstonResult(w.data);

    if (!parsed) {
      return res.json({
        ok: true,
        ai_score: 0.5,
        label: "Unknown",
        image_url: imageUrl,
        raw: w.data,
        note: "Could not parse Winston result (no numeric fields found).",
      });
    }

    // Compute aiScore:
    // Prefer ai_probability; else use 1-human_probability; else use (1 - humanScore)
    let aiScore = parsed.ai_probability;

    if (aiScore === null && parsed.human_probability !== null) {
      aiScore = 1 - parsed.human_probability;
    }

    if (aiScore === null && parsed.score !== null) {
      // score is "human score" (0..1 or 0..100 normalized to 0..1)
      aiScore = 1 - parsed.score;
    }

    if (aiScore === null) aiScore = 0.5;

    // Label thresholds
    let label = "Mixed";
    if (aiScore >= 0.65) label = "AI";
    else if (aiScore <= 0.35) label = "Human";

    return res.json({
      ok: true,
      ai_score: aiScore,
      label,
      image_url: imageUrl,
      parsed: {
        ai_probability: parsed.ai_probability,
        human_probability: parsed.human_probability,
        human_score: parsed.score, // normalized 0..1
        version: w.data?.version,
        mime_type: w.data?.mime_type,
        credits_used: w.data?.credits_used,
        credits_remaining: w.data?.credits_remaining,
        ai_watermark_detected: w.data?.ai_watermark_detected,
      },
      raw: w.data,
    });
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({
      ok: false,
      ai_score: 0.5,
      label: "Server error",
      error: err.message,
    });
  } finally {
    // Optional cleanup to avoid /tmp growing forever
    try {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {}
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Backend running on port", PORT);
});
