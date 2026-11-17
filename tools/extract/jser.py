import struct, sys, json

class R:
    def __init__(s, b): s.b=b; s.i=0; s.handles=[]
    def u1(s): v=s.b[s.i]; s.i+=1; return v
    def rd(s,f):
        n=struct.calcsize(f); v=struct.unpack_from(f,s.b,s.i)[0]; s.i+=n; return v
    def utf(s):
        n=s.rd('>H'); v=s.b[s.i:s.i+n].decode('utf-8','replace'); s.i+=n; return v
    def classdesc(s):
        t=s.u1()
        if t==0x70: return None
        if t==0x71: return s.handles[s.rd('>i')-0x7e0000]
        if t==0x72:
            name=s.utf(); s.rd('>q'); flags=s.u1(); n=s.rd('>H')
            cd={'name':name,'flags':flags,'fields':[],'super':None}
            s.handles.append(cd)
            for _ in range(n):
                tc=chr(s.u1()); fn=s.utf(); cn=None
                if tc in 'L[': cn=s.content()
                cd['fields'].append((tc,fn,cn))
            while True:
                t2=s.b[s.i]
                if t2==0x78: s.i+=1; break
                s.content()
            cd['super']=s.classdesc()
            return cd
        raise Exception('cd %x at %d'%(t,s.i))
    def content(s):
        t=s.u1()
        if t==0x70: return None
        if t==0x71: return s.handles[s.rd('>i')-0x7e0000]
        if t==0x74:
            v=s.utf(); s.handles.append(v); return v
        if t==0x72:
            s.i-=1; return s.classdesc()
        if t==0x73:
            cd=s.classdesc(); o={'_class':cd['name'] if cd else None}; s.handles.append(o)
            chain=[]; c=cd
            while c: chain.append(c); c=c['super']
            for c in reversed(chain):
                for tc,fn,cn in c['fields']:
                    o[fn]=s.val(tc)
                if c['flags']&0x01 and c['flags']&0x02:
                    anns=[]
                    while s.b[s.i]!=0x78: anns.append(s.content())
                    s.i+=1
                    o['_ann']=anns
            return o
        if t==0x75:
            cd=s.classdesc(); n=s.rd('>i'); arr=[]; s.handles.append(arr)
            ct=cd['name'][1]
            for _ in range(n): arr.append(s.val(ct))
            return arr
        if t==0x77:
            n=s.u1(); v=s.b[s.i:s.i+n]; s.i+=n; return ('blk',v.hex())
        if t==0x78: return None
        raise Exception('tc %x at %d'%(t,s.i))
    def val(s,tc):
        if tc=='I': return s.rd('>i')
        if tc=='J': return s.rd('>q')
        if tc=='Z': return bool(s.u1())
        if tc=='B': return s.rd('>b')
        if tc=='S': return s.rd('>h')
        if tc=='C': return s.rd('>H')
        if tc=='D': return s.rd('>d')
        if tc=='F': return s.rd('>f')
        return s.content()
    def parse(s):
        assert s.rd('>H')==0xaced; s.rd('>H')
        out=[]
        while s.i<len(s.b): out.append(s.content())
        return out

def load(p):
    return R(open(p,'rb').read()).parse()
if __name__=='__main__':
    print(json.dumps(load(sys.argv[1]),ensure_ascii=False,default=str)[:int(sys.argv[2]) if len(sys.argv)>2 else 3000])
