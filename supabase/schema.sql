-- ============================================================
-- Bolão da Copa — Schema
-- Rode no Supabase: SQL Editor → New query → cole TUDO → Run
-- ============================================================
-- Modelo:
--  · Jogos e resultados são GLOBAIS (uma só Copa) — o admin lança 1x.
--  · Grupos isolam participantes, palpites e ranking (não se misturam).
--  · Trava por jogo: só dá pra apostar enquanto game.kickoff > now().
-- ============================================================

-- ---------- ADMINS (quem gerencia jogos/times/grupos/resultados) ----------
create table if not exists admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

-- ---------- TIMES (seleções) ----------
create table if not exists teams (
  id         uuid primary key default gen_random_uuid(),
  code       text unique not null,        -- ex.: BRA
  name       text not null,               -- ex.: Brasil
  flag       text not null default '',    -- emoji da bandeira (opcional)
  created_at timestamptz not null default now()
);

-- ---------- JOGOS (globais) ----------
create table if not exists games (
  id         uuid primary key default gen_random_uuid(),
  phase      text not null default 'oitavas',   -- oitavas|quartas|semi|final
  team_a     text references teams(code),        -- null = "A definir"
  team_b     text references teams(code),
  kickoff    timestamptz not null,               -- início da partida (TRAVA)
  score_a    int,
  score_b    int,
  decided    text,                               -- regular|penalties
  winner     text references teams(code),        -- code do vencedor
  played     boolean not null default false,
  sort       int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- GRUPOS (cada bolão) ----------
create table if not exists groups (
  id         uuid primary key default gen_random_uuid(),
  code       text unique not null,   -- slug da URL (?g=trabalho)
  name       text not null,
  created_at timestamptz not null default now()
);

-- ---------- PARTICIPANTES (cadastrados pelo admin; vinculados no 1º login) ----------
create table if not exists participants (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references groups(id) on delete cascade,
  email        text not null,                                    -- cadastrado pelo admin
  display_name text not null,
  user_id      uuid references auth.users(id) on delete set null, -- preenchido no 1º acesso
  created_at   timestamptz not null default now(),
  unique (group_id, user_id)
);
-- um e-mail só pode estar uma vez em cada grupo (case-insensitive)
create unique index if not exists participants_group_email_idx
  on participants (group_id, lower(email));

-- ---------- PALPITES ----------
create table if not exists bets (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  game_id        uuid not null references games(id) on delete cascade,
  score_a        int not null,
  score_b        int not null,
  advances       text references teams(code),   -- quem avança no empate (knockout)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (participant_id, game_id)
);

-- ============================================================
-- TRIGGERS
-- ============================================================

-- updated_at genérico
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_bets_updated on bets;
create trigger trg_bets_updated before update on bets
  for each row execute function set_updated_at();

-- Ao lançar o placar, calcula vencedor e marca "played".
-- Empate: mantém o winner informado pelo admin (quem passou na prorrogação).
create or replace function games_set_result()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  if new.score_a is not null and new.score_b is not null then
    new.played = true;
    if new.score_a > new.score_b then
      new.winner  = new.team_a;
      new.decided = coalesce(new.decided, 'regular');
    elsif new.score_b > new.score_a then
      new.winner  = new.team_b;
      new.decided = coalesce(new.decided, 'regular');
    else
      new.decided = 'penalties';   -- flag interna: empate no tempo normal → foi p/ prorrogação
      -- new.winner deve ser informado pelo admin (quem passou)
    end if;
  else
    new.played  = false;
    new.winner  = null;
  end if;
  return new;
end; $$;

drop trigger if exists trg_games_result on games;
create trigger trg_games_result before insert or update on games
  for each row execute function games_set_result();

-- ============================================================
-- PONTUAÇÃO (fonte única — igual ao protótipo)
--  placar exato = 10 · acertou o vencedor = 7
--  previu empate (jogo foi à prorrogação) = 5 · senão 0
-- ============================================================
create or replace function bet_points(
  b_score_a int, b_score_b int, b_advances text,
  g_score_a int, g_score_b int, g_winner text, g_decided text,
  g_team_a text, g_team_b text
) returns int language sql immutable as $$
  select case
    when g_score_a is null or g_score_b is null then 0
    when b_score_a = g_score_a and b_score_b = g_score_b then 10
    when (case when b_score_a = b_score_b then b_advances
               when b_score_a > b_score_b then g_team_a
               else g_team_b end) = g_winner then 7
    when b_score_a = b_score_b and g_decided = 'penalties' then 5
    else 0
  end;
$$;

-- pontos por palpite
create or replace view v_bet_points with (security_invoker = on) as
  select b.id as bet_id, b.participant_id, b.game_id,
         bet_points(b.score_a, b.score_b, b.advances,
                    g.score_a, g.score_b, g.winner, g.decided,
                    g.team_a, g.team_b) as points
  from bets b
  join games g on g.id = b.game_id;

-- ranking agregado por participante (dentro do grupo)
create or replace view v_ranking with (security_invoker = on) as
  select p.group_id, p.id as participant_id, p.user_id, p.display_name,
         coalesce(sum(vp.points), 0)::int as points,
         count(vp.bet_id) as bets_count
  from participants p
  left join v_bet_points vp on vp.participant_id = p.id
  group by p.group_id, p.id, p.user_id, p.display_name;

-- ============================================================
-- RLS (Row Level Security)
-- ============================================================
alter table admins       enable row level security;
alter table teams        enable row level security;
alter table games        enable row level security;
alter table groups       enable row level security;
alter table participants enable row level security;
alter table bets         enable row level security;

-- helpers (security definer → não recursam nas policies)
create or replace function is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins a where a.user_id = auth.uid());
$$;

create or replace function my_group_ids() returns setof uuid
  language sql stable security definer set search_path = public as $$
  select group_id from participants where user_id = auth.uid();
$$;

-- ---------- admins: cada um lê só a própria linha (client não escreve) ----------
drop policy if exists "read own admin row" on admins;
create policy "read own admin row" on admins for select using (user_id = auth.uid());

-- ---------- teams / games / groups: leitura pública, escrita só admin ----------
drop policy if exists "public read teams" on teams;
create policy "public read teams" on teams for select using (true);
drop policy if exists "admin write teams" on teams;
create policy "admin write teams" on teams for all using (is_admin()) with check (is_admin());

drop policy if exists "public read games" on games;
create policy "public read games" on games for select using (true);
drop policy if exists "admin write games" on games;
create policy "admin write games" on games for all using (is_admin()) with check (is_admin());

drop policy if exists "public read groups" on groups;
create policy "public read groups" on groups for select using (true);
drop policy if exists "admin write groups" on groups;
create policy "admin write groups" on groups for all using (is_admin()) with check (is_admin());

-- ---------- participants: só vê os do(s) seu(s) grupo(s); quem gerencia é o admin ----------
-- (sem auto-cadastro: o cliente não insere participantes)
drop policy if exists "read participants of my groups" on participants;
create policy "read participants of my groups" on participants for select
  using (group_id in (select my_group_ids()) or is_admin());

-- remove políticas antigas de auto-cadastro, se existirem
drop policy if exists "insert own participant" on participants;
drop policy if exists "update own participant" on participants;

drop policy if exists "admin manage participants" on participants;
create policy "admin manage participants" on participants for all
  using (is_admin()) with check (is_admin());

-- Vincula o usuário logado ao cadastro feito pelo admin (casa pelo e-mail do login).
-- Retorna a linha do participante, ou nada se o e-mail não estiver cadastrado no grupo.
create or replace function claim_participant(p_group uuid)
returns participants
language plpgsql security definer set search_path = public as $$
declare
  em  text := lower(auth.jwt() ->> 'email');
  rec participants;
begin
  if em is null then return null; end if;
  -- já vinculado neste grupo?
  select * into rec from participants
    where group_id = p_group and user_id = auth.uid();
  if found then return rec; end if;
  -- vincula por e-mail (linha pré-cadastrada pelo admin, ainda sem user_id)
  update participants
    set user_id = auth.uid()
    where group_id = p_group and lower(email) = em and user_id is null
    returning * into rec;
  return rec;  -- null quando o e-mail não está cadastrado no grupo
end; $$;

grant execute on function claim_participant(uuid) to authenticated;

-- ---------- bets: lê palpites do(s) seu(s) grupo(s); insere/edita os próprios ANTES do kickoff ----------
-- Os MEUS palpites sempre; os dos colegas de grupo só depois do kickoff
-- (evita espiar palpites alheios pela API antes do jogo).
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
    and exists (select 1 from games g where g.id = game_id and g.kickoff > now())
  );

drop policy if exists "update own bet before kickoff" on bets;
create policy "update own bet before kickoff" on bets for update
  using (
    participant_id in (select id from participants where user_id = auth.uid())
    and exists (select 1 from games g where g.id = game_id and g.kickoff > now())
  )
  with check (
    participant_id in (select id from participants where user_id = auth.uid())
    and exists (select 1 from games g where g.id = game_id and g.kickoff > now())
  );

-- ============================================================
-- GRANTS (anon = visitante; authenticated = logado)
-- ============================================================
grant select on teams, games, groups to anon, authenticated;
grant select, insert, update, delete on teams, games, groups to authenticated;
grant select, insert, update, delete on participants, bets to authenticated;
grant select on v_ranking, v_bet_points to authenticated;
