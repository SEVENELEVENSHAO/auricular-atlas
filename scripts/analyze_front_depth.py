import json,struct,statistics
from pathlib import Path
p=Path('private/model-work/ear-original-preview-backup.glb'); raw=p.read_bytes(); off=12; doc=bin=None
while off<len(raw):
 n,k=struct.unpack_from('<II',raw,off); off+=8; c=raw[off:off+n]; off+=n
 if k==0x4E4F534A: doc=json.loads(c.decode().rstrip(' \t\r\n\0'))
 elif k==0x004E4942: bin=c
prim=doc['meshes'][0]['primitives'][0]; pa=doc['accessors'][prim['attributes']['POSITION']]; pv=doc['bufferViews'][pa['bufferView']]; b=pv.get('byteOffset',0)+pa.get('byteOffset',0)
pts=[struct.unpack_from('<3f',bin,b+i*12) for i in range(pa['count'])]
for zt in [-5,-10,-15,-20,-25,-30,-35,-40,-45,-50]:
 q=[p for p in pts if p[2]>=zt]
 print('z>=',zt,'n',len(q),'x',round(min(p[0] for p in q),1),round(max(p[0] for p in q),1),'y',round(min(p[1] for p in q),1),round(max(p[1] for p in q),1))
print('sample extrema z max by y bins')
for lo in range(0,101,10):
 q=[p for p in pts if lo<=p[1]<lo+10]
 print(lo, round(max(p[2] for p in q),1), round(min(p[2] for p in q),1), round(min(p[0] for p in q),1), round(max(p[0] for p in q),1))
