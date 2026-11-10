import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IPracticeRepository } from '@/application/repositories/practice.repository.interface';
import { ApplicationError } from '@/entities/errors/application-error';
import {
  LEVEL_CODES,
  levelLabel,
  type ChatMessage,
  type CommandResult,
  type FullProblem,
  type Json,
  type Level,
  type Problem,
  type SolutionStep,
} from '@/entities/models/mathmate';

const PUBLIC_PROBLEM_FIELDS =
  'id,source_id,version,question,level_code,difficulty,category,answer_unit';
const ERRORS: Record<string, [number, string]> = {
  session_not_found: [404, 'Fant ikke økten. Last siden på nytt.'],
  session_expired: [
    409,
    'Økten er avsluttet. Last siden på nytt for å starte en ny økt.',
  ],
  browser_not_found: [
    401,
    'Nettleserprofilen er ikke tilgjengelig. Last siden på nytt.',
  ],
  attempt_not_found: [404, 'Fant ikke dette oppgaveforsøket.'],
  problem_not_found: [404, 'Oppgaven er ikke tilgjengelig.'],
  step_not_found: [404, 'Fant ikke dette løsningssteget.'],
  thread_not_found: [
    404,
    'Denne samtalen er avsluttet eller finnes ikke. Start en ny samtale.',
  ],
  message_not_found: [404, 'Fant ikke denne meldingen.'],
  chat_pending: [
    409,
    'AI-veilederen arbeider allerede med et svar i denne samtalen.',
  ],
  chat_rate_limit: [
    429,
    'Du har sendt mange meldinger på kort tid. Vent ett minutt og prøv igjen.',
  ],
  chat_day_limit: [
    429,
    'Dagens grense for AI-meldinger er nådd for denne nettleseren.',
  ],
  chat_global_limit: [
    429,
    'Dagens samlede grense for AI-chatten er nådd. Oppgavene fungerer fortsatt.',
  ],
  request_conflict: [409, 'Forespørselen kunne ikke knyttes til denne økten.'],
};

function databaseError(
  error: { code?: string; message?: string } | null,
): never {
  if (error?.code === '2200H')
    throw new ApplicationError(
      'user_number_capacity',
      'Det er ikke flere ledige brukernumre. Kontakt den som drifter MathMate.',
      503,
    );
  const known = error?.message ? ERRORS[error.message] : undefined;
  if (known) throw new ApplicationError(error!.message!, known[1], known[0]);
  console.error('Supabase operation failed', {
    code: error?.code ?? 'unknown',
  });
  throw new ApplicationError(
    'database_unavailable',
    'Kunne ikke lagre eller hente data. Kontroller tilkoblingen og prøv igjen.',
    503,
  );
}

export class SupabasePracticeRepository implements IPracticeRepository {
  constructor(private readonly db: SupabaseClient) {}

  async profileExists(userId: string) {
    const { data, error } = await this.db
      .from('app_users')
      .select('id')
      .eq('id', userId)
      .maybeSingle();
    if (error) databaseError(error);
    return Boolean(data);
  }
  async registerProfile(candidateId: string) {
    let id = candidateId;
    for (let index = 0; index < 2; index++) {
      const { error } = await this.db.from('app_users').insert({ id });
      if (!error) return id;
      if (error.code !== '23505') databaseError(error);
      id = randomUUID();
    }
    throw new ApplicationError(
      'identity_unavailable',
      'Kunne ikke opprette nettleserprofilen.',
      503,
    );
  }
  async profileNumber(userId: string): Promise<number> {
    const { data, error } = await this.db
      .from('app_users')
      .select('user_number')
      .eq('id', userId)
      .maybeSingle();
    if (error) databaseError(error);
    if (!data)
      throw new ApplicationError(
        'browser_not_found',
        'Fant ikke nettleserprofilen. Last siden på nytt.',
        401,
      );
    return data.user_number as number;
  }
  async levels(): Promise<Level[]> {
    const { data, error } = await this.db.rpc('mathmate_level_counts');
    if (error) databaseError(error);
    const counts = data as { level_code: string; count: number }[];
    return LEVEL_CODES.map((id) => ({
      id,
      label: levelLabel(id),
      count: Number(counts.find((row) => row.level_code === id)?.count ?? 0),
    })).filter((level) => level.count > 0);
  }
  async problems(level: string, offset: number, limit: number) {
    const { data, count, error } = await this.db
      .from('problems')
      .select(PUBLIC_PROBLEM_FIELDS, { count: 'exact' })
      .eq('level_code', level)
      .eq('is_active', true)
      .order('source_id')
      .range(offset, offset + limit - 1);
    if (error) databaseError(error);
    return { problems: data as Problem[], total: count ?? 0 };
  }
  async problem(id: string): Promise<FullProblem> {
    const { data, error } = await this.db
      .from('problems')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) databaseError(error);
    if (!data)
      throw new ApplicationError(
        'problem_not_found',
        'Oppgaven finnes ikke.',
        404,
      );
    return data as FullProblem;
  }
  async attemptProblem(userId: string, sessionId: string, attemptId: string) {
    const { data: session, error: sessionError } = await this.db
      .from('sessions')
      .select('id')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .maybeSingle();
    if (sessionError) databaseError(sessionError);
    if (!session)
      throw new ApplicationError('session_not_found', 'Fant ikke økten.', 404);
    const { data, error } = await this.db
      .from('problem_attempts')
      .select('problem_id')
      .eq('id', attemptId)
      .eq('session_id', sessionId)
      .maybeSingle();
    if (error) databaseError(error);
    if (!data)
      throw new ApplicationError(
        'attempt_not_found',
        'Fant ikke oppgaveforsøket.',
        404,
      );
    return this.problem(data.problem_id);
  }
  async steps(problemId: string): Promise<SolutionStep[]> {
    const { data, error } = await this.db
      .from('solution_steps')
      .select('*')
      .eq('problem_id', problemId)
      .order('step_number');
    if (error) databaseError(error);
    return data as SolutionStep[];
  }
  async command<T = CommandResult>(
    userId: string,
    command: Record<string, Json | undefined>,
  ): Promise<T> {
    const { data, error } = await this.db.rpc('mathmate_command', {
      p_user_id: userId,
      p_command: command,
    });
    if (error) databaseError(error);
    return data as T;
  }
  async messages(userId: string, threadId: string): Promise<ChatMessage[]> {
    const { data: thread, error } = await this.db
      .from('chat_threads')
      .select('attempt_id')
      .eq('id', threadId)
      .maybeSingle();
    if (error) databaseError(error);
    if (!thread)
      throw new ApplicationError(
        'thread_not_found',
        'Fant ikke samtalen.',
        404,
      );
    const { data: attempt, error: attemptError } = await this.db
      .from('problem_attempts')
      .select('session_id')
      .eq('id', thread.attempt_id)
      .single();
    if (attemptError) databaseError(attemptError);
    const { data: session, error: sessionError } = await this.db
      .from('sessions')
      .select('id')
      .eq('id', attempt.session_id)
      .eq('user_id', userId)
      .maybeSingle();
    if (sessionError) databaseError(sessionError);
    if (!session)
      throw new ApplicationError(
        'thread_not_found',
        'Fant ikke samtalen.',
        404,
      );
    const { data, error: messagesError } = await this.db
      .from('chat_messages')
      .select('*')
      .eq('thread_id', threadId)
      .order('sequence_number', { ascending: false })
      .limit(100);
    if (messagesError) databaseError(messagesError);
    return (data as ChatMessage[]).reverse();
  }
  async message(userId: string, messageId: string) {
    const { data, error } = await this.db
      .from('chat_messages')
      .select('thread_id')
      .eq('id', messageId)
      .maybeSingle();
    if (error) databaseError(error);
    if (!data)
      throw new ApplicationError(
        'message_not_found',
        'Fant ikke meldingen.',
        404,
      );
    const messages = await this.messages(userId, data.thread_id);
    const message = messages.find((item) => item.id === messageId);
    if (!message)
      throw new ApplicationError(
        'message_not_found',
        'Fant ikke meldingen.',
        404,
      );
    return message;
  }
  async context(attemptId: string) {
    const { data, error } = await this.db
      .from('events')
      .select('event_type,step_id')
      .eq('attempt_id', attemptId)
      .in('event_type', ['answer_revealed', 'step_opened']);
    if (error) databaseError(error);
    return {
      answerRevealed: data.some(
        (event) => event.event_type === 'answer_revealed',
      ),
      stepsOpened: [
        ...new Set(
          data
            .filter((event) => event.step_id)
            .map((event) => event.step_id as string),
        ),
      ],
    };
  }
  async closeIdleSessions() {
    const { data, error } = await this.db.rpc('mathmate_close_idle_sessions');
    if (error) databaseError(error);
    return Number(data);
  }
  async endSession(userId: string, sessionId: string) {
    const { error } = await this.db.rpc('mathmate_end_session', {
      p_user_id: userId,
      p_session_id: sessionId,
    });
    if (error) databaseError(error);
  }
}
