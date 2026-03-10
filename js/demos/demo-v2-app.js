import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

// ═══════════════════════════════════════════════════════════════════════════
// 1. DATA MODEL
// ═══════════════════════════════════════════════════════════════════════════

let model = {
  primitives: [{ id:'box_1', primitive:'box', params:{length:100,width:60,height:40,thickness:3}, joints:{type:'finger'} }],
  overrides: {},
  decorations: {},
  meta: { name:'基础盒子', source:'initial' },
};
let lastChangeSource = null;

function updateModel(fn, source) {
  lastChangeSource = source || null;
  fn(model);
  onChange();
}

function onChange() {
  renderScene();
  syncSlidersFromModel();
  updateJSONViewer(lastChangeSource);
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. JOINT GEOMETRY
// ═══════════════════════════════════════════════════════════════════════════

function calcToothCount(len, t) { let n = Math.max(3, Math.floor(len / (3*t))); if(n%2===0) n++; return n; }

function fingerEdgePts(x0,y0,x1,y1,outX,outY,t,type) {
  if(type==='flat') return [[x0,y0]];
  const len=Math.hypot(x1-x0,y1-y0); if(len<1e-6) return [[x0,y0]];
  const n=calcToothCount(len,t),segW=len/n,dx=(x1-x0)/len,dy=(y1-y0)/len,pts=[];
  for(let i=0;i<n;i++){
    const sx=x0+dx*i*segW,sy=y0+dy*i*segW,ex=x0+dx*(i+1)*segW,ey=y0+dy*(i+1)*segW;
    const hasTab=type==='A'?(i%2===0):(i%2!==0);
    if(hasTab){pts.push([sx,sy],[sx+outX*t,sy+outY*t],[ex+outX*t,ey+outY*t],[ex,ey])}else{pts.push([sx,sy])}
  } return pts;
}

function tabSlotEdgePts(x0,y0,x1,y1,outX,outY,t,type) {
  if(type==='flat') return [[x0,y0]];
  const len=Math.hypot(x1-x0,y1-y0); const M=Math.max(2,Math.floor(len/30));
  const div=2*M+1,segW=len/div,dx=(x1-x0)/len,dy=(y1-y0)/len,pts=[];
  for(let i=0;i<div;i++){
    const sx=x0+dx*i*segW,sy=y0+dy*i*segW,ex=x0+dx*(i+1)*segW,ey=y0+dy*(i+1)*segW;
    const hasTab=type==='A'?(i%2===1):(i%2===0);
    if(hasTab){pts.push([sx,sy],[sx+outX*t,sy+outY*t],[ex+outX*t,ey+outY*t],[ex,ey])}else{pts.push([sx,sy])}
  } return pts;
}

function dedupPts(pts){const r=[pts[0]];for(let i=1;i<pts.length;i++){const p=r[r.length-1];if(Math.abs(pts[i][0]-p[0])>0.001||Math.abs(pts[i][1]-p[1])>0.001)r.push(pts[i])}return r}

function buildShape(rawPts,holes){
  const pts=dedupPts(rawPts);const shape=new THREE.Shape();
  shape.moveTo(pts[0][0],pts[0][1]);for(let i=1;i<pts.length;i++)shape.lineTo(pts[i][0],pts[i][1]);shape.closePath();
  if(holes)for(const h of holes)shape.holes.push(h);
  return shape;
}

function jointShape(type,w,h,t,edges,holes){
  const efn = type==='tab' ? tabSlotEdgePts : fingerEdgePts;
  const pts=[];
  pts.push(...efn(0,0,w,0,0,-1,t,edges.bottom));
  pts.push(...efn(w,0,w,h,1,0,t,edges.right));
  pts.push(...efn(w,h,0,h,0,1,t,edges.top));
  pts.push(...efn(0,h,0,0,-1,0,t,edges.left));
  return buildShape(pts,holes);
}

function makePanelMesh(shape,t,color){
  const geo=new THREE.ExtrudeGeometry(shape,{depth:t,bevelEnabled:false});
  const mat=new THREE.MeshStandardMaterial({color,roughness:0.55,metalness:0.1,side:THREE.DoubleSide});
  return new THREE.Mesh(geo,mat);
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. DECORATION → HOLES
// ═══════════════════════════════════════════════════════════════════════════

function decoToPath(d){
  const path=new THREE.Path();
  if(d.type==='circle'){path.absarc(d.cx,d.cy,d.radius,0,Math.PI*2,false)}
  else if(d.type==='rect'){const hw=d.width/2,hh=d.height/2;path.moveTo(d.x-hw,d.y-hh);path.lineTo(d.x+hw,d.y-hh);path.lineTo(d.x+hw,d.y+hh);path.lineTo(d.x-hw,d.y+hh);path.closePath()}
  return path;
}

function getHoles(panelId){
  const decos=model.decorations?.[panelId];
  if(!decos||decos.length===0) return null;
  return decos.filter(d=>d.mode==='cut').map(d=>decoToPath(d));
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. RENDERER (stateless: JSON → THREE.Group)
// ═══════════════════════════════════════════════════════════════════════════

const COLORS={front:0xef9a9a,back:0x90caf9,left:0xa5d6a7,right:0xffcc80,top:0xce93d8,bottom:0x80cbc4,divider:0xfff9c4};
const PANEL_LABELS={front:'前面板',back:'后面板',left:'左面板',right:'右面板',top:'顶面板',bottom:'底面板'};
const EXPLODE_DIRS={front:[0,0,-1],back:[0,0,1],left:[-1,0,0],right:[1,0,0],bottom:[0,-1,0],top:[0,1,0]};

function renderFromModel(m){
  const group=new THREE.Group();
  const box=m.primitives?.find(p=>p.primitive==='box');
  if(!box) return group;
  const {length:L,width:W,height:H,thickness:T}=box.params;
  const jt=box.joints?.type==='tab'?'tab':'finger';
  const hL=L/2, hW=W/2;

  const panels=[
    {id:'front',w:L,h:H,edges:{bottom:'A',right:'A',top:'A',left:'A'},pos:[-hL,0,-hW-T],rot:[0,0,0],color:COLORS.front},
    {id:'back',w:L,h:H,edges:{bottom:'A',right:'A',top:'A',left:'A'},pos:[-hL,0,hW],rot:[0,0,0],color:COLORS.back},
    {id:'left',w:W,h:H,edges:{bottom:'A',right:'B',top:'A',left:'B'},pos:[-hL-T,0,hW],rot:[0,Math.PI/2,0],color:COLORS.left},
    {id:'right',w:W,h:H,edges:{bottom:'A',right:'B',top:'A',left:'B'},pos:[hL,0,hW],rot:[0,Math.PI/2,0],color:COLORS.right},
    {id:'bottom',w:L,h:W,edges:{bottom:'B',right:'B',top:'B',left:'B'},pos:[-hL,-T,hW],rot:[-Math.PI/2,0,0],color:COLORS.bottom},
    {id:'top',w:L,h:W,edges:{bottom:'B',right:'B',top:'B',left:'B'},pos:[-hL,H,hW],rot:[-Math.PI/2,0,0],color:COLORS.top},
  ];

  for(const p of panels){
    if(m.overrides?.[p.id]?.removed) continue;
    const holes=getHoles(p.id);
    const shape=jointShape(jt,p.w,p.h,T,p.edges,holes);
    const mesh=makePanelMesh(shape,T,p.color);
    mesh.rotation.set(...p.rot);
    mesh.position.set(...p.pos);
    const ov=m.overrides?.[p.id];
    if(ov?.position_offset){mesh.position.x+=ov.position_offset[0];mesh.position.y+=ov.position_offset[1];mesh.position.z+=ov.position_offset[2]}
    mesh.userData={panelId:p.id,label:PANEL_LABELS[p.id]||p.id,explodeDir:new THREE.Vector3(...(EXPLODE_DIRS[p.id]||[0,0,0])),panelW:p.w,panelH:p.h};
    group.add(mesh);
  }

  const dividers=m.primitives.filter(p=>p.primitive==='divider');
  for(const div of dividers){
    if(m.overrides?.[div.id]?.removed) continue;
    const {index:idx,count}=div.params;
    const spacing=L/(count+1);
    const xPos=-hL+spacing*(idx+1);
    const holes=getHoles(div.id);
    const shape=jointShape(jt,W,H,T,{bottom:'B',right:'A',top:'B',left:'A'},holes);
    const mesh=makePanelMesh(shape,T,COLORS.divider);
    mesh.rotation.y=Math.PI/2;
    mesh.position.set(xPos-T/2,0,hW);
    const ov=m.overrides?.[div.id];
    if(ov?.position_offset){mesh.position.x+=ov.position_offset[0];mesh.position.y+=ov.position_offset[1];mesh.position.z+=ov.position_offset[2]}
    mesh.userData={panelId:div.id,label:`隔板 ${idx+1}`,explodeDir:new THREE.Vector3(0,0,0),panelW:W,panelH:H};
    group.add(mesh);
  }

  group.traverse(c=>{if(c.isMesh)c.userData.basePosition=c.position.clone()});
  return group;
}

function setExplodeFactor(group,factor){
  const dist=50;
  group.traverse(c=>{
    if(c.isMesh&&c.userData.basePosition&&c.userData.explodeDir){
      const b=c.userData.basePosition,d=c.userData.explodeDir;
      c.position.set(b.x+d.x*factor*dist,b.y+d.y*factor*dist,b.z+d.z*factor*dist);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. MOCK AGENT
// ═══════════════════════════════════════════════════════════════════════════

function processAgentCommand(text){
  const t=text.toLowerCase();
  const reply=[];

  // Create box
  if(/盒子|box|收纳/.test(t)){
    const dims=extractDims(text);
    const clean={};if(dims.length)clean.length=dims.length;if(dims.width)clean.width=dims.width;if(dims.height)clean.height=dims.height;if(dims.thickness)clean.thickness=dims.thickness;
    updateModel(m=>{
      m.primitives=m.primitives.filter(p=>p.primitive==='box');
      const box=m.primitives.find(p=>p.primitive==='box');
      if(box){Object.assign(box.params,clean);if(dims.jointType)box.joints.type=dims.jointType}
      else{m.primitives.unshift({id:'box_1',primitive:'box',params:{length:clean.length||100,width:clean.width||60,height:clean.height||40,thickness:clean.thickness||3},joints:{type:dims.jointType||'finger'}})}
      m.primitives=m.primitives.filter(p=>p.primitive!=='divider');
      m.overrides={};m.decorations={};
    },'agent');
    const p=model.primitives[0].params;
    reply.push(`已生成 ${p.length}×${p.width}×${p.height}mm 盒子，板厚 ${p.thickness}mm。`);
  }

  // Add dividers
  const divMatch=t.match(/加\s*(\d+)\s*(?:个|块)?\s*(?:隔板|隔层|分隔)/);
  if(divMatch||/加隔板|加隔层/.test(t)){
    const count=divMatch?parseInt(divMatch[1]):1;
    updateModel(m=>{
      m.primitives=m.primitives.filter(p=>p.primitive!=='divider');
      for(let i=0;i<count;i++){m.primitives.push({id:`divider_${i}`,primitive:'divider',parent:'box_1',params:{index:i,count}})}
    },'agent');
    reply.push(`已添加 ${divMatch?divMatch[1]:1} 块隔板。`);
  }

  // Remove panel
  const removeMatch=t.match(/(?:去掉|删除|移除|没有|不要)\s*(?:顶板|顶面|盖子|top)/);
  if(removeMatch){
    updateModel(m=>{if(!m.overrides.top)m.overrides.top={};m.overrides.top.removed=true},'agent');
    reply.push('已去掉顶板。');
  }
  const removeBottom=t.match(/(?:去掉|删除|移除|没有|不要)\s*(?:底板|底面|底部|bottom)/);
  if(removeBottom){
    updateModel(m=>{if(!m.overrides.bottom)m.overrides.bottom={};m.overrides.bottom.removed=true},'agent');
    reply.push('已去掉底板。');
  }

  // Add cutout
  const cutoutMatch=t.match(/(?:前|后|左|右|顶|底)?\s*(?:面板|面)?\s*加\s*(?:一个|个)?\s*(圆形?|矩形?|方形?)\s*(?:镂空|孔|洞)/);
  if(cutoutMatch){
    let panelId='front';
    if(/前/.test(t))panelId='front';else if(/后/.test(t))panelId='back';
    else if(/左/.test(t))panelId='left';else if(/右/.test(t))panelId='right';
    else if(/顶/.test(t))panelId='top';else if(/底/.test(t))panelId='bottom';
    const box=model.primitives.find(p=>p.primitive==='box');
    const isCircle=/圆/.test(cutoutMatch[1]);
    const pw=panelId==='left'||panelId==='right'?box.params.width:box.params.length;
    const ph=panelId==='top'||panelId==='bottom'?box.params.width:box.params.height;
    const r=Math.min(pw,ph)*0.2;
    updateModel(m=>{
      if(!m.decorations[panelId])m.decorations[panelId]=[];
      if(isCircle){m.decorations[panelId].push({type:'circle',cx:pw/2,cy:ph/2,radius:r,mode:'cut'})}
      else{m.decorations[panelId].push({type:'rect',x:pw/2,y:ph/2,width:r*2,height:r*1.5,mode:'cut'})}
    },'agent');
    reply.push(`已在${PANEL_LABELS[panelId]||panelId}添加${isCircle?'圆形':'矩形'}镂空。`);
  }

  // Change joint type
  if(/换成?插榫|用插榫|卡槽|tab/i.test(t)&&!/盒子/.test(t)){
    updateModel(m=>{const box=m.primitives.find(p=>p.primitive==='box');if(box)box.joints.type='tab'},'agent');
    reply.push('已切换为插榫接合。');
  }
  if(/换成?指接|用指接|finger/i.test(t)&&!/盒子/.test(t)){
    updateModel(m=>{const box=m.primitives.find(p=>p.primitive==='box');if(box)box.joints.type='finger'},'agent');
    reply.push('已切换为指接榫接合。');
  }

  if(reply.length===0){
    // Fallback: try dimension parsing
    const dims=extractDims(text);
    if(dims._found){
      const dc={};if(dims.length)dc.length=dims.length;if(dims.width)dc.width=dims.width;if(dims.height)dc.height=dims.height;if(dims.thickness)dc.thickness=dims.thickness;
      updateModel(m=>{const box=m.primitives.find(p=>p.primitive==='box');if(box){Object.assign(box.params,dc);if(dims.jointType)box.joints.type=dims.jointType}},'agent');
      const p=model.primitives[0].params;
      reply.push(`已更新尺寸为 ${p.length}×${p.width}×${p.height}mm。`);
    } else {
      reply.push('抱歉，没有理解指令。试试："做一个 200x150x100 的盒子"、"加 3 个隔板"、"去掉顶板"、"前面板加圆形镂空"');
    }
  }
  return reply.join(' ');
}

function extractDims(text){
  const r={_found:false};
  const nums=[];let m;const re=/(\d+(?:\.\d+)?)/g;
  while((m=re.exec(text))!==null)nums.push(parseFloat(m[1]));

  if(/[×x*]/.test(text)){
    const parts=text.split(/[×x*]/).map(s=>{const mm=s.match(/(\d+(?:\.\d+)?)/);return mm?parseFloat(mm[1]):NaN}).filter(n=>!isNaN(n)&&n>0);
    if(parts.length>=3){r.length=clamp(parts[0],20,300);r.width=clamp(parts[1],20,300);r.height=clamp(parts[2],10,200);r._found=true}
    else if(parts.length===2){r.length=clamp(parts[0],20,300);r.width=clamp(parts[1],20,300);r._found=true}
  }
  if(/板厚|厚度/.test(text)&&nums.length>=1){const t=nums[nums.length-1];if(t>=1&&t<=10){r.thickness=t;r._found=true}}
  if(/插榫|卡槽|tab/i.test(text)){r.jointType='tab';r._found=true}
  if(/指接|finger/i.test(text)){r.jointType='finger';r._found=true}
  return r;
}

function clamp(v,lo,hi){return Math.min(hi,Math.max(lo,v))}

// ═══════════════════════════════════════════════════════════════════════════
// 6. THREE.JS SCENE
// ═══════════════════════════════════════════════════════════════════════════

const canvas=document.getElementById('viewport');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
renderer.setPixelRatio(Math.min(2,window.devicePixelRatio));
renderer.setClearColor(0x1a1a2e);

const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(50,1,0.1,2000);
camera.position.set(120,100,160);

const orbitCtrl=new OrbitControls(camera,canvas);
orbitCtrl.enableDamping=true;orbitCtrl.dampingFactor=0.08;

scene.add(new THREE.AmbientLight(0xffffff,0.5));
const dl=new THREE.DirectionalLight(0xffffff,0.8);dl.position.set(60,100,80);scene.add(dl);
const dl2=new THREE.DirectionalLight(0xffffff,0.25);dl2.position.set(-40,-20,-60);scene.add(dl2);
scene.add(new THREE.GridHelper(400,40,0x333355,0x222244));

// TransformControls
const transformCtrl=new TransformControls(camera,renderer.domElement);
transformCtrl.setSize(0.8);
transformCtrl.addEventListener('dragging-changed',e=>{orbitCtrl.enabled=!e.value});
transformCtrl.addEventListener('objectChange',()=>{
  const obj=transformCtrl.object;
  if(!obj||!obj.userData.panelId) return;
  const base=obj.userData.basePosition;
  if(!base) return;
  const offset=[
    Math.round((obj.position.x-base.x)*10)/10,
    Math.round((obj.position.y-base.y)*10)/10,
    Math.round((obj.position.z-base.z)*10)/10,
  ];
  const pid=obj.userData.panelId;
  if(!model.overrides[pid]) model.overrides[pid]={};
  model.overrides[pid].position_offset=offset;
  lastChangeSource='canvas';
  syncSlidersFromModel();
  updateJSONViewer('canvas');
});
scene.add(transformCtrl);

let boxGroup=null;
let explodeFactor=0;
let selectedMesh=null;

function renderScene(){
  if(transformCtrl.object) transformCtrl.detach();
  selectedMesh=null;
  if(boxGroup){scene.remove(boxGroup);boxGroup.traverse(c=>{if(c.geometry)c.geometry.dispose();if(c.material)c.material.dispose()})}
  boxGroup=renderFromModel(model);
  scene.add(boxGroup);
  setExplodeFactor(boxGroup,explodeFactor);
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. RAYCASTING: click → select, dblclick → face editor
// ═══════════════════════════════════════════════════════════════════════════

const raycaster=new THREE.Raycaster();
const mouse=new THREE.Vector2();
const tooltip=document.getElementById('tooltip');
let hoveredMesh=null, hoveredColor=null;

function getMeshes(){const arr=[];if(boxGroup)boxGroup.traverse(c=>{if(c.isMesh&&c.userData.panelId)arr.push(c)});return arr}

canvas.addEventListener('mousemove',e=>{
  const rect=canvas.getBoundingClientRect();
  mouse.x=((e.clientX-rect.left)/rect.width)*2-1;
  mouse.y=-((e.clientY-rect.top)/rect.height)*2+1;
  raycaster.setFromCamera(mouse,camera);
  const hits=raycaster.intersectObjects(getMeshes());
  if(hits.length>0){
    const m=hits[0].object;
    if(m!==hoveredMesh){resetHover();hoveredMesh=m;hoveredColor=m.material.color.getHex();m.material.emissive.setHex(0x222244)}
    tooltip.textContent=`${m.userData.label} | 单击选中拖拽 · 双击编辑面`;
    tooltip.classList.add('visible');
  } else {resetHover();tooltip.classList.remove('visible')}
});

function resetHover(){if(hoveredMesh){hoveredMesh.material.emissive.setHex(0);hoveredMesh=null;hoveredColor=null}}

canvas.addEventListener('click',e=>{
  if(transformCtrl.dragging) return;
  raycaster.setFromCamera(mouse,camera);
  const hits=raycaster.intersectObjects(getMeshes());
  if(hits.length>0){
    const m=hits[0].object;
    if(selectedMesh&&selectedMesh!==m&&selectedMesh.material){selectedMesh.material.emissive.setHex(0)}
    selectedMesh=m;
    transformCtrl.attach(m);
    m.material.emissive.setHex(0x333366);
  } else {
    if(selectedMesh){selectedMesh.material.emissive.setHex(0);selectedMesh=null}
    transformCtrl.detach();
  }
});

canvas.addEventListener('dblclick',e=>{
  raycaster.setFromCamera(mouse,camera);
  const hits=raycaster.intersectObjects(getMeshes());
  if(hits.length>0){
    const m=hits[0].object;
    openFaceEditor(m.userData.panelId,m.userData.panelW,m.userData.panelH);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. FACE EDITOR
// ═══════════════════════════════════════════════════════════════════════════

let feOverlay,feCanvas,feCtx,fePanelId,fePanelW,fePanelH,feDecos=[],feSelected=-1,feTool=null,feScale=1,feOffX=0,feOffY=0;

function initFaceEditor(){
  feOverlay=document.getElementById('faceEditorOverlay');
  feCanvas=document.getElementById('editorCanvas');
  feCtx=feCanvas.getContext('2d');
  document.getElementById('editorClose').addEventListener('click',closeFE);
  document.getElementById('editorCancel').addEventListener('click',closeFE);
  document.getElementById('editorApply').addEventListener('click',applyFE);
  document.querySelectorAll('.editor-toolbar button').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const tool=btn.dataset.tool;
      if(tool==='delete'){if(feSelected>=0){feDecos.splice(feSelected,1);feSelected=-1;drawFE()}return}
      feTool=feTool===tool?null:tool;
      document.querySelectorAll('.editor-toolbar button').forEach(b=>b.classList.toggle('active',b.dataset.tool===feTool));
    });
  });
  feCanvas.addEventListener('mousedown',e=>{
    const rect=feCanvas.getBoundingClientRect();
    const cx=e.clientX-rect.left,cy=e.clientY-rect.top;
    const mx=(cx-feOffX)/feScale,my=(feOffY-cy)/feScale;
    if(feTool){
      const sz=Math.min(fePanelW,fePanelH)*0.15;
      if(feTool==='circle')feDecos.push({type:'circle',cx:mx,cy:my,radius:sz,mode:'cut'});
      else if(feTool==='rect')feDecos.push({type:'rect',x:mx,y:my,width:sz*2,height:sz*1.5,mode:'cut'});
      feSelected=feDecos.length-1;feTool=null;
      document.querySelectorAll('.editor-toolbar button').forEach(b=>b.classList.remove('active'));
      drawFE();return;
    }
    feSelected=-1;
    for(let i=feDecos.length-1;i>=0;i--){if(feHitTest(feDecos[i],mx,my)){feSelected=i;break}}
    drawFE();
  });
}

function openFaceEditor(panelId,pw,ph){
  fePanelId=panelId;fePanelW=pw;fePanelH=ph;
  feDecos=model.decorations?.[panelId]?JSON.parse(JSON.stringify(model.decorations[panelId])):[];
  feSelected=-1;feTool=null;
  document.getElementById('editorTitle').textContent=`面编辑器 — ${PANEL_LABELS[panelId]||panelId}`;
  feOverlay.classList.remove('hidden');
  const dpr=window.devicePixelRatio||1;const rect=feCanvas.getBoundingClientRect();
  feCanvas.width=rect.width*dpr;feCanvas.height=rect.height*dpr;feCtx.setTransform(dpr,0,0,dpr,0,0);
  const pad=40;feScale=Math.min((rect.width-pad*2)/pw,(rect.height-pad*2)/ph);
  feOffX=rect.width/2-(pw/2)*feScale;feOffY=rect.height/2+(ph/2)*feScale;
  drawFE();
}

function closeFE(){feOverlay.classList.add('hidden')}

function applyFE(){
  updateModel(m=>{m.decorations[fePanelId]=JSON.parse(JSON.stringify(feDecos))},'canvas');
  closeFE();
}

function feToCanvas(x,y){return[x*feScale+feOffX,-y*feScale+feOffY]}

function drawFE(){
  const w=feCanvas.getBoundingClientRect().width,h=feCanvas.getBoundingClientRect().height;
  feCtx.clearRect(0,0,w,h);
  feCtx.beginPath();
  const[sx,sy]=feToCanvas(0,0);feCtx.moveTo(sx,sy);
  const[rx,ry]=feToCanvas(fePanelW,0);feCtx.lineTo(rx,ry);
  const[tx,ty]=feToCanvas(fePanelW,fePanelH);feCtx.lineTo(tx,ty);
  const[lx,ly]=feToCanvas(0,fePanelH);feCtx.lineTo(lx,ly);
  feCtx.closePath();feCtx.strokeStyle='rgba(79,195,247,0.5)';feCtx.lineWidth=2;feCtx.stroke();
  feCtx.fillStyle='rgba(79,195,247,0.04)';feCtx.fill();
  feDecos.forEach((d,i)=>drawFEDeco(d,i===feSelected));
}

function drawFEDeco(d,sel){
  feCtx.save();
  const col='rgba(229,115,115,0.8)',fill='rgba(229,115,115,0.15)';
  if(d.type==='circle'){
    const[cx,cy]=feToCanvas(d.cx,d.cy);const r=d.radius*feScale;
    feCtx.beginPath();feCtx.arc(cx,cy,r,0,Math.PI*2);
    feCtx.strokeStyle=col;feCtx.lineWidth=sel?3:1.5;feCtx.stroke();feCtx.fillStyle=fill;feCtx.fill();
    if(sel){feCtx.setLineDash([4,3]);feCtx.strokeStyle='#fff';feCtx.lineWidth=1;feCtx.strokeRect(cx-r-4,cy-r-4,(r+4)*2,(r+4)*2);feCtx.setLineDash([])}
  } else if(d.type==='rect'){
    const[cx,cy]=feToCanvas(d.x,d.y);const rw=d.width*feScale,rh=d.height*feScale;
    feCtx.strokeStyle=col;feCtx.lineWidth=sel?3:1.5;feCtx.strokeRect(cx-rw/2,cy-rh/2,rw,rh);
    feCtx.fillStyle=fill;feCtx.fillRect(cx-rw/2,cy-rh/2,rw,rh);
    if(sel){feCtx.setLineDash([4,3]);feCtx.strokeStyle='#fff';feCtx.lineWidth=1;feCtx.strokeRect(cx-rw/2-4,cy-rh/2-4,rw+8,rh+8);feCtx.setLineDash([])}
  }
  feCtx.restore();
}

function feHitTest(d,mx,my){
  const mg=2;
  if(d.type==='circle')return Math.hypot(mx-d.cx,my-d.cy)<=d.radius+mg;
  if(d.type==='rect')return Math.abs(mx-d.x)<=d.width/2+mg&&Math.abs(my-d.y)<=d.height/2+mg;
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. UI BINDINGS
// ═══════════════════════════════════════════════════════════════════════════

function syncSlidersFromModel(){
  const p=model.primitives?.find(b=>b.primitive==='box')?.params;if(!p)return;
  document.getElementById('paramLength').value=p.length;document.getElementById('valLength').textContent=p.length;
  document.getElementById('paramWidth').value=p.width;document.getElementById('valWidth').textContent=p.width;
  document.getElementById('paramHeight').value=p.height;document.getElementById('valHeight').textContent=p.height;
  document.getElementById('paramThickness').value=p.thickness;document.getElementById('valThickness').textContent=p.thickness;
  const jt=model.primitives[0]?.joints?.type||'finger';
  document.getElementById('paramJoint').value=jt;document.getElementById('valJoint').textContent=jt==='tab'?'插榫':'指接榫';
}

function escapeHtml(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}

function updateJSONViewer(source){
  const pre=document.getElementById('jsonPre');
  const raw=JSON.stringify(model,null,2);
  let html=escapeHtml(raw).replace(/"([^"]+)":/g,'<span class="key">"$1"</span>:').replace(/: "([^"]*)"/g,(_,s)=>': <span class="str">"'+escapeHtml(s)+'"</span>').replace(/: (-?\d+(?:\.\d+)?)/g,': <span class="num">$1</span>');
  pre.innerHTML=html;
  if(source==='agent')pre.querySelectorAll('.key').forEach(el=>{if(/"primitives"|"decorations"/.test(el.textContent))el.classList.add('hl-prim')});
  else if(source==='canvas'||source==='slider')pre.querySelectorAll('.key').forEach(el=>{if(el.textContent==='"overrides"')el.classList.add('hl-over')});
}

// Chat
document.getElementById('chatSend').addEventListener('click',()=>{
  const input=document.getElementById('chatText');const text=(input.value||'').trim();if(!text)return;
  const chatLog=document.getElementById('chatLog');
  chatLog.innerHTML+='<div class="user">你：'+escapeHtml(text)+'</div>';
  const reply=processAgentCommand(text);
  chatLog.innerHTML+='<div class="agent">Agent：'+escapeHtml(reply)+'</div>';
  chatLog.scrollTop=chatLog.scrollHeight;input.value='';
});
document.getElementById('chatText').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('chatSend').click()});

// Sliders
for(const[id,path]of[['paramLength','length'],['paramWidth','width'],['paramHeight','height'],['paramThickness','thickness']]){
  document.getElementById(id).addEventListener('input',e=>{
    const v=Number(e.target.value);document.getElementById('val'+path.charAt(0).toUpperCase()+path.slice(1)).textContent=v;
    updateModel(m=>{const box=m.primitives.find(p=>p.primitive==='box');if(box)box.params[path]=v},'slider');
  });
}
document.getElementById('paramJoint').addEventListener('change',e=>{
  const v=e.target.value;document.getElementById('valJoint').textContent=v==='tab'?'插榫':'指接榫';
  updateModel(m=>{const box=m.primitives.find(p=>p.primitive==='box');if(box)box.joints.type=v},'slider');
});
document.getElementById('paramExplode').addEventListener('input',e=>{
  explodeFactor=Number(e.target.value);document.getElementById('valExplode').textContent=explodeFactor.toFixed(2);
  if(boxGroup)setExplodeFactor(boxGroup,explodeFactor);
});
document.getElementById('jsonToggle').addEventListener('click',()=>{const p=document.getElementById('jsonPre');p.style.display=p.style.display==='none'?'block':'none'});

// Resize
function onResize(){const w=canvas.clientWidth,h=canvas.clientHeight;if(canvas.width!==w||canvas.height!==h){renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix()}}
window.addEventListener('resize',onResize);onResize();

// Boot
initFaceEditor();
renderScene();
syncSlidersFromModel();
updateJSONViewer(null);
(function animate(){requestAnimationFrame(animate);orbitCtrl.update();renderer.render(scene,camera)})();
