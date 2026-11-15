// =====================================================================
//  Il mio ricettario · funzione server dell'assistente AI ("claude")
//  Riceve dall'app i dati (testo, immagini, link, ricetta da modificare),
//  costruisce lei le istruzioni e chiama un servizio AI con le TUE chiavi,
//  che restano segrete sul server. Prova i servizi in ordine e, se uno è
//  al limite o non risponde, passa al successivo.
//
//  Segreti in Supabase → Edge Functions → Secrets (basta almeno uno):
//    GEMINI_API_KEY      Google AI Studio, piano gratuito  (consigliato)
//    GROQ_API_KEY        Groq, piano gratuito              (riserva)
//    ANTHROPIC_API_KEY   Claude, a pagamento               (facoltativo)
//  Facoltativi:
//    AI_PROVIDERS        ordine dei servizi, default "gemini,groq,anthropic"
//    GEMINI_MODEL        default "gemini-flash-latest" (poi prova "gemini-flash-lite-latest")
//    GROQ_MODEL          default "llama-3.3-70b-versatile"
//    GROQ_VISION_MODEL   default "meta-llama/llama-4-scout-17b-16e-instruct" (per foto e screenshot)
//    CLAUDE_MODEL        default "claude-sonnet-5-5"
//    AI_LIMIT_PER_USER   richieste al mese per persona, default 60
//    AI_LIMIT_TOTAL      richieste al mese in totale, default 600
//  SUPABASE_URL e la chiave segreta del progetto sono già presenti di serie.
//  Nelle impostazioni della funzione disattiva "Verify JWT": il controllo
//  dell'utente lo fa questa funzione.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2.50.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const CATEGORIES = ["Antipasti","Primi","Secondi","Contorni","Piatti unici","Pizze e lievitati","Pane","Dolci","Colazione","Salse e condimenti","Conserve","Bevande"];
const SCHEMA_TXT = `{"title": string, "category": una tra ${JSON.stringify(CATEGORIES)}, "tags": string[] (max 5, minuscolo), "servings": number|null, "servingsUnit": string (es. "porzioni", "pezzi", "persone"), "prepMin": number|null, "cookMin": number|null, "restMin": number|null (riposo/lievitazione/frigo), "difficulty": "facile"|"media"|"difficile", "ingredients": string[], "steps": string[], "notes": string, "source": string, "doubts": string[]`;
const RULES_TXT = `Regole per "ingredients": una riga per ingrediente nel formato "quantità unità nome, nota", es. "200 g farina 00", "2 uova", "1 cucchiaio di olio extravergine", "sale q.b.", "3 spicchi d'aglio, schiacciati". Per suddividere in gruppi usa una riga che termina con ":" (es. "Per la crema:").
Regole per "steps": un passaggio per elemento, frasi chiare all'imperativo; scrivi i tempi in cifre nel testo (es. "cuoci per 20 minuti") così l'app crea i timer.
"doubts": elenco breve (max 4) dei punti in cui non eri sicuro o hai dovuto interpretare (es. "Ho inteso 200 g di zucchero: controlla"), lista vuota se tutto è chiaro.
"notes": consigli utili, conservazione, varianti presenti nell'input (stringa vuota se nulla).`;
const VOICE_TXT = `ATTENZIONE: il testo può essere la trascrizione di una DETTATURA vocale: numeri scritti a parole («duecento grammi» = 200 g), parole di riempimento, ripetizioni, errori di trascrizione e autocorrezioni («anzi no, trecento»): considera sempre l'ultima versione detta.`;

type Img = { media_type: string; data: string };

function draftPrompt(kind: string, text: string, url?: string, ld?: unknown) {
  const intro =
    kind === "dictate"
      ? `${VOICE_TXT}\nRicostruisci la ricetta che l'utente intendeva, senza inventare ingredienti o passaggi che non ha detto; se mancano dati (es. tempi o porzioni) lasciali null.`
      : kind === "link"
      ? `L'input viene da una pagina web di ricette (dati strutturati della pagina, se presenti, e testo della pagina) e/o da suoi screenshot. Ignora pubblicità, menu, commenti, storie personali e ricette correlate: estrai solo la ricetta principale, rispettando fedelmente dosi e passaggi e traducendo in italiano se serve. ${url ? `Metti in "source" questo link: ${url}` : `In "source" metti il nome del sito se si capisce.`}`
      : `Input: una ricetta incollata, una descrizione o idea, il testo estratto da un file (PDF, Word…) e/o la foto di una ricetta (anche scritta a mano). Se è solo un'idea, proponi una ricetta completa, realistica e collaudata. Se è una ricetta esistente, rispetta fedelmente dosi e passaggi, correggendo solo errori evidenti. Se un file contiene più ricette, prendi la prima o quella indicata dall'utente e segnalalo in "doubts".`;
  return `Sei un assistente che trasforma ricette in dati strutturati per un ricettario personale in italiano. Usa il sistema metrico.
${intro}
Rispondi SOLO con un oggetto JSON con questi campi:
${SCHEMA_TXT}}
${RULES_TXT}

Input:
${url ? `Link: ${url}\n` : ""}${ld ? `Dati strutturati della pagina (schema.org Recipe):\n${JSON.stringify(ld).slice(0, 20000)}\n\n` : ""}${text || "(vedi immagini)"}`;
}

function editPrompt(form: unknown, instruction: string) {
  return `Sei l'assistente di un ricettario personale in italiano. Ecco la ricetta attuale in JSON:
${JSON.stringify(form).slice(0, 40000)}

L'utente chiede queste modifiche:
«${instruction.slice(0, 8000)}»

${VOICE_TXT}
Applica SOLO le modifiche richieste e lascia tutto il resto identico, parola per parola. Se cambia le porzioni ("fallo per 6") ricalcola le quantità e aggiorna "servings". Se sostituisce o toglie un ingrediente, aggiorna anche i passaggi che lo nominano. Non inventare altro.
Rispondi SOLO con un oggetto JSON con questi campi:
${SCHEMA_TXT}, "changes": string[] (elenco breve e concreto delle modifiche fatte, es. "Spaghetti: da 320 g a 400 g")}
${RULES_TXT}`;
}

function parseJson(text: string) {
  try { return JSON.parse(text); } catch { /* continua */ }
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch { /* continua */ } }
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(text.slice(a, b + 1));
  throw new Error("invalid_json");
}

// ---------- lettura di una pagina web ----------
const PRIVATE_HOST = /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:|metadata\.)/i;
function decodeEntities(s: string) {
  return s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function findRecipe(j: any): any {
  if (!j || typeof j !== "object") return null;
  if (Array.isArray(j)) { for (const x of j) { const r = findRecipe(x); if (r) return r; } return null; }
  const t = j["@type"]; const types = Array.isArray(t) ? t : [t];
  if (types.some((x: unknown) => String(x).toLowerCase() === "recipe")) return j;
  if (j["@graph"]) return findRecipe(j["@graph"]);
  if (j.mainEntity) return findRecipe(j.mainEntity);
  return null;
}
function pickImage(img: any): string | null {
  if (!img) return null;
  if (typeof img === "string") return img;
  if (Array.isArray(img)) return pickImage(img[img.length > 1 ? 1 : 0]) ?? pickImage(img[0]);
  return img.url ?? img.contentUrl ?? null;
}
async function safeFetch(u: string, accept: string, maxBytes: number) {
  let url = new URL(u);
  for (let hop = 0; hop < 5; hop++) {
    if (!/^https?:$/.test(url.protocol) || PRIVATE_HOST.test(url.hostname)) throw new Error("bad_url");
    const res = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RicettarioBot/1.0)", Accept: accept, "Accept-Language": "it-IT,it;q=0.9,en;q=0.6" },
      signal: AbortSignal.timeout(12000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { url = new URL(res.headers.get("location")!, url); continue; }
    if (!res.ok) throw new Error("fetch_" + res.status);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new Error("too_big");
    return { buf, type: res.headers.get("content-type") ?? "", finalUrl: url.toString() };
  }
  throw new Error("too_many_redirects");
}
async function readPage(u: string) {
  const { buf, finalUrl } = await safeFetch(u, "text/html,application/xhtml+xml,*/*;q=0.8", 4_000_000);
  const html = new TextDecoder().decode(buf);
  let ld: any = null;
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { ld = findRecipe(JSON.parse(m[1].trim())); if (ld) break; } catch { /* blocco non valido */ }
  }
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1]
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i)?.[1];
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
  const text = decodeEntities(
    html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<(nav|footer|aside|form|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  ).replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim().slice(0, 45000);
  const imgUrl = pickImage(ld?.image) ?? og ?? null;
  return { ld, text: (title ? title + "\n\n" : "") + text, imgUrl: imgUrl ? new URL(imgUrl, finalUrl).toString() : null, finalUrl };
}
async function fetchImage(u: string): Promise<Img | null> {
  try {
    const { buf, type } = await safeFetch(u, "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5", 4_500_000);
    const mt = type.split(";")[0].trim();
    if (!["image/jpeg", "image/png", "image/webp"].includes(mt)) return null;
    let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { media_type: mt, data: btoa(bin) };
  } catch { return null; }
}

// ---------- chiamata ai servizi AI ----------
class ProviderError extends Error {
  constructor(public kind: "rate_limited" | "unavailable" | "bad", message: string) { super(message); }
}
const env = (k: string) => (Deno.env.get(k) ?? "").trim();
async function postJson(url: string, headers: Record<string, string>, body: unknown) {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
  } catch (e) { throw new ProviderError("unavailable", "network: " + String(e)); }
  const text = await res.text();
  let j: any = null; try { j = JSON.parse(text); } catch { /* risposta non json */ }
  if (!res.ok) {
    const msg = `${res.status}: ${(j?.error?.message ?? text).toString().slice(0, 200)}`;
    if (res.status === 429 || res.status === 529) throw new ProviderError("rate_limited", msg);
    if (res.status >= 500 || res.status === 404 || res.status === 403) throw new ProviderError("unavailable", msg);
    throw new ProviderError("bad", msg);
  }
  return j;
}

async function viaGemini(prompt: string, images: Img[]) {
  const key = env("GEMINI_API_KEY");
  const models = [env("GEMINI_MODEL") || "gemini-flash-latest", "gemini-flash-lite-latest"].filter((m, i, a) => a.indexOf(m) === i);
  let last: unknown = null;
  for (const model of models) {
    try {
      const j = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { "x-goog-api-key": key }, {
        contents: [{ role: "user", parts: [...images.map((im) => ({ inline_data: { mime_type: im.media_type, data: im.data } })), { text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.3, maxOutputTokens: 8192 },
      });
      const cand = j?.candidates?.[0];
      const text = (cand?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
      if (!text) throw new ProviderError("unavailable", "gemini: risposta vuota (" + (cand?.finishReason ?? j?.promptFeedback?.blockReason ?? "?") + ")");
      return { text, usage: { input_tokens: j?.usageMetadata?.promptTokenCount, output_tokens: j?.usageMetadata?.candidatesTokenCount }, model };
    } catch (e) { last = e; if (!(e instanceof ProviderError) || e.kind === "bad") throw e; }
  }
  throw last;
}

async function viaGroq(prompt: string, images: Img[]) {
  const key = env("GROQ_API_KEY");
  const model = images.length ? (env("GROQ_VISION_MODEL") || "meta-llama/llama-4-scout-17b-16e-instruct") : (env("GROQ_MODEL") || "llama-3.3-70b-versatile");
  const content = images.length
    ? [...images.slice(0, 5).map((im) => ({ type: "image_url", image_url: { url: `data:${im.media_type};base64,${im.data}` } })), { type: "text", text: prompt }]
    : prompt;
  const j = await postJson("https://api.groq.com/openai/v1/chat/completions", { authorization: `Bearer ${key}` }, {
    model, temperature: 0.3, max_tokens: 6000, response_format: { type: "json_object" },
    messages: [{ role: "user", content }],
  });
  const text = j?.choices?.[0]?.message?.content ?? "";
  if (!text) throw new ProviderError("unavailable", "groq: risposta vuota");
  return { text, usage: { input_tokens: j?.usage?.prompt_tokens, output_tokens: j?.usage?.completion_tokens }, model };
}

async function viaAnthropic(prompt: string, images: Img[]) {
  const model = env("CLAUDE_MODEL") || "claude-sonnet-5-5";
  const content: unknown[] = images.slice(0, 5).map((im) => ({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } }));
  content.push({ type: "text", text: prompt });
  const j = await postJson("https://api.anthropic.com/v1/messages", { "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01" }, {
    model, max_tokens: 4096, messages: [{ role: "user", content }],
  });
  const text = (j?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
  return { text, usage: { input_tokens: j?.usage?.input_tokens, output_tokens: j?.usage?.output_tokens }, model };
}

const PROVIDERS: Record<string, { key: string; run: (p: string, i: Img[]) => Promise<{ text: string; usage: any; model: string }> }> = {
  gemini: { key: "GEMINI_API_KEY", run: viaGemini },
  groq: { key: "GROQ_API_KEY", run: viaGroq },
  anthropic: { key: "ANTHROPIC_API_KEY", run: viaAnthropic },
};

async function askAI(prompt: string, images: Img[]) {
  const order = (env("AI_PROVIDERS") || "gemini,groq,anthropic").split(",").map((x) => x.trim().toLowerCase()).filter((x) => PROVIDERS[x] && env(PROVIDERS[x].key));
  if (!order.length) throw new Error("missing_api_key");
  const errors: string[] = []; let allLimited = true;
  for (const name of order) {
    try {
      const r = await PROVIDERS[name].run(prompt, images);
      let data;
      try { data = parseJson(r.text); } catch { errors.push(name + ": json non valido"); allLimited = false; continue; }
      return { data, usage: r.usage, provider: name, model: r.model };
    } catch (e) {
      const kind = e instanceof ProviderError ? e.kind : "unavailable";
      if (kind !== "rate_limited") allLimited = false;
      errors.push(name + ": " + String((e as Error).message).slice(0, 160));
      console.warn("AI", name, kind, (e as Error).message);
    }
  }
  throw new Error((allLimited ? "all_rate_limited" : "all_failed") + " | " + errors.join(" ; "));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  try {
    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    let service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    try { const sk = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); if (sk.default) service = sk.default; } catch { /* solo chiavi legacy */ }
    const admin = createClient(supaUrl, service, { auth: { persistSession: false } });
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "not_signed_in" }, 401);

    // limiti mensili
    const month = new Date(); month.setUTCDate(1); month.setUTCHours(0, 0, 0, 0);
    const perUser = Number(Deno.env.get("AI_LIMIT_PER_USER") ?? 60), total = Number(Deno.env.get("AI_LIMIT_TOTAL") ?? 600);
    const { count: mine } = await admin.from("ai_usage").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", month.toISOString());
    if ((mine ?? 0) >= perUser) return json({ error: "limit_user", limit: perUser }, 429);
    const { count: all } = await admin.from("ai_usage").select("id", { count: "exact", head: true }).gte("created_at", month.toISOString());
    if ((all ?? 0) >= total) return json({ error: "limit_total" }, 429);

    const body = await req.json();
    const action = String(body.action ?? "draft");
    const images: Img[] = Array.isArray(body.images)
      ? body.images.filter((i: any) => i && typeof i.data === "string" && /^image\/(jpeg|png|webp|gif)$/.test(i.media_type) && i.data.length < 7_000_000).slice(0, 5)
      : [];
    const text = String(body.text ?? "").slice(0, 120000);
    let prompt = "", image: Img | null = null, pageUrl: string | undefined;

    if (action === "edit") {
      if (!body.form || !body.instruction) return json({ error: "bad_request" }, 400);
      prompt = editPrompt(body.form, String(body.instruction));
    } else if (action === "link") {
      pageUrl = String(body.url ?? "").trim();
      if (!/^https?:\/\//i.test(pageUrl)) return json({ error: "bad_url" }, 400);
      let page: Awaited<ReturnType<typeof readPage>> | null = null;
      try { page = await readPage(pageUrl); } catch (e) {
        if (!text && !images.length) return json({ error: "page_unreachable", detail: String((e as Error).message) }, 422);
      }
      prompt = draftPrompt("link", [text, page?.text].filter(Boolean).join("\n\n--- Testo della pagina ---\n"), page?.finalUrl ?? pageUrl, page?.ld);
      if (page?.imgUrl && body.wantImage !== false) image = await fetchImage(page.imgUrl);
    } else {
      const kind = ["dictate", "create"].includes(body.kind) ? body.kind : "create";
      if (!text && !images.length) return json({ error: "bad_request" }, 400);
      prompt = draftPrompt(kind, text);
    }

    const { data, usage, provider, model } = await askAI(prompt, images);
    await admin.from("ai_usage").insert({ user_id: user.id, kind: `${action}:${provider}`, input_tokens: usage.input_tokens ?? null, output_tokens: usage.output_tokens ?? null });
    return json({ result: data, image, provider, model, used: (mine ?? 0) + 1, limit: perUser });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error(msg);
    if (msg === "missing_api_key") return json({ error: "missing_api_key" }, 500);
    if (msg.startsWith("all_rate_limited")) return json({ error: "rate_limited", detail: msg.slice(0, 400) }, 429);
    if (msg.startsWith("all_failed")) return json({ error: "ai_failed", detail: msg.slice(0, 400) }, 502);
    return json({ error: "server", detail: msg.slice(0, 300) }, 500);
  }
});
