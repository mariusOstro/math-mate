'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionContext } from '@/application/use-cases/practice.use-cases';
import type {
  AnswerResult,
  ChatMessage,
  Level,
  Problem,
  SolutionStep,
  WorkMode,
} from '@/entities/models/mathmate';
import { ApiError, BrowserApi, type SyncStatus } from '../services/browser-api';

interface Bootstrap {
  userId: string;
  userNumber: number;
  sessionId: string;
  levels: Level[];
  chatEnabled: boolean;
}
type StepInfo = Pick<SolutionStep, 'id' | 'title' | 'step_number'>;
export interface Exercise {
  attemptId: string;
  mode: WorkMode | null;
  steps: StepInfo[];
  revealed: SolutionStep[];
  input: string;
  feedback: AnswerResult | null;
  answer: { answer: string; unit: string; solution: string } | null;
  threadId: string;
  messages: ChatMessage[];
  draft: string;
  chatBusy: boolean;
  chatError: string;
}
let bootstrapPromise: Promise<Bootstrap> | undefined;

function storageGet(storage: 'localStorage' | 'sessionStorage', key: string) {
  try {
    return window[storage].getItem(key) || undefined;
  } catch {
    return undefined;
  }
}
function storageSet(
  storage: 'localStorage' | 'sessionStorage',
  key: string,
  value: string,
) {
  try {
    window[storage].setItem(key, value);
  } catch {
    /* The cookie still binds the current browser. */
  }
}
function boot() {
  if (!bootstrapPromise)
    bootstrapPromise = BrowserApi.request<Bootstrap>('bootstrap', {
      id: crypto.randomUUID(),
      browserId:
        storageGet('localStorage', 'mathmate.browser_id') ||
        crypto.randomUUID(),
      sessionId: storageGet('sessionStorage', 'mathmate.session_id'),
    })
      .then((result) => {
        storageSet('localStorage', 'mathmate.browser_id', result.userId);
        storageSet('sessionStorage', 'mathmate.session_id', result.sessionId);
        return result;
      })
      .catch((error) => {
        bootstrapPromise = undefined;
        throw error;
      });
  return bootstrapPromise;
}

async function renewBrowserSession(): Promise<Bootstrap> {
  const result = await BrowserApi.request<Bootstrap>('bootstrap', {
    id: crypto.randomUUID(),
    browserId: storageGet('localStorage', 'mathmate.browser_id'),
    sessionId: storageGet('sessionStorage', 'mathmate.session_id'),
    renew: true,
  });
  storageSet('localStorage', 'mathmate.browser_id', result.userId);
  storageSet('sessionStorage', 'mathmate.session_id', result.sessionId);
  bootstrapPromise = Promise.resolve(result);
  return result;
}

export function useMathMate() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState('');
  const [problems, setProblems] = useState<Problem[]>([]);
  const [index, setIndex] = useState(0);
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [chatOpen, setChatOpen] = useState(true);
  const [dark, setDark] = useState(false);
  const [sync, setSync] = useState<SyncStatus>({
    pending: 0,
    error: '',
    durable: true,
  });
  const [initialization, setInitialization] = useState(0);
  const api = useRef<BrowserApi | null>(null);
  const currentAttempt = useRef<string | undefined>(undefined);
  const pulse = useRef<() => Promise<void>>(async () => {});
  const activeClock = useRef(0);
  const stepClocks = useRef(new Map<string, number>());
  const viewGeneration = useRef(0);
  const pendingAnswer = useRef<{
    id: string;
    text: string;
    attemptId: string;
  } | null>(null);
  const pendingChat = useRef<{
    id: string;
    responseId: string;
    text: string;
    threadId: string;
  } | null>(null);
  const mounted = useRef(false);
  const renewing = useRef(false);
  const renewHandler = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    let client: BrowserApi | null = null;
    boot()
      .then(async (result) => {
        if (cancelled) return;
        client = new BrowserApi(result.userId, result.sessionId, (status) => {
          if (!cancelled) setSync(status);
        });
        api.current = client;
        await client.start();
        if (cancelled) {
          client.stop();
          return;
        }
        const previous = storageGet(
          'sessionStorage',
          'mathmate.current_attempt',
        );
        if (previous) {
          try {
            const old = JSON.parse(previous) as {
              attemptId: string;
              sessionId: string;
            };
            await client.mutation('leave', {
              id: crypto.randomUUID(),
              ...old,
              occurredAt: new Date().toISOString(),
              reason: 'reload',
            });
          } catch {
            /* A durable old attempt is closed by the session cleanup as a fallback. */
          }
          storageSet('sessionStorage', 'mathmate.current_attempt', '');
        }
        if (cancelled) return;
        await client.record('page_view', { page: '/' });
        setBootstrap(result);
        setReady(true);
        setError('');
      })
      .catch((failure: unknown) => {
        if (!cancelled) {
          setError(
            failure instanceof Error
              ? failure.message
              : 'Kunne ikke starte MathMate.',
          );
          setReady(false);
        }
      });
    setDark(matchMedia('(prefers-color-scheme: dark)').matches);
    return () => {
      cancelled = true;
      mounted.current = false;
      client?.stop();
    };
  }, [initialization]);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);
  useEffect(() => {
    currentAttempt.current = exercise?.attemptId;
  }, [exercise?.attemptId]);

  useEffect(() => {
    if (!ready || !api.current) return;
    const client = api.current;
    let lastTick = performance.now();
    let lastInteraction = lastTick;
    let accumulated = 0;
    const tick = () => {
      const now = performance.now();
      const delta = now - lastTick;
      if (
        document.visibilityState === 'visible' &&
        document.hasFocus() &&
        now - lastInteraction < 60000 &&
        delta < 5000
      ) {
        accumulated += delta;
        activeClock.current += delta;
      }
      lastTick = now;
    };
    const interact = () => {
      const now = performance.now();
      if (now - lastInteraction >= 30 * 60 * 1000 && !renewing.current) {
        renewing.current = true;
        accumulated = 0;
        void renewHandler.current().finally(() => {
          renewing.current = false;
        });
      }
      tick();
      lastInteraction = now;
    };
    const sendPulse = async () => {
      tick();
      const value = Math.min(60000, Math.round(accumulated));
      accumulated = 0;
      if (renewing.current) return;
      if (value > 0)
        await client.record(
          'activity_heartbeat',
          { visible: true, focused: true },
          currentAttempt.current,
          value,
        );
    };
    pulse.current = sendPulse;
    const visibility = () => {
      if (!document.hidden) {
        interact();
        if (renewing.current) return;
      }
      void sendPulse().then(async () => {
        await client.record(
          document.hidden ? 'page_hidden' : 'page_visible',
          {},
          currentAttempt.current,
        );
        if (document.hidden) client.beacon();
      });
    };
    const pageHide = () => {
      void sendPulse().then(() => client.beacon());
    };
    const timer = setInterval(tick, 1000);
    const heartbeat = setInterval(() => {
      void sendPulse();
    }, 15000);
    ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((name) =>
      window.addEventListener(name, interact, { passive: true }),
    );
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', pageHide);
    return () => {
      clearInterval(timer);
      clearInterval(heartbeat);
      pulse.current = async () => {};
      ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((name) =>
        window.removeEventListener(name, interact),
      );
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', pageHide);
      void sendPulse().then(() => client.beacon());
    };
  }, [ready]);

  const context = useCallback(
    (attemptId: string, id = crypto.randomUUID()): ActionContext => {
      if (!api.current) throw new Error('Økten er ikke klar.');
      return {
        id,
        sessionId: api.current.sessionId,
        attemptId,
        occurredAt: new Date().toISOString(),
      };
    },
    [],
  );
  async function flushActivity() {
    await pulse.current();
    await api.current!.flush();
  }
  async function closeSteps(attemptId: string) {
    for (const [stepId, openedAt] of stepClocks.current)
      await api.current!.record(
        'step_closed',
        { visible_active_ms: Math.round(activeClock.current - openedAt) },
        attemptId,
        0,
        stepId,
      );
    stepClocks.current.clear();
  }
  function patchExercise(attemptId: string, update: Partial<Exercise>) {
    if (mounted.current)
      setExercise((current) =>
        current?.attemptId === attemptId ? { ...current, ...update } : current,
      );
  }
  function failure(value: unknown) {
    setError(
      value instanceof Error
        ? value.message
        : 'Kunne ikke fullføre handlingen.',
    );
  }

  useEffect(() => {
    renewHandler.current = async () => {
      if (!api.current) return;
      setWorking(true);
      setError('');
      try {
        const result = await renewBrowserSession();
        if (exercise) await closeSteps(exercise.attemptId);
        api.current.sessionId = result.sessionId;
        currentAttempt.current = undefined;
        setBootstrap(result);
        if (exercise && problems[index]) {
          const attemptId = crypto.randomUUID();
          const freshContext = () => ({
            id: crypto.randomUUID(),
            sessionId: result.sessionId,
            attemptId,
            occurredAt: new Date().toISOString(),
          });
          const started = await api.current.mutation<{ steps: StepInfo[] }>(
            'attempts',
            { ...freshContext(), problemId: problems[index].id },
          );
          const revealed: SolutionStep[] = [];
          if (exercise.mode)
            await api.current.mutation('mode', {
              ...freshContext(),
              mode: exercise.mode,
            });
          if (exercise.mode === 'guided')
            for (const oldStep of exercise.revealed) {
              const step = await api.current.mutation<SolutionStep>('steps', {
                ...freshContext(),
                stepId: oldStep.id,
              });
              revealed.push(step);
              stepClocks.current.set(step.id, activeClock.current);
            }
          if (exercise.answer)
            await api.current.mutation('answer', freshContext());
          currentAttempt.current = attemptId;
          setExercise({
            ...exercise,
            attemptId,
            steps: started.steps,
            revealed,
            feedback: null,
            threadId: crypto.randomUUID(),
            messages: [],
            chatBusy: false,
            chatError: '',
          });
          storageSet(
            'sessionStorage',
            'mathmate.current_attempt',
            JSON.stringify({ attemptId, sessionId: result.sessionId }),
          );
        }
      } catch {
        setError(
          'Kunne ikke starte en ny økt etter pausen. Last siden på nytt for å fortsette.',
        );
      } finally {
        setWorking(false);
      }
    };
  });

  async function leave(
    reason: 'level_change' | 'next_problem' | 'previous_problem' | 'selection',
  ) {
    if (!exercise) return;
    await pulse.current();
    await closeSteps(exercise.attemptId);
    await api.current!.flush();
    await api.current!.mutation('leave', {
      ...context(exercise.attemptId),
      reason,
    });
    currentAttempt.current = undefined;
    storageSet('sessionStorage', 'mathmate.current_attempt', '');
  }
  async function openProblem(nextIndex: number, loadedProblems = problems) {
    const generation = ++viewGeneration.current;
    const attemptId = crypto.randomUUID();
    const result = await api.current!.mutation<{
      attemptId: string;
      steps: StepInfo[];
    }>('attempts', {
      ...context(attemptId),
      problemId: loadedProblems[nextIndex].id,
    });
    if (generation !== viewGeneration.current) return;
    currentAttempt.current = attemptId;
    pendingAnswer.current = null;
    pendingChat.current = null;
    setIndex(nextIndex);
    setExercise({
      attemptId,
      mode: null,
      steps: result.steps,
      revealed: [],
      input: '',
      feedback: null,
      answer: null,
      threadId: crypto.randomUUID(),
      messages: [],
      draft: '',
      chatBusy: false,
      chatError: '',
    });
    storageSet(
      'sessionStorage',
      'mathmate.current_attempt',
      JSON.stringify({ attemptId, sessionId: api.current!.sessionId }),
    );
  }
  async function start() {
    if (!selectedLevel || !api.current || working || renewing.current) return;
    setWorking(true);
    setError('');
    try {
      await api.current.record('level_selected', { level: selectedLevel });
      await api.current.flush();
      const result = await BrowserApi.request<{
        problems: Problem[];
        total: number;
      }>(`problems?level=${encodeURIComponent(selectedLevel)}&limit=150`);
      if (!result.problems.length)
        throw new Error('Dette nivået har ingen tilgjengelige oppgaver ennå.');
      setProblems(result.problems);
      await openProblem(0, result.problems);
    } catch (error) {
      failure(error);
    } finally {
      setWorking(false);
    }
  }
  async function home() {
    if (working || renewing.current) return;
    setWorking(true);
    setError('');
    try {
      await leave('level_change');
      viewGeneration.current++;
      setExercise(null);
      setProblems([]);
      setSelectedLevel('');
    } catch (error) {
      failure(error);
    } finally {
      setWorking(false);
    }
  }
  async function navigate(nextIndex: number) {
    if (
      working ||
      renewing.current ||
      nextIndex === index ||
      nextIndex < 0 ||
      nextIndex >= problems.length
    )
      return;
    setWorking(true);
    setError('');
    try {
      await leave(nextIndex > index ? 'next_problem' : 'previous_problem');
      await openProblem(nextIndex);
    } catch (error) {
      failure(error);
    } finally {
      setWorking(false);
    }
  }
  async function mode(nextMode: WorkMode | null) {
    if (!exercise || working || renewing.current) return;
    setWorking(true);
    setError('');
    try {
      await flushActivity();
      if (exercise.mode === 'guided' && nextMode !== 'guided')
        await closeSteps(exercise.attemptId);
      if (nextMode)
        await api.current!.mutation('mode', {
          ...context(exercise.attemptId),
          mode: nextMode,
        });
      patchExercise(exercise.attemptId, { mode: nextMode });
      if (nextMode === 'guided') {
        if (!exercise.revealed.length) {
          const step = await api.current!.mutation<SolutionStep>('steps', {
            ...context(exercise.attemptId),
            stepId: exercise.steps[0].id,
          });
          stepClocks.current.set(step.id, activeClock.current);
          patchExercise(exercise.attemptId, { revealed: [step] });
        } else {
          for (const step of exercise.revealed) {
            await api.current!.mutation('steps', {
              ...context(exercise.attemptId),
              stepId: step.id,
            });
            stepClocks.current.set(step.id, activeClock.current);
          }
        }
      }
    } catch (error) {
      failure(error);
    } finally {
      setWorking(false);
    }
  }
  async function nextStep() {
    if (
      !exercise ||
      working ||
      renewing.current ||
      exercise.revealed.length >= exercise.steps.length
    )
      return;
    setWorking(true);
    setError('');
    try {
      await flushActivity();
      const step = await api.current!.mutation<SolutionStep>('steps', {
        ...context(exercise.attemptId),
        stepId: exercise.steps[exercise.revealed.length].id,
      });
      stepClocks.current.set(step.id, activeClock.current);
      patchExercise(exercise.attemptId, {
        revealed: [...exercise.revealed, step],
      });
    } catch (error) {
      failure(error);
    } finally {
      setWorking(false);
    }
  }
  async function submit() {
    if (!exercise?.input.trim() || working || renewing.current) return;
    setWorking(true);
    setError('');
    const previous = pendingAnswer.current;
    const request =
      previous?.attemptId === exercise.attemptId &&
      previous.text === exercise.input
        ? previous
        : {
            id: crypto.randomUUID(),
            text: exercise.input,
            attemptId: exercise.attemptId,
          };
    pendingAnswer.current = request;
    try {
      await flushActivity();
      const feedback = await api.current!.mutation<AnswerResult>(
        'submissions',
        { ...context(exercise.attemptId, request.id), answer: request.text },
      );
      pendingAnswer.current = null;
      patchExercise(exercise.attemptId, { feedback });
    } catch (error) {
      failure(error);
    } finally {
      setWorking(false);
    }
  }
  async function reveal() {
    if (!exercise || working || renewing.current) return;
    setWorking(true);
    setError('');
    try {
      await flushActivity();
      const answer = await api.current!.mutation<
        NonNullable<Exercise['answer']>
      >('answer', { ...context(exercise.attemptId) });
      patchExercise(exercise.attemptId, { answer });
    } catch (error) {
      failure(error);
    } finally {
      setWorking(false);
    }
  }
  async function pollMessage(id: string) {
    for (let count = 0; count < 35; count++) {
      const { message } = await BrowserApi.request<{ message: ChatMessage }>(
        `chat?messageId=${id}`,
      );
      if (message.status !== 'pending') return message;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw new ApiError(
      'Svaret er fortsatt under behandling. Prøv igjen om litt.',
      'chat_pending',
      409,
    );
  }
  async function chat(text: string) {
    if (!exercise || exercise.chatBusy || !text.trim() || renewing.current)
      return;
    const attemptId = exercise.attemptId;
    const threadId = exercise.threadId;
    const previous = pendingChat.current;
    const request =
      previous?.threadId === threadId && previous.text === text
        ? previous
        : {
            id: crypto.randomUUID(),
            responseId: crypto.randomUUID(),
            text,
            threadId,
          };
    pendingChat.current = request;
    const optimistic: ChatMessage = {
      id: request.id,
      thread_id: threadId,
      sequence_number: exercise.messages.length + 1,
      role: 'user',
      status: 'pending',
      content: text,
      error_code: null,
      model: null,
      prompt_version: null,
      received_at: new Date().toISOString(),
    };
    patchExercise(attemptId, {
      chatBusy: true,
      chatError: '',
      draft: '',
      messages: [
        ...exercise.messages.filter((message) => message.id !== request.id),
        optimistic,
      ],
    });
    try {
      await flushActivity();
      let { message } = await api.current!.mutation<{ message: ChatMessage }>(
        'chat',
        {
          ...context(attemptId, request.id),
          responseId: request.responseId,
          threadId,
          content: text,
        },
      );
      if (message.status === 'pending') message = await pollMessage(message.id);
      const { messages } = await BrowserApi.request<{
        messages: ChatMessage[];
      }>(`chat?threadId=${threadId}`);
      if (message.status === 'failed') {
        pendingChat.current = null;
        throw new ApiError(
          'AI-veilederen kunne ikke svare. Prøv igjen.',
          message.error_code || 'ai_unavailable',
          503,
        );
      }
      if (mounted.current)
        setExercise((current) =>
          current?.attemptId === attemptId && current.threadId === threadId
            ? { ...current, messages, chatBusy: false, chatError: '' }
            : current,
        );
      pendingChat.current = null;
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code !== 'network_error' &&
        error.code !== 'database_unavailable' &&
        error.code !== 'chat_pending'
      )
        pendingChat.current = null;
      if (mounted.current)
        setExercise((current) =>
          current?.attemptId === attemptId && current.threadId === threadId
            ? {
                ...current,
                chatBusy: false,
                draft: text,
                chatError:
                  error instanceof Error
                    ? error.message
                    : 'Fikk ikke svar fra veilederen.',
              }
            : current,
        );
    }
  }
  async function clearChat() {
    if (!exercise || renewing.current) return;
    try {
      await api.current!.mutation('new-chat', {
        ...context(exercise.attemptId),
        threadId: exercise.threadId,
      });
      pendingChat.current = null;
      patchExercise(exercise.attemptId, {
        threadId: crypto.randomUUID(),
        messages: [],
        draft: '',
        chatError: '',
        chatBusy: false,
      });
    } catch (error) {
      failure(error);
    }
  }
  function toggleChat() {
    void api.current?.record(
      chatOpen ? 'chat_closed' : 'chat_opened',
      {},
      exercise?.attemptId,
    );
    setChatOpen(!chatOpen);
  }
  function toggleTheme() {
    setDark(!dark);
    void api.current?.record(
      'theme_changed',
      { theme: dark ? 'light' : 'dark' },
      exercise?.attemptId,
    );
  }
  async function retrySync() {
    try {
      await api.current?.flush();
      setError('');
    } catch (error) {
      failure(error);
    }
  }

  return {
    ready,
    error,
    working,
    bootstrap,
    selectedLevel,
    setSelectedLevel: (level: string) => {
      setSelectedLevel(level);
      void api.current?.record('level_selected', { level, stage: 'selection' });
    },
    problems,
    index,
    exercise,
    chatOpen,
    dark,
    sync,
    start,
    home,
    navigate,
    mode,
    nextStep,
    submit,
    reveal,
    chat,
    clearChat,
    toggleChat,
    toggleTheme,
    retrySync,
    retryInitialization: () => setInitialization((value) => value + 1),
    setInput: (value: string) => {
      if (exercise)
        patchExercise(exercise.attemptId, { input: value, feedback: null });
    },
    setDraft: (value: string) => {
      if (exercise) patchExercise(exercise.attemptId, { draft: value });
    },
    inputBlur: () => {
      if (exercise)
        void api.current?.record(
          'answer_input_changed',
          { character_count: exercise.input.length },
          exercise.attemptId,
        );
    },
  };
}

export type MathMateState = ReturnType<typeof useMathMate>;
