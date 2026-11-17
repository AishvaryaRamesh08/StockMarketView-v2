import { useCallback, useEffect, useRef, useState } from 'react';
import { converse, DEFAULT_MODEL, fallbackOrder, GeminiError, MODEL_RE, type Content, type FunctionCall, type GeminiSettings, type ToolOutcome } from '../lib/gemini.ts';
import { TOOLS } from '../lib/chatTools.ts';
import { load, save } from '../lib/storage.ts';

/** The visitor's Gemini key and model. Kept only in this browser's localStorage. */
const SETTINGS_KEY = 'smv.gemini';

function isSettings(v: unknown): v is GeminiSettings {
  const s = v as GeminiSettings;
  return !!s && typeof s === 'object' && typeof s.key === 'string' && typeof s.model === 'string';
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant' | 'note' | 'error';
  text: string;
}

let nextId = 1;

export interface ChatApi {
  settings: GeminiSettings;
  /** Model actually answering: the chosen one, or a fallback while it is busy. */
  activeModel: string;
  hasKey: boolean;
  saveSettings: (s: GeminiSettings) => void;
  removeKey: () => void;
  messages: ChatMessage[];
  busy: boolean;
  send: (text: string) => void;
  stop: () => void;
  clear: () => void;
}

/**
 * Chat state lives in App so it survives switching between the Trade and Chat tabs.
 * `execute` and `system` are read through refs, so each step sees the current page state.
 */
export function useChat(execute: (call: FunctionCall) => Promise<ToolOutcome>, system: () => string): ChatApi {
  const [settings, setSettings] = useState<GeminiSettings>(() => {
    const s = load(SETTINGS_KEY, { key: '', model: DEFAULT_MODEL }, isSettings);
    return { key: s.key, model: MODEL_RE.test(s.model) ? s.model : DEFAULT_MODEL };
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  // After a fallback, keep using the model that answered for the rest of this visit.
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const history = useRef<Content[]>([]);
  const abort = useRef<AbortController | null>(null);
  const exec = useRef(execute);
  const sys = useRef(system);
  exec.current = execute;
  sys.current = system;

  const push = (role: ChatMessage['role'], text: string) => setMessages((m) => [...m, { id: nextId++, role, text }]);

  const send = useCallback(
    (text: string) => {
      const message = text.trim();
      if (!message || busy || !settings.key) return;
      push('user', message);
      setBusy(true);
      const ctrl = new AbortController();
      abort.current = ctrl;
      converse({
        settings,
        system: sys.current(),
        history: history.current,
        message,
        tools: TOOLS,
        execute: (call) => exec.current(call),
        signal: ctrl.signal,
        onNote: (note) => push('note', note),
        models: fallbackOrder(activeModel ?? settings.model),
      })
        .then((r) => {
          history.current = r.history;
          setActiveModel(r.model === settings.model ? null : r.model);
          push('assistant', r.text || 'Done.');
        })
        .catch((err: Error) => {
          if (err.name === 'AbortError') push('note', 'Stopped.');
          else push('error', err instanceof GeminiError ? err.message : 'Something went wrong talking to Gemini. Try again.');
        })
        .finally(() => {
          setBusy(false);
          abort.current = null;
        });
    },
    [busy, settings, activeModel],
  );

  useEffect(() => () => abort.current?.abort(), []);

  return {
    settings,
    activeModel: activeModel ?? settings.model,
    hasKey: !!settings.key,
    saveSettings: (s) => {
      setActiveModel(null);
      const next = { key: s.key.trim(), model: MODEL_RE.test(s.model.trim()) ? s.model.trim() : DEFAULT_MODEL };
      setSettings(next);
      save(SETTINGS_KEY, next);
    },
    removeKey: () => {
      abort.current?.abort();
      const next = { key: '', model: settings.model };
      setSettings(next);
      save(SETTINGS_KEY, next);
    },
    messages,
    busy,
    send,
    stop: () => abort.current?.abort(),
    clear: () => {
      abort.current?.abort();
      history.current = [];
      setMessages([]);
    },
  };
}

// ------------------------------------------------------------------ voice input

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
}

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** The browser's built-in speech recognition; `supported` is false where it is missing (e.g. Firefox). */
export function useSpeech(onFinal: (text: string) => void, onInterim: (text: string) => void) {
  const Ctor = recognitionCtor();
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const cbs = useRef({ onFinal, onInterim });
  cbs.current = { onFinal, onInterim };

  const start = useCallback(() => {
    if (!Ctor || rec.current) return;
    const r = new Ctor();
    r.lang = navigator.language?.startsWith('en') ? navigator.language : 'en-IN';
    r.interimResults = true;
    r.continuous = false;
    let finalText = '';
    r.onresult = (e) => {
      let interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText = res[0].transcript;
        else interim += res[0].transcript;
      }
      cbs.current.onInterim(finalText || interim);
    };
    r.onerror = (e) => setError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Microphone access was blocked. Allow it in the browser to use voice.' : e.error === 'no-speech' ? "Didn't catch that. Try again." : null);
    r.onend = () => {
      rec.current = null;
      setListening(false);
      if (finalText.trim()) cbs.current.onFinal(finalText.trim());
    };
    setError(null);
    rec.current = r;
    setListening(true);
    try {
      r.start();
    } catch {
      rec.current = null;
      setListening(false);
    }
  }, [Ctor]);

  const stop = useCallback(() => rec.current?.stop(), []);
  useEffect(() => () => rec.current?.stop(), []);

  return { supported: !!Ctor, listening, error, start, stop };
}
