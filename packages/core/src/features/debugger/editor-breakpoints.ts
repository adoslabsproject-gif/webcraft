import * as monaco from 'monaco-editor';
import { useDebugStore } from './debug-store';

/// Monaco ⇄ debugger glue: click the glyph margin to toggle a breakpoint,
/// red-dot decorations per model, current-line highlight while stopped.

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const el = document.createElement('style');
  el.textContent = `
    .wc-breakpoint { background: transparent; }
    .wc-breakpoint::before {
      content: ''; display: block; width: 9px; height: 9px; border-radius: 50%;
      background: #e51400; margin: 5px auto 0;
    }
    .wc-debug-line { background: rgba(255, 200, 0, 0.12); }
    .wc-debug-line-glyph::before {
      content: ''; display: block; width: 0; height: 0; margin: 4px auto 0;
      border-left: 9px solid #ffc800; border-top: 5px solid transparent; border-bottom: 5px solid transparent;
    }
  `;
  document.head.appendChild(el);
}

const decorationIds = new Map<string, string[]>();

function renderDecorations(): void {
  const { breakpoints, frames, activeFrameId, phase } = useDebugStore.getState();
  const activeFrame = frames.find((f) => f.id === activeFrameId) ?? frames[0] ?? null;
  for (const model of monaco.editor.getModels()) {
    if (model.uri.scheme !== 'file') continue;
    const path = model.uri.path;
    const decos: monaco.editor.IModelDeltaDecoration[] = [];
    for (const line of breakpoints[path] ?? []) {
      if (line <= model.getLineCount()) {
        decos.push({
          range: new monaco.Range(line, 1, line, 1),
          options: { glyphMarginClassName: 'wc-breakpoint', stickiness: 1 },
        });
      }
    }
    if (phase === 'stopped' && activeFrame?.path === path && activeFrame.line > 0) {
      decos.push({
        range: new monaco.Range(activeFrame.line, 1, activeFrame.line, 1),
        options: {
          isWholeLine: true,
          className: 'wc-debug-line',
          glyphMarginClassName: 'wc-debug-line-glyph',
        },
      });
    }
    const prev = decorationIds.get(path) ?? [];
    decorationIds.set(path, model.deltaDecorations(prev, decos));
  }
}

let wired = false;

/// Call once per editor mount — installs the gutter click handler; the
/// store subscription is global and installed on first call.
export function wireBreakpoints(editor: monaco.editor.IStandaloneCodeEditor): void {
  injectStyle();
  editor.onMouseDown((e) => {
    if (
      e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN &&
      e.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS
    ) {
      return;
    }
    const model = editor.getModel();
    const line = e.target.position?.lineNumber;
    if (!model || model.uri.scheme !== 'file' || !line) return;
    useDebugStore.getState().toggleBreakpoint(model.uri.path, line);
  });
  if (!wired) {
    wired = true;
    useDebugStore.subscribe(renderDecorations);
    monaco.editor.onDidCreateModel(() => renderDecorations());
  }
  renderDecorations();
}
