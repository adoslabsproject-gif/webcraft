import { homeDir } from '@tauri-apps/api/path';
import { fileExists, readFile } from '../../lib/ipc/fs';

/// Inject project-specific context into the chat system prompt:
///   - .webcraftrules    → Cursor-style rules file at project root
///   - .cursorrules      → Cursor compatibility (read if .webcraftrules missing)
///   - CLAUDE.md         → Claude Code compatibility
///   - WEBCRAFT.md       → our native name
///   - ~/.webcraft/memory/<projectHash>/MEMORY.md → persistent memory across sessions

const PROJECT_RULE_FILES = ['.webcraftrules', '.cursorrules', 'CLAUDE.md', 'WEBCRAFT.md'];

async function projectHash(root: string): Promise<string> {
  // Stable, short hash from the root path — good enough to scope memory
  // per project without depending on git.
  let h = 5381;
  for (let i = 0; i < root.length; i++) {
    h = (h * 33) ^ root.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    if (await fileExists(path)) {
      const text = await readFile(path);
      return text.trim() || null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function buildProjectContext(
  projectRoot: string | null,
): Promise<string | null> {
  if (!projectRoot) return null;
  const sections: string[] = [];

  for (const name of PROJECT_RULE_FILES) {
    const content = await readIfExists(`${projectRoot}/${name}`);
    if (content) {
      sections.push(`## ${name}\n\n${content}`);
    }
  }

  const memoryPath = await memoryFilePath(projectRoot);
  const memory = await readIfExists(memoryPath);
  if (memory) {
    sections.push(`## Persistent memory for this project\n\n${memory}`);
  }

  if (sections.length === 0) return null;
  return `# Project rules and memory\n\n${sections.join('\n\n')}`;
}

export async function memoryFilePath(projectRoot: string): Promise<string> {
  const hash = await projectHash(projectRoot);
  const home = await homeDir();
  return `${home}/.webcraft/memory/${hash}/MEMORY.md`;
}
