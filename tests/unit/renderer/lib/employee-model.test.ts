import { describe, expect, it } from 'vitest'

import {
  cliModelSuggestions,
  employeeModelLabel,
  actoviaModelOptions,
  parseModelValue
} from '@/lib/employee-model'

const settings = {
  providerConfig: { provider: 'Anthropic Claude', model: 'claude-sonnet-5-5' },
  providers: { anthropicApiKey: '••••', openaiApiKey: '' },
  modelCatalog: {
    'Anthropic Claude': [
      { id: 'claude-opus-5-5', displayName: 'Claude Opus 5.5' }
    ],
    'OpenAI GPT': [{ id: 'gpt-x', displayName: 'GPT X' }]
  }
} as never

describe('employee model', () => {
  it('offers only the models of providers with a key', () => {
    const opts = actoviaModelOptions(settings)
    expect(opts.map((o) => o.value)).toEqual([
      'Anthropic Claude::claude-opus-5-5'
    ])
    expect(opts[0].label).toMatch(/Claude Opus 5\.5/)
  })

  it('reads a picker value back', () => {
    expect(parseModelValue('Anthropic Claude::claude-opus-5-5')).toEqual({
      provider: 'Anthropic Claude',
      model: 'claude-opus-5-5'
    })
    expect(parseModelValue('')).toEqual({ provider: null, model: null })
  })

  it('labels an employee by what it runs on', () => {
    expect(
      employeeModelLabel(
        { runtime: 'actovia', provider: null, model: null } as never,
        settings
      )
    ).toBe('Default')
    expect(
      employeeModelLabel(
        {
          runtime: 'actovia',
          provider: 'Anthropic Claude',
          model: 'claude-opus-5-5'
        } as never,
        settings
      )
    ).toMatch(/Opus 5\.5/)
    expect(
      employeeModelLabel(
        { runtime: 'claude-code', provider: null, model: 'opus' } as never,
        settings
      )
    ).toBe('Claude Code · opus')
    expect(
      employeeModelLabel(
        { runtime: 'claude-code', provider: null, model: null } as never,
        settings
      )
    ).toBe('Claude Code')
  })
})

describe('cliModelSuggestions', () => {
  it('knows Claude Code’s aliases and takes the rest from the CLI', () => {
    expect(cliModelSuggestions('claude-code')).toEqual([
      'opus',
      'sonnet',
      'haiku'
    ])
    expect(
      cliModelSuggestions('codex', { models: ['gpt-x'] } as never)
    ).toEqual(['gpt-x'])
    expect(cliModelSuggestions('codex')).toEqual([])
  })
})
