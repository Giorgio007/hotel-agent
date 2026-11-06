// Web server: the guest page, the staff page and two API routes.
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { runAgent, saveRequest } from "./agent.js";

const app = express();
app.use(express.json());
app.use(express.static("public"));

// Guest sends a message.
app.post("/api/message", async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim();
  const message = String(req.body.message || "").trim();
  if (!name || !email || !message) {
    return res.status(400).json({ error: "Please fill in all three fields." });
  }
  try {
    const result = await runAgent({ name, email, message });
    saveRequest({ name, email, message }, result);
    res.json({ reply: result.reply }); // the guest sees only the final text
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sorry, something went wrong. Please try again in a moment." });
  }
});

// Staff page reads every request, newest first.
app.get("/api/requests", (req, res) => {
  let rows = [];
  try {
    rows = JSON.parse(fs.readFileSync("data/requests.json", "utf8"));
  } catch {
    rows = [];
  }
  res.json(rows.reverse());
});

app.get("/staff", (req, res) => {
  res.sendFile(path.resolve("public/staff.html"));
});

app.listen(3000, () => {
  console.log("Hotel agent running at http://localhost:3000 (staff page: /staff)");
});
