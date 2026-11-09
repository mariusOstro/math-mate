import type { FullProblem } from './mathmate';

export const CHECKER_VERSION = 'numeric-text-v1';

function normalize(value: string, unit: string) {
  let result = value
    .trim()
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll('−', '-')
    .replaceAll(',', '.');
  const suffix = unit.normalize('NFKC').trim().toLowerCase();
  if (suffix && result.endsWith(suffix))
    result = result.slice(0, -suffix.length).trim();
  return result.replace(/\s+/g, '').replace(/\.$/, '');
}

function scalar(value: string): number | null {
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) {
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  }
  const fraction = value.match(/^([+-]?\d+(?:\.\d+)?)\/([+-]?\d+(?:\.\d+)?)$/);
  if (!fraction || Number(fraction[2]) === 0) return null;
  const result = Number(fraction[1]) / Number(fraction[2]);
  return Number.isFinite(result) ? result : null;
}

export function evaluateAnswer(
  raw: string,
  problem: Pick<
    FullProblem,
    'answer_value' | 'answer_unit' | 'validation_rules'
  >,
) {
  const normalizedAnswer = normalize(raw, problem.answer_unit);
  const expected = normalize(problem.answer_value, problem.answer_unit);
  if (!normalizedAnswer) return { normalizedAnswer, isCorrect: false };
  if (normalizedAnswer === expected)
    return { normalizedAnswer, isCorrect: true };
  const alternatives = problem.validation_rules.accepted_answers;
  if (
    Array.isArray(alternatives) &&
    alternatives.some(
      (answer) =>
        typeof answer === 'string' &&
        normalize(answer, problem.answer_unit) === normalizedAnswer,
    )
  ) {
    return { normalizedAnswer, isCorrect: true };
  }
  const actualNumber = scalar(normalizedAnswer);
  const expectedNumber = scalar(expected);
  if (actualNumber === null || expectedNumber === null)
    return { normalizedAnswer, isCorrect: false };
  const tolerance = Math.max(
    0,
    Number(problem.validation_rules.absolute_tolerance) || 0,
  );
  const relative = Math.max(
    0,
    Number(problem.validation_rules.relative_tolerance) || 0,
  );
  const floatingPointTolerance =
    Number.EPSILON * 8 * Math.max(1, Math.abs(expectedNumber));
  return {
    normalizedAnswer,
    isCorrect:
      Math.abs(actualNumber - expectedNumber) <=
      Math.max(
        tolerance,
        relative * Math.abs(expectedNumber),
        floatingPointTolerance,
      ),
  };
}
