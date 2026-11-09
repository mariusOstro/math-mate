import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { getPracticeUseCases } from '@/di/container';
import { PracticeController } from '@/interface-adapters/controllers/practice.controller';
import { ApplicationError } from '@/entities/errors/application-error';
import {
  BROWSER_COOKIE,
  signBrowser,
  verifyBrowser,
} from '@/lib/browser-identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const responseHeaders = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};
type RouteContext = { params: Promise<{ path: string[] }> };

function errorResponse(error: unknown) {
  if (error instanceof ZodError)
    return NextResponse.json(
      {
        code: 'invalid_input',
        error: 'Forespørselen inneholder ugyldige eller manglende verdier.',
      },
      { status: 400, headers: responseHeaders },
    );
  if (error instanceof ApplicationError)
    return NextResponse.json(
      { code: error.code, error: error.message },
      { status: error.status, headers: responseHeaders },
    );
  console.error('API request failed', { code: 'unexpected_error' });
  return NextResponse.json(
    { code: 'unexpected_error', error: 'Noe gikk galt. Prøv igjen om litt.' },
    { status: 500, headers: responseHeaders },
  );
}

async function readBody(request: NextRequest) {
  if (
    !(request.headers.get('content-type') ?? '').startsWith('application/json')
  )
    throw new ApplicationError(
      'invalid_content_type',
      'Forespørselen må være JSON.',
      415,
    );
  if (Number(request.headers.get('content-length')) > 64000)
    throw new ApplicationError(
      'request_too_large',
      'Forespørselen er for stor.',
      413,
    );
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 64000)
    throw new ApplicationError(
      'request_too_large',
      'Forespørselen er for stor.',
      413,
    );
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ApplicationError(
      'invalid_json',
      'Forespørselen er ikke gyldig JSON.',
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const origin = request.headers.get('origin');
    if (origin && new URL(origin).host !== request.nextUrl.host)
      throw new ApplicationError(
        'invalid_origin',
        'Forespørselen må komme fra MathMate.',
        403,
      );
    const path = (await context.params).path.join('/');
    const body = await readBody(request);
    const controller = new PracticeController(getPracticeUseCases());
    const userId = verifyBrowser(request.cookies.get(BROWSER_COOKIE)?.value);
    if (path === 'bootstrap') {
      const result = await controller.bootstrap(body, userId);
      const response = NextResponse.json(result, { headers: responseHeaders });
      response.cookies.set(BROWSER_COOKIE, signBrowser(result.userId), {
        httpOnly: true,
        secure: request.nextUrl.protocol === 'https:',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
      });
      return response;
    }
    if (!userId)
      throw new ApplicationError(
        'browser_required',
        'Nettleserøkten er ikke klar. Last siden på nytt.',
        401,
      );
    return NextResponse.json(await controller.action(path, userId, body), {
      headers: responseHeaders,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const userId = verifyBrowser(request.cookies.get(BROWSER_COOKIE)?.value);
    if (!userId)
      throw new ApplicationError(
        'browser_required',
        'Start MathMate før du henter data.',
        401,
      );
    const path = (await context.params).path.join('/');
    const controller = new PracticeController(getPracticeUseCases());
    if (path === 'problems')
      return NextResponse.json(
        await controller.problems(request.nextUrl.searchParams),
        { headers: responseHeaders },
      );
    if (path === 'chat')
      return NextResponse.json(
        await controller.messages(userId, request.nextUrl.searchParams),
        { headers: responseHeaders },
      );
    throw new ApplicationError(
      'not_found',
      'Denne funksjonen finnes ikke.',
      404,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
