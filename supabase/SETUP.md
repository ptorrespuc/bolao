# Configuração do Supabase — Bolão da Copa

Siga na ordem. Leva ~10 minutos.

## 1. Criar as tabelas
1. No painel do Supabase: **SQL Editor** → **New query**
2. Cole TODO o conteúdo de [`schema.sql`](schema.sql) → **Run**
3. Deve aparecer "Success". (Cria tabelas, RLS, funções e a pontuação.)

## 2. Dados de exemplo (opcional, recomendado no começo)
1. **SQL Editor** → **New query**
2. Cole [`seed.sql`](seed.sql) → **Run**
3. Cria os 16 times, um chaveamento de exemplo (oitavas jogadas, quartas em aberto) e um grupo `teste`.
> Depois é tudo editável pelo `admin.html`.

## 3. Configurar o login por e-mail (magic link)
1. Menu lateral: **Authentication** → **Providers** → confirme que **Email** está ligado.
2. **Authentication** → **URL Configuration**:
   - **Site URL:** o endereço final do site (ex.: `https://SEU-USUARIO.github.io/bolao/`).
   - **Redirect URLs:** use padrões com **curinga** (`**`), porque o link do apostador termina em `?g=...` e precisa ser aceito. Adicione a versão local (para testar) e a de produção:
     ```
     http://localhost:3000/**
     https://SEU-USUARIO.github.io/**
     ```
   > O magic link volta para a mesma URL de onde foi pedido (incluindo o `?g=...`); o `**` garante que qualquer caminho/parâmetro desse endereço seja aceito.
3. (Recomendado) Em **Authentication → Emails**, o Supabase já envia os links pelo servidor de testes dele. Para produção com muitos usuários, configure um SMTP próprio depois.

> **Login por código de 6 dígitos (recomendado).** O app aceita tanto o **link** quanto um **código de 6 dígitos** — o código é imune a e-mails que "pré-visitam" o link (temp mail, antivírus, Outlook Safe Links), que gastam o link antes de você clicar. Para o código aparecer no e-mail:
> - **Se você usa o e-mail padrão do Supabase:** em **Authentication → Emails → Magic Link**, inclua o token no template, ex.: `<p>Ou use este código: <b>{{ .Token }}</b></p>`.
> - **Se você usa a Edge Function do Resend** (veja `SETUP-EMAIL.md`): o código já vai no e-mail; basta **reimplantar** a função (`npx supabase functions deploy send-email --no-verify-jwt`).

## 4. Criar seu usuário de admin
1. **Authentication** → **Users** → **Add user** → **Create new user** → informe seu e-mail e uma senha qualquer → marque **Auto Confirm User** → **Create**.
   (Você vai entrar pelo magic link; a senha só serve para criar o usuário agora.)
2. Copie o **User UID** desse usuário (aparece na lista de usuários).
3. **SQL Editor** → **New query** → rode, trocando pelo seu UID e e-mail:
   ```sql
   insert into admins (user_id, email)
   values ('COLE-O-USER-UID-AQUI', 'seu@email.com');
   ```
   Só quem está nesta tabela consegue usar o `admin.html`.

## 5. Pegar as chaves e preencher o `config.js`
1. **Project Settings** (engrenagem) → **API**
2. Copie:
   - **Project URL** (ex.: `https://xxxx.supabase.co`)
   - a chave **anon public** (ou "publishable")
3. Cole em [`js/config.js`](../js/config.js):
   ```js
   window.BOLAO_CONFIG = {
     SUPABASE_URL: 'https://xxxx.supabase.co',
     SUPABASE_KEY: 'sua_chave_anon',
   };
   ```
> A chave `anon` é segura no navegador: o RLS garante que ninguém edite jogos/resultados sem ser admin, nem veja/altere palpites de outro grupo, nem aposte depois do início do jogo.

## 6. Usar
- **Admin (você):** abra `admin.html`, entre com seu e-mail (magic link). Crie **times**, **jogos** (com data/hora de início) e **grupos**. Em cada grupo, **cadastre os jogadores** (nome + e-mail).
- **Apostadores:** mande o link do grupo, ex.: `.../index.html?g=trabalho`. A pessoa entra com **o mesmo e-mail que você cadastrou** — o login é vinculado automaticamente ao cadastro. Quem não estiver na lista não consegue entrar (não há auto-cadastro).

> **Já tinha criado as tabelas antes?** Se você rodou o `schema.sql` numa versão anterior (participante sem e-mail), rode uma vez o [`migration-participants.sql`](migration-participants.sql) para atualizar o banco sem perder times/jogos.

## Como funciona a pontuação
Calculada no banco (view `v_ranking`), igual para todos:
- **Placar exato:** 10 pontos
- **Acertou só o vencedor** (ou quem avançou): 7 pontos
- **Previu empate e o jogo foi para os pênaltis** (mas errou quem passou): 5 pontos
- Errou tudo: 0

## A trava do horário
Cada jogo tem um horário de início. O apostador pode criar/alterar o palpite até esse horário; depois, o **próprio banco recusa** qualquer alteração (política de RLS que checa `kickoff > now()`). Não adianta mudar o relógio do computador.
