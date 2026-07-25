import type { ResolvedModel } from "../../src/model/registry";
import { runLocalStructuredAgent } from "./local-agent";
import { runMistralStructuredAgent } from "./mistral-agent";
import { runOpencodeStructuredAgent } from "./opencode-agent";
import {
  runStructuredAgent,
  type StructuredAgentOptions,
} from "./structured-agent";

export function runTaskAgent(
  assignment: ResolvedModel,
  options: StructuredAgentOptions
) {
  const taskOptions = { ...options, model: assignment.model };
  if (assignment.provider === "localLlama") {
    return runLocalStructuredAgent(taskOptions);
  }
  if (assignment.provider === "mistral") {
    return runMistralStructuredAgent(taskOptions);
  }
  if (assignment.provider === "opencode") {
    return runOpencodeStructuredAgent(taskOptions);
  }
  return runStructuredAgent(taskOptions);
}
