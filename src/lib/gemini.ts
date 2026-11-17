/**
 * Minimal Gemini client for the browser. The visitor's own key is sent only to Google, in the
 * x-goog-api-key header (never in a URL), and never passes through this site's Worker.
 *
 * Uses the stateless generateContent REST API with function calling. Model turns are kept
 * exactly as returned, so any thoughtSignature on a functionCall part is echoed back unchanged,
 * which Gemini 3+ models require for multi-step tool use.
 */

export interface FunctionCall {
  name: string;
  args?: Record<string, unknown>;
  id?: string;
}

export interface Part {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: FunctionCall;
  functionResponse?: { name: string; id?: string; response: Record<string, unknown> };
}

export interface Content {
  role: 'user' | 'model';
  parts: Part[];
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export interface GeminiSettings {
  key: string;
  model: string;
}

export const DEFAULT_MODEL = 'gemini-3.8-flash';
/** Offered in the model box; any model ID the visitor types is accepted. */
export const SUGGESTED_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-4-hydrogen'];
export const MODEL_RE = /^[a-z0-9][a-z0-9.\-]{1,62}$/i;

export type GeminiErrorKind = 'key' | 'quota' | 'model' | 'network' | 'blocked' | 'server' | 'other';

export class GeminiError extends Error {
  kind: GeminiErrorKind;
  constructor(kind: GeminiErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';

/** Turns an HTTP failure into a message a visitor can act on. Google's messages never contain the key. */
export function describeFailure(status: number, body: { error?: { message?: string; status?: string; details?: Array<{ reason?: string }> } }, model: string): GeminiError {
  const reason = body.error?.details?.find((d) => d.reason)?.reason ?? '';
  const msg = body.error?.message ?? '';
  if (reason === 'API_KEY_INVALID' || /api key not valid/i.test(msg)) return new GeminiError('key', 'Google says this API key is not valid. Check it in Chat settings.');
  if (status === 401 || status === 403) return new GeminiError('key', 'This API key is not allowed to use the Gemini API. Check its restrictions in Google AI Studio.');
  if (status === 404) return new GeminiError('model', `The model “${model}” wasn't found. Pick another model in Chat settings.`);
  if (status === 429) return new GeminiError('quota', "Your Gemini key has hit Google's rate limit or quota. Wait a minute and try again, or pick a lighter model.");
  if (status >= 500) return new GeminiError('server', `Google’s Gemini service returned an error (${status}${msg ? `: ${msg}` : ''}). Try again in a moment, or pick another model in Chat settings.`);
  return new GeminiError('other', msg ? `Gemini: ${msg}` : `Gemini request failed (${status}).`);
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

/** generateContent, retried twice on Google's own temporary errors (500/503). */
export async function generate(
  settings: GeminiSettings,
  body: { systemInstruction: string; contents: Content[]; tools: FunctionDeclaration[] },
  signal?: AbortSignal,
  retryDelays = [1200, 3000],
): Promise<Content> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await generateOnce(settings, body, signal);
    } catch (err) {
      if (!(err instanceof GeminiError) || err.kind !== 'server' || attempt >= retryDelays.length) throw err;
      await sleep(retryDelays[attempt], signal);
    }
  }
}

async function generateOnce(
  settings: GeminiSettings,
  body: { systemInstruction: string; contents: Content[]; tools: FunctionDeclaration[] },
  signal?: AbortSignal,
): Promise<Content> {
  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}${encodeURIComponent(settings.model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: body.systemInstruction }] },
        contents: body.contents,
        tools: [{ functionDeclarations: body.tools }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
      }),
      signal,
      // Keep the key out of anything the browser might send elsewhere.
      referrerPolicy: 'no-referrer',
      credentials: 'omit',
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new GeminiError('network', "Couldn't reach Google's Gemini service. Check your connection.");
  }
  const json = (await res.json().catch(() => ({}))) as {
    candidates?: Array<{ content?: Content; finishReason?: string }>;
    promptFeedback?: { blockReason?: string };
    error?: { message?: string; status?: string; details?: Array<{ reason?: string }> };
  };
  if (!res.ok) throw describeFailure(res.status, json, settings.model);
  const cand = json.candidates?.[0];
  if (!cand?.content?.parts?.length) {
    if (json.promptFeedback?.blockReason || cand?.finishReason === 'SAFETY') throw new GeminiError('blocked', 'Gemini declined to answer that. Try rephrasing.');
    return { role: 'model', parts: [{ text: '' }] };
  }
  return { role: 'model', parts: cand.content.parts };
}

/** Visible answer text of a model turn (thought summaries left out). */
export function textOf(c: Content): string {
  return c.parts
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join('')
    .trim();
}

export function callsOf(c: Content): FunctionCall[] {
  return c.parts.filter((p) => p.functionCall).map((p) => p.functionCall!);
}

/**
 * Keeps the most recent turns within `maxContents`, starting at a user's own message so a
 * function call is never separated from its response.
 */
export function trimHistory(history: Content[], maxContents = 40): Content[] {
  if (history.length <= maxContents) return history;
  for (let i = history.length - maxContents; i < history.length; i++) {
    const c = history[i];
    if (c.role === 'user' && c.parts.some((p) => p.text != null) && !c.parts.some((p) => p.functionResponse)) return history.slice(i);
  }
  // A single turn longer than the limit: keep it whole from its user message.
  for (let i = history.length - 1; i >= 0; i--) if (history[i].role === 'user' && history[i].parts.some((p) => p.text != null)) return history.slice(i);
  return history;
}

export interface ToolOutcome {
  /** Sent back to the model. */
  result: Record<string, unknown>;
  /** One-line note shown in the chat, e.g. "Opened RELIANCE · 1Y · daily". */
  note?: string;
}

/**
 * One user message through to the model's final answer, running any tools it calls.
 * Returns the full history (to send next time), the answer text and the notes of what was done.
 */
/** Models to try, in order, when the chosen one is overloaded or out of quota. */
export function fallbackOrder(chosen: string): string[] {
  return [chosen, ...SUGGESTED_MODELS.filter((m) => m !== chosen)];
}

export async function converse(opts: {
  settings: GeminiSettings;
  system: string;
  history: Content[];
  message: string;
  tools: FunctionDeclaration[];
  execute: (call: FunctionCall) => Promise<ToolOutcome>;
  signal?: AbortSignal;
  onNote?: (note: string) => void;
  maxSteps?: number;
  /** Try these models in turn if the first is overloaded or out of quota (only before any tool has run). */
  models?: string[];
  retryDelays?: number[];
}): Promise<{ history: Content[]; text: string; model: string }> {
  const models = opts.models?.length ? opts.models : [opts.settings.model];
  let mi = 0;
  let settings = { ...opts.settings, model: models[0] };
  let history: Content[] = [...trimHistory(opts.history), { role: 'user', parts: [{ text: opts.message }] }];
  for (let step = 0; step < (opts.maxSteps ?? 6); step++) {
    let reply: Content;
    for (;;) {
      try {
        reply = await generate(settings, { systemInstruction: opts.system, contents: history, tools: opts.tools }, opts.signal, opts.retryDelays);
        break;
      } catch (err) {
        const busy = err instanceof GeminiError && (err.kind === 'server' || err.kind === 'quota' || err.kind === 'model');
        // Switching models mid-way through tool calls would break Gemini's thought signatures.
        if (!busy || step > 0 || mi + 1 >= models.length) throw err;
        const from = settings.model;
        settings = { ...settings, model: models[++mi] };
        opts.onNote?.(`${from} is ${err.kind === 'quota' ? 'out of quota' : err.kind === 'model' ? 'not available' : 'busy'} right now, switched to ${settings.model}`);
      }
    }
    history = [...history, reply];
    const calls = callsOf(reply);
    if (!calls.length) return { history, text: textOf(reply), model: settings.model };
    const responses: Part[] = [];
    for (const call of calls) {
      let outcome: ToolOutcome;
      try {
        outcome = await opts.execute(call);
      } catch (err) {
        if ((err as Error).name === 'AbortError') throw err;
        outcome = { result: { error: (err as Error).message || 'The tool failed.' } };
      }
      if (outcome.note) opts.onNote?.(outcome.note);
      responses.push({ functionResponse: { name: call.name, ...(call.id ? { id: call.id } : {}), response: outcome.result } });
    }
    history = [...history, { role: 'user', parts: responses }];
  }
  return { history, text: 'I stopped after several steps. Try asking for one thing at a time.', model: settings.model };
}
