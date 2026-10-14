/**
 * Reading a commit out of a tool call — the two pure pieces, shared verbatim by the client and the host.
 *
 * Both sides need them and they must not drift: the CLIENT runs them over what the UI projection hands it (which the host truncates), and the
 * HOST runs them over the untruncated events it records. One source means a commit the host can name is always a commit the client recognises.
 * @module
 */

/** What a session's commit bubble shows when no message could be read at all. */
export const UNKNOWN_COMMIT = '未读到提交信息';

/** `git commit` in COMMAND position, allowing the global options between the program and its subcommand, in a subshell, or with output captured. */
export const GIT_COMMIT = /(?:^|[;&|(]|\$\(|\bthen\b)\s*git\s+(?:(?:-C|-c|--git-dir|--work-tree)\s+\S+\s+)*commit\b/;

/**
 * The command with its QUOTED SPANS removed, which is what the rule above is tested against.
 *
 * A command that merely WRITES the words `git commit -m "x"` into a file — a test fixture, say — is not a commit, and counting it produced a
 * phantom entry in the lane showing the fixture's own `x` as its subject. Quoted spans are where prose hides, so they are removed first.
 *
 * ONLY the quoted spans, and with NO escape handling: treating a backslash as an escape everywhere ate Windows path separators — the `\D`, `\d`
 * and `\w` of `D:\DSH\dsh-better-display-tools\worktree\dsh-viewtune` became spaces, which split `git -C <dir> commit …` into pieces and made
 * the reader's own command stop being recognised. The test that pins that exact command shape caught it.
 */
export function unquoted(command: string): string {
  return command.replace(/"[^"\n]*"|'[^'\n]*'/g, ' ');
}

/** The message's first line, from the command's own `-m`, or `UNKNOWN_COMMIT` when the command carries none. */
export function commitSubject(command: string): string {
  const quoted = /(?:^|\s)-{1,2}m(?:essage)?[= ](?:"([^"]+)"|'([^']+)'|([^\s"'&|;]+))/m.exec(command);
  const subject = (quoted?.[1] ?? quoted?.[2] ?? quoted?.[3] ?? '').split('\n')[0]?.trim() ?? '';
  return subject === '' ? UNKNOWN_COMMIT : subject;
}

/** Git's own summary line in a result: `[branch 1a2b3c4] the subject` — or the one-line log shape, `<hash> <subject>`. */
export function commitSummary(text: string): { hash?: string; subject?: string } {
  const match = /^\s*\[[^\]\s]+ ([0-9a-f]{7,40})\]\s*(.*)$/m.exec(text);
  if (match !== null) return { hash: match[1], subject: match[2]?.trim() };
  const bare = /^[^\S\n]*([0-9a-f]{7,40})[^\S\n]+(\S.*)$/m.exec(text);
  if (bare === null) return {};
  return { hash: bare[1], subject: bare[2]?.trim() };
}