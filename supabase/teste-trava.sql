-- ============================================================
-- TESTE da trava de kickoff (RLS) — não deixa rastro no banco.
-- Rode no Supabase: SQL Editor → New query → cole TUDO → Run.
--
-- O script simula um apostador logado (mesmo contexto das chamadas
-- do app) e tenta:
--   1) criar palpite em jogo que JÁ começou    → deve ser RECUSADO
--   2) criar palpite em jogo ainda por começar → deve ser ACEITO
--   3) alterar o palpite depois que o jogo começa → deve ser BLOQUEADO
--
-- Ele cria 2 jogos temporários para o teste e os apaga no final
-- (os palpites de teste caem junto, por cascade).
-- Resultado esperado: as três linhas com "OK".
-- ============================================================
create temp table _resultado (teste text, resultado text) on commit drop;

do $$
declare
  v_part participants%rowtype;
  v_ta text; v_tb text;
  v_past uuid; v_fut uuid;
  v_rows int;
  v_r1 text; v_r2 text; v_r3 text;
begin
  -- um participante que já entrou no app (login vinculado)
  select * into v_part from participants where user_id is not null limit 1;
  if v_part.id is null then
    raise exception 'Nenhum participante com login vinculado. Entre no app com um jogador e rode de novo.';
  end if;

  -- dois times quaisquer para os jogos de teste
  select code into v_ta from teams order by code limit 1;
  select code into v_tb from teams order by code offset 1 limit 1;

  -- jogos de teste: um que "já começou" e um futuro
  insert into games (phase, team_a, team_b, kickoff, sort)
    values ('oitavas', v_ta, v_tb, now() - interval '1 hour', 991) returning id into v_past;
  insert into games (phase, team_a, team_b, kickoff, sort)
    values ('oitavas', v_ta, v_tb, now() + interval '1 hour', 992) returning id into v_fut;

  -- "vira" o apostador logado: mesmo JWT/role que o app usa
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_part.user_id, 'role', 'authenticated', 'email', v_part.email)::text,
    true);
  set local role authenticated;

  -- TESTE 1: apostar em jogo que JÁ começou (deve falhar com RLS 42501)
  begin
    insert into bets (participant_id, game_id, score_a, score_b)
      values (v_part.id, v_past, 1, 0);
    v_r1 := 'FALHOU — o banco ACEITOU aposta após o início!';
  exception when insufficient_privilege then
    v_r1 := 'OK — o banco recusou (RLS 42501)';
  end;

  -- TESTE 2: apostar em jogo futuro (deve aceitar)
  begin
    insert into bets (participant_id, game_id, score_a, score_b)
      values (v_part.id, v_fut, 2, 1);
    v_r2 := 'OK — o banco aceitou normalmente';
  exception when others then
    v_r2 := 'FALHOU — recusou aposta antes do início: ' || sqlerrm;
  end;

  -- TESTE 3: o jogo "começa" e o apostador tenta ALTERAR o palpite
  reset role;                     -- volta a admin para mover o relógio do jogo
  update games set kickoff = now() - interval '1 minute' where id = v_fut;
  set local role authenticated;   -- vira o apostador de novo
  update bets set score_a = 9, score_b = 9
    where participant_id = v_part.id and game_id = v_fut;
  get diagnostics v_rows = row_count;
  v_r3 := case when v_rows = 0
    then 'OK — alteração bloqueada (0 linhas alteradas)'
    else 'FALHOU — conseguiu alterar o palpite após o início!' end;

  -- limpeza: apaga só o que o teste criou
  reset role;
  delete from games where id in (v_past, v_fut);

  insert into _resultado values
    ('1. Apostar após o início do jogo',   v_r1),
    ('2. Apostar antes do início',         v_r2),
    ('3. Alterar palpite após o início',   v_r3);
end $$;

select * from _resultado;
