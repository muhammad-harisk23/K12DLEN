/**
 * Provider-independent AI adapter interface for the room tutor.
 *
 * A provider implements `generateAnswer` and is injected into the edge
 * function pipeline. The stored conversation format never depends on the
 * provider's wire format — `ModeratedAnswer` is the only type that crosses
 * this boundary.
 */

export interface ChatTurn {
  role: 'system' | 'user';
  content: string;
}

export interface GenerateRequest {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  timeoutMs: number;
}

export interface GeneratedAnswer {
  text: string;
  model: string;
}

export interface ProviderUnavailable {
  kind: 'unavailable';
  retryAfterSeconds: number | null; // from provider Retry-After, clamped
  temporary: boolean; // true = transient (worth retrying), false = quota/budget
}

export type ProviderResult = GeneratedAnswer | ProviderUnavailable | { kind: 'error'; message: string };

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  generateAnswer(req: GenerateRequest): Promise<ProviderResult>;
}

// ---------------------------------------------------------------------------
// Groq implementation (initial platform-owned provider)
// ---------------------------------------------------------------------------

const GROQ_API_BASE = 'https://api.groq.com/openai/v1/chat/completions';

export class GroqProvider implements AiProvider {
  readonly name = 'groq';
  readonly model: string;

  constructor(
    private apiKey: string,
    model = 'openai/gpt-oss-20b',
    private timeoutMs = 20000,
    private maxRetries = 1
  ) {
    this.model = model;
  }

  async generateAnswer(req: GenerateRequest): Promise<ProviderResult> {
    for (let attempt = 0; ; attempt++) {
      const result = await this.attempt(req);
      if (result.kind === 'unavailable' && result.temporary && attempt < this.maxRetries) {
        const waitMs = Math.min((result.retryAfterSeconds ?? 1) * 1000, 4000);
        await sleep(waitMs);
        continue;
      }
      return result;
    }
  }

  private async attempt(req: GenerateRequest): Promise<ProviderResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs || this.timeoutMs);
    try {
      const res = await fetch(GROQ_API_BASE, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.4,
          max_tokens: req.maxTokens,
          messages: [
            { role: 'system', content: req.systemPrompt },
            { role: 'user', content: req.userPrompt },
          ],
        }),
      });

      if (!res.ok) {
        if (res.status === 429) {
          const ra = res.headers.get('retry-after');
          const parsed = ra ? Number.parseFloat(ra) : NaN;
          const retryAfterSeconds = Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, 30)) : null;
          // Groq 429 can be rate limit (temporary) or quota/billing (not).
          const bodyText = await res.text();
          let temporary = true;
          try {
            const body = JSON.parse(bodyText) as { error?: { code?: string; type?: string } };
            const code = body.error?.code ?? '';
            if (code === 'quota_exceeded' || body.error?.type === 'insufficient_quota') temporary = false;
          } catch {
            // keep temporary = true
          }
          return { kind: 'unavailable', retryAfterSeconds, temporary };
        }
        if (res.status >= 500) {
          return { kind: 'unavailable', retryAfterSeconds: 2, temporary: true };
        }
        return { kind: 'error', message: `Provider rejected the request (${res.status}).` };
      }

      const data = (await res.json()) as {
        model?: string;
        choices?: { message?: { content?: string } }[];
      };
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) {
        return { kind: 'error', message: 'The tutor returned an empty answer.' };
      }
      return { kind: 'generated', text: text.trim(), model: data.model ?? this.model };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { kind: 'unavailable', retryAfterSeconds: 2, temporary: true };
      }
      return { kind: 'error', message: 'Could not reach the AI provider.' };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
