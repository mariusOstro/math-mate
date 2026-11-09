import Link from 'next/link';
import { cookies } from 'next/headers';
import { BROWSER_COOKIE, verifyBrowser } from '@/lib/browser-identity';
import { getPracticeUseCases } from '@/di/container';

export const dynamic = 'force-dynamic';
export default async function StorageInformation() {
  let userNumber: number | null = null;
  try {
    const id = verifyBrowser((await cookies()).get(BROWSER_COOKIE)?.value);
    if (id) userNumber = await getPracticeUseCases().browserNumber(id);
  } catch {
    /* The information page remains available if the profile cannot be read. */
  }
  return (
    <main className="storage-information">
      <h1>Om lagring i MathMate</h1>
      <section
        className="user-reference"
        aria-labelledby="user-reference-heading"
      >
        <h2 id="user-reference-heading">Ditt brukernummer</h2>
        {userNumber !== null ? (
          <>
            <p className="user-reference-value">{userNumber}</p>
            <p>
              Ønsker du å få dataene dine slettet, kan du kontakte den som
              drifter MathMate og oppgi brukernummer{' '}
              <strong>{userNumber}</strong>. Da kan nettleserprofilen og
              tilhørende aktivitet, svar og samtaler finnes igjen.
            </p>
          </>
        ) : (
          <p>
            Brukernummeret vises øverst i MathMate når nettleserprofilen er
            klar. <Link href="/">Åpne MathMate for å se nummeret ditt.</Link>
          </p>
        )}
        <p>
          Nummeret er en referanse, ikke et passord. Ved delt nettleserprofil
          kan flere personer ha samme brukernummer.
        </p>
      </section>
      <p>
        MathMate lagrer hvilke oppgaver som åpnes, innsendte svar og om de er
        riktige, bruk av løsningssteg og fasit, tidsbruk og meldinger til og fra
        AI-veilederen. Opplysningene brukes til å undersøke hvordan tjenesten
        brukes og hvordan veiledningen fungerer.
      </p>
      <p>
        Du trenger ingen konto. En tilfeldig bruker-ID beholdes i nettleserens
        localStorage. En signert, nødvendig nettlesercookie hindrer at andre får
        tilgang til data bare ved å kjenne denne ID-en. Bruker-ID-en
        identifiserer en nettleserprofil og er ikke en bekreftet
        personidentitet. Ved delt nettleserprofil kan flere personer få samme
        ID.
      </p>
      <p>
        Data lagres i Supabase. Når du bruker chatten, sendes den aktuelle
        oppgaven og relevant samtalehistorikk til OpenAI. Unngå å skrive navn,
        kontaktopplysninger eller andre personopplysninger i svarfeltet eller
        chatten.
      </p>
      <p>
        Ved en kortvarig tilkoblingsfeil mellomlagres ventende handlinger i
        nettleseren og sendes på nytt. Mellomlagrede handlinger fjernes etter
        bekreftet levering. Automatisk sletting av serverloggene er foreløpig
        ikke aktivert.
      </p>
      <Link className="button primary" href="/">
        Tilbake til MathMate
      </Link>
    </main>
  );
}
