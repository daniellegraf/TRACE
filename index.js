import express from "express";
import cors from "cors";
import multer from "multer";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// 🔑 Viktigt: lägg in din Winston API key som ENV på Render (inte här i koden)
const WINSTON_API_KEY = process.env.WINSTON_API_KEY;

// Din Render-URL (typ https://signai-backend.onrender.com)
// Den sätter du också som ENV på Render sen
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;

// CORS så att din Neocities-sida får prata med backend
app.use(cors());

// Mapp där vi sparar uppladdade bilder tillfälligt
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const upload = multer({ dest: uploadDir });

// Enkel hälsokoll
app.get("/", (req, res) => {
  res.send("SignAi Winston backend is alive ✅");
});

// Servera uppladdade filer statiskt så Winston kan nå URL:en
app.use("/uploads", express.static(uploadDir));

/**
 * POST /analyze-image
 * Tar emot en bild från frontenden,
 * gör den till en publik URL,
 * skickar den till Winston,
 * och returnerar ett enkelt JSON-svar till SignAi.
 */
app.post("/analyze-image", upload.single("image"), async (req, res) => {
  try {
    if (!WINSTON_API_KEY) {
      return res.status(500).json({ error: "WINSTON_API_KEY is missing" });
    }
    if (!PUBLIC_BASE_URL) {
      return res.status(500).json({ error: "PUBLIC_BASE_URL is missing" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No image uploaded" });
    }

    // Bygg publik URL till bilden (Render hostar /uploads/…)
    const imageUrl = `${PUBLIC_BASE_URL}/uploads/${req.file.filename}`;

    // Anropa Winston AI image detection API
    const winstonRes = await fetch("https://api.gowinston.ai/v2/image-detection", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${WINSTON_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        url: imageUrl,
        version: "2"   // deras senaste modell
      })
    });

    if (!winstonRes.ok) {
      const text = await winstonRes.text();
      console.error("Winston error:", winstonRes.status, text);
      return res.status(500).json({ error: "Winston API error", status: winstonRes.status, body: text });
    }

    const data = await winstonRes.json();

    // Winston returnerar "score" 0–100 där 0 = AI, 100 = Human
    const humanScore = data.score; // 0–100
    const aiProb = data.ai_probability;    // 0–1
    const humanProb = data.human_probability; // 0–1

    // Gör om till vårt SignAi-format: 0–1 där 1 = väldigt AI-aktigt
    const aiScore01 = typeof aiProb === "number"
      ? aiProb
      : 1 - (humanScore / 100);

    let label = "Human-leaning";
    if (aiScore01 > 0.75) {
      label = "AI-leaning";
    } else if (aiScore01 > 0.45) {
      label = "Mixed / uncertain";
    }

    // Skicka tillbaks förenklat svar till din frontend
    res.json({
      ai_score: aiScore01,     // 0–1
      label,
      version: data.version || "winston-v2",
      raw: data
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// Render behöver veta vilken port som används
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Backend listening on port", PORT);
});
