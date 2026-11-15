// =====================================================================
//  Il mio ricettario · collegamento a Supabase
//  Espone un'interfaccia semplice (documenti e "istantanee") sopra le
//  tabelle del database, con sincronizzazione in tempo reale e una
//  copia locale per aprire l'app anche con poca rete.
// =====================================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.50.0/+esm';

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
export const isUuid = s => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const MEALS = ['pranzo', 'cena', 'colazione'];
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* spazio pieno */ } };
const isoDay = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); const x = new Date(y, m - 1, d); x.setDate(x.getDate() + n); return isoDay(x); };
const dayIndex = (monday, day) => { const [y1, m1, d1] = monday.split('-').map(Number), [y2, m2, d2] = day.split('-').map(Number); return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000); };

export function makeStore(cfg) {
  const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  let book = null, userId = null, channel = null;
  const listeners = new Set();          // {kind, week?, next, error}
  const base = { shop: new Map(), plan: new Map(), recipes: new Map() }; // ultima versione nota del server
  const timers = {};

  // ---------- istantanee ----------
  const docSnap = (data, fromCache) => ({ exists: data != null, data: () => data == null ? undefined : JSON.parse(JSON.stringify(data)), metadata: { fromCache: !!fromCache, hasPendingWrites: false } });
  const colSnap = (rows, fromCache) => { const docs = rows.map(r => ({ id: r.id, exists: true, data: () => JSON.parse(JSON.stringify(r.data)), metadata: { fromCache: !!fromCache } })); return { docs, size: docs.length, empty: !docs.length, metadata: { fromCache: !!fromCache, hasPendingWrites: false } }; };

  const shopRowToItem = r => ({ id: r.id, name: r.name, qty: r.qty == null ? null : Number(r.qty), unit: r.unit || '', note: r.note || '', aisle: r.aisle || 'Altro', from: r.sources || [], checked: !!r.checked });
  const shopItemToRow = it => ({ id: isUuid(it.id) ? it.id : uuid(), book_id: book, name: String(it.name || '').slice(0, 200), qty: it.qty == null || isNaN(Number(it.qty)) ? null : Number(it.qty), unit: it.unit || '', note: it.note || '', aisle: it.aisle || 'Altro', sources: Array.isArray(it.from) ? it.from.map(String).slice(0, 20) : [], checked: !!it.checked });
  const planRowsToSlots = (monday, rows) => {
    const slots = {};
    rows.slice().sort((a, b) => a.position - b.position).forEach(r => {
      const di = dayIndex(monday, r.day); if (di < 0 || di > 6) return;
      const k = di + '-' + r.meal; (slots[k] = slots[k] || []).push(r.recipe_id ? { id: r.id, rid: r.recipe_id, servings: r.servings == null ? null : Number(r.servings), text: r.text || '' } : { id: r.id, text: r.text || '' });
    });
    return slots;
  };
  const slotsToRows = (monday, slots) => {
    const rows = [];
    Object.entries(slots || {}).forEach(([k, arr]) => {
      const [di, meal] = k.split('-'); if (!MEALS.includes(meal)) return;
      (arr || []).forEach((e, i) => {
        if (!isUuid(e.id)) e.id = uuid();
        rows.push({ id: e.id, book_id: book, day: addDays(monday, Number(di)), meal, recipe_id: isUuid(e.rid) ? e.rid : null, servings: e.servings == null ? null : Number(e.servings), text: e.rid ? (e.text || null) : String(e.text || ''), position: i });
      });
    });
    return rows;
  };

  // ---------- letture ----------
  async function fetchRecipes() {
    const { data, error } = await sb.from('recipes').select('id,data,updated_at').eq('book_id', book).order('created_at');
    if (error) throw error;
    base.recipes = new Map(data.map(r => [r.id, r.data]));
    lsSet('cache.recipes.' + book, data.map(r => ({ id: r.id, data: r.data })));
    return data;
  }
  async function fetchShop() {
    const { data, error } = await sb.from('shopping_items').select('*').eq('book_id', book).order('created_at');
    if (error) throw error;
    const items = data.map(shopRowToItem);
    base.shop = new Map(data.map(r => { const row = shopItemToRow(shopRowToItem(r)); return [r.id, JSON.stringify(row)]; }));
    lsSet('cache.shop.' + book, items);
    return items;
  }
  async function fetchPlan(monday) {
    const { data, error } = await sb.from('plan_entries').select('*').eq('book_id', book).gte('day', monday).lte('day', addDays(monday, 6)).order('position');
    if (error) throw error;
    const slots = planRowsToSlots(monday, data);
    base.plan.set(monday, new Map(slotsToRows(monday, JSON.parse(JSON.stringify(slots))).map(r => [r.id, JSON.stringify(r)])));
    return slots;
  }

  async function emit(l, useCache) {
    if (!book) return;
    try {
      if (l.kind === 'recipes') {
        if (useCache) { const c = lsGet('cache.recipes.' + book); if (c) l.next(colSnap(c, true)); }
        l.next(colSnap(await fetchRecipes(), false));
      } else if (l.kind === 'shop') {
        if (useCache) { const c = lsGet('cache.shop.' + book); if (c) l.next(docSnap({ items: c }, true)); }
        l.next(docSnap({ items: await fetchShop() }, false));
      } else if (l.kind === 'plan') {
        l.next(docSnap({ slots: await fetchPlan(l.week), weekStart: l.week }, false));
      }
    } catch (e) { console.warn('sync', e); }
  }
  // aggiornamento immediato dopo una propria modifica (il server conferma subito dopo)
  function emitLocalRecipes() {
    const rows = [...base.recipes].map(([id, data]) => ({ id, data }));
    listeners.forEach(l => { if (l.kind === 'recipes') l.next(colSnap(rows, false)); });
  }
  function refresh(kind) {
    clearTimeout(timers[kind]);
    timers[kind] = setTimeout(() => listeners.forEach(l => { if (l.kind === kind) emit(l, false); }), 250);
  }
  function refreshAll() { ['recipes', 'shop', 'plan'].forEach(refresh); }

  function connectRealtime() {
    if (channel) { sb.removeChannel(channel); channel = null; }
    if (!book) return;
    const f = 'book_id=eq.' + book;
    channel = sb.channel('book-' + book)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recipes', filter: f }, () => refresh('recipes'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_items', filter: f }, () => refresh('shop'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'plan_entries', filter: f }, () => refresh('plan'))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'recipes' }, p => { if (p.old && base.recipes.has(p.old.id)) refresh('recipes'); })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'shopping_items' }, p => { if (p.old && base.shop.has(p.old.id)) refresh('shop'); })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'plan_entries' }, () => refresh('plan'))
      .subscribe();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && book) refreshAll(); });
  window.addEventListener('online', () => { if (book) refreshAll(); });

  // ---------- interfaccia "documenti" usata dall'app ----------
  function recipeDoc(id) {
    return {
      id,
      async set(data) {
        const { error } = await sb.from('recipes').upsert({ id, book_id: book, data, created_by: userId }, { onConflict: 'id' });
        if (error) throw error; base.recipes.set(id, data); emitLocalRecipes(); refresh('recipes');
      },
      async update(patch) {
        let cur = base.recipes.get(id);
        if (!cur) { const { data } = await sb.from('recipes').select('data').eq('id', id).single(); cur = data && data.data; }
        if (!cur) throw { code: 'invalid_argument' };
        const next = Object.assign({}, cur, patch);
        const { error } = await sb.from('recipes').update({ data: next }).eq('id', id);
        if (error) throw error; base.recipes.set(id, next); emitLocalRecipes(); refresh('recipes');
      },
      async delete() { const { error } = await sb.from('recipes').delete().eq('id', id); if (error) throw error; base.recipes.delete(id); emitLocalRecipes(); refresh('recipes'); },
    };
  }
  async function writeShop(items) {
    const rows = (items || []).map(shopItemToRow);
    const seen = new Set(rows.map(r => r.id));
    const changed = rows.filter(r => base.shop.get(r.id) !== JSON.stringify(r));
    const removed = [...base.shop.keys()].filter(id => !seen.has(id));
    if (changed.length) { const { error } = await sb.from('shopping_items').upsert(changed, { onConflict: 'id' }); if (error) throw error; }
    if (removed.length) { const { error } = await sb.from('shopping_items').delete().in('id', removed); if (error) throw error; }
    base.shop = new Map(rows.map(r => [r.id, JSON.stringify(r)]));
    lsSet('cache.shop.' + book, rows.map(r => shopRowToItem(r)));
  }
  async function writePlan(monday, slots) {
    if (!base.plan.has(monday)) await fetchPlan(monday);
    const prev = base.plan.get(monday) || new Map();
    const rows = slotsToRows(monday, slots);
    const seen = new Set(rows.map(r => r.id));
    const changed = rows.filter(r => prev.get(r.id) !== JSON.stringify(r));
    const removed = [...prev.keys()].filter(id => !seen.has(id));
    if (changed.length) { const { error } = await sb.from('plan_entries').upsert(changed, { onConflict: 'id' }); if (error) throw error; }
    if (removed.length) { const { error } = await sb.from('plan_entries').delete().in('id', removed); if (error) throw error; }
    base.plan.set(monday, new Map(rows.map(r => [r.id, JSON.stringify(r)])));
  }
  const db = {
    collection(name) {
      if (name !== 'recipes') throw new Error('collection ' + name);
      return {
        doc: id => recipeDoc(id || uuid()),
        onSnapshot(next, error) { const l = { kind: 'recipes', next, error }; listeners.add(l); emit(l, true); return () => listeners.delete(l); },
      };
    },
    doc(path) {
      if (path === 'lists/shopping') return {
        set: body => writeShop(body.items),
        get: async () => docSnap({ items: await fetchShop() }),
        onSnapshot(next, error) { const l = { kind: 'shop', next, error }; listeners.add(l); emit(l, true); return () => listeners.delete(l); },
      };
      if (path.startsWith('plans/')) {
        const week = path.slice(6);
        return {
          set: body => writePlan(week, body.slots),
          get: async () => docSnap({ slots: await fetchPlan(week), weekStart: week }),
          onSnapshot(next, error) { const l = { kind: 'plan', week, next, error }; listeners.add(l); emit(l, false); return () => listeners.delete(l); },
        };
      }
      throw new Error('doc ' + path);
    },
  };

  // ---------- foto ----------
  const urlCache = new Map(Object.entries(lsGet('cache.photoUrls') || {}));
  let pending = new Set(), pendT = null, onPhotos = () => {};
  function photoUrl(path) {
    if (!path) return '';
    const c = urlCache.get(path);
    if (c && c.exp > Date.now() + 3600e3) return c.url;
    pending.add(path); clearTimeout(pendT); pendT = setTimeout(loadPhotos, 30);
    return c ? c.url : 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  }
  async function loadPhotos() {
    const paths = [...pending]; pending = new Set(); if (!paths.length) return;
    const { data, error } = await sb.storage.from('photos').createSignedUrls(paths, 60 * 60 * 24 * 7);
    if (error || !data) return;
    data.forEach(d => { if (d.signedUrl) urlCache.set(d.path, { url: d.signedUrl, exp: Date.now() + 6.5 * 864e5 }); });
    lsSet('cache.photoUrls', Object.fromEntries([...urlCache].slice(-300)));
    onPhotos();
  }
  const assets = {
    async upload(blob) {
      const path = book + '/' + uuid() + '.jpg';
      const { error } = await sb.storage.from('photos').upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
      if (error) throw error;
      return { id: path };
    },
    async delete(path) { await sb.storage.from('photos').remove([path]); urlCache.delete(path); },
  };

  // ---------- Claude (tramite la funzione server) ----------
  async function blobToB64(b) { const s = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(b); }); return { media_type: b.type || 'image/jpeg', data: String(s).split(',')[1] }; }
  async function ai(body) {
    if (body.images) body.images = await Promise.all(body.images.map(blobToB64));
    const { data, error } = await sb.functions.invoke('claude', { body });
    if (error) {
      let info = null;
      try { info = error.context && typeof error.context.json === 'function' ? await error.context.json() : null; } catch (e) { /* risposta non json */ }
      throw { code: (info && info.error) || (error.name === 'FunctionsFetchError' ? 'offline' : 'server'), limit: info && info.limit, detail: info && info.detail };
    }
    if (data && data.image) {
      const bin = atob(data.image.data); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      data.imageBlob = new Blob([u8], { type: data.image.media_type });
    }
    return data;
  }
  async function aiUsage() {
    const m = new Date(); m.setDate(1); m.setHours(0, 0, 0, 0);
    const { count } = await sb.from('ai_usage').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', m.toISOString());
    return count || 0;
  }

  // ---------- account e ricettari ----------
  const auth = {
    onChange(cb) { return sb.auth.onAuthStateChange((ev, session) => { userId = session && session.user ? session.user.id : null; cb(ev, session); }); },
    async session() { const { data } = await sb.auth.getSession(); userId = data.session ? data.session.user.id : null; return data.session; },
    signIn: (email, password) => sb.auth.signInWithPassword({ email, password }),
    signUp: (email, password, name) => sb.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: location.origin + location.pathname } }),
    reset: email => sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }),
    setPassword: password => sb.auth.updateUser({ password }),
    signOut: () => sb.auth.signOut(),
  };
  const books = {
    async list() {
      const { data, error } = await sb.from('book_members').select('role, books(id, name, owner_id, created_at)').eq('user_id', userId);
      if (error) throw error;
      return data.filter(r => r.books).map(r => ({ id: r.books.id, name: r.books.name, role: r.role, created_at: r.books.created_at })).sort((a, b) => (a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1) || String(a.created_at).localeCompare(String(b.created_at)));
    },
    async create(name) { const { data, error } = await sb.from('books').insert({ name, owner_id: userId }).select('id').single(); if (error) throw error; return data.id; },
    async rename(id, name) { const { error } = await sb.from('books').update({ name }).eq('id', id); if (error) throw error; },
    async remove(id) { const { error } = await sb.from('books').delete().eq('id', id); if (error) throw error; },
    async leave(id) { const { error } = await sb.from('book_members').delete().eq('book_id', id).eq('user_id', userId); if (error) throw error; },
    async removeMember(id, uid) { const { error } = await sb.from('book_members').delete().eq('book_id', id).eq('user_id', uid); if (error) throw error; },
    async members(id) {
      const { data, error } = await sb.from('book_members').select('user_id, role, joined_at').eq('book_id', id).order('joined_at');
      if (error) throw error;
      const { data: profs } = await sb.from('profiles').select('id, display_name, email').in('id', data.map(m => m.user_id));
      const byId = new Map((profs || []).map(p => [p.id, p]));
      return data.map(m => ({ ...m, name: (byId.get(m.user_id) || {}).display_name || '', email: (byId.get(m.user_id) || {}).email || '', me: m.user_id === userId }));
    },
    async invite(id) { const { data, error } = await sb.from('invites').insert({ book_id: id, created_by: userId }).select('code').single(); if (error) throw error; return data.code; },
    async preview(code) { const { data, error } = await sb.rpc('invite_preview', { p_code: code }); if (error) throw error; return data && data[0]; },
    async accept(code) { const { data, error } = await sb.rpc('accept_invite', { p_code: code }); if (error) throw error; return data; },
  };
  async function profile() { const { data } = await sb.from('profiles').select('display_name, email').eq('id', userId).single(); return data; }
  async function setName(name) { await sb.from('profiles').update({ display_name: name }).eq('id', userId); }

  function setBook(id) {
    book = id; base.shop = new Map(); base.plan = new Map(); base.recipes = new Map();
    connectRealtime();
    listeners.forEach(l => emit(l, true));
  }

  return {
    sb, db, assets, photoUrl, ai, aiUsage, auth, books, profile, setName, setBook,
    get book() { return book; }, get userId() { return userId; },
    onPhotosLoaded(cb) { onPhotos = cb; },
    refreshAll,
  };
}
