import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSpeech, type ChatApi } from '../hooks/useChat.ts';
import { DEFAULT_MODEL, SUGGESTED_MODELS } from '../lib/gemini.ts';

const SUGGESTIONS = ['Show Reliance for 1 year with RSI', 'Compare TCS with Infosys and Wipro', 'Explain this chart', 'How is my portfolio doing?', 'What is a demat account?'];

/** Chat with Gemini using the visitor's own key; it drives the charts through tools. */
export function ChatPanel({ chat }: { chat: ChatApi }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  if (!chat.hasKey || settingsOpen) return <ChatSettings chat={chat} onDone={() => setSettingsOpen(false)} canCancel={chat.hasKey} />;
  return <Conversation chat={chat} onSettings={() => setSettingsOpen(true)} />;
}

function Conversation({ chat, onSettings }: { chat: ChatApi; onSettings: () => void }) {
  const [input, setInput] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const speech = useSpeech(
    (text) => {
      setInput('');
      chat.send(text);
    },
    (text) => setInput(text),
  );

  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.busy]);

  const submit = () => {
    if (!input.trim() || chat.busy) return;
    chat.send(input);
    setInput('');
  };

  return (
    <div className="chat">
      <div className="chat-log" ref={list} aria-live="polite">
        {chat.messages.length === 0 && (
          <div className="chat-empty">
            <p>Ask in plain English and I'll draw the chart, or ask what something means.</p>
            <div className="chat-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chat-suggestion" onClick={() => chat.send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {chat.messages.map((m) =>
          m.role === 'note' ? (
            <div key={m.id} className="chat-note">
              <svg viewBox="0 0 16 16" aria-hidden>
                <path d="M3 8.5l3 3 7-7" />
              </svg>
              {m.text}
            </div>
          ) : (
            <div key={m.id} className={`chat-msg ${m.role}`}>
              {m.role === 'assistant' ? <Rich text={m.text} /> : m.text}
            </div>
          ),
        )}
        {chat.busy && (
          <div className="chat-msg assistant typing" aria-label="Thinking">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>

      {speech.error && <p className="chat-hint">{speech.error}</p>}

      <div className="chat-input">
        <textarea
          ref={box}
          rows={1}
          value={input}
          placeholder={speech.listening ? 'Listening…' : 'Ask or say: “Show Apple with Bollinger Bands”'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          aria-label="Message"
        />
        {speech.supported && (
          <button
            className={`icon-btn mic-btn ${speech.listening ? 'listening' : ''}`}
            onClick={speech.listening ? speech.stop : speech.start}
            disabled={chat.busy}
            aria-pressed={speech.listening}
            aria-label={speech.listening ? 'Stop listening' : 'Speak your question'}
            title={speech.listening ? 'Stop listening' : "Speak (uses your browser's speech recognition)"}
          >
            <svg viewBox="0 0 20 20" aria-hidden>
              <rect x="7" y="2.5" width="6" height="10" rx="3" />
              <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5" />
            </svg>
          </button>
        )}
        {chat.busy ? (
          <button className="icon-btn send-btn" onClick={chat.stop} aria-label="Stop" title="Stop">
            <svg viewBox="0 0 20 20" aria-hidden>
              <rect x="6" y="6" width="8" height="8" rx="1.5" />
            </svg>
          </button>
        ) : (
          <button className="icon-btn send-btn" onClick={submit} disabled={!input.trim()} aria-label="Send" title="Send (Enter)">
            <svg viewBox="0 0 20 20" aria-hidden>
              <path d="M3.5 10h12M11 5.5l4.5 4.5-4.5 4.5" />
            </svg>
          </button>
        )}
      </div>

      <div className="chat-foot">
        <span>
          {chat.activeModel}
          {chat.activeModel !== chat.settings.model ? ` (${chat.settings.model} busy)` : ''} · explains and charts, never gives buy/sell advice
        </span>
        <span className="chat-foot-actions">
          {chat.messages.length > 0 && (
            <button className="link" onClick={chat.clear}>
              Clear
            </button>
          )}
          <button className="link" onClick={onSettings}>
            Settings
          </button>
        </span>
      </div>
    </div>
  );
}

function ChatSettings({ chat, onDone, canCancel }: { chat: ChatApi; onDone: () => void; canCancel: boolean }) {
  const [key, setKey] = useState(chat.settings.key);
  const [model, setModel] = useState(chat.settings.model || DEFAULT_MODEL);
  const [confirmRemove, setConfirmRemove] = useState(false);

  return (
    <form
      className="chat-setup"
      onSubmit={(e) => {
        e.preventDefault();
        if (!key.trim()) return;
        chat.saveSettings({ key, model });
        onDone();
      }}
    >
      {!chat.hasKey && (
        <>
          <h3>Chat with your charts</h3>
          <p>
            Ask things like “show Reliance for a year with RSI” or “what is a demat account?”. It uses Google's Gemini with <b>your own free API key</b>.
          </p>
          <ol>
            <li>
              Get a key from{' '}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer noopener">
                Google AI Studio
              </a>{' '}
              (free, needs a Google account).
            </li>
            <li>Paste it below.</li>
          </ol>
        </>
      )}

      <label className="tp-field">
        <span className="tp-label">Gemini API key</span>
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your key" autoComplete="off" spellCheck={false} aria-label="Gemini API key" />
      </label>

      <label className="tp-field">
        <span className="tp-label">Model</span>
        <input list="gemini-models" value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} aria-label="Gemini model" />
        <datalist id="gemini-models">
          {SUGGESTED_MODELS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>

      <p className="chat-privacy">
        <svg viewBox="0 0 16 16" aria-hidden>
          <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" />
          <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
        </svg>
        Your key is stored only in this browser and sent only to Google. It never goes to this website's server. Google's usage limits and terms for your key apply.
      </p>

      <div className="chat-setup-actions">
        <button type="submit" className="btn primary" disabled={!key.trim()}>
          {chat.hasKey ? 'Save' : 'Start chatting'}
        </button>
        {canCancel && (
          <button type="button" className="btn" onClick={onDone}>
            Cancel
          </button>
        )}
        {chat.hasKey &&
          (confirmRemove ? (
            <span className="pf-confirm">
              <button
                type="button"
                className="btn danger-btn"
                onClick={() => {
                  chat.removeKey();
                  setKey('');
                  setConfirmRemove(false);
                }}
              >
                Remove key
              </button>
              <button type="button" className="btn" onClick={() => setConfirmRemove(false)}>
                Keep
              </button>
            </span>
          ) : (
            <button type="button" className="link danger-link" onClick={() => setConfirmRemove(true)}>
              Remove key
            </button>
          ))}
      </div>
    </form>
  );
}

/** Just enough formatting for chat answers: paragraphs, bullet/numbered lists and **bold**. No HTML is injected. */
export function Rich({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((t, i) => <li key={i}>{inline(t)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)/.exec(line);
    const num = /^\s*\d+[.)]\s+(.*)/.exec(line);
    if (bullet || num) {
      const ordered = !!num;
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? num)![1]);
    } else if (!line.trim()) flush();
    else {
      flush();
      blocks.push(<p key={blocks.length}>{inline(line.replace(/^#+\s*/, ''))}</p>);
    }
  }
  flush();
  return <>{blocks}</>;
}

function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <b key={i}>{part.slice(2, -2)}</b> : part));
}
