// Minimal Java Object Serialization (stream protocol v2, magic AC ED 00 05) reader.
// Read-only, no class loading: produces plain JS objects.
// Port ESM de tools/extract/javaser.js.
// Cobre o que os arquivos do jogo usam: TC_OBJECT, TC_CLASSDESC, TC_STRING, TC_REFERENCE,
// TC_NULL, TC_ARRAY, TC_ENUM, block data e o writeObject customizado de ArrayList.

const TC = {
  NULL: 0x70, REFERENCE: 0x71, CLASSDESC: 0x72, OBJECT: 0x73, STRING: 0x74,
  ARRAY: 0x75, CLASS: 0x76, BLOCKDATA: 0x77, ENDBLOCKDATA: 0x78, RESET: 0x79,
  BLOCKDATALONG: 0x7a, EXCEPTION: 0x7b, LONGSTRING: 0x7c, PROXYCLASSDESC: 0x7d, ENUM: 0x7e,
};
const BASE_HANDLE = 0x7e0000;
const SC_WRITE_METHOD = 0x01;

export class JavaReader {
  constructor(buf) { this.b = buf; this.p = 0; this.handles = []; }

  need(n) { if (this.p + n > this.b.length) throw new Error(`unexpected EOF at 0x${this.p.toString(16)}`); }
  u8() { this.need(1); return this.b[this.p++]; }
  i8() { this.need(1); return this.b.readInt8(this.p++); }
  u16() { this.need(2); const v = this.b.readUInt16BE(this.p); this.p += 2; return v; }
  i16() { this.need(2); const v = this.b.readInt16BE(this.p); this.p += 2; return v; }
  i32() { this.need(4); const v = this.b.readInt32BE(this.p); this.p += 4; return v; }
  i64() { this.need(8); const v = this.b.readBigInt64BE(this.p); this.p += 8; return v; }
  f32() { this.need(4); const v = this.b.readFloatBE(this.p); this.p += 4; return v; }
  f64() { this.need(8); const v = this.b.readDoubleBE(this.p); this.p += 8; return v; }

  // Java "modified UTF-8" (prefixo u2 já consumido)
  utf(len) {
    this.need(len);
    const s = this.b.subarray(this.p, this.p + len); this.p += len;
    let out = '';
    for (let i = 0; i < s.length;) {
      const c = s[i];
      if (c < 0x80) { out += String.fromCharCode(c); i += 1; }
      else if ((c & 0xe0) === 0xc0) { out += String.fromCharCode(((c & 0x1f) << 6) | (s[i + 1] & 0x3f)); i += 2; }
      else { out += String.fromCharCode(((c & 0x0f) << 12) | ((s[i + 1] & 0x3f) << 6) | (s[i + 2] & 0x3f)); i += 3; }
    }
    return out;
  }
  newHandle(obj) { this.handles.push(obj); }
  ref() {
    const h = this.i32() - BASE_HANDLE;
    if (h < 0 || h >= this.handles.length) throw new Error('bad back-reference ' + h);
    return this.handles[h];
  }

  readStream() {
    if (this.u16() !== 0xaced) throw new Error('bad magic (not Java serialization)');
    const ver = this.u16();
    if (ver !== 5) throw new Error('unsupported stream version ' + ver);
    const contents = [];
    while (this.p < this.b.length) contents.push(this.readContent());
    return contents;
  }
  readContent() {
    const tc = this.b[this.p];
    if (tc === TC.BLOCKDATA) { this.p++; const n = this.u8(); this.need(n); const d = this.b.subarray(this.p, this.p + n); this.p += n; return { $block: d }; }
    if (tc === TC.BLOCKDATALONG) { this.p++; const n = this.i32(); this.need(n); const d = this.b.subarray(this.p, this.p + n); this.p += n; return { $block: d }; }
    return this.readObject();
  }
  readObject() {
    const tc = this.u8();
    switch (tc) {
      case TC.NULL: return null;
      case TC.REFERENCE: return this.ref();
      case TC.STRING: { const s = this.utf(this.u16()); this.newHandle(s); return s; }
      case TC.LONGSTRING: { const s = this.utf(Number(this.i64())); this.newHandle(s); return s; }
      case TC.OBJECT: return this.readNewObject();
      case TC.ARRAY: return this.readNewArray();
      case TC.ENUM: { const cd = this.readClassDesc(); const o = { $class: cd.name, $enum: null }; this.newHandle(o); o.$enum = this.readObject(); return o; }
      case TC.CLASSDESC: this.p--; return this.readClassDesc();
      case TC.RESET: this.handles = []; return this.readObject();
      default: throw new Error(`unsupported typecode 0x${tc.toString(16)} at 0x${(this.p - 1).toString(16)}`);
    }
  }
  readClassDesc() {
    const tc = this.u8();
    if (tc === TC.NULL) return null;
    if (tc === TC.REFERENCE) return this.ref();
    if (tc !== TC.CLASSDESC) throw new Error(`expected classdesc, got 0x${tc.toString(16)} at 0x${(this.p - 1).toString(16)}`);
    const name = this.utf(this.u16());
    const suid = this.i64();
    const cd = { name, suid: suid.toString(), flags: 0, fields: [], super: null };
    this.newHandle(cd);
    cd.flags = this.u8();
    const n = this.u16();
    for (let i = 0; i < n; i++) {
      const t = String.fromCharCode(this.u8());
      const fname = this.utf(this.u16());
      const cls = (t === 'L' || t === '[') ? this.readObject() : null;
      cd.fields.push({ t, name: fname, cls });
    }
    while (this.b[this.p] !== TC.ENDBLOCKDATA) this.readContent();
    this.p++;
    cd.super = this.readClassDesc();
    return cd;
  }
  readValue(t) {
    switch (t) {
      case 'B': return this.i8();
      case 'C': return String.fromCharCode(this.u16());
      case 'D': return this.f64();
      case 'F': return this.f32();
      case 'I': return this.i32();
      case 'J': return this.i64().toString();
      case 'S': return this.i16();
      case 'Z': return this.u8() !== 0;
      default: return this.readObject();
    }
  }
  readNewArray() {
    const cd = this.readClassDesc();
    const arr = []; this.newHandle(arr);
    const n = this.i32(); const et = cd.name[1];
    for (let i = 0; i < n; i++) arr.push(this.readValue(et));
    return arr;
  }
  readNewObject() {
    const cd = this.readClassDesc();
    const obj = { $class: cd.name }; this.newHandle(obj);
    const chain = []; for (let c = cd; c; c = c.super) chain.unshift(c);
    for (const c of chain) {
      for (const f of c.fields) obj[f.name] = this.readValue(f.t);
      if (c.flags & SC_WRITE_METHOD) {
        const extra = [];
        while (this.b[this.p] !== TC.ENDBLOCKDATA) extra.push(this.readContent());
        this.p++;
        if (c.name === 'java.util.ArrayList') obj.$items = extra.filter(x => !(x && x.$block));
        else obj.$annotations = extra;
      }
    }
    return obj;
  }
}

/** Lê um arquivo de serialização Java e devolve o array de objetos de topo. */
export function readJavaSerialized(buf) {
  if (buf.length < 4 || buf.readUInt32BE(0) !== 0xACED0005) throw new Error('not a Java serialization stream');
  return new JavaReader(buf).readStream();
}
