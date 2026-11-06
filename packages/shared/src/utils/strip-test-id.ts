const lineBreaksOf = (removed: string): string => removed.replace(/[^\n]+/g, '')

/**
 * Remove `data-testid` JSX attributes from a source string.
 *
 * Used by the `STRIP_TEST_IDS=1` build transform (`electron.vite.config.ts`,
 * release builds only) so the E2E markers never ship. Handles the three
 * attribute forms this codebase uses:
 *
 * - `data-testid="literal"`
 * - `data-testid='literal'`
 * - `data-testid={expr}` where `expr` may contain **one** level of nested
 *   braces — i.e. a template literal with `${…}` interpolations, such as
 *   ``data-testid={`${TEST_IDS.settings.themeMode}-${value}`}``. The naive
 *   `\{[^}]*\}` form stopped at the first `}` (the end of the first `${…}`)
 *   and left the rest of the template dangling, producing invalid JS.
 *
 * A `data-testid` expression nested more than one brace level deep (a template
 * interpolation that itself contains a template interpolation) is not matched;
 * that would fail the release build loudly rather than ship a stale marker, and
 * no such usage exists here.
 *
 * What is removed leaves its line breaks behind, so every line after it stays
 * where it was: the transform hands Vite no source map of its own, and a
 * release build's maps would otherwise name a line a few above the real one.
 * The lookbehind permits only the start of each whitespace run, so a file
 * with long indentation is scanned without retrying every suffix of the run.
 */
export function stripDataTestId(code: string): string {
  return code
    .replace(
      /(?<!\s)\s+data-testid=\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/gu,
      lineBreaksOf
    )
    .replace(/(?<!\s)\s+data-testid="[^"]*"/gu, lineBreaksOf)
    .replace(/(?<!\s)\s+data-testid='[^']*'/gu, lineBreaksOf)
}
