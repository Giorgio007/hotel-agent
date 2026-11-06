// Eval: run every case in eval/cases.csv through the agent, then ask a judge model to grade it.
// log_request is stubbed, so nothing is written to data/requests.json.
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { parse } from "csv-parse/sync";
import { runAgent, POLICIES } from "../server/agent.js";

const JUDGE_MODEL = "claude-sonnet-5-5";
const client = new Anthropic();

const cases = parse(fs.readFileSync("eval/cases.csv", "utf8"), { columns: true });
const rubric = fs.readFileSync("eval/rubric.md", "utf8");

const gradeSchema = {
  type: "object",
  properties: {
    score: { type: "integer", enum: [1, 2, 3, 4, 5] },
    sentence: { type: "string" },
  },
  required: ["score", "sentence"],
  additionalProperties: false,
};

async function grade(c, out) {
  const toolResults = out.toolResults; // full results, not the 200-character trace
  const prompt = [
    rubric,
    "# Hotel policies\n\n" + POLICIES,
    `# Case\n\nGuest name: ${c.name}\nGuest e-mail: ${c.email}\nMessage: ${c.message}`,
    `# Expected behaviour\n\n${c.expected}`,
    "# Assistant's output\n\n" +
      `department: ${out.department}\nurgency: ${out.urgency}\nsummary: ${out.summary}\nstatus: ${out.status}\n` +
      (out.note ? `note: ${out.note}\n` : "") +
      `final text: ${out.reply}\n\ntool calls and results:\n` +
      (toolResults.map((t) => `${t.name}(${JSON.stringify(t.arguments)}) -> ${t.result}`).join("\n") || "(none)"),
  ].join("\n\n");

  const response = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 16000,
    output_config: { format: { type: "json_schema", schema: gradeSchema } },
    messages: [{ role: "user", content: prompt }],
  });
  const text = response.content.find((b) => b.type === "text")?.text || "{}";
  return JSON.parse(text);
}

async function runCase(c) {
  try {
    const out = await runAgent({ name: c.name, email: c.email, message: c.message }, { stubLog: true });
    const g = await grade(c, out);
    return { c, outcome: `${out.status}: ${out.reply}`, ...g };
  } catch (err) {
    return { c, outcome: "ERROR", score: "-", sentence: String(err.message || err) };
  }
}

const cell = (s) => String(s ?? "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|");

const results = await Promise.all(cases.map(runCase)); // all cases at the same time

const lines = [
  "| id | message | expected | outcome | score | sentence |",
  "|---|---|---|---|---|---|",
  ...results.map((r) =>
    `| ${cell(r.c.id)} | ${cell(r.c.message)} | ${cell(r.c.expected)} | ${cell(r.outcome)} | ${cell(r.score)} | ${cell(r.sentence)} |`
  ),
];
const scores = results.map((r) => r.score).filter((s) => typeof s === "number");
const average = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : "-";
lines.push("", `Average score: ${average} over ${scores.length} graded cases`);

const stamp = new Date().toISOString().slice(0, 19).replace("T", "-").replace(/:/g, "");
fs.mkdirSync("eval/results", { recursive: true });
const file = `eval/results/${stamp}.md`;
fs.writeFileSync(file, lines.join("\n") + "\n");
console.log(lines.join("\n"));
console.log(`\nSaved to ${file}`);
