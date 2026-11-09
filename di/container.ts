import 'server-only';
import { PracticeUseCases } from '@/application/use-cases/practice.use-cases';
import { SupabasePracticeRepository } from '@/infrastructure/repositories/supabase-practice.repository';
import { OpenAiTutorService } from '@/infrastructure/services/openai-tutor.service';
import { createServerDatabase } from '@/lib/supabase';
import { APP_VERSION, positiveSetting } from '@/lib/server-config';

// Stateless composition root. Persistent identities, sessions and chat live in Supabase.
export function getPracticeUseCases() {
  return new PracticeUseCases(
    new SupabasePracticeRepository(createServerDatabase()),
    new OpenAiTutorService(),
    {
      appVersion: APP_VERSION,
      chatEnabled: Boolean(process.env.OPENAI_API_KEY?.trim()),
      model: process.env.OPENAI_MODEL?.trim() || 'gpt-4o',
      minuteLimit: positiveSetting('CHAT_REQUESTS_PER_MINUTE', 8),
      dayLimit: positiveSetting('CHAT_REQUESTS_PER_DAY', 100),
      globalLimit: positiveSetting('CHAT_GLOBAL_REQUESTS_PER_DAY', 1000),
    },
  );
}
