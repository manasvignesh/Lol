/// <reference lib="webworker" />
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
let tracker: PoseLandmarker | null = null;
self.onmessage = async (event: MessageEvent) => {
  const data=event.data;
  try {
    if(data.type==='init') {
      const files=await FilesetResolver.forVisionTasks(data.base+'wasm');
      tracker=await PoseLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:data.base+'models/pose_landmarker_lite.task',delegate:'CPU'},runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:0.5,minPosePresenceConfidence:0.5,minTrackingConfidence:0.5,outputSegmentationMasks:false});
      self.postMessage({type:'ready'});
    } else if(data.type==='frame'&&tracker) {
      const start=performance.now();
      try { const result=tracker.detectForVideo(data.bitmap,data.timestamp); self.postMessage({type:'pose',landmarks:result.landmarks[0]??null,timestamp:data.timestamp,ms:performance.now()-start}); }
      finally {data.bitmap.close();}
    }
  }catch(error){self.postMessage({type:'error',message:error instanceof Error?error.message:String(error)});}
};
