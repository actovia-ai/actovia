import { describe, expect, it } from 'vitest'

const { createArtifact } =
  await import('@main/lib/ai/calling-tools/create-artifact')

const tool = createArtifact('chat-1')
const contract = (
  tool.parameters.properties as { code: { description: string } }
).code.description

describe('create_artifact design contract', () => {
  it('lets each artifact choose its visual style and components', () => {
    expect(contract).toContain('Use shadcn components when they help')
    expect(contract).toContain("need not match Actovia's accent tone")
    expect(contract).toContain('more expressive custom layout')
  })

  it('supports both themes and artifact-specific palettes', () => {
    expect(contract).toContain('Support both light and dark')
    expect(contract).toContain('artifact-specific palette')
    expect(contract).toContain('Check text and data contrast in both themes')
  })

  it('documents the phone layout and sandbox module boundaries', () => {
    expect(contract).toContain('340–430px on a phone')
    expect(contract).toContain('isolated iframe with no network access')
    expect(contract).toContain('only external modules the sandbox provides')
  })
})
