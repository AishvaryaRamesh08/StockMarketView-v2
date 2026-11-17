import { afterEach, describe, expect, it, vi } from 'vitest';
import { converse, describeFailure, trimHistory, type Content } from './gemini.ts';

const settings = { key: 'test-key-123', model: 'gemini-3.8-flash' };

function reply(parts: object[]) {
  return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('converse', () => {
  it('runs a tool, echoes the model turn (with its thought signature) and returns the final text', async () => {
    const bodies: Array<{ contents: Content[] }> = [];
    const urls: string[] = [];
    const headers: Array<Record<string, string>> = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      urls.push(url);
      headers.push(init.headers as Record<string, string>);
      bodies.push(JSON.parse(init.body as string));
      return bodies.length === 1
        ? reply([{ functionCall: { name: 'show_chart', args: { ticker: 'Reliance', period: '1y' }, id: 'call-1' }, thoughtSignature: 'sig-abc' }])
        : reply([{ text: 'Opened Reliance for one year.' }]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const notes: string[] = [];
    const execute = vi.fn(async () => ({ result: { ok: true }, note: 'Opened RELIANCE · 1Y · daily' }));
    const r = await converse({ settings, system: 'sys', history: [], message: 'show reliance 1y', tools: [], execute, onNote: (n) => notes.push(n) });

    expect(execute).toHaveBeenCalledWith({ name: 'show_chart', args: { ticker: 'Reliance', period: '1y' }, id: 'call-1' });
    expect(r.text).toBe('Opened Reliance for one year.');
    expect(notes).toEqual(['Opened RELIANCE · 1Y · daily']);
    // Second request: user message, model turn unchanged (signature kept), then the function response with the call id.
    const second = bodies[1].contents;
    expect(second[1].parts[0].thoughtSignature).toBe('sig-abc');
    expect(second[2]).toEqual({ role: 'user', parts: [{ functionResponse: { name: 'show_chart', id: 'call-1', response: { ok: true } } }] });
    expect(r.history).toHaveLength(4);
  });

  it('sends the key only in a header, never in the URL', async () => {
    const fetchMock = vi.fn(async () => reply([{ text: 'hi' }]));
    vi.stubGlobal('fetch', fetchMock);
    await converse({ settings, system: 's', history: [], message: 'hello', tools: [], execute: async () => ({ result: {} }) });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain('test-key-123');
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key-123');
  });

  it('reports a failing tool to the model as an error instead of stopping', async () => {
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init: RequestInit) => {
        n++;
        if (n === 1) return reply([{ functionCall: { name: 'get_quote', args: { ticker: 'ZZZ' } } }]);
        const body = JSON.parse(init.body as string) as { contents: Content[] };
        expect(body.contents[2].parts[0].functionResponse?.response).toEqual({ error: 'not found' });
        return reply([{ text: "I couldn't find that one." }]);
      }),
    );
    const r = await converse({
      settings,
      system: 's',
      history: [],
      message: 'price of zzz',
      tools: [],
      execute: async () => {
        throw new Error('not found');
      },
    });
    expect(r.text).toBe("I couldn't find that one.");
  });

  it('turns HTTP failures into actionable messages', () => {
    expect(describeFailure(400, { error: { message: 'API key not valid. Please pass a valid API key.', details: [{ reason: 'API_KEY_INVALID' }] } }, 'm').kind).toBe('key');
    expect(describeFailure(404, {}, 'gemini-x').message).toMatch(/gemini-x/);
    expect(describeFailure(429, {}, 'm').kind).toBe('quota');
  });
});

describe('trimHistory', () => {
  const u = (t: string): Content => ({ role: 'user', parts: [{ text: t }] });
  const m = (t: string): Content => ({ role: 'model', parts: [{ text: t }] });
  const call: Content = { role: 'model', parts: [{ functionCall: { name: 'x' } }] };
  const resp: Content = { role: 'user', parts: [{ functionResponse: { name: 'x', response: {} } }] };

  it('keeps short histories as they are', () => {
    const h = [u('a'), m('b')];
    expect(trimHistory(h, 10)).toBe(h);
  });
  it('cuts at a user message, never between a call and its response', () => {
    const h = [u('1'), call, resp, m('a'), u('2'), call, resp, m('b')];
    const t = trimHistory(h, 5);
    expect(t[0]).toEqual(u('2'));
    expect(t).toHaveLength(4);
  });
});

describe('retries', () => {
  it("retries Google's temporary errors, then shows Google's own message", async () => {
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        n++;
        return new Response(JSON.stringify({ error: { code: 500, message: 'Internal error encountered.', status: 'INTERNAL' } }), { status: 500 });
      }),
    );
    const { generate } = await import('./gemini.ts');
    await expect(generate(settings, { systemInstruction: 's', contents: [], tools: [] }, undefined, [1, 1])).rejects.toThrow(/500: Internal error encountered/);
    expect(n).toBe(3);
  });
});

describe('model fallback', () => {
  it('switches to the next model when the chosen one is overloaded, and says so', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        seen.push(url.split('/models/')[1].split(':')[0]);
        if (url.includes('gemini-3.8-flash')) return new Response(JSON.stringify({ error: { code: 503, message: 'This model is currently experiencing high demand.' } }), { status: 503 });
        return reply([{ text: 'hello there' }]);
      }),
    );
    const notes: string[] = [];
    const r = await converse({ settings, system: 's', history: [], message: 'hello', tools: [], execute: async () => ({ result: {} }), onNote: (n) => notes.push(n), models: ['gemini-3.8-flash', 'gemini-3.5-flash-lite'], retryDelays: [1] });
    expect(r.text).toBe('hello there');
    expect(r.model).toBe('gemini-3.5-flash-lite');
    expect(seen).toEqual(['gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite']);
    expect(notes[0]).toMatch(/gemini-3.8-flash is busy right now, switched to gemini-3.5-flash-lite/);
  });
  it('does not fall back on a bad key', async () => {
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        n++;
        return new Response(JSON.stringify({ error: { message: 'API key not valid.', details: [{ reason: 'API_KEY_INVALID' }] } }), { status: 400 });
      }),
    );
    await expect(converse({ settings, system: 's', history: [], message: 'hi', tools: [], execute: async () => ({ result: {} }), models: ['a-model', 'b-model'] })).rejects.toThrow(/not valid/);
    expect(n).toBe(1);
  });
});
