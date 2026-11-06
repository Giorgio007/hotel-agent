---
name: run-eval
description: Evaluate the hotel agent. Use when asked to evaluate the app, run the eval, or check whether a change helped.
---

# Evaluate the hotel agent

1. Run `npm run eval`.
2. Compare the new file in `eval/results/` with the previous one (the files are named by date and time).
3. List the cases whose score changed, with the old score, the new score and the judge's sentence.
4. Suggest one change to the system prompt (`server/prompt.txt`) that could fix the weakest case. Don't make the change.
