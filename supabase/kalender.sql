-- Zäme — shared family calendar (artifacts/kalender.html).
-- Lives in the "easel" Supabase project next to Easel (designs/shares) and systemzzz (sz_*);
-- every object here is prefixed cal_ and touches nothing else.
--
-- Model: an event is never written directly by a parent. Every create/update/delete goes
-- through cal_propose(), which looks up the category's approval rule and either applies it
-- at once or leaves a pending row in cal_changes for the other parent / the admin to decide.
-- The edge function cal-api pushes applied events to each parent's Google/iCloud calendar and
-- turns edits made there back into proposals (cal_propose_as).

-- ───────────────────────────── tables ─────────────────────────────

create table public.cal_settings (
  id int primary key default 1 check (id = 1),
  calendar_name text not null default 'Familie' check (length(calendar_name) between 1 and 60),
  default_approval text not null default 'partner'
    check (default_approval in ('none','partner','admin','partner_or_admin')),
  auto_approve_hours int check (auto_approve_hours is null or auto_approve_hours between 1 and 720),
  sync_pending boolean not null default true,       -- show not-yet-confirmed events in phone calendars
  pending_prefix text not null default '⏳ ',
  admin_override boolean not null default true,     -- admin may decide any pending change
  delete_policy text not null default 'anyone' check (delete_policy in ('anyone','creator')),
  notify_fyi boolean not null default true,         -- push the other parent changes that needed no approval
  week_start int not null default 1 check (week_start in (0,1)),
  default_lang text not null default 'de' check (default_lang in ('de','en','vi')),
  updated_at timestamptz not null default now()
);
insert into public.cal_settings default values;

create table public.cal_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  name text not null check (length(name) between 1 and 40),
  email text,
  role text not null default 'parent' check (role in ('admin','parent','viewer')),
  color text not null default '#3b6ef5' check (color ~ '^#[0-9a-fA-F]{6}$'),
  lang text not null default 'de' check (lang in ('de','en','vi')),
  active boolean not null default true,
  ics_token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  created_at timestamptz not null default now()
);

create table public.cal_categories (
  id uuid primary key default gen_random_uuid(),
  names jsonb not null default '{}'::jsonb,           -- {"de": "...", "en": "...", "vi": "..."}
  icon text not null default '📅',
  color text not null default '#3b6ef5' check (color ~ '^#[0-9a-fA-F]{6}$'),
  approval text not null default 'partner' check (approval in ('none','partner','admin','partner_or_admin')),
  sort int not null default 0,
  archived boolean not null default false
);

create table public.cal_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 200),
  notes text not null default '',
  location text not null default '',
  all_day boolean not null default false,   -- all-day: starts/ends at 00:00 UTC of the date, end exclusive
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  rrule text,                               -- 'FREQ=WEEKLY;BYDAY=MO' (no RRULE: prefix), wall time Europe/Zurich
  exdates timestamptz[] not null default '{}',
  category_id uuid references public.cal_categories(id) on delete set null,
  responsible uuid references public.cal_members(id) on delete set null,
  status text not null default 'active' check (status in ('pending','active','deleted','rejected')),
  created_by uuid references public.cal_members(id) on delete set null,
  updated_by uuid references public.cal_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  rev int not null default 1,
  check (ends_at >= starts_at)
);
create index cal_events_time on public.cal_events (starts_at);

create table public.cal_changes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.cal_events(id) on delete cascade,
  kind text not null check (kind in ('create','update','delete','detach')),
  before jsonb,
  after jsonb,
  proposed_by uuid references public.cal_members(id) on delete set null,
  source text not null default 'app' check (source in ('app','google','apple','admin')),
  source_conn uuid,
  rule text not null,
  status text not null check (status in ('pending','applied','approved','rejected','auto','withdrawn','superseded')),
  decided_by uuid references public.cal_members(id) on delete set null,
  decided_at timestamptz,
  note text,     -- message from the proposer
  reply text,    -- message from whoever decided
  created_at timestamptz not null default now()
);
create index cal_changes_event on public.cal_changes (event_id, created_at desc);
create index cal_changes_pending on public.cal_changes (status) where status = 'pending';

create table public.cal_connections (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.cal_members(id) on delete cascade,
  provider text not null check (provider in ('google','apple')),
  account_label text,
  calendar_id text,           -- Google calendar id / CalDAV collection URL
  creds_enc text,             -- AES-GCM, key in cal_secrets; never readable by clients
  sync_token text,            -- Google nextSyncToken / CalDAV getctag
  status text not null default 'ok' check (status in ('ok','error')),
  last_error text,
  last_sync_at timestamptz,
  sync_lock timestamptz,
  resync boolean not null default false,
  created_at timestamptz not null default now(),
  unique (member_id, provider)
);

create table public.cal_links (
  event_id uuid not null references public.cal_events(id) on delete cascade,
  connection_id uuid not null references public.cal_connections(id) on delete cascade,
  external_id text not null,  -- Google event id / CalDAV href
  etag text,
  pushed_rev int not null default 0,
  gone boolean not null default false,  -- deleted on the phone, waiting for the delete to be decided
  primary key (event_id, connection_id),
  unique (connection_id, external_id)
);

create table public.cal_codes (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('invite','reset')),
  code_hash text not null unique,
  name text,
  role text check (role in ('parent','viewer')),
  member_id uuid references public.cal_members(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.cal_push_subs (
  endpoint text primary key,
  member_id uuid not null references public.cal_members(id) on delete cascade,
  p256dh text not null,
  auth_key text not null,
  fail_count int not null default 0,
  created_at timestamptz not null default now()
);

create table public.cal_secrets (key text primary key, value text not null);
insert into public.cal_secrets (key, value) values
  ('hook_key', encode(extensions.gen_random_bytes(24), 'hex')),
  ('enc_key',  encode(extensions.gen_random_bytes(32), 'base64')),
  ('app_url',  'https://dump.yanikroesti.ch/artifacts/kalender.html');

-- ───────────────────────────── seed ─────────────────────────────

insert into public.cal_categories (names, icon, color, approval, sort) values
  ('{"de":"Kinder","en":"Kids","vi":"Con cái"}',                   '🧒', '#f08a24', 'partner', 1),
  ('{"de":"Familie","en":"Family","vi":"Gia đình"}',               '🏠', '#3b6ef5', 'partner', 2),
  ('{"de":"Ferien & Reisen","en":"Holidays & travel","vi":"Nghỉ lễ & du lịch"}', '✈️', '#14a38b', 'partner', 3),
  ('{"de":"Arzt & Termine","en":"Doctor & appointments","vi":"Bác sĩ & hẹn"}',   '🩺', '#d9467a', 'none', 4),
  ('{"de":"Persönlich","en":"Personal","vi":"Cá nhân"}',            '👤', '#8a63d2', 'none', 5);

-- ───────────────────────────── helpers ─────────────────────────────

create function public.cal_member_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from cal_members where user_id = auth.uid() and active
$$;

create function public.cal_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from cal_members where user_id = auth.uid() and active and role = 'admin')
$$;

-- the stricter of two rules decides (moving an event into or out of a guarded category needs approval)
create function public.cal_rule_for(p_old uuid, p_new uuid, p_create boolean default false) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  d text := (select default_approval from cal_settings where id = 1);
  a text := case when p_create then 'none' else coalesce((select approval from cal_categories where id = p_old), d) end;
  b text := coalesce((select approval from cal_categories where id = p_new), d);
  r text[] := array['none','partner_or_admin','partner','admin'];
begin
  return case when array_position(r, a) > array_position(r, b) then a else b end;
end $$;

create function public.cal_snap(e public.cal_events) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'title', e.title, 'notes', e.notes, 'location', e.location, 'all_day', e.all_day,
    'starts_at', e.starts_at, 'ends_at', e.ends_at, 'rrule', e.rrule, 'exdates', to_jsonb(e.exdates),
    'category_id', e.category_id, 'responsible', e.responsible)
$$;

-- validate + normalise an event payload; p_base supplies fields the payload leaves out
create function public.cal_clean(p_base jsonb, p_data jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  j jsonb := coalesce(p_base, '{}'::jsonb) || coalesce(p_data, '{}'::jsonb);
  v_title text := btrim(coalesce(j->>'title', ''));
  v_start timestamptz; v_end timestamptz; v_rrule text; v_allday boolean;
  v_cat uuid; v_resp uuid; v_ex jsonb;
begin
  if v_title = '' then raise exception 'title required'; end if;
  v_start := (j->>'starts_at')::timestamptz;
  v_end := coalesce((j->>'ends_at')::timestamptz, v_start);
  if v_start is null then raise exception 'start required'; end if;
  if v_end < v_start then v_end := v_start; end if;
  v_allday := coalesce((j->>'all_day')::boolean, false);
  if v_allday then
    v_start := date_trunc('day', v_start at time zone 'UTC') at time zone 'UTC';
    v_end := greatest(date_trunc('day', v_end at time zone 'UTC') at time zone 'UTC', v_start + interval '1 day');
  end if;
  v_rrule := nullif(btrim(regexp_replace(coalesce(j->>'rrule', ''), '^RRULE:', '', 'i')), '');
  if v_rrule is not null and (length(v_rrule) > 300 or v_rrule !~ '^[A-Za-z0-9=;,:+\-]+$' or v_rrule !~* 'FREQ=') then
    raise exception 'invalid repeat rule';
  end if;
  v_cat := nullif(j->>'category_id', '')::uuid;
  if v_cat is not null and not exists (select 1 from cal_categories where id = v_cat) then v_cat := null; end if;
  v_resp := nullif(j->>'responsible', '')::uuid;
  if v_resp is not null and not exists (select 1 from cal_members where id = v_resp) then v_resp := null; end if;
  v_ex := case when jsonb_typeof(j->'exdates') = 'array' then j->'exdates' else '[]'::jsonb end;
  return jsonb_build_object(
    'title', left(v_title, 200),
    'notes', left(coalesce(j->>'notes', ''), 4000),
    'location', left(btrim(coalesce(j->>'location', '')), 300),
    'all_day', v_allday,
    'starts_at', v_start, 'ends_at', v_end,
    'rrule', v_rrule,
    'exdates', coalesce((select jsonb_agg(distinct (x #>> '{}')::timestamptz) from jsonb_array_elements(v_ex) x), '[]'::jsonb),
    'category_id', v_cat, 'responsible', v_resp);
end $$;

create function public.cal_ts_array(j jsonb) returns timestamptz[]
language sql immutable as $$
  select coalesce(array(select (x #>> '{}')::timestamptz from jsonb_array_elements(coalesce(j, '[]'::jsonb)) x), '{}')
$$;

-- an external edit that lost (rejected / superseded / withdrawn) must be overwritten on that phone again
create function public.cal_force_repush(c public.cal_changes) returns void
language sql security definer set search_path = public as $$
  update cal_links set pushed_rev = 0
   where event_id = c.event_id and (c.source_conn is null or connection_id = c.source_conn)
$$;

-- apply a change to the event (the change row's status is set by the caller)
create function public.cal_apply(p_change uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c cal_changes; a jsonb;
begin
  select * into c from cal_changes where id = p_change;
  a := c.after;
  if c.kind = 'create' then
    update cal_events set status = 'active', rev = rev + 1, updated_at = now() where id = c.event_id;
  elsif c.kind = 'update' then
    update cal_events set
      title = a->>'title', notes = a->>'notes', location = a->>'location',
      all_day = (a->>'all_day')::boolean,
      starts_at = (a->>'starts_at')::timestamptz, ends_at = (a->>'ends_at')::timestamptz,
      rrule = a->>'rrule', exdates = cal_ts_array(a->'exdates'),
      category_id = (a->>'category_id')::uuid, responsible = (a->>'responsible')::uuid,
      updated_by = c.proposed_by, updated_at = now(), rev = rev + 1
    where id = c.event_id;
  elsif c.kind = 'delete' then
    update cal_events set status = 'deleted', updated_by = c.proposed_by, updated_at = now(), rev = rev + 1
     where id = c.event_id;
  elsif c.kind = 'detach' then
    -- "only this date": skip the occurrence in the series and add it as its own event
    update cal_events set exdates = array_append(exdates, (a->>'occurrence')::timestamptz),
           updated_at = now(), rev = rev + 1
     where id = c.event_id;
    insert into cal_events (id, title, notes, location, all_day, starts_at, ends_at, category_id, responsible,
                            status, created_by, updated_by)
    values ((a->>'new_id')::uuid, a->>'title', a->>'notes', a->>'location', (a->>'all_day')::boolean,
            (a->>'starts_at')::timestamptz, (a->>'ends_at')::timestamptz,
            (a->>'category_id')::uuid, (a->>'responsible')::uuid, 'active', c.proposed_by, c.proposed_by)
    on conflict (id) do nothing;
  end if;
end $$;

-- undo the visible side of a pending change that will never be applied
create function public.cal_drop(p_change uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare c cal_changes;
begin
  select * into c from cal_changes where id = p_change;
  update cal_changes set status = p_status, decided_at = coalesce(decided_at, now()) where id = p_change;
  if c.kind = 'create' then
    update cal_events set status = 'rejected', rev = rev + 1, updated_at = now() where id = c.event_id;
  elsif c.source_conn is not null then
    perform cal_force_repush(c);
  end if;
end $$;

-- ───────────────────────────── proposing ─────────────────────────────

create function public.cal_propose_as(
  p_member uuid, p_kind text, p_event uuid, p_data jsonb,
  p_note text default null, p_source text default 'app', p_conn uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m cal_members; s cal_settings; e cal_events; pc cal_changes;
  v_rule text; v_before jsonb; v_after jsonb; v_id uuid; v_status text; v_change uuid; v_src text := p_source;
begin
  select * into m from cal_members where id = p_member and active;
  if not found then raise exception 'not a member'; end if;
  if m.role = 'viewer' then raise exception 'viewers cannot edit'; end if;
  select * into s from cal_settings where id = 1;
  if m.role = 'admin' and v_src = 'app' then v_src := 'admin'; end if;

  if p_kind = 'create' then
    v_after := cal_clean(null, p_data);
    v_rule := cal_rule_for(null, (v_after->>'category_id')::uuid, true);
    v_status := case when v_rule = 'none' or m.role = 'admin' then 'applied' else 'pending' end;
    v_id := coalesce(nullif(p_data->>'id', '')::uuid, gen_random_uuid());
    insert into cal_events (id, title, notes, location, all_day, starts_at, ends_at, rrule, exdates,
                            category_id, responsible, status, created_by, updated_by)
    values (v_id, v_after->>'title', v_after->>'notes', v_after->>'location', (v_after->>'all_day')::boolean,
            (v_after->>'starts_at')::timestamptz, (v_after->>'ends_at')::timestamptz, v_after->>'rrule',
            cal_ts_array(v_after->'exdates'), (v_after->>'category_id')::uuid, (v_after->>'responsible')::uuid,
            case when v_status = 'applied' then 'active' else 'pending' end, m.id, m.id);
    insert into cal_changes (event_id, kind, before, after, proposed_by, source, source_conn, rule, status, note,
                             decided_at)
    values (v_id, 'create', null, v_after, m.id, v_src, p_conn, v_rule, v_status, nullif(btrim(p_note), ''),
            case when v_status = 'applied' then now() end)
    returning id into v_change;
    return jsonb_build_object('change_id', v_change, 'event_id', v_id, 'status', v_status);
  end if;

  select * into e from cal_events where id = p_event for update;
  if not found or e.status in ('deleted','rejected') then raise exception 'event not found'; end if;

  -- a pending new event: only its proposer (or the admin) may still reshape it; that edits the proposal in place
  if e.status = 'pending' then
    select * into pc from cal_changes where event_id = e.id and kind = 'create' and status = 'pending'
     order by created_at desc limit 1;
    if pc.proposed_by is distinct from m.id and m.role <> 'admin' then
      raise exception 'pending event: accept or decline it instead';
    end if;
    if p_kind = 'delete' then
      update cal_changes set decided_by = m.id where id = pc.id;
      perform cal_drop(pc.id, 'withdrawn');
      return jsonb_build_object('change_id', pc.id, 'event_id', e.id, 'status', 'withdrawn');
    end if;
    v_after := cal_clean(cal_snap(e), p_data);
    update cal_events set
      title = v_after->>'title', notes = v_after->>'notes', location = v_after->>'location',
      all_day = (v_after->>'all_day')::boolean, starts_at = (v_after->>'starts_at')::timestamptz,
      ends_at = (v_after->>'ends_at')::timestamptz, rrule = v_after->>'rrule',
      exdates = cal_ts_array(v_after->'exdates'), category_id = (v_after->>'category_id')::uuid,
      responsible = (v_after->>'responsible')::uuid, rev = rev + 1, updated_at = now(), updated_by = m.id
    where id = e.id;
    v_rule := cal_rule_for(null, (v_after->>'category_id')::uuid, true);
    if m.role = 'admin' or v_rule = 'none' then
      update cal_changes set after = v_after, rule = v_rule, status = case when m.role = 'admin' and pc.proposed_by <> m.id then 'approved' else 'applied' end,
             decided_by = case when m.role = 'admin' then m.id end, decided_at = now()
       where id = pc.id;
      perform cal_apply(pc.id);
      return jsonb_build_object('change_id', pc.id, 'event_id', e.id, 'status', 'applied');
    end if;
    update cal_changes set after = v_after, rule = v_rule, note = coalesce(nullif(btrim(p_note), ''), note)
     where id = pc.id;
    return jsonb_build_object('change_id', pc.id, 'event_id', e.id, 'status', 'pending');
  end if;

  v_before := cal_snap(e);
  if p_kind = 'update' then
    v_after := cal_clean(v_before, p_data);
    if v_after = cal_clean(null, v_before) then
      return jsonb_build_object('event_id', e.id, 'status', 'unchanged');
    end if;
    v_rule := cal_rule_for(e.category_id, (v_after->>'category_id')::uuid);
  elsif p_kind = 'delete' then
    if s.delete_policy = 'creator' and e.created_by is distinct from m.id and m.role <> 'admin'
       and v_src = 'app' then
      raise exception 'only the person who created it may delete it';
    end if;
    v_after := null;
    v_rule := cal_rule_for(e.category_id, e.category_id);
  elsif p_kind = 'detach' then
    if e.rrule is null then raise exception 'not a repeating event'; end if;
    v_after := cal_clean(v_before - 'rrule' - 'exdates', p_data - 'occurrence' - 'new_id' - 'rrule' - 'exdates')
               || jsonb_build_object('occurrence', (p_data->>'occurrence')::timestamptz,
                                     'new_id', gen_random_uuid(), 'rrule', null);
    if p_data->>'occurrence' is null then raise exception 'occurrence required'; end if;
    v_rule := cal_rule_for(e.category_id, (v_after->>'category_id')::uuid);
  else
    raise exception 'unknown kind %', p_kind;
  end if;

  v_status := case when v_rule = 'none' or m.role = 'admin' then 'applied' else 'pending' end;

  -- a newer proposal replaces older pending ones (a counter-proposal from the other parent included)
  for pc in select * from cal_changes where event_id = e.id and status = 'pending' loop
    perform cal_drop(pc.id, 'superseded');
  end loop;

  insert into cal_changes (event_id, kind, before, after, proposed_by, source, source_conn, rule, status, note,
                           decided_at)
  values (e.id, p_kind, v_before, v_after, m.id, v_src, p_conn, v_rule, v_status, nullif(btrim(p_note), ''),
          case when v_status = 'applied' then now() end)
  returning id into v_change;
  if v_status = 'applied' then perform cal_apply(v_change); end if;
  return jsonb_build_object('change_id', v_change, 'event_id', e.id, 'status', v_status);
end $$;

create function public.cal_propose(p_kind text, p_event uuid, p_data jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m uuid := cal_member_id();
begin
  if v_m is null then raise exception 'not a member'; end if;
  return cal_propose_as(v_m, p_kind, p_event, p_data, p_note, 'app', null);
end $$;

-- ───────────────────────────── deciding ─────────────────────────────

create function public.cal_can_decide(p_member uuid, p_change uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare m cal_members; c cal_changes; s cal_settings;
begin
  select * into m from cal_members where id = p_member and active;
  select * into c from cal_changes where id = p_change;
  select * into s from cal_settings where id = 1;
  if m.id is null or c.id is null or c.status <> 'pending' or m.role = 'viewer' then return false; end if;
  if m.role = 'admin' and (s.admin_override or c.rule in ('admin','partner_or_admin')) then return true; end if;
  if c.proposed_by = m.id then return false; end if;
  return m.role = 'parent' and c.rule in ('partner','partner_or_admin');
end $$;

create function public.cal_decide(p_change uuid, p_approve boolean, p_reply text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m uuid := cal_member_id();
begin
  if not cal_can_decide(v_m, p_change) then raise exception 'you cannot decide this change'; end if;
  update cal_changes set decided_by = v_m, decided_at = now(), reply = nullif(btrim(p_reply), '')
   where id = p_change;
  if p_approve then
    update cal_changes set status = 'approved' where id = p_change;
    perform cal_apply(p_change);
  else
    perform cal_drop(p_change, 'rejected');
  end if;
  return jsonb_build_object('ok', true);
end $$;

create function public.cal_withdraw(p_change uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_m uuid := cal_member_id(); c cal_changes;
begin
  select * into c from cal_changes where id = p_change and status = 'pending';
  if c.id is null or (c.proposed_by is distinct from v_m and not cal_is_admin()) then
    raise exception 'cannot withdraw';
  end if;
  update cal_changes set decided_by = v_m where id = p_change;
  perform cal_drop(p_change, 'withdrawn');
  return jsonb_build_object('ok', true);
end $$;

-- run by cron: pending partner decisions older than the limit go through on their own
create function public.cal_auto_approve() returns int
language plpgsql security definer set search_path = public as $$
declare h int := (select auto_approve_hours from cal_settings where id = 1); c record; n int := 0;
begin
  if h is null then return 0; end if;
  for c in select id from cal_changes
            where status = 'pending' and rule in ('partner','partner_or_admin')
              and created_at < now() - make_interval(hours => h)
            order by created_at loop
    update cal_changes set status = 'auto', decided_at = now() where id = c.id;
    perform cal_apply(c.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- admin: undo an applied change by applying its inverse right away
create function public.cal_revert(p_change uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_m uuid := cal_member_id(); c cal_changes; e cal_events;
begin
  if not cal_is_admin() then raise exception 'admin only'; end if;
  select * into c from cal_changes where id = p_change and status in ('applied','approved','auto');
  if c.id is null then raise exception 'nothing to revert'; end if;
  select * into e from cal_events where id = c.event_id;
  if c.kind = 'create' then
    return cal_propose_as(v_m, 'delete', c.event_id, null, 'revert', 'app', null);
  elsif c.kind = 'update' then
    return cal_propose_as(v_m, 'update', c.event_id, c.before, 'revert', 'app', null);
  elsif c.kind = 'delete' then
    update cal_events set status = 'active', rev = rev + 1, updated_at = now(), updated_by = v_m where id = c.event_id;
    insert into cal_changes (event_id, kind, before, after, proposed_by, source, rule, status, note, decided_at)
    values (c.event_id, 'create', null, cal_snap(e), v_m, 'admin', 'none', 'applied', 'revert', now());
    return jsonb_build_object('ok', true);
  elsif c.kind = 'detach' then
    update cal_events set exdates = array_remove(exdates, (c.after->>'occurrence')::timestamptz),
           rev = rev + 1, updated_at = now() where id = c.event_id;
    update cal_events set status = 'deleted', rev = rev + 1, updated_at = now() where id = (c.after->>'new_id')::uuid;
    insert into cal_changes (event_id, kind, before, after, proposed_by, source, rule, status, note, decided_at)
    values (c.event_id, 'update', c.after, c.before, v_m, 'admin', 'none', 'applied', 'revert', now());
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('ok', false);
end $$;

-- ───────────────────────────── me / admin ─────────────────────────────

-- first sign-in of the owner of this Supabase project (app_config.owner_email) creates the admin
create function public.cal_me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare m cal_members; v_email text := lower(auth.jwt()->>'email');
begin
  if auth.uid() is null then return null; end if;
  select * into m from cal_members where user_id = auth.uid();
  if m.id is null and not exists (select 1 from cal_members where role = 'admin')
     and v_email = (select lower(owner_email) from app_config limit 1) then
    insert into cal_members (user_id, name, email, role, color, lang)
    values (auth.uid(), 'Admin', v_email, 'admin', '#475569', 'de') returning * into m;
  end if;
  if m.id is null or not m.active then return jsonb_build_object('member', null); end if;
  return jsonb_build_object('member', jsonb_build_object(
    'id', m.id, 'name', m.name, 'role', m.role, 'color', m.color, 'lang', m.lang, 'email', m.email,
    'ics_token', m.ics_token));
end $$;

create function public.cal_set_my_lang(p_lang text) returns void
language sql security definer set search_path = public as $$
  update cal_members set lang = p_lang where id = cal_member_id() and p_lang in ('de','en','vi')
$$;

create function public.cal_new_ics_token() returns text
language sql security definer set search_path = public as $$
  update cal_members set ics_token = encode(extensions.gen_random_bytes(18), 'hex')
   where id = cal_member_id() returning ics_token
$$;

-- codes are shown once; only their hash is kept
create function public.cal_make_code(p_kind text, p_name text, p_role text, p_member uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_code text;
begin
  if not cal_is_admin() then raise exception 'admin only'; end if;
  v_code := substr(translate(upper(encode(gen_random_bytes(18), 'base64')), '+/=0O1IL', ''), 1, 8);
  insert into cal_codes (kind, code_hash, name, role, member_id, expires_at)
  values (p_kind, encode(digest(v_code, 'sha256'), 'hex'), nullif(btrim(p_name), ''),
          case when p_kind = 'invite' then coalesce(p_role, 'parent') end,
          case when p_kind = 'reset' then p_member end,
          now() + case when p_kind = 'invite' then interval '14 days' else interval '2 days' end);
  return substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4);
end $$;

create function public.cal_admin_members() returns setof jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', m.id, 'name', m.name, 'email', m.email, 'role', m.role, 'color', m.color,
         'lang', m.lang, 'active', m.active, 'created_at', m.created_at,
         'connections', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'provider', c.provider,
              'account_label', c.account_label, 'status', c.status, 'last_error', c.last_error,
              'last_sync_at', c.last_sync_at)) from cal_connections c where c.member_id = m.id), '[]'::jsonb))
  from cal_members m where cal_is_admin() order by m.created_at
$$;

create function public.cal_admin_codes() returns setof jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'kind', kind, 'name', name, 'role', role, 'member_id', member_id,
         'expires_at', expires_at, 'used_at', used_at, 'created_at', created_at)
  from cal_codes where cal_is_admin() and (used_at is null and expires_at > now()) order by created_at desc
$$;

create function public.cal_admin_google() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when cal_is_admin() then jsonb_build_object(
    'client_id', (select value from cal_secrets where key = 'google_client_id'),
    'has_secret', exists (select 1 from cal_secrets where key = 'google_client_secret'),
    'redirect_uri', 'https://vcglqoqtcsiqfjutizib.supabase.co/functions/v1/cal-api/google/callback') end
$$;

create function public.cal_admin_set_google(p_client_id text, p_client_secret text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not cal_is_admin() then raise exception 'admin only'; end if;
  if nullif(btrim(p_client_id), '') is not null then
    insert into cal_secrets values ('google_client_id', btrim(p_client_id))
      on conflict (key) do update set value = excluded.value;
  end if;
  if nullif(btrim(p_client_secret), '') is not null then
    insert into cal_secrets values ('google_client_secret', btrim(p_client_secret))
      on conflict (key) do update set value = excluded.value;
  end if;
end $$;

create function public.cal_save_push(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m uuid := cal_member_id();
begin
  if v_m is null then raise exception 'not a member'; end if;
  insert into cal_push_subs (endpoint, member_id, p256dh, auth_key) values (p_endpoint, v_m, p_p256dh, p_auth)
  on conflict (endpoint) do update set member_id = v_m, p256dh = excluded.p256dh, auth_key = excluded.auth_key,
    fail_count = 0;
end $$;

create function public.cal_drop_push(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from cal_push_subs where endpoint = p_endpoint and member_id = cal_member_id()
$$;

-- ───────────────────────────── sync helpers (service role only) ─────────────────────────────

create function public.cal_claim(p_conn uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  update cal_connections set sync_lock = now() + interval '3 minutes', resync = false
   where id = p_conn and (sync_lock is null or sync_lock < now())
  returning true into ok;
  if ok then return true; end if;
  update cal_connections set resync = true where id = p_conn;
  return false;
end $$;

create function public.cal_release(p_conn uuid) returns boolean
language sql security definer set search_path = public as $$
  update cal_connections set sync_lock = null where id = p_conn returning resync
$$;

-- what the phone calendar of one connection should change: upserts and deletes
create function public.cal_sync_plan(p_conn uuid) returns table (
  action text, event_id uuid, external_id text, etag text, gone boolean, event jsonb)
language sql stable security definer set search_path = public as $$
  with s as (select sync_pending from cal_settings where id = 1),
  wanted as (
    select e.* from cal_events e, s
     where e.status = 'active' or (e.status = 'pending' and s.sync_pending)
  )
  select 'upsert', w.id, l.external_id, l.etag, coalesce(l.gone, false),
         cal_snap(w) || jsonb_build_object('id', w.id, 'status', w.status, 'rev', w.rev,
           'category', (select jsonb_build_object('names', c.names, 'icon', c.icon) from cal_categories c where c.id = w.category_id),
           'responsible_name', (select name from cal_members where id = w.responsible))
    from wanted w
    left join cal_links l on l.event_id = w.id and l.connection_id = p_conn
   where l.event_id is null or l.pushed_rev < w.rev
  union all
  select 'delete', l.event_id, l.external_id, l.etag, l.gone, null
    from cal_links l
   where l.connection_id = p_conn and l.event_id not in (select id from wanted)
$$;

-- ───────────────────────────── security ─────────────────────────────

alter table public.cal_settings enable row level security;
alter table public.cal_members enable row level security;
alter table public.cal_categories enable row level security;
alter table public.cal_events enable row level security;
alter table public.cal_changes enable row level security;
alter table public.cal_connections enable row level security;
alter table public.cal_links enable row level security;
alter table public.cal_codes enable row level security;
alter table public.cal_push_subs enable row level security;
alter table public.cal_secrets enable row level security;

revoke all on public.cal_settings, public.cal_members, public.cal_categories, public.cal_events, public.cal_changes,
  public.cal_connections, public.cal_links, public.cal_codes, public.cal_push_subs, public.cal_secrets
  from anon, authenticated;

grant select on public.cal_settings, public.cal_categories, public.cal_events, public.cal_changes to authenticated;
grant select (id, name, role, color, lang, active, created_at) on public.cal_members to authenticated;
grant select (id, member_id, provider, account_label, calendar_id, status, last_error, last_sync_at, created_at)
  on public.cal_connections to authenticated;
grant update (calendar_name, default_approval, auto_approve_hours, sync_pending, pending_prefix, admin_override,
  delete_policy, notify_fyi, week_start, default_lang, updated_at) on public.cal_settings to authenticated;
grant insert, update, delete on public.cal_categories to authenticated;
grant update (name, role, color, lang, active) on public.cal_members to authenticated;

create policy cal_settings_read on public.cal_settings for select to authenticated using (cal_member_id() is not null);
create policy cal_settings_admin on public.cal_settings for update to authenticated using (cal_is_admin()) with check (cal_is_admin());
create policy cal_members_read on public.cal_members for select to authenticated using (cal_member_id() is not null);
create policy cal_members_admin on public.cal_members for update to authenticated using (cal_is_admin()) with check (cal_is_admin());
create policy cal_categories_read on public.cal_categories for select to authenticated using (cal_member_id() is not null);
create policy cal_categories_ins on public.cal_categories for insert to authenticated with check (cal_is_admin());
create policy cal_categories_upd on public.cal_categories for update to authenticated using (cal_is_admin()) with check (cal_is_admin());
create policy cal_categories_del on public.cal_categories for delete to authenticated using (cal_is_admin());
create policy cal_events_read on public.cal_events for select to authenticated using (cal_member_id() is not null);
create policy cal_changes_read on public.cal_changes for select to authenticated using (cal_member_id() is not null);
create policy cal_connections_read on public.cal_connections for select to authenticated
  using (member_id = cal_member_id() or cal_is_admin());

-- internal functions: not callable from the browser
revoke execute on function public.cal_propose_as(uuid, text, uuid, jsonb, text, text, uuid),
  public.cal_apply(uuid), public.cal_drop(uuid, text), public.cal_force_repush(public.cal_changes),
  public.cal_auto_approve(), public.cal_claim(uuid), public.cal_release(uuid), public.cal_sync_plan(uuid),
  public.cal_can_decide(uuid, uuid), public.cal_clean(jsonb, jsonb), public.cal_rule_for(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke execute on function public.cal_me(), public.cal_propose(text, uuid, jsonb, text),
  public.cal_decide(uuid, boolean, text), public.cal_withdraw(uuid), public.cal_revert(uuid),
  public.cal_set_my_lang(text), public.cal_new_ics_token(), public.cal_make_code(text, text, text, uuid),
  public.cal_admin_members(), public.cal_admin_codes(), public.cal_admin_google(),
  public.cal_admin_set_google(text, text), public.cal_save_push(text, text, text), public.cal_drop_push(text)
  from public, anon;

-- helpers used by RLS policies stay callable for signed-in users only; the trigger function for nobody
revoke execute on function public.cal_member_id(), public.cal_is_admin() from public, anon;
revoke execute on function public.cal_snap(public.cal_events), public.cal_ts_array(jsonb) from public, anon;
alter function public.cal_snap(public.cal_events) set search_path = public;
alter function public.cal_ts_array(jsonb) set search_path = public;

-- ───────────────────────────── live updates + hooks ─────────────────────────────

alter publication supabase_realtime add table public.cal_events, public.cal_changes;

-- every change (new proposal or a decision) pings the edge function: push notifications + phone calendar sync
create function public.cal_hook() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://vcglqoqtcsiqfjutizib.supabase.co/functions/v1/cal-api/hook',
    headers := jsonb_build_object('content-type', 'application/json',
                 'x-cal-key', (select value from cal_secrets where key = 'hook_key')),
    body := jsonb_build_object('change_id', new.id, 'op', tg_op),
    timeout_milliseconds := 60000);
  return null;
end $$;

create trigger cal_changes_hook after insert or update of status, "after" on public.cal_changes
  for each row execute function public.cal_hook();
revoke execute on function public.cal_hook() from public, anon, authenticated;

select cron.schedule('cal-sync', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://vcglqoqtcsiqfjutizib.supabase.co/functions/v1/cal-api/cron',
    headers := jsonb_build_object('content-type', 'application/json',
                 'x-cal-key', (select value from public.cal_secrets where key = 'hook_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000);
$$);
