/**
 * Plataforma Node do núcleo online: gzip via node:zlib (bem mais rápido que o fflate do navegador).
 * Importado pelos módulos do servidor que usam o núcleo (room, sim-core, server, sim-worker).
 */
import { gunzipSync, gzipSync } from 'node:zlib';
import { setCodec } from '@cosmicfut/online-core/platform';

setCodec({
  gzip: (d, level = 6) => {
    const b = gzipSync(d, { level });
    return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  },
  gunzip: (d, maxOutput) => {
    const b = gunzipSync(d, maxOutput !== undefined ? { maxOutputLength: maxOutput } : {});
    return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  },
});
