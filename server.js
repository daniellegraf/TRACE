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

const upload = multer({ storage: multer.memoryStorage() });

const WINSTON_API_KEY = process.env.WINSTON_API_KEY;
const WINSTON_IMAGE_ENDPOINT = "https://api.gowinston.ai/v1/ai-image-detection";

const uploadDir = "/tmp/uploads";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

/* ===== VIKTIGT FÖR BROWSER ===== */
app.use(cors({ origin: true }));
app.options("*", cors());
app.use(express.json());

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
      return res.status(500).json({ ai_score: 0.5, label: "Missing API key" });
    }

    // spara bild
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const filePath = path.join(uploadDir, filename);
    fs.writeFileSync(filePath, req.file.buffer);

    const proto = req.headers["x-forwarded-proto"] || "https";
    const imageUrl = `${proto}://${req.get("host")}/uploads/${filename}`;

    // Winston REST API
    const winstonRes = await axios.post(
      WINSTON_IMAGE_ENDPOINT,
      { url: imageUrl },
      {
        headers: {
          Authorization: `Bearer ${WINSTON_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    return res.json({
      ai_score: winstonRes.data?.score ?? 0.5,
      label: winstonRes.data?.label ?? "Unknown",
      raw: winstonRes.data,
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
app.listen(PORT, () => {
  console.log("Server running on", PORT);
});
