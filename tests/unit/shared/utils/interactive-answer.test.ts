// A block's answer as the user's next message, read back as a card and as the
// picks that freeze the block. actovia-ios's InteractiveAnswerTests holds the
// same vectors — keep them in step.
import {
  askBlockSchema,
  confirmBlockSchema
} from '@actovia/shared/types/interactive'
import {
  composeAskAnswer,
  composeConfirmAnswer,
  readPicks,
  splitAnswer,
  type AnswerLabels
} from '@actovia/shared/utils/interactive-answer'
import { describe, expect, it } from 'vitest'

const ASK_SOURCE =
  '{"title":"我想先确认一下你的具体情况","questions":[{"id":"where","text":"哪里最痒？","type":"single","options":["小腿","手臂","全身到处都痒"],"other":true},{"id":"when","text":"什么时候最痒？","type":"multi","options":["洗澡后","晚上","全天"]}],"note":"还有什么想补充的？","submit":"提交，帮我判断"}'
const CONFIRM_SOURCE =
  '{"title":"要我把这份行程写进日历吗？","details":"10 月 21–25 日，五天，17 个地点；日历「旅行」。","approve":"写进去","reject":"先不要","note":"有要改的地方可以写在这里"}'
const SIZES_SOURCE =
  '{"title":"Pick a plan","questions":[{"id":"size","text":"Which sizes?","type":"multi","options":["Small, cheap","Medium","Large, roomy"],"other":true}]}'
const QUOTED_SOURCE = '{"title":"Send \\"Q3/Q4\\" report?"}'

const ZH: AnswerLabels = {
  other: '其他',
  addition: '补充',
  note: '备注',
  approved: '同意',
  rejected: '拒绝'
}
const EN: AnswerLabels = {
  other: 'Other',
  addition: 'Also',
  note: 'Note',
  approved: 'Approved',
  rejected: 'Rejected'
}

const ANSWER_CJK =
  '```actovia-answer\n{"block":"ask","ref":"a9f2","title":"我想先确认一下你的具体情况"}\n```\n\n' +
  '**哪里最痒？** 小腿\n**什么时候最痒？** 洗澡后, 晚上\n**补充:** 用的是丝塔芙润肤乳'
const ANSWER_OTHER =
  '```actovia-answer\n{"block":"ask","ref":"a9f2","title":"我想先确认一下你的具体情况"}\n```\n\n' +
  '**哪里最痒？** 其他: 脚踝 和脚背\n**什么时候最痒？** —'
const ANSWER_COMMAS =
  '```actovia-answer\n{"block":"ask","ref":"r-2","title":"Pick a plan"}\n```\n\n' +
  '**Which sizes?** Small, cheap, Large, roomy, Other'
const ANSWER_APPROVE =
  '```actovia-answer\n{"block":"confirm","decision":"approve","ref":"c1","title":"要我把这份行程写进日历吗？"}\n```\n\n' +
  '**要我把这份行程写进日历吗？** 同意\n**备注:** 第三天换成京都'
const ANSWER_REJECT =
  '```actovia-answer\n{"block":"confirm","decision":"reject","ref":"c2","title":"Send \\"Q3/Q4\\" report?"}\n```\n\n' +
  '**Send "Q3/Q4" report?** Rejected'

const ask = (source: string) => askBlockSchema.parse(JSON.parse(source))
const confirm = (source: string) => confirmBlockSchema.parse(JSON.parse(source))

describe('composeAskAnswer', () => {
  it("writes a line a question, the picks in the options' order, then the closing note", () => {
    const text = composeAskAnswer(
      ask(ASK_SOURCE),
      'a9f2',
      {
        where: { options: ['小腿'], other: null },
        when: { options: ['晚上', '洗澡后'], other: null }
      },
      '用的是丝塔芙润肤乳',
      ZH
    )
    expect(text).toBe(ANSWER_CJK)
  })

  it('writes Other with its text on one line, a blank as —, and no note line when none was typed', () => {
    const text = composeAskAnswer(
      ask(ASK_SOURCE),
      'a9f2',
      { where: { options: [], other: '脚踝\n和脚背' } },
      '  ',
      ZH
    )
    expect(text).toBe(ANSWER_OTHER)
  })

  it("keeps an option's commas, and writes Other picked with nothing typed as the word alone", () => {
    const text = composeAskAnswer(
      ask(SIZES_SOURCE),
      'r-2',
      { size: { options: ['Large, roomy', 'Small, cheap'], other: '' } },
      '',
      EN
    )
    expect(text).toBe(ANSWER_COMMAS)
  })
})

describe('composeConfirmAnswer', () => {
  it('writes the title and the decision, then the note', () => {
    expect(
      composeConfirmAnswer(
        confirm(CONFIRM_SOURCE),
        'c1',
        true,
        '第三天换成京都',
        ZH
      )
    ).toBe(ANSWER_APPROVE)
  })

  it('escapes the title in the fence as JSON does, slashes left alone, and leaves out an empty note', () => {
    expect(
      composeConfirmAnswer(confirm(QUOTED_SOURCE), 'c2', false, '\n', EN)
    ).toBe(ANSWER_REJECT)
  })
})

describe('splitAnswer', () => {
  it('reads the fence and the lines after it', () => {
    expect(splitAnswer(ANSWER_CJK)).toEqual({
      answer: {
        block: 'ask',
        ref: 'a9f2',
        title: '我想先确认一下你的具体情况'
      },
      body: '**哪里最痒？** 小腿\n**什么时候最痒？** 洗澡后, 晚上\n**补充:** 用的是丝塔芙润肤乳'
    })
    expect(splitAnswer(ANSWER_REJECT).answer).toEqual({
      block: 'confirm',
      decision: 'reject',
      ref: 'c2',
      title: 'Send "Q3/Q4" report?'
    })
  })

  it('reads a fence with nothing after it', () => {
    expect(
      splitAnswer('```actovia-answer\n{"block":"confirm","ref":"r"}\n```')
    ).toEqual({ answer: { block: 'confirm', ref: 'r' }, body: '' })
  })

  it.each([
    ['an ordinary message', 'hello'],
    ['not JSON', '```actovia-answer\n{oops}\n```\n\nhi'],
    [
      'an unknown block',
      '```actovia-answer\n{"block":"poll","ref":"r"}\n```\n\nhi'
    ],
    ['no ref', '```actovia-answer\n{"block":"ask"}\n```\n\nhi'],
    ['a fence never closed', '```actovia-answer\n{"block":"ask","ref":"r"}']
  ])('%s is not an answer', (_name, text) => {
    expect(splitAnswer(text)).toEqual({ answer: null, body: text })
  })
})

describe('readPicks', () => {
  it('reads each question back from its line', () => {
    const block = ask(ASK_SOURCE)
    expect(readPicks(block, splitAnswer(ANSWER_CJK).body)).toEqual({
      where: { options: ['小腿'], other: false },
      when: { options: ['洗澡后', '晚上'], other: false }
    })
    expect(readPicks(block, splitAnswer(ANSWER_OTHER).body)).toEqual({
      where: { options: [], other: true },
      when: { options: [], other: false }
    })
  })

  it('matches options that hold commas, longest first, and what is left over as Other', () => {
    expect(
      readPicks(ask(SIZES_SOURCE), splitAnswer(ANSWER_COMMAS).body)
    ).toEqual({
      size: { options: ['Small, cheap', 'Large, roomy'], other: true }
    })
  })

  it('reads the picks back without knowing the language they were written in', () => {
    const block = ask(SIZES_SOURCE)
    const japanese = composeAskAnswer(
      block,
      'r',
      { size: { options: ['Medium'], other: '特大' } },
      'メモ',
      {
        other: 'その他',
        addition: '補足',
        note: 'メモ',
        approved: '承認済み',
        rejected: '却下済み'
      }
    )
    expect(readPicks(block, splitAnswer(japanese).body)).toEqual({
      size: { options: ['Medium'], other: true }
    })
  })

  it('a question without its line has no picks', () => {
    expect(readPicks(ask(SIZES_SOURCE), '')).toEqual({
      size: { options: [], other: false }
    })
  })
})
