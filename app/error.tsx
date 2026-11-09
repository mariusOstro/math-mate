'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="load-error">
      <h1>Noe gikk galt</h1>
      <p>Prøv å laste inn MathMate på nytt.</p>
      <button className="button primary" onClick={reset}>
        Prøv igjen
      </button>
    </main>
  );
}
