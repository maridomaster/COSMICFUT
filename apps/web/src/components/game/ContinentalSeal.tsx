import { CompetitionEmblem } from './CompetitionEmblem';

/**
 * Selo próprio (NÃO oficial) de uma competição. (Sala de Troféus) Agora delega para `CompetitionEmblem`, que usa o
 * registro central `data/competitionIdentity.ts` (cores, motivo e sigla de TODAS as competições, não só das
 * continentais). Mantido com a mesma assinatura para não mexer nas telas que já o usam.
 */
export function ContinentalSeal({ compId, size = 40, className, title }: { compId: string; size?: number; className?: string; title?: string }) {
  return <CompetitionEmblem compId={compId} size={size} className={className} title={title} />;
}
