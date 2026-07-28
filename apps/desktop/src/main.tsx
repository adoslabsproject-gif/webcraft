/// Silence the harmless "ResizeObserver loop completed with undelivered
/// notifications" Webkit warning that fires when react-arborist or xterm
/// re-measure inside an observer callback. Real React errors still bubble.
const RESIZE_OBS_NOISE = /ResizeObserver loop completed/;
const _origError = window.console.error;
window.console.error = (...args: unknown[]) => {
  if (args.some((a) => typeof a === 'string' && RESIZE_OBS_NOISE.test(a))) return;
  _origError.apply(window.console, args);
};
window.addEventListener('error', (e) => {
  if (e.message && RESIZE_OBS_NOISE.test(e.message)) e.stopImmediatePropagation();
});

/// Triple-Esc emergency reset — closes any stuck overlay/modal.
let escStreak = 0;
let escResetTimer: ReturnType<typeof setTimeout> | null = null;
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  escStreak++;
  if (escResetTimer) clearTimeout(escResetTimer);
  escResetTimer = setTimeout(() => {
    escStreak = 0;
  }, 800);
  if (escStreak >= 3) {
    escStreak = 0;
    window.dispatchEvent(new CustomEvent('webcraft:emergency-reset'));
  }
});

/// Visible unhandled-rejection banner. React's ErrorBoundary catches sync
/// throws during render but not Promise rejections from async effects
/// (e.g. PGLite WASM init blocked by CSP, or fetch failure inside a
/// useEffect). We catch them here and render a fixed banner so the user
/// sees the real cause instead of "nothing clickable".
///
/// Benign rejections are filtered exactly like VS Code does: Monaco raises
/// `Canceled` CancellationErrors whenever pending requests (hover,
/// completion, LSP) are disposed by a model switch — opening/closing a file
/// fires them by design and they carry zero signal for the user. Same for
/// AbortError from user-cancelled fetches.
function isBenignRejection(reason: unknown): boolean {
  if (!(reason instanceof Error)) return false;
  if (reason.name === 'Canceled' || reason.message === 'Canceled') return true;
  if (reason.name === 'AbortError') return true;
  return false;
}

function showUnhandledBanner(reason: unknown): void {
  const msg = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
  const stack = reason instanceof Error && reason.stack ? `\n\n${reason.stack}` : '';
  const fullText = msg + stack;
  const id = 'webcraft-rejection-banner';
  let banner = document.getElementById(id);
  if (!banner) {
    banner = document.createElement('div');
    banner.id = id;
    banner.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      'right:0',
      'z-index:99999',
      'padding:8px 12px',
      'font:12px/1.4 ui-monospace,SF Mono,monospace',
      'color:#fecaca',
      'background:rgba(127,29,29,0.95)',
      'border-bottom:1px solid rgba(248,113,113,0.4)',
      'max-height:40vh',
      'overflow:auto',
      'cursor:default',
      'user-select:text',
      '-webkit-user-select:text',
    ].join(';');
    document.body.appendChild(banner);
  }
  banner.innerHTML =
    `<strong>⚠ Unhandled rejection</strong>` +
    `<button id="webcraft-rejection-copy" style="margin-left:10px;padding:1px 8px;font:inherit;color:#fecaca;background:transparent;border:1px solid rgba(248,113,113,0.5);border-radius:4px;cursor:pointer">Copy</button>` +
    `<button id="webcraft-rejection-close" style="margin-left:6px;padding:1px 8px;font:inherit;color:#fecaca;background:transparent;border:1px solid rgba(248,113,113,0.5);border-radius:4px;cursor:pointer">Dismiss</button>` +
    `<pre style="white-space:pre-wrap;margin:6px 0 0;font:inherit">${escapeHtml(fullText)}</pre>`;
  document.getElementById('webcraft-rejection-copy')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    void navigator.clipboard.writeText(fullText);
    const btn = ev.currentTarget as HTMLButtonElement;
    btn.textContent = 'Copied ✓';
    setTimeout(() => {
      btn.textContent = 'Copy';
    }, 1500);
  });
  document.getElementById('webcraft-rejection-close')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    banner?.remove();
  });
}
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
window.addEventListener('unhandledrejection', (e) => {
  if (isBenignRejection(e.reason)) {
    // Suppress the default console spam too — these fire on every tab
    // switch and would bury real errors.
    e.preventDefault();
    return;
  }
  showUnhandledBanner(e.reason);
});

import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/global.css';

/// Monaco — self-hosted (no CDN). Web workers are bundled by Vite as
/// separate chunks so syntax/language services don't block the main thread.
/// `loader.config({ monaco })` tells @monaco-editor/react to use the local
/// `monaco` import instead of the default unpkg CDN (which CSP blocks).

self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

// Disable HTTP schema fetching — Tauri CSP blocks external requests anyway,
// and the warning noise on every JSON file with $schema URL is just clutter.
// `monaco.languages.json` is typed as deprecated in 0.55 but the runtime
// API still exposes jsonDefaults; we reach it via a typed cast.
interface JsonDefaultsApi {
  jsonDefaults: {
    setDiagnosticsOptions(opts: {
      validate?: boolean;
      allowComments?: boolean;
      trailingCommas?: 'warning' | 'error' | 'ignore';
      enableSchemaRequest?: boolean;
      schemas?: Array<{ uri: string; fileMatch?: string[]; schema?: unknown }>;
    }): void;
  };
}
(monaco.languages as unknown as { json: JsonDefaultsApi }).json.jsonDefaults.setDiagnosticsOptions({
  validate: true,
  allowComments: true,
  trailingCommas: 'warning',
  enableSchemaRequest: false,
  schemas: [],
});

loader.config({ monaco });

// Register WebCraft-specific Monaco extensions: snippets + AI code lens.
// These run once at boot, before React mounts.
import('@webcraft/core').then((core: unknown) => {
  const ext = core as {
    registerSnippetCompletions?: () => void;
    registerAiCodeLens?: () => unknown;
    registerGhostAutocomplete?: () => unknown;
    registerLspProviders?: () => unknown;
  };
  ext.registerSnippetCompletions?.();
  ext.registerAiCodeLens?.();
  ext.registerGhostAutocomplete?.();
  ext.registerLspProviders?.();
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
