import type { Pose } from './motion';
export class CameraManager {
  video=document.createElement('video'); worker:Worker|null=null; stream:MediaStream|null=null; busy=false; ready=false; running=false;
  inferenceMs=0; latency=0; poseFps=0; cameraFps=0; lastPose=0; lastFrame=0; lastVideoTime=-1; generation=0;
  onPose:(p:Pose|null,t:number)=>void=()=>{}; onError:(message:string)=>void=()=>{};
  constructor(){this.video.autoplay=true;this.video.muted=true;this.video.playsInline=true;}
  async devices(){return (await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');}
  async start(deviceId=''){
    this.stop();const generation=this.generation;
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera access requires localhost and a recent Chrome or Edge browser.');
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},frameRate:{ideal:30,max:60},...(deviceId?{deviceId:{exact:deviceId}}:{facingMode:'user'})},audio:false});
      if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());return;}
      this.stream=stream;this.video.srcObject=stream;await this.video.play();this.running=true;
      stream.getVideoTracks()[0].onended=()=>{this.onError('Camera disconnected. Reconnect it, then use Recalibrate.');this.stop();};
      this.worker=new Worker(new URL('./pose.worker.ts',import.meta.url),{type:'module'});
      this.worker.onerror=()=>{this.onError('Pose worker could not start. Run npm run setup, then reload in Chrome or Edge.');this.stop();};
      this.worker.onmessage=e=>{
        if(e.data.type==='ready'){this.ready=true;this.capture(generation);}
        else if(e.data.type==='pose'){const now=performance.now();this.busy=false;this.inferenceMs=e.data.ms;this.latency=now-e.data.timestamp;this.poseFps=this.lastPose?0.8*this.poseFps+0.2*1000/(now-this.lastPose):0;this.lastPose=now;this.onPose(e.data.landmarks,e.data.timestamp);}
        else if(e.data.type==='error'){this.onError(`Pose tracking failed: ${e.data.message}. Run npm run setup and reload.`);this.stop();}
      };
      this.worker.postMessage({type:'init',base:new URL(import.meta.env.BASE_URL,location.href).href});
    }catch(error){this.stop();const name=(error as Error).name;throw new Error(name==='NotAllowedError'?'Camera permission was denied. Allow camera access in the browser address bar, then retry.':name==='NotFoundError'?'No webcam found. Connect a camera, or choose the clearly labeled keyboard test.':name==='NotReadableError'?'Camera is busy. Close other camera apps and retry.':name==='OverconstrainedError'?'Selected camera is unavailable. Choose Default camera in Settings.':(error as Error).message);}
  }
  capture(generation:number){
    if(!this.running||generation!==this.generation)return;
    const now=performance.now();
    if(this.video.readyState>=2&&this.video.currentTime!==this.lastVideoTime){
      this.cameraFps=this.lastFrame?0.85*this.cameraFps+0.15*1000/(now-this.lastFrame):0;this.lastFrame=now;this.lastVideoTime=this.video.currentTime;
      if(!this.busy&&this.ready){this.busy=true;createImageBitmap(this.video).then(bitmap=>{if(this.running&&generation===this.generation&&this.worker)this.worker.postMessage({type:'frame',bitmap,timestamp:now},[bitmap]);else bitmap.close();}).catch(()=>{this.busy=false;this.onError('Cannot read camera frames. Reconnect the camera and recalibrate.');});}
    }
    if('requestVideoFrameCallback' in this.video)this.video.requestVideoFrameCallback(()=>this.capture(generation));else requestAnimationFrame(()=>this.capture(generation));
  }
  stop(){this.generation++;this.running=false;this.ready=false;this.busy=false;this.worker?.terminate();this.worker=null;this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.video.srcObject=null;this.lastFrame=0;this.lastPose=0;this.lastVideoTime=-1;}
}
