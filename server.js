import express from "express";
import cors from "cors";
import multer from "multer";
import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

// Katalog på Render där vi tillfälligt sparar bilder
const uploadDir = "/tmp/uploads";
fs.mkdirSync(uploadDir, { recursive: true });

// Gör uppladdade bilder publikt åtkomliga via /uploads
app.use("/uploads", express.static(uploadDir));

const WINSTON_API_KEY = process.env.WINSTON_API_KEY;

// RÄTT Winston-endpoint för bilddetektion
// enligt docs: https://api.gowinston.ai/v2/image-detection
const WINSTON_URL = "https://api.gowinston.ai/v2/image-detection";

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "signai-backend" });
});

app.post("/detect-image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image uploaded" });
    }
    if (!WINSTON_API_KEY) {
      return res.status(500).json({ error: "WINSTON_API_KEY not set" });
    }

    // 1) Spara bilden temporärt på /tmp/uploads
    const ext = path.extname(req.file.originalname || "") || ".png";
    const filename =
      Date.now() + "-" + Math.random().toString(36).slice(2) + ext;
    const filePath = path.join(uploadDir, filename);
    fs.writeFileSync(filePath, req.file.buffer);

    // 2) Bygg en publik URL till bilden på din Render-backend
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const imageUrl = `${baseUrl}/uploads/${filename}`;

    // 3) Skicka URL:en till Winston AI
    const response = await axios.post(
      WINSTON_URL,
      {
        url: imageUrl,
        version: "2" // eller "latest"
      },
      {
        headers: {
          Authorization: `Bearer ${WINSTON_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const data = response.data;
    console.log("Winston image response:", data);

    // Winston ger "score" 0–100 där 100 = Human, 0 = AI
    const humanScore =
      typeof data.score === "number" ? data.score / 100 : null;
    const aiScore = humanScore != null ? 1 - humanScore : null;

    let label;
    if (humanScore == null) {
      label = "Unknown";
    } else if (humanScore >= 0.6) {
      label = "Human";
    } else if (humanScore <= 0.4) {
      label = "AI";
    } else {
      label = "Mixed";
    }

    res.json({
      ai_score: aiScore,                // 0–1, högre = mer AI
      label,                            // "Human" / "AI" / "Mixed" / "Unknown"
      version: data.version || "v2",
      raw: data                         // hela Winston-svaret om du vill debugga
    });
  } catch (err) {
    console.error("Winston error:", err.response?.data || err.message);
    res.status(500).json({
      error: "Winston AI request failed",
      details: err.response?.data || err.message
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Backend running on port", PORT));
