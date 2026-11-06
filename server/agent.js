// The hotel agent: one guest message in, one reply out.
// The model may call two tools: lookup_booking and log_request.
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { parse } from "csv-parse/sync";

const MODEL = "claude-sonnet-5-5";
const MAX_STEPS = 5;
const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

// System prompt = our instructions + the hotel policies (read once, at startup).
const instructions = fs.readFileSync("server/prompt.txt", "utf8");
const policies = fs.readFileSync("hotel-policies.md", "utf8");
export const SYSTEM_PROMPT = instructions + "\n\n# Hotel policies\n\n" + policies;
export const POLICIES = policies;

const tools = [
  {
    name: "log_request",
    description:
      "Records the request in the hotel's log. Call it exactly once per guest message, before your final answer.",
    input_schema: {
      type: "object",
      properties: {
        department: {
          type: "string",
          enum: [
            "Reservations",
            "Billing & Payments",
            "Front Desk & Guest Services",
            "Housekeeping & Maintenance",
            "Restaurant & Events",
            "Complaints & Feedback",
          ],
        },
        urgency: { type: "string", enum: ["high", "normal"] },
        summary: { type: "string" },
        status: { type: "string", enum: ["ANSWERED", "ESCALATED"] },
      },
      required: ["department", "urgency", "summary", "status"],
      additionalProperties: false,
    },
  },
  {
    name: "lookup_booking",
    description:
      "Returns the guest's own reservation: dates, room type, breakfast, rate and payment status, or that no booking was found. Use it only when the answer depends on the guest's booking.",
    // No input from the model: the backend uses the e-mail from the form.
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

// Find the booking whose e-mail equals the form's e-mail.
function lookupBooking(email) {
  const rows = parse(fs.readFileSync("data/bookings.csv", "utf8"), { columns: true });
  const row = rows.find((r) => r.email.toLowerCase() === email.trim().toLowerCase());
  return row ? { found: true, ...row } : { found: false };
}

// Run the agent loop for one guest message.
// options.stubLog = true (used by the eval): nothing is saved, the trace says "stubbed".
export async function runAgent({ name, email, message }, options = {}) {
  const trace = [];
  const toolResults = []; // full, uncut results (the eval's judge needs them)
  let logged = null; // the four fields from log_request
  let reply = "";

  const messages = [{ role: "user", content: `Guest name: ${name}\n\n${message}` }];

  for (let step = 1; step <= MAX_STEPS; step++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    const toolCalls = response.content.filter((b) => b.type === "tool_use");
    trace.push({
      type: "model",
      step,
      stop_reason: response.stop_reason,
      asked_tool: toolCalls.length > 0,
    });

    if (response.stop_reason !== "tool_use") {
      reply = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (response.stop_reason === "refusal" || !reply) {
        reply = "Thank you for your message. A member of staff will reply by e-mail.";
      }
      break;
    }

    // Run every tool the model asked for, then send all results back together.
    messages.push({ role: "assistant", content: response.content });
    const results = [];
    for (const call of toolCalls) {
      let result;
      if (call.name === "lookup_booking") {
        result = lookupBooking(email);
      } else if (call.name === "log_request") {
        if (logged) {
          result = "already logged";
        } else {
          logged = call.input;
          result = options.stubLog ? { ok: true, stubbed: true } : { ok: true };
        }
      } else {
        result = { error: "unknown tool" };
      }
      const text = typeof result === "string" ? result : JSON.stringify(result);
      trace.push({
        type: "tool",
        name: call.name,
        arguments: call.input,
        result: text.slice(0, 200) + (options.stubLog && call.name === "log_request" ? " (stubbed)" : ""),
      });
      toolResults.push({ name: call.name, arguments: call.input, result: text });
      results.push({ type: "tool_result", tool_use_id: call.id, content: text });
    }
    messages.push({ role: "user", content: results });
  }

  if (!reply) {
    reply = "Thank you for your message. A member of staff will reply by e-mail.";
  }
  trace.push({ type: "final", text: reply });

  // Guardrail: if the model never logged, still keep a row so staff see it.
  const fields = logged || { department: "", urgency: "normal", summary: "", status: "ESCALATED" };
  const note = logged ? undefined : "no log_request call";

  return { ...fields, reply, note, trace, toolResults };
}

// Append one finished request to data/requests.json.
export function saveRequest(form, result) {
  const file = "data/requests.json";
  let rows = [];
  try {
    rows = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    rows = [];
  }
  const row = {
    time: new Date().toISOString(),
    name: form.name,
    email: form.email,
    message: form.message,
    department: result.department,
    urgency: result.urgency,
    summary: result.summary,
    status: result.status,
    reply: result.reply,
    trace: result.trace,
  };
  if (result.note) row.note = result.note;
  rows.push(row);
  fs.writeFileSync(file, JSON.stringify(rows, null, 2));
}
