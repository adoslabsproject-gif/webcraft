/// Voice dictation — uses the platform Web Speech API (WKWebView on macOS
/// has `webkitSpeechRecognition`). Streams interim results so the user sees
/// their words appear live in the composer.
///
/// Fallback story: if the host browser lacks SpeechRecognition (some Linux
/// WebKit builds), createDictation() returns null and the caller hides
/// the microphone button.

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

interface SpeechRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): RecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface Dictation {
  start: (lang?: string) => void;
  stop: () => void;
  destroy: () => void;
}

export interface DictationHandlers {
  onInterim: (transcript: string) => void;
  onFinal: (transcript: string) => void;
  onError: (msg: string) => void;
  onEnd: () => void;
}

export function isDictationSupported(): boolean {
  return getCtor() !== null;
}

export function createDictation(h: DictationHandlers): Dictation | null {
  const Ctor = getCtor();
  if (!Ctor) return null;
  const recog = new Ctor();
  recog.continuous = true;
  recog.interimResults = true;

  recog.onresult = (e) => {
    let interim = '';
    let final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i]!;
      const alt = res[0]!;
      if (res.isFinal) final += alt.transcript;
      else interim += alt.transcript;
    }
    if (final) h.onFinal(final);
    if (interim) h.onInterim(interim);
  };
  recog.onerror = (e) => h.onError(e.error);
  recog.onend = () => h.onEnd();

  return {
    start(lang) {
      recog.lang = lang ?? 'en-US';
      try {
        recog.start();
      } catch {
        /* already started */
      }
    },
    stop() {
      try {
        recog.stop();
      } catch {
        /* already stopped */
      }
    },
    destroy() {
      try {
        recog.abort();
      } catch {
        /* */
      }
      recog.onresult = null;
      recog.onerror = null;
      recog.onend = null;
    },
  };
}
