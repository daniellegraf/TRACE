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

const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

const WINSTON_API_KEY = process.env.WINSTON_API_KEY;
const WINSTON_MCP_URL = "https://api.gowinston.ai/mcp/v1";

const uploadDir = "/tmp/uploads";
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

app.use("/uploads", express.static(uploadDir));

app.get("/healthz", (req, res) => {
  res.json({ status: "ok" });
});

function sniffType(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return "png";
  return "unknown";
}

function getImageSize(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let i = 2;
    while (i < buffer.length) {
      if (buffer[i] === 0xff && buffer[i + 1] === 0xc0) {
        return {
          height: buffer.readUInt16BE(i + 5),
          width: buffer.readUInt16BE(i + 7),
        };
      }
      i++;
    }
  }
  if (buffer[0] === 0x89 && buffer[1] === 0x50) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }
  return null;
}

app.post("/detect-image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.json({ ai_score: 0.5, label: "No image" });
    }

    if (!WINSTON_API_KEY) {
      return res.json({ ai_score: 0.5, label: "Missing API key" });
    }

    const type = sniffType(req.file.buffer);
    const size = getImageSize(req.file.buffer);

    if (!size || size.width < 256 || size.height < 256) {
      return res.json({ ai_score: 0.5, label: "Image too small" });
    }

    const filename = `${Date.now()}.jpg`;
    const filePath = path.join(uploadDir, filename);
    fs.writeFileSync(filePath, req.file.buffer);

    const imageUrl = `https://${req.get("host")}/uploads/${filename}`;

    const rpcBody = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "ai-image-detection",
        arguments: { url: imageUrl },
      },
    };

    const winstonRes = await axios.post(
      WINSTON_MCP_URL,
      rpcBody,
      {
        headers: {
          Authorization: `Bearer ${WINSTON_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    return res.json({
      ai_score: winstonRes.data?.result?.output?.ai_score ?? 0.5,
      label: winstonRes.data?.result?.output?.label ?? "Unknown",
      raw: winstonRes.data,
    });
  } catch (err) {
    return res.json({
      ai_score: 0.5,
      label: "Winston failed",
      error: err.message,
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Server running on", PORT);
});
