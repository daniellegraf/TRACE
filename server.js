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

/**
 * Winston AI (docs)
 * POST https://api.gowinston.ai/v2/image-detection
 * Authorization: Bearer <token>
 * Body: { url, version }
 */
const WINSTON_TOKEN = process.env.WINSTONAI_API_KEY;

// temp uploads (Render supports /tmp)
const uploadDir = "/tmp/uploads";
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Serve public images so Winston can fetch the URL
app.use(
  "/uploads",
  express.static(uploadDir, {
    setHeaders(res) {
      res.setHeader("Cache-Control", "public, max-age=600");
    },
  })
);

app.get("/", (req, res) => res.send("SignAi backend running"));
app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

function pickExt(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  return "jpg";
}

function makePublicUrl(req, filename) {
  // Force https for external accessibility (Winston fetches this)
  const host = req.get("host");
  return `https://${host}/uploads/${filename}`;
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

  if (x > 1 && x <= 100) return x / 100;
  if (x >= 0 && x <= 1) return x;

  return null;
}

function extractWinstonResult(obj) {
  if (!obj || typeof obj !== "object") return null;

  const ai = normalizeScore(obj.ai_probability);
  const human = normalizeScore(obj.human_probability);
  const humanScore = normalizeScore(obj.score); // docs: human score 0..100

  return {
    ai_probability: ai,
    human_probability: human,
    human_score: humanScore,
    raw: obj,
  };
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function callWinstonImage(imageUrl) {
  if (!WINSTON_TOKEN) {
    return {
      ok: false,
      status: 500,
      data: { error: "Missing WINSTONAI_API_KEY in environment" },
    };
  }

  const endpoint = "https://api.gowinston.ai/v2/image-detection";
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${WINSTON_TOKEN}`,
      },
      body: JSON.stringify({ url: imageUrl, version: "3" }),
    });

    const data = await resp.json().catch(() => null);

    if (resp.ok) return { ok: true, status: 200, data };

    const status = resp.status || 0;

    // Retry only on transient errors
    if ((status === 429 || status === 503 || status === 500) && attempt < maxAttempts) {
      await sleep(350 * attempt);
      continue;
    }

    return { ok: false, status, data };
  }

  return { ok: false, status: 0, data: { error: "Unknown error" } };
}

function labelFromAiScore(aiScore) {
  if (aiScore >= 0.65) return "AI";
  if (aiScore <= 0.35) return "Human";
  return "Mixed";
}

app.post("/detect-image", upload.single("image"), async (req, res) => {
  let filePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, ai_score: 0.5, label: "No image uploaded" });
    }

    const ext = pickExt(req.file.mimetype);
    const filename = crypto.randomBytes(16).toString("hex") + "." + ext;
    filePath = path.join(uploadDir, filename);

    fs.writeFileSync(filePath, req.file.buffer);

    const imageUrl = makePublicUrl(req, filename);

    const w = await callWinstonImage(imageUrl);
    console.log("Winston status:", w.status, "image:", imageUrl);

    if (!w.ok) {
      const desc =
        w.data?.description ||
        w.data?.error ||
        w.data?.message ||
        (typeof w.data === "string" ? w.data : null);

      return res.status(502).json({
        ok: false,
        ai_score: 0.5,
        label: "Winston error",
        upstream_status: w.status,
        upstream_description: desc || null,
        image_url: imageUrl,
        raw: w.data,
      });
    }

    const parsed = extractWinstonResult(w.data);

    let aiScore = parsed.ai_probability;

    if (aiScore === null && parsed.human_probability !== null) {
      aiScore = 1 - parsed.human_probability;
    }
    if (aiScore === null && parsed.human_score !== null) {
      aiScore = 1 - parsed.human_score;
    }
    if (aiScore === null) aiScore = 0.5;

    const label = labelFromAiScore(aiScore);

    return res.json({
      ok: true,
      ai_score: aiScore,
      label,
      image_url: imageUrl,
      parsed: {
        ai_probability: parsed.ai_probability,
        human_probability: parsed.human_probability,
        human_score: parsed.human_score,
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
    return res.status(500).json({ ok: false, ai_score: 0.5, label: "Server error", error: err.message });
  } finally {
    // Keep for 10 minutes then cleanup (Winston fetch can be slightly delayed)
    if (filePath) {
      setTimeout(() => {
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch {}
      }, 10 * 60 * 1000);
    }
  }
});

// Periodic cleanup so /tmp doesn't grow forever
setInterval(() => {
  try {
    const files = fs.readdirSync(uploadDir);
    const now = Date.now();
    for (const f of files) {
      const p = path.join(uploadDir, f);
      try {
        const st = fs.statSync(p);
        if (now - st.mtimeMs > 60 * 60 * 1000) fs.unlinkSync(p);
      } catch {}
    }
  } catch {}
}, 15 * 60 * 1000);

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Backend running on port", PORT);
});
