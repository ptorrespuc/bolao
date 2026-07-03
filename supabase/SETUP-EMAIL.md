# E-mail do login via Resend (Edge Function) — igual ao mr-brant

O Supabase Auth vai chamar a função [`functions/send-email`](functions/send-email/index.ts), que dispara o link mágico pela **API do Resend**. Assim os e-mails saem pelo seu Resend (melhor entrega) e com o visual do Bolão.

> Alternativa sem deploy: dá para usar o Resend como **SMTP** em *Authentication → SMTP Settings* (sem Edge Function). Este guia é o caminho "Edge Function", que você escolheu.

## 1. Resend: domínio + API key
1. Em https://resend.com → **Domains** → verifique um domínio seu (ou use `onboarding@resend.dev` **só para teste** — nesse modo o Resend só entrega para o e-mail da sua própria conta).
2. **API Keys** → copie uma key (pode reaproveitar a do mr-brant).
3. Defina o remetente, ex.: `Bolão da Copa <bolao@seudominio.com>` (o domínio precisa estar verificado).

## 2. Instalar a CLI do Supabase (no Git Bash, para evitar o bloqueio do PowerShell)
```bash
cd "/c/Users/maiae/Documents/bolão/bolao"
npx supabase --version     # baixa a CLI na hora
```

## 3. Autenticar e linkar o projeto
```bash
npx supabase login                                   # abre o navegador para autorizar
npx supabase link --project-ref zrctuplyrixjowefpicx
```

## 4. Deploy da função
A flag `--no-verify-jwt` é obrigatória: quem chama é o servidor de Auth, sem token de usuário.
```bash
npx supabase functions deploy send-email --no-verify-jwt
```

## 5. Segredos da função
`SUPABASE_URL` já é injetado automaticamente. Defina os do Resend:
```bash
npx supabase secrets set RESEND_API_KEY="re_sua_key" RESEND_FROM="Bolão da Copa <bolao@seudominio.com>"
```

## 6. Ativar o Hook de e-mail (no painel)
1. **Authentication → Hooks** → **Send Email Hook** → **Enable**.
2. Tipo **HTTPS**, URL:
   ```
   https://zrctuplyrixjowefpicx.supabase.co/functions/v1/send-email
   ```
3. Ao salvar, o painel gera um **Secret** (formato `v1,whsec_...`). Copie.
4. Registre esse secret na função:
   ```bash
   npx supabase secrets set SEND_EMAIL_HOOK_SECRET="v1,whsec_o_valor_copiado"
   ```
   (a função já remove o prefixo `v1,whsec_` sozinha.)

## 7. Testar
- Abra `http://localhost:3000/?g=teste`, peça o link com um e-mail **cadastrado** no grupo.
- O e-mail deve chegar **com o visual do Bolão** e vindo do seu remetente Resend.
- Se algo falhar, veja os logs: **Edge Functions → send-email → Logs** no painel (ou `npx supabase functions logs send-email`).

## Observações
- Enquanto o Hook estiver ligado, **todos** os e-mails de Auth passam por esta função.
- O `RESEND_API_KEY` fica como segredo no Supabase (não no repositório).
- Para desligar e voltar ao e-mail padrão do Supabase: **Authentication → Hooks** → desative o Send Email Hook.
