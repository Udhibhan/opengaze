// Claude-powered reply suggestions and sentence completion for eye-gaze AAC.
// Strict JSON via structured outputs, validated with zod; 2.5 s budget with local fallback; cached.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod/v4';
import { fallbackReplies } from '../src/lib/phrases';
import { MODEL_ID } from '../config/pricing';

export const MODEL = process.env.CLAUDE_MODEL || MODEL_ID;
const TIMEOUT_MS = Number(process.env.SUGGEST_TIMEOUT_MS || 2500);

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ maxRetries: 1, timeout: 15_000 }) : null;
export const aiEnabled = !!client;

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}
interface Turn {
  who: 'partner' | 'me';
  text: string;
}
export interface SuggestBody {
  partner?: string;
  history?: Turn[];
  name?: string;
  aboutMe?: string;
}
export interface CompleteBody extends SuggestBody {
  text?: string;
}

const RepliesSchema = z.object({ replies: z.array(z.string()) });
const CompletionsSchema = z.object({ completions: z.array(z.string()) });

const SUGGEST_SYSTEM = `You suggest replies for a non-speaking person who communicates with eye-gaze AAC (augmentative and alternative communication). They select one of your replies by looking at it, and it is spoken aloud in their voice. Every selection costs them effort, so good suggestions directly give them back their voice.

Return exactly 5 replies:
- First person, in the user's own voice, natural spoken English; each at most 12 words.
- Respond to what the conversation partner just said, using the recent conversation and the "about me" notes when relevant.
- Varied in intent, in this order: agree/yes, disagree/no, a question back, a feeling, a request or next step.
- Never give medical advice. Never invent facts about the user beyond the notes.
- On sensitive topics (health decisions, end of life, money, consent, relationships), keep replies neutral and always include an option like "I need time to think about that."
- If the partner said nothing yet, offer useful conversation openers.`;

const COMPLETE_SYSTEM = `You help a non-speaking person who types slowly with eye-gaze finish their sentence. Given what they have typed so far, return exactly 3 different likely completions. Each completion must be the full sentence, starting with exactly the typed text (fix only an obviously unfinished last word), first person, at most 16 words, plausible in the conversation. Never give medical advice or invent facts about the user.`;

function context(b: SuggestBody): string {
  const lines: string[] = [];
  if (b.name) lines.push(`User's name: ${b.name.slice(0, 60)}`);
  if (b.aboutMe) lines.push(`About me: ${b.aboutMe.slice(0, 600)}`);
  const hist = (b.history ?? []).slice(-8);
  if (hist.length) {
    lines.push('Recent conversation (oldest first):');
    for (const t of hist) lines.push(`${t.who === 'me' ? 'User' : 'Partner'}: ${String(t.text).slice(0, 300)}`);
  }
  return lines.join('\n');
}

// ---------- cache ----------
const cache = new Map<string, { value: string[]; usage: Usage }>();
function cacheGet(k: string) {
  const v = cache.get(k);
  if (v) {
    cache.delete(k);
    cache.set(k, v);
  }
  return v;
}
function cacheSet(k: string, v: { value: string[]; usage: Usage }) {
  cache.set(k, v);
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
}

// Usage from calls that finished after the time budget is still real cost: report it on the next response.
let lateUsage: Usage = { input_tokens: 0, output_tokens: 0 };
function takeLate(): Usage {
  const u = lateUsage;
  lateUsage = { input_tokens: 0, output_tokens: 0 };
  return u;
}
const addUsage = (a: Usage, b: Usage): Usage => ({
  input_tokens: a.input_tokens + b.input_tokens,
  output_tokens: a.output_tokens + b.output_tokens,
});

async function callClaude<T extends z.ZodType>(system: string, user: string, schema: T, maxTokens: number) {
  const stream = client!.messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
    thinking: { type: 'disabled' },
    output_config: { effort: 'low', format: zodOutputFormat(schema) },
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('refusal');
  const text = msg.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
  const parsed = schema.parse(JSON.parse(text)) as z.infer<T>;
  return { parsed, usage: { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens } };
}

function clean(list: string[], maxWords: number, n: number): string[] {
  const seen = new Set<string>();
  return list
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s && s.split(' ').length <= maxWords && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()))
    .slice(0, n);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms))]);
}

export async function suggest(b: SuggestBody) {
  const partner = String(b.partner ?? '').slice(0, 500);
  const fb = fallbackReplies(partner);
  if (!client)
    return { replies: fb, source: 'fallback' as const, usage: { input_tokens: 0, output_tokens: 0 }, model: MODEL };

  const user = `${context(b)}\n\nThe partner just said: "${partner || '(nothing yet)'}"\n\nSuggest 5 replies.`;
  const key = `s:${user}`;
  const hit = cacheGet(key);
  if (hit) return { replies: hit.value, source: 'cache' as const, usage: hit.usage, model: MODEL };

  const job = callClaude(SUGGEST_SYSTEM, user, RepliesSchema, 400).then((r) => {
    const replies = clean(r.parsed.replies, 14, 5);
    if (replies.length >= 3) cacheSet(key, { value: replies, usage: r.usage });
    return { replies, usage: r.usage };
  });
  try {
    const r = await withTimeout(job, TIMEOUT_MS);
    if (r === 'timeout') {
      job.then((late) => (lateUsage = addUsage(lateUsage, late.usage))).catch(() => {});
      return { replies: fb, source: 'fallback' as const, usage: takeLate(), model: MODEL, note: 'timeout' };
    }
    const replies = r.replies.length >= 3 ? r.replies : [...r.replies, ...fb].slice(0, 5);
    return { replies, source: 'claude' as const, usage: addUsage(r.usage, takeLate()), model: MODEL };
  } catch (e) {
    console.warn('[suggest] falling back:', e instanceof Error ? e.message : e);
    return { replies: fb, source: 'fallback' as const, usage: takeLate(), model: MODEL, note: 'error' };
  }
}

export async function complete(b: CompleteBody) {
  const text = String(b.text ?? '').slice(0, 400);
  if (!client || !text.trim())
    return { completions: [], source: 'fallback' as const, usage: { input_tokens: 0, output_tokens: 0 }, model: MODEL };
  const user = `${context(b)}\n\nThe partner last said: "${String(b.partner ?? '').slice(0, 300) || '(nothing)'}"\nThe user has typed so far: "${text}"\n\nGive 3 completions.`;
  const key = `c:${user}`;
  const hit = cacheGet(key);
  if (hit) return { completions: hit.value, source: 'cache' as const, usage: hit.usage, model: MODEL };
  const job = callClaude(COMPLETE_SYSTEM, user, CompletionsSchema, 300).then((r) => {
    const completions = clean(r.parsed.completions, 18, 3);
    if (completions.length) cacheSet(key, { value: completions, usage: r.usage });
    return { completions, usage: r.usage };
  });
  try {
    const r = await withTimeout(job, TIMEOUT_MS + 1000);
    if (r === 'timeout') {
      job.then((late) => (lateUsage = addUsage(lateUsage, late.usage))).catch(() => {});
      return { completions: [], source: 'fallback' as const, usage: takeLate(), model: MODEL, note: 'timeout' };
    }
    return {
      completions: r.completions,
      source: 'claude' as const,
      usage: addUsage(r.usage, takeLate()),
      model: MODEL,
    };
  } catch (e) {
    console.warn('[complete] falling back:', e instanceof Error ? e.message : e);
    return { completions: [], source: 'fallback' as const, usage: takeLate(), model: MODEL, note: 'error' };
  }
}
