// ============================================================
// Bolão da Copa — App do apostador
// ============================================================
const { SUPABASE_URL, SUPABASE_KEY } = window.BOLAO_CONFIG;
// flowType 'implicit': o token vem na URL do link mágico, então funciona mesmo
// quando a pessoa abre o e-mail em outro navegador/celular (sem depender do PKCE).
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
});

const root = document.getElementById('root');

// ---------- constantes de visual ----------
const PHASE_ORDER  = ['oitavas', 'quartas', 'semi', 'final'];
const PHASE_LABELS = { oitavas: 'Oitavas', quartas: 'Quartas', semi: 'Semifinal', final: 'Final' };
const AVATAR_PALETTE = ['#0E4A30', '#F2542D', '#2E6E7E', '#B8842E', '#5C4A9C', '#1E7A4C'];

// ---------- estado ----------
const state = {
  groupCode: null,
  group: null,
  user: null,
  participant: null,       // { id, display_name, ... } do usuário atual
  teams: {},               // code -> { name, flag }
  games: [],
  betsByPart: {},          // participant_id -> { game_id -> bet }
  ranking: [],             // linhas de v_ranking (ordenadas)
  view: 'ranking',
  selectedPartId: null,    // detail
  betPhase: 'quartas',
  edit: {},                // game_id -> { score_a, score_b, advances, dirty, saving }
};

// ---------- helpers ----------
function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function initials(name) {
  const p = (name || '?').trim().split(/\s+/);
  return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase();
}
function avatarColor(seed) {
  let h = 0; const s = String(seed || '');
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}
function teamName(code) { return code && state.teams[code] ? state.teams[code].name : 'A definir'; }
function teamFlag(code) { return code && state.teams[code] ? (state.teams[code].flag || '') : ''; }
function teamLabel(code) { const f = teamFlag(code); return (f ? f + ' ' : '') + teamName(code); }
function isLocked(game) { return new Date(game.kickoff).getTime() <= Date.now(); }
// URL de retorno do magic link SEM fragmento (#...): evita "envenenar" o
// próximo link com um #error/#access_token antigo que ficou na barra de endereço.
function redirectUrl() { return location.origin + location.pathname + location.search; }
function gameReady(g) { return !!(g.team_a && g.team_b); }  // os dois times definidos

const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
function kickoffLabel(iso) {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${WD[d.getDay()]}, ${dd}/${mm} · ${hh}h${mi === '00' ? '' : mi}`;
}

// pontuação (espelha bet_points do banco / computePoints do protótipo)
function computePoints(game, bet) {
  if (game.score_a == null || game.score_b == null || !bet) return null;
  if (bet.score_a === game.score_a && bet.score_b === game.score_b) return 10;
  const betWinner = bet.score_a === bet.score_b ? bet.advances
    : (bet.score_a > bet.score_b ? game.team_a : game.team_b);
  if (betWinner && betWinner === game.winner) return 7;
  if (bet.score_a === bet.score_b && game.decided === 'penalties') return 5;
  return 0;
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

// ============================================================
// BOOT
// ============================================================
async function init() {
  const params = new URLSearchParams(location.search);
  state.groupCode = (params.get('g') || '').trim();

  if (!SUPABASE_URL || SUPABASE_URL.includes('SEU-PROJETO')) {
    return renderGate(`<h2>Configuração pendente</h2><p>Preencha <b>js/config.js</b> com a URL e a chave do seu projeto Supabase.</p>`);
  }
  if (!state.groupCode) {
    return renderGate(`<h2>Qual bolão?</h2><p>O link precisa do código do grupo, ex.: <b>…/?g=trabalho</b>. Peça o link para quem te convidou.</p>`);
  }

  // resolve o grupo pelo código (leitura pública)
  const { data: grp, error } = await sb.from('groups').select('id, code, name').eq('code', state.groupCode).maybeSingle();
  if (error || !grp) {
    return renderGate(`<h2>Bolão não encontrado</h2><p>Não existe um grupo com o código <b>${esc(state.groupCode)}</b>. Confira o link.</p>`);
  }
  state.group = grp;

  sb.auth.onAuthStateChange((_e, session) => { if (session && !state.user) afterLogin(session); });
  const { data: { session } } = await sb.auth.getSession();
  if (session) afterLogin(session);
  else {
    // limpa erro/token antigo do hash para não contaminar o próximo link
    if (location.hash) history.replaceState(null, '', redirectUrl());
    renderLogin();
  }
}

// ---------- login (magic link) ----------
function renderLogin() {
  renderGate(`
    <h2>${esc(state.group.name)}</h2>
    <p>Entre com seu e-mail. Enviaremos um link mágico — clique nele e você já está dentro do bolão.</p>
    <input id="email" type="email" placeholder="seu@email.com" autocomplete="email">
    <button id="sendLink" class="btn-primary">Enviar link de acesso</button>
    <div id="loginMsg"></div>
  `);
  const email = document.getElementById('email');
  const btn = document.getElementById('sendLink');
  const msg = document.getElementById('loginMsg');
  email.focus();
  const send = async () => {
    const val = email.value.trim();
    msg.className = ''; msg.textContent = '';
    if (!val || !val.includes('@')) { msg.className = 'err'; msg.textContent = 'Informe um e-mail válido.'; return; }
    btn.disabled = true; btn.textContent = 'Enviando…';
    const { error } = await sb.auth.signInWithOtp({ email: val, options: { emailRedirectTo: redirectUrl() } });
    btn.disabled = false; btn.textContent = 'Enviar link de acesso';
    if (error) { msg.className = 'err'; msg.textContent = 'Não deu para enviar: ' + error.message; }
    else { msg.className = 'ok'; msg.textContent = 'Link enviado! Confira seu e-mail (e a caixa de spam).'; }
  };
  btn.onclick = send;
  email.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
}

async function afterLogin(session) {
  state.user = session.user;
  // vincula este login ao cadastro feito pelo admin (casa pelo e-mail)
  const { data: part, error } = await sb.rpc('claim_participant', { p_group: state.group.id });
  if (error) return renderNotRegistered('Não deu para entrar: ' + error.message);
  // e-mail não cadastrado: o RPC pode devolver null OU uma linha toda nula
  if (!part || !part.id) return renderNotRegistered();
  state.participant = { id: part.id, display_name: part.display_name };
  await loadAll(); render();
}

// ---------- e-mail não cadastrado neste grupo ----------
function renderNotRegistered(errMsg) {
  renderGate(`
    <h2>Você ainda não está neste bolão</h2>
    <p>O e-mail <b>${esc(state.user.email)}</b> não está cadastrado em <b>${esc(state.group.name)}</b>.
    Peça para o organizador te adicionar com esse mesmo e-mail.</p>
    ${errMsg ? `<div class="err">${esc(errMsg)}</div>` : ''}
    <button id="tryOther" class="btn-primary">Entrar com outro e-mail</button>
  `);
  document.getElementById('tryOther').onclick = async () => { await sb.auth.signOut(); location.reload(); };
}

// ============================================================
// DADOS
// ============================================================
async function loadAll() {
  const [teamsRes, gamesRes, rankRes, betsRes] = await Promise.all([
    sb.from('teams').select('code, name, flag'),
    sb.from('games').select('*').order('sort'),
    sb.from('v_ranking').select('*').eq('group_id', state.group.id),
    sb.from('bets').select('*'),
  ]);
  state.teams = {};
  (teamsRes.data || []).forEach(t => { state.teams[t.code] = t; });
  state.games = gamesRes.data || [];

  const rankPartIds = new Set((rankRes.data || []).map(r => r.participant_id));
  state.ranking = (rankRes.data || []).slice().sort((a, b) =>
    b.points - a.points || a.display_name.localeCompare(b.display_name));

  // indexa palpites (apenas dos participantes deste grupo)
  state.betsByPart = {};
  (betsRes.data || []).forEach(b => {
    if (!rankPartIds.has(b.participant_id)) return;
    (state.betsByPart[b.participant_id] || (state.betsByPart[b.participant_id] = {}))[b.game_id] = b;
  });

  // fase inicial de aposta = primeira fase com jogo em aberto
  const openPhase = PHASE_ORDER.find(ph =>
    state.games.some(g => g.phase === ph && gameReady(g) && !isLocked(g)));
  if (openPhase) state.betPhase = openPhase;
}

function myBet(gameId) {
  const m = state.betsByPart[state.participant.id];
  return m ? m[gameId] : null;
}

// ============================================================
// RENDER — shell + navegação
// ============================================================
let lastNavKey = null;  // sobe ao topo só quando muda de aba/fase/pessoa
function render() {
  root.className = 'wrap';
  root.innerHTML = `
    <header>
      <div class="nav-in">
        <div class="nav-top">
          <div class="logo"><span class="b1">Bolão</span><span class="b2">da Copa</span></div>
          <div class="nav-meta">
            <span>${state.ranking.length} participante${state.ranking.length === 1 ? '' : 's'}</span>
            <button class="logout" id="logout">sair</button>
          </div>
        </div>
        <div class="tabs">
          <button class="tab ${state.view === 'ranking' ? 'active' : ''}" data-view="ranking">Ranking</button>
          <button class="tab ${state.view === 'detail' && state.selectedPartId === state.participant.id ? 'active' : ''}" data-view="me">Meus jogos</button>
          <button class="tab ${state.view === 'bet' ? 'active' : ''}" data-view="bet">Apostar</button>
        </div>
      </div>
    </header>
    <main id="main"></main>`;

  document.getElementById('logout').onclick = async () => { await sb.auth.signOut(); location.reload(); };
  root.querySelectorAll('[data-view]').forEach(b => b.onclick = () => {
    const v = b.dataset.view;
    if (v === 'me') { state.view = 'detail'; state.selectedPartId = state.participant.id; }
    else { state.view = v; }
    render();
  });

  const main = document.getElementById('main');
  if (state.view === 'ranking') renderRanking(main);
  else if (state.view === 'detail') renderDetail(main);
  else if (state.view === 'bet') renderBet(main);
  // só rola pro topo quando navega (troca aba/fase/pessoa), não a cada +/-
  const navKey = state.view + '|' + state.selectedPartId + '|' + state.betPhase;
  if (navKey !== lastNavKey) { window.scrollTo(0, 0); lastNavKey = navKey; }
}

function phaseStepperHTML() {
  return `<div style="display:flex;gap:8px;">` + PHASE_ORDER.map(ph => {
    const hasAny = state.games.some(g => g.phase === ph && gameReady(g));
    const locked = !hasAny;
    return `<div class="chip" style="background:${locked ? 'var(--soft)' : 'var(--green)'};color:${locked ? '#A79E82' : 'var(--bg)'};">
      <span>${PHASE_LABELS[ph]}</span>${locked ? lockSvg('currentColor') : ''}</div>`;
  }).join('') + `</div>`;
}

function lockSvg(color) {
  return `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" style="opacity:.65;">
    <rect x="5" y="11" width="14" height="9" rx="2" stroke="${color}" stroke-width="2"/>
    <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="${color}" stroke-width="2"/></svg>`;
}

function withRank(list) {
  let rank = 0, prev = null;
  return list.map((p, i) => {
    if (p.points !== prev) { rank = i + 1; prev = p.points; }
    return { ...p, rank };
  });
}

// ============================================================
// RANKING
// ============================================================
function renderRanking(main) {
  const ranked = withRank(state.ranking);
  if (!ranked.length) {
    main.innerHTML = phaseStepperHTML() +
      `<div class="card" style="padding:28px;text-align:center;color:var(--muted);font-weight:600;">Ainda não há apostas. Seja o primeiro na aba <b>Apostar</b>!</div>`;
    return;
  }
  const podium3 = ranked.slice(0, 3);
  const order = podium3.length === 3 ? [podium3[1], podium3[0], podium3[2]] : podium3;
  const medal = ['#F4B942', '#C9CDD6', '#D89A5C'];
  const medalT = ['#7A5A0A', '#4A4E58', '#6B3F1D'];

  const podium = order.map(p => {
    const orig = podium3.indexOf(p), first = orig === 0;
    return `<div data-part="${p.participant_id}" style="display:flex;flex-direction:column;align-items:center;gap:8px;cursor:pointer;flex:1;">
      <div style="width:${first ? 58 : 48}px;height:${first ? 58 : 48}px;border-radius:50%;background:${avatarColor(p.participant_id)};color:#fff;display:flex;align-items:center;justify-content:center;font-family:'Archivo';font-weight:800;font-size:${first ? 20 : 16}px;border:3px solid ${medal[orig]};">${esc(initials(p.display_name))}</div>
      <div class="arch" style="font-weight:800;font-size:13px;text-align:center;max-width:88px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(p.display_name)}</div>
      <div style="width:100%;height:${first ? 66 : 48}px;background:${medal[orig]};color:${medalT[orig]};border-radius:10px 10px 4px 4px;display:flex;flex-direction:column;align-items:center;justify-content:center;">
        <span class="arch" style="font-weight:900;font-size:22px;">${p.points}</span>
        <span style="font-size:10px;font-weight:700;opacity:.75;">PTS</span>
      </div></div>`;
  }).join('');

  const rest = ranked.slice(3).map(p => {
    const you = p.participant_id === state.participant.id;
    return `<div data-part="${p.participant_id}" style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-top:1px solid #F1EBD6;cursor:pointer;background:${you ? '#FBF4DF' : 'transparent'};">
      <div class="arch" style="width:26px;font-weight:800;font-size:14px;color:#8A9A8F;">${p.rank}</div>
      <div style="width:38px;height:38px;border-radius:50%;flex-shrink:0;background:${avatarColor(p.participant_id)};color:#fff;display:flex;align-items:center;justify-content:center;font-family:'Archivo';font-weight:800;font-size:13px;">${esc(initials(p.display_name))}</div>
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;">
        <span style="font-weight:700;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(p.display_name)}</span>
        ${you ? `<span style="font-size:11px;font-weight:700;color:var(--green);">você</span>` : ''}
      </div>
      <div class="arch" style="font-weight:900;font-size:17px;color:var(--green);">${p.points}</div>
    </div>`;
  }).join('');

  main.innerHTML = phaseStepperHTML() +
    `<div style="display:flex;align-items:end;gap:8px;padding:8px 4px 4px;">${podium}</div>` +
    (rest ? `<div class="card" style="overflow:hidden;">${rest}</div>` : '');

  main.querySelectorAll('[data-part]').forEach(el => el.onclick = () => {
    state.view = 'detail'; state.selectedPartId = el.dataset.part; render();
  });
}

// ============================================================
// DETALHE (meus jogos / de alguém)
// ============================================================
function renderDetail(main) {
  const ranked = withRank(state.ranking);
  const p = ranked.find(x => x.participant_id === state.selectedPartId);
  if (!p) { state.view = 'ranking'; return render(); }

  const header = `
    <div id="back" style="display:flex;align-items:center;gap:6px;font-weight:700;font-size:14px;color:var(--green);cursor:pointer;width:fit-content;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Ranking
    </div>
    <div class="card" style="padding:20px;display:flex;align-items:center;gap:16px;">
      <div style="width:60px;height:60px;border-radius:50%;background:${avatarColor(p.participant_id)};color:#fff;display:flex;align-items:center;justify-content:center;font-family:'Archivo';font-weight:800;font-size:20px;">${esc(initials(p.display_name))}</div>
      <div style="flex:1;">
        <div class="arch" style="font-weight:900;font-size:20px;">${esc(p.display_name)}${p.participant_id === state.participant.id ? ' <span style="font-size:13px;color:var(--muted);">(você)</span>' : ''}</div>
        <div style="font-size:13px;color:var(--muted);font-weight:600;margin-top:2px;">${p.rank}º lugar no ranking</div>
      </div>
      <div style="text-align:center;">
        <div class="arch" style="font-weight:900;font-size:26px;color:var(--green);">${p.points}</div>
        <div style="font-size:10px;font-weight:700;color:var(--muted);letter-spacing:.4px;">PONTOS</div>
      </div>
    </div>`;

  const isMe = p.participant_id === state.participant.id;
  const bets = state.betsByPart[p.participant_id] || {};
  const badgeColors = { 10: ['#F4B942', '#4A3A0A'], 7: ['#2E7D46', '#fff'], 5: ['#D98C2B', '#fff'], 0: ['#E4DEC7', '#8A8365'] };

  const phasesHTML = PHASE_ORDER.map(ph => {
    const anyInPhase = state.games.some(g => g.phase === ph);
    if (!anyInPhase) return '';
    const games = state.games.filter(g => g.phase === ph && gameReady(g));
    const undefinedPhase = games.length === 0;
    let body;
    if (undefinedPhase) {
      body = `<div style="background:var(--soft);border:1px dashed var(--line2);border-radius:14px;padding:16px;font-size:13px;font-weight:600;color:#9A9179;text-align:center;">Chave ainda não definida</div>`;
    } else {
      body = games.map(g => {
        const bet = bets[g.id];
        const pts = computePoints(g, bet);
        const locked = isLocked(g);
        let right, sub;
        if (g.played) {
          const [bg, fg] = badgeColors[pts != null ? pts : 0];
          right = `<div class="badge" style="background:${bg};color:${fg};">${pts != null ? '+' + pts + ' pts' : '—'}</div>`;
          sub = bet ? `Palpite: ${bet.score_a}-${bet.score_b}${bet.score_a === bet.score_b ? ` (avança ${esc(teamName(bet.advances))})` : ''}` : 'Não apostou';
        } else {
          const placed = !!bet;
          right = `<div class="badge" style="background:${placed ? '#DCEFE1' : '#F3E3D0'};color:${placed ? 'var(--green)' : '#A0662E'};">${placed ? (locked ? 'Aguardando' : 'Palpite feito') : 'Pendente'}</div>`;
          // só mostra o palpite do próprio usuário enquanto o jogo não começou
          sub = placed ? ((isMe || locked) ? `Palpite: ${bet.score_a}-${bet.score_b}` : 'Palpite registrado') : 'Sem palpite';
        }
        const res = g.played ? `${g.score_a} - ${g.score_b}` : 'vs';
        return `<div class="card" style="padding:14px 16px;display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="font-size:12px;font-weight:700;color:var(--muted);">${kickoffLabel(g.kickoff)}</div>${right}
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="flex:1;font-weight:700;font-size:14px;">${esc(teamLabel(g.team_a))}</div>
            <div class="arch" style="font-weight:900;font-size:16px;background:var(--field);border-radius:8px;padding:4px 10px;min-width:52px;text-align:center;">${res}</div>
            <div style="flex:1;font-weight:700;font-size:14px;text-align:right;">${esc(teamLabel(g.team_b))}</div>
          </div>
          <div style="font-size:12px;color:var(--muted);font-weight:600;">${sub}</div>
        </div>`;
      }).join('');
    }
    return `<div style="display:flex;flex-direction:column;gap:10px;">
      <div class="arch" style="font-weight:800;font-size:15px;color:var(--green);padding-left:2px;">${PHASE_LABELS[ph]}</div>${body}</div>`;
  }).join('');

  main.innerHTML = header + phasesHTML;
  document.getElementById('back').onclick = () => { state.view = 'ranking'; render(); };
}

// ============================================================
// APOSTAR
// ============================================================
function renderBet(main) {
  const tabs = `<div style="display:flex;gap:8px;">` + PHASE_ORDER.map(ph => {
    const hasAny = state.games.some(g => g.phase === ph && gameReady(g));
    const active = state.betPhase === ph;
    return `<button class="chip" data-phase="${ph}" ${hasAny ? '' : 'disabled'} style="
      background:${active ? 'var(--gold)' : (hasAny ? 'rgba(14,74,48,.12)' : 'var(--soft)')};
      color:${active ? 'var(--green2)' : (hasAny ? 'var(--green)' : '#A79E82')};
      cursor:${hasAny ? 'pointer' : 'default'};">
      <span>${PHASE_LABELS[ph]}</span>${hasAny ? '' : lockSvg('currentColor')}</button>`;
  }).join('') + `</div>`;

  const games = state.games.filter(g => g.phase === state.betPhase && gameReady(g));
  let body;
  if (!games.length) {
    body = `<div style="background:var(--soft);border:1px dashed var(--line2);border-radius:16px;padding:28px 16px;text-align:center;font-size:14px;font-weight:600;color:#9A9179;display:flex;flex-direction:column;gap:8px;align-items:center;">
      ${lockSvg('#9A9179')} As apostas desta fase abrem quando a chave estiver definida.</div>`;
  } else {
    body = games.map(g => betCardHTML(g)).join('');
  }

  main.innerHTML = tabs + `<div style="display:flex;flex-direction:column;gap:18px;">${body}</div>`;

  main.querySelectorAll('[data-phase]').forEach(b => b.onclick = () => {
    if (b.disabled) return; state.betPhase = b.dataset.phase; render();
  });
  wireBetCards(main);
}

function editState(g) {
  if (!state.edit[g.id]) {
    const bet = myBet(g.id);
    state.edit[g.id] = bet
      ? { score_a: bet.score_a, score_b: bet.score_b, advances: bet.advances, dirty: false, saving: false }
      : { score_a: 0, score_b: 0, advances: null, dirty: false, saving: false };
  }
  return state.edit[g.id];
}

function betCardHTML(g) {
  const locked = isLocked(g);
  const bet = myBet(g.id);

  // topo
  const status = locked
    ? (g.played
      ? `<div class="badge" style="background:#E4DEC7;color:#8A8365;">Encerrado</div>`
      : `<div class="badge" style="background:#E4DEC7;color:#8A8365;">Fechado</div>`)
    : (bet
      ? `<div class="badge" style="background:#DCEFE1;color:var(--green);">Palpite salvo</div>`
      : `<div class="badge" style="background:#F3E3D0;color:#A0662E;">Sem palpite</div>`);

  let middle, footer = '';

  if (locked) {
    // somente leitura
    const scoreBox = bet ? `${bet.score_a} - ${bet.score_b}` : '— · —';
    middle = `<div class="arch" style="font-weight:900;font-size:19px;background:var(--field);border-radius:10px;padding:6px 16px;">${scoreBox}</div>`;
    if (g.played) {
      const pts = computePoints(g, bet);
      footer = `<div style="text-align:center;font-size:12px;font-weight:700;color:var(--green);">Resultado: ${g.score_a}-${g.score_b} · ${bet ? `seu palpite ${bet.score_a}-${bet.score_b} · +${pts} pontos` : 'você não apostou'}</div>`;
    } else if (bet) {
      footer = `<div style="text-align:center;font-size:12px;font-weight:700;color:var(--muted);">Jogo começou — palpite trancado</div>`;
    } else {
      footer = `<div style="text-align:center;font-size:12px;font-weight:700;color:#A0662E;">As apostas para este jogo encerraram.</div>`;
    }
  } else {
    const e = editState(g);
    const stepBtns = (team) => `
      <button class="step" data-act="dec" data-game="${g.id}" data-team="${team}">−</button>
      <div style="width:34px;text-align:center;" class="arch" style="font-weight:900;font-size:19px;">${e['score_' + team.toLowerCase()]}</div>
      <button class="step" data-act="inc" data-game="${g.id}" data-team="${team}">+</button>`;
    middle = `<div style="display:flex;align-items:center;gap:6px;">${stepBtns('A')}</div>
      <div class="arch" style="font-weight:900;font-size:16px;color:var(--line2);">×</div>
      <div style="display:flex;align-items:center;gap:6px;">${stepBtns('B')}</div>`;

    const showAdv = e.score_a === e.score_b;
    const advHTML = showAdv ? `<div style="display:flex;align-items:center;justify-content:center;gap:8px;font-size:12px;font-weight:700;color:var(--muted);flex-wrap:wrap;">
        <span>Empate — quem avança:</span>
        ${['A', 'B'].map(t => {
          const code = t === 'A' ? g.team_a : g.team_b;
          const on = e.advances === code;
          return `<button data-act="adv" data-game="${g.id}" data-team="${t}" style="padding:3px 10px;border-radius:20px;border:none;background:${on ? 'var(--green)' : 'var(--field)'};color:${on ? '#fff' : 'var(--text)'};font-weight:700;">${esc(teamName(code))}</button>`;
        }).join('')}
      </div>` : '';

    const saved = bet && !e.dirty;
    footer = advHTML + `<button data-act="save" data-game="${g.id}" ${e.saving ? 'disabled' : ''} style="text-align:center;padding:11px;border-radius:10px;border:none;font-weight:800;font-size:13px;background:${saved ? '#EAF4EC' : 'var(--gold)'};color:${saved ? 'var(--green)' : 'var(--green2)'};">${e.saving ? 'Salvando…' : (saved ? 'Palpite salvo ✓' : (bet ? 'Atualizar palpite' : 'Salvar palpite'))}</button>`;
  }

  return `<div class="card" style="padding:16px;display:flex;flex-direction:column;gap:12px;">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div style="font-size:12px;font-weight:700;color:var(--muted);">${kickoffLabel(g.kickoff)}</div>${status}
    </div>
    <div style="display:flex;align-items:center;gap:14px;">
      <div style="flex:1;text-align:center;font-weight:800;font-size:15px;">${esc(teamLabel(g.team_a))}</div>
      ${middle}
      <div style="flex:1;text-align:center;font-weight:800;font-size:15px;">${esc(teamLabel(g.team_b))}</div>
    </div>
    ${footer}
  </div>`;
}

function wireBetCards(main) {
  main.querySelectorAll('[data-act]').forEach(el => {
    const gid = el.dataset.game;
    el.onclick = () => {
      const act = el.dataset.act;
      if (act === 'inc' || act === 'dec') {
        const e = editState(state.games.find(g => g.id === gid));
        const key = 'score_' + el.dataset.team.toLowerCase();
        e[key] = Math.max(0, Math.min(19, e[key] + (act === 'inc' ? 1 : -1)));
        if (e.score_a !== e.score_b) e.advances = null;
        e.dirty = true; render();
      } else if (act === 'adv') {
        const g = state.games.find(x => x.id === gid);
        const e = editState(g);
        e.advances = el.dataset.team === 'A' ? g.team_a : g.team_b;
        e.dirty = true; render();
      } else if (act === 'save') {
        saveBet(gid);
      }
    };
  });
}

function betRow(gameId, e) {
  return {
    participant_id: state.participant.id, game_id: gameId,
    score_a: e.score_a, score_b: e.score_b,
    advances: e.score_a === e.score_b ? e.advances : null,
  };
}

async function saveBet(gameId) {
  const g = state.games.find(x => x.id === gameId);
  const e = editState(g);
  if (e.score_a === e.score_b && !e.advances) { toast('No empate, escolha quem avança.'); return; }
  e.saving = true; render();
  let { data, error } = await sb.from('bets')
    .upsert(betRow(gameId, e), { onConflict: 'participant_id,game_id' }).select('*').single();

  // RLS recusou (42501): o cadastro pode ter mudado (ex.: admin removeu e
  // re-adicionou o jogador) — revincula o participante e tenta uma vez de novo.
  if (error && error.code === '42501') {
    const { data: part } = await sb.rpc('claim_participant', { p_group: state.group.id });
    if (part && part.id && part.id !== state.participant.id) {
      state.participant = { id: part.id, display_name: part.display_name };
      ({ data, error } = await sb.from('bets')
        .upsert(betRow(gameId, e), { onConflict: 'participant_id,game_id' }).select('*').single());
    }
  }

  e.saving = false;
  if (error) {
    await loadAll();  // dados frescos (kickoff pode ter mudado no servidor)
    const fresh = state.games.find(x => x.id === gameId);
    if (fresh && isLocked(fresh)) toast('Este jogo já começou — apostas encerradas.');
    else if (error.code === '42501') toast('O banco recusou o palpite. Recarregue a página e tente de novo.');
    else toast('Não deu para salvar: ' + error.message);
    render(); return;
  }
  (state.betsByPart[state.participant.id] || (state.betsByPart[state.participant.id] = {}))[gameId] = data;
  e.dirty = false;
  toast('Palpite salvo!');
  render();
}

// ---------- gate genérico (login / avisos) ----------
function renderGate(inner) {
  root.className = '';
  root.innerHTML = `<div class="gate"><div class="gate-card">${inner}</div></div>`;
}

init();
