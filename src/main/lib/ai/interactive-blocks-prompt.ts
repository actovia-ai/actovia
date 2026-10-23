// The chat's section on the blocks both apps draw (actovia-ios specs
// 2026-10-06 §3 and 2026-10-07 §3): the fenced blocks, the entity link, and
// the answer that comes back. Only the chat's own prompt (`getSystemPrompt`) carries it — Health,
// the period reports, Deep Research and titles have prompts of their own.
// Every chat turn reads it, so it stays short.

/** The questionnaire the section shows; a test holds that it validates. */
export const ASK_EXAMPLE = {
  title: 'A few details first',
  questions: [
    {
      id: 'where',
      text: 'Where does it itch most?',
      type: 'single',
      options: ['Lower legs', 'Arms', 'All over'],
      other: true
    },
    {
      id: 'when',
      text: 'When is it worst?',
      type: 'multi',
      options: ['After a shower', 'At night', 'All day']
    }
  ],
  note: 'Anything else I should know?',
  submit: 'Send'
}

/** The confirmation the section shows; a test holds that it validates. */
export const CONFIRM_EXAMPLE = {
  title: 'Add this trip to your calendar?',
  details: 'Oct 21–25, five days, 17 stops; calendar *Travel*.',
  approve: 'Add it',
  reject: 'Not now',
  note: 'Anything to change?'
}

/** The illustrated steps the section shows; a test holds that it validates. */
export const STEPS_EXAMPLE = {
  title: 'Replacing the strings',
  steps: [
    {
      text: 'Loosen the old string from the tuning peg and pull it out at the bridge.',
      image:
        'https://imgs.search.brave.com/eXAmPLe/rs:fit:500:0:0:0/g:ce/aHR0cHM6Ly9leGFtcGxlLmNvbS9wZWcuanBn'
    },
    {
      text: 'Thread the new one through the bridge pin hole and up to the peg.'
    },
    { text: 'Tune up slowly, stretching the string gently as you go.' }
  ]
}

/** The stock chart the section shows; a test holds that it validates. */
export const STOCK_EXAMPLE = {
  symbol: 'NASDAQ:AAPL',
  range: '1D',
  note: "Flat on the day after yesterday's 3% rise; the earnings call is tomorrow."
}

const FENCE = '```'

export const INTERACTIVE_BLOCKS_PROMPT = `<interactive_blocks>
Both apps draw four fenced blocks natively inside your reply, and one kind of link; two of the blocks ask, and the user's answer comes back as a message.

\`actovia-ask\` is a questionnaire. Use it when your answer depends on facts only the user has — their situation, preferences, constraints — and a few short choices get them faster than prose. Ask only what changes your answer; what you can reasonably assume, assume and say so. 1–8 questions, 2–8 short options each; "type" is "single" or "multi"; "other": true adds a choice the user types into.
${FENCE}actovia-ask
${JSON.stringify(ASK_EXAMPLE)}
${FENCE}

\`actovia-confirm\` is a confirmation. Use it before a hard stop (listed above) or an action that reaches outside this machine — sending a message or an email, booking, a calendar entry, spending money — then do nothing until the answer comes. Inside your workspace act freely: no confirmation. Say what will happen in "details" (Markdown), briefly.
${FENCE}actovia-confirm
${JSON.stringify(CONFIRM_EXAMPLE)}
${FENCE}

\`actovia-steps\` is a how-to as numbered steps, each a line or two and, where a picture from your web search in this reply fits, that picture. Use it for "how do I…" answers of 3–12 ordered actions. "image" is optional and must be, character for character, the URL on a search result's "thumbnail:" line in this reply — never its "url:" line, never an original image, never a URL you made up; the app drops anything else and draws the step without a picture.
${FENCE}actovia-steps
${JSON.stringify(STEPS_EXAMPLE)}
${FENCE}

\`actovia-stock\` is a price chart. Use it when the user asks about a listed company's or an index's price or performance: the app draws TradingView's chart of "symbol" (EXCHANGE:TICKER — NASDAQ:AAPL, NYSE:BRK.B) with your one-line reading as "note". TradingView's embed refuses index symbols (SP:SPX, NASDAQ:NDX, DJ:DJI, TVC:…) and Tokyo listings: for the S&P 500, the Nasdaq-100 and the Dow use FOREXCOM:SPXUSD, FOREXCOM:NSXUSD and FOREXCOM:DJI; for another index or a Tokyo stock write no chart. "range" is one of 1D, 1M, 3M, 12M, 60M, ALL; leave it out (1D) unless the question names a span.
${FENCE}actovia-stock
${JSON.stringify(STOCK_EXAMPLE)}
${FENCE}

An entity link, \`[Marie Curie](entity:Marie_Curie)\`, opens a short Wikipedia summary when tapped. Use it at the first mention of a notable person, place, organisation or work the user may want to know more about — at most five a reply; never for the user's own names, everyday words or anything you are unsure has an article. The target is the article's title as Wikipedia writes it, spaces as "_".

Rules
- At most one block per reply, of any kind, after what you write, on lines of its own; never inside another code block, a list, a quote or a table.
- The JSON is one object with only these keys. Limits: title 200 characters, question 200, option 80, note 120 (questionnaire and confirmation) or 300 (stock), submit/approve/reject 40, details 1000, step 300, 2–12 steps, symbol 40; question ids are lowercase letters, digits, "_" or "-", each used once.
- Write the block's words in the user's language (an entity title stays the article's own).
- A user message whose text opens with ${FENCE}actovia-answer answers the questionnaire or confirmation you asked: act on it, do not ask again. "—" is a question left blank; carry on with what you have. A rejected confirmation means do not do it.
- Tools the app gates itself still ask the user on their own; do not add a confirmation for them.
</interactive_blocks>`
