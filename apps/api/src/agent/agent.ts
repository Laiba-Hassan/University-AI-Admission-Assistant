import type { Content, LlmProvider } from "./llm.js";
import { runTool, TOOL_DECLARATIONS, type ToolContext } from "./tools.js";

// Code-based agent loop (PRD Section 10): the model proposes tool calls, the backend executes them tenant-scoped, and
// the loop ends when the model returns text. The caller then runs the verifier before anything reaches the student.

export interface AgentRun {
  text: string;
  toolTrace: { name: string; args: Record<string, unknown>; status: unknown }[];
  facts: unknown[];      // lookup_facts results this turn (verifier evidence)
  chunks: string[];      // approved chunks retrieved this turn
  flags: { noData: boolean; lowRetrieval: boolean; handoff: boolean; leadSaved: boolean; clarification: boolean; toolError: boolean; usedFacts: boolean };
  inputTokens: number;
  outputTokens: number;
  model: string;
}

const MAX_STEPS = 6;

export async function runAgent(opts: {
  provider: LlmProvider; system: string; history: Content[]; userText: string; ctx: ToolContext; model?: string;
}): Promise<AgentRun> {
  const contents: Content[] = [...opts.history, { role: "user", parts: [{ text: opts.userText }] }];
  const run: AgentRun = {
    text: "", toolTrace: [], facts: [], chunks: [], inputTokens: 0, outputTokens: 0, model: opts.model ?? "",
    flags: { noData: false, lowRetrieval: false, handoff: false, leadSaved: false, clarification: false, toolError: false, usedFacts: false },
  };

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await opts.provider.generate({ system: opts.system, contents, tools: TOOL_DECLARATIONS, model: opts.model });
    run.inputTokens += res.inputTokens;
    run.outputTokens += res.outputTokens;
    run.model = res.model;
    contents.push(res.content);

    const calls = res.content.parts.flatMap((p) => ("functionCall" in p ? [p.functionCall] : []));
    if (!calls.length) {
      run.text = res.content.parts.flatMap((p) => ("text" in p ? [p.text] : [])).join("").trim();
      return run;
    }

    const responses = await Promise.all(calls.map(async (call) => {
      const out = await runTool(call.name, call.args ?? {}, opts.ctx);
      const status = (out.result as { status?: unknown }).status ?? (out.kind === "error" ? "error" : "ok");
      run.toolTrace.push({ name: call.name, args: call.args ?? {}, status });
      if (out.kind === "facts") {
        run.facts.push(out.result);
        run.flags.usedFacts = true;
        if (status === "no_data") run.flags.noData = true;
        if (status === "needs_clarification") run.flags.clarification = true;
      }
      if (out.kind === "knowledge") { run.chunks.push(...(out.chunks ?? [])); if (status === "no_relevant_results") run.flags.lowRetrieval = true; }
      if (out.kind === "handoff") run.flags.handoff = true;
      if (out.kind === "lead" && (status === "saved" || status === "already_on_file")) run.flags.leadSaved = true;
      if (out.kind === "error") run.flags.toolError = true;
      return { functionResponse: { name: call.name, response: out.result } };
    }));
    contents.push({ role: "user", parts: responses });
  }
  return run; // step limit reached with no text: caller falls back safely
}
