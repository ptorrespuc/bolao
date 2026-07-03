// ============================================================
// Bolão da Copa — Admin
// ============================================================
const { SUPABASE_URL, SUPABASE_KEY } = window.BOLAO_CONFIG;
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
});

const $ = (id) => document.getElementById(id);
const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');
const esc = (s) => (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PHASES = ['oitavas', 'quartas', 'semi', 'final'];
const PHASE_LABELS = { oitavas: 'Oitavas', quartas: 'Quartas', semi: 'Semifinal', final: 'Final' };

let TEAMS = [];
let GAMES = [];
let GROUPS = [];
let PARTICIPANTS = [];
let tab = 'games';

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
function slugify(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
// ISO -> valor de <input type=datetime-local> (hora local)
function toLocalInput(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fromLocalInput(v) { return v ? new Date(v).toISOString() : null; }
function teamName(code) { const t = TEAMS.find(x => x.code === code); return t ? t.name : 'A definir'; }

// ============================================================
// AUTH (magic link)
// ============================================================
async function init() {
  if (!SUPABASE_URL || SUPABASE_URL.includes('SEU-PROJETO')) {
    show($('login')); $('loginMsg').className = 'err';
    $('loginMsg').textContent = 'Preencha js/config.js com a URL e a chave do Supabase.';
    return;
  }
  sb.auth.onAuthStateChange((_e, session) => { if (session) checkAdmin(session); });
  const { data: { session } } = await sb.auth.getSession();
  if (session) checkAdmin(session);
  else show($('login'));
}

$('sendLink').onclick = async () => {
  const email = $('email').value.trim();
  const msg = $('loginMsg'); msg.className = ''; msg.textContent = '';
  if (!email.includes('@')) { msg.className = 'err'; msg.textContent = 'Informe um e-mail válido.'; return; }
  $('sendLink').disabled = true; $('sendLink').textContent = 'Enviando…';
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href } });
  $('sendLink').disabled = false; $('sendLink').textContent = 'Enviar link de acesso';
  if (error) { msg.className = 'err'; msg.textContent = error.message; }
  else { msg.className = 'ok'; msg.textContent = 'Link enviado! Confira seu e-mail.'; }
};
$('email').addEventListener('keydown', e => { if (e.key === 'Enter') $('sendLink').click(); });
$('logout').onclick = async () => { await sb.auth.signOut(); location.reload(); };
$('denyLogout').onclick = async () => { await sb.auth.signOut(); location.reload(); };

async function checkAdmin(session) {
  const { data } = await sb.from('admins').select('user_id').eq('user_id', session.user.id).maybeSingle();
  hide($('login'));
  if (!data) { show($('denied')); return; }
  hide($('denied')); show($('app'));
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
    tab = b.dataset.tab;
    document.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('active', x === b));
    renderTab();
  });
  await loadAll();
  renderTab();
}

async function loadAll() {
  const [t, g, gr, pa] = await Promise.all([
    sb.from('teams').select('*').order('name'),
    sb.from('games').select('*').order('sort'),
    sb.from('groups').select('*').order('created_at'),
    sb.from('participants').select('id, group_id, display_name, email, user_id, created_at').order('created_at'),
  ]);
  TEAMS = t.data || []; GAMES = g.data || []; GROUPS = gr.data || []; PARTICIPANTS = pa.data || [];
}

function renderTab() {
  if (tab === 'games') renderGames();
  else if (tab === 'teams') renderTeams();
  else renderGroups();
  window.scrollTo(0, 0);
}

// ============================================================
// JOGOS
// ============================================================
function teamOptions(sel) {
  return `<option value="">— A definir —</option>` +
    TEAMS.map(t => `<option value="${t.code}" ${t.code === sel ? 'selected' : ''}>${esc(t.flag ? t.flag + ' ' : '')}${esc(t.name)}</option>`).join('');
}

function renderGames() {
  const main = $('main');
  const byPhase = PHASES.map(ph => {
    const games = GAMES.filter(g => g.phase === ph);
    const cards = games.map(gameCardHTML).join('') || `<div class="muted">Nenhum jogo nesta fase.</div>`;
    return `<div class="phase-ttl">${PHASE_LABELS[ph]}</div>${cards}`;
  }).join('');

  main.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between;">
        <h3>Novo jogo</h3>
        <button class="btn btn-sm" id="addGame">+ Adicionar</button>
      </div>
    </div>
    ${byPhase}`;
  $('addGame').onclick = addGame;
  GAMES.forEach(g => wireGameCard(g.id));
}

function gameCardHTML(g) {
  const tie = g.score_a != null && g.score_b != null && g.score_a === g.score_b;
  return `<div class="card" data-gid="${g.id}" style="margin-bottom:10px;">
    <div class="grid col2" style="grid-template-columns:1fr 1fr;">
      <div><label>Fase</label>
        <select data-f="phase">${PHASES.map(p => `<option value="${p}" ${p === g.phase ? 'selected' : ''}>${PHASE_LABELS[p]}</option>`).join('')}</select></div>
      <div><label>Início da partida (trava as apostas)</label>
        <input data-f="kickoff" type="datetime-local" value="${g.kickoff ? toLocalInput(g.kickoff) : ''}"></div>
      <div><label>Time A</label><select data-f="team_a">${teamOptions(g.team_a)}</select></div>
      <div><label>Time B</label><select data-f="team_b">${teamOptions(g.team_b)}</select></div>
    </div>
    <div style="border-top:1px solid var(--line);margin:12px 0;"></div>
    <label>Resultado (deixe em branco enquanto não houver placar)</label>
    <div class="row">
      <input data-f="score_a" type="number" min="0" style="width:70px;" value="${g.score_a ?? ''}" placeholder="A">
      <span style="font-weight:800;">×</span>
      <input data-f="score_b" type="number" min="0" style="width:70px;" value="${g.score_b ?? ''}" placeholder="B">
      <div data-tie style="${tie ? '' : 'display:none;'};flex:1;min-width:180px;">
        <select data-f="winner"><option value="">Quem venceu (pênaltis)?</option>
          ${g.team_a ? `<option value="${g.team_a}" ${g.winner === g.team_a ? 'selected' : ''}>${esc(teamName(g.team_a))}</option>` : ''}
          ${g.team_b ? `<option value="${g.team_b}" ${g.winner === g.team_b ? 'selected' : ''}>${esc(teamName(g.team_b))}</option>` : ''}
        </select>
      </div>
    </div>
    <div class="row" style="margin-top:12px;justify-content:space-between;">
      <button class="btn btn-sm btn-danger" data-act="del">Excluir</button>
      <button class="btn btn-sm" data-act="save">Salvar jogo</button>
    </div>
  </div>`;
}

function readGameForm(gid) {
  const card = document.querySelector(`[data-gid="${gid}"]`);
  const val = (f) => card.querySelector(`[data-f="${f}"]`).value;
  const sa = val('score_a'), sb_ = val('score_b');
  return {
    phase: val('phase'),
    team_a: val('team_a') || null,
    team_b: val('team_b') || null,
    kickoff: fromLocalInput(val('kickoff')),
    score_a: sa === '' ? null : parseInt(sa, 10),
    score_b: sb_ === '' ? null : parseInt(sb_, 10),
    winner: val('winner') || null,
  };
}

function wireGameCard(gid) {
  const card = document.querySelector(`[data-gid="${gid}"]`);
  if (!card) return;
  const toggleTie = () => {
    const sa = card.querySelector('[data-f="score_a"]').value;
    const sb_ = card.querySelector('[data-f="score_b"]').value;
    const tie = sa !== '' && sb_ !== '' && parseInt(sa, 10) === parseInt(sb_, 10);
    card.querySelector('[data-tie]').style.display = tie ? '' : 'none';
  };
  card.querySelectorAll('[data-f="score_a"],[data-f="score_b"]').forEach(i => i.oninput = toggleTie);
  card.querySelector('[data-act="save"]').onclick = () => saveGame(gid);
  card.querySelector('[data-act="del"]').onclick = () => delGame(gid);
}

async function addGame() {
  const maxSort = GAMES.reduce((m, g) => Math.max(m, g.sort || 0), 0);
  const kickoff = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const { error } = await sb.from('games').insert({ phase: 'oitavas', kickoff, sort: maxSort + 1 });
  if (error) return toast(error.message);
  await loadAll(); renderTab();
}

async function saveGame(gid) {
  const g = GAMES.find(x => x.id === gid);
  const form = readGameForm(gid);
  if (!form.kickoff) return toast('Informe a data/hora de início.');
  // empate com placar: exige vencedor (pênaltis)
  if (form.score_a != null && form.score_b != null && form.score_a === form.score_b && !form.winner) {
    return toast('Empate no placar: escolha quem venceu nos pênaltis.');
  }
  // sort segue a fase se ela mudou? mantém o sort atual
  const patch = { ...form, sort: g.sort };
  const { error } = await sb.from('games').update(patch).eq('id', gid);
  if (error) return toast(error.message);
  await loadAll(); renderTab(); toast('Jogo salvo!');
}

async function delGame(gid) {
  if (!confirm('Excluir este jogo? Os palpites dele também serão apagados.')) return;
  const { error } = await sb.from('games').delete().eq('id', gid);
  if (error) return toast(error.message);
  await loadAll(); renderTab(); toast('Jogo excluído.');
}

// ============================================================
// TIMES
// ============================================================
function renderTeams() {
  const main = $('main');
  const rows = TEAMS.map(t => `<div class="card" style="margin-bottom:8px;display:flex;align-items:center;gap:12px;">
    <span style="font-size:22px;">${esc(t.flag || '⚽')}</span>
    <div style="flex:1;"><b>${esc(t.name)}</b> <span class="muted">(${esc(t.code)})</span></div>
    <button class="btn btn-sm btn-danger" data-delteam="${t.code}">Excluir</button>
  </div>`).join('') || `<div class="muted">Nenhum time ainda.</div>`;

  main.innerHTML = `
    <div class="card">
      <h3>Adicionar time</h3>
      <div class="row" style="margin-top:10px;">
        <input id="tcode" placeholder="Código (ex.: BRA)" style="width:140px;" maxlength="4">
        <input id="tname" placeholder="Nome (ex.: Brasil)" style="flex:1;min-width:160px;">
        <input id="tflag" placeholder="🇧🇷" style="width:70px;">
        <button class="btn btn-sm" id="addTeam">Adicionar</button>
      </div>
    </div>
    ${rows}`;
  $('addTeam').onclick = addTeam;
  main.querySelectorAll('[data-delteam]').forEach(b => b.onclick = () => delTeam(b.dataset.delteam));
}

async function addTeam() {
  const code = $('tcode').value.trim().toUpperCase();
  const name = $('tname').value.trim();
  const flag = $('tflag').value.trim();
  if (!code || !name) return toast('Preencha código e nome.');
  const { error } = await sb.from('teams').insert({ code, name, flag });
  if (error) return toast(error.message);
  await loadAll(); renderTab(); toast('Time adicionado.');
}
async function delTeam(code) {
  if (!confirm(`Excluir o time ${code}?`)) return;
  const { error } = await sb.from('teams').delete().eq('code', code);
  if (error) return toast('Não deu (talvez haja jogos usando este time): ' + error.message);
  await loadAll(); renderTab();
}

// ============================================================
// GRUPOS
// ============================================================
function groupLink(code) {
  const base = location.href.replace(/admin\.html.*$/, 'index.html');
  return `${base}?g=${encodeURIComponent(code)}`;
}

function participantsHTML(gid) {
  const parts = PARTICIPANTS.filter(p => p.group_id === gid);
  const rows = parts.map(p => {
    const active = !!p.user_id;
    return `<div class="row" style="justify-content:space-between;padding:8px 0;border-top:1px solid var(--line);">
      <div style="min-width:0;">
        <b>${esc(p.display_name)}</b>
        <span class="badge" style="margin-left:6px;background:${active ? '#DCEFE1' : '#F3E3D0'};color:${active ? 'var(--green)' : '#A0662E'};font-size:11px;border-radius:20px;padding:2px 8px;font-weight:700;">${active ? 'ativo' : 'aguardando 1º acesso'}</span>
        <div class="muted" style="font-size:12px;">${esc(p.email)}</div>
      </div>
      <button class="btn btn-sm btn-danger" data-delpart="${p.id}">Remover</button>
    </div>`;
  }).join('') || `<div class="muted" style="padding-top:8px;">Nenhum jogador cadastrado ainda.</div>`;

  return `<div style="margin-top:12px;border-top:1px dashed var(--line2);padding-top:12px;">
    <div style="font-weight:800;font-size:13px;color:var(--green);margin-bottom:4px;">Jogadores (${parts.length})</div>
    ${rows}
    <div class="row" data-addpart="${gid}" style="margin-top:10px;">
      <input data-pname placeholder="Nome do jogador" style="flex:1;min-width:140px;">
      <input data-pemail type="email" placeholder="e-mail do jogador" style="flex:1;min-width:160px;">
      <button class="btn btn-sm" data-addpartbtn>Adicionar</button>
    </div>
  </div>`;
}

function renderGroups() {
  const main = $('main');
  const rows = GROUPS.map(g => {
    const link = groupLink(g.code);
    return `<div class="card" style="margin-bottom:8px;">
      <div class="row" style="justify-content:space-between;">
        <div><b>${esc(g.name)}</b> <span class="muted">· código <code>${esc(g.code)}</code></span></div>
        <button class="btn btn-sm btn-danger" data-delgroup="${g.id}">Excluir</button>
      </div>
      <div class="row" style="margin-top:8px;">
        <input readonly value="${esc(link)}" style="flex:1;min-width:200px;">
        <button class="btn btn-sm btn-ghost" data-copy="${esc(link)}">Copiar link</button>
      </div>
      ${participantsHTML(g.id)}
    </div>`;
  }).join('') || `<div class="muted">Nenhum grupo ainda.</div>`;

  main.innerHTML = `
    <div class="card">
      <h3>Novo bolão (grupo)</h3>
      <p class="muted" style="margin:6px 0 10px;">O código vai na URL e separa cada grupo. Cadastre os jogadores (nome + e-mail) — só quem estiver na lista consegue entrar, usando esse mesmo e-mail no login.</p>
      <div class="row">
        <input id="gname" placeholder="Nome (ex.: Pessoal do trabalho)" style="flex:1;min-width:180px;">
        <input id="gcode" placeholder="código (ex.: trabalho)" style="width:180px;">
        <button class="btn btn-sm" id="addGroup">Criar</button>
      </div>
    </div>
    ${rows}`;

  $('gname').oninput = () => { if (!$('gcode').dataset.touched) $('gcode').value = slugify($('gname').value); };
  $('gcode').oninput = () => { $('gcode').dataset.touched = '1'; };
  $('addGroup').onclick = addGroup;
  main.querySelectorAll('[data-delgroup]').forEach(b => b.onclick = () => delGroup(b.dataset.delgroup));
  main.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('Link copiado!'); }
    catch { toast('Copie manualmente do campo ao lado.'); }
  });
  main.querySelectorAll('[data-delpart]').forEach(b => b.onclick = () => delParticipant(b.dataset.delpart));
  main.querySelectorAll('[data-addpart]').forEach(box => {
    const gid = box.dataset.addpart;
    const name = box.querySelector('[data-pname]');
    const email = box.querySelector('[data-pemail]');
    const go = () => addParticipant(gid, name.value, email.value);
    box.querySelector('[data-addpartbtn]').onclick = go;
    email.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  });
}

async function addParticipant(gid, name, email) {
  name = (name || '').trim();
  email = (email || '').trim().toLowerCase();
  if (!name || !email.includes('@')) return toast('Informe nome e e-mail válido.');
  const { error } = await sb.from('participants').insert({ group_id: gid, display_name: name, email });
  if (error) return toast(error.code === '23505' ? 'Este e-mail já está neste grupo.' : error.message);
  await loadAll(); renderTab(); toast('Jogador cadastrado!');
}

async function delParticipant(id) {
  if (!confirm('Remover este jogador do grupo? Os palpites dele também serão apagados.')) return;
  const { error } = await sb.from('participants').delete().eq('id', id);
  if (error) return toast(error.message);
  await loadAll(); renderTab(); toast('Jogador removido.');
}

async function addGroup() {
  const name = $('gname').value.trim();
  const code = slugify($('gcode').value.trim() || name);
  if (!name || !code) return toast('Preencha nome e código.');
  const { error } = await sb.from('groups').insert({ name, code });
  if (error) return toast(error.code === '23505' ? 'Já existe um grupo com esse código.' : error.message);
  await loadAll(); renderTab(); toast('Grupo criado!');
}
async function delGroup(id) {
  if (!confirm('Excluir este grupo? Participantes e palpites dele serão apagados.')) return;
  const { error } = await sb.from('groups').delete().eq('id', id);
  if (error) return toast(error.message);
  await loadAll(); renderTab();
}

init();
