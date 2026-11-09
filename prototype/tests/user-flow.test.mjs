import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import markdownit from 'markdown-it';
import katex from 'katex';
import { loadProblems } from '../lib/problems.mjs';

async function settle() {
  for (let index = 0; index < 4; index++) await new Promise((resolve) => setImmediate(resolve));
}

test('norsk brukerflyt: alle nivåer, selvstendig arbeid, steg, fasit, chat og nullstilling', async (t) => {
  const dataset = { ...await loadProblems(), aiConfigured: true };
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost:3001' });
  const { window } = dom;
  window.markdownit = markdownit;
  window.katex = katex;
  const previous = { window: globalThis.window, document: globalThis.document, matchMedia: globalThis.matchMedia, fetch: globalThis.fetch };
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.matchMedia = () => ({ matches: false });
  let chatFailure = false;
  let resolvePendingChat;
  let delayChat = false;
  const chatBodies = [];
  globalThis.fetch = async (path, options = {}) => {
    if (path === '/api/problems') return Response.json(dataset);
    assert.equal(path, '/api/chat');
    chatBodies.push(JSON.parse(options.body));
    if (delayChat) await new Promise((resolve) => { resolvePendingChat = resolve; });
    if (chatFailure) return Response.json({ error: 'En testfeil. Prøv igjen.' }, { status: 502 });
    return Response.json({ reply: 'Prøv med $30 \\div 6$. **Hva tenker du?** <img src="https://example.com/track" onerror="alert(1)">' });
  };
  t.after(() => { Object.assign(globalThis, previous); window.close(); });
  await import('../public/app.js');
  await settle();
  const query = (selector) => window.document.querySelector(selector);
  const click = (selector) => { assert.ok(query(selector), `Mangler ${selector}`); query(selector).click(); };
  const chooseGroup = (id) => {
    const radio = query(`input[value="${id}"]`);
    radio.checked = true;
    radio.dispatchEvent(new window.Event('change', { bubbles: true }));
    click('#start-button');
  };

  assert.equal(window.document.documentElement.lang, 'nb');
  assert.equal(query('#start-button').disabled, true);
  assert.equal(window.document.querySelectorAll('input[name="group"]').length, 14);
  for (const group of dataset.groups) {
    chooseGroup(group.id);
    assert.ok(query('.question').textContent.includes(dataset.problems.find((problem) => problem.group === group.id).question));
    assert.equal(window.document.querySelectorAll('[data-problem]').length, 3);
    click('#change-group');
  }

  chooseGroup('6');
  click('[data-mode="self"]');
  const input = query('#answer-input');
  input.value = '9,4 meter';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  query('#answer-form').dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));
  assert.match(query('#answer-feedback').textContent, /Riktig/);
  click('#reveal-answer');
  assert.match(query('.revealed-answer').textContent, /9,4 meter/);
  click('#change-method');
  click('[data-mode="guided"]');
  assert.equal(window.document.querySelectorAll('.solution-steps li').length, 1);
  click('#next-step');
  assert.equal(window.document.querySelectorAll('.solution-steps li').length, 2);
  assert.match(query('.solution-steps').textContent, /6,9 \+ 2,5/);

  click('[data-suggestion]');
  await settle();
  assert.equal(window.document.querySelectorAll('.message').length, 2);
  assert.ok(query('.message.assistant .katex'));
  assert.ok(query('.message.assistant strong'));
  assert.equal(query('.message.assistant img'), null);
  assert.equal(chatBodies.at(-1).problemId, dataset.problems.find((problem) => problem.group === '6').id);
  assert.equal(chatBodies.at(-1).answerRevealed, true);
  click('#close-chat');
  assert.equal(query('.chat-panel'), null);
  click('#open-chat');
  assert.equal(window.document.querySelectorAll('.message').length, 2);
  click('#clear-chat');
  assert.equal(window.document.querySelectorAll('.message').length, 0);

  chatFailure = true;
  click('[data-suggestion]');
  await settle();
  assert.match(query('#chat-error').textContent, /testfeil/);
  assert.equal(window.document.querySelectorAll('.message').length, 0);
  assert.ok(query('#chat-input').value.length > 0);
  chatFailure = false;
  click('#retry-chat');
  await settle();
  assert.equal(window.document.querySelectorAll('.message').length, 2);

  // Et forsinket svar fra forrige oppgave må ikke havne i den nye samtalen.
  click('#clear-chat');
  delayChat = true;
  click('[data-suggestion]');
  assert.ok(query('.thinking'));
  click('#next-problem');
  resolvePendingChat();
  await settle();
  assert.equal(window.document.querySelectorAll('.message').length, 0);
  assert.equal(query('.thinking'), null);
  assert.match(query('.problem-meta').textContent, /OPPGAVE 2 AV 3/);
  assert.equal(query('#answer-input'), null);
  click('#previous-problem');
  assert.match(query('.problem-meta').textContent, /OPPGAVE 1 AV 3/);
  click('#theme-button');
  assert.equal(window.document.documentElement.dataset.theme, 'dark');
  click('#change-group');
  assert.equal(query('#start-button').disabled, true);
  assert.equal(window.localStorage.length, 0);
  assert.equal(window.sessionStorage.length, 0);
  assert.equal(window.document.cookie, '');
});
