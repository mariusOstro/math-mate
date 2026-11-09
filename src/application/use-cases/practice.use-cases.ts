import { randomUUID } from 'node:crypto';
import type { IPracticeRepository } from '@/application/repositories/practice.repository.interface';
import type { ITutorService } from '@/application/services/tutor.service.interface';
import { PROMPT_VERSION } from '@/application/services/tutor-prompt';
import {
  CHECKER_VERSION,
  evaluateAnswer,
} from '@/entities/models/answer-checker';
import { ApplicationError } from '@/entities/errors/application-error';
import type {
  AnswerResult,
  Attempt,
  Json,
  Session,
  TelemetryEvent,
} from '@/entities/models/mathmate';

export interface ActionContext {
  id: string;
  sessionId: string;
  attemptId: string;
  occurredAt: string;
}
interface ChatRequest extends ActionContext {
  threadId: string;
  responseId: string;
  content: string;
}
export interface PracticeSettings {
  appVersion: string;
  chatEnabled: boolean;
  model: string;
  minuteLimit: number;
  dayLimit: number;
  globalLimit: number;
}

export class PracticeUseCases {
  constructor(
    private readonly repo: IPracticeRepository,
    private readonly tutor: ITutorService,
    private readonly settings: PracticeSettings,
  ) {}

  async bootstrap(input: {
    browserId?: string;
    sessionId?: string;
    verifiedBrowserId: string | null;
    id: string;
    renew?: boolean;
  }) {
    const userId =
      input.verifiedBrowserId &&
      (await this.repo.profileExists(input.verifiedBrowserId))
        ? input.verifiedBrowserId
        : await this.repo.registerProfile(input.browserId ?? randomUUID());
    if (input.renew && input.sessionId && userId === input.verifiedBrowserId)
      await this.repo.endSession(userId, input.sessionId);
    const session = await this.repo.command<Session>(userId, {
      type: 'open_session',
      id: input.id,
      sessionId:
        !input.renew && userId === input.verifiedBrowserId
          ? (input.sessionId ?? randomUUID())
          : randomUUID(),
      appVersion: this.settings.appVersion,
    });
    return {
      userId,
      ...session,
      levels: await this.repo.levels(),
      chatEnabled: this.settings.chatEnabled,
      appVersion: this.settings.appVersion,
    };
  }
  problems(level: string, offset: number, limit: number) {
    return this.repo.problems(level, offset, limit);
  }

  async startAttempt(
    userId: string,
    input: ActionContext & { problemId: string },
  ) {
    const result = await this.repo.command<Attempt>(userId, {
      ...input,
      type: 'start_attempt',
    });
    const steps = await this.repo.steps(input.problemId);
    return {
      ...result,
      steps: steps.map(({ id, title, step_number }) => ({
        id,
        title,
        step_number,
      })),
    };
  }
  selectMode(
    userId: string,
    input: ActionContext & { mode: 'self' | 'guided' },
  ) {
    return this.repo.command(userId, { ...input, type: 'mode_selected' });
  }
  async revealStep(userId: string, input: ActionContext & { stepId: string }) {
    const problem = await this.repo.attemptProblem(
      userId,
      input.sessionId,
      input.attemptId,
    );
    const steps = await this.repo.steps(problem.id);
    const step = steps.find((item) => item.id === input.stepId);
    if (!step)
      throw new ApplicationError('step_not_found', 'Fant ikke steget.', 404);
    await this.repo.command(userId, { ...input, type: 'reveal_step' });
    return step;
  }
  async revealAnswer(userId: string, input: ActionContext) {
    const problem = await this.repo.attemptProblem(
      userId,
      input.sessionId,
      input.attemptId,
    );
    await this.repo.command(userId, { ...input, type: 'reveal_answer' });
    return {
      answer: problem.answer_value,
      unit: problem.answer_unit,
      solution: problem.solution,
    };
  }
  async submitAnswer(
    userId: string,
    input: ActionContext & { answer: string },
  ) {
    const problem = await this.repo.attemptProblem(
      userId,
      input.sessionId,
      input.attemptId,
    );
    const evaluation = evaluateAnswer(input.answer, problem);
    return this.repo.command<AnswerResult>(userId, {
      type: 'submit_answer',
      id: input.id,
      sessionId: input.sessionId,
      attemptId: input.attemptId,
      occurredAt: input.occurredAt,
      rawAnswer: input.answer,
      ...evaluation,
      checkerVersion: CHECKER_VERSION,
    });
  }
  leaveAttempt(userId: string, input: ActionContext & { reason: string }) {
    return this.repo.command(userId, {
      type: 'leave_attempt',
      id: input.id,
      sessionId: input.sessionId,
      attemptId: input.attemptId,
      occurredAt: input.occurredAt,
      payload: { reason: input.reason },
    });
  }
  events(userId: string, sessionId: string, events: TelemetryEvent[]) {
    return this.repo.command(userId, {
      type: 'event_batch',
      sessionId,
      events: events as unknown as Json,
    });
  }
  newChat(userId: string, input: ActionContext & { threadId: string }) {
    return this.repo.command(userId, { ...input, type: 'new_chat' });
  }
  messages(userId: string, threadId: string) {
    return this.repo.messages(userId, threadId);
  }
  message(userId: string, messageId: string) {
    return this.repo.message(userId, messageId);
  }
  closeIdleSessions() {
    return this.repo.closeIdleSessions();
  }

  private async persistChat(
    userId: string,
    command: Record<string, Json | undefined>,
  ) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.repo.command(userId, command);
      } catch (error) {
        if (attempt === 2) throw error;
        await new Promise((resolve) =>
          setTimeout(resolve, 200 * (attempt + 1)),
        );
      }
    }
  }
  async chat(userId: string, input: ChatRequest) {
    if (!this.settings.chatEnabled)
      throw new ApplicationError(
        'ai_not_configured',
        'AI-chatten er ikke konfigurert.',
        503,
      );
    const problem = await this.repo.attemptProblem(
      userId,
      input.sessionId,
      input.attemptId,
    );
    const context = await this.repo.context(input.attemptId);
    const started = await this.repo.command<{
      assistantMessageId: string;
      replayed: boolean;
    }>(userId, {
      ...input,
      type: 'begin_chat',
      model: this.settings.model,
      promptVersion: PROMPT_VERSION,
      minuteLimit: this.settings.minuteLimit,
      dayLimit: this.settings.dayLimit,
      globalLimit: this.settings.globalLimit,
      context: { ...context, problemVersion: problem.version },
    });
    if (started.replayed)
      return {
        message: await this.repo.message(userId, started.assistantMessageId),
      };

    let reply: Awaited<ReturnType<ITutorService['reply']>>;
    try {
      const history = await this.repo.messages(userId, input.threadId);
      reply = await this.tutor.reply({
        problem,
        context,
        messages: history
          .filter(
            (message) => message.status === 'completed' && message.content,
          )
          .map((message) => ({
            role: message.role,
            content: message.content!,
          })),
      });
    } catch (error) {
      const code =
        error instanceof ApplicationError ? error.code : 'ai_unavailable';
      try {
        await this.persistChat(userId, {
          type: 'finish_chat',
          id: input.responseId,
          sessionId: input.sessionId,
          attemptId: input.attemptId,
          messageId: input.responseId,
          occurredAt: new Date().toISOString(),
          status: 'failed',
          errorCode: code,
        });
      } catch {
        console.error('Unable to persist AI failure', {
          code: 'chat_failure_log_unavailable',
        });
      }
      throw error;
    }
    await this.persistChat(userId, {
      type: 'finish_chat',
      id: input.responseId,
      sessionId: input.sessionId,
      attemptId: input.attemptId,
      messageId: input.responseId,
      occurredAt: new Date().toISOString(),
      status: 'completed',
      content: reply.content,
      inputTokens: reply.inputTokens,
      outputTokens: reply.outputTokens,
      latencyMs: reply.latencyMs,
      providerRequestId: reply.requestId,
      resolvedModel: reply.model,
    });
    return { message: await this.repo.message(userId, input.responseId) };
  }
}
