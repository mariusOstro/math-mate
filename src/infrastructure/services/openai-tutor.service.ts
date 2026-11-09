import OpenAI from 'openai';
import type { ITutorService } from '@/application/services/tutor.service.interface';
import { tutorPrompt } from '@/application/services/tutor-prompt';
import { ApplicationError } from '@/entities/errors/application-error';

export class OpenAiTutorService implements ITutorService {
  async reply(input: Parameters<ITutorService['reply']>[0]) {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key)
      throw new ApplicationError(
        'ai_not_configured',
        'AI-chatten er ikke konfigurert. Oppgavene fungerer fortsatt.',
        503,
      );
    const client = new OpenAI({ apiKey: key, timeout: 40000, maxRetries: 0 });
    const started = performance.now();
    try {
      const response = await client.chat.completions.create({
        model: process.env.OPENAI_MODEL?.trim() || 'gpt-4o',
        store: false,
        max_completion_tokens: 700,
        messages: [
          {
            role: 'system',
            content: tutorPrompt(input.problem, input.context),
          },
          ...input.messages.slice(-19),
        ],
      });
      const content = response.choices[0]?.message?.content?.trim();
      if (!content)
        throw new ApplicationError(
          'ai_empty_response',
          'AI-veilederen ga et tomt svar. Prøv igjen.',
          502,
        );
      return {
        content,
        model: response.model,
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        requestId: response._request_id ?? null,
        latencyMs: Math.round(performance.now() - started),
      };
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      if (error instanceof OpenAI.APIError) {
        if (error.status === 401)
          throw new ApplicationError(
            'ai_key_invalid',
            'AI-nøkkelen ble avvist. Kontakt den som drifter MathMate.',
            503,
          );
        if (error.status === 429)
          throw new ApplicationError(
            'ai_provider_limit',
            'AI-tjenesten har nådd en bruksgrense. Prøv igjen senere.',
            429,
          );
        if (error.status === 404)
          throw new ApplicationError(
            'ai_model_unavailable',
            'Den valgte AI-modellen er ikke tilgjengelig.',
            503,
          );
      }
      throw new ApplicationError(
        'ai_unavailable',
        'Fikk ikke svar fra AI-veilederen. Prøv igjen om litt.',
        503,
      );
    }
  }
}
