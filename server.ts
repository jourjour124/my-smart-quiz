import express from "express";
import compression from "compression";
import Database from "better-sqlite3";
import multer from "multer";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");
import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import * as XLSX from "xlsx";

dotenv.config();

const app = express();
app.use(compression());
const PORT = Number(process.env.PORT) || 3000;
const dbPath = process.env.DATABASE_PATH || "/app/data/quiz.db";
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  try {
    fs.mkdirSync(dbDir, { recursive: true });
  } catch (err) {
    console.warn(`Could not create directory ${dbDir}, using local fallback.`);
  }
}
const db = new Database(fs.existsSync(dbDir) ? dbPath : "quiz.db");

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    name TEXT,
    subject TEXT,
    path TEXT,
    type TEXT,
    uploadedAt INTEGER
  );
  CREATE TABLE IF NOT EXISTS scores (
    id TEXT PRIMARY KEY,
    subject TEXT,
    score INTEGER,
    total INTEGER,
    timestamp INTEGER
  );
  CREATE TABLE IF NOT EXISTS wrong_answers (
    id TEXT PRIMARY KEY,
    questionText TEXT,
    userAnswer TEXT,
    correctAnswer TEXT,
    subject TEXT,
    timestamp INTEGER
  );
`);

// Storage for uploads
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

app.use(express.json());

// API Routes
app.get("/api/files", (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const subject = req.query.subject;
    const files = subject 
      ? db.prepare("SELECT * FROM files WHERE subject = ?").all(subject)
      : db.prepare("SELECT * FROM files").all();
    res.json(files);
  } catch (error) {
    console.error("Fetch files error:", error);
    res.status(500).json({ error: "Failed to fetch files" });
  }
});

app.post("/api/files", (req, res) => {
  upload.array("files")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      console.error("Multer error:", err);
      return res.status(400).json({ error: `上传限制: ${err.message}` });
    } else if (err) {
      console.error("Unknown upload error:", err);
      return res.status(500).json({ error: "服务器上传失败" });
    }

    try {
      const subject = req.body.subject;
      const uploadedFiles = req.files as Express.Multer.File[];
      
      if (!uploadedFiles || uploadedFiles.length === 0) {
        return res.status(400).json({ error: "没有接收到文件" });
      }

      const stmt = db.prepare("INSERT INTO files (id, name, subject, path, type, uploadedAt) VALUES (?, ?, ?, ?, ?, ?)");
      
      const results = uploadedFiles.map(file => {
        const id = Math.random().toString(36).substr(2, 9);
        // Fix filename encoding (latin1 to utf8)
        const decodedName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        stmt.run(id, decodedName, subject, file.path, file.mimetype, Date.now());
        return { id, name: decodedName, subject, type: file.mimetype, uploadedAt: Date.now() };
      });
      
      res.json(results);
    } catch (error) {
      console.error("Database error during upload:", error);
      res.status(500).json({ error: "数据库保存失败" });
    }
  });
});

app.delete("/api/files/:id", (req, res) => {
  const file = db.prepare("SELECT * FROM files WHERE id = ?").get(req.params.id) as any;
  if (file && fs.existsSync(file.path)) {
    fs.unlinkSync(file.path);
  }
  db.prepare("DELETE FROM files WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

app.get("/api/stats", (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const scores = db.prepare("SELECT * FROM scores ORDER BY timestamp DESC").all();
    const wrongAnswers = db.prepare("SELECT * FROM wrong_answers ORDER BY timestamp DESC").all();
    
    // Get file counts per subject
    const fileCountsRaw = db.prepare("SELECT subject, COUNT(*) as count FROM files GROUP BY subject").all() as any[];
    const fileCounts: Record<string, number> = {};
    fileCountsRaw.forEach(row => {
      fileCounts[row.subject] = row.count;
    });

    res.json({ scores, wrongAnswers, fileCounts });
  } catch (error) {
    console.error("Stats error:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

app.post("/api/quiz/results", (req, res) => {
  const { subject, score, total, wrongAnswers } = req.body;
  const timestamp = Date.now();
  
  db.prepare("INSERT INTO scores (id, subject, score, total, timestamp) VALUES (?, ?, ?, ?, ?)")
    .run(Math.random().toString(36).substr(2, 9), subject, score, total, timestamp);
    
  const stmt = db.prepare("INSERT INTO wrong_answers (id, questionText, userAnswer, correctAnswer, subject, timestamp) VALUES (?, ?, ?, ?, ?, ?)");
  wrongAnswers.forEach((wa: any) => {
    stmt.run(Math.random().toString(36).substr(2, 9), wa.questionText, wa.userAnswer, wa.correctAnswer, wa.subject, timestamp);
  });
  
  res.json({ success: true });
});

async function extractTextFromFile(filePath: string, mimeType: string, originalName: string = ""): Promise<string> {
  try {
    if (!fs.existsSync(filePath)) return "";

    const lowerName = originalName.toLowerCase();

    if (mimeType === "application/pdf" || lowerName.endsWith('.pdf')) {
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdf(dataBuffer);
      return data.text;
    } else if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || lowerName.endsWith('.docx')) {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    } else if (mimeType === "application/msword" || lowerName.endsWith('.doc')) {
      const extractor = new WordExtractor();
      const extracted = await extractor.extract(filePath);
      return extracted.getBody();
    } else if (mimeType.startsWith("text/") || mimeType === "application/json" || lowerName.endsWith('.txt')) {
      return fs.readFileSync(filePath, "utf8");
    } else if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
      const workbook = XLSX.readFile(filePath);
      let text = "";
      workbook.SheetNames.forEach(sheetName => {
        const worksheet = workbook.Sheets[sheetName];
        text += XLSX.utils.sheet_to_txt(worksheet) + "\n";
      });
      return text;
    }
    return "";
  } catch (err) {
    console.error(`Error extracting text from ${filePath}:`, err);
    return "";
  }
}

app.post("/api/files/content", async (req, res) => {
  const { fileIds } = req.body;
  if (!fileIds || !Array.isArray(fileIds)) {
    return res.status(400).json({ error: "Invalid fileIds" });
  }

  try {
    const files = db.prepare(`SELECT * FROM files WHERE id IN (${fileIds.map(() => "?").join(",")})`).all(...fileIds) as any[];
    
    const parts = [];
    let textContext = "";
    let missingFiles = false;

    for (const f of files) {
      if (!fs.existsSync(f.path)) {
        missingFiles = true;
        // Clean up database
        db.prepare("DELETE FROM files WHERE id = ?").run(f.id);
        continue;
      }
      const lowerName = (f.name || "").toLowerCase();
      const mimeType = f.type;
      
      if (mimeType.startsWith("image/")) {
        const dataBuffer = fs.readFileSync(f.path);
        parts.push({
          inlineData: {
            mimeType: mimeType,
            data: dataBuffer.toString("base64")
          }
        });
      } else {
        const text = await extractTextFromFile(f.path, mimeType, f.name);
        if (text.trim().length > 0) {
          textContext += text + "\n\n";
        }
      }
    }
    
    if (missingFiles && parts.length === 0 && textContext.trim().length === 0) {
      return res.status(404).json({ error: "文件已丢失，请重新上传资料后再开始测验。" });
    }

    if (textContext.trim().length > 0) {
      parts.push({ text: textContext.substring(0, 30000) });
    }

    res.json({ parts });
  } catch (error) {
    console.error("Content extraction error:", error);
    res.status(500).json({ error: "Failed to extract content" });
  }
});

app.post("/api/generate-quiz", async (req, res) => {
  const { promptText, parts } = req.body;
  const apiKey = process.env.KIMI_API_KEY;

  if (!apiKey) {
    return res.status(400).json({ error: "Kimi API key is missing. Please check your environment settings." });
  }

  try {
    let combinedText = "";
    const imageParts = [];
    
    for (const part of parts) {
      if (part.text) {
        combinedText += part.text + "\n\n";
      } else if (part.inlineData) {
        imageParts.push({
          type: "image_url",
          image_url: {
            url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
          }
        });
      }
    }

    const messages: any[] = [
      {
        role: "system",
        content: "你是一个专业的命题专家。请严格按照用户的要求，根据提供的学习资料生成题目。输出必须是合法的 JSON 数组格式。不要包含任何 Markdown 标记（如 ```json），直接输出 JSON 字符串。如果资料内容不足，请尽力而为，不要编造资料中没有的事实。"
      }
    ];

    const userContent: any[] = [
      {
        type: "text",
        text: `【学习资料开始】\n${combinedText}\n【学习资料结束】\n\n${promptText}`
      },
      ...imageParts
    ];

    messages.push({
      role: "user",
      content: userContent
    });

    const response = await fetch("https://api.moonshot.cn/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: imageParts.length > 0 ? "moonshot-v1-8k-vision-preview" : "moonshot-v1-32k",
        messages: messages,
        temperature: 0.3
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("Kimi API error:", errorData);
      throw new Error(errorData.error?.message || "Failed to generate quiz from Kimi API");
    }

    const data = await response.json();
    let resultText = data.choices[0].message.content.trim();
    
    // Clean up potential markdown backticks
    if (resultText.startsWith("```json")) {
      resultText = resultText.replace(/^```json/, "").replace(/```$/, "").trim();
    } else if (resultText.startsWith("```")) {
      resultText = resultText.replace(/^```/, "").replace(/```$/, "").trim();
    }
    
    res.json({ text: resultText });
  } catch (error: any) {
    console.error("Generate quiz error:", error);
    res.status(500).json({ error: error.message || "Failed to generate quiz" });
  }
});

app.get("/api/test-kimi", async (req, res) => {
  const apiKey = process.env.KIMI_API_KEY;
  if (!apiKey || apiKey === "MY_KIMI_API_KEY") {
    return res.status(400).json({ status: "error", message: "未检测到 Kimi API Key，请在 Secrets 中配置 KIMI_API_KEY。" });
  }

  try {
    const response = await fetch("https://api.moonshot.cn/v1/models", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`
      }
    });

    if (response.ok) {
      res.json({ status: "success", message: "连接 Kimi 成功！后端服务器可以正常访问 Kimi 接口。" });
    } else {
      const error = await response.json();
      res.status(500).json({ status: "error", message: `连接 Kimi 失败: ${error.error?.message || response.statusText}` });
    }
  } catch (error: any) {
    res.status(500).json({ status: "error", message: `网络错误: ${error.message}` });
  }
});

// Vite middleware for development
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running! Access it at port ${PORT}`);
  });
}

startServer();