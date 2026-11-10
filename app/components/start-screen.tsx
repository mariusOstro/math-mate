import { ArrowRight, Sparkles, ListOrdered } from 'lucide-react';
import type { MathMateState } from '../hooks/use-mathmate';

const groups: [string, string[]][] = [
  ['Barneskole', ['4', '5', '6', '7']],
  ['Ungdomsskole', ['8', '9', '10']],
  ['Videregående', ['1P', '2P', '1T', 'R1', 'R2', 'S1', 'S2']],
];

export function StartScreen({ state }: { state: MathMateState }) {
  const level = state.bootstrap?.levels.find(
    (item) => item.id === state.selectedLevel,
  );
  return (
    <main id="main" className="start-page" tabIndex={-1}>
      <section className="intro" aria-labelledby="start-title">
        <div className="eyebrow">DIN MATEMATIKKØKT</div>
        <h1 id="start-title">
          Litt øving.
          <br />
          <span>Mer forståelse.</span>
        </h1>
        <p>
          En god forklaring kan gjøre hele forskjellen. Utforsk tekstoppgaver,
          prøv selv og få hjelp når du trenger det.
        </p>
        <div className="intro-features">
          <span>
            <ListOrdered className="icon" /> Ett steg om gangen
          </span>
          <span>
            <Sparkles className="icon" /> En veileder på laget
          </span>
        </div>
        <div className="math-art" aria-hidden="true">
          <span className="art-root">
            √<span>x + 1</span>
          </span>
          <span className="art-note">Det begynner med et forsøk.</span>
          <span className="art-plus">+</span>
          <span className="art-dots">···</span>
        </div>
      </section>
      <section className="selection-card" aria-labelledby="selection-title">
        <span className="section-number">
          01 <span>FINN DITT NIVÅ</span>
        </span>
        <h2 id="selection-title">Hva vil du øve på?</h2>
        <p className="muted">
          Velg klassetrinn eller matematikkfag. Du fortsetter med neste oppgave
          du ikke har prøvd.
        </p>
        {groups.map(([label, codes]) => (
          <fieldset key={label} disabled={state.working}>
            <legend>{label}</legend>
            <div className="group-options">
              {codes
                .filter((id) =>
                  state.bootstrap?.levels.some((item) => item.id === id),
                )
                .map((id) => (
                  <label key={id} className="group-choice">
                    <input
                      type="radio"
                      name="group"
                      value={id}
                      checked={state.selectedLevel === id}
                      onChange={() => state.setSelectedLevel(id)}
                    />
                    <span>{/^\d+$/.test(id) ? `${id}. trinn` : id}</span>
                  </label>
                ))}
            </div>
          </fieldset>
        ))}
        {!state.bootstrap?.levels.length && (
          <p className="configuration-note">
            Ingen oppgaver er tilgjengelige ennå. Oppgavebanken må fylles før du
            kan begynne.
          </p>
        )}
        <div className="selection-bottom">
          <p aria-live="polite">
            {level
              ? `${level.label} · ${level.count} oppgaver i oppgavebanken`
              : 'Velg et nivå for å komme i gang.'}
          </p>
          <button
            className="button primary"
            onClick={() => void state.start()}
            disabled={!level || state.working}
          >
            {state.working ? 'Henter oppgaver …' : 'Begynn å øve'}{' '}
            <ArrowRight className="icon" />
          </button>
        </div>
        {state.levelNotice && (
          <p className="configuration-note" role="status">
            {state.levelNotice}
          </p>
        )}
      </section>
    </main>
  );
}
