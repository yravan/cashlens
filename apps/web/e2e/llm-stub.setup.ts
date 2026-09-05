import { LLM_STUB_PORT } from "../playwright.config";
import { startLlmStub } from "./llm-stub";

// With a real ANTHROPIC_API_KEY in the environment the app talks to the real
// provider and the stub stays out of the way.
export default async function globalSetup(): Promise<void | (() => Promise<void>)> {
  if (process.env.ANTHROPIC_API_KEY) return;
  return startLlmStub(LLM_STUB_PORT);
}
