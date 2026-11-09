import 'server-only';
import { ApplicationError } from '@/entities/errors/application-error';

export function supabaseSettings() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/$/, '');
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secret)
    throw new ApplicationError(
      'configuration_missing',
      'Serveren mangler Supabase-innstillinger. Se oppstartsveiledningen.',
      503,
    );
  try {
    if (
      new URL(url).protocol !== 'https:' &&
      !url.startsWith('http://127.0.0.1') &&
      !url.startsWith('http://localhost')
    )
      throw new Error();
  } catch {
    throw new ApplicationError(
      'configuration_invalid',
      'SUPABASE_URL er ugyldig.',
      503,
    );
  }
  return { url, secret };
}

export function positiveSetting(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export const APP_VERSION =
  process.env.APP_VERSION?.trim() ||
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
  '1.0.0';
