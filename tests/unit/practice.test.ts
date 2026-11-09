import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { PracticeUseCases } from '@/application/use-cases/practice.use-cases';
import { PracticeController } from '@/interface-adapters/controllers/practice.controller';
import { evaluateAnswer } from '@/entities/models/answer-checker';
import { ApplicationError } from '@/entities/errors/application-error';
import type { IPracticeRepository } from '@/application/repositories/practice.repository.interface';
import type { FullProblem } from '@/entities/models/mathmate';

const problem: FullProblem = {
  id: randomUUID(),
  source_id: 'TEST',
  version: 1,
  question: 'Del 30 kort på 6 elever.',
  level_code: '4',
  difficulty: 1,
  category: 'divisjon',
  answer_value: '5',
  answer_unit: 'kort',
  solution: '30 / 6 = 5',
  validation_rules: {},
};
const settings = {
  appVersion: 'test',
  chatEnabled: true,
  model: 'gpt-4o',
  minuteLimit: 8,
  dayLimit: 100,
  globalLimit: 1000,
};
function setup() {
  const repo = {
    profileExists: vi.fn().mockResolvedValue(true),
    registerProfile: vi.fn().mockResolvedValue(randomUUID()),
    levels: vi.fn().mockResolvedValue([]),
    problems: vi.fn().mockResolvedValue({ problems: [], total: 0 }),
    problem: vi.fn().mockResolvedValue(problem),
    attemptProblem: vi.fn().mockResolvedValue(problem),
    steps: vi.fn().mockResolvedValue([]),
    command: vi
      .fn()
      .mockResolvedValue({ assistantMessageId: randomUUID(), replayed: false }),
    messages: vi
      .fn()
      .mockResolvedValue([
        { role: 'user', content: 'Et lite hint?', status: 'completed' },
      ]),
    message: vi.fn().mockResolvedValue({
      status: 'completed',
      content: 'Prøv å dele på seks.',
    }),
    context: vi
      .fn()
      .mockResolvedValue({ answerRevealed: false, stepsOpened: [] }),
    closeIdleSessions: vi.fn().mockResolvedValue(0),
    endSession: vi.fn().mockResolvedValue(undefined),
  } satisfies IPracticeRepository;
  const tutor = {
    reply: vi.fn().mockResolvedValue({
      content: 'Prøv å dele på seks.',
      model: 'gpt-4o-test',
      inputTokens: 10,
      outputTokens: 5,
      latencyMs: 100,
      requestId: 'test-request',
    }),
  };
  return { repo, tutor, useCases: new PracticeUseCases(repo, tutor, settings) };
}
const action = () => ({
  id: randomUUID(),
  sessionId: randomUUID(),
  attemptId: randomUUID(),
  occurredAt: new Date().toISOString(),
});

describe('server-side answer evaluation', () => {
  it('accepts equivalent numeric formats and units, and rejects arbitrary code', () => {
    expect(evaluateAnswer(' 5 kort ', problem).isCorrect).toBe(true);
    expect(evaluateAnswer('10/2', problem).isCorrect).toBe(true);
    expect(
      evaluateAnswer('2,5', { ...problem, answer_value: '2.5' }).isCorrect,
    ).toBe(true);
    expect(
      evaluateAnswer('−5', { ...problem, answer_value: '-5' }).isCorrect,
    ).toBe(true);
    expect(
      evaluateAnswer('0', { ...problem, answer_value: '0' }).isCorrect,
    ).toBe(true);
    for (const value of ['', '1/0', '4', '2+3', 'process.exit()'])
      expect(evaluateAnswer(value, problem).isCorrect).toBe(false);
  });
  it('applies explicit tolerances without using unconfigured rounding', () => {
    expect(evaluateAnswer('5.01', problem).isCorrect).toBe(false);
    expect(
      evaluateAnswer('5.001', {
        ...problem,
        validation_rules: { absolute_tolerance: 0.005 },
      }).isCorrect,
    ).toBe(true);
  });
});

it('does not let a client choose its answer correctness', () => {
  const { useCases } = setup();
  const controller = new PracticeController(useCases);
  expect(() =>
    controller.action('submissions', randomUUID(), {
      ...action(),
      answer: '0',
      isCorrect: true,
    }),
  ).toThrow();
});

it('does not adopt an unverified browser profile or session as an existing identity', async () => {
  const { repo, useCases } = setup();
  const requestedSession = randomUUID();
  await useCases.bootstrap({
    id: randomUUID(),
    browserId: randomUUID(),
    sessionId: requestedSession,
    verifiedBrowserId: null,
  });
  expect(repo.registerProfile).toHaveBeenCalledOnce();
  expect(repo.command.mock.calls[0][1].sessionId).not.toBe(requestedSession);
});

it('uses server-side evaluation and records the raw submission', async () => {
  const { repo, useCases } = setup();
  await useCases.submitAnswer(randomUUID(), {
    ...action(),
    answer: ' 5 kort ',
  });
  expect(repo.command.mock.calls[0][1]).toMatchObject({
    type: 'submit_answer',
    rawAnswer: ' 5 kort ',
    normalizedAnswer: '5',
    isCorrect: true,
  });
});

it('renews an idle session while preserving the verified browser identity', async () => {
  const { repo, useCases } = setup();
  const userId = randomUUID();
  const oldSessionId = randomUUID();
  await useCases.bootstrap({
    id: randomUUID(),
    browserId: userId,
    verifiedBrowserId: userId,
    sessionId: oldSessionId,
    renew: true,
  });
  expect(repo.registerProfile).not.toHaveBeenCalled();
  expect(repo.endSession).toHaveBeenCalledWith(userId, oldSessionId);
  expect(repo.command.mock.calls[0][1].sessionId).not.toBe(oldSessionId);
});

it('persists a pending chat turn before generating, and stores provider metadata afterward', async () => {
  const { repo, tutor, useCases } = setup();
  await useCases.chat(randomUUID(), {
    ...action(),
    threadId: randomUUID(),
    responseId: randomUUID(),
    content: 'Et lite hint?',
  });
  expect(repo.command.mock.calls[0][1].type).toBe('begin_chat');
  expect(repo.command.mock.invocationCallOrder[0]).toBeLessThan(
    tutor.reply.mock.invocationCallOrder[0],
  );
  expect(repo.command.mock.calls[1][1]).toMatchObject({
    type: 'finish_chat',
    status: 'completed',
    inputTokens: 10,
    outputTokens: 5,
    resolvedModel: 'gpt-4o-test',
  });
});

it('does not generate or charge for a replayed chat request', async () => {
  const { repo, tutor, useCases } = setup();
  repo.command.mockResolvedValue({
    assistantMessageId: randomUUID(),
    replayed: true,
  });
  await useCases.chat(randomUUID(), {
    ...action(),
    threadId: randomUUID(),
    responseId: randomUUID(),
    content: 'Et lite hint?',
  });
  expect(tutor.reply).not.toHaveBeenCalled();
  expect(repo.message).toHaveBeenCalledOnce();
});

it('records provider failures without pretending a reply was delivered', async () => {
  const { repo, tutor, useCases } = setup();
  tutor.reply.mockRejectedValue(
    new ApplicationError('ai_unavailable', 'Unavailable', 503),
  );
  await expect(
    useCases.chat(randomUUID(), {
      ...action(),
      threadId: randomUUID(),
      responseId: randomUUID(),
      content: 'Et lite hint?',
    }),
  ).rejects.toThrow('Unavailable');
  expect(repo.command.mock.calls[1][1]).toMatchObject({
    type: 'finish_chat',
    status: 'failed',
    errorCode: 'ai_unavailable',
  });
});
