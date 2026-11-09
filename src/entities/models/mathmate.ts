export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export const LEVEL_CODES = [
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '1P',
  '2P',
  '1T',
  'R1',
  'R2',
  'S1',
  'S2',
] as const;
export type LevelCode = (typeof LEVEL_CODES)[number];
export type WorkMode = 'self' | 'guided';
export const levelLabel = (level: string) =>
  /^\d+$/.test(level) ? `${level}. trinn` : `Matematikk ${level}`;
export const categoryLabel = (category: string) =>
  category
    .replaceAll('_', ' ')
    .replace(/^./u, (letter) => letter.toUpperCase());
export const displayAnswer = (answer: string) =>
  /^[+-]?\d+(\.\d+)?$/.test(answer) ? answer.replace('.', ',') : answer;

export interface Problem {
  id: string;
  source_id: string;
  version: number;
  question: string;
  level_code: LevelCode;
  difficulty: number;
  category: string;
  answer_unit: string;
}
export interface FullProblem extends Problem {
  answer_value: string;
  solution: string;
  validation_rules: Record<string, Json>;
}
export interface SolutionStep {
  id: string;
  problem_id: string;
  step_number: number;
  title: string;
  content: string;
}
export interface Level {
  id: LevelCode;
  label: string;
  count: number;
}
export interface Session {
  sessionId: string;
  resumed: boolean;
}
export interface Attempt {
  attemptId: string;
  status: 'in_progress' | 'solved' | 'abandoned';
}
export interface AnswerResult {
  submissionId: string;
  submissionNumber: number;
  isCorrect: boolean;
  solved: boolean;
}
export interface ChatMessage {
  id: string;
  thread_id: string;
  sequence_number: number;
  role: 'user' | 'assistant';
  status: 'pending' | 'completed' | 'failed';
  content: string | null;
  error_code: string | null;
  model: string | null;
  prompt_version: string | null;
  received_at: string;
}
export interface TelemetryEvent {
  id: string;
  type: string;
  occurredAt: string;
  attemptId?: string;
  stepId?: string;
  activeMs?: number;
  payload?: Record<string, Json>;
}
export interface CommandResult {
  [key: string]: Json | undefined;
}
