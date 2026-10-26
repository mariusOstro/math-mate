# MathMate – lokal norsk prototype

En selvstendig prototype med MathMates varme farger og arbeidsflyt: velg nivå, les oppgaven, prøv selv eller se løsningen stegvis, og spør AI-veilederen om hjelp. Alt i grensesnittet er på bokmål.

## Kom i gang

Du trenger Node.js 22 eller nyere og npm. Kjør fra denne mappen:

```powershell
cd prototype
npm install
npm run dev
```

Åpne **http://localhost:3001**. Hvis terminalen allerede står i `prototype`, hopper du over `cd prototype`. Stopp serveren med `Ctrl+C`.

`npm start` starter uten automatisk omstart av serverkoden. Ingen byggeprosess er nødvendig. Ved endring av HTML, CSS eller JavaScript i `public/` laster du siden på nytt i nettleseren.

## AI-chat

På denne maskinen er bare `OPENAI_API_KEY` kopiert fra det opprinnelige prosjektets `.env` til prototypens egen, git-ignorerte `.env`. Den opprinnelige filen er ikke endret. Ingen innloggingsnøkler eller databaseinnstillinger brukes.

Ved flytting til en annen maskin:

```powershell
Copy-Item .env.example .env
```

Fyll deretter inn din egen nøkkel:

```dotenv
OPENAI_API_KEY=din_api_nøkkel
OPENAI_MODEL=gpt-4o
PORT=3001
```

API-nøkkelen trenger tilgang til den valgte modellen og tilgjengelig API-kvote/saldo. AI-chatten trenger internettilgang. Nøkkelen brukes bare på serveren og sendes aldri til nettleseren. Modellen er den samme som i originalprosjektet og kan endres med `OPENAI_MODEL`. Start serveren på nytt etter endring av `.env`.

Uten nøkkel fungerer fortsatt nivåvalg, oppgaver, svarsjekk, fasit og løsningsforslag. Chatten viser hva som mangler. Feil nøkkel, oppbrukt kvote og nettverksproblemer gir norske feilmeldinger. Prototypen leser kun sin egen `.env`, og er ikke avhengig av foreldremappen.

## Lokale oppgaver

Kilden er den medfølgende **`data/Matematikk_tekstoppgaver_1550.xlsx`**, arket `Oppgaver`. Filen leses direkte ved hver serveroppstart. Ingen database, forhåndslagret JSON eller ekstern oppgavetjeneste brukes.

Prototypen velger tre oppgaver fra hver av de 14 gruppene, totalt 42:

- 4., 5., 6., 7., 8., 9. og 10. trinn
- Matematikk 1P, 2P, 1T, R1, R2, S1 og S2

Utvalget dekker ulike steder i vanskelighetsrekkefølgen og prioriterer forskjellige kategorier. Oppgavetekst, vanskelighetsgrad, fasit, enhet og løsningsforslag kommer fra Excel-filen. Utvalgslogikken ligger i `lib/problems.mjs`. Behold kolonnene `oppgave_id`, `oppgavetekst`, `trinn_fag`, `vanskelighetsgrad`, `kategori`, `fasit_verdi`, `fasit_enhet` og `løsningsforslag`.

Stegvis visning starter med en lesestrategi og viser deretter innholdet i Excel-filens løsningsforslag i deler. Det genereres ikke nye løsninger ved oppstart. Noen løsningsforslag inneholder allerede svaret i beregningen.

Svarsjekken godtar komma og punktum som desimaltegn, vanlige tallbrøker og svar med den oppgitte enheten. Symbolske svar sammenlignes som tekst, med toleranse for mellomrom. Den utfører ikke vilkårlig algebra eller kode. Ved en annen, matematisk likeverdig skrivemåte kan eleven bruke fasiten, løsningsforslaget eller AI-veilederen til å sammenligne.

## Lagring og nettverk

- Ingen innlogging, autentisering, database, sporing, analyseverktøy eller aktivitetslogging.
- Ingen cookies, `localStorage`, `sessionStorage` eller serverlagret chatthistorikk.
- Oppgavevalg, svarfelt, fargetema og samtaler finnes bare i nettleserens arbeidsminne. Samtalen tømmes ved bytte av oppgave, «Ny samtale» eller oppdatering av siden.
- Ved chat sendes den gjeldende oppgaven, fasit/løsningsforslag og inntil ni tidligere meldingspar til OpenAI, via den lokale serveren. Hele Excel-filen sendes aldri.
- Chat-kall bruker `store: false`. OpenAI kan fortsatt behandle og beholde data etter sine API-vilkår og sikkerhetsrutiner. Se [OpenAIs datakontroller](https://developers.openai.com/api/docs/guides/your-data).
- Skrifttyper, matematikkvisning, bilder og andre ressurser leveres lokalt. Kun AI-chatten bruker en ekstern tjeneste under bruk. Første `npm install` laster ned avhengigheter fra npm.
- Serveren lytter bare på `127.0.0.1`. Terminalen viser oppstartsadressen og eventuelle oppstartsfeil, men logger ikke forespørsler, brukerhandlinger eller samtaler.

Dette er en lokal prototype. Den inneholder ikke et oppsett for offentlig publisering.

## Tester

```powershell
npm test
```

Testene sjekker Excel-dekning, svarsjekk, lokal levering av ressurser, at nøkkelen ikke sendes til nettleseren, chatkontekst og feilhåndtering. De bruker simulerte OpenAI-svar og krever ingen nøkkel eller betalte API-kall.

## Filer

```text
prototype/
  data/                  Original Excel-fil som lokal datakilde
  lib/problems.mjs       Innlesing og utvalg av oppgaver
  lib/chat.mjs           Norsk AI-veileder og validering
  public/                Norsk grensesnitt, stilark, logo og svarsjekk
  tests/                 Tester med Nodes innebygde testkjører
  server.mjs             Lokal HTTP-server og chat-endepunkt
  .env.example           Mal for nøkkel, modell og port
  package.json           npm-kommandoer og avhengigheter
```

Mappen kan kopieres og brukes alene. Den importerer ingen kode, innstillinger eller avhengigheter fra det opprinnelige prosjektet. Logoen er gjenbrukt fra originalprosjektet.
