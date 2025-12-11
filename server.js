import express from "express";
import cors from "cors";
import multer from "multer";
import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

const app = express();

// Multer – vi kör allt i minnet, sen skriver vi till /tmp/uploads
const upload = multer({ storage: multer.memoryStorage() });

// CORS – tillåt din Neocities-sida + ev. andra origins vid test
app.use(cors({
  origin: [
    "https://signai.neocities.org",
    "https://www.signai.neocities.org",
    "http://localhost:5500",
    "http://localhost:3000",
    "http://localhost:5173"
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// Preflight för just /detect-image
app.options("/detect-image", cors());

app.use(express.json());

// Winston API-key från Render env
const WINSTON_API_KEY = process.env.WINSTON_API_KEY;

// OBS: Byt denna till EXAKT den endpoint Winston anger för bild-detektion.
// Exempel (du måste verifiera i deras docs): 
//   https://api.gowinston.ai/v2/image-detection
const WINSTON_IMAGE_ENDPOINT = "https://api.gowinston.ai/v2/image-detection";

// Katalog på Render där vi sparar temporära bilder
const uploadDir = "/tmp/uploads";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Dela ut uppladdade filer som statiska resurser
app.use("/uploads", express.static(uploadDir));

// Enkel health-check
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "signai-backend" });
});

/**
 * POST /detect-image
 * Tar emot "image" (fil) från frontend (FormData),
 * gör den till en publik URL, skickar URL:en till Winston AI och
 * returnerar ett förenklat svar till SignAi-frontenden.
 */
app.post("/detect-image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image uploaded" });
    }
    if (!WINSTON_API_KEY) {
      return res.status(500).json({ error: "WINSTON_API_KEY not set" });
    }

    // 1) Spara filen till /tmp/uploads
    const originalName = req.file.originalname || "upload.png";
    const ext = path.extname(originalName) || ".png";
    const filename = Date.now() + "-" + Math.random().toString(36).slice(2) + ext;
    const filePath = path.join(uploadDir, filename);

    fs.writeFileSync(filePath, req.file.buffer);

    // 2) Skapa en publik URL till bilden via Render
    //    t.ex. https://signai1-0ewa.onrender.com/uploads/filnamn.png
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const imageUrl = `${baseUrl}/uploads/${filename}`;

    console.log("Using image URL for Winston:", imageUrl);

    // 3) Skicka URL:en till Winston AI
    //    Anpassa body/headers exakt efter deras docs om det behövs.
    const winstonResponse = await axios.post(
      WINSTON_IMAGE_ENDPOINT,
      {
        url: imageUrl,
        // ev. extra parametrar:
        // version: "2",
        // language: "en"
      },
      {
        headers: {
          "Authorization": `Bearer ${WINSTON_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    );

    const data = winstonResponse.data;
    console.log("Winston raw response:", data);

    // --- Mappning av Winston -> SignAi-format ---
    // Antag att Winston ger "score" 0–100 där högre = mer human.
    let aiScore = null;
    if (typeof data.score === "number") {
      const humanScore = data.score / 100;   // 0–1, human-prob
      aiScore = 1 - humanScore;              // 0–1, AI-prob
    } else if (typeof data.ai_score === "number") {
      aiScore = data.ai_score;
    }

    let label = "Unknown";
    if (aiScore !== null) {
      if (aiScore <= 0.4)      label = "Human";
      else if (aiScore >= 0.7) label = "AI";
      else                     label = "Mixed";
    }

    const version = data.version || data.model || "winston-image";

    // Standardiserat svar till frontenden
    res.json({
      ai_score: aiScore,
      label,
      version,
      raw: data
    });

  } catch (err) {
    console.error("Winston error:", err.response?.status, err.response?.data || err.message);

    res.status(500).json({
      error: "Winston AI request failed",
      details: err.response?.data || err.message
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Backend running on port", PORT);
});
