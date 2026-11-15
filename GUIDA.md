# Pubblicare «Il mio ricettario»

Questa guida ti porta da zero all'app online, installabile sul telefono, con i dati su un database tuo e gratuito. Servono circa **40 minuti** la prima volta, senza installare niente sul computer: si fa tutto dal browser.

## Cosa ti serve

| Servizio | A cosa serve | Costo |
|---|---|---|
| **Supabase** (supabase.com) | Database, accessi, foto, funzione per l'assistente AI | Gratis (500 MB di dati, 1 GB di foto) |
| **GitHub** (github.com) | Pubblica l'app su un indirizzo tuo | Gratis |
| **Google AI Studio** (aistudio.google.com) | Assistente AI (Gemini) | Gratis, con limiti di richieste |
| **Groq** (console.groq.com) | Assistente AI di riserva | Gratis, con limiti di richieste (facoltativo) |

> Facoltativo: una chiave **Claude** (platform.claude.com), a pagamento a consumo, se un giorno vorrai la qualità migliore. Il tuo abbonamento Claude non vale per le app esterne.

Tieni a portata di mano la cartella `ricettario-app` (lo zip che ti ho mandato, estratto).

---

## 1. Crea il progetto Supabase

1. Vai su **supabase.com** → *Start your project* → accedi (anche con GitHub).
2. *New project*:
   - **Name**: `ricettario`
   - **Database password**: generane una e salvala in un posto sicuro (non serve all'app, ma ti servirà se un giorno vorrai spostare i dati).
   - **Region**: *Central EU (Frankfurt)* o un'altra in Europa.
3. *Create new project* e aspetta un paio di minuti.

## 2. Crea le tabelle

1. Nel menu a sinistra apri **SQL Editor** → *New query*.
2. Apri il file `supabase/schema.sql`, copia **tutto** il contenuto e incollalo.
3. Premi **Run**. Deve comparire *Success*.

Questo crea ricettari, ricette, menù, spesa, inviti, lo spazio per le foto e le regole di sicurezza: ognuno vede solo i ricettari di cui fa parte. Puoi rieseguirlo senza problemi.

## 3. Collega l'app al database

1. **Project Settings** (l'ingranaggio in basso a sinistra) → **Data API**: copia il **Project URL** (tipo `https://abcdefgh.supabase.co`).
2. **Project Settings → API Keys**: copia la **Publishable key** (inizia con `sb_publishable_`). Se vedi il pulsante *Create new API keys*, premilo prima.
3. Apri `web/config.js` con un editor di testo qualsiasi e sostituisci i due segnaposto:

```js
window.RICETTARIO_CONFIG = {
  supabaseUrl: 'https://abcdefgh.supabase.co',
  supabaseAnonKey: 'sb_publishable_...'
};
```

> Questi due valori sono pubblici per natura: chiunque usi l'app li riceve. La protezione dei dati sta nelle regole del database (passo 2). **Non** mettere mai qui la *secret key*.

## 4. Imposta gli accessi

**Authentication → Sign In / Providers → Email**:
- Lascia attivo *Email*.
- Ti consiglio di **disattivare *Confirm email***: il servizio email gratuito di Supabase manda poche mail all'ora, e così chi si registra entra subito. Se preferisci la conferma via mail, lasciala attiva: l'app gestisce entrambi i casi.

L'indirizzo dell'app lo inserirai al passo 7, quando lo avrai.

## 5. Attiva l'assistente AI (gratis)

L'assistente usa **Gemini** di Google, gratuito. Se Gemini è al limite passa da solo a **Groq**, anche lui gratuito, e poi a Claude, se hai messo la sua chiave. Basta una chiave; con due sei più tranquillo.

**La chiave Gemini (consigliata)**
1. Vai su **aistudio.google.com** e accedi con il tuo account Google.
2. **Get API key → Create API key** (se te lo chiede, crea un progetto nuovo). Copia la chiave.
3. Non serve carta di credito: senza fatturazione resti sul piano gratuito.

> Nel piano gratuito Google può usare i testi inviati per migliorare i suoi modelli. Per delle ricette di solito non è un problema.

**La chiave Groq (riserva, facoltativa)**
1. Vai su **console.groq.com** → accedi → **API Keys → Create API Key**. Copia la chiave.

**La funzione sul server**
1. In Supabase: **Edge Functions → Deploy a new function → Via Editor**.
2. Nome della funzione: **`claude`** (esattamente così, anche se usa Gemini).
3. Cancella il codice di esempio, incolla tutto il contenuto di `supabase/functions/claude/index.ts` e premi **Deploy**.
4. Apri la funzione → **Details** (o *Settings*) e **disattiva *Verify JWT*** (*Enforce JWT verification*), poi salva. Il controllo dell'utente lo fa già la funzione.
5. **Edge Functions → Secrets** → *Add new secret*, uno per chiave:
   - `GEMINI_API_KEY` = la chiave di Google AI Studio
   - `GROQ_API_KEY` = la chiave di Groq (se l'hai creata)
   - `ANTHROPIC_API_KEY` = la chiave Claude (solo se la vuoi usare)

Facoltativi, se vuoi cambiare i valori predefiniti:

| Segreto | Predefinito | Significato |
|---|---|---|
| `AI_PROVIDERS` | `gemini,groq,anthropic` | Ordine in cui provare i servizi (es. `anthropic,gemini` per usare prima Claude) |
| `AI_LIMIT_PER_USER` | `60` | Richieste al mese per persona |
| `AI_LIMIT_TOTAL` | `600` | Richieste al mese in totale |
| `GEMINI_MODEL` | `gemini-flash-latest` | Modello Gemini |
| `GROQ_MODEL` / `GROQ_VISION_MODEL` | `llama-3.3-70b-versatile` / `meta-llama/llama-4-scout-17b-16e-instruct` | Modelli Groq per testo e per foto |
| `CLAUDE_MODEL` | `claude-sonnet-5-5` | Modello Claude |

I limiti gratuiti di Google e Groq cambiano nel tempo. Se un giorno l'app risponde «i servizi AI gratuiti hanno raggiunto il loro limite», riprova più tardi oppure aggiungi la chiave di riserva.

## 6. Pubblica l'app su GitHub

1. Su **github.com** → *New repository*: nome `ricettario`, **Public**, *Create repository*.
2. Nella pagina del repository vuoto clicca *uploading an existing file*.
3. Trascina nella pagina **il contenuto** della cartella `ricettario-app`: le cartelle `web`, `supabase` e `.github` e i file `GUIDA.md` e `README.md`.
   - La cartella `.github` è nascosta su Mac e su alcuni Windows. Su Mac premi `Cmd + Shift + .` nel Finder per vederla. Su Windows: *Visualizza → Elementi nascosti*. Senza quella cartella l'app non viene pubblicata.
4. *Commit changes*.
5. **Settings → Pages** → in *Build and deployment*, alla voce *Source* scegli **GitHub Actions**.
6. Apri la scheda **Actions**: vedrai «Pubblica l'app» in corso. Dopo circa un minuto diventa verde e trovi l'indirizzo, tipo `https://tuonome.github.io/ricettario/`.

> Il codice dell'app è pubblico, ma le ricette no: stanno nel database, protette dalle regole.

## 7. Collega l'indirizzo dell'app a Supabase

**Authentication → URL Configuration**:
- **Site URL**: l'indirizzo dell'app (es. `https://tuonome.github.io/ricettario/`).
- **Redirect URLs** → *Add URL*: lo stesso indirizzo.

Serve perché le mail di conferma e di recupero password riportino all'app.

## 8. Primo accesso e ricette dal vecchio ricettario

1. Apri l'indirizzo dell'app → **Registrati**.
2. Nel vecchio ricettario su Claude: ⋮ → **Scarica backup completo, con foto**.
3. Nell'app nuova: ⚙ (in alto a destra) → **Backup e ripristino** → **Ripristina o importa un backup** → scegli il file. Ricette e foto vengono copiate.

## 9. Installa sul telefono

- **Android (Chrome)**: apri l'indirizzo → menu ⋮ → **Installa app** (o *Aggiungi a schermata Home*).
- **iPhone (Safari)**: apri l'indirizzo → **Condividi** → **Aggiungi alla schermata Home**.

L'app si apre a tutto schermo con la sua icona. Fuori dall'app Claude, la **dettatura funziona con il pulsante microfono** (Chrome e Safari), e **«Da link»** apre davvero le pagine delle ricette.

## 10. Condividi con la famiglia

- ⚙ → **Nuovo ricettario** (es. «Famiglia») → **Invita qualcuno** → manda il link.
- Chi lo apre si registra (o accede) e conferma: da quel momento vede e modifica ricette, menù e spesa di quel ricettario, in tempo reale.
- Ognuno ha comunque anche il suo ricettario personale. Si passa dall'uno all'altro toccando il nome in alto.
- Chiunque abbia l'indirizzo può registrarsi e avere un ricettario suo. Le richieste all'assistente AI sono limitate per persona (passo 5), così nessuno esaurisce la quota gratuita.

---

## Domande frequenti

**Il database va in pausa?** I progetti gratuiti si fermano dopo 7 giorni senza uso. Il controllo «Tieni sveglio il database» (in *Actions*) fa una piccola lettura ogni 3 giorni. GitHub sospende i controlli automatici dopo 60 giorni senza modifiche al repository: in quel caso riattivalo da *Actions*. Se il progetto va comunque in pausa, riattivalo dalla dashboard di Supabase: i dati restano.

**L'assistente risponde «non è ancora configurato»?** Manca il segreto `GEMINI_API_KEY` (o `GROQ_API_KEY`), oppure la funzione non si chiama esattamente `claude` (passo 5).

**Un modello non esiste più?** Google e Groq ogni tanto ritirano dei modelli. La funzione passa da sola al servizio successivo; per sistemare, imposta `GEMINI_MODEL` o `GROQ_MODEL` con un modello attuale, che trovi nelle loro console.

**«Non riesco ad aprire quella pagina» con un link?** Alcuni siti bloccano gli accessi automatici. Incolla il testo della ricetta o allega uno screenshot nello stesso riquadro.

**Ho cambiato qualcosa ma l'app non si aggiorna?** Chiudi e riapri l'app: la prima apertura scarica la versione nuova.

**Come modifico l'app?** Cambia i file su GitHub (anche dal sito, con la matita): ogni modifica al ramo `main` ripubblica l'app in un minuto.

**Voglio un indirizzo mio (es. ricettario.it)?** Si può collegare un dominio in *Settings → Pages → Custom domain*.

**Posso spostare i dati altrove?** Sì: dall'app scarichi il backup completo in un file aperto (JSON), e il database Supabase è un normale Postgres esportabile.
