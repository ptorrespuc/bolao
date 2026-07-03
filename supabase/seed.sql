-- ============================================================
-- Bolão da Copa — Dados de exemplo (opcional)
-- Rode DEPOIS do schema.sql. Cria os times e um chaveamento de exemplo
-- (oitavas já jogadas, quartas em aberto para apostar).
-- Ajuste/edite tudo depois pelo admin.html.
-- ============================================================

insert into teams (code, name, flag) values
  ('BRA', 'Brasil',          '🇧🇷'),
  ('MEX', 'México',          '🇲🇽'),
  ('ARG', 'Argentina',       '🇦🇷'),
  ('JPN', 'Japão',           '🇯🇵'),
  ('FRA', 'França',          '🇫🇷'),
  ('MAR', 'Marrocos',        '🇲🇦'),
  ('POR', 'Portugal',        '🇵🇹'),
  ('SEN', 'Senegal',         '🇸🇳'),
  ('GER', 'Alemanha',        '🇩🇪'),
  ('KOR', 'Coreia do Sul',   '🇰🇷'),
  ('ESP', 'Espanha',         '🇪🇸'),
  ('USA', 'Estados Unidos',  '🇺🇸'),
  ('ENG', 'Inglaterra',      '🏴'),
  ('COL', 'Colômbia',        '🇨🇴'),
  ('NED', 'Holanda',         '🇳🇱'),
  ('URU', 'Uruguai',         '🇺🇾')
on conflict (code) do nothing;

-- ---------- OITAVAS (já jogadas) ----------
-- Observação: nos empates (pênaltis) informamos o winner; o trigger marca decided='penalties'.
insert into games (phase, team_a, team_b, kickoff, score_a, score_b, decided, winner, sort) values
  ('oitavas', 'BRA', 'MEX', '2026-06-30 13:00-03', 2, 1, 'regular',  'BRA', 1),
  ('oitavas', 'ARG', 'JPN', '2026-06-30 17:00-03', 1, 0, 'regular',  'ARG', 2),
  ('oitavas', 'FRA', 'MAR', '2026-07-01 13:00-03', 1, 1, 'penalties','MAR', 3),
  ('oitavas', 'POR', 'SEN', '2026-07-01 17:00-03', 3, 1, 'regular',  'POR', 4),
  ('oitavas', 'GER', 'KOR', '2026-07-02 13:00-03', 2, 0, 'regular',  'GER', 5),
  ('oitavas', 'ESP', 'USA', '2026-07-02 17:00-03', 1, 1, 'penalties','ESP', 6),
  ('oitavas', 'ENG', 'COL', '2026-07-03 13:00-03', 2, 1, 'regular',  'ENG', 7),
  ('oitavas', 'NED', 'URU', '2026-07-03 17:00-03', 3, 0, 'regular',  'NED', 8);

-- ---------- QUARTAS (em aberto — dá pra apostar até o kickoff) ----------
insert into games (phase, team_a, team_b, kickoff, sort) values
  ('quartas', 'BRA', 'ARG', '2026-07-09 15:00-03', 11),
  ('quartas', 'MAR', 'POR', '2026-07-09 19:00-03', 12),
  ('quartas', 'GER', 'ESP', '2026-07-10 15:00-03', 13),
  ('quartas', 'ENG', 'NED', '2026-07-10 19:00-03', 14);

-- ---------- SEMI / FINAL (times a definir) ----------
insert into games (phase, team_a, team_b, kickoff, sort) values
  ('semi',  null, null, '2026-07-14 16:00-03', 21),
  ('semi',  null, null, '2026-07-15 16:00-03', 22),
  ('final', null, null, '2026-07-19 16:00-03', 31);

-- ---------- Um grupo de exemplo ----------
insert into groups (code, name) values ('teste', 'Bolão de Teste')
on conflict (code) do nothing;
