-- =====================================================================
--  Il mio ricettario · schema del database (Supabase / Postgres)
--  Da incollare UNA volta in: Supabase → SQL Editor → New query → Run
--  Si può rieseguire senza danni: usa "if not exists" / "or replace".
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Tabelle ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Il mio ricettario' check (char_length(name) between 1 and 80),
  owner_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.book_members (
  book_id uuid not null references public.books on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'editor' check (role in ('owner','editor')),
  joined_at timestamptz not null default now(),
  primary key (book_id, user_id)
);
create index if not exists book_members_user_idx on public.book_members(user_id);

create table if not exists public.invites (
  code text primary key default encode(extensions.gen_random_bytes(12), 'hex'),
  book_id uuid not null references public.books on delete cascade,
  created_by uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days'
);

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books on delete cascade,
  data jsonb not null,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists recipes_book_idx on public.recipes(book_id);

create table if not exists public.plan_entries (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books on delete cascade,
  day date not null,
  meal text not null check (meal in ('colazione','pranzo','cena')),
  recipe_id uuid references public.recipes on delete set null,
  servings numeric,
  text text,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists plan_entries_book_day_idx on public.plan_entries(book_id, day);

create table if not exists public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books on delete cascade,
  name text not null,
  qty numeric,
  unit text not null default '',
  note text not null default '',
  aisle text not null default 'Altro',
  sources text[] not null default '{}',
  checked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shopping_items_book_idx on public.shopping_items(book_id);

create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  kind text,
  input_tokens int,
  output_tokens int,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_user_month_idx on public.ai_usage(user_id, created_at);

-- ---------- Funzioni di supporto (bypassano RLS in modo controllato) ----------
create or replace function public.is_member(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from book_members where book_id = b and user_id = auth.uid());
$$;

create or replace function public.is_owner(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from book_members where book_id = b and user_id = auth.uid() and role = 'owner');
$$;

create or replace function public.shares_book_with(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select other = auth.uid() or exists(
    select 1 from book_members a join book_members b2 on a.book_id = b2.book_id
    where a.user_id = auth.uid() and b2.user_id = other);
$$;

-- ---------- Trigger ----------
-- nuovo ricettario → il creatore ne diventa proprietario
create or replace function public.on_book_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into book_members(book_id, user_id, role) values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists book_created on public.books;
create trigger book_created after insert on public.books
  for each row execute function public.on_book_created();

-- nuovo utente → profilo + primo ricettario personale
create or replace function public.on_user_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(id, email, display_name)
  values (new.id, new.email, coalesce(nullif(new.raw_user_meta_data->>'name',''), split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  insert into books(name, owner_id) values ('Il mio ricettario', new.id);
  return new;
end $$;
drop trigger if exists user_created on auth.users;
create trigger user_created after insert on auth.users
  for each row execute function public.on_user_created();

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists recipes_touch on public.recipes;
create trigger recipes_touch before update on public.recipes for each row execute function public.touch_updated_at();
drop trigger if exists shopping_touch on public.shopping_items;
create trigger shopping_touch before update on public.shopping_items for each row execute function public.touch_updated_at();

-- ---------- Inviti ----------
-- anteprima di un invito (nome del ricettario e di chi invita), senza unirsi
create or replace function public.invite_preview(p_code text)
returns table(book_name text, invited_by text, expired boolean)
language sql stable security definer set search_path = public as $$
  select b.name, coalesce(p.display_name, p.email), i.expires_at < now()
  from invites i join books b on b.id = i.book_id left join profiles p on p.id = i.created_by
  where i.code = p_code;
$$;

create or replace function public.accept_invite(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_book uuid;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select book_id into v_book from invites where code = p_code and expires_at > now();
  if v_book is null then raise exception 'invalid_invite'; end if;
  insert into book_members(book_id, user_id, role) values (v_book, auth.uid(), 'editor')
  on conflict do nothing;
  return v_book;
end $$;

-- ---------- Sicurezza riga per riga (RLS) ----------
alter table public.profiles      enable row level security;
alter table public.books         enable row level security;
alter table public.book_members  enable row level security;
alter table public.invites       enable row level security;
alter table public.recipes       enable row level security;
alter table public.plan_entries  enable row level security;
alter table public.shopping_items enable row level security;
alter table public.ai_usage      enable row level security;

drop policy if exists "profili visibili a chi condivide un ricettario" on public.profiles;
create policy "profili visibili a chi condivide un ricettario" on public.profiles
  for select to authenticated using (public.shares_book_with(id));
drop policy if exists "modifico il mio profilo" on public.profiles;
create policy "modifico il mio profilo" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "vedo i miei ricettari" on public.books;
create policy "vedo i miei ricettari" on public.books
  for select to authenticated using (public.is_member(id));
drop policy if exists "creo ricettari" on public.books;
create policy "creo ricettari" on public.books
  for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "il proprietario rinomina" on public.books;
create policy "il proprietario rinomina" on public.books
  for update to authenticated using (public.is_owner(id)) with check (public.is_owner(id));
drop policy if exists "il proprietario elimina" on public.books;
create policy "il proprietario elimina" on public.books
  for delete to authenticated using (public.is_owner(id));

drop policy if exists "vedo i membri dei miei ricettari" on public.book_members;
create policy "vedo i membri dei miei ricettari" on public.book_members
  for select to authenticated using (public.is_member(book_id));
drop policy if exists "esco o il proprietario rimuove" on public.book_members;
create policy "esco o il proprietario rimuove" on public.book_members
  for delete to authenticated using ((user_id = auth.uid() and role <> 'owner') or (public.is_owner(book_id) and role <> 'owner'));

drop policy if exists "inviti dei miei ricettari" on public.invites;
create policy "inviti dei miei ricettari" on public.invites
  for select to authenticated using (public.is_member(book_id));
drop policy if exists "creo inviti" on public.invites;
create policy "creo inviti" on public.invites
  for insert to authenticated with check (public.is_member(book_id) and created_by = auth.uid());
drop policy if exists "revoco inviti" on public.invites;
create policy "revoco inviti" on public.invites
  for delete to authenticated using (public.is_member(book_id));

drop policy if exists "ricette dei miei ricettari" on public.recipes;
create policy "ricette dei miei ricettari" on public.recipes
  for all to authenticated using (public.is_member(book_id)) with check (public.is_member(book_id));
drop policy if exists "menu dei miei ricettari" on public.plan_entries;
create policy "menu dei miei ricettari" on public.plan_entries
  for all to authenticated using (public.is_member(book_id)) with check (public.is_member(book_id));
drop policy if exists "spesa dei miei ricettari" on public.shopping_items;
create policy "spesa dei miei ricettari" on public.shopping_items
  for all to authenticated using (public.is_member(book_id)) with check (public.is_member(book_id));

drop policy if exists "vedo il mio uso di Claude" on public.ai_usage;
create policy "vedo il mio uso di Claude" on public.ai_usage
  for select to authenticated using (user_id = auth.uid());

grant execute on function public.invite_preview(text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;

-- ---------- Foto (Storage) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create or replace function public.photo_book(path text) returns uuid
language plpgsql immutable as $$
begin
  return (split_part(path, '/', 1))::uuid;
exception when others then return null;
end $$;

drop policy if exists "foto: leggo" on storage.objects;
create policy "foto: leggo" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.is_member(public.photo_book(name)));
drop policy if exists "foto: carico" on storage.objects;
create policy "foto: carico" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.is_member(public.photo_book(name)));
drop policy if exists "foto: sostituisco" on storage.objects;
create policy "foto: sostituisco" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and public.is_member(public.photo_book(name)));
drop policy if exists "foto: elimino" on storage.objects;
create policy "foto: elimino" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.is_member(public.photo_book(name)));

-- ---------- Aggiornamenti in tempo reale ----------
do $$ begin
  begin alter publication supabase_realtime add table public.recipes; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.plan_entries; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.shopping_items; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.book_members; exception when duplicate_object then null; end;
end $$;

-- ---------- Tabella "ping" per tenere sveglio il progetto gratuito ----------
create table if not exists public.keepalive (id int primary key default 1, pinged_at timestamptz not null default now());
insert into public.keepalive(id) values (1) on conflict do nothing;
alter table public.keepalive enable row level security;
drop policy if exists "ping pubblico" on public.keepalive;
create policy "ping pubblico" on public.keepalive for select to anon, authenticated using (true);
