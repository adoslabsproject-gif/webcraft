import { readFile } from '../../lib/ipc/fs';
import { useAppStore } from '../../store/app-store';

/// Expand @-mentions in the user's typed text into actual context blocks
/// injected before the chat send. Mirrors Cursor's @-mention semantics:
///   @path/to/file.ts  → reads the file and inlines its content
///   @diagnostics      → inlines the current problems list
///   @web:query        → tags the message for web_search tool (model picks it up)
///
/// Returns:
///   - cleanedText: user text with mentions removed/replaced
///   - contextBlocks: array of fenced markdown blocks to prepend
export interface ResolvedMentions {
  cleanedText: string;
  contextBlocks: string[];
}

export async function resolveMentions(raw: string): Promise<ResolvedMentions> {
  const blocks: string[] = [];
  const projectRoot = useAppStore.getState().projectRoot ?? '';
  const problems = useAppStore.getState().problems;

  // Find all @tokens
  const pattern = /@([\w./:_-]+)/g;
  const seen = new Set<string>();
  let cleaned = raw;

  for (const match of raw.matchAll(pattern)) {
    const token = match[1]!;
    if (seen.has(token)) continue;
    seen.add(token);

    if (token === 'diagnostics') {
      if (problems.length > 0) {
        const lines = problems
          .slice(0, 50)
          .map((p) => `${p.severity.toUpperCase()} ${p.path}:${p.line}:${p.column}  ${p.message}`);
        blocks.push(`\`\`\`text\n# @diagnostics\n${lines.join('\n')}\n\`\`\``);
      }
      cleaned = cleaned.replace(`@${token}`, '[diagnostics included above]');
      continue;
    }

    if (token.startsWith('web:')) {
      // Just leave the mention — the model will pick up the cue and call web_search.
      continue;
    }

    // Assume file reference. Resolve relative to projectRoot if not absolute.
    const path = token.startsWith('/') ? token : `${projectRoot}/${token}`;
    try {
      const content = await readFile(path);
      const ext = (path.split('.').pop() ?? '').toLowerCase();
      blocks.push(`\`\`\`${ext}\n// @${token}\n${content}\n\`\`\``);
      cleaned = cleaned.replace(`@${token}`, `\`${token}\``);
    } catch {
      // File didn't resolve — leave the mention untouched; the model will treat it as a string.
    }
  }

  return { cleanedText: cleaned, contextBlocks: blocks };
}
