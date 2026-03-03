import 'dotenv/config';
import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import interpretRouter from "./api/interpret.js";
import statsRouter from "./api/stats.js";
import relearnRouter from "./api/relearn.js";
import feedbackRouter from "./api/feedback.js";
import forgetRouter from "./api/forget.js";

const app = express(), PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientRoot = path.resolve(__dirname, "..", "client");
const clientDist = path.resolve(clientRoot, "dist");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.get("/api/health", (req, res) => res.json({ ok: true, message: "Server OK ✅" }));
app.use("/api/interpret", interpretRouter);
app.use("/api/stats", statsRouter);
app.use("/api/relearn", relearnRouter);
app.use("/api/feedback", feedbackRouter);
app.use("/api/forget", forgetRouter);

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  console.log("📦 Serving frontend from: client/dist");
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(clientDist, "index.html")));
} else {
  app.use(express.static(clientRoot));
  console.log("⚠️ client/dist does not exist. Serving fallback from: client/");
  app.get(/^(?!\/api).*/, (req, res) => {
    const indexPath = path.join(clientRoot, "index.html");
    if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
    return res.status(404).send("Frontend not found. If you're using Vite, run the client with `npm run dev` in the client folder.");
  });
}

app.use("/api", (req, res) => res.status(404).json({ ok: false, error: "API route not found" }));
app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));