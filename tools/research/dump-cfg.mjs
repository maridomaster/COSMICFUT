// Pesquisa: dump dos .cfg (somente leitura) do original.
// Uso: node dump-cfg.mjs <dir> [arquivo] [--full]
import fs from 'node:fs';
import path from 'node:path';
import { readJavaSerialized } from '../../packages/data/src/javaser.mjs';

const args = process.argv.slice(2);
const full = args.includes('--full');
const [dir, only] = args.filter((a) => !a.startsWith('--'));
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.cfg') && (!only || f === only));
const B = (b) => (b ? 'T' : 'f');
for (const f of files) {
  const top = readJavaSerialized(fs.readFileSync(path.join(dir, f)))[0];
  const items = (top && top.$items) || [];
  for (const d of items) {
    if (!d || typeof d !== 'object' || !((d.nTimes | 0) > 0) || (d.valido === false && !args.includes('--all'))) continue;
    if (full) {
      const o = {};
      for (const [k, v] of Object.entries(d)) if (!k.startsWith('$')) o[k] = v;
      console.log(f, JSON.stringify(o, (k, x) => (typeof x === 'bigint' ? String(x) : x)));
      continue;
    }
    const pp = (d.positionPrizes || []).filter((x) => x && x !== '0');
    console.log([
      f.replace('.cfg', ''), `d${d.divisao}`, `n=${d.nTimes}`, `F=${d.formula}`, `G=${d.nGrupos}`,
      `2T=${B(d.doisTurnos)}`, `reb=${d.nRebaixados}/${d.rebaixadosDireto}`, `pAc=${B(d.playoffAcesso)}`,
      `sobeMM=${d.vagasSobemPeloMataMata}`, `nMM=${d.numeroTimesMataMata}`, `AC=${B(d.aperturaClausura)}`,
      `des=${d.desempate}`, `geral=${B(d.classificaPeloGeral)}`, `m3=${B(d.melhoresTerceiros)}`,
      `pReb=${d.playoffRebaixamento}`, `dentro=${B(d.jogosDentroGrupo)}`, `rebGrp=${B(d.rebaixadoPeloGrupo)}`, `rebGeral=${B(d.rebaixamentoGeral)}`,
      `2vMM=${(d.duasVoltasMataMata || []).map(B).join('')}`, `2vSobe=${(d.duasVoltasMataMataSobe || []).map(B).join('')}`,
      `2vReb=${(d.duasVoltasplayoffReb || []).map(B).join('')}`,
      `nome=${d.nome}|${d.nomeDivisao}`, pp.length ? `prizes=${pp.join(',')}` : '',
    ].join(' '));
  }
}

