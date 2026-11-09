import Link from 'next/link';
export default function StorageInformation() {
  return (
    <main className="storage-information">
      <h1>Om lagring i MathMate</h1>
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
