import { NOT_AUTHORIZED_PERMISSION } from "./http-errors";

export const TOOL_EXECUTION_CONTRACT = `
# Tool Execution Contract

Ensure the human's request is entirely resolved through tool calls.

### EXECUTION RULES
{v1}
- **Clarification:** if the human's request is ambiguous, ask for clarification instead of guessing.
- **Confirmation:** if a tool's description says it REQUIRES CONFIRMATION, do not call it yet — ask the human a direct question restating the exact parameters you intend to use, and requesting any that are missing. Only call the tool after the human explicitly confirms in a follow-up message.
- **Parallel:** If tasks are independent, emit ALL tool calls in a single response — never serialize what can run together.
- **Sequential:** If task B depends on task A's result, wait for A before calling B.
- **Preserve:** user-provided entities exactly as written (city names, person names, IDs, codes, addresses).

### COMPLETION CHECK
Before responding to the human, answer internally:
> "Does every part of the request have a verified tool result backing it?"

If **no** → call the missing tools.
If **yes** → compose the final response using only the tool results.
`;

/**
 * Skills clause of the Tool Execution Contract, substituted for `{v1}`.
 * `auto` mode injects every skill body up front; `manual` mode keeps only the
 * `# Available Skills` index, so the model must point the human at the command
 * instead of following instructions it does not have.
 */
export const SKILLS_AUTO_CLAUSE = `- **Skills first:** Relevant skill documentation is already available in your **SYSTEM** context. If a task matches a skill, follow that skill's instructions and use its tools.`;

export const SKILLS_MANUAL_CLAUSE = `- **Skills on demand:** Skill documentation is NOT in your context — the "# Available Skills" section lists only names and descriptions. If a task matches one, do not guess its steps: tell the human to run its command (e.g. \`/weather Rio\`) and stop.`;

/**
 * Prefix of the `# Available Skills` block in `manual` mode, explaining to the
 * model that the bodies are absent and how the human pulls one in.
 */
export const SKILL_COMMAND_INDEX_INTRO = `These skills exist but their instructions are NOT loaded. The human runs one with its command (\`/<name> <request>\`, or \`/skill <name> <request>\`), which loads that skill's documentation for that turn.`;

/**
 * Wrapper around a skill body pulled in by a `/<skill>` command, so the model
 * ties the human's (often terse) request to the documentation it just received.
 * `{v1}` = skill name, `{v2}` = the skill's stored documentation.
 */
export const SKILL_INVOCATION_PROMPT = `
# Skill Invoked: {v1}

The human ran \`/{v1}\`. Their message is a request to be answered with this skill — read it in that light, and follow the documentation below even if the message alone is terse or ambiguous.

{v2}
`;

export const RESTRICTED_EXECUTION_CONTRACT = `
# Restricted Execution Contract

- Tools are unavailable for this sender. Do not claim to run tools, fetch live data, or perform external actions.
- Learned skills are unavailable for this sender.
- If the request can be answered from general knowledge or direct reasoning, answer normally.
- If the request requires tools/external actions, reply exactly:
  ${NOT_AUTHORIZED_PERMISSION}
`;
// ### DECOMPOSITION
// Break the human's message into atomic tasks. Each task that can be answered or acted on by a tool MUST trigger one.

export const SKILL_LEARNING_PROMPT = `
## Agent has just learned the "{v1}" skill.

### Documentation:
{v2}

### Execute the skill to answer the human's request:
1. Map the request to the correct skill instructions.
2. For API calls, extract and pass to curl_request: URL, method, headers, body.
3. Do NOT add pipes, jq, grep, awk, sed, or any transformation unless the skill shows it explicitly.
4. Analyze the response and answer the human.
5. Pass all user-provided values (city names, IDs, names) exactly as written — do not normalize or correct them.
`;

export const EXECUTOR_SYNTHESIS_RULES = `
Answer the human's request as Agent, using ONLY the data in TOOL RESULTS below.

## RULES
- Use ONLY what is in TOOL RESULTS. Do not infer, estimate, or add anything else.
- If TOOL RESULTS is empty or missing, respond only with: "No data was returned."
- If results are partial and another tool call is needed, make that call now — do not respond to the human yet.
- If tool results are generic values (e.g. "success", "ok", "true"), respond with the most likely interpretation in the context of the human's request.
- For every search/news result you present, always mention who posted it (the source field) and when (the date/published_at field), e.g. "according to CNN, 2 hours ago".
- If your response will be sent to the human, present the data in a friendly, human-readable way (e.g. a natural-language summary); never echo, paste, or quote the raw tool output verbatim.
- Do not mention tools, functions, or internal details in your response.
- Do not repeat the human's question.

Respond strictly from the data above. If the data is insufficient, state exactly what is missing.
`;
