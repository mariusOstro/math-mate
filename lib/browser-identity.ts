import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { supabaseSettings } from './server-config';

export const BROWSER_COOKIE = 'mathmate_browser';
function signature(userId: string) {
  const key =
    process.env.BROWSER_ID_SECRET?.trim() || supabaseSettings().secret;
  return createHmac('sha256', key)
    .update(`mathmate:browser:v1:${userId}`)
    .digest('base64url');
}
export function signBrowser(userId: string) {
  return `${userId}.${signature(userId)}`;
}
export function verifyBrowser(cookie: string | undefined) {
  if (!cookie || cookie.length > 200) return null;
  const [id, supplied, extra] = cookie.split('.');
  if (
    extra ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    ) ||
    !supplied
  )
    return null;
  const expected = Buffer.from(signature(id));
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual)
    ? id
    : null;
}
