# Il mio ricettario

App web installabile (PWA) per ricette, menù della settimana e lista della spesa, con ricettari condivisi in famiglia e assistente AI (bozze da testo, voce, file e link; modifica a voce) su Gemini gratuito, con Groq e Claude come alternative.

**Per pubblicarla segui [GUIDA.md](GUIDA.md).**

## Struttura

```
web/                       l'app (file statici, nessuna compilazione)
  index.html               interfaccia e logica
  store.js                 collegamento a Supabase (dati, foto, tempo reale, Claude)
  config.js                indirizzo e chiave pubblica del tuo progetto Supabase
  sw.js, manifest.webmanifest, icons/   installazione sul telefono e uso offline
  lib/                     pdf.js per leggere i PDF allegati
supabase/
  schema.sql               tabelle, regole di sicurezza, foto, tempo reale
  functions/claude/index.ts  funzione server dell'assistente AI (Gemini → Groq → Claude)
.github/workflows/
  pubblica.yml             pubblica web/ su GitHub Pages
  tieni-sveglio.yml        evita la pausa del progetto Supabase gratuito
```

## Note tecniche

- Dati: Postgres con Row Level Security; ogni ricettario ha membri (proprietario, editor) e inviti a scadenza.
- Menù e spesa sono salvati riga per riga, così più persone possono modificarli insieme.
- Le chiavi AI restano sul server; la funzione costruisce le istruzioni, prova i servizi in ordine (passando al successivo se uno è al limite), applica limiti mensili per persona e in totale, legge le pagine web (dati schema.org Recipe compresi) e ne scarica la foto.
- Dettatura: Web Speech API del browser (Chrome, Edge, Safari).
