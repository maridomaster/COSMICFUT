/**
 * (18/11) Piso salarial pelo overall. Os dados reais trazem ligas que pagam bem menos que o nível do jogador
 * (Portugal, Holanda, Bélgica: Rafa Silva 80 de overall com € 49 mil/mês, a mediana do nível é ~€ 400 mil).
 * O piso vale nos CONTRATOS NOVOS e nas RENOVAÇÕES (transferências, livres, pré-contratos, renovações da IA, do
 * humano e da virada) — os salários atuais não mudam de uma vez (as receitas desses clubes foram calibradas
 * para as folhas reais). Não vale para a Base (salário pequeno de propósito) nem para os juniores gerados.
 *
 * Tabela ≈ 40% da mediana de salário mensal por overall em players-market.json; jovens ganham menos
 * (×0,5 até 20 anos, ×0,75 até 22 — mesma regra de `monthlyWage`).
 */
const TABLE: [number, number][] = [
  [50, 800], [55, 1_400], [60, 3_300], [65, 8_400], [70, 21_000], [75, 68_000], [78, 135_000],
  [80, 209_000], [82, 309_000], [85, 453_000], [88, 600_000], [90, 827_000], [95, 1_200_000],
];

/** Salário mensal mínimo de um contrato novo/renovado para o overall e a idade. */
export function wageFloor(age: number, overall: number): number {
  let v: number;
  if (overall < TABLE[0][0]) v = 500;
  else if (overall >= TABLE[TABLE.length - 1][0]) v = TABLE[TABLE.length - 1][1];
  else {
    let i = 0;
    while (overall >= TABLE[i + 1][0]) i++;
    const [o0, w0] = TABLE[i];
    const [o1, w1] = TABLE[i + 1];
    v = w0 + ((overall - o0) / (o1 - o0)) * (w1 - w0);
  }
  const ageMult = age <= 20 ? 0.5 : age <= 22 ? 0.75 : 1;
  return Math.max(300, Math.round((v * ageMult) / 100) * 100);
}

/** Salário com o piso aplicado. */
export function withWageFloor(wage: number, age: number, overall: number): number {
  return Math.max(Math.round(wage), wageFloor(age, overall));
}
