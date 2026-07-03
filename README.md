# Bolão da Copa

App de bolão (palpites de jogos + ranking) com **vários grupos independentes**, identificados por um código na URL. Site estático (HTML + JS puro, sem build) + **Supabase** (Postgres com RLS, Auth e pontuação no banco). Mesma pegada do projeto `mr-brant`.

## Como funciona
- **Grupos separados:** cada bolão tem um link, ex.: `.../index.html?g=trabalho` e `.../index.html?g=futebol`. Um grupo **não vê** o ranking nem os palpites do outro (garantido por RLS).
- **Login:** por e-mail (magic link) — a pessoa recebe um link, clica e já está dentro.
- **Sem auto-cadastro:** você cadastra cada jogador (nome + e-mail) no admin; só quem está na lista do grupo entra, usando esse mesmo e-mail.
- **Jogos e resultados são globais** (uma só Copa): você cadastra e lança o placar uma vez, e o ranking de todos os grupos atualiza sozinho.
- **Trava por jogo:** dá pra apostar/alterar até o horário de início da partida; depois o banco recusa qualquer mudança.
- **Pontuação:** placar exato = 10 · acertou o vencedor/quem avança = 7 · previu empate e foi aos pênaltis = 5 · senão 0.

## Estrutura
```
index.html        # app do apostador (Ranking / Meus jogos / Apostar)
admin.html        # painel (só você): times, jogos, resultados, grupos
js/config.js      # URL + chave do Supabase (preencher)
js/app.js         # lógica do apostador
js/admin.js       # lógica do admin
supabase/schema.sql  # tabelas + RLS + pontuação  (rode no Supabase)
supabase/seed.sql    # times + jogos de exemplo (opcional)
supabase/SETUP.md    # passo a passo da configuração
supabase/SETUP-EMAIL.md          # (opcional) e-mail do login via Resend
supabase/functions/send-email/   # Edge Function que envia o link pelo Resend
```

## Começar
1. Siga o [`supabase/SETUP.md`](supabase/SETUP.md) (criar tabelas, login por e-mail, virar admin, pegar as chaves).
2. Preencha `js/config.js` com a URL e a chave `anon` do seu projeto.
3. Teste local: `npx serve -l 3000 .` e abra `http://localhost:3000/admin.html` (crie um grupo) e `http://localhost:3000/index.html?g=teste`.

## Publicar (GitHub Pages)
1. `git add . && git commit -m "Bolão da Copa" && git push`
2. No GitHub: **Settings → Pages** → Source: branch `main`, pasta `/ (root)`.
3. Ajuste as **Redirect URLs** no Supabase para o endereço do Pages (veja o SETUP).
