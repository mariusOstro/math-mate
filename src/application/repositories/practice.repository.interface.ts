import type {
  ChatMessage,
  CommandResult,
  FullProblem,
  Json,
  Level,
  Problem,
  SolutionStep,
} from '@/entities/models/mathmate';

export interface IPracticeRepository {
  profileExists(userId: string): Promise<boolean>;
  registerProfile(candidateId: string): Promise<string>;
  levels(): Promise<Level[]>;
  problems(
    level: string,
    offset: number,
    limit: number,
  ): Promise<{ problems: Problem[]; total: number }>;
  problem(id: string): Promise<FullProblem>;
  attemptProblem(
    userId: string,
    sessionId: string,
    attemptId: string,
  ): Promise<FullProblem>;
  steps(problemId: string): Promise<SolutionStep[]>;
  command<T = CommandResult>(
    userId: string,
    command: Record<string, Json | undefined>,
  ): Promise<T>;
  messages(userId: string, threadId: string): Promise<ChatMessage[]>;
  message(userId: string, messageId: string): Promise<ChatMessage>;
  context(
    attemptId: string,
  ): Promise<{ answerRevealed: boolean; stepsOpened: string[] }>;
  closeIdleSessions(): Promise<number>;
  endSession(userId: string, sessionId: string): Promise<void>;
}
