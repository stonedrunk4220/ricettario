# Ricettario · Guida all'installazione

Questa guida descrive come pubblicare Ricettario: un'applicazione web installabile (PWA) con database, autenticazione, archiviazione delle foto, assistente AI e notifiche push. L'installazione si svolge interamente dal browser e richiede circa 40 minuti.

Per l'uso dell'app consulta il [Manuale d'uso](MANUALE.md).

## Requisiti

| Servizio | Funzione | Piano |
|---|---|---|
| **Supabase** (supabase.com) | Database, autenticazione, foto, funzione server, pianificazione | Gratuito (500 MB di dati, 1 GB di file) |
| **GitHub** (github.com) | Pubblicazione dell'app (GitHub Pages) | Gratuito |
| **Google AI Studio** (aistudio.google.com) | Assistente AI principale (Gemini) | Gratuito, con limiti di utilizzo |
| **Groq** (console.groq.com) | Assistente AI di riserva | Gratuito, con limiti di utilizzo (facoltativo) |
| **Anthropic** (platform.claude.com) | Assistente AI aggiuntivo | A consumo (facoltativo) |

Contenuto del pacchetto: le cartelle `web`, `supabase`, `tools` e `.github` e i documenti di progetto.

---

## 1. Progetto Supabase

1. Accedi a **supabase.com** e crea un nuovo progetto (*New project*).
2. Imposta:
   - **Name**: `ricettario`;
   - **Database password**: una password robusta, da conservare in un luogo sicuro. All'app non serve, ma è necessaria per le operazioni di manutenzione.
   - **Region**: un'area europea, per esempio *Central EU (Frankfurt)*.
3. Conferma e attendi il completamento (circa due minuti).

## 2. Struttura del database

1. Apri **SQL Editor** → *New query*.
2. Incolla l'intero contenuto di `supabase/schema.sql` e premi **Run**.

Lo script crea tabelle, regole di sicurezza a livello di riga (ogni utente accede solo ai ricettari di cui è membro), lo spazio per le foto e le tabelle per le notifiche. Attiva anche le estensioni `pg_cron` e `pg_net`. Se Supabase segnala che un'estensione non è disponibile, abilitala da **Database → Extensions** e riesegui lo script. Lo script è idempotente: si può rieseguire senza perdere dati.

## 3. Configurazione dell'app

1. **Project Settings → Data API**: copia il **Project URL** (`https://<id>.supabase.co`).
2. **Project Settings → API Keys**: copia la **Publishable key** (`sb_publishable_…`). Se richiesto, crea prima le nuove chiavi con *Create new API keys*.
3. Inserisci i due valori in `web/config.js`:

```js
window.RICETTARIO_CONFIG = {
  supabaseUrl: 'https://<id>.supabase.co',
  supabaseAnonKey: 'sb_publishable_...'
};
```

> Questi valori sono pubblici per natura: la protezione dei dati è affidata alle regole del database. Non inserire mai in questo file la *secret key* o altre chiavi riservate.

## 4. Autenticazione

In **Authentication → Sign In / Providers → Email** mantieni attivo l'accesso con email.

La conferma dell'indirizzo (*Confirm email*) è facoltativa. Il servizio email incluso in Supabase ha limiti orari ridotti: se la conferma è attiva con molti utenti, conviene configurare un server SMTP dedicato in **Authentication → Emails → SMTP Settings**. L'app gestisce entrambe le configurazioni.

## 5. Funzione server e assistente AI

La funzione server gestisce l'assistente AI, che prova in ordine Gemini, poi Groq, poi Anthropic, e le notifiche push.

**Chiavi dei servizi AI**
- **Gemini**: su aistudio.google.com → *Get API key* → *Create API key*. Non serve una carta di credito per il piano gratuito.
- **Groq** (facoltativa): su console.groq.com → *API Keys* → *Create API Key*.
- **Anthropic** (facoltativa): su platform.claude.com → *API Keys*.

> Nel piano gratuito, Google può usare i contenuti inviati per migliorare i propri servizi. Valuta i termini del fornitore in base all'uso previsto.

**Pubblicazione della funzione**
1. **Edge Functions → Deploy a new function → Via Editor**.
2. Nome: **`claude`**. Il nome è richiesto dall'app e non va modificato.
3. Sostituisci il codice di esempio con il contenuto di `supabase/functions/claude/index.ts` → **Deploy**.
4. Nelle impostazioni della funzione disattiva **Enforce JWT verification**: l'autenticazione degli utenti è verificata all'interno della funzione.
5. **Edge Functions → Secrets** → aggiungi i segreti:
   - `GEMINI_API_KEY` (consigliato);
   - `GROQ_API_KEY` (facoltativo);
   - `ANTHROPIC_API_KEY` (facoltativo).

Le chiavi delle notifiche push (VAPID) e la chiave della pianificazione vengono generate automaticamente al primo utilizzo. Sono conservate in una tabella non accessibile dall'app.

**Parametri facoltativi** (impostabili come segreti)

| Segreto | Predefinito | Descrizione |
|---|---|---|
| `AI_PROVIDERS` | `gemini,groq,anthropic` | Ordine dei fornitori |
| `AI_LIMIT_PER_USER` | `60` | Richieste mensili per utente |
| `AI_LIMIT_TOTAL` | `600` | Richieste mensili complessive |
| `GEMINI_MODEL` | `gemini-flash-latest` | Modello Gemini |
| `GROQ_MODEL` / `GROQ_VISION_MODEL` | `llama-3.3-70b-versatile` / `meta-llama/llama-4-scout-17b-16e-instruct` | Modelli Groq per testo e immagini |
| `CLAUDE_MODEL` | `claude-sonnet-5-5` | Modello Anthropic |

## 6. Pubblicazione su GitHub Pages

1. Su github.com crea un repository (*New repository*), per esempio `ricettario`.
2. Carica il contenuto del pacchetto: le cartelle `web`, `supabase`, `tools` e `.github` e i documenti. Sulla pagina del repository usa *uploading an existing file*, oppure Git.
   > La cartella `.github` è nascosta su alcuni sistemi: su macOS premi `Cmd + Shift + .` nel Finder, su Windows scegli *Visualizza → Elementi nascosti*. È necessaria per la pubblicazione automatica.
3. **Settings → Pages → Build and deployment → Source**: seleziona **GitHub Actions**.
4. Nella scheda **Actions** il flusso «Pubblica l'app» si completa in circa un minuto e mostra l'indirizzo pubblico (`https://<utente>.github.io/ricettario/`).

Il codice dell'app è pubblico; i dati degli utenti restano nel database, protetti dalle regole di sicurezza.

## 7. Indirizzi di reindirizzamento

In **Authentication → URL Configuration** imposta:
- **Site URL**: l'indirizzo pubblico dell'app;
- **Redirect URLs**: lo stesso indirizzo.

Sono necessari perché i link di conferma e di recupero della password riportino all'app.

## 8. Verifica

1. Apri l'indirizzo dell'app e registra un account.
2. Crea una ricetta con l'assistente AI («Crea con l'AI») per verificare la funzione server.
3. In ⚙ → **Notifiche** attiva le notifiche e usa **Prova**. Alla prima attivazione la funzione registra da sola il controllo pianificato (ogni minuto) per timer e promemoria.

---

## Aggiornamenti

Ogni nuova versione è distribuita come pacchetto completo. Le note di rilascio indicano quali componenti sono cambiati.

1. **Database**: se il pacchetto contiene un nuovo `supabase/aggiornamento-N.sql`, eseguilo dal SQL Editor. Gli script sono idempotenti.
2. **Funzione server**: Edge Functions → `claude` → **Code** → sostituisci il codice con il nuovo `index.ts` → **Deploy**.
3. **App**: sostituisci su GitHub i file modificati della cartella `web`. Non sostituire `config.js`, che contiene la configurazione della tua installazione.

Gli utenti ricevono la nuova versione alla successiva apertura dell'app.

## Manutenzione

- **Pausa dei progetti gratuiti**: Supabase sospende i progetti gratuiti dopo 7 giorni di inattività. Il flusso «Tieni sveglio il database» (scheda *Actions*) esegue una lettura periodica. GitHub disattiva i flussi pianificati dopo 60 giorni senza modifiche al repository: in quel caso riattivali da *Actions*.
- **Modelli AI ritirati**: se un modello non è più disponibile, la funzione passa al fornitore successivo. Aggiorna `GEMINI_MODEL` o `GROQ_MODEL` con un modello attuale.
- **Catalogo delle ricette base**: le ricette si trovano in `tools/ricette_base_*.txt`. Dopo una modifica rigenera `web/ricette-base.js` con `python3 tools/ricette_base.py`.
- **Database degli ingredienti**: si modifica in `tools/ingredienti.py`, che genera `web/ingredienti.js`.
- **Dominio personalizzato**: *Settings → Pages → Custom domain*. Aggiorna poi gli indirizzi al passo 7.

## Risoluzione dei problemi

| Sintomo | Causa probabile |
|---|---|
| L'assistente AI «non è al momento disponibile» | Manca `GEMINI_API_KEY` (o un'altra chiave), oppure la funzione non si chiama `claude` |
| Registrazione non riuscita | `supabaseUrl` errato in `config.js`: deve contenere solo `https://<id>.supabase.co`, senza percorsi |
| «Promemoria programmati non ancora disponibili» | Estensioni `pg_cron`/`pg_net` non attive, oppure `schema.sql` / `aggiornamento-4.sql` non eseguito |
| Notifiche non ricevute | Permesso negato nel browser, oppure risparmio energetico del dispositivo attivo per il browser |
| L'app mostra una versione precedente | Chiudi e riapri l'app: il primo avvio scarica l'aggiornamento |

## Dati e privacy

- I dati sono conservati nel progetto Supabase dell'installazione. Gli utenti possono esportare ricette e foto da ⚙ → **Backup e ripristino**.
- Il piano alimentare, gli abbinamenti, gli integratori e le preferenze delle notifiche sono personali: non sono visibili agli altri membri dei ricettari condivisi.
- I contenuti inviati all'assistente AI vengono elaborati dai fornitori configurati, secondo i rispettivi termini di servizio.
