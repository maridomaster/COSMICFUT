/**
 * (Etapa 4) Leitura do livro-caixa (FinanceLedger) para a UI: linhas de receita e despesa do demonstrativo, com
 * os campos novos (comissão/funcionários, manutenção do estádio, cheque especial, vendas/compras separadas).
 * Livro antigo (sem `sales`/`purchases`): o saldo do mercado (`transfers`) vira venda ou compra pelo sinal.
 */
import type { FinanceLedger } from '@cosmicfut/engine';

export type LedgerLike = Partial<FinanceLedger>;

export interface LedgerLine {
  key: string;
  label: string;
  value: number;
  hint: string;
}

const n = (v: number | undefined) => v ?? 0;

/** Vendas e compras (positivas). Multas de rescisão entram em compras (o líquido do mercado sem vendas/compras). */
export function salesPurchases(l: LedgerLike): { sales: number; purchases: number } {
  if (l.sales !== undefined || l.purchases !== undefined) {
    const sales = n(l.sales);
    const purchases = -n(l.purchases);
    // o que sobra do líquido são multas de rescisão (negativas)
    const fines = Math.min(0, n(l.transfers) - (sales - purchases));
    return { sales, purchases: purchases - fines };
  }
  const t = n(l.transfers);
  return { sales: Math.max(0, t), purchases: Math.max(0, -t) };
}

export function revenueLines(l: LedgerLike): LedgerLine[] {
  const { sales } = salesPurchases(l);
  return [
    { key: 'tickets', label: 'Bilheteria', value: n(l.tickets), hint: 'jogos em casa (público × preço × importância)' },
    { key: 'tv', label: 'Cota de TV', value: n(l.tv), hint: 'parcelas mensais da liga (dia 1)' },
    { key: 'sponsor', label: 'Patrocínio e comercial', value: n(l.sponsor), hint: 'mensal (dia 1)' },
    { key: 'prizes', label: 'Prêmios e bônus', value: n(l.prizes), hint: 'fases de copas/continentais e posição na liga' },
    { key: 'sales', label: 'Venda de jogadores', value: sales, hint: 'transferências (mercado)' },
    { key: 'owner', label: 'Aporte', value: n(l.owner), hint: 'dono/investidor (PIF e clubes bancados)' },
  ];
}

export function expenseLines(l: LedgerLike): LedgerLine[] {
  const { purchases } = salesPurchases(l);
  return [
    { key: 'wages', label: 'Salários dos jogadores', value: -n(l.wages), hint: 'folha mensal (dia 1)' },
    { key: 'staff', label: 'Comissão técnica e funcionários', value: -n(l.staff), hint: 'inclui o técnico (dia 1)' },
    { key: 'maintenance', label: 'Manutenção do estádio', value: -n(l.maintenance), hint: 'por lugar, por mês' },
    { key: 'operating', label: 'Despesas operacionais', value: -n(l.operating), hint: 'administração, viagens, base' },
    { key: 'interest', label: 'Juros', value: -(n(l.overdraft) + n(l.loanInterest)), hint: 'cheque especial e empréstimo bancário' },
    { key: 'purchases', label: 'Compra de jogadores', value: purchases, hint: 'transferências e rescisões' },
    { key: 'luvas', label: 'Luvas', value: -n(l.luvas), hint: 'jogadores livres (à vista e parcelas)' },
    { key: 'stadium', label: 'Obras do estádio', value: -n(l.stadium), hint: 'ampliação' },
  ];
}

export function ledgerTotals(l: LedgerLike) {
  const income = revenueLines(l).reduce((s, x) => s + x.value, 0);
  const expenses = expenseLines(l).reduce((s, x) => s + x.value, 0);
  return { income, expenses, net: income - expenses };
}
