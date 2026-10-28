// Bold and italics beside Chinese, Japanese and Korean text.
//
// CommonMark opens a `**` only when it is "left-flanking": a run followed by
// punctuation must also be preceded by whitespace or punctuation. English puts
// a space before a word; CJK does not, so `而是**"卖与不卖都没有依据"**——赢家`
// (a letter, then `**`, then a quote) never opened, and the answer showed its
// asterisks. Same for a close after punctuation and before a CJK letter
// (`**粗体。**后面`).
//
// The rule here is the one of the CJK-friendly amendment to CommonMark
// (github.com/tats-u/markdown-cjk-friendly): beside punctuation, a CJK
// character counts as a boundary the way whitespace does. Only for `*`: `_`
// keeps its stricter intraword rule. Full-width CJK punctuation is CJK too:
// `**再平衡。**2018` closes after the `。` though a digit follows, and
// `2018**「引号」**` opens before the `「`. Latin text is unaffected — `a**"x"**b`
// stays literal, as CommonMark has it — and code is never tokenized here.
//
// micromark's own `attention` construct is swapped for one whose tokenizer
// applies the amended rule; pairing (the resolver) is micromark's, unchanged.

import { attention } from 'micromark-core-commonmark'
import type {
  Code,
  Construct,
  Extension,
  State,
  TokenizeContext,
  Tokenizer
} from 'micromark-util-types'

const ASTERISK = 42

/** micromark's grouping: 1 whitespace (and the edges), 2 punctuation. */
function classify(code: Code): 1 | 2 | undefined {
  if (code === null || code < 0 || /\s/u.test(String.fromCodePoint(code))) {
    return 1
  }
  if (/\p{P}|\p{S}/u.test(String.fromCodePoint(code))) return 2
  return undefined
}

// Hangul Jamo; CJK and Kangxi radicals; ideographic description characters
// and CJK punctuation; kana, bopomofo, Hangul compatibility; enclosed and
// compatibility forms, Extension A; CJK Unified Ideographs; Hangul Jamo
// Extended-A; Hangul syllables and Jamo Extended-B; high surrogates of
// planes 2–3 (Extensions B–H); compatibility ideographs; CJK compatibility
// forms; halfwidth and fullwidth forms.
const CJK_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x11ff],
  [0x2e80, 0x2fdf],
  [0x2ff0, 0x303f],
  [0x3040, 0x31ff],
  [0x3200, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa960, 0xa97f],
  [0xac00, 0xd7ff],
  [0xd840, 0xd87f],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xffef]
]

/** A code unit of CJK script or CJK punctuation (micromark reads UTF-16
 * units; a high surrogate of planes 2–3 is the start of a rare ideograph). */
function isCjk(code: Code): boolean {
  if (code === null || code < 0) return false
  return CJK_RANGES.some(([from, to]) => code >= from && code <= to)
}

const tokenizeAttention: Tokenizer = function (
  this: TokenizeContext,
  effects,
  ok
) {
  const markers = this.parser.constructs.attentionMarkers.null ?? []
  const previous = this.previous
  const before = classify(previous)
  let marker: Code = null

  const inside: State = (code) => {
    if (code === marker) {
      effects.consume(code)
      return inside
    }
    const token = effects.exit('attentionSequence')
    const after = classify(code)
    const cjk = marker === ASTERISK
    // A CJK character on either side of the punctuation is the boundary a
    // space would be — the punctuation itself too when it is full-width:
    // `再平衡。**2018` closes, `2018**「引号」` opens.
    const open =
      !after ||
      (after === 2 &&
        (Boolean(before) || (cjk && (isCjk(previous) || isCjk(code))))) ||
      markers.includes(code)
    const close =
      !before ||
      (before === 2 &&
        (Boolean(after) || (cjk && (isCjk(code) || isCjk(previous))))) ||
      markers.includes(previous)
    // eslint-disable-next-line no-underscore-dangle -- micromark's token fields
    token._open = marker === ASTERISK ? open : open && (!!before || !close)
    // eslint-disable-next-line no-underscore-dangle -- micromark's token fields
    token._close = marker === ASTERISK ? close : close && (!!after || !open)
    return ok(code)
  }

  return (code) => {
    marker = code
    effects.enter('attentionSequence')
    return inside(code)
  }
}

const cjkAttention: Construct = {
  name: 'cjkAttention',
  tokenize: tokenizeAttention,
  resolveAll: attention.resolveAll
}

export const cjkEmphasisExtension: Extension = {
  disable: { null: ['attention'] },
  text: { 42: cjkAttention, 95: cjkAttention },
  insideSpan: { null: [cjkAttention] }
}

/** remark plugin: parse emphasis with the CJK-friendly flanking rule. */
export const remarkCjkEmphasis = function (this: {
  data: () => { micromarkExtensions?: Extension[] }
}) {
  const data = this.data()
  data.micromarkExtensions ??= []
  data.micromarkExtensions.push(cjkEmphasisExtension)
}
