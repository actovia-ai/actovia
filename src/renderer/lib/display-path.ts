/**
 * A path as the UI shows it: the home directory folded to `~`, so a row does
 * not spell out the account name (it shows on every screenshot) and the line
 * stays short. The renderer is not told the home directory; these are the
 * layouts macOS, Linux and Windows give it.
 */
export function foldHome(path: string): string {
  return path
    .replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/u, '~')
    .replace(/^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/u, '~')
}

/** `…/workspace/<chat id>/` — a chat's own workspace, wherever the data dir is. */
const CHAT_WORKSPACE =
  /[/\\]workspace[/\\][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[/\\](.+)$/iu

/** A `..` segment: a path that names one place and goes to another. */
const PARENT_SEGMENT = /(?:^|[/\\])\.\.(?:[/\\]|$)/u

/**
 * A file a tool read or wrote: relative to the chat's workspace when it is in
 * one (`hello.py`, `docs/notes.md`), else with the home directory folded. A
 * path with a `..` in it is never shortened — `…/workspace/<id>/../../x`
 * would otherwise read as a file of the workspace.
 */
export function displayFilePath(path: string): string {
  if (PARENT_SEGMENT.test(path)) return foldHome(path)
  return CHAT_WORKSPACE.exec(path)?.[1] ?? foldHome(path)
}
