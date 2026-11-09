import { z } from 'zod';
import type { PracticeUseCases } from '@/application/use-cases/practice.use-cases';
import { LEVEL_CODES } from '@/entities/models/mathmate';
import { ApplicationError } from '@/entities/errors/application-error';

const uuid = z.string().uuid();
const occurredAt = z.string().datetime({ offset: true });
const action = z.object({
  id: uuid,
  sessionId: uuid,
  attemptId: uuid,
  occurredAt,
});
const eventSchema = z
  .object({
    id: uuid,
    type: z.enum([
      'page_view',
      'level_selected',
      'problem_selected',
      'chat_opened',
      'chat_closed',
      'theme_changed',
      'activity_heartbeat',
      'page_hidden',
      'page_visible',
      'answer_input_changed',
      'difficulty_rated',
      'helpfulness_rated',
      'step_closed',
    ]),
    occurredAt,
    attemptId: uuid.optional(),
    stepId: uuid.optional(),
    activeMs: z.number().int().min(0).max(60000).optional(),
    payload: z
      .record(z.string(), z.json())
      .refine(
        (value) => JSON.stringify(value).length <= 2000,
        'Hendelsen er for stor.',
      )
      .optional(),
  })
  .strict();

export class PracticeController {
  constructor(private readonly useCases: PracticeUseCases) {}
  bootstrap(body: unknown, verifiedBrowserId: string | null) {
    const input = z
      .object({
        id: uuid,
        browserId: uuid.optional(),
        sessionId: uuid.optional(),
        renew: z.boolean().optional(),
      })
      .strict()
      .parse(body);
    return this.useCases.bootstrap({ ...input, verifiedBrowserId });
  }
  problems(search: URLSearchParams) {
    const input = z
      .object({
        level: z.enum(LEVEL_CODES),
        offset: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(150).default(150),
      })
      .parse(Object.fromEntries(search));
    return this.useCases.problems(input.level, input.offset, input.limit);
  }
  action(path: string, userId: string, body: unknown) {
    switch (path) {
      case 'attempts':
        return this.useCases.startAttempt(
          userId,
          action.extend({ problemId: uuid }).strict().parse(body),
        );
      case 'mode':
        return this.useCases.selectMode(
          userId,
          action
            .extend({ mode: z.enum(['self', 'guided']) })
            .strict()
            .parse(body),
        );
      case 'steps':
        return this.useCases.revealStep(
          userId,
          action.extend({ stepId: uuid }).strict().parse(body),
        );
      case 'answer':
        return this.useCases.revealAnswer(userId, action.strict().parse(body));
      case 'submissions':
        return this.useCases.submitAnswer(
          userId,
          action
            .extend({
              answer: z
                .string()
                .min(1)
                .max(3000)
                .refine((value) => value.trim().length > 0),
            })
            .strict()
            .parse(body),
        );
      case 'leave':
        return this.useCases.leaveAttempt(
          userId,
          action
            .extend({
              reason: z.enum([
                'next_problem',
                'previous_problem',
                'level_change',
                'reload',
                'selection',
                'page_closed',
              ]),
            })
            .strict()
            .parse(body),
        );
      case 'new-chat':
        return this.useCases.newChat(
          userId,
          action.extend({ threadId: uuid }).strict().parse(body),
        );
      case 'chat':
        return this.useCases.chat(
          userId,
          action
            .extend({
              threadId: uuid,
              responseId: uuid,
              content: z.string().trim().min(1).max(3000),
            })
            .strict()
            .parse(body),
        );
      case 'events': {
        const input = z
          .object({
            sessionId: uuid,
            events: z.array(eventSchema).min(1).max(50),
          })
          .strict()
          .parse(body);
        return this.useCases.events(userId, input.sessionId, input.events);
      }
      default:
        throw new ApplicationError(
          'not_found',
          'Denne funksjonen finnes ikke.',
          404,
        );
    }
  }
  messages(userId: string, search: URLSearchParams) {
    if (search.has('messageId'))
      return this.useCases
        .message(userId, uuid.parse(search.get('messageId')))
        .then((message) => ({ message }));
    return this.useCases
      .messages(userId, uuid.parse(search.get('threadId')))
      .then((messages) => ({ messages }));
  }
}
