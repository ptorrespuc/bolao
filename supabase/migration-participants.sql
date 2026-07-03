-- ============================================================
-- Migração: participantes cadastrados pelo admin (sem auto-cadastro)
-- Rode UMA VEZ no SQL Editor se você já tinha criado as tabelas antes.
-- (Instalações novas já vêm assim pelo schema.sql — não precisa rodar.)
-- ============================================================

-- 1) e-mail no participante + user_id opcional (preenchido no 1º acesso)
alter table participants add column if not exists email text;
alter table participants alter column user_id drop not null;

-- se a FK de user_id era "on delete cascade", troca para "set null"
alter table participants drop constraint if exists participants_user_id_fkey;
alter table participants
  add constraint participants_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

-- (opcional) se havia participantes de teste sem e-mail, limpe antes de exigir e-mail:
delete from participants where email is null;

alter table participants alter column email set not null;

create unique index if not exists participants_group_email_idx
  on participants (group_id, lower(email));

-- 2) remove o auto-cadastro
drop policy if exists "insert own participant" on participants;
drop policy if exists "update own participant" on participants;

-- 3) função que vincula o login ao cadastro do admin (casa pelo e-mail)
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
