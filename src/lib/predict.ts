// Local word prediction: prefix completion over a frequency list + bigram next-word suggestions,
// learning from what the user actually says during the session (in memory only).

const COMMON =
  `i you the to a and it is that not my me what do please can this be have for in on with yes no we are was so
  but like just get want need go know think thank thanks help time how about want good feel now here there they
  he she them him her your when where why who could would will some more one all out up down back home today
  tomorrow later water drink tea coffee food eat hungry thirsty tired pain hurt cold hot bed chair sit stand
  move turn help nurse doctor family friend love okay sorry hello goodbye well very really much little bit
  again maybe right left please call wait stop start look see hear say tell talk read watch music tv television
  happy sad bored comfortable uncomfortable bathroom toilet medicine glasses phone window door light open close
  lunch dinner breakfast morning afternoon evening night sleep wake fine great nice lovely day week thing things
  something nothing anything everything people person mum dad wife husband son daughter brother sister`
    .split(/\s+/)
    .filter(Boolean);

const SEED = [
  'i want to go home',
  'i need help please',
  'thank you very much',
  'can you help me',
  'i would like some water',
  'i would like a cup of tea',
  'i am tired',
  'i am in pain',
  'i love you',
  'how are you today',
  'can you call the nurse',
  'please turn on the tv',
  'i need to go to the bathroom',
  'i am feeling much better',
  'what time is it',
  'can we talk later',
  'i want to sit up',
  'please move my pillow',
  'i am cold',
  'i am hot',
  'please open the window',
  'the quick brown fox jumps over the lazy dog',
];

const unigram = new Map<string, number>();
const bigram = new Map<string, Map<string, number>>();

function addSentence(s: string, weight = 1) {
  const words = s
    .toLowerCase()
    .replace(/[^a-z' ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    unigram.set(words[i], (unigram.get(words[i]) ?? 0) + weight);
    if (i > 0) {
      const m = bigram.get(words[i - 1]) ?? new Map<string, number>();
      m.set(words[i], (m.get(words[i]) ?? 0) + weight);
      bigram.set(words[i - 1], m);
    }
  }
}

COMMON.forEach((w, i) => unigram.set(w, (unigram.get(w) ?? 0) + Math.max(1, 30 - i * 0.1)));
SEED.forEach((s) => addSentence(s, 3));

/** Learn from everything the user says this session (memory only). */
export function learn(sentence: string) {
  addSentence(sentence, 5);
}

/**
 * @param text the composed text so far
 * @returns up to n suggestions; if the last word is partial, completions of it, otherwise next words.
 */
export function predictWords(text: string, n = 4): string[] {
  const lower = text.toLowerCase();
  const endsWithSpace = /\s$/.test(lower) || lower.length === 0;
  const words = lower
    .replace(/[^a-z' ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const partial = endsWithSpace ? '' : (words.pop() ?? '');
  const prev = words[words.length - 1];

  const scores = new Map<string, number>();
  const bump = (w: string, s: number) => scores.set(w, (scores.get(w) ?? 0) + s);
  if (prev && bigram.has(prev)) for (const [w, c] of bigram.get(prev)!) if (w.startsWith(partial)) bump(w, c * 10);
  for (const [w, c] of unigram) if (w.startsWith(partial) && w !== partial) bump(w, c);

  return [...scores.entries()]
    .filter(([w]) => w !== partial)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([w]) => w);
}

/** Replaces the partial last word (if any) with `word` and adds a trailing space. */
export function applyWord(text: string, word: string): string {
  if (/\s$/.test(text) || !text) return `${text}${word} `;
  return text.replace(/\S+$/, word) + ' ';
}
