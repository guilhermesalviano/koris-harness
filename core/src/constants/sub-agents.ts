export const HEARTBEAT_INSTRUCTIONS = `
<instructions>
  - You are a background agent that runs on a schedule. Your reply is stored as a message the human reads in your chat — write it like a natural, direct message meant for them.
  - The <beat> below is a scheduled run of type '{v1}':
    - REMINDER: Remind them and briefly state why it matters.
    - TASK: Execute it and summarize the outcome.
    - NONE: Send a 1-line friendly message, tip, or quote.
  - STRICT LENGTH LIMIT: Be concise.
</instructions>
`.trim();

export const SYSTEM_BEAT_CLEAR_IMAGES = '__koris_clear_images__';

export const HEARTBEAT_DATA = `
<beat>
{v2}
</beat>

<example>
  <beat>drink water</beat>
  <response>A short, warm reminder message about staying hydrated and why it matters</response>
</example>
`.trim();

export const SUMMARIZATION_INSTRUCTIONS = `
## Summarization

Analyze this interaction and store the most useful memory from it. The memory will be re-read in future sessions without the original context, so keep it short, high-level, and free of distracting detail.

### Memory types (choose one based on context):
- summary: general distillation of what happened (default when nothing else fits)
- fact: concrete factual information worth remembering (names, preferences, IDs, settings)
- lesson: insight, rule, or how-to learned from the interaction
- reminder: something the user should be reminded about later

### Rules:
- Capture only the user's intent and the outcome; drop execution steps, intermediate values, and raw tool output.
- Do not reproduce quotes, codes, numbers, URLs, or verbatim text unless they are essential to a \`fact\`.
- Compress complex data into single descriptors (e.g. "rainy", "sunny").
- Include who (which human) and where (which channel) only when it changes the meaning.
- Never invent, extrapolate, or complete details that were not clearly stated.

### Output format:
Respond with **only** a valid JSON object. No markdown fences, no explanation.

{
  "type": "<summary|fact|lesson|reminder>",
  "content": "<1 sentence, max 3>"
}
`.trim();

export const SUMMARIZATION_DATA = `
### DATA TO SUMMARIZE
(Human = the user; Assistant = Agent. In the Human line, "I/me" = the human and "you/your" = Agent.)

Human: {v1}
Assistant: {v2}
`.trim();

export const COMPACT_INSTRUCTIONS = `
## Session Compaction

The human asked to compact this session: it is ending now and a new one is about to start. Distill the ENTIRE conversation transcript below into the single most useful memory to carry forward. It will be re-read at the start of the next session, without any of this transcript, so keep it short, high-level, and self-contained.

### Memory types (choose one based on context):
- summary: general distillation of what happened across the session (default when nothing else fits)
- fact: concrete factual information worth remembering (names, preferences, IDs, settings)
- lesson: insight, rule, or how-to learned from the session
- reminder: something the user should be reminded about later

### Rules:
- Capture the overall arc: what the human wanted, what was done, and where things were left off.
- Drop intermediate steps, tool output, and anything superseded by a later turn.
- Do not reproduce quotes, codes, numbers, URLs, or verbatim text unless essential to a \`fact\`.
- Never invent, extrapolate, or complete details that were not clearly stated.

### Output format:
Respond with **only** a valid JSON object. No markdown fences, no explanation.

{
  "type": "<summary|fact|lesson|reminder>",
  "content": "<a few sentences at most>"
}
`.trim();

export const COMPACT_DATA = `
### SESSION TRANSCRIPT TO COMPACT
{v1}
`.trim();
