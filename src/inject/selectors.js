const AVATAR_THRESHOLD_PX = 40;
const OUTGOING_BUBBLE_OFFSET_PX = 16;
const THREAD_NAME_MAX_LENGTH = 48;
const COMPOSER_LOOKUP_DEPTH = 8;

const COMPOSER_INPUT_SELECTORS = [
  '[contenteditable="true"][role="textbox"]',
  '[aria-label*="Message"][contenteditable="true"]',
  '[aria-label*="Aa"][contenteditable="true"]'
];

const SEARCH_INPUT_SELECTORS = [
  'input[placeholder*="Search"]',
  'input[aria-label*="Search"]',
  '[contenteditable="true"][aria-label*="Search"]'
];

const SEARCHABLE_ROW_SELECTOR = '[role="row"], [role="listitem"], a[role="link"]';

const THREAD_HEADING_SELECTORS = [
  '[role="main"] h1',
  '[role="main"] h2',
  '[aria-label*="Conversation with"]',
  '[aria-label*="Messages in conversation with"]'
];

const PRESENCE_TEXT_PATTERNS = [
  /Active now/i,
  /Active \d+\s?[mhd]\s?ago/i,
  /Active \d+ minutes? ago/i,
  /Active \d+ hours? ago/i,
  /Active in chat/i,
  /Just opened/i
];

const REPLY_HINT_PATTERN = /\breplied to\b|\breplying to\b/i;

/* fb's React button often carries aria-label="Send a reaction" - the substring
   "reaction" also appears in reaction badges ("Like reaction"), so we match
   action labels exactly and exclude reaction badges separately rather than
   trying to filter via a single CSS aria-label*= selector. */
const ACTION_BUTTON_LABEL_PATTERNS = [
  /^send a reaction\b/i,
  /^add reaction\b/i,
  /^react\b/i,
  /^reply\b/i,
  /^forward\b/i,
  /^more\b/i,
  /^message actions\b/i,
  /^more actions\b/i
];

const REACTION_BADGE_LABEL_PATTERNS = [
  /^\d+\s/i,
  /^reactions\b/i,
  /^[a-z]+ reaction\b/i
];
