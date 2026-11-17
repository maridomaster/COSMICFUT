import type { Position } from '@cosmicfut/shared';
import { BRL_PER_EUR } from '@cosmicfut/engine';

/**
 * (Etapa 4) Moeda do jogo: EURO. A exibição em reais é opcional (Configurações → Moeda), com câmbio fixo
 * 1 € = R$ 6,30. `setDisplayCurrency` é chamado pela store de preferências (store/settings.ts).
 */
export type DisplayCurrency = 'EUR' | 'BRL';
let displayCurrency: DisplayCurrency = 'EUR';
export const setDisplayCurrency = (c: DisplayCurrency) => { displayCurrency = c; };
export const getDisplayCurrency = () => displayCurrency;
export const currencySymbol = () => (displayCurrency === 'BRL' ? 'R$' : '€');
/** Converte um valor do jogo (euros) para a moeda exibida. */
export const toDisplay = (v: number) => (displayCurrency === 'BRL' ? v * BRL_PER_EUR : v);
/** Converte um valor digitado na moeda exibida de volta para euros. */
export const fromDisplay = (v: number) => (displayCurrency === 'BRL' ? v / BRL_PER_EUR : v);
export const EXCHANGE_LABEL = `1 € = R$ ${BRL_PER_EUR.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
/** @deprecated use currencySymbol() — mantido para compatibilidade */
export const CURRENCY = '€';

const integer = new Intl.NumberFormat('pt-BR');
const dec = [0, 1, 2].map((d) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: d }));

/**
 * Valor compacto sem moeda (escala real, euros): "1,05 bi", "120 mi", "11,9 mi", "2,35 mi", "850 mil", "8,5 mil", "300".
 * Até 3 algarismos significativos, sem zeros à direita.
 */
export function fmtCompact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${dec[2].format(a / 1e9)} bi`;
  if (a >= 1e6) return `${dec[a >= 1e8 ? 0 : a >= 1e7 ? 1 : 2].format(a / 1e6)} mi`;
  if (a >= 1e3) return `${dec[a >= 1e4 ? 0 : 1].format(a / 1e3)} mil`;
  return integer.format(Math.round(a));
}

/**
 * Moeda compacta ("€ 1,05 bi", "€ 120 mi", "€ 850 mil"; em reais "R$ 756 mi"); negativos com sinal de menos
 * tipográfico ("−€ 3 mi").
 */
export const fmtMoney = (v: number) => {
  const x = toDisplay(v);
  const abs = fmtCompact(x);
  const sym = currencySymbol();
  return x < 0 && abs !== '0' ? `−${sym} ${abs}` : `${sym} ${abs}`;
};
/** Moeda com sinal explícito (+/−), para variações e resultados. */
export const fmtMoneySigned = (v: number) => (v > 0 ? `+${fmtMoney(v)}` : fmtMoney(v));
export const fmtInt = (v: number) => integer.format(v);
/** "1 dia", "3 dias" (forma plural explícita: "1 alteração", "2 alterações"). */
export const plural = (n: number, one: string, many: string) => `${integer.format(n)} ${n === 1 ? one : many}`;

export function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' }) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', opts).replace(/\./g, '');
}

/** "agora", "há 5 min", "há 2 h", "ontem", "há 3 dias" ou a data (para salvamentos). */
export function fmtAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'nunca';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const min = Math.floor(Math.max(0, now - t) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'ontem';
  if (d < 7) return `há ${d} dias`;
  return new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/\./g, '');
}

/** Tamanho em KB/MB ("2,4 MB"). */
export function fmtBytes(n: number): string {
  if (!n) return '—';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export const POSITION_ORDER: Position[] = ['GK', 'FB', 'CB', 'MF', 'FW'];

export const POSITION_META: Record<Position, { short: string; label: string; color: string }> = {
  GK: { short: 'GOL', label: 'Goleiros', color: 'var(--color-pos-gk)' },
  FB: { short: 'LAT', label: 'Laterais', color: 'var(--color-pos-fb)' },
  CB: { short: 'ZAG', label: 'Zagueiros', color: 'var(--color-pos-cb)' },
  MF: { short: 'MEI', label: 'Meias', color: 'var(--color-pos-mf)' },
  FW: { short: 'ATA', label: 'Atacantes', color: 'var(--color-pos-fw)' },
};

/** Cor da barra de overall por faixa. */
export function overallColor(ovr: number): string {
  if (ovr >= 85) return 'var(--club-accent)';
  if (ovr >= 78) return 'color-mix(in oklab, var(--club-accent) 70%, #ffffff)';
  if (ovr >= 70) return '#5fa8d3';
  if (ovr >= 62) return '#8a97ad';
  return '#5f6b80';
}

/** (Etapa 3) Tipo de carta no padrão EA Sports FC: ouro ≥ 75, prata 65–74, bronze ≤ 64. */
export type CardTier = 'gold' | 'silver' | 'bronze';
export function cardTier(ovr: number): CardTier {
  return ovr >= 75 ? 'gold' : ovr >= 65 ? 'silver' : 'bronze';
}
/** Cores das cartas: gradiente metálico (fundo), tinta sobre o metal, e tom de texto sobre fundo escuro. */
export const CARD_TIER_META: Record<CardTier, { label: string; range: string; from: string; via: string; to: string; ink: string; text: string }> = {
  gold: { label: 'Ouro', range: '75+', from: '#fbe7a1', via: '#e3b84f', to: '#a9791f', ink: '#3b2a06', text: '#eec95f' },
  silver: { label: 'Prata', range: '65–74', from: '#f1f4f8', via: '#bcc5d1', to: '#7e8a9b', ink: '#1f2733', text: '#c9d2de' },
  bronze: { label: 'Bronze', range: '≤64', from: '#f0c39b', via: '#c27d48', to: '#7f4a22', ink: '#2e1607', text: '#d89a66' },
};
export const cardTierMeta = (ovr: number) => CARD_TIER_META[cardTier(ovr)];

/** Nível do clube (1..24) → estrelas (0.5..5, passos de meia). */
export function levelToStars(level: number): number {
  return Math.max(0.5, Math.min(5, Math.round((level / 24) * 10) / 2));
}
