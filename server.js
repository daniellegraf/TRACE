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

app.use(cors({ origin: true }));
app.options("*", cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

const WINSTON_API_KEY = process.env.WINSTON_API_KEY;

// ✅ RÄTT endpoint för AI image detection (Winston v2)
const WINSTON_IMAGE_ENDPOINT = "https://api.gowinston.ai/v2/image-detection";

const uploadDir = "/tmp/uploads";
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

app.use("/uploads", express.static(uploadDir));

app.get("/healthz", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/detect-image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ai_score: 0.5, label: "No image uploaded" });
    }

    if (!WINSTON_API_KEY) {
      return res.status(500).json({ ai_score: 0.5, label: "WINSTON_API_KEY missing" });
    }

    // Spara bilden temporärt så Winston kan hämta den via URL
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const filePath = path.join(uploadDir, filename);
    fs.writeFileSync(filePath, req.file.buffer);

    // Bygg publik URL (Render behöver ofta x-forwarded-proto)
    const proto = (req.headers["x-forwarded-proto"] || "https").toString().split(",")[0].trim();
    const imageUrl = `${proto}://${req.get("host")}/uploads/${filename}`;

    // Anropa Winston
    const winstonRes = await axios.post(
      WINSTON_IMAGE_ENDPOINT,
      {
        url: imageUrl,
        version: "2", // "2" eller "latest" enligt deras docs
      },
      {
        headers: {
          Authorization: `Bearer ${WINSTON_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    // Winston returnerar bl.a:
    // score (0-100 där 100 = human), ai_probability (0-1), human_probability (0-1)
    const data = winstonRes.data;

    // Jag returnerar ai_score som AI-sannolikhet 0-1 (för enkel UI)
    const aiProb =
      typeof data?.ai_probability === "number"
        ? data.ai_probability
        : (typeof data?.score === "number" ? (100 - data.score) / 100 : 0.5);

    // Label
    const label = aiProb >= 0.6 ? "AI" : aiProb <= 0.4 ? "Human" : "Unknown";

    return res.json({
      ai_score: aiProb,
      label,
      raw: data,
      debug: { imageUrl },
    });
  } catch (err) {
    return res.status(500).json({
      ai_score: 0.5,
      label: "Winston error",
      error: err.response?.data || err.message,
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Backend running on port", PORT));
