// Offline phrase bank: used when there is no API key, no network, or Claude is slow.
// Picks replies by simple intent matching on what the partner said.

export const QUICK_PHRASES = ['Yes', 'No', 'Thank you', 'Wait, please', "I'm in pain", 'Please call someone'];

interface Rule {
  test: RegExp;
  replies: string[];
}

const RULES: Rule[] = [
  {
    test: /\b(how are you|how're you|how do you feel|feeling|you ok|you okay|alright)\b/i,
    replies: [
      "I'm doing okay, thanks.",
      'Not great today, honestly.',
      "I'm tired but fine.",
      'How are you?',
      'Can we talk later?',
    ],
  },
  {
    test: /\b(hungry|eat|food|lunch|dinner|breakfast|snack)\b/i,
    replies: [
      "Yes, I'm hungry.",
      "No thanks, I'm not hungry.",
      'What are the options?',
      'Something light, please.',
      'Maybe later.',
    ],
  },
  {
    test: /\b(drink|thirsty|water|tea|coffee|juice)\b/i,
    replies: [
      'Yes please, some water.',
      'A cup of tea would be lovely.',
      "No thanks, I'm fine.",
      'Could I have a straw?',
      'Maybe later.',
    ],
  },
  {
    test: /\b(pain|hurt|sore|ache|uncomfortable|comfortable)\b/i,
    replies: [
      "Yes, I'm in pain.",
      "No, I'm comfortable.",
      'Please help me change position.',
      "It's my back.",
      'Please call the nurse.',
    ],
  },
  {
    test: /\b(want|would you like|do you need|shall i|should i|can i get)\b/i,
    replies: ['Yes please.', 'No, thank you.', 'Not right now.', 'Can you show me the options?', 'Let me think.'],
  },
  {
    test: /\b(tv|television|music|film|movie|watch|listen|read)\b/i,
    replies: [
      'Yes, put something on.',
      "No, I'd like quiet.",
      'Something funny, please.',
      'Can you turn it up?',
      'Can you turn it down?',
    ],
  },
  {
    test: /\b(visit|visitor|family|friend|daughter|son|wife|husband|mum|dad)\b/i,
    replies: [
      "I'd love to see them.",
      'Not today, I am tired.',
      'When are they coming?',
      'Please tell them I said hello.',
      'That makes me happy.',
    ],
  },
  {
    test: /\?\s*$/,
    replies: ['Yes.', 'No.', "I'm not sure.", 'Can you explain that again?', 'Let me think about it.'],
  },
];

const GENERIC = ['Yes.', 'No.', 'Tell me more.', "I'm not sure.", 'Can you say that again?', 'Thank you.'];
const OPENERS = [
  'Hello! Good to see you.',
  'Can we talk?',
  "I'd like a drink, please.",
  'I need to change position.',
  'How was your day?',
  'Thank you for being here.',
];

export function fallbackReplies(partner: string): string[] {
  const text = partner.trim();
  if (!text) return OPENERS.slice(0, 5);
  for (const r of RULES) if (r.test.test(text)) return r.replies.slice(0, 5);
  return GENERIC.slice(0, 5);
}
