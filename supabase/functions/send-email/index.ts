// ============================================================
// Bolão da Copa — Send Email Hook (Supabase Auth) via Resend
// Mesma ideia do mr-brant: envia o e-mail chamando a API do Resend.
// O Supabase Auth chama esta função sempre que precisa mandar um
// e-mail (link mágico de login). Montamos o link e disparamos no Resend.
// ============================================================
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';

const HOOK_SECRET = Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '';
const RESEND_KEY  = Deno.env.get('RESEND_API_KEY') ?? '';
const RESEND_FROM = Deno.env.get('RESEND_FROM') ?? 'Bolão da Copa <onboarding@resend.dev>';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';

// o secret do painel vem como "v1,whsec_xxx" — a lib espera só a parte base64
const wh = new Webhook(HOOK_SECRET.replace(/^v1,whsec_/, ''));

function emailHtml(link: string, code: string) {
  return `<!DOCTYPE html><html><body style="margin:0;background:#F6F1E2;font-family:Arial,Helvetica,sans-serif;color:#1C2B22;">
    <div style="max-width:480px;margin:0 auto;padding:32px 20px;">
      <div style="text-align:center;margin-bottom:24px;">
        <span style="font-weight:900;font-size:26px;color:#0E4A30;">Bolão <span style="color:#F4B942;">da Copa</span></span>
      </div>
      <div style="background:#FFFFFF;border:1px solid #EAE1C4;border-radius:16px;padding:28px 24px;">
        <h1 style="font-size:20px;margin:0 0 12px;color:#0E4A30;">Seu acesso ao bolão</h1>
        <p style="font-size:15px;line-height:1.5;margin:0 0 18px;color:#3a463f;">
          Use o <b>código</b> abaixo na tela de login (ou clique no botão). Vale por pouco tempo.
        </p>
        ${code ? `<div style="text-align:center;margin:0 0 22px;">
          <div style="font-size:13px;color:#8A9A8F;font-weight:700;margin-bottom:6px;">SEU CÓDIGO</div>
          <div style="display:inline-block;background:#FBF7EC;border:1px solid #D8CFAF;border-radius:12px;padding:14px 24px;font-size:30px;font-weight:900;letter-spacing:8px;color:#0E4A30;">${code}</div>
        </div>` : ''}
        <div style="text-align:center;margin:0 0 22px;">
          <a href="${link}" style="display:inline-block;background:#F4B942;color:#12321F;text-decoration:none;font-weight:800;padding:14px 26px;border-radius:10px;font-size:15px;">Entrar no bolão</a>
        </div>
        <p style="font-size:12px;color:#8A9A8F;line-height:1.5;margin:0;">
          Se o botão não funcionar, copie e cole este endereço no navegador:<br>
          <span style="word-break:break-all;color:#0E4A30;">${link}</span>
        </p>
      </div>
      <p style="text-align:center;font-size:12px;color:#8A9A8F;margin-top:18px;">
        Você recebeu este e-mail porque alguém pediu acesso ao Bolão da Copa com este endereço. Se não foi você, ignore.
      </p>
    </div></body></html>`;
}

Deno.serve(async (req) => {
  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);

  let data: any;
  try {
    data = wh.verify(payload, headers);
  } catch (_e) {
    return new Response(JSON.stringify({ error: { message: 'Assinatura inválida' } }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { user, email_data } = data;
  const { token, token_hash, redirect_to, email_action_type } = email_data;

  // monta o link de verificação do Supabase (que redireciona de volta ao app)
  const link = `${SUPABASE_URL}/auth/v1/verify?token=${token_hash}` +
    `&type=${email_action_type}&redirect_to=${encodeURIComponent(redirect_to)}`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: user.email,
      subject: `Bolão da Copa — seu código: ${token ?? ''}`.trim(),
      html: emailHtml(link, token ?? ''),
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    return new Response(JSON.stringify({ error: { message: `Resend: ${t}` } }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
