import { useEffect, useRef } from 'react';
import {
  ArrowRight,
  RefreshCw,
  SendHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import type { MathMateState } from '../hooks/use-mathmate';
import { MathText } from './math-text';

export function ChatPanel({ state }: { state: MathMateState }) {
  const exercise = state.exercise!;
  const messages = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (messages.current)
      messages.current.scrollTop = messages.current.scrollHeight;
  }, [exercise.messages, exercise.chatBusy]);
  return (
    <aside className="chat-panel" aria-labelledby="chat-heading">
      <header className="chat-header">
        <span className="chat-avatar">
          <Sparkles className="icon" />
        </span>
        <div>
          <h2 id="chat-heading">AI-veilederen</h2>
          <span>Et lite hint kan være nok</span>
        </div>
        <button
          className="icon-button"
          onClick={state.toggleChat}
          aria-label="Lukk AI-chat"
        >
          <X className="icon" />
        </button>
      </header>
      <div
        className="chat-messages"
        ref={messages}
        role="log"
        aria-label="Samtale med AI-veilederen"
        aria-live="polite"
      >
        <div className="chat-welcome">
          <span className="welcome-symbol">
            <Sparkles className="icon" />
          </span>
          <h3>Vi finner ut av det sammen.</h3>
          <p>
            Spør om det du lurer på. Jeg hjelper deg videre uten å hoppe rett
            til svaret.
          </p>
        </div>
        {exercise.messages.map((message) => (
          <div key={message.id} className={`message ${message.role}`}>
            <span className="message-label">
              {message.role === 'user' ? 'Du' : 'MathMate'}
            </span>
            {message.role === 'user' ? (
              <div className="message-content">{message.content}</div>
            ) : (
              <MathText className="message-content">
                {message.content ||
                  (message.status === 'failed'
                    ? 'Denne forespørselen kunne ikke fullføres.'
                    : 'Arbeider med svaret …')}
              </MathText>
            )}
          </div>
        ))}
        {exercise.chatBusy && (
          <div className="thinking" role="status">
            <span />
            <span />
            <span />
            <span className="sr-only">AI-veilederen tenker …</span>
          </div>
        )}
      </div>
      {!exercise.messages.length && (
        <div className="chat-suggestions">
          <button
            disabled={exercise.chatBusy || !state.bootstrap?.chatEnabled}
            onClick={() =>
              void state.chat(
                'Kan du hjelpe meg med å komme i gang uten å gi fasiten?',
              )
            }
          >
            Hvordan begynner jeg? <ArrowRight className="icon" />
          </button>
          <button
            disabled={exercise.chatBusy || !state.bootstrap?.chatEnabled}
            onClick={() =>
              void state.chat('Kan du gi meg et lite hint til denne oppgaven?')
            }
          >
            Gi meg et lite hint <ArrowRight className="icon" />
          </button>
        </div>
      )}
      {exercise.chatError && (
        <div className="chat-error" role="alert">
          {exercise.chatError}{' '}
          <button
            className="text-button"
            onClick={() => void state.chat(exercise.draft)}
            disabled={exercise.chatBusy || !exercise.draft.trim()}
          >
            Prøv igjen
          </button>
        </div>
      )}
      {!state.bootstrap?.chatEnabled && (
        <p className="configuration-note">
          AI-chatten er ikke tilgjengelig akkurat nå. Du kan fortsatt bruke
          oppgavene og løsningsforslagene.
        </p>
      )}
      <form
        className="chat-form"
        onSubmit={(event) => {
          event.preventDefault();
          void state.chat(exercise.draft);
        }}
      >
        <label className="sr-only" htmlFor="chat-input">
          Spør AI-veilederen
        </label>
        <textarea
          id="chat-input"
          rows={2}
          maxLength={3000}
          placeholder="Hva lurer du på?"
          value={exercise.draft}
          disabled={exercise.chatBusy || !state.bootstrap?.chatEnabled}
          onChange={(event) => state.setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button
          className="send-button"
          type="submit"
          aria-label="Send melding"
          disabled={
            exercise.chatBusy ||
            !state.bootstrap?.chatEnabled ||
            !exercise.draft.trim()
          }
        >
          <SendHorizontal className="icon" />
        </button>
      </form>
      <div className="chat-footer">
        <span>AI kan gjøre feil. Tenk gjennom svaret.</span>
        <button className="text-button" onClick={() => void state.clearChat()}>
          <RefreshCw className="icon" /> Ny samtale
        </button>
      </div>
    </aside>
  );
}
