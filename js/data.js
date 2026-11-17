/* Camada de dados de demonstração.
 * Tudo fica no localStorage do navegador. Em produção isso vira uma API + banco
 * (com autenticação real e atualização de status via WebSocket/push). */

const SERVICES = [
  'Conserto de furo',
  'Troca de pneu',
  'Calibragem',
  'Balanceamento',
  'Alinhamento',
  'Socorro 24h',
  'Pneus novos',
  'Pneus de moto',
  'Pneus de caminhão',
];

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// Centro padrão quando o usuário não libera a localização (Praça da Sé, SP).
const DEFAULT_CENTER = { lat: -23.5505, lng: -46.6333 };

const DB_KEY = 'borracharia_db_v1';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function uid(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 10);
}

function defaultHours(open = '08:00', close = '18:00', days = [1, 2, 3, 4, 5, 6]) {
  return WEEKDAYS.map((_, i) => ({ day: i, enabled: days.includes(i), open, close }));
}

// Borracharias fictícias posicionadas em volta do centro informado.
const SEED_SHOPS = [
  { name: 'Borracharia do Zé', dLat: 0.004, dLng: -0.003, phone: '11987654321', status: 'aberto',
    address: 'Rua das Palmeiras, 120', services: ['Conserto de furo', 'Troca de pneu', 'Calibragem', 'Socorro 24h'],
    hours: defaultHours('00:00', '23:59', [0, 1, 2, 3, 4, 5, 6]) },
  { name: 'Pneus & Cia', dLat: -0.006, dLng: 0.005, phone: '11976543210', status: 'aberto',
    address: 'Av. Brasil, 2.450', services: ['Troca de pneu', 'Balanceamento', 'Alinhamento', 'Pneus novos'],
    hours: defaultHours('08:00', '19:00') },
  { name: 'Borracharia 24h Rodovia', dLat: 0.012, dLng: 0.009, phone: '11965432109', status: 'aberto',
    address: 'Rod. Anhanguera, km 18', services: ['Socorro 24h', 'Pneus de caminhão', 'Conserto de furo', 'Calibragem'],
    hours: defaultHours('00:00', '23:59', [0, 1, 2, 3, 4, 5, 6]) },
  { name: 'Moto Pneu Express', dLat: -0.002, dLng: -0.009, phone: '11954321098', status: 'fechado',
    address: 'Rua Augusta, 900', services: ['Pneus de moto', 'Conserto de furo', 'Calibragem'],
    hours: defaultHours('09:00', '18:00', [1, 2, 3, 4, 5]) },
  { name: 'Central dos Pneus', dLat: 0.009, dLng: -0.011, phone: '11943210987', status: 'aberto',
    address: 'Rua Vergueiro, 3.100', services: ['Pneus novos', 'Alinhamento', 'Balanceamento', 'Troca de pneu'],
    hours: defaultHours('07:30', '18:30') },
  { name: 'Borracharia Bom Jesus', dLat: -0.011, dLng: -0.004, phone: '11932109876', status: 'fechado',
    address: 'Rua São Bento, 45', services: ['Conserto de furo', 'Troca de pneu'],
    hours: defaultHours('08:00', '17:00', [1, 2, 3, 4, 5, 6]) },
  { name: 'Truck Pneus', dLat: 0.018, dLng: -0.002, phone: '11921098765', status: 'aberto',
    address: 'Marginal Tietê, 7.800', services: ['Pneus de caminhão', 'Socorro 24h', 'Alinhamento', 'Balanceamento'],
    hours: defaultHours('06:00', '22:00', [0, 1, 2, 3, 4, 5, 6]) },
  { name: 'Calibra Fácil', dLat: -0.015, dLng: 0.013, phone: '11910987654', status: 'aberto',
    address: 'Av. Paulista, 1.578', services: ['Calibragem', 'Conserto de furo', 'Pneus de moto'],
    hours: defaultHours('08:00', '20:00') },
];

const SEED_REVIEWS = [
  { stars: 5, text: 'Atendimento rápido, consertou o furo em 10 minutos.', reply: 'Valeu! Volte sempre.' },
  { stars: 4, text: 'Preço justo, mas tive que esperar um pouco.' },
  { stars: 5, text: 'Me salvou de madrugada. Recomendo!' },
  { stars: 3, text: 'Resolveu o problema, mas o lugar é meio difícil de achar.' },
];

const SEED_NAMES = ['Ana', 'Carlos', 'Juliana', 'Marcos', 'Patrícia', 'Rafael', 'Bruna', 'Diego'];

function seedShops(center) {
  const now = Date.now();
  return SEED_SHOPS.map((s, i) => {
    const reviews = SEED_REVIEWS.slice(0, (i % 4) + 1).map((r, j) => ({
      id: uid('rv'),
      userId: 'seed',
      userName: SEED_NAMES[(i + j) % SEED_NAMES.length],
      stars: r.stars,
      text: r.text,
      at: now - (j + 1) * 3 * DAY,
      reply: r.reply ? { text: r.reply, at: now - (j + 1) * 2 * DAY } : null,
    }));
    const reports = [
      { userId: 'seed', status: s.status, at: now - (20 + i * 7) * 60 * 1000, ownerStatus: s.status },
    ];
    return {
      id: 'shop_seed_' + i,
      ownerId: null,
      name: s.name,
      phone: s.phone,
      address: s.address,
      lat: center.lat + s.dLat,
      lng: center.lng + s.dLng,
      services: s.services,
      hours: s.hours,
      photos: [],
      status: s.status,
      statusUpdatedAt: now - 3 * HOUR,
      reports,
      reviews,
      metrics: { views: 40 + i * 13, calls: 6 + i * 3, routes: 9 + i * 4 },
    };
  });
}

function emptyDB() {
  return {
    users: [],
    shops: [],
    seededAt: null,
    session: { userId: null, guest: false, mode: null },
    pendingVisit: null,
  };
}

const DB = {
  data: null,

  load() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      this.data = raw ? JSON.parse(raw) : emptyDB();
    } catch (e) {
      this.data = emptyDB();
    }
    return this.data;
  },

  save() {
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(this.data));
    } catch (e) {
      console.warn('Não foi possível salvar (armazenamento cheio?)', e);
      return false;
    }
    return true;
  },

  ensureSeed(center) {
    if (!this.data.seededAt) {
      this.data.shops = seedShops(center).concat(this.data.shops);
      this.data.seededAt = Date.now();
      this.data.seedCenter = { ...center };
      this.save();
    }
  },

  // Demonstração: se o usuário estiver longe (> 30 km) de onde as borracharias
  // fictícias foram criadas, leva todas para perto da posição dele.
  recenterSeed(center, distKm) {
    const seed = this.data.shops.filter(s => s.id.startsWith('shop_seed_'));
    if (!seed.length) return false;
    let from = this.data.seedCenter;
    if (!from) {
      const s0 = seed.find(s => s.id === 'shop_seed_0') || seed[0];
      from = { lat: s0.lat - SEED_SHOPS[0].dLat, lng: s0.lng - SEED_SHOPS[0].dLng };
    }
    if (distKm(from, center) < 30) return false;
    const dLat = center.lat - from.lat;
    const dLng = center.lng - from.lng;
    seed.forEach(s => { s.lat += dLat; s.lng += dLng; });
    this.data.seedCenter = { ...center };
    this.save();
    return true;
  },

  reset() {
    localStorage.removeItem(DB_KEY);
    this.data = emptyDB();
  },

  user() {
    const id = this.data.session.userId;
    return id ? this.data.users.find(u => u.id === id) || null : null;
  },

  shop(id) {
    return this.data.shops.find(s => s.id === id) || null;
  },

  ownedShop() {
    const u = this.user();
    return u ? this.data.shops.find(s => s.ownerId === u.id) || null : null;
  },
};
