/* Borracharia Já — protótipo navegável dos fluxos:
 *  1. Onboarding/login: Splash → decisão (convidado | login) → seletor de modo
 *  2. Modo motorista: mapa com status ao vivo, busca/filtros, SOS, perfil,
 *     favoritos, avaliação pós-visita e reportar status (os 3 últimos exigem login)
 *  3. Modo borracheiro: dashboard, toggle de status, alerta de divergência,
 *     editar perfil, avaliações recebidas e métricas */
(() => {
  'use strict';

  // ---------------------------------------------------------------- utilidades
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const wait = ms => new Promise(r => setTimeout(r, ms));

  function distKm(a, b) {
    const R = 6371, toR = x => x * Math.PI / 180;
    const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const fmtKm = km => km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1).replace('.', ',')} km`;

  function timeAgo(ts) {
    const min = Math.round((Date.now() - ts) / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `há ${h} h`;
    const d = Math.round(h / 24);
    return `há ${d} dia${d > 1 ? 's' : ''}`;
  }
  const fmtDate = ts => new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });

  function fmtPhone(d) {
    d = String(d || '').replace(/\D/g, '');
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return d;
  }

  // Resolve com { pos } ou { error: 'unsupported' | 'denied' | 'unavailable' | 'timeout' }.
  // O timer externo cobre o caso do usuário ignorar o pop-up do navegador.
  function getPosition(timeout = 12000) {
    return new Promise(resolve => {
      if (!navigator.geolocation) return resolve({ error: 'unsupported' });
      const timer = setTimeout(() => resolve({ error: 'timeout' }), timeout + 20000);
      navigator.geolocation.getCurrentPosition(
        p => { clearTimeout(timer); resolve({ pos: { lat: p.coords.latitude, lng: p.coords.longitude } }); },
        err => {
          clearTimeout(timer);
          resolve({ error: err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable' });
        },
        { enableHighAccuracy: true, timeout, maximumAge: 30000 });
    });
  }

  async function geoPermission() {
    try {
      if (!navigator.permissions) return 'unknown';
      return (await navigator.permissions.query({ name: 'geolocation' })).state; // granted | prompt | denied
    } catch {
      return 'unknown';
    }
  }

  function readImage(file, max = 800) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          const sc = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * sc);
          c.height = Math.round(img.height * sc);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.72));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ------------------------------------------------------------ regras de status
  const STATUS = {
    aberto: { key: 'aberto', cls: 'open', label: 'Aberta', icon: '✓' },
    fechado: { key: 'fechado', cls: 'closed', label: 'Fechada', icon: '✕' },
    incerto: { key: 'incerto', cls: 'unsure', label: 'Incerta', icon: '?' },
  };
  const REPORT_WINDOW = 2 * HOUR;

  // Reports válidos: últimas 2h e depois da última atualização do dono.
  function recentReports(shop) {
    const since = Math.max(Date.now() - REPORT_WINDOW, shop.statusUpdatedAt || 0);
    return shop.reports.filter(r => r.at > since);
  }

  function liveStatus(shop) {
    const rec = recentReports(shop);
    const agree = rec.filter(r => r.status === shop.status).length;
    const disagree = rec.length - agree;
    const key = disagree > agree ? 'incerto' : shop.status;
    return { ...STATUS[key], agree, disagree, total: rec.length };
  }

  // Para o dono: avisa assim que os reports empatam ou superam o status informado.
  function divergence(shop) {
    const s = liveStatus(shop);
    return s.disagree > 0 && s.disagree >= s.agree ? s : null;
  }

  function lastUpdate(shop) {
    return Math.max(shop.statusUpdatedAt || 0, ...shop.reports.map(r => r.at));
  }

  function confidence(shop) {
    const rec = shop.reports.filter(r => Date.now() - r.at < 30 * DAY);
    if (!rec.length) return null;
    const ok = rec.filter(r => r.status === r.ownerStatus).length;
    return { pct: Math.round(ok / rec.length * 100), ok, n: rec.length };
  }

  function rating(shop) {
    const n = shop.reviews.length;
    if (!n) return null;
    return { avg: shop.reviews.reduce((a, r) => a + r.stars, 0) / n, n };
  }
  const fmtRating = r => r ? `★ ${r.avg.toFixed(1).replace('.', ',')} (${r.n})` : '★ sem avaliações';

  function todayHours(shop) {
    const h = shop.hours[new Date().getDay()];
    return hoursLabel(h);
  }
  function hoursLabel(h) {
    if (!h || !h.enabled) return 'Fechado';
    if (h.open === '00:00' && h.close === '23:59') return '24 horas';
    return `${h.open}–${h.close}`;
  }

  const badge = st => `<span class="badge ${st.cls}">${st.icon} ${st.label}</span>`;
  const thumb = shop => `<div class="thumb">${shop.photos[0]
    ? `<img src="${esc(shop.photos[0])}" alt="">` : '🛞'}</div>`;

  // -------------------------------------------------------------------- estado
  const state = {
    me: { ...DEFAULT_CENTER },
    located: false,
    mode: null,
    filters: { q: '', maxKm: 0, services: [], status: 'todas' },
    history: [],
    current: null,
    mapStarted: false,
    listOpen: false,
    afterLogin: null,
  };

  const screenEl = $('#screen');
  const mapScreen = $('#map-screen');
  const navEl = $('#nav');
  const sheetEl = $('#sheet');
  const backdropEl = $('#sheet-backdrop');
  const toastEl = $('#toast');

  // ------------------------------------------------------------------ roteador
  const routes = {};

  function go(name, params = {}, { reset = false, replace = false } = {}) {
    if (reset) state.history = [];
    else if (state.current && !replace) state.history.push(state.current);
    state.current = { name, params };
    if (name === 'shop') trackView(params.id);
    render();
  }

  function back() {
    const prev = state.history.pop();
    if (!prev) return;
    state.current = prev;
    render();
  }

  function render(keepScroll = false) {
    const { name, params } = state.current;
    const r = routes[name](params);
    if (r.redirect) return go(r.redirect, {}, { replace: true });
    closeSheet();

    if (r.map) {
      screenEl.classList.add('hidden');
      mapScreen.classList.remove('hidden');
      initMap();
      refreshMap();
    } else {
      mapScreen.classList.add('hidden');
      screenEl.classList.remove('hidden');
      const top = screenEl.scrollTop;
      screenEl.innerHTML = r.html;
      screenEl.scrollTop = keepScroll ? top : 0;
    }

    const hasNav = Boolean(r.nav);
    navEl.classList.toggle('hidden', !hasNav);
    screenEl.classList.toggle('with-nav', hasNav);
    mapScreen.classList.toggle('with-nav', hasNav);
    if (hasNav) renderNav(r.nav, r.tab);

    if (r.after) r.after(r.map ? mapScreen : screenEl);
  }

  function header(title, { showBack = state.history.length > 0, right = '' } = {}) {
    return `<header class="page-header">
      ${showBack ? '<button class="back-btn" data-back aria-label="Voltar">←</button>' : '<span style="width:8px"></span>'}
      <h2>${esc(title)}</h2>${right}
    </header>`;
  }

  const NAVS = {
    driver: [
      { tab: 'map', route: 'map', icon: '🗺️', label: 'Mapa' },
      { tab: 'sos', route: 'sos', icon: 'SOS', label: 'Socorro', cls: 'sos-btn' },
      { tab: 'fav', route: 'favorites', icon: '★', label: 'Favoritos' },
      { tab: 'account', route: 'account', icon: '👤', label: 'Conta' },
    ],
    biz: [
      { tab: 'dash', route: 'dash', icon: '📊', label: 'Painel' },
      { tab: 'reviews', route: 'bizReviews', icon: '💬', label: 'Avaliações' },
      { tab: 'edit', route: 'bizEdit', icon: '✏️', label: 'Perfil' },
      { tab: 'account', route: 'account', icon: '👤', label: 'Conta' },
    ],
  };

  function renderNav(kind, active) {
    navEl.innerHTML = NAVS[kind].map(n => `
      <button type="button" class="${n.cls || ''} ${n.tab === active ? 'active' : ''}" data-nav="${n.route}">
        <span class="i">${n.icon}</span>${n.label}
      </button>`).join('');
  }

  // ------------------------------------------------------------ sheet e toast
  let sheetOnClose = null;
  function openSheet(html, after, onClose) {
    closeSheet();
    sheetEl.onclick = sheetEl.oninput = sheetEl.onsubmit = null;
    sheetEl.innerHTML = html;
    sheetEl.classList.remove('hidden');
    backdropEl.classList.remove('hidden');
    sheetOnClose = onClose || null;
    if (after) after(sheetEl);
  }
  function closeSheet() {
    sheetEl.classList.add('hidden');
    backdropEl.classList.add('hidden');
    sheetEl.innerHTML = '';
    const fn = sheetOnClose;
    sheetOnClose = null;
    if (fn) fn();
  }
  const sheetOpen = () => !sheetEl.classList.contains('hidden');
  backdropEl.addEventListener('click', closeSheet);

  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 3200);
  }

  // ---------------------------------------------------------------- localização
  // Fluxo: checa a permissão → mensagem do app explicando o porquê →
  // pop-up do navegador → aplica a posição e passa a acompanhar o movimento.
  const LOCATION_ASK_COOLDOWN = DAY; // após "Agora não", só pergunta sozinho no dia seguinte
  let locating = null;
  let lastWatchRefresh = 0;

  function askLocationPermission() {
    return new Promise(resolve => {
      let allowed = false;
      openSheet(`
        <div class="center">
          <div class="loc-hero" aria-hidden="true">📍</div>
          <h3>Permitir acesso à sua localização?</h3>
          <p class="muted" style="margin-bottom:4px">O Borracharia Já usa sua localização para:</p>
        </div>
        <ul class="perk-list">
          <li><span>🛞</span><span>Mostrar as borracharias <strong>mais perto de você</strong></span></li>
          <li><span>📏</span><span>Calcular a <strong>distância real</strong> até cada uma</span></li>
          <li><span>🆘</span><span>Achar ajuda mais rápido no <strong>SOS</strong></span></li>
        </ul>
        <p class="small muted center">Usada só enquanto o app está aberto. Não guardamos seu histórico de localização.</p>
        <div class="stack">
          <button class="btn primary block" id="loc-allow">Permitir localização</button>
          <button class="btn ghost block" id="loc-later">Agora não</button>
        </div>
        <p class="small muted center" style="margin-bottom:0">Em seguida o navegador vai pedir sua confirmação.</p>`,
      root => {
        $('#loc-allow', root).onclick = () => { allowed = true; closeSheet(); };
        $('#loc-later', root).onclick = closeSheet;
      },
      () => {
        if (!allowed) {
          DB.data.locationAskedAt = Date.now();
          DB.save();
          toast('Tudo bem! Usando uma localização padrão. Toque em ◎ no mapa quando quiser ativar.');
        }
        resolve(allowed);
      });
    });
  }

  function showLocationBlocked() {
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const steps = ios
      ? ['Abra os <strong>Ajustes</strong> do iPhone',
        'Em <strong>Privacidade → Serviços de Localização</strong>, deixe ligado',
        'Toque no seu navegador (ex.: <strong>Safari</strong>) e escolha <strong>Durante o uso</strong>',
        'Volte aqui e toque em <strong>Tentar de novo</strong>']
      : ['Toque no <strong>ícone ao lado do endereço</strong> do site (🔒 ou ⓘ)',
        'Abra <strong>Permissões</strong> ou <strong>Configurações do site</strong>',
        'Em <strong>Localização</strong>, escolha <strong>Permitir</strong>',
        'Volte aqui e toque em <strong>Tentar de novo</strong> (se não funcionar, recarregue a página)'];
    openSheet(`
      <div class="center">
        <div class="loc-hero blocked" aria-hidden="true">📍</div>
        <h3>Localização bloqueada</h3>
        <p class="muted">O navegador está impedindo o acesso à sua localização. Para liberar:</p>
      </div>
      <ol class="steps">${steps.map(s => `<li>${s}</li>`).join('')}</ol>
      <div class="stack">
        <button class="btn primary block" id="loc-retry">Tentar de novo</button>
        <button class="btn ghost block" id="loc-ok">Continuar sem localização</button>
      </div>`, root => {
      $('#loc-retry', root).onclick = () => { closeSheet(); useMyLocation(); };
      $('#loc-ok', root).onclick = closeSheet;
    });
  }

  // auto: chamado pelo app (não pelo usuário) — não insiste e não mostra erros.
  function useMyLocation(opts = {}) {
    if (!locating) locating = locate(opts).finally(() => { locating = null; });
    return locating;
  }

  async function locate({ center = true, auto = false }) {
    if (!navigator.geolocation) {
      if (!auto) toast('Este navegador não oferece localização.');
      return null;
    }
    const perm = await geoPermission();
    if (perm === 'denied') {
      if (!auto) showLocationBlocked();
      return null;
    }
    if (perm === 'granted' && auto && state.located) {
      startWatch();
      return state.me;
    }
    if (perm !== 'granted') {
      if (auto && Date.now() - (DB.data.locationAskedAt || 0) < LOCATION_ASK_COOLDOWN) return null;
      if (!(await askLocationPermission())) return null;
    }
    if (!auto) toast('📍 Buscando sua localização…');
    const r = await getPosition();
    if (r.error) {
      if (r.error === 'denied') {
        DB.data.locationAskedAt = Date.now();
        DB.save();
        toast('Sem permissão de localização. Você pode ativar depois no botão ◎ do mapa.');
      } else if (!auto) {
        toast(r.error === 'timeout'
          ? 'A localização demorou demais. Tente de novo, de preferência em lugar aberto.'
          : 'Não conseguimos achar sua posição. Verifique se o GPS/localização do aparelho está ligado.');
      }
      return null;
    }
    const wasLocated = state.located;
    applyLocation(r.pos, center);
    if (!wasLocated || !auto) toast('📍 Localização ativada');
    startWatch();
    return r.pos;
  }

  function applyLocation(pos, center = false) {
    state.me = pos;
    state.located = true;
    DB.recenterSeed(pos, distKm);
    MapView.setMe(pos);
    if (center) MapView.setView(pos, 15);
    refreshForLocation();
  }

  function refreshForLocation() {
    const name = state.current && state.current.name;
    if (name === 'map') refreshMap();
    else if (['sos', 'favorites', 'shop'].includes(name) && !sheetOpen()) render(true);
  }

  // Acompanha o movimento (o pontinho azul anda junto com o motorista).
  function startWatch() {
    if (state.watchId != null || !navigator.geolocation) return;
    state.watchId = navigator.geolocation.watchPosition(p => {
      const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
      if (state.located && distKm(state.me, pos) < 0.015) return; // ignora oscilação < 15 m
      state.me = pos;
      state.located = true;
      MapView.setMe(pos);
      if (Date.now() - lastWatchRefresh > 5000) {
        lastWatchRefresh = Date.now();
        refreshForLocation();
      }
    }, err => {
      if (err.code === 1) {
        navigator.geolocation.clearWatch(state.watchId);
        state.watchId = null;
      }
    }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
  }

  // --------------------------------------------------------- cliques globais
  document.addEventListener('click', e => {
    if (e.target.closest('[data-back]')) return back();

    const navBtn = e.target.closest('[data-nav]');
    if (navBtn) return go(navBtn.dataset.nav, {}, { reset: true });

    const link = e.target.closest('[data-go]');
    if (link) return go(link.dataset.go, { id: link.dataset.id });

    const tracked = e.target.closest('[data-track]');
    if (tracked) {
      const shop = DB.shop(tracked.dataset.id);
      const u = DB.user();
      if (shop && (!u || shop.ownerId !== u.id)) shop.metrics[tracked.dataset.track]++;
      if (shop && tracked.dataset.track === 'routes') {
        DB.data.pendingVisit = { shopId: shop.id, at: Date.now() };
      }
      DB.save();
    }
  });

  // ------------------------------------------------------------- autenticação
  function requireLogin(reason, fn) {
    if (DB.user()) return fn();
    openSheet(`
      <h3>🔒 Entre para ${esc(reason)}</h3>
      <p class="muted">No modo convidado você vê o mapa, busca borracharias e usa o SOS.
        Para ${esc(reason)} é preciso uma conta — leva menos de um minuto.</p>
      <div class="stack">
        <button class="btn login block" id="gate-login">Entrar ou cadastrar</button>
        <button class="btn ghost block" id="gate-cancel">Agora não</button>
      </div>`, root => {
      $('#gate-login', root).onclick = () => { state.afterLogin = fn; go('login'); };
      $('#gate-cancel', root).onclick = closeSheet;
    });
  }

  function createUser(fields) {
    const u = { id: uid('u'), favorites: [], createdAt: Date.now(), ...fields };
    DB.data.users.push(u);
    return u;
  }

  function loginAs(u) {
    DB.data.session.userId = u.id;
    DB.data.session.guest = false;
    DB.save();
    toast(`Olá, ${u.name}!`);
    if (state.afterLogin) {
      const fn = state.afterLogin;
      state.afterLogin = null;
      back();
      fn();
    } else {
      go('mode', {}, { reset: true });
    }
  }

  function endSession() {
    DB.data.session = { userId: null, guest: false, mode: null };
    state.mode = null;
    DB.save();
    go('welcome', {}, { reset: true });
  }

  function enterDriver() {
    state.mode = 'driver';
    DB.data.session.mode = 'driver';
    DB.save();
    go('map', {}, { reset: true });
    setTimeout(() => useMyLocation({ center: true, auto: true }).then(checkPendingVisit), 500);
  }

  function enterBiz() {
    state.mode = 'biz';
    DB.data.session.mode = 'biz';
    DB.save();
    go(DB.ownedShop() ? 'dash' : 'bizSetup', {}, { reset: true });
  }

  // ============================================================ 1. ONBOARDING
  routes.splash = () => ({
    html: `<div class="splash"><div>
      <div class="logo" aria-hidden="true">🛞</div>
      <h1>Borracharia Já</h1>
      <p>Borracharias abertas perto de você</p>
    </div></div>`,
  });

  // Tela de decisão: entrar sem login ou logar?
  routes.welcome = () => ({
    html: `
      <div class="hero">
        <div style="font-size:40px">🛞</div>
        <h1>Pneu furou?<br>A gente acha quem resolve.</h1>
        <p>Veja no mapa as borracharias abertas agora, com status confirmado por outros motoristas.</p>
      </div>
      <div class="page stack">
        <button class="choice guest" id="as-guest">
          <span class="emoji">🗺️</span>
          <span><strong>Entrar sem login</strong>
            <span class="small muted">Acesso imediato ao mapa. Reportar e avaliar pedem login depois.</span></span>
        </button>
        <button class="choice login" data-go="login">
          <span class="emoji">🔑</span>
          <span><strong>Entrar ou cadastrar</strong>
            <span class="small muted">E-mail e senha ou conta Google.</span></span>
        </button>
      </div>`,
    after(root) {
      $('#as-guest', root).onclick = () => {
        DB.data.session = { userId: null, guest: true, mode: null };
        DB.save();
        go('mode', {}, { reset: true });
      };
    },
  });

  const GOOGLE_LOGO = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;

  const AUTH_DEMO_REASON = {
    'sem-config': 'o Firebase ainda não foi configurado em <code>js/config.js</code>.',
    'arquivo-local': 'o app foi aberto direto pelo arquivo. Para o login real, use o site publicado ou dê dois cliques em <code>Abrir Borracharia Ja.bat</code>.',
    'erro': 'não foi possível carregar o Firebase agora.',
  };

  // Liga o perfil autenticado (Firebase ou demo) ao usuário local do app,
  // onde ficam favoritos e a borracharia dele (ainda sem banco de dados).
  function syncUser(p) {
    let u = DB.data.users.find(x => x.authUid === p.uid);
    if (!u) u = createUser({ authUid: p.uid });
    Object.assign(u, { name: p.name, email: p.email, photo: p.photo, provider: p.provider, emailVerified: p.emailVerified });
    DB.save();
    return u;
  }

  routes.login = () => ({
    html: `${header('Entrar ou cadastrar')}
      <div class="page stack">
        <p class="muted" style="margin-top:0">Com uma conta você pode favoritar, avaliar visitas,
          reportar status e cadastrar sua borracharia.</p>
        ${Auth.mode === 'demo' ? `<div class="demo-banner small">⚠️ <span><strong>Modo demonstração:</strong>
          ${AUTH_DEMO_REASON[Auth.reason] || ''} Nenhum dado sai deste navegador.</span></div>` : ''}
        <button type="button" class="btn block social-google" id="google-btn">${GOOGLE_LOGO} Continuar com Google</button>
        <div class="divider">ou use seu e-mail</div>
        <div class="tabs" role="tablist">
          <button type="button" class="active" data-tab="signin" role="tab">Entrar</button>
          <button type="button" data-tab="signup" role="tab">Criar conta</button>
        </div>
        <form id="auth-form" class="stack" novalidate></form>
        <p class="small muted center">Ao continuar, você concorda com os Termos de Uso e a Política de Privacidade.</p>
      </div>`,
    after(root) {
      const form = $('#auth-form', root);
      let tab = 'signin';
      let busy = false;

      const draw = () => {
        const email = form.elements.email ? form.elements.email.value : '';
        form.innerHTML = `
          ${tab === 'signup' ? `<label class="field"><span>Seu nome</span>
            <input class="input" name="name" autocomplete="name" maxlength="60" placeholder="Como quer ser chamado"></label>` : ''}
          <label class="field"><span>E-mail</span>
            <input class="input" name="email" type="email" autocomplete="email" placeholder="voce@email.com" value="${esc(email)}"></label>
          <label class="field"><span>Senha</span>
            <div class="pw-wrap">
              <input class="input" name="password" type="password" minlength="6"
                autocomplete="${tab === 'signup' ? 'new-password' : 'current-password'}"
                placeholder="${tab === 'signup' ? 'Mínimo de 6 caracteres' : 'Sua senha'}">
              <button type="button" class="pw-toggle" data-pw aria-label="Mostrar senha">👁</button>
            </div></label>
          <button class="btn primary block" type="submit">${tab === 'signup' ? 'Criar conta' : 'Entrar'}</button>
          ${tab === 'signin' ? '<button type="button" class="link-btn" data-forgot>Esqueci minha senha</button>' : ''}`;
      };

      const setBusy = (on, btn, label) => {
        busy = on;
        $$('button', root).forEach(b => { b.disabled = on; });
        if (btn) btn.dataset.label = btn.dataset.label || btn.innerHTML;
        if (btn) btn.innerHTML = on ? label : btn.dataset.label;
      };

      const finish = profile => {
        if (!profile) return; // login por redirecionamento: a página vai recarregar
        loginAs(syncUser(profile));
      };

      const googleBtn = $('#google-btn', root);
      googleBtn.onclick = async () => {
        if (busy) return;
        setBusy(true, googleBtn, 'Abrindo o Google…');
        try {
          finish(await Auth.google());
        } catch (e) {
          setBusy(false, googleBtn);
          toast(Auth.message(e));
        }
      };

      $$('[data-tab]', root).forEach(b => b.onclick = () => {
        tab = b.dataset.tab;
        $$('[data-tab]', root).forEach(x => x.classList.toggle('active', x === b));
        draw();
      });

      form.onclick = e => {
        const pw = e.target.closest('[data-pw]');
        if (pw) {
          const input = form.elements.password;
          const show = input.type === 'password';
          input.type = show ? 'text' : 'password';
          pw.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
          pw.textContent = show ? '🙈' : '👁';
        }
        if (e.target.closest('[data-forgot]')) openForgot(form.elements.email.value);
      };

      form.onsubmit = async e => {
        e.preventDefault();
        if (busy) return;
        const fd = new FormData(form);
        const name = String(fd.get('name') || '').trim();
        const email = String(fd.get('email') || '').trim();
        const password = String(fd.get('password') || '');
        if (tab === 'signup' && !name) return toast('Diga como quer ser chamado.');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('Informe um e-mail válido.');
        if (!password) return toast('Informe sua senha.');
        if (tab === 'signup' && password.length < 6) return toast('A senha precisa ter pelo menos 6 caracteres.');
        const btn = $('button[type=submit]', form);
        setBusy(true, btn, tab === 'signup' ? 'Criando conta…' : 'Entrando…');
        try {
          const p = tab === 'signup' ? await Auth.signUp(name, email, password) : await Auth.signIn(email, password);
          if (tab === 'signup' && Auth.mode === 'firebase') {
            setTimeout(() => toast(`Enviamos um e-mail de confirmação para ${p.email}.`), 3400);
          }
          finish(p);
        } catch (err) {
          setBusy(false, btn);
          toast(Auth.message(err));
        }
      };

      draw();
    },
  });

  function openForgot(email) {
    openSheet(`
      <h3>🔑 Redefinir senha</h3>
      <p class="muted">Informe o e-mail da sua conta. Vamos enviar um link para você criar uma nova senha.</p>
      <form class="stack" id="forgot-form" novalidate>
        <input class="input" name="email" type="email" autocomplete="email" placeholder="voce@email.com" value="${esc(email || '')}">
        <button class="btn primary block" type="submit">Enviar link</button>
        <button class="btn ghost block" type="button" id="forgot-cancel">Cancelar</button>
      </form>`, root => {
      $('#forgot-cancel', root).onclick = closeSheet;
      $('#forgot-form', root).onsubmit = async e => {
        e.preventDefault();
        const value = String(new FormData(e.target).get('email') || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return toast('Informe um e-mail válido.');
        try {
          await Auth.resetPassword(value);
          closeSheet();
          toast(Auth.mode === 'demo'
            ? 'Modo demonstração: nenhum e-mail é enviado.'
            : 'Se existir uma conta com esse e-mail, enviamos o link de redefinição.');
        } catch (err) {
          // Não revela se o e-mail existe; só mostra erros de formato/conexão.
          if (err.code === 'auth/user-not-found') { closeSheet(); toast('Se existir uma conta com esse e-mail, enviamos o link de redefinição.'); }
          else toast(Auth.message(err));
        }
      };
    });
  }

  // Seletor de modo: motorista ou borracheiro
  routes.mode = () => {
    const u = DB.user();
    return {
      html: `${header('Como você quer usar?')}
        <div class="page stack">
          <p class="muted" style="margin-top:0">${u
            ? `Olá, <strong>${esc(u.name)}</strong>! Você pode trocar de modo quando quiser.`
            : 'Você está como <strong>convidado</strong>. O modo borracheiro pede login.'}</p>
          <button class="choice mode" id="pick-driver">
            <span class="emoji">🚗</span>
            <span><strong>Sou motorista</strong>
              <span class="small muted">Encontrar borracharia aberta, SOS, rotas e avaliações.</span></span>
          </button>
          <button class="choice mode" id="pick-biz">
            <span class="emoji">🔧</span>
            <span><strong>Sou borracheiro</strong>
              <span class="small muted">Gerenciar status, perfil, avaliações e métricas do negócio.
              ${u ? '' : '<span class="badge login">🔒 exige login</span>'}</span></span>
          </button>
        </div>`,
      after(root) {
        $('#pick-driver', root).onclick = enterDriver;
        $('#pick-biz', root).onclick = () => requireLogin('gerenciar sua borracharia', enterBiz);
      },
    };
  };

  // ======================================================== 2. MODO MOTORISTA
  function filteredShops(f = state.filters) {
    const q = norm(f.q);
    return DB.data.shops
      .map(s => ({ s, km: distKm(state.me, s), st: liveStatus(s) }))
      .filter(x => !q || norm(`${x.s.name} ${x.s.address} ${x.s.services.join(' ')}`).includes(q))
      .filter(x => !f.maxKm || x.km <= f.maxKm)
      .filter(x => f.services.every(sv => x.s.services.includes(sv)))
      .filter(x => f.status === 'todas' || x.st.key === f.status)
      .sort((a, b) => a.km - b.km);
  }

  function shopCard({ s, km, st }) {
    return `<button type="button" class="shop-card" data-go="shop" data-id="${esc(s.id)}">
      ${thumb(s)}
      <div class="grow">
        <h4>${esc(s.name)}</h4>
        <div class="meta">${badge(st)}<span>📍 ${fmtKm(km)}</span><span>${fmtRating(rating(s))}</span></div>
        <div class="meta" style="margin-top:4px"><span>🕒 Hoje: ${todayHours(s)}</span></div>
      </div>
    </button>`;
  }

  const pinHtml = (st, pulse) =>
    `<div class="pin ${st.cls}${pulse ? ' pulse' : ''}" title="${st.label}"><span>${st.icon}</span></div>`;

  function initMap() {
    if (state.mapStarted) return MapView.resize();
    state.mapStarted = true;
    MapView.setMe(state.me);
    MapView.init($('#map'), state.me, 14, {
      googleKey: (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.googleMapsKey) || '',
      onFallback: reason => {
        if (reason !== 'sem-chave') toast('Google Maps indisponível agora. Usando OpenStreetMap.');
      },
    });

    $('#open-filters').onclick = openFilters;
    $('#toggle-list').onclick = () => { state.listOpen = !state.listOpen; renderList(); };
    $('#locate').onclick = () => useMyLocation({ center: true });
  }

  function refreshMap(pulseId) {
    if (!state.mapStarted) return;
    const items = filteredShops();
    const ids = new Set(items.map(x => x.s.id));
    MapView.ids().forEach(id => { if (!ids.has(id)) MapView.remove(id); });
    for (const { s, st } of items) {
      MapView.upsert(s.id, { lat: s.lat, lng: s.lng }, pinHtml(st, s.id === pulseId), s.name, () => openPeek(s.id));
    }
    const active = activeFilterCount();
    $('#search-summary').textContent = active
      ? `${state.filters.q ? `“${state.filters.q}” · ` : ''}${active} filtro${active > 1 ? 's' : ''} · ${items.length} resultado${items.length === 1 ? '' : 's'}`
      : 'Buscar borracharia, serviço…';
    renderList(items);
  }

  function activeFilterCount() {
    const f = state.filters;
    return (f.q ? 1 : 0) + (f.maxKm ? 1 : 0) + f.services.length + (f.status !== 'todas' ? 1 : 0);
  }

  function renderList(items) {
    const panel = $('#list-panel');
    panel.classList.toggle('hidden', !state.listOpen);
    $('#toggle-list').textContent = state.listOpen ? '🗺️' : '☰';
    if (!state.listOpen) return;
    items = items || filteredShops();
    panel.innerHTML = `<div class="row" style="margin-bottom:12px">
        <strong class="grow">${items.length} borracharia${items.length === 1 ? '' : 's'}</strong>
        <span class="small muted">mais perto primeiro</span></div>
      ${items.length ? items.map(shopCard).join('') : `<div class="empty"><div class="i">🔍</div>
        Nada encontrado com esses filtros.</div>`}`;
  }

  function openPeek(id) {
    const s = DB.shop(id);
    if (!s) return;
    const st = liveStatus(s);
    openSheet(`
      ${shopCard({ s, km: distKm(state.me, s), st })}
      <p class="small muted">${esc(s.address)} · status atualizado ${timeAgo(lastUpdate(s))}</p>
      <div class="action-row">
        <a class="btn primary" href="tel:+55${esc(s.phone)}" data-track="calls" data-id="${esc(s.id)}"><span class="i">📞</span>Ligar</a>
        <a class="btn dark" href="${routeUrl(s)}" target="_blank" rel="noopener" data-track="routes" data-id="${esc(s.id)}"><span class="i">🧭</span>Rota</a>
        <button class="btn" data-go="shop" data-id="${esc(s.id)}"><span class="i">ℹ️</span>Perfil</button>
      </div>`);
  }

  const routeUrl = s => `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`;

  function openFilters() {
    const f = structuredClone(state.filters);
    const draw = root => {
      const n = filteredShops(f).length;
      root.innerHTML = `
        <h3>Busca e filtros</h3>
        <div class="stack">
          <input class="input" id="f-q" type="search" placeholder="Nome, endereço ou serviço" value="${esc(f.q)}">
          <div><div class="small muted" style="margin-bottom:8px">Distância</div>
            <div class="chips">${[0, 1, 3, 5, 10].map(k => `<button type="button" class="chip ${f.maxKm === k ? 'active' : ''}" data-km="${k}">${k ? `até ${k} km` : 'Qualquer'}</button>`).join('')}</div></div>
          <div><div class="small muted" style="margin-bottom:8px">Status</div>
            <div class="chips">${[['todas', 'Todas'], ['aberto', '✓ Abertas'], ['fechado', '✕ Fechadas'], ['incerto', '? Incertas']]
              .map(([k, l]) => `<button type="button" class="chip ${f.status === k ? 'active' : ''}" data-st="${k}">${l}</button>`).join('')}</div></div>
          <div><div class="small muted" style="margin-bottom:8px">Serviços</div>
            <div class="chips">${SERVICES.map(sv => `<button type="button" class="chip ${f.services.includes(sv) ? 'active' : ''}" data-sv="${esc(sv)}">${esc(sv)}</button>`).join('')}</div></div>
          <div class="row">
            <button type="button" class="btn" id="f-clear">Limpar</button>
            <button type="button" class="btn primary grow" id="f-apply">Ver ${n} resultado${n === 1 ? '' : 's'}</button>
          </div>
        </div>`;
    };

    openSheet('', root => {
      draw(root);
      root.oninput = e => {
        if (e.target.id !== 'f-q') return;
        f.q = e.target.value.trim();
        const n = filteredShops(f).length;
        $('#f-apply', root).textContent = `Ver ${n} resultado${n === 1 ? '' : 's'}`;
      };
      root.onclick = e => {
        const t = e.target.closest('button');
        if (!t) return;
        if (t.dataset.km !== undefined) f.maxKm = Number(t.dataset.km);
        else if (t.dataset.st) f.status = t.dataset.st;
        else if (t.dataset.sv) {
          const sv = t.dataset.sv;
          f.services = f.services.includes(sv) ? f.services.filter(x => x !== sv) : [...f.services, sv];
        } else if (t.id === 'f-clear') Object.assign(f, { q: '', maxKm: 0, services: [], status: 'todas' });
        else if (t.id === 'f-apply') {
          state.filters = f;
          closeSheet();
          refreshMap();
          if (!state.listOpen && filteredShops().length) fitToResults();
          return;
        } else return;
        draw(root);
      };
    });
  }

  function fitToResults() {
    const items = filteredShops();
    const pts = items.map(x => ({ lat: x.s.lat, lng: x.s.lng })).concat([state.me]);
    MapView.fitBounds(pts, 60, 16);
  }

  routes.map = () => ({ map: true, nav: 'driver', tab: 'map' });

  // Botão SOS: as mais próximas abertas agora
  routes.sos = () => {
    const open = DB.data.shops
      .map(s => ({ s, km: distKm(state.me, s), st: liveStatus(s) }))
      .filter(x => x.st.key === 'aberto')
      .sort((a, b) => a.km - b.km)
      .slice(0, 5);
    return {
      nav: 'driver', tab: 'sos',
      html: `
        <div class="sos-hero">
          <h2>🆘 Socorro rápido</h2>
          <p>Borracharias <strong>abertas agora</strong>, da mais próxima para a mais distante.</p>
        </div>
        <div class="page">
          ${state.located ? '' : `<div class="card row" style="margin-bottom:12px">
            <span class="small muted grow">📍 Sem sua localização: distâncias calculadas a partir de um ponto padrão.</span>
            <button class="btn sm primary" id="sos-loc">Usar minha localização</button></div>`}
          ${open.length ? open.map(x => `
            <div class="card sos-item" style="margin-bottom:12px">
              <div class="row">
                ${thumb(x.s)}
                <div class="grow">
                  <strong>${esc(x.s.name)}</strong>
                  <div class="meta">${badge(x.st)}<span>📍 ${fmtKm(x.km)}</span><span>🕒 ${todayHours(x.s)}</span></div>
                  ${x.s.services.includes('Socorro 24h') ? '<div class="meta" style="margin-top:4px">🚨 Faz socorro no local</div>' : ''}
                </div>
              </div>
              <div class="row">
                <a class="btn danger" href="tel:+55${esc(x.s.phone)}" data-track="calls" data-id="${esc(x.s.id)}">📞 Ligar</a>
                <a class="btn dark" href="${routeUrl(x.s)}" target="_blank" rel="noopener" data-track="routes" data-id="${esc(x.s.id)}">🧭 Rota</a>
              </div>
              <button class="link-btn" data-go="shop" data-id="${esc(x.s.id)}">Ver perfil completo →</button>
            </div>`).join('') : `<div class="empty"><div class="i">😕</div>Nenhuma borracharia aberta confirmada por perto agora.</div>`}
        </div>`,
      after(root) {
        const b = $('#sos-loc', root);
        if (b) b.onclick = () => useMyLocation({ center: false });
      },
    };
  };

  function trackView(id) {
    const s = DB.shop(id);
    const u = DB.user();
    if (s && (!u || s.ownerId !== u.id)) {
      s.metrics.views++;
      DB.save();
    }
  }

  // Perfil da borracharia: fotos, telefone, rota
  routes.shop = ({ id }) => {
    const s = DB.shop(id);
    if (!s) return { html: `${header('Borracharia')}<div class="empty">Borracharia não encontrada.</div>` };
    const u = DB.user();
    const isOwner = u && s.ownerId === u.id;
    const st = liveStatus(s);
    const r = rating(s);
    const fav = u && u.favorites.includes(s.id);
    const lock = u ? '' : ' <span class="lock">🔒</span>';
    const today = new Date().getDay();

    return {
      html: `${header(s.name)}
        <div class="page stack">
          <div class="gallery">${s.photos.length
            ? s.photos.map(p => `<div><img src="${esc(p)}" alt="Foto de ${esc(s.name)}"></div>`).join('')
            : '<div>🛞</div><div>🔧</div>'}</div>
          ${isOwner ? '<div class="card small">👀 Você está vendo seu perfil como os motoristas veem.</div>' : ''}
          <div>
            <div class="row wrap">${badge(st)}<span class="small muted">atualizado ${timeAgo(lastUpdate(s))}</span></div>
            ${st.key === 'incerto' ? `<p class="small" style="color:var(--unsure);margin:6px 0 0">
              Motoristas reportaram um status diferente do informado pela borracharia. Ligue antes de ir.</p>` : ''}
            <h2 style="margin:10px 0 6px">${esc(s.name)}</h2>
            <div class="meta"><span>${fmtRating(r)}</span><span>📍 ${fmtKm(distKm(state.me, s))}</span><span>🕒 Hoje: ${todayHours(s)}</span></div>
            <p class="muted" style="margin:6px 0 0">${esc(s.address)} · ${esc(fmtPhone(s.phone))}</p>
          </div>
          <div class="action-row">
            <a class="btn primary" href="tel:+55${esc(s.phone)}" data-track="calls" data-id="${esc(s.id)}"><span class="i">📞</span>Ligar</a>
            <a class="btn dark" href="${routeUrl(s)}" target="_blank" rel="noopener" data-track="routes" data-id="${esc(s.id)}"><span class="i">🧭</span>Rota</a>
            <button class="btn" id="fav-btn" ${isOwner ? 'disabled' : ''}><span class="i">${fav ? '★' : '☆'}</span>${fav ? 'Favorita' : 'Favoritar'}${lock}</button>
          </div>
          ${isOwner ? '' : `<div class="row">
            <button class="btn login grow" id="report-btn">📢 Reportar status${lock}</button>
            <button class="btn login grow" id="review-btn">⭐ Avaliar${lock}</button>
          </div>`}
          <div class="card">
            <h3 style="margin-top:0">Serviços</h3>
            <div class="chips">${s.services.length ? s.services.map(sv => `<span class="chip">${esc(sv)}</span>`).join('') : '<span class="muted">Não informado</span>'}</div>
          </div>
          <div class="card">
            <h3 style="margin-top:0">Horários</h3>
            ${s.hours.map(h => `<div class="row small" style="padding:4px 0;${h.day === today ? 'font-weight:700' : ''}">
              <span class="grow">${WEEKDAYS[h.day]}${h.day === today ? ' (hoje)' : ''}</span><span>${hoursLabel(h)}</span></div>`).join('')}
          </div>
          <div class="card">
            <h3 style="margin-top:0">Avaliações ${r ? `<span class="stars">★</span> ${r.avg.toFixed(1).replace('.', ',')}` : ''}</h3>
            ${reviewsHtml(s)}
          </div>
        </div>`,
      after(root) {
        $('#fav-btn', root).onclick = () => requireLogin('salvar favoritos', () => {
          const me = DB.user();
          const i = me.favorites.indexOf(s.id);
          if (i >= 0) me.favorites.splice(i, 1); else me.favorites.push(s.id);
          DB.save();
          toast(i >= 0 ? 'Removida dos favoritos' : '★ Salva nos favoritos');
          render(true);
        });
        const rep = $('#report-btn', root);
        if (rep) rep.onclick = () => requireLogin('reportar o status', () => openReport(s.id));
        const rev = $('#review-btn', root);
        if (rev) rev.onclick = () => requireLogin('avaliar a visita', () => go('review', { id: s.id }));
      },
    };
  };

  function reviewsHtml(s) {
    if (!s.reviews.length) return '<p class="muted">Ainda sem avaliações.</p>';
    return [...s.reviews].sort((a, b) => b.at - a.at).map(rv => `
      <div class="review">
        <div class="row"><strong class="grow">${esc(rv.userName)}</strong><span class="small muted">${fmtDate(rv.at)}</span></div>
        <div class="stars" aria-label="${rv.stars} de 5 estrelas">${'★'.repeat(rv.stars)}${'☆'.repeat(5 - rv.stars)}</div>
        ${rv.text ? `<div>${esc(rv.text)}</div>` : ''}
        ${rv.reply ? `<div class="reply"><strong>Resposta da borracharia:</strong> ${esc(rv.reply.text)}</div>` : ''}
      </div>`).join('');
  }

  // Reportar status (exige login)
  function openReport(id) {
    const s = DB.shop(id);
    if (!s) return;
    openSheet(`
      <h3>📢 Como está a ${esc(s.name)} agora?</h3>
      <p class="muted">Seu report aparece no mapa para outros motoristas e avisa o dono se o status estiver errado.</p>
      <div class="stack">
        <button class="btn block" style="background:var(--open-soft);border-color:var(--open);color:var(--open)" data-rep="aberto">✓ Está aberta</button>
        <button class="btn block" style="background:var(--closed-soft);border-color:var(--closed);color:var(--closed)" data-rep="fechado">✕ Está fechada</button>
        <button class="btn ghost block" id="rep-cancel">Cancelar</button>
      </div>`, root => {
      root.onclick = e => {
        if (e.target.closest('#rep-cancel')) return closeSheet();
        const b = e.target.closest('[data-rep]');
        if (!b) return;
        const u = DB.user();
        // Um report por pessoa a cada 30 min: o novo substitui o anterior.
        s.reports = s.reports.filter(r => !(r.userId === u.id && Date.now() - r.at < 30 * 60000));
        s.reports.push({ userId: u.id, status: b.dataset.rep, at: Date.now(), ownerStatus: s.status });
        DB.save();
        toast('Obrigado! Seu report ajuda outros motoristas.');
        render(true);
      };
    });
  }

  // Avaliação pós-visita (exige login)
  routes.review = ({ id }) => {
    const s = DB.shop(id);
    const u = DB.user();
    if (!s || !u) return { redirect: 'map' };
    const existing = s.reviews.find(r => r.userId === u.id);
    let stars = existing ? existing.stars : 0;
    return {
      html: `${header('Avaliação pós-visita')}
        <form class="page stack" id="review-form">
          <div class="center">
            <div class="muted">Como foi o atendimento na</div>
            <h2 style="margin:4px 0 16px">${esc(s.name)}?</h2>
            <div class="star-input" role="radiogroup" aria-label="Nota">
              ${[1, 2, 3, 4, 5].map(n => `<button type="button" data-star="${n}" aria-label="${n} estrela${n > 1 ? 's' : ''}">★</button>`).join('')}
            </div>
            <div class="small muted" id="star-label" style="margin-top:6px">Toque nas estrelas</div>
          </div>
          <label class="field"><span>Conte como foi (opcional)</span>
            <textarea class="input" name="text" maxlength="500" placeholder="Rapidez, preço, atendimento…">${esc(existing ? existing.text : '')}</textarea></label>
          <button class="btn primary block" type="submit">${existing ? 'Atualizar avaliação' : 'Enviar avaliação'}</button>
        </form>`,
      after(root) {
        const labels = ['', 'Ruim', 'Regular', 'Bom', 'Muito bom', 'Excelente'];
        const paint = () => {
          $$('[data-star]', root).forEach(b => b.classList.toggle('on', Number(b.dataset.star) <= stars));
          $('#star-label', root).textContent = stars ? labels[stars] : 'Toque nas estrelas';
        };
        $$('[data-star]', root).forEach(b => b.onclick = () => { stars = Number(b.dataset.star); paint(); });
        paint();
        $('#review-form', root).onsubmit = e => {
          e.preventDefault();
          if (!stars) return toast('Escolha uma nota de 1 a 5 estrelas.');
          const text = String(new FormData(e.target).get('text') || '').trim();
          if (existing) Object.assign(existing, { stars, text, at: Date.now() });
          else s.reviews.push({ id: uid('rv'), userId: u.id, userName: u.name, stars, text, at: Date.now(), reply: null });
          DB.save();
          toast('Avaliação enviada. Obrigado!');
          back();
        };
      },
    };
  };

  // Depois de abrir a rota, ao voltar para o app pergunta como foi a visita.
  function checkPendingVisit() {
    const pv = DB.data.pendingVisit;
    if (!pv || state.mode !== 'driver' || sheetOpen()) return;
    const age = Date.now() - pv.at;
    if (age < 3000) return;
    DB.data.pendingVisit = null;
    DB.save();
    const s = DB.shop(pv.shopId);
    if (!s || age > 12 * HOUR) return;
    openSheet(`
      <h3>⭐ Como foi na ${esc(s.name)}?</h3>
      <p class="muted">Sua avaliação ajuda outros motoristas a escolher onde parar.</p>
      <div class="stack">
        <button class="btn primary block" id="pv-yes">Avaliar agora</button>
        <button class="btn ghost block" id="pv-no">Agora não</button>
      </div>`, root => {
      $('#pv-yes', root).onclick = () => requireLogin('avaliar a visita', () => go('review', { id: s.id }));
      $('#pv-no', root).onclick = closeSheet;
    });
  }

  // Favoritos (exige login)
  routes.favorites = () => {
    const u = DB.user();
    if (!u) {
      return {
        nav: 'driver', tab: 'fav',
        html: `${header('Favoritos', { showBack: false })}
          <div class="empty"><div class="i">🔒</div>
            <p>Entre na sua conta para salvar suas borracharias de confiança.</p>
            <button class="btn login" id="fav-login">Entrar ou cadastrar</button></div>`,
        after(root) {
          $('#fav-login', root).onclick = () => { state.afterLogin = () => {}; go('login'); };
        },
      };
    }
    const items = u.favorites.map(id => DB.shop(id)).filter(Boolean)
      .map(s => ({ s, km: distKm(state.me, s), st: liveStatus(s) }))
      .sort((a, b) => a.km - b.km);
    return {
      nav: 'driver', tab: 'fav',
      html: `${header('Favoritos', { showBack: false })}
        <div class="page">${items.length ? items.map(shopCard).join('') : `<div class="empty"><div class="i">☆</div>
          Nenhum favorito ainda. Toque em <strong>☆ Favoritar</strong> no perfil de uma borracharia.</div>`}</div>`,
    };
  };

  // Conta (os dois modos)
  routes.account = () => {
    const u = DB.user();
    const modeLabel = state.mode === 'biz' ? '🔧 Borracheiro' : '🚗 Motorista';
    const via = { google: 'Conta Google', password: 'E-mail e senha' };
    const contact = u ? [u.email, via[u.provider]].filter(Boolean).join(' · ') : 'Modo convidado';
    const avatar = u && u.photo
      ? `<img src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer">`
      : u ? esc(u.name.charAt(0).toUpperCase()) : '👤';
    return {
      nav: state.mode === 'biz' ? 'biz' : 'driver', tab: 'account',
      html: `${header('Conta', { showBack: false })}
        <div class="page stack">
          <div class="card row">
            <div class="thumb" style="border-radius:50%">${avatar}</div>
            <div><strong>${u ? esc(u.name) : 'Convidado'}</strong><div class="small muted">${esc(contact)}</div>
              ${u && u.provider === 'password' && !u.emailVerified && Auth.mode === 'firebase'
                ? '<div class="small" style="color:var(--unsure)">E-mail ainda não confirmado — veja sua caixa de entrada.</div>' : ''}
              ${Auth.mode === 'demo' && u ? '<div class="small muted">Conta de demonstração</div>' : ''}</div>
          </div>
          ${u ? '' : '<button class="btn login block" data-go="login">🔑 Entrar ou cadastrar</button>'}
          <button class="menu-item" data-go="mode"><span class="i">🔁</span>
            <span><strong>Trocar de modo</strong><div class="small muted">Agora: ${modeLabel}</div></span><span class="chev">›</span></button>
          <button class="menu-item" id="logout"><span class="i">🚪</span><strong>${u ? 'Sair da conta' : 'Sair do modo convidado'}</strong></button>
        </div>`,
      after(root) {
        $('#logout', root).onclick = async () => {
          try { await Auth.signOut(); } catch (e) { console.warn(e); }
          endSession();
          toast('Você saiu da conta.');
        };
      },
    };
  };

  // ====================================================== 3. MODO BORRACHEIRO
  routes.bizSetup = () => {
    const u = DB.user();
    if (!u) return { redirect: 'welcome' };
    return {
      html: `${header('Cadastrar borracharia', { showBack: false })}
        <form class="page stack" id="setup-form">
          <p class="muted" style="margin-top:0">Coloque sua borracharia no mapa. Você ajusta horários, serviços e fotos depois.</p>
          <label class="field"><span>Nome da borracharia</span><input class="input" name="name" required maxlength="60"></label>
          <label class="field"><span>Telefone / WhatsApp</span><input class="input" name="phone" type="tel" inputmode="tel" value="${esc(u.phone ? fmtPhone(u.phone) : '')}"></label>
          <label class="field"><span>Endereço</span><input class="input" name="address" maxlength="120" placeholder="Rua, número, bairro"></label>
          <div class="card small" id="loc-info">📍 Localização no mapa: ${state.located ? 'sua posição atual' : 'centro padrão (libere a localização para usar a sua)'}
            <div style="margin-top:8px"><button type="button" class="btn sm" id="use-loc">Usar minha localização</button></div></div>
          <div><div class="small muted" style="margin-bottom:8px">Serviços</div>
            <div class="chips">${SERVICES.map(sv => `<label class="chip check"><input type="checkbox" name="services" value="${esc(sv)}">${esc(sv)}</label>`).join('')}</div></div>
          <button class="btn primary block" type="submit">Criar minha borracharia</button>
          <button class="btn ghost block" type="button" data-go="mode">Voltar ao seletor de modo</button>
        </form>`,
      after(root) {
        $('#use-loc', root).onclick = async () => {
          if (!(await useMyLocation({ center: false }))) return;
          $('#loc-info', root).firstChild.textContent = '📍 Localização no mapa: sua posição atual';
        };
        $('#setup-form', root).onsubmit = e => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const name = String(fd.get('name') || '').trim();
          const phone = String(fd.get('phone') || '').replace(/\D/g, '');
          if (!name) return toast('Informe o nome da borracharia.');
          if (phone.length < 10) return toast('Informe o telefone com DDD.');
          DB.data.shops.push({
            id: uid('shop'),
            ownerId: u.id,
            name,
            phone,
            address: String(fd.get('address') || '').trim() || 'Endereço não informado',
            lat: state.me.lat,
            lng: state.me.lng,
            services: fd.getAll('services'),
            hours: defaultHours(),
            photos: [],
            status: 'fechado',
            statusUpdatedAt: Date.now(),
            reports: [],
            reviews: [],
            metrics: { views: 0, calls: 0, routes: 0 },
          });
          DB.save();
          toast('Borracharia criada! Abra quando estiver atendendo.');
          go('dash', {}, { reset: true });
        };
      },
    };
  };

  // Dashboard do negócio
  routes.dash = () => {
    const s = DB.ownedShop();
    if (!s) return { redirect: 'bizSetup' };
    const open = s.status === 'aberto';
    const div = divergence(s);
    const conf = confidence(s);
    const r = rating(s);
    const pending = s.reviews.filter(rv => !rv.reply).length;
    const other = open ? 'fechado' : 'aberto';

    return {
      nav: 'biz', tab: 'dash',
      html: `
        <div class="biz-hero">
          <div class="small muted">Painel do negócio</div>
          <h2>${esc(s.name)}</h2>
          <div class="small muted">${esc(s.address)}</div>
        </div>
        <div class="page stack">
          <button class="status-toggle ${open ? 'open' : 'closed'}" id="toggle-status" role="switch" aria-checked="${open}">
            <span>
              <span class="small muted">Status no mapa</span>
              <strong>${open ? '✓ Aberto' : '✕ Fechado'}</strong>
              <span class="small muted">Atualizado ${timeAgo(s.statusUpdatedAt)} · toque para mudar</span>
            </span>
            <span class="switch" aria-hidden="true"></span>
          </button>

          ${div ? `<div class="alert" role="alert">
            <span class="i">⚠️</span>
            <div class="grow">
              <strong>Alerta de divergência</strong>
              <p style="margin:4px 0 10px">Você está como <b>${open ? 'Aberto' : 'Fechado'}</b>, mas
                ${div.disagree} motorista${div.disagree > 1 ? 's reportaram' : ' reportou'}
                <b>${open ? 'fechado' : 'aberto'}</b> nas últimas 2 h.
                ${liveStatus(s).key === 'incerto' ? 'No mapa você aparece como <b>Incerta</b>.' : ''}</p>
              <div class="row wrap">
                <button class="btn sm danger" id="div-fix">Mudar para ${other === 'aberto' ? 'Aberto' : 'Fechado'}</button>
                <button class="btn sm" id="div-keep">Meu status está certo</button>
              </div>
            </div>
          </div>` : ''}

          <h3 style="margin:8px 0 0">Métricas</h3>
          <div class="stat-grid">
            <div class="stat"><div class="label">👀 Visualizações</div><div class="value">${s.metrics.views}</div><div class="sub">aberturas do perfil</div></div>
            <div class="stat"><div class="label">📞 Ligações</div><div class="value">${s.metrics.calls}</div><div class="sub">toques em “Ligar”</div></div>
            <div class="stat"><div class="label">🧭 Rotas</div><div class="value">${s.metrics.routes}</div><div class="sub">toques em “Rota”</div></div>
            <div class="stat"><div class="label">🛡️ Confiança</div><div class="value">${conf ? conf.pct + '%' : '—'}</div>
              <div class="sub">${conf ? `${conf.ok} de ${conf.n} reports (30 dias) batem com seu status` : 'sem reports ainda'}</div></div>
            <div class="stat"><div class="label">⭐ Nota média</div><div class="value">${r ? r.avg.toFixed(1).replace('.', ',') : '—'}</div>
              <div class="sub">${r ? `${r.n} avaliação${r.n > 1 ? 'ões' : ''}` : 'sem avaliações'}</div></div>
            <div class="stat"><div class="label">💬 Sem resposta</div><div class="value">${pending}</div><div class="sub">avaliações para responder</div></div>
          </div>

          <h3 style="margin:8px 0 0">Atalhos</h3>
          <div>
            <button class="menu-item" data-nav="bizEdit"><span class="i">✏️</span>
              <span><strong>Editar perfil</strong><div class="small muted">Horário, serviços e fotos</div></span><span class="chev">›</span></button>
            <button class="menu-item" data-nav="bizReviews"><span class="i">💬</span>
              <span><strong>Avaliações recebidas</strong><div class="small muted">Ver e responder</div></span>
              ${pending ? `<span class="count" style="margin-left:auto">${pending}</span>` : '<span class="chev">›</span>'}</button>
            <button class="menu-item" data-go="shop" data-id="${esc(s.id)}"><span class="i">👀</span>
              <span><strong>Ver como motorista</strong><div class="small muted">Seu perfil público</div></span><span class="chev">›</span></button>
          </div>
        </div>`,
      after(root) {
        const setStatus = (status, msg) => {
          s.status = status;
          s.statusUpdatedAt = Date.now();
          DB.save();
          toast(msg);
          render(true);
        };
        $('#toggle-status', root).onclick = () => setStatus(other,
          other === 'aberto' ? 'Agora você aparece como ABERTO no mapa.' : 'Agora você aparece como FECHADO no mapa.');
        const fix = $('#div-fix', root);
        if (fix) fix.onclick = () => setStatus(other, 'Status corrigido. Obrigado por manter o mapa confiável!');
        const keep = $('#div-keep', root);
        if (keep) keep.onclick = () => setStatus(s.status, 'Status confirmado. Os reports anteriores foram desconsiderados.');
      },
    };
  };

  // Avaliações recebidas: ver e responder
  routes.bizReviews = () => {
    const s = DB.ownedShop();
    if (!s) return { redirect: 'bizSetup' };
    const r = rating(s);
    const list = [...s.reviews].sort((a, b) => (a.reply ? 1 : 0) - (b.reply ? 1 : 0) || b.at - a.at);
    return {
      nav: 'biz', tab: 'reviews',
      html: `${header('Avaliações recebidas', { showBack: false })}
        <div class="page stack">
          <div class="card row">
            <div class="grow"><div class="small muted">Nota média</div>
              <div style="font-size:28px;font-weight:700">${r ? r.avg.toFixed(1).replace('.', ',') : '—'} <span class="stars" style="font-size:18px">★</span></div></div>
            <div class="small muted">${r ? `${r.n} avaliação${r.n > 1 ? 'ões' : ''}` : 'Nenhuma ainda'}</div>
          </div>
          ${list.length ? list.map(rv => `
            <div class="card" data-review="${esc(rv.id)}">
              <div class="row"><strong class="grow">${esc(rv.userName)}</strong><span class="small muted">${fmtDate(rv.at)}</span></div>
              <div class="stars">${'★'.repeat(rv.stars)}${'☆'.repeat(5 - rv.stars)}</div>
              ${rv.text ? `<p style="margin:6px 0">${esc(rv.text)}</p>` : ''}
              ${rv.reply ? `<div class="reply"><strong>Sua resposta:</strong> ${esc(rv.reply.text)}</div>
                <button class="link-btn small" data-edit>Editar resposta</button>` : ''}
              <form class="stack ${rv.reply ? 'hidden' : ''}" data-reply style="margin-top:10px">
                <textarea class="input" name="reply" maxlength="400" placeholder="Agradeça ou explique o ocorrido…">${esc(rv.reply ? rv.reply.text : '')}</textarea>
                <button class="btn primary sm" type="submit">Responder</button>
              </form>
            </div>`).join('') : '<div class="empty"><div class="i">💬</div>Quando motoristas avaliarem sua borracharia, as avaliações aparecem aqui.</div>'}
        </div>`,
      after(root) {
        root.onclick = e => {
          const ed = e.target.closest('[data-edit]');
          if (!ed) return;
          const card = ed.closest('[data-review]');
          $('[data-reply]', card).classList.remove('hidden');
          ed.classList.add('hidden');
        };
        $$('[data-reply]', root).forEach(f => f.onsubmit = e => {
          e.preventDefault();
          const text = String(new FormData(f).get('reply') || '').trim();
          if (!text) return toast('Escreva uma resposta.');
          const rv = s.reviews.find(x => x.id === f.closest('[data-review]').dataset.review);
          rv.reply = { text, at: Date.now() };
          DB.save();
          toast('Resposta publicada.');
          render(true);
        });
      },
    };
  };

  // Editar perfil: horário, serviços, fotos
  routes.bizEdit = () => {
    const s = DB.ownedShop();
    if (!s) return { redirect: 'bizSetup' };
    const draft = structuredClone(s);
    return {
      nav: 'biz', tab: 'edit',
      html: `${header('Editar perfil', { showBack: false })}
        <form class="page stack" id="edit-form">
          <label class="field"><span>Nome</span><input class="input" name="name" value="${esc(s.name)}" maxlength="60"></label>
          <label class="field"><span>Telefone / WhatsApp</span><input class="input" name="phone" type="tel" value="${esc(fmtPhone(s.phone))}"></label>
          <label class="field"><span>Endereço</span><input class="input" name="address" value="${esc(s.address)}" maxlength="120"></label>
          <button type="button" class="btn sm" id="move-pin">📍 Mover pin para minha localização atual</button>

          <div class="card">
            <h3 style="margin-top:0">Fotos <span class="small muted">(até 6)</span></h3>
            <div class="photo-grid" id="photos"></div>
          </div>

          <div class="card">
            <h3 style="margin-top:0">Serviços</h3>
            <div class="chips">${SERVICES.map(sv => `<label class="chip check"><input type="checkbox" name="services" value="${esc(sv)}" ${s.services.includes(sv) ? 'checked' : ''}>${esc(sv)}</label>`).join('')}</div>
          </div>

          <div class="card stack">
            <h3 style="margin:0">Horário de funcionamento</h3>
            ${s.hours.map(h => `<div class="hours-row" data-day="${h.day}">
              <label class="check"><input type="checkbox" data-f="enabled" ${h.enabled ? 'checked' : ''}>${WEEKDAYS[h.day]}</label>
              <input class="input" type="time" data-f="open" value="${esc(h.open)}" aria-label="Abre ${WEEKDAYS[h.day]}">
              <input class="input" type="time" data-f="close" value="${esc(h.close)}" aria-label="Fecha ${WEEKDAYS[h.day]}">
            </div>`).join('')}
            <p class="small muted" style="margin:0">Dica: 00:00 às 23:59 aparece como “24 horas”.</p>
          </div>

          <button class="btn primary block" type="submit">Salvar alterações</button>
        </form>`,
      after(root) {
        const drawPhotos = () => {
          $('#photos', root).innerHTML = draft.photos.map((p, i) => `
            <div class="ph"><img src="${esc(p)}" alt="Foto ${i + 1}"><button type="button" class="rm" data-rm="${i}" aria-label="Remover foto">✕</button></div>`).join('')
            + (draft.photos.length < 6 ? `<label class="add" title="Adicionar fotos">＋<input type="file" accept="image/*" multiple hidden id="photo-input"></label>` : '');
          const input = $('#photo-input', root);
          if (input) input.onchange = async () => {
            const files = Array.from(input.files).slice(0, 6 - draft.photos.length);
            for (const f of files) {
              try { draft.photos.push(await readImage(f)); } catch { toast('Não foi possível ler uma das imagens.'); }
            }
            drawPhotos();
          };
        };
        $('#photos', root).onclick = e => {
          const rm = e.target.closest('[data-rm]');
          if (!rm) return;
          draft.photos.splice(Number(rm.dataset.rm), 1);
          drawPhotos();
        };
        drawPhotos();

        $('#move-pin', root).onclick = async () => {
          const pos = await useMyLocation({ center: false });
          if (!pos) return;
          draft.lat = pos.lat;
          draft.lng = pos.lng;
          toast('Pin será movido ao salvar.');
        };

        $('#edit-form', root).onsubmit = e => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const name = String(fd.get('name') || '').trim();
          const phone = String(fd.get('phone') || '').replace(/\D/g, '');
          if (!name) return toast('O nome não pode ficar vazio.');
          if (phone.length < 10) return toast('Informe o telefone com DDD.');
          const hours = $$('.hours-row', root).map(row => ({
            day: Number(row.dataset.day),
            enabled: $('[data-f="enabled"]', row).checked,
            open: $('[data-f="open"]', row).value || '08:00',
            close: $('[data-f="close"]', row).value || '18:00',
          }));
          const backup = structuredClone(s);
          Object.assign(s, {
            name, phone,
            address: String(fd.get('address') || '').trim() || 'Endereço não informado',
            services: fd.getAll('services'),
            hours,
            photos: draft.photos,
            lat: draft.lat,
            lng: draft.lng,
          });
          if (!DB.save()) {
            Object.assign(s, backup);
            return toast('Sem espaço para salvar. Remova algumas fotos e tente de novo.');
          }
          toast('Perfil atualizado.');
          go('dash', {}, { reset: true });
        };
      },
    };
  };

  // ------------------------------------------------- "ao vivo" e sincronização
  const LIVE_VIEWS = ['dash', 'shop', 'sos', 'favorites'];

  function liveRefresh(changedShop) {
    const name = state.current && state.current.name;
    if (name === 'map') {
      refreshMap(changedShop && changedShop.id);
      if (changedShop) toast(`Ao vivo: ${changedShop.name} agora aparece como ${liveStatus(changedShop).label}.`);
    } else if (LIVE_VIEWS.includes(name) && !sheetOpen()) {
      render(true);
    }
  }

  // Simula reports da comunidade chegando (em produção viria por WebSocket).
  function simulateCommunity() {
    if (document.hidden || !DB.data.shops.length) return;
    const shops = DB.data.shops;
    const s = shops[Math.floor(Math.random() * shops.length)];
    const before = liveStatus(s).key;
    const disagree = Math.random() < 0.2;
    const status = disagree ? (s.status === 'aberto' ? 'fechado' : 'aberto') : s.status;
    s.reports.push({ userId: 'community', status, at: Date.now(), ownerStatus: s.status });
    s.reports = s.reports.filter(r => Date.now() - r.at < 30 * DAY).slice(-200);
    DB.save();
    liveRefresh(liveStatus(s).key !== before ? s : null);
  }

  function startLive() {
    setInterval(simulateCommunity, 20000);
    // Abra o app em duas abas (motorista e borracheiro) para ver a sincronização.
    window.addEventListener('storage', e => {
      if (e.key !== DB_KEY) return;
      DB.load();
      liveRefresh(null);
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) checkPendingVisit();
    });
  }

  // --------------------------------------------------------------------- boot
  // Aberto como arquivo (file://) o login real não funciona. Se o servidor
  // local estiver ligado, vai para ele automaticamente.
  async function redirectToLocalServer() {
    if (location.protocol !== 'file:') return false;
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 800);
      const r = await fetch('http://localhost:5500/__ping', { cache: 'no-store', signal: ctrl.signal });
      if ((await r.text()) !== 'borracharia-ja') return false;
      location.replace('http://localhost:5500/');
      return true;
    } catch {
      return false;
    }
  }

  async function boot() {
    if (await redirectToLocalServer()) return;
    DB.load();
    go('splash', {}, { reset: true });
    const started = Date.now();
    // Só lê o GPS no início se a permissão já foi dada: o pedido de permissão
    // acontece depois, com a mensagem explicativa, ao abrir o mapa.
    const locating = (async () => {
      if (await geoPermission() !== 'granted') return;
      const r = await getPosition(3500);
      if (r.pos) { state.me = r.pos; state.located = true; }
    })();
    const [profile] = await Promise.all([Auth.init(), locating]);
    DB.ensureSeed(state.me);
    if (state.located) DB.recenterSeed(state.me, distKm);
    await wait(Math.max(0, 1400 - (Date.now() - started)));

    // A autenticação é a fonte da verdade de quem está logado.
    const sess = DB.data.session;
    if (profile) {
      sess.userId = syncUser(profile).id;
      sess.guest = false;
    } else {
      sess.userId = null;
    }
    DB.save();

    // Saiu da conta em outra aba ou a sessão expirou.
    Auth.onChange(p => {
      if (p || !DB.data.session.userId) return;
      endSession();
      toast('Sua sessão terminou. Entre novamente.');
    });

    const hasAccess = sess.userId || sess.guest;
    if (hasAccess && sess.mode === 'biz' && sess.userId) enterBiz();
    else if (hasAccess && sess.mode === 'driver') enterDriver();
    else if (hasAccess) go('mode', {}, { reset: true });
    else go('welcome', {}, { reset: true });

    startLive();
  }

  boot();
})();
