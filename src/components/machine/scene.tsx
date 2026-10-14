'use client';

import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { createContactShadow } from './contact-shadow';
import { clamp, smooth, smoother, stageAt, STAGES, HANDOFF_START, HANDOFF_STAGGER, HANDOFF_DURATION } from './timeline';

type Props = { time: MutableRefObject<number>; playing: MutableRefObject<boolean>; count: MutableRefObject<number>; reduced: boolean; onStart: () => void; dock: RefObject<HTMLElement|null> };
type Point = { x:number; y:number };

// A projected paper quad becomes a DOM image without changing its screen-space silhouette.
function quadTransform(q:Point[]) {
  const [p0,p1,p2,p3]=q;
  const dx1=p1.x-p2.x,dx2=p3.x-p2.x,dx3=p0.x-p1.x+p2.x-p3.x;
  const dy1=p1.y-p2.y,dy2=p3.y-p2.y,dy3=p0.y-p1.y+p2.y-p3.y;
  const den=dx1*dy2-dx2*dy1;
  const g=Math.abs(den)<1e-8?0:(dx3*dy2-dx2*dy3)/den;
  const h=Math.abs(den)<1e-8?0:(dx1*dy3-dx3*dy1)/den;
  const a=p1.x-p0.x+g*p1.x,b=p3.x-p0.x+h*p3.x;
  const d=p1.y-p0.y+g*p1.y,e=p3.y-p0.y+h*p3.y;
  return `matrix3d(${a/96},${d/96},0,${g/96},${b/144},${e/144},0,${h/144},0,0,1,0,${p0.x},${p0.y},0,1)`;
}
export default function MachineScene({ time, playing, count, reduced, onStart, dock }: Props) {
  const host=useRef<HTMLDivElement>(null),start=useRef(onStart);
  const [error,setError]=useState(false);
  useEffect(()=>{start.current=onStart;},[onStart]);
  useEffect(()=>{
    const container=host.current!;
    let renderer:THREE.WebGLRenderer;
    try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});}catch{setError(true);return;}
    renderer.setPixelRatio(Math.min(2,Math.max(1.5,window.devicePixelRatio)));
    renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.0;
    renderer.localClippingEnabled=true;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.VSMShadowMap;
    renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;
    container.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label','3D 音乐加工机：上方吸入纸卡，滚轮加工，托盘出料后展开成声音列表');renderer.domElement.setAttribute('role','img');
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(33,1,.1,80);
    const pmrem=new THREE.PMREMGenerator(renderer),environment=new RoomEnvironment(),env=pmrem.fromScene(environment,.025);
    scene.environment=env.texture;scene.environmentIntensity=.8;
    RectAreaLightUniformsLib.init();
    scene.add(new THREE.HemisphereLight(0xe8e7e0,0x171611,.13));
    const key=new THREE.DirectionalLight(0xfff5e8,.85);key.position.set(-3.8,6,4);key.castShadow=true;
    key.shadow.mapSize.set(1024,1024);Object.assign(key.shadow.camera,{left:-6,right:6,top:6,bottom:-6,near:.5,far:25});key.shadow.bias=-.0005;key.shadow.normalBias=.012;key.shadow.radius=6;key.shadow.blurSamples=8;scene.add(key);
    const softKey=new THREE.RectAreaLight(0xfff1de,5,4,4);softKey.position.set(-3.5,6,2);softKey.lookAt(0,1.5,0);scene.add(softKey);
    const strip=new THREE.RectAreaLight(0xe6ebef,2.2,1.3,4);strip.position.set(4,4,-3);strip.lookAt(0,1.5,0);scene.add(strip);
    const machine=new THREE.Group();scene.add(machine);
    let dirty=true,alive=true,frame=0,lastT=-1,lastScreen=-1,screenTime=-1,width=1,height=1,viewHeight=1,rect:DOMRect;
    const materials:THREE.Material[]=[],textures:THREE.Texture[]=[];
    let studio:THREE.WebGLRenderTarget|null=null,contact:ReturnType<typeof createContactShadow>|null=null;
    let button:THREE.Object3D|null=null,loadedModel:THREE.Group|null=null;
    const rollers:THREE.Object3D[]=[];
    const loader=new THREE.TextureLoader();
    const grain=loader.load('/machine/grain.jpg',()=>{dirty=true;});grain.wrapS=grain.wrapT=THREE.RepeatWrapping;grain.repeat.set(2,2);grain.anisotropy=8;textures.push(grain);
    const brushed=grain.clone();brushed.repeat.set(.08,.75);brushed.center.set(.5,.5);brushed.rotation=Math.PI/2;brushed.needsUpdate=true;textures.push(brushed);
    const finishes:Record<string,THREE.MeshStandardMaterial>={};
    const materialSettings:Record<string,[string,number,number]>={
      'cast-graphite':['#78766e',.35,.58], 'brushed-aluminum':['#d9d3c7',1,.40],
      'warm-anodized':['#d4c9b3',.42,.40], 'machined-steel':['#92968c',1,.23],
      'dark-steel':['#383b33',.85,.27], 'interior':['#1a1c18',.28,.48],
      'rubber':['#171a15',0,.74], 'roller-rubber':['#d85c27',0,.72],
      'switch-orange':['#f84a13',.16,.24], 'ink':['#c5c0b2',.05,.62], 'vent':['#0e110d',.2,.6],
    };
    // Large photographic softboxes give curved metal broad highlights and a dark reflection break.
    new HDRLoader().load('/machine/studio-small-09.hdr',texture=>{
      if(!alive){texture.dispose();return;}
      texture.mapping=THREE.EquirectangularReflectionMapping;
      const studioScene=new THREE.Scene();studioScene.background=texture;studioScene.backgroundIntensity=.10;
      for(const [x,y,z,w,h,power] of [[-4,6,5,5,4,4],[4,3,-3,1.2,5,3],[0,7,-1,3,2,2],[-5,1,7,1,4,1.3],[-4,-3,8,6,1.4,.30]]){
        const softbox=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color:new THREE.Color().setRGB(power,power*.96,power*.88),side:THREE.DoubleSide}));
        softbox.position.set(x,y,z);softbox.lookAt(0,1,0);studioScene.add(softbox);
      }
      studio=pmrem.fromScene(studioScene,.015);studioScene.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();(o.material as THREE.Material).dispose();}});texture.dispose();scene.environment=studio.texture;dirty=true;
    });
    new GLTFLoader().load('/machine/signal-press.glb',gltf=>{
      if(!alive){gltf.scene.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>m.dispose());}});return;}
      loadedModel=gltf.scene;machine.add(loadedModel);
      loadedModel.traverse(o=>{
        if(!(o instanceof THREE.Mesh))return;
        const source=o.material as THREE.MeshStandardMaterial,name=source.name;
        if(!finishes[name]){
          const config=materialSettings[name];
          let m:THREE.MeshStandardMaterial;
          if(name==='glass') m=new THREE.MeshPhysicalMaterial({color:'#eef2e8',roughness:.008,transmission:1,thickness:.028,ior:1.30,attenuationColor:'#9aa68f',attenuationDistance:1.2,envMapIntensity:.8});
          else {
            const [color,metalness,roughness]=config??['#55564e',.2,.5];
            m=new THREE.MeshPhysicalMaterial({color,metalness,roughness,vertexColors:!!o.geometry.attributes.color});
            if(['cast-graphite','roller-rubber'].includes(name)){m.bumpMap=grain;m.bumpScale=name==='cast-graphite'?.020:.012;}
            if(['brushed-aluminum','warm-anodized','machined-steel'].includes(name)){m.bumpMap=brushed;m.bumpScale=.013;const p=m as THREE.MeshPhysicalMaterial;p.anisotropy=name==='machined-steel'?.35:.65;p.anisotropyRotation=Math.PI/2;}
            if(name==='cast-graphite'||name==='roller-rubber')m.map=grain;
            if(name==='brushed-aluminum')m.map=brushed;
            if(name==='switch-orange'){m.emissive.set('#e64409');m.emissiveIntensity=.12;(m as THREE.MeshPhysicalMaterial).clearcoat=.24;(m as THREE.MeshPhysicalMaterial).clearcoatRoughness=.23;}
          }
          // Contact occlusion is already in the vertex albedo. Apply it to environment
          // reflections too, so metal inside the enclosure doesn't reflect an unoccluded studio.
          if(m.vertexColors)m.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <aomap_fragment>','#include <aomap_fragment>\n#ifdef USE_COLOR\nreflectedLight.indirectSpecular *= pow(vColor.r, 1.5);\n#endif');};
          finishes[name]=m;materials.push(m);
        }
        source.dispose();o.material=finishes[name];o.castShadow=name!=='glass';o.receiveShadow=name!=='glass';
      });
      for(const name of ['roller-0','roller-1']){const r=loadedModel.getObjectByName(name);if(r)rollers.push(r);}
      button=loadedModel.getObjectByName('button')??null;
      // Only the authored machine participates in the static contact bake.
      contact=createContactShadow(renderer,loadedModel);scene.add(contact.mesh);renderer.shadowMap.needsUpdate=true;dirty=true;
      // Compile hidden paper materials too, before the first card arrives on screen.
      void renderer.compileAsync(scene,camera).then(()=>{if(alive)dirty=true;}).catch(()=>{if(alive)dirty=true;});
    },undefined,()=>{if(alive)setError(true);});
    const displayCanvas=document.createElement('canvas');displayCanvas.width=256;displayCanvas.height=320;const ctx=displayCanvas.getContext('2d')!;
    const screenTex=new THREE.CanvasTexture(displayCanvas);screenTex.colorSpace=THREE.SRGBColorSpace;textures.push(screenTex);
    const screenMat=new THREE.MeshBasicMaterial({map:screenTex});materials.push(screenMat);
    const readout=new THREE.Mesh(new THREE.PlaneGeometry(.98,1.28),screenMat);readout.position.set(1.16,1.85,1.17);machine.add(readout);
    const ticketTexture=loader.load('/machine/ticket.jpg',()=>{dirty=true;});ticketTexture.colorSpace=THREE.SRGBColorSpace;ticketTexture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());textures.push(ticketTexture);
    const inputMat=new THREE.MeshBasicMaterial({map:ticketTexture,toneMapped:false,side:THREE.DoubleSide,clipShadows:true,clippingPlanes:[new THREE.Plane(new THREE.Vector3(0,1,0),-3.2)]});
    const outputMat=new THREE.MeshBasicMaterial({map:ticketTexture,toneMapped:false,side:THREE.DoubleSide,clipShadows:true,clippingPlanes:[new THREE.Plane(new THREE.Vector3(0,0,1),-1.41)]});materials.push(inputMat,outputMat);
    const makeTicket=(material:THREE.Material)=>{const geometry=new THREE.PlaneGeometry(.94,1.42,12,32);const o=new THREE.Mesh(geometry,material);o.castShadow=true;machine.add(o);return o;};
    const inputs=[0,1,2].map(()=>{const m=inputMat.clone();m.transparent=true;materials.push(m);return makeTicket(m);}),outputs=[makeTicket(outputMat),makeTicket(outputMat),makeTicket(outputMat)];
    const curvePaper=(card:THREE.Mesh<THREE.PlaneGeometry>,amount:number)=>{const pos=card.geometry.attributes.position;for(let j=0;j<pos.count;j++){const y=pos.getY(j);pos.setZ(j,amount*(y*y-.5041));}pos.needsUpdate=true;card.geometry.computeVertexNormals();};
    const glow=new THREE.PointLight(0xff5a1c,0,2.3);glow.position.set(-1,1.8,1.15);machine.add(glow);
    const groundMat=new THREE.ShadowMaterial({opacity:.055});materials.push(groundMat);
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(30,30),groundMat);ground.rotation.x=-Math.PI/2;ground.position.y=.08;ground.receiveShadow=true;scene.add(ground);
    let targets=Array.from(dock.current?.querySelectorAll<HTMLElement>('[data-ticket-target]')??[]);
    let rows=Array.from(dock.current?.querySelectorAll<HTMLElement>('[data-row-reveal]')??[]);
    let rowLines=Array.from(dock.current?.querySelectorAll<HTMLElement>('[data-result-row]')??[]);
    const headings=Array.from(dock.current?.querySelectorAll<HTMLElement>('[data-dock-heading]')??[]);
    const flights=Array.from(container.parentElement?.querySelectorAll<HTMLElement>('[data-flight]')??[]);
    let targetRects:DOMRect[]=[],layoutDirty=true;
    const mutation=new MutationObserver(()=>{layoutDirty=true;dirty=true;});
    if(dock.current)mutation.observe(dock.current,{childList:true,subtree:true});
    const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),baseCamera=new THREE.Vector3();let tilt=0,currentTilt=0,mobile=false;
    const resize=()=>{width=container.clientWidth;height=container.clientHeight;viewHeight=height;renderer.setSize(width,height,false);camera.aspect=width/height;mobile=width<580;baseCamera.set(3.4,5.3,10.4);camera.fov=mobile?36:32;camera.updateProjectionMatrix();layoutDirty=true;dirty=true;};
    const observer=new ResizeObserver(resize);observer.observe(container);if(dock.current)observer.observe(dock.current);resize();
    const onScroll=()=>{layoutDirty=true;dirty=true;};window.addEventListener('scroll',onScroll,{passive:true});
    const onMove=(e:PointerEvent)=>{const r=container.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/viewHeight*2+1);tilt=reduced?0:pointer.x*.08;raycaster.setFromCamera(pointer,camera);container.style.cursor=(button&&raycaster.intersectObject(button,true).length)?'pointer':'default';dirty=true;};
    const onLeave=()=>{tilt=0;dirty=true;};
    const onClick=(e:MouseEvent)=>{const r=container.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/viewHeight*2+1);raycaster.setFromCamera(pointer,camera);if((button&&raycaster.intersectObject(button,true).length))start.current();};
    container.addEventListener('pointermove',onMove);container.addEventListener('pointerleave',onLeave);container.addEventListener('click',onClick);
    const drawScreen=(state:number,t:number)=>{ctx.fillStyle='#090b08';ctx.fillRect(0,0,256,320);ctx.fillStyle='#c6c2b3';ctx.font='32px monospace';ctx.fillText(`0${state+1} / ${STAGES[state].english}`,17,62);ctx.font='13px monospace';['ANALYZE','PROCESS','REFORM'].forEach((v,i)=>{ctx.fillStyle=(state===i+1||state===4&&i===2)?'#ce744c':'#68695e';ctx.fillText(v,17,118+i*18);});ctx.fillStyle='#bd6d43';for(let i=0;i<14;i++){const h=state===3?4+Math.abs(Math.sin(i*.87+t*5))*24:2;ctx.fillRect(17+i*15,244-h,5,h);}screenTex.needsUpdate=true;};
    // Opt-in measurements use real rendered frames, not the nominal rAF rate.
    const bench=new URLSearchParams(location.search).has('bench');let benchPrev=0,benchActive=false;let intervals:number[]=[],costs:number[]=[];
    const corners=[new THREE.Vector3(-.47,.71,0),new THREE.Vector3(.47,.71,0),new THREE.Vector3(.47,-.71,0),new THREE.Vector3(-.47,-.71,0)];
    const render=(now:number)=>{
      if(!alive)return;frame=requestAnimationFrame(render);if(document.hidden)return;
      const t=time.current,state=stageAt(t);readout.visible=!!loadedModel;
      if(!dirty&&t===lastT&&!playing.current&&Math.abs(currentTilt-tilt)<.001)return;
      if(layoutDirty){
        targets=Array.from(dock.current?.querySelectorAll<HTMLElement>('[data-ticket-target]')??[]);
        rows=Array.from(dock.current?.querySelectorAll<HTMLElement>('[data-row-reveal]')??[]);
        rowLines=Array.from(dock.current?.querySelectorAll<HTMLElement>('[data-result-row]')??[]);
        rect=container.getBoundingClientRect();targetRects=targets.map(el=>el.getBoundingClientRect());layoutDirty=false;
      }
      const settle=smoother((t-4.02)/1.08);currentTilt+=(tilt-currentTilt)*.12;
      viewHeight=THREE.MathUtils.lerp(height,Math.max(190,Math.min(height*.50,height-300)),settle);
      camera.aspect=width/viewHeight;camera.updateProjectionMatrix();
      const framing=mobile?THREE.MathUtils.lerp(.75,1.02,settle):THREE.MathUtils.lerp(.92,1.06,settle);
      camera.position.copy(baseCamera).multiplyScalar(framing*Math.max(1,1.55/camera.aspect));camera.position.x+=currentTilt;
      camera.lookAt(mobile?0:.35,mobile?THREE.MathUtils.lerp(.5,1.85,settle):1.85,.12);camera.updateMatrixWorld();renderer.setViewport(0,height-viewHeight,width,viewHeight);
      const spin=Math.max(0,Math.min(t,2.3)-.75)*3+Math.max(0,Math.min(t,3.65)-2.3)*5.5+Math.max(0,Math.min(t,4.65)-3.65)*1.9;
      rollers.forEach((g,i)=>{g.rotation.x=state===3&&playing.current&&!reduced?-now*.005-i*.12:-spin-i*.12;});
      inputs.forEach((card,i)=>{
        const appear=smooth((t-.12-i*.07)/.32),feed=clamp((t-.75-i*.29)/.94),align=smoother(feed/.36),pull=smoother((feed-.16)/.84);
        card.visible=i<count.current&&t>.12+i*.07&&t<2.3&&feed<1;card.scale.setScalar(.96+.04*appear);(card.material as THREE.MeshBasicMaterial).opacity=appear;
        card.position.set(THREE.MathUtils.lerp(-2.06+i*.19,-2.02,align),THREE.MathUtils.lerp(4.02+i*.11,2.45,pull)-.12*(1-appear),THREE.MathUtils.lerp(.66-i*.12,-.10,align));
        card.rotation.set(THREE.MathUtils.lerp(-.12,-.20,align),0,(i-1)*-.09*(1-align));
        if(card.visible)curvePaper(card,Math.sin(feed*Math.PI)*.24);
      });
      outputs.forEach((card,i)=>{
        const e=smoother((t-3.65-i*.15)/.67),handoff=clamp((t-HANDOFF_START-i*HANDOFF_STAGGER)/HANDOFF_DURATION);
        card.visible=i<count.current&&t>=3.65+i*.15&&handoff===0;
        const peel=smoother((t-(HANDOFF_START+i*HANDOFF_STAGGER-.24))/.24);
        const travelZ=THREE.MathUtils.lerp(.61,2.38,e);
        card.position.set(-1.8+(3-count.current)*.58+i*1.16,.731-.10*(travelZ-1.2)+i*.005+.045*peel,travelZ+.12*peel);card.rotation.set(-Math.PI/2+.10-.22*peel,0,(i-1)*-.015*e);
        const bend=-Math.sin(e*Math.PI)*.065;if(card.visible)curvePaper(card,bend);
        card.updateMatrixWorld();
        const target=targetRects[i],flight=flights[i];
        if(target&&flight){
          const show=i<count.current&&handoff>0&&handoff<1;flight.style.visibility=show?'visible':'hidden';
          if(show){
            const source=corners.map(c=>{const v=c.clone().applyMatrix4(card.matrixWorld).project(camera);return{x:rect.left+(v.x+1)*width/2,y:rect.top+(1-v.y)*viewHeight/2};});
            const dest=[{x:target.left,y:target.top},{x:target.right,y:target.top},{x:target.right,y:target.bottom},{x:target.left,y:target.bottom}];
            // Keep the same four corners, then guide the card forward off the tray before
            // it turns into its list thumbnail. The row unfolds from that arriving card.
            const travel=smooth(handoff),orient=smoother((handoff-.08)/.92);
            const sc={x:source.reduce((n,p)=>n+p.x,0)/4,y:source.reduce((n,p)=>n+p.y,0)/4};
            const dc={x:(target.left+target.right)/2,y:(target.top+target.bottom)/2};
            const q=1-travel;
            const cx=q*q*q*sc.x+3*q*q*travel*(sc.x-10)+3*q*travel*travel*(dc.x+48)+travel*travel*travel*dc.x;
            const cy=q*q*q*sc.y+3*q*q*travel*(sc.y+32)+3*q*travel*travel*(dc.y-5)+travel*travel*travel*dc.y;
            flight.style.transform=quadTransform(source.map((p,j)=>({x:cx+THREE.MathUtils.lerp(p.x-sc.x,dest[j].x-dc.x,orient),y:cy+THREE.MathUtils.lerp(p.y-sc.y,dest[j].y-dc.y,orient)})));
            flight.style.boxShadow=`0 ${2+3*Math.sin(Math.PI*handoff)}px ${3+5*Math.sin(Math.PI*handoff)}px #0004`;

          }
          targets[i].style.opacity=handoff>=1?'1':'0';
          const reveal=smoother((handoff-.70)/.30);rows[i].style.opacity=String(reveal);rows[i].style.clipPath=`inset(0 ${(1-reveal)*100}% 0 0)`;rows[i].style.transform=`translateX(${-8*(1-reveal)}px)`;
          rowLines[i].style.setProperty('--row-reveal',String(reveal));
          rowLines[i].style.setProperty('--cover-reveal',String(smoother((t-HANDOFF_START-i*HANDOFF_STAGGER-HANDOFF_DURATION)/.28)));
        }
      });
      for(let i=3;i<targets.length;i++){
        const reveal=smoother((t-5.45-Math.min(i-3,5)*.025)/.2);
        targets[i].style.opacity=String(reveal);rows[i].style.opacity=String(reveal);
        rows[i].style.clipPath='none';rows[i].style.transform=`translateY(${(1-reveal)*8}px)`;
        rowLines[i].style.setProperty('--row-reveal',String(reveal));
        rowLines[i].style.setProperty('--cover-reveal',String(reveal));
      }
      headings.forEach(el=>{el.style.opacity=String(smooth((t-5.02)/.52));});
      glow.intensity=state===3?.28*Math.sin((t-2.3)/1.35*Math.PI):.015;
      if(button)button.position.z=t>.025&&t<.2?1.40:1.423;
      if(lastScreen!==state||state===3&&now-screenTime>100){drawScreen(state,state===3&&!reduced?now/1000:t);lastScreen=state;screenTime=now;}
      if(t!==lastT&&(t<2.3||t>=3.65&&t<5.9))renderer.shadowMap.needsUpdate=true;
      const renderStart=performance.now();renderer.render(scene,camera);const cost=performance.now()-renderStart;
      if(bench&&playing.current){if(benchPrev)intervals.push(now-benchPrev);benchPrev=now;costs.push(cost);benchActive=true;}
      else if(bench&&benchActive){const sorted=[...intervals].sort((a,b)=>a-b);console.info('MACHINE_BENCH',JSON.stringify({frames:intervals.length,medianMs:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)],meanFps:1000/(intervals.reduce((a,b)=>a+b,0)/intervals.length),meanRenderCpuMs:costs.reduce((a,b)=>a+b,0)/costs.length,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles}));benchActive=false;benchPrev=0;intervals=[];costs=[];}
      dirty=false;lastT=t;
    };
    frame=requestAnimationFrame(render);
    const onLost=(e:Event)=>{e.preventDefault();setError(true);};renderer.domElement.addEventListener('webglcontextlost',onLost);
    return()=>{alive=false;cancelAnimationFrame(frame);observer.disconnect();mutation.disconnect();window.removeEventListener('scroll',onScroll);container.removeEventListener('pointermove',onMove);container.removeEventListener('pointerleave',onLeave);container.removeEventListener('click',onClick);renderer.domElement.removeEventListener('webglcontextlost',onLost);scene.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose();});materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());contact?.dispose();studio?.dispose();env.dispose();environment.dispose();pmrem.dispose();renderer.dispose();renderer.domElement.remove();flights.forEach(el=>el.style.visibility='hidden');};
  },[time,playing,count,reduced,dock]);
  return <div ref={host} className="machine-canvas">{error&&<div className="machine-fallback"><p>当前设备无法显示 3D 画面。</p><p>仍可正常选择文件、转换和下载。</p></div>}</div>;
}
