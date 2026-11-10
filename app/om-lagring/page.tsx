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
              Ønsker du å få dataene dine slettet, kan du kontakte meg på 
              marius.w.ostro@gmail.com og oppgi brukernummer{' '}
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
        personidentitet.
      </p>
      <p>
        Ikke oppgi navn eller annen personlig informasjon i meldinger til AI-veilederen.
        Chatter blir lagret digitalt. All lagret chat-historikk vil slettes
        ved prosjektets slutt, mot slutten av Januar 2027.
      </p>
     
      <Link className="button primary" href="/">
        Tilbake til MathMate
      </Link>
    </main>
  );
}
