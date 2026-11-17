// Pesquisa: extrai strings Latin-1 e UTF-16LE de um binario (apenas leitura, nao executa nada).
// Uso: node exe-strings.mjs <binario> <saida-latin1.txt> <saida-utf16.txt> [minLen]
import fs from 'node:fs';

const [bin, outL, outU, minArg] = process.argv.slice(2);
const MIN = Number(minArg || 6);
const buf = fs.readFileSync(bin);
const ok = (c) => (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || c === 0x0a || c === 0x09;

{
  const out = fs.createWriteStream(outL, { encoding: 'utf8' });
  let start = -1;
  for (let i = 0; i <= buf.length; i++) {
    const c = i < buf.length ? buf[i] : 0;
    if (ok(c)) { if (start < 0) start = i; continue; }
    if (start >= 0 && i - start >= MIN) {
      const s = buf.latin1Slice(start, i);
      // exige ao menos uma letra ASCII para cortar lixo binario
      if (/[A-Za-z]{3}/.test(s)) out.write(`${start.toString(16)}\t${s.replace(/\n/g, '\\n')}\n`);
    }
    start = -1;
  }
  out.end();
}
{
  const out = fs.createWriteStream(outU, { encoding: 'utf8' });
  for (const par of [0, 1]) {
    let start = -1;
    for (let i = par; i + 1 <= buf.length; i += 2) {
      const c = i + 1 < buf.length ? buf.readUInt16LE(i) : 0;
      if (c < 0x100 ? ok(c) : (c >= 0x100 && c < 0x2100)) { if (start < 0) start = i; continue; }
      if (start >= 0 && (i - start) / 2 >= MIN) {
        const s = buf.subarray(start, i).toString('utf16le');
        if (/[A-Za-z]{3}/.test(s)) out.write(`${start.toString(16)}\t${s.replace(/\n/g, '\\n')}\n`);
      }
      start = -1;
    }
  }
  out.end();
}
