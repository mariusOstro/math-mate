'use client';

import Image from 'next/image';
import { Moon, RefreshCw, Sun } from 'lucide-react';
import { useMathMate } from '../hooks/use-mathmate';
import { StartScreen } from './start-screen';
import { ExerciseScreen } from './exercise-screen';

export function MathMateApp() {
  const state = useMathMate();
  return (
    <>
      <a className="skip-link" href="#main">
        Hopp til innholdet
      </a>
      <header className="site-header">
        <button
          className="brand"
          aria-label="MathMate – til start"
          disabled={state.working}
          onClick={() => void state.home()}
        >
          <Image
            src="/logo.svg"
            alt="MathMate"
            width={171}
            height={60}
            priority
          />
        </button>
        <div className="header-actions">
          <span className="prototype-label" role="status">
            <span className="status-dot" />
            {state.sync.pending ? 'Lagrer …' : 'Din matematikkøkt'}
          </span>
          <button
            className="icon-button"
            onClick={state.toggleTheme}
            aria-label={
              state.dark ? 'Bytt til lyst tema' : 'Bytt til mørkt tema'
            }
          >
            {state.dark ? <Sun className="icon" /> : <Moon className="icon" />}
          </button>
        </div>
      </header>
      {state.ready && state.error && (
        <div className="app-notice error-notice" role="alert">
          {state.error}
          {state.error.includes('Last siden på nytt') && (
            <button
              className="text-button"
              onClick={() => window.location.reload()}
            >
              Start en ny økt
            </button>
          )}
        </div>
      )}
      {state.ready && state.sync.error && (
        <div className="app-notice" role="status">
          <span>
            {state.sync.pending} handlinger venter på lagring.{' '}
            {state.sync.error}
          </span>
          <button
            className="text-button"
            onClick={() => void state.retrySync()}
          >
            <RefreshCw className="icon" /> Prøv igjen
          </button>
        </div>
      )}
      {state.ready && !state.sync.durable && (
        <div className="app-notice">
          Nettleseren støtter ikke varig mellomlagring her. Hold siden åpen til
          lagringen er fullført.
        </div>
      )}
      {!state.ready ? (
        <main id="main" tabIndex={-1}>
          <section
            className="load-error"
            role={state.error ? 'alert' : 'status'}
          >
            {state.error ? (
              <>
                <h1>MathMate kunne ikke starte</h1>
                <p>{state.error}</p>
                <button
                  className="button primary"
                  onClick={state.retryInitialization}
                >
                  Prøv igjen <RefreshCw className="icon" />
                </button>
              </>
            ) : (
              <p>Henter oppgavene dine …</p>
            )}
          </section>
        </main>
      ) : state.exercise ? (
        <ExerciseScreen state={state} />
      ) : (
        <StartScreen state={state} />
      )}
      <footer className="site-footer">
        <span>Matematikk, ett steg om gangen.</span>
        <span>
          Aktivitet, svar og samtaler lagres.{' '}
          <a href="/om-lagring">Om lagring</a>
        </span>
      </footer>
    </>
  );
}
