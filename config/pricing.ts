// API prices used for the live cost estimate on the Measure screen and in the README.
// Source: Anthropic pricing, https://platform.claude.com/docs/en/about-claude/pricing
// (Claude Haiku 5.5: $0.10 per million input tokens, $0.50 per million output tokens, prompts <= 100K tokens.)

export const MODEL_ID = 'claude-haiku-5-5';

export const PRICING_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
};

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING_USD_PER_MTOK[model] ?? PRICING_USD_PER_MTOK[MODEL_ID];
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
