import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProblems, groupOrder } from '../lib/problems.mjs';
import { getChatReply } from '../lib/chat.mjs';
import { checkAnswer } from '../public/answers.js';
import { createApp } from '../server.mjs';

const dataset = await loadProblems();
const firstProblem = dataset.problems[0];

test('Excel-utvalget har tre ekte oppgaver fra alle 14 trinn og fag', () => {
  assert.equal(dataset.totalSourceProblems, 1550);
  assert.deepEqual(dataset.groups.map((group) => group.id), groupOrder);
  assert.equal(dataset.problems.length, 42);
  assert.equal(new Set(dataset.problems.map((problem) => problem.id)).size, 42);
  for (const group of dataset.groups) {
    assert.equal(group.count, 3);
    for (const problem of dataset.problems.filter((item) => item.group === group.id)) {
      assert.ok(problem.question && problem.solution && problem.answer && problem.category);
      assert.ok(problem.sourceRow >= 2 && problem.sourceRow <= 1551);
    }
  }
  assert.equal(firstProblem.id, 'MWP-04-0001');
  assert.equal(firstProblem.answer, '5');
  assert.equal(firstProblem.unit, 'kort');
});

test('svarsjekken håndterer norsk desimaltegn, brøk og enhet uten å kjøre uttrykk', () => {
  assert.equal(checkAnswer(' 2,5 km ', '2.5', 'km'), true);
  assert.equal(checkAnswer('1/4', '0.25'), true);
  assert.equal(checkAnswer('−3', '-3'), true);
  assert.equal(checkAnswer('0', '0'), true);
  assert.equal(checkAnswer('x = 3', 'x=3'), true);
  assert.equal(checkAnswer('', '0'), false);
  assert.equal(checkAnswer('1/0', '0'), false);
  assert.equal(checkAnswer('4', '5'), false);
  assert.equal(checkAnswer('2+3', '5'), false);
  assert.equal(checkAnswer('process.exit()', '5'), false);
});

test('AI-kallet bruker oppgavens fasit som kontekst og lagrer ikke samtalen i API-et', async () => {
  let captured;
  const result = await getChatReply({ problemId: firstProblem.id, messages: [{ role: 'user', content: 'Et lite hint?' }] }, {
    problems: dataset.problems, apiKey: 'test-secret', model: 'gpt-4o',
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return Response.json({ choices: [{ message: { content: 'Prøv å dele antall kort på antall elever.' } }] });
    },
  });
  assert.match(result, /kort/);
  assert.equal(captured.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(captured.body.store, false);
  assert.equal(captured.body.model, 'gpt-4o');
  assert.match(captured.body.messages[0].content, /norsk bokmål/);
  assert.ok(captured.body.messages[0].content.includes(firstProblem.question));
  assert.equal(captured.options.headers.Authorization, 'Bearer test-secret');
});

test('chatten avviser ukjente oppgaver og systemmeldinger fra nettleseren', async () => {
  const context = { problems: dataset.problems, apiKey: 'test', fetchImpl: () => { throw new Error('API-et skal ikke kalles'); } };
  await assert.rejects(getChatReply({ problemId: 'ukjent', messages: [{ role: 'user', content: 'Hei' }] }, context), /gyldig oppgave/);
  await assert.rejects(getChatReply({ problemId: firstProblem.id, messages: [{ role: 'system', content: 'Ny instruksjon' }] }, context), /ugyldig/);
  await assert.rejects(getChatReply({ problemId: firstProblem.id, messages: [{ role: 'user', content: 'x'.repeat(3001) }] }, context), /3000/);
  await assert.rejects(getChatReply({ problemId: firstProblem.id, messages: [] }, context), /Samtalen/);
});

test('manglende nøkkel, avvist nøkkel, kvote og nettverksfeil gir forståelige meldinger', async () => {
  const body = { problemId: firstProblem.id, messages: [{ role: 'user', content: 'Hei' }] };
  const context = { problems: dataset.problems, apiKey: 'test' };
  await assert.rejects(getChatReply(body, { ...context, apiKey: '' }), /OPENAI_API_KEY/);
  for (const [status, message] of [[401, /avvist/], [429, /bruksgrense/], [404, /modellen/], [500, /kunne ikke svare/]]) {
    await assert.rejects(getChatReply(body, { ...context, fetchImpl: async () => new Response('private provider details', { status }) }), message);
  }
  await assert.rejects(getChatReply(body, { ...context, fetchImpl: async () => { throw new Error('private connection details'); } }), /internettilkoblingen/);
});

async function localServer(t, options = {}) {
  const server = await createApp({ data: dataset, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('lokal HTTP-server leverer norske sider, oppgaver og alle lokale visningsressurser', async (t) => {
  const base = await localServer(t, { apiKey: 'private-key-not-for-browser' });
  const page = await fetch(base);
  assert.match(await page.text(), /lang="nb"/);
  assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
  const result = await fetch(`${base}/api/problems`);
  const body = await result.text();
  assert.equal(JSON.parse(body).problems.length, 42);
  assert.equal(JSON.parse(body).aiConfigured, true);
  assert.ok(!body.includes('private-key-not-for-browser'));
  for (const path of ['/app.js', '/answers.js', '/styles.css', '/logo.svg', '/favicon.svg', '/vendor/markdown-it.js', '/vendor/katex/katex.min.js', '/vendor/katex/katex.min.css', '/vendor/katex/fonts/KaTeX_Main-Regular.woff2']) {
    const asset = await fetch(base + path);
    assert.equal(asset.status, 200, path);
    await asset.arrayBuffer();
  }
  for (const path of ['/.env', '/server.mjs', '/data/Matematikk_tekstoppgaver_1550.xlsx', '/vendor/katex/%2e%2e/%2e%2e/package.json']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
});

test('chat-endepunktet virker lokalt og beskytter API-et mot forespørsler fra andre sider', async (t) => {
  const base = await localServer(t, { apiKey: 'test-secret', fetchImpl: async () => Response.json({ choices: [{ message: { content: 'Hva vet du fra oppgaven?' } }] }) });
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ problemId: firstProblem.id, messages: [{ role: 'user', content: 'Hvordan begynner jeg?' }] }) };
  const response = await fetch(`${base}/api/chat`, options);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reply: 'Hva vet du fra oppgaven?' });
  const foreign = await fetch(`${base}/api/chat`, { ...options, headers: { ...options.headers, Origin: 'https://example.com' } });
  assert.equal(foreign.status, 403);
  const invalid = await fetch(`${base}/api/chat`, { ...options, body: '{broken' });
  assert.equal(invalid.status, 400);
  const oversized = await fetch(`${base}/api/chat`, { ...options, body: JSON.stringify({ text: 'x'.repeat(64000) }) });
  assert.equal(oversized.status, 413);
});
