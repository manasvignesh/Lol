import * as T from 'three';
import type { Game } from './game';
import { predict } from './physics';
import type { V3 } from './math';
export class CourtRenderer {
  scene=new T.Scene(); camera=new T.PerspectiveCamera(47,1,0.1,100); renderer:T.WebGLRenderer;
  player=new T.Group(); opponent=new T.Group(); racket=new T.Group(); shuttle=new T.Group(); shadow:T.Mesh; landing:T.Mesh;
  trail:T.Line; trailPositions=new Float32Array(36*3); trailCount=0; flash:T.Mesh; flashLife=0; cameraShake=0; predictionClock=0;
  constructor(container:HTMLElement){
    this.renderer=new T.WebGLRenderer({antialias:true,powerPreference:'high-performance'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFSoftShadowMap;this.renderer.setClearColor('#0b171b');container.append(this.renderer.domElement);
    this.scene.fog=new T.Fog('#0b171b',20,48);this.camera.position.set(0,10.6,15.8);this.camera.lookAt(0,0.3,0);
    this.scene.add(new T.HemisphereLight(0xc6e8ed,0x20362a,2.4));const light=new T.DirectionalLight(0xfff6df,3.4);light.position.set(-6,14,4);light.castShadow=true;light.shadow.mapSize.set(2048,2048);Object.assign(light.shadow.camera,{left:-12,right:12,top:14,bottom:-14});this.scene.add(light);
    const floor=this.box(45,0.15,50,0x101e23);floor.position.y=-0.16;floor.receiveShadow=true;
    const court=this.box(6.1,0.05,13.4,0x247765);court.receiveShadow=true;
    const singles=this.box(5.18,0.055,13.4,0x2a8874);singles.receiveShadow=true;
    for(const x of [-3.05,-2.59,2.59,3.05])this.line([x,0.035,-6.7,x,0.035,6.7]);
    for(const z of [-6.7,-5.94,-1.98,1.98,5.94,6.7])this.line([-3.05,0.035,z,3.05,0.035,z]);
    this.line([0,0.035,-6.7,0,0.035,-1.98]);this.line([0,0.035,1.98,0,0.035,6.7]);
    for(const x of [-3.15,3.15]){const post=this.box(0.07,1.6,0.07,0xe6f1eb);post.position.set(x,0.8,0);}
    const net=new T.Mesh(new T.PlaneGeometry(6.3,0.75),new T.MeshBasicMaterial({color:0xd0ebe3,transparent:true,opacity:0.10,side:T.DoubleSide,depthWrite:false}));net.position.y=1.14;this.scene.add(net);
    for(let x=-3.1;x<=3.1;x+=0.18)this.line([x,0.77,0,x,1.524,0],0x69948d,0.42);
    for(let y=0.77;y<=1.53;y+=0.12)this.line([-3.15,y,0,3.15,y,0],0x69948d,0.42);
    const tape=this.box(6.35,0.045,0.028,0xe6eee6);tape.position.y=1.524;
    for(const x of [-8,8]){const strip=this.box(0.06,0.02,22,0xb7d57c);strip.position.set(x,0.02,0);for(const z of [-7,0,7]){const pillar=this.box(0.2,6,0.2,0x26373b);pillar.position.set(x,3,z);const lamp=this.box(1.2,0.06,0.35,0xe6f1dd);lamp.position.set(x,6,z);}}
    this.makeAvatar(this.player,0xbce879);this.makeAvatar(this.opponent,0xf0b786);this.opponent.rotation.y=Math.PI;this.scene.add(this.player,this.opponent);
    const handle=new T.Mesh(new T.CylinderGeometry(0.026,0.032,0.55),new T.MeshStandardMaterial({color:0xd5e9d6}));handle.position.y=-0.4;
    const hoop=new T.Mesh(new T.TorusGeometry(0.25,0.021,8,28),new T.MeshStandardMaterial({color:0xd4ff8e,emissive:0x395310}));hoop.scale.y=1.25;this.racket.add(handle,hoop);
    for(let i=-2;i<=2;i++){const a=i*0.075;const points=[new T.Vector3(a,-0.24,0),new T.Vector3(a,0.24,0)];this.racket.add(new T.Line(new T.BufferGeometry().setFromPoints(points),new T.LineBasicMaterial({color:0xb3d0a0,transparent:true,opacity:0.65})));this.racket.add(new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(-0.2,a,0),new T.Vector3(0.2,a,0)]),new T.LineBasicMaterial({color:0xb3d0a0,transparent:true,opacity:0.65})));}this.scene.add(this.racket);
    const cork=new T.Mesh(new T.SphereGeometry(0.065,12,8),new T.MeshStandardMaterial({color:0xffedb0,emissive:0x786337}));const feathers=new T.Mesh(new T.ConeGeometry(0.13,0.23,8,1,true),new T.MeshStandardMaterial({color:0xffffff,side:T.DoubleSide}));feathers.rotation.z=Math.PI;feathers.position.y=0.15;this.shuttle.add(cork,feathers);this.shuttle.scale.setScalar(1.35);this.scene.add(this.shuttle);
    this.shadow=new T.Mesh(new T.CircleGeometry(0.15,24),new T.MeshBasicMaterial({color:0x081e1b,transparent:true,opacity:0.5,depthWrite:false}));this.shadow.rotation.x=-Math.PI/2;this.scene.add(this.shadow);
    this.landing=new T.Mesh(new T.RingGeometry(0.25,0.28,40),new T.MeshBasicMaterial({color:0xd8f3a1,transparent:true,opacity:0.65,side:T.DoubleSide,depthWrite:false}));this.landing.rotation.x=-Math.PI/2;this.scene.add(this.landing);
    const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(this.trailPositions,3));this.trail=new T.Line(geometry,new T.LineBasicMaterial({color:0xf6f4bc,transparent:true,opacity:0.45}));this.trail.frustumCulled=false;this.scene.add(this.trail);
    this.flash=new T.Mesh(new T.RingGeometry(0.12,0.17,24),new T.MeshBasicMaterial({color:0xe5ffa1,transparent:true,opacity:0,side:T.DoubleSide,depthWrite:false}));this.scene.add(this.flash);
    new ResizeObserver(()=>this.resize(container)).observe(container);this.resize(container);
  }
  box(w:number,h:number,d:number,color:number){const mesh=new T.Mesh(new T.BoxGeometry(w,h,d),new T.MeshStandardMaterial({color,roughness:0.86}));this.scene.add(mesh);return mesh;}
  line(coords:number[],color=0xd6e5cc,opacity=0.85){const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(coords,3));const line=new T.Line(geo,new T.LineBasicMaterial({color,transparent:true,opacity}));this.scene.add(line);}
  makeAvatar(group:T.Group,color:number){const mat=new T.MeshStandardMaterial({color,roughness:0.7});const body=new T.Mesh(new T.CapsuleGeometry(0.23,0.45,4,12),mat);body.position.y=1.05;body.castShadow=true;group.add(body);const head=new T.Mesh(new T.SphereGeometry(0.17,16,12),new T.MeshStandardMaterial({color:0xe0cfb3}));head.position.y=1.67;head.castShadow=true;group.add(head);for(const x of [-0.14,0.14]){const leg=new T.Mesh(new T.CapsuleGeometry(0.08,0.52,4,8),new T.MeshStandardMaterial({color:0x203b39}));leg.position.set(x,0.4,0);leg.castShadow=true;group.add(leg);}const ring=new T.Mesh(new T.RingGeometry(0.38,0.42,32),new T.MeshBasicMaterial({color,side:T.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.y=0.04;group.add(ring);}
  resize(container:HTMLElement){const {width,height}=container.getBoundingClientRect();this.renderer.setSize(width,height);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();}
  impact(p:V3,power=0){this.flash.position.set(p.x,p.y,p.z);this.flashLife=0.22;this.cameraShake=power>85?0.07:0;}
  render(game:Game,dt:number){this.player.position.set(game.playerX,0,4.05);this.opponent.position.set(game.ai.x,0,game.ai.z);this.player.rotation.z=-(game.motion.playerX-game.playerX)*0.08;this.racket.position.set(game.racket.x,game.racket.y,game.racket.z);this.racket.rotation.z=-Math.atan2(game.motion.forearm.x,game.motion.forearm.y||0.001);this.shuttle.position.set(game.shuttle.p.x,game.shuttle.p.y,game.shuttle.p.z);const vel=game.shuttle.velocity;if(Math.hypot(vel.x,vel.y,vel.z)>0.1)this.shuttle.quaternion.setFromUnitVectors(new T.Vector3(0,-1,0),new T.Vector3(vel.x,vel.y,vel.z).normalize());this.shadow.position.set(game.shuttle.p.x,0.07,game.shuttle.p.z);this.shadow.scale.setScalar(1+game.shuttle.p.y*0.1);
    this.trail.visible=game.state==='rally';if(this.trail.visible){this.trailPositions.copyWithin(3,0,this.trailPositions.length-3);this.trailPositions.set([game.shuttle.p.x,game.shuttle.p.y,game.shuttle.p.z]);this.trailCount=Math.min(36,this.trailCount+1);this.trail.geometry.setDrawRange(0,this.trailCount);this.trail.geometry.attributes.position.needsUpdate=true;}else this.trailCount=0;
    this.predictionClock+=dt;if(this.predictionClock>0.12){this.predictionClock=0;const pts=predict(game.shuttle);const end=pts[pts.length-1];if(end)this.landing.position.set(end.x,0.075,end.z);}this.landing.visible=game.state==='rally'&&game.settings.assist==='beginner';
    this.flashLife=Math.max(0,this.flashLife-dt);this.flash.scale.setScalar(1+(0.22-this.flashLife)*7);this.flash.quaternion.copy(this.camera.quaternion);(this.flash.material as T.MeshBasicMaterial).opacity=this.flashLife/0.22;this.camera.position.x=Math.sin(performance.now()*0.12)*this.cameraShake;this.cameraShake*=0.85;this.renderer.render(this.scene,this.camera);
  }
}
