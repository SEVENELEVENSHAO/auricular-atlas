import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
T.BufferGeometry.prototype.computeBoundsTree=computeBoundsTree;
T.Mesh.prototype.raycast=acceleratedRaycast;
const v=a=>new T.Vector3().fromArray(a);
const LINE_SURFACE_LIFT=.016;
const POINT_VISUAL_SCALE=.7;
const CURVE_KNOT_RADIUS=.024;
const CURVE_SELECTED_KNOT_RADIUS=.034;
const CURVE_TANGENT_HANDLE_RADIUS=.018;
export class EarViewer {
 constructor(container,onAction){
  this.container=container;this.onAction=onAction;this.onFrame=()=>{};this.meshes=[];this.mode='orbit';this.drawing=[];this.curveEdit=null;this.curveDrag=null;this.curveSelection=null;this.labelGesture=null;this.pointTarget=null;this.pointDrag=null;this.pointPulseMeshes=[];this.visible={markings:true,naturalLines:true,points:true,labels:true};
  this.scene=new T.Scene();this.scene.background=new T.Color('#0f1a21');
  this.camera=new T.PerspectiveCamera(32,1,.01,100);this.camera.position.set(0,0,6);
  this.renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.35;container.append(this.renderer.domElement);
  this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;
  this.scene.add(new T.HemisphereLight(0xe6f5ff,0x4b3d37,2));
  for(const [pos,intensity] of [[[3,4,5],3],[[-4,0,2],1.5],[[1,3,-4],2]]){const l=new T.DirectionalLight(0xffeee2,intensity);l.position.set(...pos);this.scene.add(l);}
  this.displayRoot=new T.Group();this.overlays=new T.Group();this.previewGroup=new T.Group();this.displayRoot.add(this.overlays,this.previewGroup);this.scene.add(this.displayRoot);this.side='left';this.ray=new T.Raycaster();this.ray.firstHitOnly=true;this.curveRay=new T.Raycaster();this.curveRay.firstHitOnly=true;
  this.resize=()=>{const w=container.clientWidth,h=container.clientHeight;this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h);};window.addEventListener('resize',this.resize);this.resize();
  this.renderer.setAnimationLoop(()=>{this.controls.update();this.updatePointPulse();this.renderer.render(this.scene,this.camera);this.onFrame();});
  const el=this.renderer.domElement;
  el.addEventListener('pointerdown',e=>{this.start=[e.clientX,e.clientY];if(e.button!==0)return;if(this.mode==='curve-edit'){const target=this.findCurveTarget(e.clientX,e.clientY);if(!target)return;this.curveSelection=target;this.curveDrag=target;el.setPointerCapture(e.pointerId);this.onAction({kind:'curve-begin',...target});return;}if(this.mode==='point-move'){if(!this.pointTarget)return;const screen=this.projectToScreen(this.pointTarget.anchors[0].p);if(Math.hypot(screen.x-e.clientX,screen.y-e.clientY)>30)return;this.pointDrag={pointerId:e.pointerId};el.setPointerCapture(e.pointerId);return;}if(this.mode==='orbit')return;this.drawing=[];this.down=true;el.setPointerCapture(e.pointerId);if(this.isPathMode()){const anchor=this.hit(e.clientX,e.clientY);if(anchor)this.drawing=[anchor];return;}this.sample(e.clientX,e.clientY);});
  el.addEventListener('pointermove',e=>{if(this.curveDrag){const anchor=this.hit(e.clientX,e.clientY);if(anchor){this.updateCurveTarget(this.curveDrag,anchor);this.onAction({kind:'curve-change',...this.curveDrag,anchor});}return;}if(this.pointDrag){this.updatePointDrag(e.clientX,e.clientY,e.pointerId);return;}if(!this.down||!this.isPathMode()||!this.drawing[0])return;const endpoint=this.hit(e.clientX,e.clientY);if(endpoint){this.setPathEnd(endpoint);this.updateDrawingPreview(this.drawing);}});
  el.addEventListener('pointerup',e=>{if(this.curveDrag){this.onAction({kind:'curve-end',...this.curveDrag});this.curveDrag=null;return;}if(this.pointDrag){this.endPointDrag(e.pointerId);return;}if(this.down){this.down=false;if(this.isPathMode()){const start=this.drawing[0],end=this.hit(e.clientX,e.clientY);if(start&&end)this.setPathEnd(end);this.clearDrawingPreview();if(start&&end&&v(start.p).distanceTo(v(end.p))>.02)this.onAction({kind:this.mode,anchors:[start,end]});}else if(this.drawing.length)this.onAction({kind:this.mode,anchors:this.drawing});this.drawing=[];}else if(this.mode==='orbit'&&Math.hypot(e.clientX-this.start[0],e.clientY-this.start[1])<4){const h=this.hit(e.clientX,e.clientY);if(h)this.onAction({kind:'select',anchor:h});}});
  el.addEventListener('pointercancel',()=>{if(this.curveDrag)this.onAction({kind:'curve-end',...this.curveDrag});if(this.pointDrag)this.endPointDrag(this.pointDrag.pointerId);this.curveDrag=null;this.pointDrag=null;this.down=false;this.drawing=[];this.clearDrawingPreview();});
 }
 isPathMode(){return ['line','natural-line','area'].includes(this.mode);}
 setPathEnd(endpoint){if(this.drawing[0])this.drawing=[this.drawing[0],endpoint];}
 clearDrawingPreview(){for(const item of this.previewGroup.children){item.geometry?.dispose();item.material?.dispose();}this.previewGroup.clear();}
 updateDrawingPreview(path){this.clearDrawingPreview();this.surfaceStroke(path,0x61d8e2,3,.8,this.previewGroup);}
 startCurveEdit(mark){this.curveEdit={mark,curve:this.buildCurve(mark)};this.curveSelection=this.curveEdit.curve.runs?.[0]?.knots?.length?{runIndex:0,knotIndex:0,type:'knot'}:null;this.curveDrag=null;}
 stopCurveEdit(){this.curveEdit=null;this.curveSelection=null;this.curveDrag=null;}
 getCurveEdit(){return this.curveEdit?.curve?JSON.parse(JSON.stringify(this.curveEdit.curve)):null;}
 buildCurve(mark){
  if(mark.curve?.runs?.length)return JSON.parse(JSON.stringify(mark.curve));
  const runs=[];let run=[];
  const source=Array.isArray(mark.anchors)?mark.anchors:[];
  const pushRun=()=>{
   if(!run.length)return;
   const max=18,step=Math.max(1,(run.length-1)/(max-1)),knots=[];
   for(let i=0;i<Math.min(max,run.length);i++){
    const index=Math.min(run.length-1,Math.round(i*step));
    if(knots.length&&knots.at(-1).anchor===run[index])continue;
    knots.push({anchor:run[index]});
   }
   if(knots.length===1&&run.length>1)knots.push({anchor:run.at(-1)});
    for(let i=0;i<knots.length;i++){
     const anchor=v(knots[i].anchor.p),prev=v(knots[Math.max(0,i-1)].anchor.p),next=v(knots[Math.min(knots.length-1,i+1)].anchor.p),tangent=i===0?next.clone().sub(anchor).multiplyScalar(1/3):i===knots.length-1?anchor.clone().sub(prev).multiplyScalar(1/3):next.clone().sub(prev).multiplyScalar(1/6);
     if(i>0)knots[i].inHandle=this.surfaceHandle(knots[i].anchor,anchor.clone().sub(tangent));
     if(i<knots.length-1)knots[i].outHandle=this.surfaceHandle(knots[i].anchor,anchor.clone().add(tangent));
   }
   if(knots.length>=2)runs.push({knots});
   run=[];
  };
  for(const anchor of source){if(anchor.breakBefore&&run.length)pushRun();run.push(anchor);}pushRun();
  return {runs};
 }
 surfaceHandle(anchor,point){return {p:point.toArray(),n:[...(anchor.n??[0,0,1])],mesh:anchor.mesh??0,face:anchor.face};}
 async load(buffer,format,starter=false){
  let root;if(format==='stl'){let geo=new STLLoader().parse(buffer);geo.deleteAttribute('normal');geo=mergeVertices(geo);geo.computeVertexNormals();root=new T.Mesh(geo);}else if(format==='obj'){root=new OBJLoader().parse(new TextDecoder().decode(buffer));}else{root=(await new GLTFLoader().parseAsync(buffer,'')).scene;}
  root.updateMatrixWorld(true);const meshes=[];
  root.traverse(o=>{if(o.isMesh){const g=o.geometry.clone().applyMatrix4(o.matrixWorld);meshes.push(new T.Mesh(g,new T.MeshStandardMaterial({color:0xd8a98e,roughness:.64,metalness:0,side:T.DoubleSide})));}});
  if(!meshes.length)throw Error('The file contains no mesh.');
  const group=new T.Group();meshes.forEach(m=>group.add(m));
  if(starter){group.rotation.set(0,Math.PI,0);group.updateMatrixWorld(true);for(const m of meshes)m.geometry.applyMatrix4(group.matrixWorld);group.rotation.set(0,0,0);}
  const box=new T.Box3().setFromObject(group),center=box.getCenter(new T.Vector3()),size=box.getSize(new T.Vector3());const scale=3/Math.max(size.x,size.y,size.z);
  for(const m of meshes){m.geometry.translate(-center.x,-center.y,-center.z);m.geometry.scale(scale,scale,scale);if(!m.geometry.attributes.normal)m.geometry.computeVertexNormals();m.geometry.computeBoundsTree();}
  if(this.model){this.displayRoot.remove(this.model);this.model.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});}
  this.model=group;this.meshes=meshes;this.displayRoot.add(group);group.updateMatrixWorld(true);this.displayRoot.updateMatrixWorld(true);this.fit();
  this.triangles=meshes.reduce((n,m)=>n+(m.geometry.index?.count??m.geometry.attributes.position.count)/3,0);return this.triangles;
 }
 fit(back=false){this.controls.target.set(0,0,0);this.camera.position.set(0,0,back?-6.4:6.4);this.camera.up.set(0,1,0);this.controls.update();}
 setSide(side){if(side!=='left'&&side!=='right')return;this.side=side;if(this.displayRoot){this.displayRoot.scale.x=side==='right'?-1:1;this.displayRoot.updateMatrixWorld(true);}}
 mirrorX(point){return Array.isArray(point)?[-point[0],point[1],point[2]]:new T.Vector3(-point.x,point.y,point.z);}
 toDisplayPoint(point){return this.side==='right'?this.mirrorX(point):Array.isArray(point)?[...point]:point.clone();}
 toModelPoint(point){return this.side==='right'?this.mirrorX(point):Array.isArray(point)?[...point]:point.clone();}
 toModelNormal(normal){return this.toModelPoint(normal).normalize();}
 projectToScreen(point){const r=this.renderer.domElement.getBoundingClientRect(),display=this.toDisplayPoint(point),coordinates=Array.isArray(display)?display:display.toArray(),p=new T.Vector3(...coordinates).project(this.camera);return {x:r.left+(p.x+1)*r.width/2,y:r.top+(-p.y+1)*r.height/2,z:p.z};}
 setMode(mode){this.mode=mode;this.controls.enabled=mode==='orbit';this.renderer.domElement.style.cursor=mode==='orbit'?'grab':mode==='curve-edit'?'default':mode==='point-move'?'move':'crosshair';if(mode!=='point-move')this.pointDrag=null;if(!this.isPathMode())this.clearDrawingPreview();}
 startPointMove(mark){this.pointTarget=mark;this.pointDrag=null;}
 startPointDrag(mark,pointerId){this.pointTarget=mark;this.pointDrag={pointerId,source:'overlay'};}
 updatePointDrag(x,y){if(!this.pointDrag)return;const anchor=this.hit(x,y);if(anchor){this.pointTarget.anchors[0]=anchor;this.onAction({kind:'point-move-change',mark:this.pointTarget,anchor});}}
 endPointDrag(){if(!this.pointDrag)return;this.onAction({kind:'point-move-end',mark:this.pointTarget});this.pointDrag=null;}
 stopPointMove(){this.pointTarget=null;this.pointDrag=null;if(this.mode==='point-move')this.setMode('orbit');}
 hit(x,y){const r=this.renderer.domElement.getBoundingClientRect();this.ray.setFromCamera(new T.Vector2((x-r.left)/r.width*2-1,-(y-r.top)/r.height*2+1),this.camera);const h=this.ray.intersectObjects(this.meshes,false)[0];if(!h)return null;const n=(h.normal||h.face.normal).clone().transformDirection(h.object.matrixWorld);if(n.dot(this.ray.ray.direction)>0)n.negate();return {p:this.toModelPoint(h.point).toArray(),n:this.toModelNormal(n).toArray(),mesh:this.meshes.indexOf(h.object),face:h.faceIndex};}
 nearestMark(anchor,marks){let best=null,bestDistance=Infinity;for(const mark of marks){const candidates=mark.kind==='line'&&mark.curve?.runs?.length?this.curvePaths(mark).flat():mark.anchors??[];for(const candidate of candidates){const distance=v(candidate.p).distanceTo(v(anchor.p));if(distance<bestDistance){bestDistance=distance;best=mark;}}}return best?{mark:best,distance:bestDistance}:null;}
 markScreenPosition(mark){const anchors=mark?.anchors??[];if(!anchors.length)return {x:window.innerWidth/2,y:window.innerHeight/2};const anchor=anchors[Math.floor(anchors.length/2)];return this.projectToScreen(anchor.p);}
 sample(x,y){const h=this.hit(x,y);if(h&&(!this.drawing.length||v(h.p).distanceTo(v(this.drawing.at(-1).p))>.006)){h.breakBefore=this.gap;this.gap=false;this.drawing.push(h);}else if(!h)this.gap=true;}
 curveRuns(mark){
  if(mark.curve?.runs?.length)return mark.curve.runs;
  const runs=[];let run=[];for(const anchor of mark.anchors){if(anchor.breakBefore&&run.length){runs.push({knots:run});run=[];}run.push({anchor});}if(run.length)runs.push({knots:run});return runs;
 }
 curvePoint(knot,side){return knot?.[`${side}Handle`]?.p??knot?.anchor?.p??knot?.p;}
 curveNormal(knot){return knot?.anchor?.n??knot?.n??[0,0,1];}
 cubicPoint(a,b,c,d,t){const q=1-t;return new T.Vector3(...a).multiplyScalar(q*q*q).add(new T.Vector3(...b).multiplyScalar(3*q*q*t)).add(new T.Vector3(...c).multiplyScalar(3*q*t*t)).add(new T.Vector3(...d).multiplyScalar(t*t*t));}
 curvePaths(mark){
  const paths=[];
  for(const run of this.curveRuns(mark)){
   const knots=run.knots??[];if(knots.length<2){if(knots.length)paths.push([{p:this.curvePoint(knots[0]),n:this.curveNormal(knots[0]),mesh:knots[0].anchor?.mesh??knots[0].mesh}]);continue;}
   const samples=[];
   for(let i=0;i<knots.length-1;i++){
    const a=knots[i],b=knots[i+1],p0=this.curvePoint(a),p1=a.outHandle?.p??p0,p2=b.inHandle?.p??this.curvePoint(b),p3=this.curvePoint(b);
    for(let s=i?1:0;s<=12;s++){const t=s/12,p=this.cubicPoint(p0,p1,p2,p3,t),n=this.interpolateNormal(this.curveNormal(a),this.curveNormal(b),t),mesh=a.anchor?.mesh??a.mesh??0;if(Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.z))samples.push({p:p.toArray(),n:n.toArray(),mesh});}
   }
   paths.push(samples);
  }
  return paths;
 }
 projectCurveSample(point,normal,meshIndex){
  const mesh=this.meshes[meshIndex];if(!mesh||!normal.lengthSq()||!normal.toArray().every(Number.isFinite))return null;let best=null,bestDistance=Infinity;
  for(const sign of [1,-1]){
   const direction=normal.clone().multiplyScalar(-sign),origin=point.clone().addScaledVector(normal,sign*.16),displayDirection=this.toDisplayPoint(direction).normalize(),displayOrigin=this.toDisplayPoint(origin);
   this.curveRay.set(displayOrigin,displayDirection);this.curveRay.near=0;this.curveRay.far=.32;
   const hit=this.curveRay.intersectObject(mesh,false)[0];if(!hit)continue;
    const modelPoint=this.toModelPoint(hit.point),distance=modelPoint.distanceTo(point);if(distance>=bestDistance)continue;bestDistance=distance;
    const n=this.toModelNormal((hit.normal||hit.face.normal).clone().transformDirection(hit.object.matrixWorld));if(n.dot(normal.clone().multiplyScalar(-sign))>0)n.negate();
    best={p:modelPoint.toArray(),n:n.toArray(),mesh:meshIndex,face:hit.faceIndex};
  }
  return best;
 }
 interpolateNormal(a,b,t){const first=new T.Vector3(...a),second=new T.Vector3(...b),normal=first.clone().lerp(second,t);if(normal.lengthSq()<1e-8)return first.normalize();return normal.normalize();}
 curveScreenPosition(point){const screen=this.projectToScreen(point);return [screen.x,screen.y];}
 findCurveTarget(x,y){
  if(!this.curveEdit)return null;let best=null,bestDistance=22;
  for(let runIndex=0;runIndex<this.curveEdit.curve.runs.length;runIndex++)for(let knotIndex=0;knotIndex<this.curveEdit.curve.runs[runIndex].knots.length;knotIndex++){
   const knot=this.curveEdit.curve.runs[runIndex].knots[knotIndex];const candidates=[['knot',knot.anchor?.p??knot.p],['in',knot.inHandle?.p],['out',knot.outHandle?.p]];
   for(const [type,point] of candidates){if(!point)continue;const [sx,sy]=this.curveScreenPosition(point),distance=Math.hypot(sx-x,sy-y);if(distance<bestDistance){bestDistance=distance;best={runIndex,knotIndex,type};}}
  }
  return best;
 }
 updateCurveTarget(target,anchor){const knot=this.curveEdit?.curve?.runs?.[target.runIndex]?.knots?.[target.knotIndex];if(!knot)return;if(target.type==='knot'){const delta=v(anchor.p).sub(v(this.curvePoint(knot)));for(const side of ['in','out'])if(knot[`${side}Handle`]?.p)knot[`${side}Handle`].p=v(knot[`${side}Handle`].p).add(delta).toArray();knot.anchor=anchor;}else{knot[`${target.type}Handle`]=anchor;}}
 addCurveKnot(){
  const edit=this.curveEdit,target=this.curveSelection;if(!edit||!target)return false;
  const run=edit.curve.runs[target.runIndex],knots=run?.knots??[];if(knots.length<2)return false;
  let index=Math.min(target.knotIndex,knots.length-2);if(target.knotIndex>=knots.length-1)index=knots.length-2;
  const a=knots[index],b=knots[index+1],p0=this.curvePoint(a),p1=a.outHandle?.p??p0,p2=b.inHandle?.p??this.curvePoint(b),p3=this.curvePoint(b);
  const v0=new T.Vector3(...p0),v1=new T.Vector3(...p1),v2=new T.Vector3(...p2),v3=new T.Vector3(...p3),q0=v0.clone().lerp(v1,.5),q1=v1.clone().lerp(v2,.5),q2=v2.clone().lerp(v3,.5),r0=q0.clone().lerp(q1,.5),r1=q1.clone().lerp(q2,.5),point=r0.clone().lerp(r1,.5),normal=this.interpolateNormal(this.curveNormal(a),this.curveNormal(b),.5),mesh=a.anchor?.mesh??a.mesh??0;
  const anchor=this.projectCurveSample(point,normal,mesh)??{p:point.toArray(),n:normal.toArray(),mesh,face:a.anchor?.face},inHandle=this.projectCurveSample(r0,normal,mesh),outHandle=this.projectCurveSample(r1,normal,mesh);
  a.outHandle=this.projectCurveSample(q0,normal,mesh)??this.surfaceHandle(a.anchor,q0);b.inHandle=this.projectCurveSample(q2,normal,mesh)??this.surfaceHandle(b.anchor,q2);
  const knot={anchor,inHandle:inHandle??this.surfaceHandle(anchor,r0),outHandle:outHandle??this.surfaceHandle(anchor,r1)};
  knots.splice(index+1,0,knot);this.curveSelection={runIndex:target.runIndex,knotIndex:index+1,type:'knot'};return true;
 }
 deleteCurveKnot(){
  const edit=this.curveEdit,target=this.curveSelection;if(!edit||!target||target.type!=='knot')return false;
  const run=edit.curve.runs[target.runIndex],knots=run?.knots??[];if(knots.length<=2)return false;
  knots.splice(target.knotIndex,1);this.curveSelection={runIndex:target.runIndex,knotIndex:Math.min(target.knotIndex,knots.length-1),type:'knot'};return true;
 }
 flattenCurve(curve){
  const anchors=[];for(const run of curve?.runs??[]){for(let i=0;i<(run.knots??[]).length;i++){const a=run.knots[i].anchor??run.knots[i];anchors.push({...a,breakBefore:anchors.length>0&&i===0});}}
  if(anchors[0])delete anchors[0].breakBefore;return anchors;
 }
 clear(){const geometries=new Set(),materials=new Set(),textures=new Set();this.overlays.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const material of Array.isArray(o.material)?o.material:[o.material])if(material){materials.add(material);if(material.map)textures.add(material.map);}});for(const texture of textures)texture.dispose();for(const material of materials)material.dispose();for(const geometry of geometries)geometry.dispose();this.overlays.clear();this.pointPulseMeshes=[];}
 pointDomeRadius(size){return Math.max(.007,Math.min(.021,size*.48))*.75*POINT_VISUAL_SCALE;}
 labelDomeRadius(size){return this.pointDomeRadius(size);}
 addPointDome(anchor,size,color='#e23b46',pulse=false){
  const normal=v(anchor.n).normalize(),radius=this.pointDomeRadius(size),geometry=new T.SphereGeometry(radius,18,10,0,Math.PI*2,0,Math.PI/2),material=new T.MeshStandardMaterial({color,roughness:.42,metalness:.02,emissive:pulse?'#1f6b40':'#000000',emissiveIntensity:pulse?.45:0}),dome=new T.Mesh(geometry,material);
  dome.position.copy(v(anchor.p).addScaledVector(normal,.002));dome.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),normal);this.overlays.add(dome);if(pulse)this.pointPulseMeshes.push({mesh:dome,base:new T.Color(color)});
 }
 updatePointPulse(){
  if(!this.pointPulseMeshes.length)return;
  const phase=(Math.sin(performance.now()/170)+1)/2;
  for(const entry of this.pointPulseMeshes){entry.mesh.material.color.copy(entry.base).lerp(new T.Color('#59ef96'),.48+.38*phase);entry.mesh.material.emissiveIntensity=.25+.5*phase;entry.mesh.scale.setScalar(1+.08*phase);}
 }
 labelAxes(normal,labelRotation=0){
  const up=new T.Vector3(0,1,0);if(Math.abs(normal.dot(up))>.95)up.set(1,0,0);
  let x=new T.Vector3().crossVectors(up,normal).normalize(),y=new T.Vector3().crossVectors(normal,x).normalize();
  if(labelRotation){const angle=labelRotation*Math.PI/180,rotatedX=x.clone().multiplyScalar(Math.cos(angle)).addScaledVector(y,Math.sin(angle)),rotatedY=y.clone().multiplyScalar(Math.cos(angle)).addScaledVector(x,-Math.sin(angle));x=rotatedX;y=rotatedY;}
  return {x,y};
 }
 labelMetrics(text,size,dot=false){
  const lines=String(text??'').split(/\r?\n/).slice(0,2),longest=lines.reduce((max,line)=>Math.max(max,line.length),0);
  return {lines,width:dot?size:Math.min(1.2,Math.max(.22,longest*size*.48)),height:dot?size:size*Math.max(1.6,lines.length*1.3)};
 }
 labelScreenGeometry(mark){
  if(mark?.kind==='point')return this.pointLabelScreenGeometry(mark);
  const anchor=mark?.anchors?.[0];if(!anchor)return null;
  const normal=v(anchor.n).normalize(),{x,y}=this.labelAxes(normal,mark.labelRotation??0),{width,height}=this.labelMetrics(mark.name,mark.size*2.8),center=this.projectToScreen(anchor.p),corners=[
   v(anchor.p).addScaledVector(x,width/2).addScaledVector(y,height/2),
   v(anchor.p).addScaledVector(x,width/2).addScaledVector(y,-height/2),
   v(anchor.p).addScaledVector(x,-width/2).addScaledVector(y,height/2),
   v(anchor.p).addScaledVector(x,-width/2).addScaledVector(y,-height/2)
  ].map(point=>this.projectToScreen(point));
  const left=Math.min(...corners.map(point=>point.x)),right=Math.max(...corners.map(point=>point.x)),top=Math.min(...corners.map(point=>point.y)),bottom=Math.max(...corners.map(point=>point.y));
  return {left,top,width:right-left,height:bottom-top,center,corner:corners[0]};
 }
 startLabelGesture(mark,type,x,y){
  const geometry=this.labelScreenGeometry(mark);if(!geometry)return false;
  const center=geometry.center,{x:cx,y:cy}=center;
  const pointPlacement=mark.kind==='point'?this.pointLabelPlacement(mark.anchors[0],mark.name,mark.labelSize??.045,mark.size,mark.labelRotation??0,mark.labelOffset):null;
  const startHit=mark.kind==='point'?this.hit(x,y):null;
  this.labelGesture={mark,type,centerX:cx,centerY:cy,startX:x,startY:y,startSize:mark.kind==='point'?(mark.labelSize??.045):mark.size,startRotation:mark.labelRotation??0,startRadius:Math.max(1,Math.hypot(x-cx,y-cy)),anchorPoint:mark.kind==='point'?v(mark.anchors[0].p):null,startSurfacePoint:startHit?v(startHit.p):null,tangentX:pointPlacement?.offsetX,tangentY:pointPlacement?.offsetY,startOffset:pointPlacement?.offset? [...pointPlacement.offset]:null};
  this.onAction({kind:'label-begin',mark,type});return true;
 }
 updateLabelGesture(x,y){
  const edit=this.labelGesture;if(!edit)return;
  if(edit.type==='move'){
   if(edit.mark.kind==='point'){
    if(edit.anchorPoint&&edit.tangentX&&edit.tangentY){
     const hit=this.hit(x,y),startOffset=edit.startOffset??[0,0];
     if(hit&&edit.startSurfacePoint){const delta=v(hit.p).sub(edit.startSurfacePoint);edit.mark.labelOffset=[Math.max(-.35,Math.min(.35,startOffset[0]+delta.dot(edit.tangentX))),Math.max(-.35,Math.min(.35,startOffset[1]+delta.dot(edit.tangentY)))];this.onAction({kind:'label-change',mark:edit.mark});}
     else {
      const base=this.projectToScreen(edit.anchorPoint.toArray()),scale=.1,xPoint=this.projectToScreen(edit.anchorPoint.clone().addScaledVector(edit.tangentX,scale).toArray()),yPoint=this.projectToScreen(edit.anchorPoint.clone().addScaledVector(edit.tangentY,scale).toArray()),xAxis=[xPoint.x-base.x,xPoint.y-base.y],yAxis=[yPoint.x-base.x,yPoint.y-base.y],det=xAxis[0]*yAxis[1]-xAxis[1]*yAxis[0],dx=x-edit.startX,dy=y-edit.startY;
      if(Math.abs(det)>1e-5){const tangentX=scale*(dx*yAxis[1]-dy*yAxis[0])/det,tangentY=scale*(xAxis[0]*dy-xAxis[1]*dx)/det;edit.mark.labelOffset=[Math.max(-.35,Math.min(.35,startOffset[0]+tangentX)),Math.max(-.35,Math.min(.35,startOffset[1]+tangentY))];this.onAction({kind:'label-change',mark:edit.mark});}
     }
    }
    return;
   }
   const anchor=this.hit(x,y);if(anchor){edit.mark.anchors[0]=anchor;this.onAction({kind:'label-change',mark:edit.mark});}
   return;
  }
  const dx=x-edit.centerX,dy=y-edit.centerY,radius=Math.max(1,Math.hypot(dx,dy)),startAngle=Math.atan2(edit.startY-edit.centerY,edit.startX-edit.centerX),angle=Math.atan2(dy,dx);
  let rotation=edit.startRotation-(angle-startAngle)*180/Math.PI;while(rotation>180)rotation-=360;while(rotation<-180)rotation+=360;
  if(edit.mark.kind!=='point')edit.mark.size=Math.max(.01,Math.min(.12,edit.startSize*radius/edit.startRadius));else edit.mark.labelOffset??=[...(edit.startOffset??[0,0])];edit.mark.labelRotation=rotation;this.onAction({kind:'label-change',mark:edit.mark});
 }
 endLabelGesture(){if(!this.labelGesture)return;this.onAction({kind:'label-end',mark:this.labelGesture.mark});this.labelGesture=null;}
 stamp(anchor,text,color,size,dot=false,labelRotation=0){
  const target=this.meshes[anchor.mesh];if(!target)return;
  const {lines,width,height}=this.labelMetrics(text,size,dot),canvas=document.createElement('canvas');canvas.width=dot?64:1024;canvas.height=dot?64:lines.length>1?192:128;const c=canvas.getContext('2d');c.fillStyle=color;
  if(dot){c.beginPath();c.arc(32,32,27,0,Math.PI*2);c.fill();}else{c.font='600 64px Segoe UI, sans-serif';c.textAlign='center';c.textBaseline='middle';const lineHeight=72,offset=(lines.length-1)*lineHeight/2;lines.forEach((line,index)=>c.fillText(line,512,canvas.height/2-offset+index*lineHeight,1000));}
  const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
  const p=v(anchor.p),normal=v(anchor.n).normalize(),{x,y}=this.labelAxes(normal,labelRotation),matrix=new T.Matrix4().makeBasis(x,y,normal),rotation=new T.Euler().setFromRotationMatrix(matrix);
  // Query only nearby triangles, keeping dense imported meshes responsive.
  const radius=Math.hypot(width,height,.16)/2,sphere=new T.Sphere(p,radius),positions=[];
  target.geometry.boundsTree.shapecast({intersectsBounds:box=>box.intersectsSphere(sphere),intersectsTriangle:tri=>{const faceNormal=tri.getNormal(new T.Vector3());if(faceNormal.dot(normal)>.15)for(const q of [tri.a,tri.b,tri.c])positions.push(q.x,q.y,q.z);return false;}});
  if(!positions.length){texture.dispose();return;}
  const localGeometry=new T.BufferGeometry();localGeometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));localGeometry.computeVertexNormals();
  const projectionMesh=new T.Mesh(localGeometry);projectionMesh.updateMatrixWorld(true);
  const geom=new DecalGeometry(projectionMesh,p,rotation,new T.Vector3(width,height,.16));localGeometry.dispose();
   const mat=new T.MeshBasicMaterial({map:texture,transparent:true,depthTest:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,side:T.FrontSide});
   const mesh=new T.Mesh(geom,mat);if(this.side==='right')mesh.scale.x=-1;this.overlays.add(mesh);
 }
 stampFloating(anchor,text,color,size,pointSize,labelRotation=0,labelOffset){
  const placement=this.pointLabelPlacement(anchor,text,size,pointSize,labelRotation,labelOffset),canvas=document.createElement('canvas');canvas.width=1024;canvas.height=String(text??'').includes('\n')?192:128;const c=canvas.getContext('2d');c.fillStyle=color;c.font='600 64px Segoe UI, sans-serif';c.textAlign='center';c.textBaseline='middle';const lines=String(text??'').split(/\r?\n/).slice(0,2),lineHeight=72,offset=(lines.length-1)*lineHeight/2;lines.forEach((line,index)=>c.fillText(line,512,canvas.height/2-offset+index*lineHeight,1000));
   const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;const geometry=new T.PlaneGeometry(placement.width,placement.height),material=new T.MeshBasicMaterial({map:texture,transparent:true,depthTest:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-6,side:T.DoubleSide}),mesh=new T.Mesh(geometry,material);mesh.position.copy(placement.position);mesh.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(placement.x,placement.y,placement.normal));if(this.side==='right')mesh.scale.x=-1;this.overlays.add(mesh);
 }
 lineRadius(thickness=3){return [.0012,.0018,.0025,.0034,.0045][Math.max(1,Math.min(5,Number(thickness)||3))-1];}
 flatLineGeometry(path,thickness=3,perforated=false){
  if(path.length<2)return null;
  // Surface paths are sampled upstream. Build a compact ribbon directly from those samples.
  const positions=[],indices=[],halfWidth=this.lineRadius(thickness),lift=LINE_SURFACE_LIFT;
  const appendRun=run=>{
   const base=positions.length/3;
   for(let i=0;i<run.length;i++){
    const current=run[i],center=v(current.p),normal=v(current.n??[0,0,1]).normalize();
    const tangent=v(run[Math.min(run.length-1,i+1)].p).sub(v(run[Math.max(0,i-1)].p));
    tangent.addScaledVector(normal,-tangent.dot(normal));
    if(tangent.lengthSq()<1e-10)tangent.set(1,0,0).addScaledVector(normal,-normal.x);
    tangent.normalize();
    const side=new T.Vector3().crossVectors(normal,tangent);
    if(side.lengthSq()<1e-10)side.set(1,0,0).cross(normal);
    side.normalize();center.addScaledVector(normal,lift);
    positions.push(...center.clone().addScaledVector(side,halfWidth).toArray(),...center.clone().addScaledVector(side,-halfWidth).toArray());
    if(i<run.length-1){const a=base+i*2,b=a+1,c=a+2,d=a+3;indices.push(a,b,c,b,d,c);}
   }
  };
  if(!perforated){appendRun(path);}
  else {
   const cumulative=[0];
   for(let i=1;i<path.length;i++)cumulative.push(cumulative[i-1]+v(path[i].p).distanceTo(v(path[i-1].p)));
   const total=cumulative.at(-1),dashLength=.034,gapLength=.026;
   const pointAt=distance=>{
    let i=1;while(i<cumulative.length-1&&cumulative[i]<distance)i++;
    const span=cumulative[i]-cumulative[i-1],t=span?Math.max(0,Math.min(1,(distance-cumulative[i-1])/span)):0;
    const a=path[i-1],b=path[i];return {p:v(a.p).lerp(v(b.p),t).toArray(),n:v(a.n??[0,0,1]).lerp(v(b.n??[0,0,1]),t).normalize().toArray()};
   };
   for(let from=0;from<total;from+=dashLength+gapLength){const to=Math.min(total,from+dashLength);if(to-from<.004)continue;const run=[pointAt(from)];for(let i=1;i<cumulative.length-1;i++)if(cumulative[i]>from&&cumulative[i]<to)run.push(path[i]);run.push(pointAt(to));appendRun(run);}
  }
  if(!indices.length)return null;
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeBoundingSphere();return geometry;
 }
 surfaceStroke(path,color,thickness=3,opacity=.98,target=this.overlays,perforated=false){
  const geometry=this.flatLineGeometry(path,thickness,perforated);if(!geometry)return null;
  const material=new T.MeshBasicMaterial({color,transparent:true,opacity,depthTest:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4,side:T.DoubleSide});
  const mesh=new T.Mesh(geometry,material);mesh.renderOrder=10;target.add(mesh);return mesh;
 }
 pointLabelPlacement(anchor,name,size,pointSize,labelRotation=0,labelOffset){
  const normal=v(anchor.n).normalize(),offsetAxes=this.labelAxes(normal),{x,y}=this.labelAxes(normal,labelRotation),{width,height}=this.labelMetrics(name,size*POINT_VISUAL_SCALE);
  const domeRadius=this.labelDomeRadius(pointSize),defaultOffset=[0,height/2+domeRadius+.012],offset=Array.isArray(labelOffset)&&labelOffset.length===2&&labelOffset.every(Number.isFinite)?labelOffset:defaultOffset;
  // Keep position on the unrotated tangent frame so changing text angle does not move its center.
  return {position:v(anchor.p).addScaledVector(normal,domeRadius+.006).addScaledVector(offsetAxes.x,offset[0]).addScaledVector(offsetAxes.y,offset[1]),normal,x,y,offsetX:offsetAxes.x,offsetY:offsetAxes.y,width,height,offset};
 }
 migratePointLabelOffset(mark){
  if(mark?.kind!=='point'||mark.labelOffsetBasis==='tangent')return;
  const rotation=(mark.labelRotation??0)*Math.PI/180;
  if(mark.labelOffset||rotation){
   const size=mark.labelSize??.045,defaultY=this.labelMetrics(mark.name,size).height/2+this.pointDomeRadius(mark.size)+.012,[offsetX,offsetY]=mark.labelOffset??[0,defaultY],cos=Math.cos(rotation),sin=Math.sin(rotation);
   mark.labelOffset=[offsetX*cos-offsetY*sin,offsetX*sin+offsetY*cos];
  }
  mark.labelOffsetBasis='tangent';
 }
 pointLabelScreenGeometry(mark){
  const anchor=mark?.anchors?.[0];if(!anchor)return null;
  const placement=this.pointLabelPlacement(anchor,mark.name,mark.labelSize??.045,mark.size,mark.labelRotation??0,mark.labelOffset),corners=[
   placement.position.clone().addScaledVector(placement.x,placement.width/2).addScaledVector(placement.y,placement.height/2),
   placement.position.clone().addScaledVector(placement.x,placement.width/2).addScaledVector(placement.y,-placement.height/2),
   placement.position.clone().addScaledVector(placement.x,-placement.width/2).addScaledVector(placement.y,placement.height/2),
   placement.position.clone().addScaledVector(placement.x,-placement.width/2).addScaledVector(placement.y,-placement.height/2)
  ].map((point)=>this.projectToScreen(point));
  const left=Math.min(...corners.map((point)=>point.x)),right=Math.max(...corners.map((point)=>point.x)),top=Math.min(...corners.map((point)=>point.y)),bottom=Math.max(...corners.map((point)=>point.y));
  return {left,top,width:right-left,height:bottom-top,center:this.projectToScreen(placement.position),corner:corners[0]};
 }
 renderAnnotations(project,selected,highlight=[]){
  this.clear();for(const point of project.points)this.migratePointLabelOffset(point);const active=new Set(highlight);
  for(const [layer,items] of [['markings',project.markings],['naturalLines',project.naturalLines??[]],['points',project.points]]){if(!this.visible[layer])continue;
   for(const m of items){const color=active.has(m.id)&&m.id!==selected?'#ffe08a':(m.color??'#70ced4'),thickness=m.thickness??3;
    if(m.kind==='point'){this.addPointDome(m.anchors[0],m.size,m.color??'#e23b46',m.id===selected);}
    else if(layer==='naturalLines'){
     const source=this.activeCurveFor(m);
     if(source){for(const path of this.curvePaths(source))this.surfaceStroke(path,color,thickness);}
     else {const byRun=[];let run=[];for(const a of m.anchors){if(a.breakBefore&&run.length){byRun.push(run);run=[];}run.push(a);}if(run.length)byRun.push(run);for(const anchors of byRun)this.surfaceStroke(anchors,color,thickness);}
    }
    else if(m.kind==='line'||m.kind==='area'){
      const source=this.activeCurveFor(m),paths=source?this.curvePaths(source):[m.anchors],perforated=m.kind==='line'&&m.lineType==='perforated';for(const path of paths)this.surfaceStroke(path,color,thickness,.98,this.overlays,perforated);
    }
    if(this.visible.labels&&m.name&&m.kind!=='line'){
     let anchor=m.anchors[Math.floor(m.anchors.length/2)];
     if(m.kind==='point')this.stampFloating(anchor,m.name,color,m.labelSize??.045,m.size,m.labelRotation??0,m.labelOffset);
     else this.stamp(anchor,m.name,color,m.size*2.8,false,m.labelRotation??0);
    }
   }
  }
  const edit=this.curveEdit;if(edit?.mark&&edit.mark.id===selected)this.renderCurveEditor(edit.curve);
 }
 activeCurveFor(mark){if(this.curveEdit?.mark?.id===mark.id)return {curve:this.curveEdit.curve};if(mark.curve?.runs?.length)return mark;return null;}
 renderCurveEditor(curve){
  const handleMaterial=new T.MeshBasicMaterial({color:0xf1c75b,transparent:true,opacity:.9,depthTest:false});
  const handleLineMaterial=new T.LineBasicMaterial({color:0xf1c75b,transparent:true,opacity:.85,depthTest:false});
  const knotMaterial=new T.MeshBasicMaterial({color:0xffffff,depthTest:false});
  const selectedMaterial=new T.MeshBasicMaterial({color:0x61d8e2,depthTest:false});
  for(let runIndex=0;runIndex<(curve?.runs??[]).length;runIndex++)for(let knotIndex=0;knotIndex<(curve.runs[runIndex].knots??[]).length;knotIndex++){
   const knot=curve.runs[runIndex].knots[knotIndex],anchor=this.curvePoint(knot),selected=this.curveSelection?.runIndex===runIndex&&this.curveSelection?.knotIndex===knotIndex;
   const sphere=new T.Mesh(new T.SphereGeometry(selected ? CURVE_SELECTED_KNOT_RADIUS : CURVE_KNOT_RADIUS,12,8),selected?selectedMaterial:knotMaterial);sphere.position.fromArray(anchor);this.overlays.add(sphere);
   const handles=[];for(const side of ['in','out'])if(knot[`${side}Handle`]?.p){handles.push(...anchor,...knot[`${side}Handle`].p);const h=new T.Mesh(new T.SphereGeometry(CURVE_TANGENT_HANDLE_RADIUS,10,8),handleMaterial);h.position.fromArray(knot[`${side}Handle`].p);this.overlays.add(h);}
   if(handles.length){const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(handles,3));this.overlays.add(new T.Line(geometry,handleLineMaterial));}
  }
 }
}
