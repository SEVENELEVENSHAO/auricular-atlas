export const KEY='auricular-atlas-v1';
export const blankProject=(model)=>({version:1,model,markings:[],naturalLines:[],points:[],combinations:{},updatedAt:null});
export function validateProject(p,modelId){
 if(!p||p.version!==1||p.model?.id!==modelId)throw Error('This backup belongs to a different ear mesh. Load its model first.');
 p.naturalLines??=[];
 if(!Array.isArray(p.points)||!Array.isArray(p.markings)||!Array.isArray(p.naturalLines)||!p.combinations||typeof p.combinations!=='object')throw Error('Invalid atlas backup.');
 const ids=new Set();
 const validAnchor=a=>a&&[a.p,a.n].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite))&&Number.isInteger(a.mesh);
 for(const m of [...p.points,...p.markings,...p.naturalLines]){
  if(typeof m.id!=='string'||ids.has(m.id)||typeof m.name!=='string'||m.name.length>300||!/^#[0-9a-f]{6}$/i.test(m.color)||!Number.isFinite(m.size)||m.size<.001||m.size>1||!Array.isArray(m.anchors)||m.anchors.length<1||m.anchors.length>20000)throw Error('Invalid annotation data.');
  if(m.labelRotation!==undefined&&(!Number.isFinite(m.labelRotation)||m.labelRotation<-180||m.labelRotation>180))throw Error('Invalid label rotation.');
  if(m.labelOffset!==undefined&&(!Array.isArray(m.labelOffset)||m.labelOffset.length!==2||!m.labelOffset.every(Number.isFinite)||m.labelOffset.some(v=>Math.abs(v)>2)))throw Error('Invalid label offset.');
  if(m.labelOffsetBasis!==undefined&&(m.kind!=='point'||m.labelOffsetBasis!=='tangent'))throw Error('Invalid label offset basis.');
  if(m.thickness!==undefined&&(!Number.isInteger(m.thickness)||m.thickness<1||m.thickness>5))throw Error('Invalid line thickness.');
  if(m.lineType!==undefined&&!['flat','perforated','natural'].includes(m.lineType))throw Error('Invalid line type.');
  ids.add(m.id);
  for(const a of m.anchors)if(!validAnchor(a))throw Error('Invalid surface anchor.');
  if(m.curve!==undefined){
   if(!m.curve||!Array.isArray(m.curve.runs)||!m.curve.runs.length||m.curve.runs.length>1000)throw Error('Invalid editable curve.');
   for(const run of m.curve.runs){if(!run||!Array.isArray(run.knots)||run.knots.length<2||run.knots.length>20000)throw Error('Invalid editable curve.');for(const knot of run.knots){if(!knot||!validAnchor(knot.anchor))throw Error('Invalid editable curve anchor.');for(const handle of [knot.inHandle,knot.outHandle])if(handle!==undefined&&!validAnchor(handle))throw Error('Invalid editable curve handle.');}}
  }
 }
 return p;
}
export function saveProject(project){project.updatedAt=new Date().toISOString();localStorage.setItem(KEY+':'+project.model.id,JSON.stringify(project));}
export function readProject(model){const s=localStorage.getItem(KEY+':'+model.id);return s?validateProject(JSON.parse(s),model.id):blankProject(model);}
export function assetDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open(KEY,1);r.onupgradeneeded=()=>r.result.createObjectStore('models');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function saveModel(record){const db=await assetDb();await new Promise((resolve,reject)=>{const tx=db.transaction('models','readwrite');tx.objectStore('models').put(record,'active');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();}
export async function readModel(){const db=await assetDb();return new Promise((resolve,reject)=>{const r=db.transaction('models').objectStore('models').get('active');r.onsuccess=()=>{db.close();resolve(r.result);};r.onerror=()=>reject(r.error);});}
export async function fingerprint(buffer){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))).map(b=>b.toString(16).padStart(2,'0')).join('');}
