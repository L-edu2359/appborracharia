/* Adaptador de mapa: usa Google Maps quando há chave válida e cai para o
 * OpenStreetMap (Leaflet) se a chave falhar, estiver ausente ou sem internet.
 * O app só conversa com MapView, sem saber qual provedor está ativo. */
const MapView = (() => {
  const items = new Map(); // id -> { pos, html, title, onClick, m }
  let el = null;
  let backend = null;
  let ready = false;
  let switching = null;
  let me = null;
  let meMarker = null;
  let onFallback = null;
  let view = { center: null, zoom: 14 };

  const toEl = html => {
    const t = document.createElement('div');
    t.innerHTML = html.trim();
    return t.firstElementChild;
  };

  function loadGoogle(key, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), timeout);
      window.__gmReady = () => { clearTimeout(timer); resolve(); };
      const s = document.createElement('script');
      s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) +
        '&v=weekly&loading=async&language=pt-BR&region=BR&callback=__gmReady';
      s.async = true;
      s.onerror = () => { clearTimeout(timer); reject(new Error('network')); };
      document.head.appendChild(s);
    });
  }

  // ------------------------------------------------------------ Google Maps
  const googleBackend = {
    name: 'google',
    map: null,
    Adv: null,
    async start(center, zoom) {
      const { Map } = await google.maps.importLibrary('maps');
      const { AdvancedMarkerElement } = await google.maps.importLibrary('marker');
      this.Adv = AdvancedMarkerElement;
      const opts = {
        center, zoom,
        mapId: 'DEMO_MAP_ID', // necessário para marcadores HTML (AdvancedMarker)
        disableDefaultUI: true,
        gestureHandling: 'greedy',
        clickableIcons: false,
      };
      if (google.maps.ColorScheme) opts.colorScheme = google.maps.ColorScheme.FOLLOW_SYSTEM;
      this.map = new Map(el, opts);
      // Chave inválida nem sempre dispara gm_authFailure: só confia no Google
      // depois que o mapa realmente desenhou.
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('tiles-timeout')), 10000);
        google.maps.event.addListenerOnce(this.map, 'tilesloaded', () => { clearTimeout(t); resolve(); });
      });
    },
    content(it) {
      const c = toEl(it.html);
      c.style.cursor = 'pointer';
      c.addEventListener('click', e => { e.stopPropagation(); if (it.onClick) it.onClick(); });
      return c;
    },
    add(it) {
      return new this.Adv({ map: this.map, position: it.pos, content: this.content(it), title: it.title || '' });
    },
    update(it) {
      it.m.position = it.pos;
      it.m.content = this.content(it);
    },
    remove(m) { m.map = null; },
    addMe(pos) {
      // AdvancedMarker ancora no centro inferior; desloca para centralizar o ponto.
      const c = toEl('<div style="transform:translateY(50%)"><div class="me-dot"></div></div>');
      return new this.Adv({ map: this.map, position: pos, content: c, zIndex: 9999 });
    },
    moveMe(m, pos) { m.position = pos; },
    setView(center, zoom) {
      this.map.setCenter(center);
      if (zoom) this.map.setZoom(zoom);
    },
    fit(points, pad, maxZoom) {
      const b = new google.maps.LatLngBounds();
      points.forEach(p => b.extend(p));
      this.map.fitBounds(b, pad);
      google.maps.event.addListenerOnce(this.map, 'idle', () => {
        if (this.map.getZoom() > maxZoom) this.map.setZoom(maxZoom);
      });
    },
    view() {
      const c = this.map.getCenter();
      return { center: { lat: c.lat(), lng: c.lng() }, zoom: this.map.getZoom() };
    },
    resize() {},
    destroy() {
      items.forEach(it => { if (it.m) it.m.map = null; it.m = null; });
      if (meMarker) meMarker.map = null;
      meMarker = null;
      this.map = null;
    },
  };

  // ----------------------------------------------------- OpenStreetMap/Leaflet
  const leafletBackend = {
    name: 'osm',
    map: null,
    async start(center, zoom) {
      this.map = L.map(el, { zoomControl: false }).setView([center.lat, center.lng], zoom);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(this.map);
    },
    icon: html => L.divIcon({ className: '', html, iconSize: [38, 38], iconAnchor: [19, 38] }),
    add(it) {
      const m = L.marker([it.pos.lat, it.pos.lng], { icon: this.icon(it.html), title: it.title || '' }).addTo(this.map);
      m.on('click', () => { if (it.onClick) it.onClick(); });
      return m;
    },
    update(it) {
      it.m.setLatLng([it.pos.lat, it.pos.lng]);
      it.m.setIcon(this.icon(it.html));
    },
    remove(m) { m.remove(); },
    addMe(pos) {
      return L.marker([pos.lat, pos.lng], {
        icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18] }),
        interactive: false,
        keyboard: false,
      }).addTo(this.map);
    },
    moveMe(m, pos) { m.setLatLng([pos.lat, pos.lng]); },
    setView(center, zoom) { this.map.setView([center.lat, center.lng], zoom || this.map.getZoom()); },
    fit(points, pad, maxZoom) {
      this.map.fitBounds(points.map(p => [p.lat, p.lng]), { padding: [pad, pad], maxZoom });
    },
    view() {
      const c = this.map.getCenter();
      return { center: { lat: c.lat, lng: c.lng }, zoom: this.map.getZoom() };
    },
    resize() { setTimeout(() => this.map && this.map.invalidateSize(), 0); },
    destroy() {},
  };

  // ------------------------------------------------------------------ núcleo
  async function use(b, center, zoom) {
    backend = b;
    ready = false;
    await b.start(center, zoom);
    if (backend !== b) return; // trocou de provedor no meio do caminho
    ready = true;
    if (me) meMarker = b.addMe(me);
    items.forEach(it => { it.m = b.add(it); });
  }

  // Container novo: o Google deixa estilos e a tela de erro no elemento antigo.
  function freshContainer() {
    const fresh = document.createElement('div');
    fresh.id = el.id;
    el.replaceWith(fresh);
    el = fresh;
  }

  function switchToLeaflet(reason) {
    if (backend === leafletBackend) return switching || Promise.resolve();
    const v = ready && backend ? backend.view() : view;
    if (backend) backend.destroy();
    freshContainer();
    switching = use(leafletBackend, v.center, v.zoom).then(() => {
      if (onFallback) onFallback(reason);
    });
    return switching;
  }

  return {
    get provider() { return backend ? backend.name : null; },

    async init(container, center, zoom, opts = {}) {
      el = container;
      onFallback = opts.onFallback || null;
      view = { center, zoom };
      if (!opts.googleKey) return switchToLeaflet('sem-chave');
      // Disparado pelo Google quando a chave é inválida/restrita/sem faturamento.
      window.gm_authFailure = () => switchToLeaflet('chave');
      try {
        await loadGoogle(opts.googleKey);
        await use(googleBackend, center, zoom);
      } catch (e) {
        console.warn('Google Maps indisponível:', e);
        await switchToLeaflet(e.message);
      }
    },

    setMe(pos) {
      me = pos;
      if (!ready) return;
      if (meMarker) backend.moveMe(meMarker, pos);
      else meMarker = backend.addMe(pos);
    },

    upsert(id, pos, html, title, onClick) {
      let it = items.get(id);
      if (!it) { it = { m: null }; items.set(id, it); }
      Object.assign(it, { pos, html, title, onClick });
      if (!ready) return;
      if (it.m) backend.update(it);
      else it.m = backend.add(it);
    },

    remove(id) {
      const it = items.get(id);
      if (!it) return;
      if (ready && it.m) backend.remove(it.m);
      items.delete(id);
    },

    ids() { return Array.from(items.keys()); },

    setView(center, zoom) {
      if (ready) backend.setView(center, zoom);
      else view = { center, zoom: zoom || view.zoom };
    },

    fitBounds(points, pad = 60, maxZoom = 16) {
      if (ready && points.length) backend.fit(points, pad, maxZoom);
    },

    resize() { if (ready) backend.resize(); },
  };
})();
