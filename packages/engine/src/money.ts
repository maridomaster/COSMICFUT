/**
 * Formatação curta de dinheiro (pt-BR) usada nas notícias da engine e no servidor. (Etapa 4) A moeda do jogo é o
 * EURO: "€ 1,05 bi", "€ 120 mi", "€ 11,9 mi", "€ 2,35 mi", "€ 850 mil", "€ 8,5 mil", "€ 300". Negativos com "-"
 * antes da moeda. Em reais (câmbio fixo `BRL_PER_EUR`): "R$ 756 mi".
 */
export const BRL_PER_EUR = 6.3;

export type CurrencyCode = 'EUR' | 'BRL';

export function fmtCompactPt(a: number): string {
  const f = (x: number, d: number) => x.toLocaleString('pt-BR', { maximumFractionDigits: d });
  if (a >= 1e9) return `${f(a / 1e9, 2)} bi`;
  if (a >= 1e6) return `${f(a / 1e6, a >= 1e8 ? 0 : a >= 1e7 ? 1 : 2)} mi`;
  if (a >= 1e3) return `${f(a / 1e3, a >= 1e4 ? 0 : 1)} mil`;
  return `${Math.round(a)}`;
}

export function fmtMoneyShort(v: number, currency: CurrencyCode = 'EUR'): string {
  const x = currency === 'BRL' ? v * BRL_PER_EUR : v;
  const s = fmtCompactPt(Math.abs(x));
  return `${x < 0 && s !== '0' ? '-' : ''}${currency === 'BRL' ? 'R$' : '€'} ${s}`;
}
