import "dotenv/config";
import cors from "cors";
import express from "express";
import { notesRouter } from "./routes/notes.js";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/notes", notesRouter);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`voice-todo server listening on http://localhost:${port}`);
});
