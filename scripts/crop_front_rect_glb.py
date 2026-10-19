import json, struct, sys
from pathlib import Path

def read(path):
 raw=Path(path).read_bytes(); off=12; doc=bin=None
 while off<len(raw):
  n,k=struct.unpack_from('<II',raw,off); off+=8; c=raw[off:off+n]; off+=n
  if k==0x4E4F534A: doc=json.loads(c.decode().rstrip(' \t\r\n\0'))
  elif k==0x004E4942: bin=bytearray(c)
 return doc,bin

def write(path,doc,bin):
 j=json.dumps(doc,separators=(',',':')).encode(); j+=b' ' *((4-len(j)%4)%4); bin=bytes(bin)+b'\0'*((4-len(bin)%4)%4)
 out=b'glTF'+struct.pack('<II',2,12+8+len(j)+8+len(bin))+struct.pack('<II',len(j),0x4E4F534A)+j+struct.pack('<II',len(bin),0x004E4942)+bin
 Path(path).write_bytes(out)

src,out=sys.argv[1:3]; xmin,xmax,ymin,ymax=map(float,sys.argv[3:7])
doc,bin=read(src); prim=doc['meshes'][0]['primitives'][0]
pa=doc['accessors'][prim['attributes']['POSITION']]; pv=doc['bufferViews'][pa['bufferView']]; pb=pv.get('byteOffset',0)+pa.get('byteOffset',0)
pts=[struct.unpack_from('<3f',bin,pb+i*12) for i in range(pa['count'])]
ia=doc['accessors'][prim['indices']]; iv=doc['bufferViews'][ia['bufferView']]; ib=iv.get('byteOffset',0)+ia.get('byteOffset',0)
inds=struct.unpack_from('<%dH'%ia['count'],bin,ib); kept=[]
for i in range(0,len(inds),3):
 tri=inds[i:i+3]
 if len(tri)==3 and all(xmin<=pts[v][0]<=xmax and ymin<=pts[v][1]<=ymax for v in tri): kept.extend(tri)
new=struct.pack('<%dH'%len(kept),*kept); start=iv.get('byteOffset',0); old=iv['byteLength']; b=bytearray(bin); b[start:start+len(new)]=new; del b[start+len(new):start+old]; iv['byteLength']=len(new); ia['count']=len(kept); doc['buffers'][0]['byteLength']=len(b); write(out,doc,b)
print(json.dumps({'bounds':[xmin,xmax,ymin,ymax],'triangles':len(kept)//3,'removed':(len(inds)-len(kept))//3}))
