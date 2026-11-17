import { describe, expect, it } from 'vitest';
import { decodeBundle, decodeCkptChunk, encodeBundle, encodeCkptChunk, encodeHostFrame, fragment, readHostHeader, Reassembler } from '../src/wire.ts';

describe('wire', () => {
  it('lote com binários grandes: fragmenta e remonta', () => {
    const big = new Uint8Array(600_000).map((_, i) => i % 255);
    const f = encodeBundle([{ ev: 'season:snapshot', a: { version: 1, stateGz: big, nested: [{ w: new Uint8Array([1, 2]) }] } }, { ev: 'room:state', a: { x: 1 }, dt: 5 }]);
    const frags = fragment(f, 7);
    expect(frags.length).toBe(3);
    const r = new Reassembler();
    let out: Uint8Array | null = null;
    for (const x of frags.reverse()) out = r.push(x) ?? out;
    const m = decodeBundle(out!);
    expect(m[0].ev).toBe('season:snapshot');
    expect((m[0].a as { stateGz: Uint8Array }).stateGz).toEqual(big);
    expect((m[0].a as { nested: { w: Uint8Array }[] }).nested[0].w).toEqual(new Uint8Array([1, 2]));
    expect(m[1]).toEqual({ ev: 'room:state', a: { x: 1 }, dt: 5 });
  });

  it('quadro do anfitrião: cabeçalho legível sem tocar no corpo; pedaço de checkpoint', () => {
    const body = encodeBundle([{ ev: 'x', a: null }]);
    const f = encodeHostFrame({ o: [{ to: ['c1'], n: body.byteLength }], drop: ['p_1'] }, [body]);
    const { hdr, offset } = readHostHeader(f);
    expect(hdr.drop).toEqual(['p_1']);
    expect(f.subarray(offset)).toEqual(body);
    const c = decodeCkptChunk(encodeCkptChunk(2, 5, new Uint8Array([9, 8])));
    expect(c).toEqual({ i: 2, n: 5, bytes: new Uint8Array([9, 8]) });
  });
});
