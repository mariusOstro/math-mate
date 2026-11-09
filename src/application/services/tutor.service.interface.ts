import type { FullProblem } from '@/entities/models/mathmate';

export interface TutorReply {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  requestId: string | null;
  latencyMs: number;
}
export interface ITutorService {
  reply(input: {
    problem: FullProblem;
    messages: { role: 'user' | 'assistant'; content: string }[];
    context: { answerRevealed: boolean; stepsOpened: string[] };
  }): Promise<TutorReply>;
}
