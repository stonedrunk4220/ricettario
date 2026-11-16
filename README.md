# Ricettario

Applicazione web installabile (PWA) per gestire ricette, menù settimanale, lista della spesa e piano alimentare, anche con ricettari condivisi.

**Funzionalità principali**
- Ricette con varianti collegate, modalità cucina e timer integrati.
- Catalogo di 120 ricette base.
- Assistente AI: creazione da testo, voce, foto, file e link; modifiche guidate. Usa Gemini, con Groq e Anthropic come alternative.
- Menù della settimana e lista della spesa per reparto.
- «Cosa cucino?»: ricerca delle ricette in base agli ingredienti disponibili, e modalità Flash per comporre pasti equilibrati con avanzi e ingredienti da consumare.
- Piano alimentare a scambi con importazione da PDF o foto, abbinamenti, frequenze settimanali e integratori.
- Notifiche push: timer, elaborazioni completate, menù del giorno dopo, frequenze, integratori.

**Documentazione**
- [Guida all'installazione](GUIDA.md)
- [Manuale d'uso](MANUALE.md)

## Struttura

```
web/                       l'app (file statici, nessuna compilazione)
  index.html               interfaccia e logica
  store.js                 collegamento a Supabase (dati, foto, tempo reale, assistente AI)
  ricette-base.js          catalogo di 120 ricette base (sola lettura)
  ingredienti.js           database degli ingredienti (sinonimi, plurali, reparti, famiglie per i sostituti)
  config.js                indirizzo e chiave pubblica del tuo progetto Supabase
  sw.js, manifest.webmanifest, icons/   installazione sul telefono e uso offline
  lib/                     pdf.js per leggere i PDF allegati
supabase/
  schema.sql               tabelle, regole di sicurezza, foto, tempo reale
  aggiornamento-N.sql      modifiche al database per chi ha già installato (4 = notifiche)
  functions/claude/index.ts  funzione server: assistente AI (Gemini → Groq → Claude) e notifiche push
tools/
  ingredienti.py           genera web/ingredienti.js: modifica qui per aggiungere ingredienti
  ricette_base.py          genera web/ricette-base.js dai file ricette_base_*.txt
.github/workflows/
  pubblica.yml             pubblica web/ su GitHub Pages
  tieni-sveglio.yml        evita la pausa del progetto Supabase gratuito
```

## Note tecniche

- Dati: Postgres con Row Level Security; ogni ricettario ha membri (proprietario, editor) e inviti a scadenza.
- Menù e spesa sono salvati riga per riga, così più persone possono modificarli insieme.
- Le chiavi AI restano sul server; la funzione costruisce le istruzioni, prova i servizi in ordine (passando al successivo se uno è al limite), applica limiti mensili per persona e in totale, legge le pagine web (dati schema.org Recipe compresi) e ne scarica la foto.
- Dettatura: Web Speech API del browser (Chrome, Edge, Safari).
