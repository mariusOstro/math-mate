import { useEffect, useRef } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  ListOrdered,
  PencilLine,
  Sparkles,
} from 'lucide-react';
import {
  categoryLabel,
  displayAnswer,
  levelLabel,
} from '@/entities/models/mathmate';
import type { MathMateState } from '../hooks/use-mathmate';
import { ChatPanel } from './chat-panel';
import { MathText } from './math-text';

function AnswerForm({ state }: { state: MathMateState }) {
  const exercise = state.exercise!;
  const problem = state.problems[state.index];
  return (
    <section className="answer-section" aria-labelledby="answer-heading">
      <h3 id="answer-heading">
        {exercise.answer ? 'Fasit' : 'Hva får du til svar?'}
      </h3>
      {exercise.answer ? (
        <>
          <div className="revealed-answer">
            <Check className="icon" />
            <strong>
              {displayAnswer(exercise.answer.answer)} {exercise.answer.unit}
            </strong>
          </div>
          <p className="muted">
            Sammenlign med det du kom fram til. Fikk du brukt samme
            framgangsmåte?
          </p>
        </>
      ) : (
        <>
          <form
            className="answer-form"
            onSubmit={(event) => {
              event.preventDefault();
              void state.submit();
            }}
          >
            <label htmlFor="answer-input" className="sr-only">
              Svaret ditt
              {problem.answer_unit ? ` i ${problem.answer_unit}` : ''}
            </label>
            <div className="answer-input-wrap">
              <input
                id="answer-input"
                name="answer"
                type="text"
                autoComplete="off"
                maxLength={3000}
                placeholder="Skriv svaret ditt"
                value={exercise.input}
                onChange={(event) => state.setInput(event.target.value)}
                onBlur={state.inputBlur}
                required
                disabled={state.working}
              />
              <span>{problem.answer_unit}</span>
            </div>
            <button
              className="button secondary"
              type="submit"
              disabled={state.working || !exercise.input.trim()}
            >
              {state.working ? 'Sjekker …' : 'Sjekk svar'}{' '}
              <Check className="icon" />
            </button>
          </form>
          <div role="status" aria-live="polite">
            {exercise.feedback ? (
              <p
                className={`feedback ${exercise.feedback.isCorrect ? 'correct' : ''}`}
              >
                {exercise.feedback.isCorrect
                  ? 'Riktig! Godt jobbet. Se gjerne løsningsforslaget også.'
                  : 'Svaret er ulikt fasiten. Prøv igjen, se løsningen eller be AI-veilederen om et hint.'}
              </p>
            ) : (
              <p className="answer-help muted">
                Bruk komma eller punktum for desimaltall. Du kan også skrive en
                brøk.
              </p>
            )}
          </div>
          <button
            className="text-button"
            disabled={state.working}
            onClick={() => void state.reveal()}
          >
            Vis fasit
          </button>
        </>
      )}
    </section>
  );
}

export function ExerciseScreen({ state }: { state: MathMateState }) {
  const exercise = state.exercise!;
  const problem = state.problems[state.index];
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus();
    document.title = `${levelLabel(problem.level_code)} – oppgave ${state.index + 1} | MathMate`;
  }, [problem.id, problem.level_code, state.index]);
  return (
    <main id="main" className="practice-page" tabIndex={-1}>
      <div className="practice-top">
        <button
          className="text-button back-button"
          disabled={state.working}
          onClick={() => void state.home()}
        >
          <ArrowLeft className="icon" /> Bytt trinn eller fag
        </button>
        <span className="practice-label">
          {levelLabel(problem.level_code)} <span>·</span> Din økt
        </span>
      </div>
      <div className={`practice-layout ${state.chatOpen ? '' : 'chat-closed'}`}>
        <aside className="problem-sidebar" aria-label="Oppgaveliste">
          <div className="sidebar-heading">
            DINE OPPGAVER <span>{state.problems.length}</span>
          </div>
          <nav>
            {state.problems.map((item, index) => (
              <button
                key={item.id}
                className={`problem-link ${index === state.index ? 'active' : ''}`}
                aria-current={index === state.index ? 'step' : undefined}
                disabled={state.working}
                onClick={() => void state.navigate(index)}
              >
                <span className="problem-number">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span>
                  {categoryLabel(item.category)}
                  <small>Oppgave {index + 1}</small>
                </span>
                {index === state.index && <ChevronRight className="icon" />}
              </button>
            ))}
          </nav>
          <div className="sidebar-note">
            <BookOpen className="icon" />
            <p>
              Ta den tiden du trenger.
              <br />
              Det er forståelsen som teller.
            </p>
          </div>
        </aside>
        <div className="exercise-column">
          <article className="problem-card">
            <div className="problem-meta">
              <span className="eyebrow">
                OPPGAVE {state.index + 1} AV {state.problems.length}
              </span>
              <span className="difficulty">Nivå {problem.difficulty}</span>
            </div>
            <h1 id="problem-title" ref={title} tabIndex={-1}>
              {categoryLabel(problem.category)}
            </h1>
            <MathText className="question">{problem.question}</MathText>
            <div className="problem-card-bottom">
              <span>{levelLabel(problem.level_code)}</span>
              <span>Tekstoppgave</span>
            </div>
          </article>
          {!exercise.mode ? (
            <section
              className="method-section"
              aria-labelledby="method-heading"
            >
              <div className="section-heading">
                <h2 id="method-heading">Hvordan vil du jobbe?</h2>
                <span>Du kan bytte underveis</span>
              </div>
              <div className="method-options">
                <button
                  className="method-card"
                  disabled={state.working}
                  onClick={() => void state.mode('self')}
                >
                  <span className="method-icon">
                    <PencilLine className="icon" />
                  </span>
                  <strong>Jeg prøver selv</strong>
                  <span>
                    Finn fram blyant og papir,
                    <br />
                    og sjekk svaret når du er klar.
                  </span>
                  <ArrowRight className="icon method-arrow" />
                </button>
                <button
                  className="method-card"
                  disabled={state.working || !exercise.steps.length}
                  onClick={() => void state.mode('guided')}
                >
                  <span className="method-icon orange">
                    <ListOrdered className="icon" />
                  </span>
                  <strong>Hjelp meg steg for steg</strong>
                  <span>
                    Se litt av løsningen om gangen,
                    <br />
                    og finn veien videre.
                  </span>
                  <ArrowRight className="icon method-arrow" />
                </button>
              </div>
            </section>
          ) : (
            <section className="workspace">
              <div className="section-heading">
                <h2>
                  {exercise.mode === 'self'
                    ? 'Din tur til å prøve'
                    : 'Ett steg om gangen'}
                </h2>
                <button
                  className="text-button"
                  disabled={state.working}
                  onClick={() => void state.mode(null)}
                >
                  Bytt arbeidsmåte
                </button>
              </div>
              {exercise.mode === 'self' ? (
                <p className="workspace-intro muted">
                  Regn slik du liker best. AI-veilederen er her hvis du står
                  fast.
                </p>
              ) : (
                <>
                  <ol className="solution-steps" aria-live="polite">
                    {exercise.revealed.map((step, index) => (
                      <li key={step.id}>
                        <span className="step-number">{index + 1}</span>
                        <div>
                          <h3>{step.title}</h3>
                          <MathText>{step.content}</MathText>
                        </div>
                      </li>
                    ))}
                  </ol>
                  {exercise.revealed.length < exercise.steps.length ? (
                    <button
                      className="button secondary"
                      disabled={state.working}
                      onClick={() => void state.nextStep()}
                    >
                      Vis neste steg <ArrowRight className="icon" />
                    </button>
                  ) : (
                    <p className="guidance-done muted">
                      Nå kan du sammenligne svaret ditt med fasiten.
                    </p>
                  )}
                </>
              )}
              <AnswerForm state={state} />
            </section>
          )}
          <nav className="problem-pagination" aria-label="Bytt oppgave">
            <button
              className="button ghost"
              disabled={state.index === 0 || state.working}
              onClick={() => void state.navigate(state.index - 1)}
            >
              <ArrowLeft className="icon" /> Forrige
            </button>
            <span>
              {state.index + 1} / {state.problems.length}
            </span>
            <button
              className="button secondary"
              disabled={state.working}
              onClick={() =>
                void state.navigate((state.index + 1) % state.problems.length)
              }
            >
              {state.index === state.problems.length - 1
                ? 'Til første oppgave'
                : 'Neste oppgave'}{' '}
              <ArrowRight className="icon" />
            </button>
          </nav>
        </div>
        {state.chatOpen ? (
          <ChatPanel state={state} />
        ) : (
          <button
            className="button primary open-chat"
            onClick={state.toggleChat}
          >
            <Sparkles className="icon" /> Spør AI-veilederen
          </button>
        )}
      </div>
    </main>
  );
}
