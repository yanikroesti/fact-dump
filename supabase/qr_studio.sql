-- ════════════════════════════════════════════════════════════════════════════
-- QR Studio backend — dump.yanikroesti.ch
--
-- Rebuild script for the database side of the QR Studio (artifacts/qr-generator.html,
-- scan.html, api/q.js). It lives in the "Headquarter school" Supabase project
-- (ref ljkdibnkifzwydhqkzxt) and is applied there as three migrations:
--   qr_studio_1_schema_helpers · qr_studio_2_email_login_rpcs_storage ·
--   qr_studio_3_limited_code_handshake · qr_studio_4_feedback_any_page
-- This file is the resulting end state, taken from the live database.
--
-- Isolation: every table and helper sits in schema qr_private, which the Data
-- API does not expose. Browsers only reach the qr_* functions in public.
-- Tables have RLS on and no policies on purpose — all access goes through the
-- SECURITY DEFINER functions, which check the owner themselves.
--
-- Owner login: Supabase Auth e-mail codes. The owner is the confirmed auth user
-- whose address is stored in qr_private.admin.owner_email (set it below — it is
-- left out of this public repo). The Magic Link e-mail template must contain
-- {{ .Token }} so the mail carries a six-digit code instead of only a link.
--
-- Advisor notes, all intended:
--   * rls_enabled_no_policy on qr_private.* — access is function-only.
--   * anon/authenticated can execute SECURITY DEFINER qr_* functions — the scan
--     functions must be public; the owner ones call qr_private.require_owner().
-- ════════════════════════════════════════════════════════════════════════════

create schema if not exists qr_private;
revoke all on schema qr_private from public;
grant usage on schema qr_private to authenticated;   -- storage policies call is_owner()

-- ─── tables ────────────────────────────────────────────────────────────────

create table qr_private.admin (
  id           smallint primary key default 1 check (id = 1),
  owner_email  text,
  visitor_salt text not null default encode(extensions.gen_random_bytes(16), 'hex'),
  updated_at   timestamptz not null default now()
);

create table qr_private.codes (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[A-Za-z0-9_-]{3,40}$'),
  title         text not null default '' check (length(title) <= 200),
  kind          text not null check (kind in ('url', 'page')),
  target        text check (length(target) <= 4000),
  page          jsonb,
  rules         jsonb not null default '{}'::jsonb,
  password_hash text,
  active        boolean not null default true,
  starts_at     timestamptz,
  expires_at    timestamptz,
  max_scans     integer check (max_scans > 0),
  scan_count    integer not null default 0,
  first_scan_at timestamptz,
  last_scan_at  timestamptz,
  folder        text not null default '' check (length(folder) <= 80),
  note          text not null default '' check (length(note) <= 2000),
  design        jsonb,
  batch_id      uuid,
  batch_label   text,
  batch_no      integer,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (kind <> 'url' or target is not null),
  check (kind <> 'page' or page is not null)
);
create index codes_batch_idx on qr_private.codes (batch_id, batch_no) where batch_id is not null;

create table qr_private.scans (
  id           bigint generated always as identity primary key,
  code_id      uuid not null references qr_private.codes (id) on delete cascade,
  at           timestamptz not null default now(),
  outcome      text not null,          -- ok | paused | notyet | expired | used | badpass
  seq          integer,                -- running scan number for ok scans
  country      text,
  region       text,
  city         text,
  device       text,
  os           text,
  browser      text,
  lang         text,
  referer      text,
  visitor      text,                   -- salted hash of ip + user agent; the ip is never stored
  served       text,                   -- destination served (routing / A-B) or 'page'
  view_hash    text,                   -- sha256 of the landing-page view token
  view_expires timestamptz
);
create index scans_code_at_idx on qr_private.scans (code_id, at desc);
create index scans_view_idx on qr_private.scans (view_hash) where view_hash is not null;

create table qr_private.feedback (
  id      bigint generated always as identity primary key,
  code_id uuid not null references qr_private.codes (id) on delete cascade,
  scan_id bigint unique references qr_private.scans (id) on delete set null,
  at      timestamptz not null default now(),
  rating  smallint check (rating between 1 and 5),
  answers jsonb,
  comment text check (length(comment) <= 2000),
  contact text check (length(contact) <= 200)
);
create index feedback_code_idx on qr_private.feedback (code_id, at desc);

alter table qr_private.admin    enable row level security;
alter table qr_private.codes    enable row level security;
alter table qr_private.scans    enable row level security;
alter table qr_private.feedback enable row level security;
revoke all on all tables in schema qr_private from public, anon, authenticated;

insert into qr_private.admin (id, owner_email) values (1, '<owner e-mail address>');

-- ─── helpers (qr_private, never exposed) ───────────────────────────────────

CREATE OR REPLACE FUNCTION qr_private.sha(p text)
 RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path TO ''
AS $function$
  select encode(extensions.digest(convert_to(p, 'UTF8'), 'sha256'), 'hex')
$function$;

CREATE OR REPLACE FUNCTION qr_private.token()
 RETURNS text LANGUAGE sql SET search_path TO ''
AS $function$
  select encode(extensions.gen_random_bytes(32), 'hex')
$function$;

-- random slug from an unambiguous 56-letter alphabet (no 0/O, 1/l/I)
CREATE OR REPLACE FUNCTION qr_private.slug(p_len integer)
 RETURNS text LANGUAGE plpgsql SET search_path TO ''
AS $function$
declare
  alphabet constant text := 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea := extensions.gen_random_bytes(p_len * 3);
  s text := '';
  v int;
  i int := 0;
begin
  while length(s) < p_len and i < p_len * 3 loop
    v := get_byte(b, i);
    i := i + 1;
    if v < 224 then                          -- 224 = 4 × 56 keeps the draw unbiased
      s := s || substr(alphabet, (v % 56) + 1, 1);
    end if;
  end loop;
  while length(s) < p_len loop
    s := s || substr(alphabet, (get_byte(extensions.gen_random_bytes(1), 0) % 56) + 1, 1);
  end loop;
  return s;
end $function$;

CREATE OR REPLACE FUNCTION qr_private.unique_slug()
 RETURNS text LANGUAGE plpgsql SET search_path TO ''
AS $function$
declare s text;
begin
  loop
    s := qr_private.slug(7);
    exit when not exists (select 1 from qr_private.codes where slug = s);
  end loop;
  return s;
end $function$;

CREATE OR REPLACE FUNCTION qr_private.valid_url(p text)
 RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $function$
  select p is not null
     and length(p) <= 4000
     and p ~* '^(https?://[^\s]+|mailto:[^\s]+|tel:[+0-9()\s.-]+|sms:[^\s]+|smsto:[^\s]+|geo:[^\s]+)$'
$function$;

CREATE OR REPLACE FUNCTION qr_private.is_owner()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  select coalesce((
    select u.id = (select auth.uid())
      from auth.users u
      join qr_private.admin a on a.id = 1 and lower(u.email) = lower(a.owner_email)
     where u.email_confirmed_at is not null
       and u.deleted_at is null
       and (u.banned_until is null or u.banned_until < now())
     limit 1), false)
$function$;

-- raises 42501, which PostgREST turns into HTTP 403
CREATE OR REPLACE FUNCTION qr_private.require_owner()
 RETURNS void LANGUAGE plpgsql STABLE SET search_path TO ''
AS $function$
begin
  if not qr_private.is_owner() then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
end $function$;

CREATE OR REPLACE FUNCTION qr_private.code_json(c qr_private.codes)
 RETURNS jsonb LANGUAGE sql STABLE SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id', c.id, 'slug', c.slug, 'title', c.title, 'kind', c.kind, 'target', c.target,
    'page', c.page, 'rules', c.rules, 'has_password', c.password_hash is not null,
    'active', c.active, 'starts_at', c.starts_at, 'expires_at', c.expires_at,
    'max_scans', c.max_scans, 'scan_count', c.scan_count,
    'first_scan_at', c.first_scan_at, 'last_scan_at', c.last_scan_at,
    'folder', c.folder, 'note', c.note, 'design', c.design,
    'batch_id', c.batch_id, 'batch_label', c.batch_label, 'batch_no', c.batch_no,
    'created_at', c.created_at, 'updated_at', c.updated_at,
    'scans_total', (select count(*) from qr_private.scans s where s.code_id = c.id and s.outcome = 'ok'),
    'scans_7d', (select count(*) from qr_private.scans s
                  where s.code_id = c.id and s.outcome = 'ok' and s.at > now() - interval '7 days'))
$function$;

-- smart routing for url codes. Order: scheduled switch (sets the base) →
-- time slots → country → language → device → A/B split → base
CREATE OR REPLACE FUNCTION qr_private.route(c qr_private.codes, m jsonb)
 RETURNS text LANGUAGE plpgsql STABLE SET search_path TO ''
AS $function$
declare
  r jsonb := coalesce(c.rules, '{}'::jsonb);
  base text := c.target;
  x jsonb;
  tz text;
  loc timestamp;
  dow int;
  hm text;
  f text;
  t text;
  total numeric := 0;
  pick numeric;
  acc numeric := 0;
  v_os text := lower(coalesce(m->>'os', ''));
  v_device text := lower(coalesce(m->>'device', ''));
  v_country text := upper(coalesce(m->>'country', ''));
  v_lang text := lower(left(coalesce(m->>'lang', ''), 2));
  v_visitor text := coalesce(m->>'visitor', '');
begin
  if jsonb_typeof(r->'schedule') = 'array' then
    for x in select e from jsonb_array_elements(r->'schedule') e order by (e->>'from')::timestamptz loop
      if (x->>'from')::timestamptz <= now() and qr_private.valid_url(x->>'url') then
        base := x->>'url';
      end if;
    end loop;
  end if;

  if jsonb_typeof(r->'time') = 'object' and jsonb_typeof(r->'time'->'slots') = 'array' then
    tz := coalesce(nullif(r->'time'->>'tz', ''), 'Europe/Zurich');
    loc := now() at time zone tz;
    dow := extract(isodow from loc)::int;
    hm := to_char(loc, 'HH24:MI');
    for x in select e from jsonb_array_elements(r->'time'->'slots') e loop
      f := coalesce(nullif(x->>'from', ''), '00:00');
      t := coalesce(nullif(x->>'to', ''), '24:00');
      if (jsonb_typeof(x->'days') is distinct from 'array'
            or jsonb_array_length(x->'days') = 0
            or x->'days' @> to_jsonb(dow))
         and (case when f <= t then hm >= f and hm < t else hm >= f or hm < t end)
         and qr_private.valid_url(x->>'url') then
        return x->>'url';
      end if;
    end loop;
  end if;

  if v_country <> '' and jsonb_typeof(r->'geo') = 'array' then
    for x in select e from jsonb_array_elements(r->'geo') e loop
      if jsonb_typeof(x->'countries') = 'array' and x->'countries' ? v_country
         and qr_private.valid_url(x->>'url') then
        return x->>'url';
      end if;
    end loop;
  end if;

  if v_lang <> '' and jsonb_typeof(r->'lang') = 'array' then
    for x in select e from jsonb_array_elements(r->'lang') e loop
      if jsonb_typeof(x->'langs') = 'array' and x->'langs' ? v_lang
         and qr_private.valid_url(x->>'url') then
        return x->>'url';
      end if;
    end loop;
  end if;

  if jsonb_typeof(r->'device') = 'object' then
    if v_os = 'ios' and qr_private.valid_url(r->'device'->>'ios') then
      return r->'device'->>'ios';
    end if;
    if v_os = 'android' and qr_private.valid_url(r->'device'->>'android') then
      return r->'device'->>'android';
    end if;
    if v_device = 'desktop' and qr_private.valid_url(r->'device'->>'desktop') then
      return r->'device'->>'desktop';
    end if;
  end if;

  if jsonb_typeof(r->'ab') = 'array' and jsonb_array_length(r->'ab') > 0 then
    select coalesce(sum(greatest(coalesce((e->>'weight')::numeric, 1), 0)), 0) into total
      from jsonb_array_elements(r->'ab') e
     where qr_private.valid_url(e->>'url');
    if total > 0 then
      -- same visitor → same variant
      if v_visitor ~ '^[0-9a-f]{8}' then
        pick := ((('x' || lpad(substr(v_visitor, 1, 8), 16, '0'))::bit(64)::bigint % 1000000)::numeric / 1000000) * total;
      else
        pick := random()::numeric * total;
      end if;
      for x in select e from jsonb_array_elements(r->'ab') e where qr_private.valid_url(e->>'url') loop
        acc := acc + greatest(coalesce((x->>'weight')::numeric, 1), 0);
        if pick < acc then
          return x->>'url';
        end if;
      end loop;
    end if;
  end if;

  return base;
end $function$;

CREATE OR REPLACE FUNCTION qr_private.log_scan(p_code uuid, p_outcome text, m jsonb, p_served text, p_token text, p_seq integer)
 RETURNS bigint LANGUAGE plpgsql SET search_path TO ''
AS $function$
declare v_id bigint;
begin
  insert into qr_private.scans (code_id, outcome, seq, country, region, city, device, os, browser,
                                lang, referer, visitor, served, view_hash, view_expires)
  values (p_code, p_outcome, p_seq,
          nullif(left(upper(coalesce(m->>'country', '')), 2), ''),
          nullif(left(coalesce(m->>'region', ''), 8), ''),
          nullif(left(coalesce(m->>'city', ''), 80), ''),
          nullif(left(lower(coalesce(m->>'device', '')), 16), ''),
          nullif(left(lower(coalesce(m->>'os', '')), 16), ''),
          nullif(left(coalesce(m->>'browser', ''), 32), ''),
          nullif(left(lower(coalesce(m->>'lang', '')), 8), ''),
          nullif(left(coalesce(m->>'referer', ''), 300), ''),
          nullif(m->>'visitor', ''),
          left(p_served, 4000),
          case when p_token is not null then qr_private.sha(p_token) end,
          case when p_token is not null then now() + interval '2 hours' end)
  returning id into v_id;
  return v_id;
end $function$;

-- the scan pipeline shared by qr_hit (from /q/<slug>) and qr_unlock (password form)
CREATE OR REPLACE FUNCTION qr_private.resolve(p_slug text, p_meta jsonb, p_password text)
 RETURNS jsonb LANGUAGE plpgsql SET search_path TO ''
AS $function$
declare
  c qr_private.codes;
  m jsonb := case when jsonb_typeof(p_meta) = 'object' then p_meta else '{}'::jsonb end;
  v_dest text;
  v_token text;
  v_fails int;
  v_os text := lower(coalesce(m->>'os', ''));
begin
  if p_slug is null or p_slug !~ '^[A-Za-z0-9_-]{3,40}$' then
    return jsonb_build_object('status', 'notfound');
  end if;

  select * into c from qr_private.codes where slug = p_slug for update;
  if c.id is null then
    return jsonb_build_object('status', 'notfound');
  end if;

  m := (m - 'ip' - 'ua') || jsonb_build_object('visitor', left(qr_private.sha(
         (select visitor_salt from qr_private.admin where id = 1) || '|' ||
         coalesce(m->>'ip', '') || '|' || coalesce(m->>'ua', '')), 16));

  if not c.active then
    perform qr_private.log_scan(c.id, 'paused', m, null, null, null);
    return jsonb_build_object('status', 'paused', 'title', c.title);
  end if;
  if c.starts_at is not null and c.starts_at > now() then
    perform qr_private.log_scan(c.id, 'notyet', m, null, null, null);
    return jsonb_build_object('status', 'notyet', 'title', c.title, 'starts_at', c.starts_at);
  end if;
  if c.expires_at is not null and c.expires_at <= now() then
    perform qr_private.log_scan(c.id, 'expired', m, null, null, null);
    return jsonb_build_object('status', 'expired', 'title', c.title, 'expires_at', c.expires_at);
  end if;
  if c.max_scans is not null and c.scan_count >= c.max_scans then
    perform qr_private.log_scan(c.id, 'used', m, null, null, null);
    return jsonb_build_object('status', case when c.max_scans = 1 then 'used' else 'limit' end,
                              'title', c.title, 'max_scans', c.max_scans,
                              'first_scan_at', c.first_scan_at, 'last_scan_at', c.last_scan_at);
  end if;

  /* limited codes: count nothing until a real browser confirms */
  if c.max_scans is not null and coalesce(m->>'mode', '') = 'get' then
    return jsonb_build_object('status', 'confirm', 'title', c.title);
  end if;

  if c.password_hash is not null then
    if p_password is null then
      return jsonb_build_object('status', 'locked', 'title', c.title);
    end if;
    select count(*) into v_fails from qr_private.scans
     where code_id = c.id and outcome = 'badpass' and at > now() - interval '15 minutes';
    if v_fails >= 8 then
      return jsonb_build_object('status', 'throttled', 'title', c.title);
    end if;
    if extensions.crypt(p_password, c.password_hash) <> c.password_hash then
      perform qr_private.log_scan(c.id, 'badpass', m, null, null, null);
      return jsonb_build_object('status', 'badpass', 'title', c.title);
    end if;
  end if;

  if c.kind = 'url' then
    v_dest := qr_private.route(c, m);
  elsif c.page->>'type' = 'app' then
    if v_os = 'ios' and qr_private.valid_url(c.page->>'ios') then
      v_dest := c.page->>'ios';
    elsif v_os = 'android' and qr_private.valid_url(c.page->>'android') then
      v_dest := c.page->>'android';
    end if;
  end if;

  update qr_private.codes
     set scan_count = scan_count + 1,
         first_scan_at = coalesce(first_scan_at, now()),
         last_scan_at = now()
   where id = c.id;

  if v_dest is not null then
    perform qr_private.log_scan(c.id, 'ok', m, v_dest, null, c.scan_count + 1);
    return jsonb_build_object('status', 'redirect', 'url', v_dest);
  end if;

  v_token := qr_private.token();
  perform qr_private.log_scan(c.id, 'ok', m, 'page', v_token, c.scan_count + 1);
  return jsonb_build_object('status', 'page', 'token', v_token,
                            'scan_no', c.scan_count + 1, 'max_scans', c.max_scans);
end $function$;

-- ─── public RPCs: scanning (anyone) ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.qr_ping()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  select jsonb_build_object('ok', true, 'at', now())
$function$;

CREATE OR REPLACE FUNCTION public.qr_hit(p_slug text, p_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $function$
  select qr_private.resolve(p_slug, p_meta, null)
$function$;

CREATE OR REPLACE FUNCTION public.qr_unlock(p_slug text, p_password text, p_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $function$
  select qr_private.resolve(p_slug, p_meta, coalesce(p_password, ''))
$function$;

CREATE OR REPLACE FUNCTION public.qr_view(p_slug text, p_token text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
declare
  s qr_private.scans;
  c qr_private.codes;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into s from qr_private.scans where view_hash = qr_private.sha(p_token);
  if s.id is null then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into c from qr_private.codes where id = s.code_id;
  if c.id is null or c.slug <> p_slug then
    return jsonb_build_object('status', 'invalid');
  end if;
  if s.view_expires < now() then
    return jsonb_build_object('status', 'stale');
  end if;
  if not c.active then
    return jsonb_build_object('status', 'paused', 'title', c.title);
  end if;
  return jsonb_build_object(
    'status', 'ok', 'title', c.title, 'page', c.page,
    'scan_no', s.seq, 'max_scans', c.max_scans, 'scanned_at', s.at,
    'feedback_sent', exists (select 1 from qr_private.feedback f where f.scan_id = s.id));
end $function$;

CREATE OR REPLACE FUNCTION public.qr_feedback_submit(p_slug text, p_token text, p_rating integer, p_answers jsonb, p_comment text, p_contact text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare
  s qr_private.scans;
  c qr_private.codes;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into s from qr_private.scans
   where view_hash = qr_private.sha(p_token) and view_expires > now();
  if s.id is null then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into c from qr_private.codes where id = s.code_id;
  if c.id is null or c.slug <> p_slug
     or not (coalesce(c.page->>'type', '') = 'feedback'
             or coalesce(c.page->'blocks', '[]'::jsonb) @> '[{"t":"feedback"}]'::jsonb) then
    return jsonb_build_object('status', 'invalid');
  end if;
  if exists (select 1 from qr_private.feedback where scan_id = s.id) then
    return jsonb_build_object('status', 'duplicate');
  end if;
  insert into qr_private.feedback (code_id, scan_id, rating, answers, comment, contact)
  values (c.id, s.id,
          case when p_rating between 1 and 5 then p_rating end,
          case when jsonb_typeof(p_answers) = 'object' and pg_column_size(p_answers) < 8000 then p_answers end,
          nullif(left(coalesce(p_comment, ''), 2000), ''),
          nullif(left(coalesce(p_contact, ''), 200), ''));
  return jsonb_build_object('status', 'ok');
end $function$;

-- ─── public RPCs: owner only ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.qr_me()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  select jsonb_build_object('owner', qr_private.is_owner())
$function$;

CREATE OR REPLACE FUNCTION public.qr_list()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
begin
  perform qr_private.require_owner();
  return jsonb_build_object(
    'codes', coalesce((select jsonb_agg(qr_private.code_json(c) order by c.created_at desc)
                         from qr_private.codes c where c.batch_id is null), '[]'::jsonb),
    'batches', coalesce((
      select jsonb_agg(b order by b->>'created_at' desc) from (
        select jsonb_build_object(
          'batch_id', c.batch_id, 'label', min(c.batch_label), 'count', count(*),
          'used', count(*) filter (where c.max_scans is not null and c.scan_count >= c.max_scans),
          'scanned', count(*) filter (where c.scan_count > 0),
          'created_at', min(c.created_at),
          'template', (select qr_private.code_json(t) from qr_private.codes t
                        where t.batch_id = c.batch_id order by t.batch_no limit 1)) b
          from qr_private.codes c where c.batch_id is not null group by c.batch_id) x), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.qr_batch_codes(p_batch_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
begin
  perform qr_private.require_owner();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', id, 'slug', slug, 'title', title, 'batch_no', batch_no, 'active', active,
             'max_scans', max_scans, 'scan_count', scan_count,
             'first_scan_at', first_scan_at, 'last_scan_at', last_scan_at) order by batch_no)
      from qr_private.codes where batch_id = p_batch_id), '[]'::jsonb);
end $function$;

-- insert (no id) or update (id). On update, keys missing from p_data keep their
-- stored value, so a toggle can send just {id, active}.
CREATE OR REPLACE FUNCTION public.qr_save(p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare
  v_id uuid := nullif(p_data->>'id', '')::uuid;
  o qr_private.codes;
  v_slug text;
  v_kind text;
  v_target text;
  v_page jsonb;
  v_rules jsonb;
  v_design jsonb;
  v_row qr_private.codes;
  x jsonb;
begin
  perform qr_private.require_owner();

  if v_id is not null then
    select * into o from qr_private.codes where id = v_id for update;
    if o.id is null then
      raise exception 'Code not found' using errcode = 'P0002';
    end if;
  end if;

  v_slug   := case when p_data ? 'slug' then nullif(trim(coalesce(p_data->>'slug', '')), '') end;
  v_kind   := coalesce(p_data->>'kind', o.kind);
  v_target := case when p_data ? 'target' then nullif(trim(coalesce(p_data->>'target', '')), '') else o.target end;
  v_page   := case when p_data ? 'page'
                   then case when jsonb_typeof(p_data->'page') = 'object' then p_data->'page' end
                   else o.page end;
  v_rules  := case when p_data ? 'rules'
                   then case when jsonb_typeof(p_data->'rules') = 'object' then p_data->'rules' else '{}'::jsonb end
                   else coalesce(o.rules, '{}'::jsonb) end;
  v_design := case when p_data ? 'design'
                   then case when jsonb_typeof(p_data->'design') = 'object' then p_data->'design' end
                   else o.design end;

  if v_kind is null or v_kind not in ('url', 'page') then
    raise exception 'Unknown code kind' using errcode = '22023';
  end if;
  if v_kind = 'url' and not qr_private.valid_url(v_target) then
    raise exception 'The destination must be a full link (https://…)' using errcode = '22023';
  end if;
  if v_kind = 'page' and (v_page is null or pg_column_size(v_page) > 300000) then
    raise exception 'Page content is missing or too large' using errcode = '22023';
  end if;
  if v_slug is not null and v_slug !~ '^[A-Za-z0-9_-]{3,40}$' then
    raise exception 'Short link: 3–40 letters, digits, - or _' using errcode = '22023';
  end if;
  if v_design is not null and pg_column_size(v_design) > 200000 then
    raise exception 'Design is too large (upload the logo instead of embedding it)' using errcode = '22023';
  end if;
  if nullif(p_data->>'max_scans', '') is not null and (p_data->>'max_scans')::int < 1 then
    raise exception 'Scan limit must be at least 1' using errcode = '22023';
  end if;

  -- rules run on every scan, so reject anything that would break there
  if jsonb_typeof(v_rules->'schedule') = 'array' then
    for x in select e from jsonb_array_elements(v_rules->'schedule') e loop
      perform (x->>'from')::timestamptz;
      if not qr_private.valid_url(x->>'url') then
        raise exception 'Scheduled link is not a valid URL' using errcode = '22023';
      end if;
    end loop;
  end if;
  if jsonb_typeof(v_rules->'time') = 'object' then
    perform now() at time zone coalesce(nullif(v_rules->'time'->>'tz', ''), 'Europe/Zurich');
  end if;

  if v_id is null then
    insert into qr_private.codes (slug, title, kind, target, page, rules, password_hash, active,
                                  starts_at, expires_at, max_scans, folder, note, design)
    values (coalesce(v_slug, qr_private.unique_slug()),
            left(coalesce(p_data->>'title', ''), 200), v_kind,
            case when v_kind = 'url' then v_target end,
            case when v_kind = 'page' then v_page end,
            v_rules,
            case when coalesce(p_data->>'password', '') <> ''
                 then extensions.crypt(p_data->>'password', extensions.gen_salt('bf', 8)) end,
            coalesce((p_data->>'active')::boolean, true),
            nullif(p_data->>'starts_at', '')::timestamptz,
            nullif(p_data->>'expires_at', '')::timestamptz,
            nullif(p_data->>'max_scans', '')::int,
            left(coalesce(p_data->>'folder', ''), 80),
            left(coalesce(p_data->>'note', ''), 2000),
            v_design)
    returning * into v_row;
  else
    update qr_private.codes set
      slug          = coalesce(v_slug, slug),
      title         = left(coalesce(p_data->>'title', title), 200),
      kind          = v_kind,
      target        = case when v_kind = 'url' then v_target end,
      page          = case when v_kind = 'page' then v_page end,
      rules         = v_rules,
      password_hash = case when not (p_data ? 'password') then password_hash
                           when coalesce(p_data->>'password', '') = '' then null
                           else extensions.crypt(p_data->>'password', extensions.gen_salt('bf', 8)) end,
      active        = coalesce((p_data->>'active')::boolean, active),
      starts_at     = case when p_data ? 'starts_at' then nullif(p_data->>'starts_at', '')::timestamptz else starts_at end,
      expires_at    = case when p_data ? 'expires_at' then nullif(p_data->>'expires_at', '')::timestamptz else expires_at end,
      max_scans     = case when p_data ? 'max_scans' then nullif(p_data->>'max_scans', '')::int else max_scans end,
      folder        = left(coalesce(p_data->>'folder', folder), 80),
      note          = left(coalesce(p_data->>'note', note), 2000),
      design        = v_design,
      updated_at    = now()
    where id = v_id
    returning * into v_row;
  end if;
  return qr_private.code_json(v_row);
exception
  when unique_violation then
    raise exception 'That short link is already taken' using errcode = '23505';
end $function$;

-- one-time batches: N copies of the same content, each with its own slug and
-- (by default) a scan limit of 1 — tickets, vouchers, single-use links
CREATE OR REPLACE FUNCTION public.qr_batch_create(p_data jsonb, p_count integer, p_label text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare
  v_batch uuid := gen_random_uuid();
  v_label text := left(coalesce(nullif(trim(p_label), ''), 'Batch'), 120);
  v_first jsonb;
  t qr_private.codes;
begin
  perform qr_private.require_owner();
  if p_count is null or p_count < 1 or p_count > 1000 then
    raise exception 'Batch size must be 1–1000' using errcode = '22023';
  end if;
  v_first := public.qr_save(
    (p_data - 'id' - 'slug') || jsonb_build_object('max_scans', coalesce(nullif(p_data->>'max_scans', '')::int, 1)));
  update qr_private.codes
     set batch_id = v_batch, batch_label = v_label, batch_no = 1, title = left(v_label || ' #1', 200)
   where id = (v_first->>'id')::uuid
  returning * into t;
  for i in 2..p_count loop
    insert into qr_private.codes (slug, title, kind, target, page, rules, password_hash, active, starts_at,
                                  expires_at, max_scans, folder, note, design, batch_id, batch_label, batch_no)
    values (qr_private.unique_slug(), left(v_label || ' #' || i, 200), t.kind, t.target, t.page, t.rules,
            t.password_hash, t.active, t.starts_at, t.expires_at, t.max_scans, t.folder, t.note, null,
            v_batch, v_label, i);
  end loop;
  return jsonb_build_object('batch_id', v_batch, 'codes', public.qr_batch_codes(v_batch));
end $function$;

CREATE OR REPLACE FUNCTION public.qr_delete(p_ids uuid[])
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare n int;
begin
  perform qr_private.require_owner();
  delete from qr_private.codes where id = any(p_ids);
  get diagnostics n = row_count;
  return jsonb_build_object('deleted', n);
end $function$;

-- re-arm used one-time codes (scan history is kept)
CREATE OR REPLACE FUNCTION public.qr_reset(p_ids uuid[])
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare n int;
begin
  perform qr_private.require_owner();
  update qr_private.codes
     set scan_count = 0, first_scan_at = null, last_scan_at = null, updated_at = now()
   where id = any(p_ids);
  get diagnostics n = row_count;
  return jsonb_build_object('reset', n);
end $function$;

CREATE OR REPLACE FUNCTION public.qr_stats(p_ids uuid[] DEFAULT NULL::uuid[], p_days integer DEFAULT 30)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
declare
  v_days int := least(greatest(coalesce(p_days, 30), 1), 730);
  v_all boolean := p_ids is null or cardinality(p_ids) = 0;
  v_today date := (now() at time zone 'Europe/Zurich')::date;
begin
  perform qr_private.require_owner();
  return (
    with s as (
      select * from qr_private.scans
       where (v_all or code_id = any(p_ids)) and at > now() - make_interval(days => v_days)
    ), ok as (
      select *, (at at time zone 'Europe/Zurich') as local_at from s where outcome = 'ok'
    )
    select jsonb_build_object(
      'days', v_days,
      'total', (select count(*) from qr_private.scans
                 where (v_all or code_id = any(p_ids)) and outcome = 'ok'),
      'period', (select count(*) from ok),
      'unique', (select count(distinct visitor) from ok),
      'today', (select count(*) from ok where local_at::date = v_today),
      'blocked', (select count(*) from s where outcome <> 'ok'),
      'daily', (select coalesce(jsonb_agg(jsonb_build_object('d', days.d, 'n', coalesce(x.n, 0), 'u', coalesce(x.u, 0))
                                          order by days.d), '[]'::jsonb)
                  from (select v_today - g as d from generate_series(0, v_days - 1) g) days
                  left join (select local_at::date dd, count(*) n, count(distinct visitor) u
                               from ok group by 1) x on x.dd = days.d),
      'country', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc), '[]'::jsonb)
                    from (select coalesce(country, '?') k, count(*) n from ok group by 1 order by 2 desc limit 25) t),
      'city', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc), '[]'::jsonb)
                 from (select coalesce(city, '?') || coalesce(' · ' || country, '') k, count(*) n
                         from ok group by 1 order by 2 desc limit 25) t),
      'os', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc), '[]'::jsonb)
               from (select coalesce(os, '?') k, count(*) n from ok group by 1 order by 2 desc limit 12) t),
      'device', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc), '[]'::jsonb)
                   from (select coalesce(device, '?') k, count(*) n from ok group by 1 order by 2 desc limit 12) t),
      'browser', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc), '[]'::jsonb)
                    from (select coalesce(browser, '?') k, count(*) n from ok group by 1 order by 2 desc limit 12) t),
      'lang', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc), '[]'::jsonb)
                 from (select coalesce(left(lang, 2), '?') k, count(*) n from ok group by 1 order by 2 desc limit 12) t),
      'outcome', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc), '[]'::jsonb)
                    from (select outcome k, count(*) n from s group by 1) t),
      'served', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc), '[]'::jsonb)
                   from (select served k, count(*) n from ok where served is not null
                          group by 1 order by 2 desc limit 20) t),
      'heat', (select coalesce(jsonb_agg(jsonb_build_array(dow, h, n)), '[]'::jsonb)
                 from (select extract(isodow from local_at)::int dow, extract(hour from local_at)::int h, count(*) n
                         from ok group by 1, 2) t),
      'recent', (select coalesce(jsonb_agg(jsonb_build_object(
                    'at', t.at, 'outcome', t.outcome, 'country', t.country, 'city', t.city, 'os', t.os,
                    'device', t.device, 'browser', t.browser, 'lang', t.lang, 'served', t.served,
                    'code_id', t.code_id, 'seq', t.seq) order by t.at desc), '[]'::jsonb)
                   from (select * from s order by at desc limit 100) t),
      'per_code', (select coalesce(jsonb_agg(jsonb_build_object('id', code_id, 'n', n) order by n desc), '[]'::jsonb)
                     from (select code_id, count(*) n from ok group by 1 order by 2 desc limit 50) t),
      'feedback', (select jsonb_build_object(
                      'count', count(*), 'avg', round(avg(f.rating)::numeric, 2),
                      'items', coalesce(jsonb_agg(jsonb_build_object(
                                 'at', f.at, 'rating', f.rating, 'comment', f.comment, 'contact', f.contact,
                                 'answers', f.answers, 'code_id', f.code_id) order by f.at desc), '[]'::jsonb))
                     from (select * from qr_private.feedback fb
                            where v_all or fb.code_id = any(p_ids) order by at desc limit 200) f))
  );
end $function$;

CREATE OR REPLACE FUNCTION public.qr_export(p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
begin
  perform qr_private.require_owner();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'at', s.at, 'slug', c.slug, 'title', c.title, 'outcome', s.outcome, 'seq', s.seq,
             'country', s.country, 'region', s.region, 'city', s.city, 'device', s.device, 'os', s.os,
             'browser', s.browser, 'lang', s.lang, 'referer', s.referer, 'visitor', s.visitor,
             'served', s.served) order by s.at desc)
      from (select * from qr_private.scans
             where p_ids is null or cardinality(p_ids) = 0 or code_id = any(p_ids)
             order by at desc limit 20000) s
      join qr_private.codes c on c.id = s.code_id), '[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.qr_files()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
begin
  perform qr_private.require_owner();
  return jsonb_build_object(
    'used', (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects where bucket_id = 'qr-media'),
    'limit', 900::bigint * 1024 * 1024,
    'files', coalesce((
      select jsonb_agg(jsonb_build_object(
               'path', o.name, 'size', (o.metadata->>'size')::bigint, 'mime', o.metadata->>'mimetype',
               'at', o.created_at,
               'used_by', (select count(*) from qr_private.codes c
                            where strpos(coalesce(c.page::text, ''), o.name) > 0
                               or strpos(coalesce(c.design::text, ''), o.name) > 0)) order by o.created_at desc)
        from storage.objects o where o.bucket_id = 'qr-media'), '[]'::jsonb));
end $function$;

-- ─── storage: public bucket, only the owner can write ──────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('qr-media', 'qr-media', true, 52428800, array[
  'image/*', 'video/*', 'audio/*', 'application/pdf', 'text/plain', 'text/csv',
  'text/vcard', 'text/x-vcard', 'text/calendar', 'application/zip', 'application/epub+zip',
  'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict (id) do nothing;

create policy "qr-media owner insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'qr-media' and qr_private.is_owner());
create policy "qr-media owner select" on storage.objects
  for select to authenticated
  using (bucket_id = 'qr-media' and qr_private.is_owner());
create policy "qr-media owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'qr-media' and qr_private.is_owner())
  with check (bucket_id = 'qr-media' and qr_private.is_owner());
create policy "qr-media owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'qr-media' and qr_private.is_owner());

-- ─── privileges ────────────────────────────────────────────────────────────

revoke execute on all functions in schema qr_private from public, anon, authenticated;
grant execute on function qr_private.is_owner() to authenticated;

revoke execute on function
  public.qr_ping(), public.qr_hit(text, jsonb), public.qr_unlock(text, text, jsonb),
  public.qr_view(text, text), public.qr_feedback_submit(text, text, int, jsonb, text, text),
  public.qr_me(), public.qr_list(), public.qr_batch_codes(uuid), public.qr_save(jsonb),
  public.qr_batch_create(jsonb, int, text), public.qr_delete(uuid[]), public.qr_reset(uuid[]),
  public.qr_stats(uuid[], int), public.qr_export(uuid[]), public.qr_files()
from public, anon, authenticated;

grant execute on function
  public.qr_ping(), public.qr_hit(text, jsonb), public.qr_unlock(text, text, jsonb),
  public.qr_view(text, text), public.qr_feedback_submit(text, text, int, jsonb, text, text),
  public.qr_me()
to anon, authenticated;

grant execute on function
  public.qr_list(), public.qr_batch_codes(uuid), public.qr_save(jsonb),
  public.qr_batch_create(jsonb, int, text), public.qr_delete(uuid[]), public.qr_reset(uuid[]),
  public.qr_stats(uuid[], int), public.qr_export(uuid[]), public.qr_files()
to authenticated;
