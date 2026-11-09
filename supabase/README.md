# MathMate: databaseskjema og utrulling til Supabase

Migreringen i `migrations/20261109000000_create_mathmate_schema.sql` oppretter hele den nye datamodellen. Den kjøres med Supabase CLI; du trenger ikke opprette tabeller i Table Editor.

Kjør kommandoene fra **rotmappen `math-mate`**, der denne `supabase`-mappen ligger. Ikke kjør dem fra `prototype`.

## Første utrulling

1. Opprett et Supabase-prosjekt, og ta vare på databasepassordet du velger. Et nytt, tomt prosjekt er enklest for denne nye modellen.
2. Finn prosjektets referanse i Dashboard-adressen: `https://supabase.com/dashboard/project/PROSJEKTREFERANSE`.
3. Kjør:

```powershell
supabase login
supabase link --project-ref DIN_PROSJEKTREFERANSE
supabase db push --dry-run
supabase db push
```

Erstatt `DIN_PROSJEKTREFERANSE`. CLI-en ber ved behov om **databasepassordet**, ikke API-nøkkelen. `login` logger utvikleren inn i CLI-en; det innfører ingen innlogging for elevene.

Supabase CLI 2.48.3 er allerede installert på maskinen hvor oppsettet ble laget. `config.toml` finnes allerede, så du trenger ikke kjøre `supabase init`. På andre maskiner kan du installere CLI-en etter [Supabases veiledning](https://supabase.com/docs/guides/local-development/cli/getting-started), eller bruke `npx supabase` i stedet for `supabase` i kommandoene. npm-varianten krever Node.js 20 eller nyere.

`--dry-run` viser hvilke migreringer som vil bli kjørt. Den siste kommandoen oppretter tabellene, visningene, indeksene og triggerne. CLI-en registrerer fullførte migreringer i sin migreringshistorikk og bruker bare nye migreringer ved senere kjøring.

Denne direkte utrullingen trenger ikke at du starter den lokale Docker-baserte Supabase-stakken. `supabase start` er for lokal Supabase-utvikling.

### Hvis prosjektet allerede inneholder tabeller

Ikke bruk en eksisterende produksjonsdatabase som et tomt prosjekt. Avklar først hvilke migreringer som eier skjemaet, og ta vare på eksisterende data og migreringshistorikk.

`supabase db pull` kan hente et eksisterende skjema til en lokal baselinemigrering. Gjør dette **før** den nye MathMate-migreringen i en egen mappe/arbeidskopi, slik at baseline blir eldre enn den nye migreringen. Kontroller og test begge før utrulling. Ikke lag en nyere baseline som forsøker å opprette MathMate-tabeller som en eldre migrering allerede har opprettet. `db pull` kan kreve Docker avhengig av CLI-versjonen.

Ikke bruk `db reset` med et eksternt mål for å få migreringshistorikken til å passe. Det er en annen operasjon enn en vanlig `db push`.

## Innhold

| Tabell | Formål |
|---|---|
| `app_users` | Stabil, pseudonym nettleser-ID som kan beholdes i localStorage |
| `sessions` | Økter, aktivitetstidspunkt, avslutningsgrunn og appversjon |
| `problems` | Excel-oppgaver, fasit, enhet, løsningsforslag og versjoner |
| `solution_steps` | Nummererte steg knyttet til en bestemt oppgaveversjon |
| `problem_attempts` | Ett arbeidsforløp med en oppgave i en økt |
| `answer_submissions` | Hvert innsendt svar og serverens evaluering |
| `chat_threads` | Samtaler knyttet til et oppgaveforsøk |
| `chat_messages` | Elevmeldinger, AI-svar, feil, modell, promptversjon og tokenforbruk |
| `events` | Handlinger, stegvis visning, fasitvisning og aktivitetspulser |

Visningene `attempt_stats`, `session_stats`, `user_stats` og `problem_stats` beregner statistikk fra grunnlagsdataene. Hjelpetabeller og sammenkoblinger aggregeres hver for seg, så mange chatmeldinger ikke mangedobler antallet innsendte svar.

Databasen bruker UUID-er, `timestamptz`, fremmednøkler og kontrollregler. Supabase bruker normalt UTC; vis lokal tid i grensesnittet.

### Oppgaver og versjoner

Excel-kolonnene mappes slik:

| Excel | Database |
|---|---|
| `oppgave_id` | `source_id` |
| `oppgavetekst` | `question` |
| `trinn_fag` | `level_code` |
| `vanskelighetsgrad` | `difficulty` |
| `kategori` | `category` |
| `fasit_verdi` | `answer_value` |
| `fasit_enhet` | `answer_unit` |
| `løsningsforslag` | `solution` |

`answer_value` lagres som tekst for å bevare både tall og eventuelle symbolske svar. `validation_rules` er et JSON-objekt for den serverbaserte svarsjekken, for eksempel:

```json
{
  "answer_type": "numeric",
  "decimal_places": 2,
  "absolute_tolerance": 0.005,
  "accepted_answers": []
}
```

Reglene må implementeres i svarsjekken; databasen kjører ikke et matematisk uttrykk eller en AI-evaluering av seg selv.

Innholdet i en oppgaverad kan ikke overskrives. Ved retting oppretter du en ny rad med samme `source_id`, ny UUID og økt `version`. Sett først gammel versjon til `is_active = false`, og sett inn den nye versjonen i samme transaksjon. Det finnes maksimalt én aktiv versjon per `source_id`. Løsningssteg kan redigeres fram til oppgaven har fått et oppgaveforsøk; etter dette må også stegendringer få en ny oppgaveversjon.

### Tilgang uten elevinnlogging

Alle ni tabeller har RLS aktivert. `anon` og `authenticated` har ingen tilgang til tabellene eller statistikkvisningene. Dette er med vilje: en UUID fra localStorage er ikke en autentisert identitet og kan ikke brukes som bevis på eierskap i en RLS-policy.

Dataflyten er **nettleser → appens server/API → Supabase**. Den lokale prototypens server kan senere erstattes eller utvides med serverruter i den deployede applikasjonen.

Serveren bruker Supabases hemmelige servernøkkel, som holdes i serverens miljøvariabler. Denne må aldri ligge i `NEXT_PUBLIC_*`, i nettleserkoden eller i Git. Databaserollen `service_role` kan lese og skrive modellens tabeller og lese statistikken. Hendelser kan settes inn og slettes for opprydding, men ikke oppdateres av denne rollen.

RLS beskytter ikke mot feil i serverkode som bruker en hemmelig nøkkel med utvidet tilgang. API-et må validere tillatte felter, datastørrelse, hendelsestyper, aktiv tid, relasjoner og antall forespørsler. Ikke tilby generelle loggsøk basert bare på en innsendt bruker-ID.

### Avtale med applikasjonen

- Opprett/registrer `app_users.id` ved første besøk. Hold ID-en i localStorage. Dette identifiserer en nettleserprofil, ikke sikkert en person.
- Opprett en `sessions`-rad ved øktstart. Hold økt-ID i den aktuelle fanen, for eksempel sessionStorage; bruk ny økt etter valgt inaktivitetsgrense.
- Opprett et `problem_attempts` når en oppgave åpnes. Hver innsending får en egen rad i `answer_submissions` med økende `submission_number`.
- Backend setter `is_correct` og `evaluation_status`. Ved `completed` setter en trigger `evaluated_at`. Et korrekt svar markerer automatisk forsøket som `solved` og setter første korrekte tidspunkt. Feil eller ventende evaluering regnes ikke som løst. Ferdig evaluerte innsendinger er uforanderlige.
- Opprett løsningssteg før oppgaven brukes. Send `step_opened`/`step_closed` med `step_id`, `problem_id`, `attempt_id` og `session_id`. Fremmednøkler avviser steg fra feil oppgave eller forsøk fra feil økt.
- Registrer hjelp og fasitvisning på serveren før innholdet leveres til eleven. Visningene klassifiserer hjelp før riktig svar etter serverens mottaks-/fullføringstidspunkt. Forsinkede klientlogger kan ellers gi feil klassifisering; behold klientens `occurred_at` for etterkontroll.
- Lagre elevens chatmelding først. Opprett så en ventende assistantsvar-rad med `in_reply_to_id`, `model`, `prompt_version` og `status = pending`. Oppdater til `completed` med svaret, eller `failed` med en kort `error_code`. En ny AI-generering får en ny meldingsrad; ferdige meldinger overskrives ikke.
- Meldingsrekkefølge bruker `sequence_number` per samtale. Hendelser bruker `sequence_number` per økt. Bruk en stabil `id` ved sending på nytt og `ON CONFLICT DO NOTHING` for deduplisering. Ikke generer ny ID ved hvert nettverksforsøk.
- `received_at` settes av server/databasen; ta bare imot `occurred_at` fra klienten. Serveren må ikke videresende klientstyrte verdier til felt som `is_correct`, `evaluated_at` eller `received_at`.
- Bruk eksempelvis aktivitetspuls hvert 15. sekund. `events.active_ms` angir et ikke-overlappende aktivt intervall og kan være 0–60000. Andre hendelser skal ha 0. Serveren må kontrollere intervallene og at en gjentatt sending ikke dobbelttelles. Varighet er et estimat basert på synlighet, fokus og valgt inaktivitetsgrense.
- Knytt en aktivitetspuls til det ene oppgaveforsøket som faktisk var aktivt. Ikke send samme aktive intervall både som økthendelse og oppgavehendelse; en oppgavehendelse teller allerede med i økten. Send siste tidsintervall før innsending/navigasjon.
- Ved akseptert brukeraktivitet oppdaterer triggere `last_activity_at` og `last_seen_at`. Et AI-svar alene eller en puls med 0 aktiv tid forlenger ikke økten.
- Backend eller en planlagt jobb må avslutte økter etter inaktivitet, for eksempel 30 minutter. Ved slik avslutning: sett `ended_at = last_activity_at` og `end_reason = inactivity`. Ingen bakgrunnsjobb installeres av denne migreringen. Lukk også uferdige oppgaveforsøk som `abandoned` med et passende `finished_at`.

`session_stats.distinct_problems_solved` teller forskjellige logiske oppgaver (`source_id`), mens `solved_attempt_count` også teller gjentatte vellykkede forsøk. `solved_unassisted` betyr ingen registrerte løsningssteg, fasitvisning eller ferdig AI-svar før første korrekte evaluering. Det beviser ikke at eleven løste oppgaven uten hjelp utenfor appen.

Planlegg hvor lenge rå svar og chatinnhold skal beholdes. Sletting av en `app_users`-rad sletter tilhørende økter og aktivitetsdata via fremmednøkler, men beholder oppgavebanken. Statistikkvisningene gjenspeiler slettingen.

## Automatisk utrulling fra GitHub

Arbeidsflyten `.github/workflows/supabase-deploy.yml` er klar. Den er deaktivert til du velger mål og aktiverer den med en GitHub-variabel.

I GitHub-repositoriet: **Settings → Secrets and variables → Actions**.

Opprett følgende **Secrets**:

- `SUPABASE_ACCESS_TOKEN`: personlig Supabase CLI-tilgangstoken. Dette er ikke appens hemmelige API-nøkkel.
- `SUPABASE_DB_PASSWORD`: databasepassordet for det valgte prosjektet.

Opprett følgende **Variables**:

- `SUPABASE_PROJECT_ID`: prosjektets referanse.
- `SUPABASE_DEPLOY_ENABLED`: verdien `true` når du vil aktivere utrullingen.

Commit migreringsfilene og arbeidsflyten. Ved push til `main` som endrer `supabase/migrations/`, `supabase/config.toml` eller selve arbeidsflyten, kobler jobben til prosjektet, viser ventende migreringer og kjører `db push`. Den kan også startes fra **Actions → Deploy Supabase schema → Run workflow** etter aktivering.

Endre `branches: [main]` hvis produksjonsgrenen heter noe annet. Bruk separate prosjekter for test og produksjon når du utvider oppsettet. Denne jobben deployer bare databaseskjemaet, ikke nettsiden eller miljøvariablene til applikasjonen.

## Senere skjemaendringer

```powershell
supabase migration new add_example_field
```

Skriv endringen i den nye SQL-filen. Bruk `ALTER TABLE` og passende migrering av data. Ikke rediger eller slett en migrering som allerede er kjørt eksternt. Forhåndsvis med `supabase db push --dry-run`, og deploy med `supabase db push` eller GitHub-arbeidsflyten.

## Lokal verifisering

På Windows med PostgreSQL 17+ sine `initdb`, `pg_ctl` og `psql` på PATH:

```powershell
./supabase/checks/test-schema.ps1
```

Skriptet oppretter en midlertidig PostgreSQL-instans på en ledig lokal port, bruker et tilfeldig testpassord, oppretter testroller som etterligner Supabase, kjører migreringene og tester datamodellen. Testen kobler ikke til det eksterne prosjektet. Instansen stoppes og testfilene fjernes etter kjøring.

`bootstrap-test-roles.sql` er kun til denne disponible testinstansen. Den skal ikke kjøres mot Supabase, som allerede har egne roller. Den vanlige migreringen ligger alene i `migrations/`.

Testene dekker korrekte og ukorrekte svar, chatforløp, summering uten dobbelttelling, versjonering, relasjoner, deduplisering, sletting og at nettleserroller ikke får tilgang. En vanlig PostgreSQL-test verifiserer SQL og roller, men erstatter ikke en full test av Supabase Data API og applikasjonen i et testprosjekt.

## Forholdet til eksisterende kode

Dette oppsettet oppretter nye tabeller med små bokstaver. Det erstatter ikke de gamle Prisma-tabellene `User`, `Problem`, `Solves` og `Event`, og endrer ikke `prisma/schema.prisma`.

Bruk Supabase-migreringene som kilde til skjemaendringer for disse nye tabellene. Ikke la Prisma Migrate og Supabase CLI administrere de samme tabellene parallelt. Velger du Prisma som spørringsklient senere, må datamodeller og applikasjonskode tilpasses det nye skjemaet.

Migreringen oppretter **strukturen**. Den importerer ikke Excel-oppgavene, kobler ikke prototypen til Supabase og begynner ikke å loggføre før server/API-et tar de nye tabellene i bruk.

Offisiell dokumentasjon: [migreringer](https://supabase.com/docs/guides/local-development/database-migrations), [CLI db push](https://supabase.com/docs/reference/cli/supabase-db-push), [GitHub og miljøer](https://supabase.com/docs/guides/deployment/managing-environments), [tilgangsregler](https://supabase.com/docs/guides/database/postgres/row-level-security).
