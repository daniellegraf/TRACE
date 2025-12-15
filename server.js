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
const WINSTON_API_KEY = "l5AzEyygTOwxZTei0WnKhXaOxs8Sv5jmvS6OSCcO3873d0f3"; // direkt in kod
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

// Funktion för att skicka bild till Winston direkt
async function callWinstonAPI(imageBuffer) {
  const formData = new FormData();
  formData.append('image', new Blob([imageBuffer]), 'bild.jpg');

  const response = await axios.post('https://api.gowinston.ai/mcp/v1', formData, {
    headers: {
      ...formData.getHeaders(),
      'Authorization': `Bearer ${WINSTON_API_KEY}`,
    },
  });
  return response.data;
}

// Huvudroute för att ta emot bild och analysera
app.post("/detect-image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ai_score: 0.5, label: "Error: no image uploaded" });
    }

    // Skicka direkt till Winston API
    const winstonResponse = await callWinstonAPI(req.file.buffer);

    const data = winstonResponse;

    if (data?.error || data?.result?.isError) {
      return res.status(502).json({
        ai_score: 0.5,
        label: "Winston error",
        raw: { winston: data },
      });
    }

    const result = data?.result ?? data;
    const payload = result?.output ?? result?.content ?? result;

    let aiScore =
      typeof payload?.ai_score === "number"
        ? payload.ai_score
        : typeof payload?.ai_probability === "number"
        ? payload.ai_probability
        : typeof payload?.score === "number"
        ? payload.score
        : null;

    if (aiScore !== null && aiScore > 1) aiScore = aiScore / 100;
    if (aiScore === null) aiScore = 0.5;

    let label =
      payload?.label ??
      (typeof payload?.is_ai === "boolean" ? (payload.is_ai ? "AI" : "Human") : null) ??
      "Unknown";

    return res.json({
      ai_score: aiScore,
      label,
      raw: { winston: data },
    });
  } catch (err) {
    return res.status(500).json({
      ai_score: 0.5,
      label: "Server error",
      error: err.message,
    });
  }
});

const PORT = 10000; // fixad port
app.listen(PORT, () => console.log("Backend running på port", PORT));
