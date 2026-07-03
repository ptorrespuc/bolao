-- ============================================================
-- Correção: reaplica as policies de participants/bets
-- Rode no Supabase: SQL Editor → New query → cole TUDO → Run
-- Pode rodar quantas vezes quiser (idempotente).
--
-- Corrige:
--  · "new row violates row-level security policy for table bets"
--    quando as policies do banco estão desatualizadas/incompletas.
--  · Privacidade: palpites dos OUTROS só ficam visíveis depois
--    do kickoff (antes, dava para ler via API mesmo com a UI escondendo).
-- ============================================================

-- ---------- ADMINS (a tabela precisa existir antes das funções/policies) ----------
create table if not exists admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);
alter table admins enable row level security;
drop policy if exists "read own admin row" on admins;
create policy "read own admin row" on admins for select using (user_id = auth.uid());

-- ---------- helpers ----------
create or replace function is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins a where a.user_id = auth.uid());
$$;

create or replace function my_group_ids() returns setof uuid
  language sql stable security definer set search_path = public as $$
  select group_id from participants where user_id = auth.uid();
$$;

-- ---------- participants ----------
drop policy if exists "read participants of my groups" on participants;
create policy "read participants of my groups" on participants for select
  using (group_id in (select my_group_ids()) or is_admin());

drop policy if exists "insert own participant" on participants;
drop policy if exists "update own participant" on participants;

drop policy if exists "admin manage participants" on participants;
create policy "admin manage participants" on participants for all
  using (is_admin()) with check (is_admin());

-- ---------- claim_participant (vincula login ao cadastro do admin) ----------
create or replace function claim_participant(p_group uuid)
returns participants
language plpgsql security definer set search_path = public as $$
declare
  em  text := lower(auth.jwt() ->> 'email');
  rec participants;
begin
  if em is null then return null; end if;
  select * into rec from participants
    where group_id = p_group and user_id = auth.uid();
  if found then return rec; end if;
  update participants
    set user_id = auth.uid()
    where group_id = p_group and lower(email) = em and user_id is null
    returning * into rec;
  return rec;
end; $$;

grant execute on function claim_participant(uuid) to authenticated;

-- ---------- bets ----------
-- Leitura: os MEUS palpites sempre; os dos colegas de grupo só após o kickoff.
drop policy if exists "read bets of my groups" on bets;
create policy "read bets of my groups" on bets for select
  using (
    is_admin()
    or participant_id in (select id from participants where user_id = auth.uid())
    or (participant_id in (select id from participants)   -- RLS já limita ao meu grupo
        and exists (select 1 from games g where g.id = bets.game_id and g.kickoff <= now()))
  );

drop policy if exists "insert own bet before kickoff" on bets;
create policy "insert own bet before kickoff" on bets for insert
  with check (
    participant_id in (select id from participants where user_id = auth.uid())
    and exists (select 1 from games g where g.id = bets.game_id and g.kickoff > now())
  );

drop policy if exists "update own bet before kickoff" on bets;
create policy "update own bet before kickoff" on bets for update
  using (
    participant_id in (select id from participants where user_id = auth.uid())
    and exists (select 1 from games g where g.id = bets.game_id and g.kickoff > now())
  )
  with check (
    participant_id in (select id from participants where user_id = auth.uid())
    and exists (select 1 from games g where g.id = bets.game_id and g.kickoff > now())
  );

-- ---------- grants ----------
grant select on teams, games, groups to anon, authenticated;
grant select, insert, update, delete on participants, bets to authenticated;
grant select on v_ranking, v_bet_points to authenticated;
