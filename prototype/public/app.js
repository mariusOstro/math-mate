import { checkAnswer } from './answers.js';

const icons = {
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  book: '<path d="M4 4h6a3 3 0 0 1 2 1 3 3 0 0 1 2-1h6v15h-6a3 3 0 0 0-2 1 3 3 0 0 0-2-1H4zM12 5v15"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM20 2v4m-2-2h4"/>',
  pen: '<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15zM13 20h8"/>',
  steps: '<path d="M3 20h6v-6h6V8h6V3M3 4h4m-4 6h4"/>',
  send: '<path d="m3 3 18 9-18 9 4-9-4-9zm4 9h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  moon: '<path d="M20.5 13A9 9 0 0 1 11 3.5 9 9 0 1 0 20.5 13z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M5.5 7a7 7 0 0 1 11.6-2L20 8M4 16l2.9 3A7 7 0 0 0 18.5 17"/>',
};
const icon = (name, className = '') => `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? icons.book}</svg>`;
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const categoryLabel = (category) => category.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
const displayAnswer = (answer) => /^[+-]?\d+(\.\d+)?$/.test(answer) ? answer.replace('.', ',') : answer;
const main = document.querySelector('#main');
let dataset;
let selectedGroup = null;
let currentIndex = 0;
let exercise = null;
let chatOpen = true;
let chatController;
let markdown;
let chatDraft = '';

function announce(text) { document.querySelector('#announcement').textContent = text; }
function groupProblems() { return dataset.problems.filter((problem) => problem.group === selectedGroup); }
function currentProblem() { return groupProblems()[currentIndex]; }

function renderMath(container) {
  if (!window.katex) return;
  container.querySelectorAll('[data-math]').forEach((element) => {
    const text = element.textContent;
    const matcher = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)/g;
    const fragment = document.createDocumentFragment();
    let position = 0;
    for (const match of text.matchAll(matcher)) {
      fragment.append(text.slice(position, match.index));
      const span = document.createElement('span');
      window.katex.render(match[1] ?? match[2] ?? match[3] ?? match[4], span, { throwOnError: false, trust: false, displayMode: Boolean(match[1] ?? match[3]), strict: 'ignore' });
      fragment.append(span);
      position = match.index + match[0].length;
    }
    fragment.append(text.slice(position));
    element.replaceChildren(fragment);
  });
}

function renderMarkdown(text) {
  if (!markdown && window.markdownit) {
    markdown = window.markdownit({ html: false, breaks: true, linkify: false });
    // Eksterne bilder og lenker er unødvendige i veilederen.
    markdown.disable(['image', 'link']);
  }
  if (!markdown) return `<p data-math>${escape(text)}</p>`;
  const formulas = [];
  const protectedText = text.replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)/g, (formula) => {
    const index = formulas.push(formula) - 1;
    return `MATHMATEFORMULA${index}END`;
  });
  return markdown.render(protectedText).replace(/MATHMATEFORMULA(\d+)END/g, (_, index) => `<span data-math>${escape(formulas[Number(index)])}</span>`);
}

function updateTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  document.querySelector('#theme-button').innerHTML = icon(dark ? 'sun' : 'moon');
  document.querySelector('#theme-button').setAttribute('aria-label', dark ? 'Bytt til lyst tema' : 'Bytt til mørkt tema');
}
document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
updateTheme();
document.querySelector('#theme-button').addEventListener('click', () => {
  document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  updateTheme();
});
document.querySelector('#home-button').addEventListener('click', () => { if (dataset) showStart(); });

function showStart() {
  chatController?.abort();
  exercise = null;
  chatDraft = '';
  selectedGroup = null;
  document.title = 'MathMate – velg trinn eller fag';
  main.className = 'start-page';
  main.innerHTML = `
    <section class="intro" aria-labelledby="start-title">
      <div class="eyebrow">DIN MATEMATIKKØKT</div>
      <h1 id="start-title">Litt øving.<br><span>Mer forståelse.</span></h1>
      <p>En god forklaring kan gjøre hele forskjellen. Utforsk tekstoppgaver, prøv selv og få hjelp når du trenger det.</p>
      <div class="intro-features"><span>${icon('steps')} Ett steg om gangen</span><span>${icon('spark')} En veileder på laget</span></div>
      <div class="math-art" aria-hidden="true"><span class="art-root">√<span>x + 1</span></span><span class="art-note">Det begynner med et forsøk.</span><span class="art-plus">+</span><span class="art-dots">···</span></div>
    </section>
    <section class="selection-card" aria-labelledby="selection-title">
      <span class="section-number">01 <span>FINN DITT NIVÅ</span></span>
      <h2 id="selection-title">Hva vil du øve på?</h2>
      <p class="muted">Velg klassetrinn eller matematikkfag.</p>
      ${[
        ['Barneskole', ['4', '5', '6', '7']],
        ['Ungdomsskole', ['8', '9', '10']],
        ['Videregående', ['1P', '2P', '1T', 'R1', 'R2', 'S1', 'S2']],
      ].map(([label, groups]) => `<fieldset><legend>${label}</legend><div class="group-options">${groups.filter((id) => dataset.groups.some((group) => group.id === id)).map((id) => `<label class="group-choice"><input type="radio" name="group" value="${id}"><span>${/^\d+$/.test(id) ? `${id}. trinn` : id}</span></label>`).join('')}</div></fieldset>`).join('')}
      <div class="selection-bottom"><p id="selection-summary" aria-live="polite">Velg et nivå for å komme i gang.</p><button id="start-button" class="button primary" disabled>Begynn å øve ${icon('arrow')}</button></div>
    </section>`;
  main.querySelectorAll('input[name="group"]').forEach((radio) => radio.addEventListener('change', () => {
    selectedGroup = radio.value;
    const group = dataset.groups.find((item) => item.id === selectedGroup);
    document.querySelector('#selection-summary').textContent = `${group.label} · ${group.count} oppgaver klare til deg`;
    document.querySelector('#start-button').disabled = false;
  }));
  document.querySelector('#start-button').addEventListener('click', () => openProblem(0));
}

function openProblem(index) {
  chatController?.abort();
  currentIndex = index;
  chatDraft = '';
  exercise = { mode: null, step: 0, answerRevealed: false, feedback: null, answerInput: '', messages: [], busy: false, error: '' };
  renderExercise();
  document.querySelector('#problem-title').focus();
  announce(`Oppgave ${index + 1} av ${groupProblems().length}`);
}

function guidance(problem) {
  const parts = problem.solution.replace(/\s*Svar:\s*[\s\S]*$/i, '').trim()
    .split(/(?<=[.!?])\s+(?=[A-ZÆØÅ])/).filter(Boolean);
  return [
    { title: 'Forstå oppgaven', text: 'Les oppgaven én gang til. Hva vet du allerede, og hva skal du finne? Skriv gjerne ned tallene og enhetene før du regner.' },
    ...parts.map((text, index) => ({ title: parts.length > 1 ? `Regn ut · del ${index + 1}` : 'Regn ut', text })),
  ];
}

function answerMarkup(problem) {
  return `<section class="answer-section" aria-labelledby="answer-heading">
    <h3 id="answer-heading">${exercise.answerRevealed ? 'Fasit' : 'Hva får du til svar?'}</h3>
    ${exercise.answerRevealed ? `<div class="revealed-answer"><span>${icon('check')}</span><strong data-math>${escape(displayAnswer(problem.answer))} ${escape(problem.unit)}</strong></div><p class="muted">Sammenlign med det du kom fram til. Fikk du brukt samme framgangsmåte?</p>` : `
    <form id="answer-form" class="answer-form"><label for="answer-input" class="sr-only">Svaret ditt${problem.unit ? ` i ${escape(problem.unit)}` : ''}</label><div class="answer-input-wrap"><input id="answer-input" name="answer" type="text" autocomplete="off" placeholder="Skriv svaret ditt" value="${escape(exercise.answerInput)}" required><span>${escape(problem.unit)}</span></div><button class="button secondary" type="submit">Sjekk svar ${icon('check')}</button></form>
    <div id="answer-feedback" role="status">${exercise.feedback ? `<p class="feedback ${exercise.feedback === 'correct' ? 'correct' : ''}">${exercise.feedback === 'correct' ? 'Riktig! Godt jobbet. Se gjerne løsningsforslaget også.' : 'Svaret er ulikt fasiten. Prøv igjen, se løsningen eller be AI-veilederen om et hint.'}</p>` : '<p class="answer-help muted">Bruk komma eller punktum for desimaltall. Du kan også skrive en brøk.</p>'}</div>
    <button id="reveal-answer" class="text-button">Vis fasit</button>`}
  </section>`;
}

function workMarkup(problem) {
  if (!exercise.mode) return `<section class="method-section" aria-labelledby="method-heading"><div class="section-heading"><h2 id="method-heading">Hvordan vil du jobbe?</h2><span>Du kan bytte underveis</span></div><div class="method-options"><button class="method-card" data-mode="self"><span class="method-icon">${icon('pen')}</span><strong>Jeg prøver selv</strong><span>Finn fram blyant og papir,<br>og sjekk svaret når du er klar.</span>${icon('arrow', 'method-arrow')}</button><button class="method-card" data-mode="guided"><span class="method-icon orange">${icon('steps')}</span><strong>Hjelp meg steg for steg</strong><span>Se litt av løsningen om gangen,<br>og finn veien videre.</span>${icon('arrow', 'method-arrow')}</button></div></section>`;
  const steps = guidance(problem);
  return `<section class="workspace"><div class="section-heading"><h2>${exercise.mode === 'self' ? 'Din tur til å prøve' : 'Ett steg om gangen'}</h2><button class="text-button" id="change-method">Bytt arbeidsmåte</button></div>
    ${exercise.mode === 'self' ? '<p class="workspace-intro muted">Regn slik du liker best. AI-veilederen er her hvis du står fast.</p>' : `
    <ol class="solution-steps">${steps.slice(0, exercise.step + 1).map((step, index) => `<li><span class="step-number">${index + 1}</span><div><h3>${escape(step.title)}</h3><p data-math>${escape(step.text)}</p></div></li>`).join('')}</ol>
    ${exercise.step < steps.length - 1 ? `<button class="button secondary" id="next-step">Vis neste steg ${icon('arrow')}</button>` : '<p class="guidance-done muted">Nå kan du sammenligne svaret ditt med fasiten.</p>'}`}
    ${answerMarkup(problem)}</section>`;
}

function renderExercise() {
  const problems = groupProblems();
  const problem = currentProblem();
  const group = dataset.groups.find((item) => item.id === selectedGroup);
  document.title = `${group.label} – oppgave ${currentIndex + 1} | MathMate`;
  main.className = 'practice-page';
  main.innerHTML = `
    <div class="practice-top"><button class="text-button back-button" id="change-group">${icon('back')} Bytt trinn eller fag</button><span class="practice-label">${escape(group.label)} <span>·</span> Din økt</span></div>
    <div class="practice-layout ${chatOpen ? '' : 'chat-closed'}">
      <aside class="problem-sidebar" aria-label="Oppgaveliste"><div class="sidebar-heading">DINE OPPGAVER <span>${problems.length}</span></div><nav>${problems.map((item, index) => `<button class="problem-link ${index === currentIndex ? 'active' : ''}" data-problem="${index}" ${index === currentIndex ? 'aria-current="step"' : ''}><span class="problem-number">${String(index + 1).padStart(2, '0')}</span><span>${escape(categoryLabel(item.category))}<small>Oppgave ${index + 1}</small></span>${index === currentIndex ? icon('chevron') : ''}</button>`).join('')}</nav><div class="sidebar-note">${icon('book')}<p>Ta den tiden du trenger.<br>Det er forståelsen som teller.</p></div></aside>
      <div class="exercise-column"><article class="problem-card"><div class="problem-meta"><span class="eyebrow">OPPGAVE ${currentIndex + 1} AV ${problems.length}</span><span class="difficulty">Nivå ${problem.difficulty}</span></div><h1 id="problem-title" tabindex="-1">${escape(categoryLabel(problem.category))}</h1><p class="question" data-math>${escape(problem.question)}</p><div class="problem-card-bottom"><span>${escape(group.label)}</span><span>Tekstoppgave</span></div></article>${workMarkup(problem)}
      <nav class="problem-pagination" aria-label="Bytt oppgave"><button class="button ghost" id="previous-problem" ${currentIndex === 0 ? 'disabled' : ''}>${icon('back')} Forrige</button><span>${currentIndex + 1} / ${problems.length}</span><button class="button secondary" id="next-problem">${currentIndex === problems.length - 1 ? 'Til første oppgave' : 'Neste oppgave'} ${icon('arrow')}</button></nav></div>
      ${chatOpen ? chatMarkup() : `<button id="open-chat" class="button primary open-chat">${icon('spark')} Spør AI-veilederen</button>`}
    </div>`;
  document.querySelector('#change-group').addEventListener('click', showStart);
  main.querySelectorAll('[data-problem]').forEach((button) => button.addEventListener('click', () => openProblem(Number(button.dataset.problem))));
  document.querySelector('#previous-problem').addEventListener('click', () => openProblem(currentIndex - 1));
  document.querySelector('#next-problem').addEventListener('click', () => openProblem((currentIndex + 1) % problems.length));
  main.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => { exercise.mode = button.dataset.mode; renderExercise(); document.querySelector('.workspace h2').setAttribute('tabindex', '-1'); document.querySelector('.workspace h2').focus(); }));
  document.querySelector('#change-method')?.addEventListener('click', () => { exercise.mode = null; renderExercise(); });
  document.querySelector('#next-step')?.addEventListener('click', () => { exercise.step += 1; renderExercise(); const lastStep = document.querySelector('.solution-steps li:last-child'); lastStep.setAttribute('tabindex', '-1'); lastStep.focus(); announce(`Steg ${exercise.step + 1}`); });
  document.querySelector('#answer-input')?.addEventListener('input', (event) => { exercise.answerInput = event.target.value; });
  document.querySelector('#answer-form')?.addEventListener('submit', (event) => { event.preventDefault(); exercise.feedback = checkAnswer(exercise.answerInput, problem.answer, problem.unit) ? 'correct' : 'incorrect'; renderExercise(); document.querySelector('#answer-input')?.focus(); });
  document.querySelector('#reveal-answer')?.addEventListener('click', () => { exercise.answerRevealed = true; renderExercise(); announce(`Fasit: ${problem.answer} ${problem.unit}`); });
  document.querySelector('#close-chat')?.addEventListener('click', () => { chatOpen = false; renderExercise(); document.querySelector('#open-chat').focus(); });
  document.querySelector('#open-chat')?.addEventListener('click', () => { chatOpen = true; renderExercise(); document.querySelector('#chat-input').focus(); });
  bindChat();
  renderMath(main);
}

function chatMarkup() {
  return `<aside class="chat-panel" aria-labelledby="chat-heading"><header class="chat-header"><span class="chat-avatar">${icon('spark')}</span><div><h2 id="chat-heading">AI-veilederen</h2><span>Et lite hint kan være nok</span></div><button class="icon-button" id="close-chat" aria-label="Lukk AI-chat">${icon('close')}</button></header>
    <div class="chat-messages" id="chat-messages" role="log" aria-label="Samtale med AI-veilederen" aria-live="polite"><div class="chat-welcome"><span class="welcome-symbol">${icon('spark')}</span><h3>Vi finner ut av det sammen.</h3><p>Spør om det du lurer på. Jeg hjelper deg videre uten å hoppe rett til svaret.</p></div>
    ${exercise.messages.map((message) => `<div class="message ${message.role}"><span class="message-label">${message.role === 'user' ? 'Du' : 'MathMate'}</span><div class="message-content">${message.role === 'user' ? escape(message.content) : renderMarkdown(message.content)}</div></div>`).join('')}
    ${exercise.busy ? '<div class="thinking" role="status"><span></span><span></span><span></span><span class="sr-only">AI-veilederen tenker …</span></div>' : ''}</div>
    ${!exercise.messages.length ? `<div class="chat-suggestions"><button data-suggestion="Kan du hjelpe meg med å komme i gang uten å gi fasiten?">Hvordan begynner jeg? ${icon('arrow')}</button><button data-suggestion="Kan du gi meg et lite hint til denne oppgaven?">Gi meg et lite hint ${icon('arrow')}</button></div>` : ''}
    <div class="chat-error" id="chat-error" role="alert">${exercise.error ? `${escape(exercise.error)} <button class="text-button" id="retry-chat">Prøv igjen</button>` : ''}</div>
    ${!dataset.aiConfigured ? '<p class="configuration-note">AI-chatten trenger en API-nøkkel i prototypens .env-fil. Oppgavene og løsningsforslagene fungerer likevel.</p>' : ''}
    <form class="chat-form" id="chat-form"><label class="sr-only" for="chat-input">Spør AI-veilederen</label><textarea id="chat-input" rows="2" maxlength="3000" placeholder="Hva lurer du på?" ${exercise.busy || !dataset.aiConfigured ? 'disabled' : ''}>${escape(chatDraft)}</textarea><button class="send-button" type="submit" aria-label="Send melding" ${exercise.busy || !dataset.aiConfigured ? 'disabled' : ''}>${icon('send')}</button></form>
    <div class="chat-footer"><span>AI kan gjøre feil. Tenk gjennom svaret.</span><button class="text-button" id="clear-chat" title="Tøm samtalen">${icon('refresh')} Ny samtale</button></div></aside>`;
}

function bindChat() {
  const input = document.querySelector('#chat-input');
  input?.addEventListener('input', () => { chatDraft = input.value; });
  input?.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); document.querySelector('#chat-form').requestSubmit(); } });
  document.querySelector('#chat-form')?.addEventListener('submit', (event) => { event.preventDefault(); sendMessage(chatDraft); });
  main.querySelectorAll('[data-suggestion]').forEach((button) => { button.disabled = exercise.busy || !dataset.aiConfigured; button.addEventListener('click', () => sendMessage(button.dataset.suggestion)); });
  document.querySelector('#retry-chat')?.addEventListener('click', () => sendMessage(chatDraft));
  document.querySelector('#clear-chat')?.addEventListener('click', () => {
    chatController?.abort();
    exercise.messages = []; exercise.busy = false; exercise.error = ''; chatDraft = '';
    renderExercise(); document.querySelector('#chat-input')?.focus();
  });
  const messages = document.querySelector('#chat-messages');
  if (messages) messages.scrollTop = messages.scrollHeight;
}

async function sendMessage(text) {
  if (!text.trim() || !dataset.aiConfigured || exercise.busy) return;
  const target = exercise;
  const message = { role: 'user', content: text.trim().slice(0, 3000) };
  const history = target.messages.slice(-18);
  target.messages = [...history, message];
  target.busy = true; target.error = ''; chatDraft = '';
  chatController = new AbortController();
  const controller = chatController;
  const problemId = currentProblem().id;
  renderExercise();
  try {
    const response = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problemId, messages: target.messages, answerRevealed: target.answerRevealed }), signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Fikk ikke svar fra AI-veilederen. Prøv igjen.');
    if (controller.signal.aborted || exercise !== target) return;
    target.messages.push({ role: 'assistant', content: data.reply });
  } catch (error) {
    if (controller.signal.aborted || exercise !== target) return;
    target.messages = history;
    target.error = error instanceof TypeError ? 'Fikk ikke kontakt med den lokale serveren. Kontroller at den kjører, og prøv igjen.' : error.message;
    chatDraft = message.content;
  } finally {
    if (!controller.signal.aborted && exercise === target) {
      target.busy = false; renderExercise();
      document.querySelector('#chat-input')?.focus();
    }
  }
}

async function initialize() {
  try {
    const response = await fetch('/api/problems');
    if (!response.ok) throw new Error('Kunne ikke hente oppgavene.');
    dataset = await response.json();
    showStart();
  } catch {
    main.innerHTML = `<section class="load-error"><h1>Oppgavene kunne ikke lastes</h1><p>Kontroller at den lokale serveren kjører og at Excel-filen ligger i data-mappen.</p><button id="reload" class="button primary">Prøv igjen ${icon('refresh')}</button></section>`;
    document.querySelector('#reload').addEventListener('click', initialize);
  }
}
initialize();
