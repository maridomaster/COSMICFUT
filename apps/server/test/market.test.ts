/**
 * Mercado online: o servidor roda a API de transferências da engine sobre a carreira da sala (só no planejamento),
 * manda 'market:update' (patch gzip: market + clubes envolvidos + notícias) e guarda o snapshot completo.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { careerSquads, worldSquads, type Player, type SeasonState, type TransferOffer, type WorldState } from '@cosmicfut/engine';
import type { MarketActionResult, MarketPatch, MarketUpdatePayload, SeasonSnapshotPayload } from '@cosmicfut/shared';
import { DEFAULT_DATA_DIR } from '../src/config.ts';
import { CareerSimulator } from '../src/sim-core.ts';
import type { CosmicServer } from '../src/server.ts';
import { call, client, decodeSnap, gunzip, ok, sleep, startServer, type Client } from './helpers.ts';

const A_CLUB = 'palmeiras';
const B_CLUB = 'santos';
const AI_CLUB = 'gremio';

/** Cliente "como o web": aplica snapshots e patches de mercado em ordem de versão. */
class MarketView {
  state: SeasonState | null = null;
  world: WorldState | null = null;
  version = 0;
  updates: MarketUpdatePayload[] = [];
  gaps = 0;
  readonly s: Client;
  constructor(s: Client) {
    this.s = s;
    s.on('season:snapshot', (p: SeasonSnapshotPayload) => {
      const d = decodeSnap(p);
      if (d.world) this.world = d.world;
      if (d.version >= this.version) {
        this.state = d.state;
        this.version = d.version;
      }
    });
    s.on('market:update', (u: MarketUpdatePayload) => {
      this.updates.push(u);
      if (!this.state || u.version <= this.version) return;
      if (u.version !== this.version + 1) this.gaps++;
      const p = gunzip<MarketPatch>(u.patchGz);
      this.state = {
        ...this.state,
        market: p.market as SeasonState['market'],
        clubs: { ...this.state.clubs, ...(p.clubs as SeasonState['clubs']) },
        news: this.state.news.slice(0, p.news.from).concat(p.news.items as SeasonState['news']),
      };
      this.version = u.version;
    });
  }
  async at(version: number, timeoutMs = 20_000): Promise<SeasonState> {
    const t0 = Date.now();
    while (this.version < version) {
      if (Date.now() - t0 > timeoutMs) throw new Error(`timeout esperando a versão ${version} (tenho ${this.version})`);
      await sleep(10);
    }
    return this.state!;
  }
  offer(id: string): TransferOffer | undefined {
    return this.state?.market?.offers.find((o) => o.id === id);
  }
}

let srv: CosmicServer;
let url: string;
let a: Client;
let b: Client;
let va: MarketView;
let vb: MarketView;
let code: string;
let squads: (state: SeasonState, world: WorldState) => (clubId: string) => Player[];

beforeAll(async () => {
  ({ srv, url } = await startServer({ halfTimeTimeoutMs: 0 }));
  a = await client(url);
  b = await client(url);
  va = new MarketView(a);
  vb = new MarketView(b);
  ({ code } = await ok<{ code: string }>(a, 'room:create', { nickname: 'Comprador', settings: { matchSpeedMs: 1 } }));
  await ok(b, 'room:join', { code, nickname: 'Vendedor' });
  await ok(a, 'room:pick-club', { clubId: A_CLUB });
  await ok(b, 'room:pick-club', { clubId: B_CLUB });
  await ok(a, 'room:start');
  await va.at(1);
  await vb.at(1);
  const base = new CareerSimulator(DEFAULT_DATA_DIR).baseFor([A_CLUB, B_CLUB]);
  squads = (state, world) => careerSquads(state, worldSquads(world, base));
}, 60_000);

afterAll(async () => {
  a?.disconnect();
  b?.disconnect();
  await srv?.close();
});

describe('mercado online', () => {
  it('compra da IA: proposta → (contraproposta) → acordo → contrato; patch para a sala e snapshot guardado', async () => {
    const st = va.state!;
    expect(st.date <= '2026-03-31').toBe(true);
    const balance0 = st.clubs[A_CLUB].balance;
    const cands = squads(st, va.world!)(AI_CLUB)
      .filter((p) => p.value >= 500_000 && p.value * 2 < balance0 && p.age < 30)
      .sort((x, y) => y.overall - x.overall);
    expect(cands.length).toBeGreaterThan(0);
    let deal: TransferOffer | null = null;
    let target: Player | null = null;
    for (const p of cands.slice(0, 4)) {
      let offerId: string | undefined;
      let fee = Math.round(p.value * 1.4);
      for (let round = 0; round < 3; round++) {
        const r = await ok<MarketActionResult>(a, 'market:offer', { playerId: p.id, fee, kind: 'transfer', offerId });
        const o = r.offer as TransferOffer;
        const club = r.club as { decision: string; counterFee?: number; reason: string };
        expect(club.reason).toBeTruthy(); // ack traz a resposta da IA
        offerId = o.id;
        if (o.status === 'agreed') {
          deal = o;
          break;
        }
        if (club.decision !== 'counter' || o.status !== 'negotiating') break;
        fee = club.counterFee!;
      }
      if (deal) {
        target = p;
        break;
      }
    }
    expect(deal && target).toBeTruthy();
    // os DOIS clientes recebem o patch; o estado aplicado tem a negociação
    const v1 = await va.at(va.version);
    expect(v1.market!.offers.find((o) => o.id === deal!.id)?.status).toBe('agreed');
    await vb.at(va.version);
    expect(vb.offer(deal!.id)?.status).toBe('agreed');

    // contrato: generoso o bastante; contraproposta → paga o pedido
    let wage = Math.round(target!.wage * 2.5);
    let done: MarketActionResult | null = null;
    for (let round = 0; round < 3 && !done; round++) {
      const r = await ok<MarketActionResult>(a, 'market:contract', { offerId: deal!.id, wage, years: 3 });
      const o = r.offer as TransferOffer;
      if (o.status === 'completed') done = r;
      else if (o.status === 'agreed' && o.askedWage) wage = o.askedWage;
      else break;
    }
    expect(done).toBeTruthy();
    expect(done!.record).toBeTruthy();
    const s2 = await va.at(done!.version);
    expect(s2.market!.moves[target!.id]).toBe(A_CLUB);
    expect(s2.clubs[A_CLUB].balance).toBe(balance0 - deal!.fee);
    const room = srv.rooms.get(code)!;
    expect(room.career!.humanSquads[A_CLUB]).toContain(target!.id);
    expect(va.gaps).toBe(0);
    // patch bem menor que o estado inteiro
    const last = va.updates[va.updates.length - 1];
    expect(last.bytes!.gz).toBeLessThan(room.snap!.stats.stateGz);
    console.log(`[métricas] market:update ${(last.bytes!.gz / 1024).toFixed(0)} KB gz (${(last.bytes!.json / 1024).toFixed(0)} KB json) × snapshot do estado ${(room.snap!.stats.stateGz / 1024).toFixed(0)} KB gz`);
    // o snapshot guardado pela sala (rejoin/disco) já tem a compra
    await sleep(300);
    expect(room.snap!.version).toBe(done!.version);
    expect(gunzip<SeasonState>(room.snap!.stateGz).market!.moves[target!.id]).toBe(A_CLUB);
  });

  it('jogador livre: contrato direto pelo playerId, com luva parcelada', async () => {
    const st = va.state!;
    const free = Object.entries(st.market!.moves).filter(([, c]) => c === '').map(([id]) => st.market!.players[id]).filter((p): p is Player => !!p && p.age < 32);
    if (!free.length) return; // sem livres nesta seed
    const p = free.sort((x, y) => y.overall - x.overall)[0];
    let wage = Math.round(p.wage * 2.5);
    let r = await ok<MarketActionResult>(a, 'market:contract', { playerId: p.id, wage, years: 2, luva: 12 });
    let o = r.offer as TransferOffer;
    if (o.status === 'agreed' && o.askedWage) {
      wage = o.askedWage;
      r = await ok<MarketActionResult>(a, 'market:contract', { offerId: o.id, wage, years: 2, luva: 12 });
      o = r.offer as TransferOffer;
    }
    expect(o.status).toBe('completed');
    const s = await va.at(r.version);
    expect(s.market!.moves[p.id]).toBe(A_CLUB);
    expect(s.clubs[A_CLUB].luvaDebts?.some((d) => d.playerId === p.id && d.remainingInstallments === 12)).toBe(true);
  });

  it('saldo insuficiente e validações (dono, ids, tipo)', async () => {
    const st = va.state!;
    const bal = st.clubs[A_CLUB].balance;
    const p = squads(st, va.world!)(AI_CLUB).find((x) => !st.market!.moves[x.id])!;
    // (Etapa 5, de propósito) o servidor passou a usar o limite do cheque especial do clube, como a engine (Etapa 4)
    const credit = st.clubInfo?.[A_CLUB]?.creditLimit ?? 0;
    const r = await call(a, 'market:offer', { playerId: p.id, fee: bal + credit + 5_000_000, kind: 'transfer' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Saldo insuficiente/);
    // não é dono: B tenta responder/desistir de negociações de A e listar jogador de A
    const mineA = squads(st, va.world!)(A_CLUB)[0];
    expect((await call(b, 'market:list', { playerIds: [mineA.id], listed: true })).ok).toBe(false);
    const someOffer = st.market!.offers.find((o) => o.toClubId === A_CLUB)!;
    expect((await call(b, 'market:withdraw', { offerId: someOffer.id })).ok).toBe(false);
    expect((await call(a, 'market:offer', { playerId: p.id, fee: 1, kind: 'swap' })).ok).toBe(false);
    expect((await call(a, 'market:offer', { playerId: '../x', fee: 1 })).ok).toBe(false);
    expect((await call(a, 'market:contract', { wage: 1, years: 3 })).ok).toBe(false);
    // jogador do próprio elenco
    expect((await call(a, 'market:offer', { playerId: mineA.id, fee: 1_000_000 })).ok).toBe(false);
  });

  it('humano × humano: proposta fica pendente para o dono; aceita transfere; sem resposta é recusada no fim do planejamento', async () => {
    const st = va.state!;
    const sqB = squads(st, va.world!)(B_CLUB).sort((x, y) => x.value - y.value);
    const [p1, p2] = sqB.filter((p) => p.value > 0 && p.value < st.clubs[A_CLUB].balance / 4).slice(-2);
    const balA = st.clubs[A_CLUB].balance;
    const balB = st.clubs[B_CLUB].balance;
    const r1 = await ok<MarketActionResult>(a, 'market:offer', { playerId: p1.id, fee: p1.value, kind: 'transfer' });
    expect(r1.pendingHuman).toBe(true);
    const o1 = r1.offer as TransferOffer;
    expect(o1.status).toBe('pending');
    expect(o1.fromClubId).toBe(B_CLUB);
    // B vê a proposta como "oferta recebida" (pending, fromClubId = B)
    await vb.at(r1.version);
    expect(vb.offer(o1.id)?.status).toBe('pending');
    expect(vb.state!.news.some((n) => n.clubId === B_CLUB && n.text.includes(p1.name))).toBe(true);
    // repetida: recusada
    expect((await call(a, 'market:offer', { playerId: p1.id, fee: p1.value, kind: 'transfer' })).ok).toBe(false);
    // só o dono responde
    expect((await call(a, 'market:respond', { offerId: o1.id, accept: true })).ok).toBe(false);
    const acc = await ok<MarketActionResult>(b, 'market:respond', { offerId: o1.id, accept: true });
    // (Etapa 5, de propósito) o aceite do dono fecha só a etapa do clube; o comprador negocia salário e anos com o jogador
    expect((acc.offer as TransferOffer).status).toBe('agreed');
    await va.at(acc.version);
    let wage = Math.round(p1.wage * 1.5);
    let done: MarketActionResult | null = null;
    for (let round = 0; round < 3 && !done; round++) {
      const r = await ok<MarketActionResult>(a, 'market:contract', { offerId: o1.id, wage, years: 3 });
      const o = r.offer as TransferOffer;
      if (o.status === 'completed') done = r;
      else if (o.status === 'agreed' && o.askedWage) wage = Math.round(o.askedWage * (round === 1 ? 1.7 : 1));
      else break;
    }
    expect(done).toBeTruthy();
    expect((done!.offer as TransferOffer).wage).toBe(wage);
    const s1 = await va.at(done!.version);
    expect(s1.market!.moves[p1.id]).toBe(A_CLUB);
    expect(s1.clubs[A_CLUB].balance).toBe(balA - p1.value);
    expect(s1.clubs[B_CLUB].balance).toBe(balB + p1.value);
    const room = srv.rooms.get(code)!;
    expect(room.career!.humanSquads[A_CLUB]).toContain(p1.id);
    expect(room.career!.humanSquads[B_CLUB]).not.toContain(p1.id);

    // segunda proposta: B não responde → recusada quando a rodada avança
    // (nota 37) taxa de empréstimo pequena: a compra de p1 consumiu o orçamento de transferências do Palmeiras
    const r2 = await ok<MarketActionResult>(a, 'market:offer', { playerId: p2.id, fee: Math.round(p2.value * 0.05), kind: 'loan' });
    const o2 = r2.offer as TransferOffer;
    expect(o2.kind).toBe('loan');
    const v0 = va.version;
    await ok(a, 'dev:advance', { until: 'next-match' });
    const s2 = await va.at(v0 + 1);
    const after = s2.market!.offers.find((o) => o.id === o2.id)!;
    expect(after.status).toBe('rejected');
    expect(after.log.at(-1)?.text).toMatch(/Sem resposta/);
    expect(s2.market!.moves[p2.id]).toBeUndefined();
  });

  it('(nota 37) orçamentos: equilíbrio validado no servidor; compra acima do orçamento recusada; 3 recusas do dono irritam', async () => {
    const st = va.state!;
    const bud = st.clubs[A_CLUB].budget!;
    expect(bud).toBeDefined();
    // equilíbrio: € 1 mi de transferências = € 50 mil/mês de folha
    if (bud.transfer >= 1_000_000) {
      const r = await ok<MarketActionResult>(a, 'market:budget', { toWage: 1_000_000 });
      const s = await va.at(r.version);
      expect(s.clubs[A_CLUB].budget!.transfer).toBe(bud.transfer - 1_000_000);
      expect(s.clubs[A_CLUB].budget!.wage).toBe(bud.wage + 50_000);
    }
    // piso: a folha não fica abaixo da comprometida
    const floor = await call(a, 'market:budget', { toWage: -2_000_000_000 });
    expect(floor.ok).toBe(false);
    if (!floor.ok) expect(floor.error).toMatch(/folha comprometida|orçamento/);
    // compra acima do orçamento de transferências (o caixa não importa)
    const s0 = va.state!;
    const sqB = squads(s0, va.world!)(B_CLUB).sort((x, y) => y.value - x.value);
    const big = sqB[0];
    const over = await call(a, 'market:offer', { playerId: big.id, fee: s0.clubs[A_CLUB].budget!.transfer + 1_000_000, kind: 'transfer' });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toMatch(/Orçamento de transferências/);
    // humano × humano: 3 recusas do dono na janela ⇒ 14 dias sem propostas
    const target = sqB[sqB.length - 1];
    for (let i = 0; i < 3; i++) {
      const r = await ok<MarketActionResult>(a, 'market:offer', { playerId: target.id, fee: 0, kind: 'loan' });
      await vb.at(r.version);
      await ok<MarketActionResult>(b, 'market:respond', { offerId: (r.offer as TransferOffer).id, accept: false });
    }
    const blocked = await call(a, 'market:offer', { playerId: target.id, fee: 0, kind: 'loan' });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toMatch(/Clube irritado com propostas insistentes\. Disponível novamente em \d\d\/\d\d\./);
  });

  it('(Etapa 5) lista de empréstimo, renovação e validações das ações novas', async () => {
    const st = va.state!;
    const mineA = squads(st, va.world!)(A_CLUB).filter((p) => !p.youth).sort((x, y) => y.overall - x.overall)[2];
    const rl = await ok<MarketActionResult>(a, 'market:loanlist', { playerIds: [mineA.id], listed: true });
    expect((await va.at(rl.version)).market!.loanList).toContain(mineA.id);
    // só o dono mexe no próprio elenco
    expect((await call(b, 'market:loanlist', { playerIds: [mineA.id], listed: false })).ok).toBe(false);
    expect((await call(b, 'market:renew', { playerId: mineA.id, wage: 1_000_000, years: 3 })).ok).toBe(false);
    // renovação: abaixo do pedido é recusada; generosa é aceita
    expect((await call(a, 'market:renew', { playerId: mineA.id, wage: 1, years: 3 })).ok).toBe(false);
    const rr = await ok<MarketActionResult>(a, 'market:renew', { playerId: mineA.id, wage: Math.round(mineA.wage * 3), years: 3, releaseClause: 90_000_000 });
    const s = await va.at(rr.version);
    expect(s.market!.contracts[mineA.id]).toMatchObject({ kind: 'renewal', releaseClause: 90_000_000 });
    // payloads inválidos
    expect((await call(a, 'market:offer', { playerId: mineA.id, fee: 1, kind: 'loan', loan: { wageShare: 300 } })).ok).toBe(false);
    expect((await call(a, 'market:counter', { offerId: 'nao-existe', fee: 1 })).ok).toBe(false);
    expect((await call(a, 'market:option', { playerId: mineA.id })).ok).toBe(false);
  });

  it('ofertas da IA pelos jogadores do humano: aparecem para o dono, que aceita ou recusa', async () => {
    let st = vb.state!;
    const sq = squads(st, vb.world!)(B_CLUB).sort((x, y) => x.overall - y.overall);
    const listed = sq.slice(0, 8).map((p) => p.id);
    const rl = await ok<MarketActionResult>(b, 'market:list', { playerIds: listed, listed: true });
    st = await vb.at(rl.version);
    expect(listed.every((id) => st.market!.transferList.includes(id))).toBe(true);
    const pendingAi = () => (vb.state!.market!.offers ?? []).filter((o) => o.fromClubId === B_CLUB && o.status === 'pending' && o.toClubId !== A_CLUB);
    for (let i = 0; i < 12 && pendingAi().length < 2; i++) {
      const v0 = vb.version;
      await ok(a, 'dev:advance', { until: 'next-match' });
      await vb.at(v0 + 1);
      if (vb.state!.date > '2026-03-25') break;
    }
    const offers = pendingAi();
    expect(offers.length).toBeGreaterThan(0);
    const [first, second] = offers;
    const balB = vb.state!.clubs[B_CLUB].balance;
    const r = await call<MarketActionResult>(b, 'market:respond', { offerId: first.id, accept: true });
    if (r.ok) {
      // (Etapa 5, de propósito) depois do aceite do dono, o jogador decide se vai (pode recusar o clube comprador)
      const st2 = (r.data.offer as TransferOffer).status;
      expect(['completed', 'collapsed']).toContain(st2);
      const s = await vb.at(r.data.version);
      if (st2 === 'completed') {
        expect(s.market!.moves[first.playerId]).toBe(first.toClubId);
        expect(s.clubs[B_CLUB].balance).toBe(balB + first.fee);
      } else expect(s.market!.moves[first.playerId]).toBeUndefined();
    } else {
      // o comprador ficou sem caixa / mínimo de elenco: erro explícito (e a oferta sai da lista)
      expect(r.error).toBeTruthy();
    }
    if (second && vb.offer(second.id)?.status === 'pending') {
      const r2 = await ok<MarketActionResult>(b, 'market:respond', { offerId: second.id, accept: false });
      expect((await vb.at(r2.version)).market!.offers.find((o) => o.id === second.id)?.status).toBe('rejected');
    }
    // tira da lista
    const still = vb.state!.market!.transferList.filter((id) => listed.includes(id));
    if (still.length) {
      const r3 = await ok<MarketActionResult>(b, 'market:list', { playerIds: still, listed: false });
      expect((await vb.at(r3.version)).market!.transferList.some((id) => still.includes(id))).toBe(false);
    }
  });

  it('fora da janela: proposta por jogador com clube é recusada; dispensa funciona', async () => {
    const v0 = va.version;
    await ok(a, 'dev:advance', { until: '2026-04-10' });
    let st = await va.at(v0 + 1);
    // (Etapa 1) a versão seguinte pode ser um patch atrasado da ação anterior: espera o snapshot da rodada
    for (let k = 0; k < 5 && st.date < '2026-04-01'; k++) st = await va.at(va.version + 1);
    expect(st.date >= '2026-04-01').toBe(true);
    const p = squads(st, va.world!)(AI_CLUB).find((x) => !st.market!.moves[x.id])!;
    const r = await call(a, 'market:offer', { playerId: p.id, fee: p.value, kind: 'transfer' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/janela/i);
    // rescisão (qualquer época): multa de 3 salários
    const mine = squads(st, va.world!)(A_CLUB).sort((x, y) => x.overall - y.overall)[0];
    const bal = st.clubs[A_CLUB].balance;
    const rr = await ok<MarketActionResult>(a, 'market:release', { playerId: mine.id });
    const s2 = await va.at(rr.version);
    expect(s2.market!.moves[mine.id]).toBe('');
    expect(s2.clubs[A_CLUB].balance).toBe(bal - mine.wage * 3);
    expect(va.gaps).toBe(0);
    expect(vb.gaps).toBe(0);
  });
});
