import { ImageIcon, Mic, MicOff, Send, Square, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MentionMenu, type MentionTarget } from './MentionMenu';
import { createDictation, isDictationSupported, type Dictation } from './voice-dictation';

/// Multiline input with image attachments (Liara routes through a vision
/// sidecar / Anthropic uses native multimodal). Image accepted via:
///   - "Attach image" button (file picker)
///   - Drag & drop onto the composer
///   - Paste (⌘V) from clipboard
///
/// During streaming the send button switches to STOP that aborts inference.

export interface PendingImage {
  /// data URL (data:image/png;base64,...) for preview
  dataUrl: string;
  /// extracted base64 payload only (no prefix) for API
  data: string;
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  name: string;
  size: number;
}

export function MessageInput({
  disabled,
  streaming,
  onSubmit,
  onStop,
}: {
  disabled: boolean;
  streaming?: boolean;
  onSubmit: (text: string, images?: PendingImage[]) => void;
  onStop?: () => void;
}) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<PendingImage[]>([]);
  const [dragging, setDragging] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dictationRef = useRef<Dictation | null>(null);
  const dictationBaseRef = useRef<string>('');

  function toggleDictation() {
    if (listening) {
      dictationRef.current?.stop();
      return;
    }
    if (!isDictationSupported()) return;
    dictationBaseRef.current = text;
    const dict = createDictation({
      onInterim: (t) => setText(`${dictationBaseRef.current}${dictationBaseRef.current ? ' ' : ''}${t}`),
      onFinal: (t) => {
        dictationBaseRef.current = `${dictationBaseRef.current}${dictationBaseRef.current ? ' ' : ''}${t}`;
        setText(dictationBaseRef.current);
      },
      onError: () => setListening(false),
      onEnd: () => setListening(false),
    });
    if (!dict) return;
    dictationRef.current = dict;
    dict.start(navigator.language || 'en-US');
    setListening(true);
  }

  useEffect(() => () => {
    dictationRef.current?.destroy();
  }, []);

  // Detect @mention trigger: the token immediately before the caret starts
  // with @. When matched, we surface the MentionMenu and feed it the query
  // (text after the @). Selection inserts at the cursor position.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const m = /(?:^|\s)@([\w./:-]*)$/.exec(before);
    setMentionQuery(m ? m[1] ?? '' : null);
  }, [text]);

  function pickMention(target: MentionTarget) {
    const el = textareaRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const after = text.slice(caret);
    const m = /(?:^|\s)@([\w./:-]*)$/.exec(before);
    if (!m) return;
    const start = before.length - m[0].trimStart().length;
    const newBefore = before.slice(0, start) + (before[start - 1] === '@' ? '' : '') + target.insert + ' ';
    const next = newBefore + after;
    setText(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      const pos = newBefore.length;
      el.setSelectionRange(pos, pos);
    });
  }

  const submit = useCallback(() => {
    const trimmed = text.trim();
    if ((!trimmed && images.length === 0) || disabled) return;
    onSubmit(trimmed, images.length > 0 ? images : undefined);
    setText('');
    setImages([]);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [text, images, disabled, onSubmit]);

  async function addFile(file: File) {
    if (!file.type.startsWith('image/')) return;
    const mediaType =
      file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'image/gif' || file.type === 'image/webp'
        ? (file.type as PendingImage['mediaType'])
        : 'image/png';
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    const data = dataUrl.split(',')[1] ?? '';
    setImages((prev) => [...prev, { dataUrl, data, mediaType, name: file.name, size: file.size }]);
  }

  function removeImage(idx: number) {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  }

  const showStop = Boolean(streaming && onStop);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (showStop) onStop?.();
        else submit();
      }}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        for (const f of Array.from(e.dataTransfer.files)) void addFile(f);
      }}
      onPaste={(e) => {
        for (const item of Array.from(e.clipboardData.items)) {
          if (item.type.startsWith('image/')) {
            const f = item.getAsFile();
            if (f) void addFile(f);
          }
        }
      }}
      className={`relative flex flex-col gap-1.5 border-t border-neutral-800 bg-neutral-950 p-2 ${
        dragging ? 'ring-2 ring-indigo-400 ring-offset-0' : ''
      }`}
    >
      {dragging ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded bg-indigo-500/10 text-xs font-medium text-indigo-200 backdrop-blur-sm">
          Drop image to attach
        </div>
      ) : null}

      {mentionQuery !== null ? (
        <MentionMenu
          query={mentionQuery}
          onPick={pickMention}
          onClose={() => setMentionQuery(null)}
        />
      ) : null}

      {images.length > 0 ? (
        <div className="flex gap-1.5 overflow-x-auto">
          {images.map((img, i) => (
            <div key={i} className="group relative shrink-0">
              <img
                src={img.dataUrl}
                alt={img.name}
                className="h-16 w-16 rounded border border-neutral-700 object-cover"
              />
              <button
                type="button"
                onClick={() => removeImage(i)}
                className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-600 text-white opacity-0 transition-opacity group-hover:opacity-100"
                aria-label={`Remove ${img.name}`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
              <span className="absolute inset-x-0 bottom-0 truncate rounded-b bg-black/60 px-1 text-[9px] text-white">
                {img.name}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Attach image (or drag-drop / paste)"
          className="flex h-8 w-8 items-center justify-center self-end rounded border border-neutral-800 text-neutral-400 transition-colors hover:border-indigo-500 hover:bg-indigo-500/10 hover:text-indigo-300"
        >
          <ImageIcon className="h-3.5 w-3.5" />
        </button>
        {isDictationSupported() ? (
          <button
            type="button"
            onClick={toggleDictation}
            title={listening ? 'Stop dictation' : 'Start voice dictation'}
            className={`flex h-8 w-8 items-center justify-center self-end rounded border transition-colors ${
              listening
                ? 'animate-pulse border-rose-500 bg-rose-500/15 text-rose-300'
                : 'border-neutral-800 text-neutral-400 hover:border-indigo-500 hover:bg-indigo-500/10 hover:text-indigo-300'
            }`}
          >
            {listening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
          </button>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            for (const f of Array.from(e.target.files ?? [])) void addFile(f);
            e.target.value = '';
          }}
        />
        <textarea
          ref={textareaRef}
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
              e.preventDefault();
              if (showStop) onStop?.();
              else submit();
            }
            if (e.key === 'Escape' && showStop) {
              e.preventDefault();
              onStop?.();
            }
          }}
          placeholder={
            showStop
              ? 'Generating… press Esc or click ■ to stop'
              : images.length > 0
                ? 'Describe what to do with the image — Enter to send'
                : 'Ask anything — Enter to send, ⇧Enter for newline'
          }
          className="flex-1 resize-none rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!showStop && (disabled || (!text.trim() && images.length === 0))}
          aria-label={showStop ? 'Stop generation' : 'Send'}
          title={showStop ? 'Stop generation (Esc)' : 'Send (Enter)'}
          className={`flex h-8 w-8 items-center justify-center self-end rounded text-white transition-all disabled:opacity-30 ${
            showStop
              ? 'animate-pulse bg-rose-600 hover:bg-rose-500 ring-2 ring-rose-400/50'
              : 'bg-indigo-600 hover:bg-indigo-500'
          }`}
        >
          {showStop ? <Square className="h-3.5 w-3.5 fill-current" /> : <Send className="h-3.5 w-3.5" />}
        </button>
      </div>
    </form>
  );
}
