// Chave estável de jogador para o manifesto de fotos (photos.json v2).
//
// Fonte ÚNICA da normalização: importado pelo componente (PlayerPhoto.tsx) e pelo pipeline
// (packages/data/src/photos.mjs, via type stripping do Node). Só sintaxe TS apagável — nada de enum/namespace.

const SPECIAL: Record<string, string> = {
  ø: 'o',
  æ: 'ae',
  œ: 'oe',
  ß: 'ss',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ı: 'i',
  ħ: 'h',
};

/** "Rúben Dias" → "ruben dias"; "Martin Ødegaard" → "martin odegaard"; "Vini Jr." → "vini jr". */
export function normalizeName(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[øæœßłđðþıħ]/g, (c) => SPECIAL[c] ?? c)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Chave do jogador no manifesto: `${clubId}|${nome normalizado}` (o id "clube:índice" muda entre builds). */
export function playerKey(clubId: string, name: string): string {
  return `${clubId}|${normalizeName(name)}`;
}
