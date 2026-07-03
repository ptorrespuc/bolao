-- ============================================================
-- Bolão da Copa — Reset de jogos + Oitavas
-- Rode no SQL Editor do Supabase (New query → cole TUDO → Run).
--
-- ATENÇÃO: apaga TODOS os jogos atuais e os palpites ligados a eles
-- (começo limpo). Times NÃO são apagados.
-- Horários no fuso de Brasília (-03).
-- ============================================================

-- 1) Times que ainda não existem (não mexe nos existentes)
insert into teams (code, name, flag) values
  ('NOR', 'Noruega',  '🇳🇴'),
  ('CAN', 'Canadá',   '🇨🇦'),
  ('PAR', 'Paraguai', '🇵🇾'),
  ('BEL', 'Bélgica',  '🇧🇪'),
  ('EGY', 'Egito',    '🇪🇬')
on conflict (code) do nothing;

-- 2) Limpa os jogos (os palpites vão junto — on delete cascade)
delete from games;

-- 3) Oitavas (em ordem cronológica)
insert into games (phase, team_a, team_b, kickoff, sort) values
  ('oitavas', 'CAN', 'MAR', '2026-07-04 14:00-03', 1),  -- Canadá x Marrocos
  ('oitavas', 'PAR', 'FRA', '2026-07-04 18:00-03', 2),  -- Paraguai x França
  ('oitavas', 'BRA', 'NOR', '2026-07-05 17:00-03', 3),  -- Brasil x Noruega
  ('oitavas', 'MEX', 'ENG', '2026-07-05 21:00-03', 4),  -- México x Inglaterra
  ('oitavas', 'POR', 'ESP', '2026-07-06 16:00-03', 5),  -- Portugal x Espanha
  ('oitavas', 'USA', 'BEL', '2026-07-06 21:00-03', 6),  -- Estados Unidos x Bélgica
  ('oitavas', 'ARG', 'EGY', '2026-07-07 13:00-03', 7);  -- Argentina x Egito
