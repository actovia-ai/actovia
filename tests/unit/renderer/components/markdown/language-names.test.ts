import { describe, expect, it } from 'vitest'

import { languageName } from '@/components/markdown/language-names'

describe("a code block's language name", () => {
  it('spells the known ones as their makers do, whatever the fence used', () => {
    expect(languageName('css')).toBe('CSS')
    expect(languageName('typescript')).toBe('TypeScript')
    expect(languageName('ts')).toBe('TypeScript')
    expect(languageName('tsx')).toBe('TSX')
    expect(languageName('js')).toBe('JavaScript')
    expect(languageName('json')).toBe('JSON')
    expect(languageName('html')).toBe('HTML')
    expect(languageName('py')).toBe('Python')
    expect(languageName('sh')).toBe('Shell')
    expect(languageName('bash')).toBe('Bash')
    expect(languageName('yml')).toBe('YAML')
    expect(languageName('objc')).toBe('Objective-C')
    expect(languageName('cpp')).toBe('C++')
    expect(languageName('cs')).toBe('C#')
    expect(languageName('swift')).toBe('Swift')
  })

  it('is not fooled by case or spaces', () => {
    expect(languageName('TypeScript')).toBe('TypeScript')
    expect(languageName(' CSS ')).toBe('CSS')
  })

  it('keeps an unknown name with a capital first letter, and an empty one empty', () => {
    expect(languageName('actovia-ask')).toBe('Actovia-ask')
    expect(languageName('foo')).toBe('Foo')
    expect(languageName('')).toBe('')
  })
})
