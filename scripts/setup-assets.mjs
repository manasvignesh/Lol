import { mkdir, cp, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
await mkdir('public/models',{recursive:true});
await cp('node_modules/@mediapipe/tasks-vision/wasm','public/wasm',{recursive:true});
const path='public/models/pose_landmarker_lite.task';
try { await access(path); console.log('Pose model already present.'); }
catch {
  const url='https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
  console.log('Downloading version 1 of the local pose model…');
  const response=await fetch(url); if(!response.ok)throw new Error(`Model download failed: ${response.status}`);
  const data=Buffer.from(await response.arrayBuffer());
  if(data.length<1000000)throw new Error('Invalid model download');
  await writeFile(path,data); console.log(`Model saved (${data.length} bytes), SHA256 ${createHash('sha256').update(data).digest('hex')}`);
}
console.log('Offline runtime assets ready. Camera frames never leave the browser.');
