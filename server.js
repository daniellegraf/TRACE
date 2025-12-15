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

// ✅ Winston MCP endpoint (det som docs visar)
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

// ✅ Kallar Winston via MCP (JSON-RPC) istället för REST
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

  // Winston kan returnera error i JSON-RPC även om HTTP är 200
  if (!resp.ok || data?.error) {
    return { ok: false, status: resp.status, data };
  }

  // MCP-resultatet ligger i data.result
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

    // spara filen på /tmp och exponera via /uploads så Winston kan nå url:en
    const filename = crypto.randomBytes(16).toString("hex") + ".jpg";
    const filePath = path.join(uploadDir, filename);
    fs.writeFileSync(filePath, req.file.buffer);

    const imageUrl = makePublicUrl(req, filename);

    const w = await callWinstonImage(imageUrl);

    // logga för att se exakt svar i Render Logs
    console.log("Winston response:", JSON.stringify(w, null, 2));

    if (!w.ok) {
      return res.status(502).json({
        ai_score: 0.5,
        label: `Winston error`,
        status: w.status,
        raw: w.data,
        image_url: imageUrl,
      });
    }

    // Försök plocka score från olika möjliga fält (MCP kan skilja sig)
    const candidate =
      w.data?.ai_probability ??
      w.data?.aiProbability ??
      w.data?.score ??
      w.data?.probability;

    const aiScore =
      typeof candidate === "number" && Number.isFinite(candidate)
        ? (candidate > 1 ? candidate / 100 : candidate)
        : 0.5;

    const label = aiScore >= 0.5 ? "AI" : "Human";

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
