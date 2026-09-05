import { C } from './config';
import { add, sub, mul, len, norm, dot, clamp, mix, v, type V3 } from './math';
export type Landmark = V3 & { visibility?: number };
export type Pose = Landmark[];
export type Calibration = { center: V3; width: number; hand: 'left' | 'right'; range: number; reach: number };
export type Intent = 'clear' | 'drive' | 'drop' | 'smash' | 'lift';
export type SwingState = 'IDLE' | 'PREPARING' | 'SWINGING' | 'FOLLOW_THROUGH' | 'COOLDOWN';
export type Motion = { time: number; confidence: number; playerX: number; racket: V3; velocity: V3; speed: number; power: number; direction: V3; intent: Intent; swing: boolean; swingId: number; state: SwingState; elbowAngle: number; forearm: V3; upperArm: V3; lean: number; vertical: number; shoulderOrientation: number; torsoOrientation: number; reach: number; acceleration: V3; plane: string; phase: 'start' | 'peak' | 'end' | 'none' };
export const neutralMotion = (): Motion => ({ time: 0, confidence: 0, playerX: 0, racket: v(0.5, 1.5, 3.4), velocity: v(), speed: 0, power: 0, direction: v(), intent: 'clear', swing: false, swingId: 0, state: 'IDLE', elbowAngle: 0, forearm: v(), upperArm: v(), lean: 0, vertical: 0, shoulderOrientation: 0, torsoOrientation: 0, reach: 0, acceleration: v(), plane: 'horizontal', phase: 'none' });
export function poseQuality(p: Pose | undefined) {
  if (!p || p.length < 33) return 0;
  return Math.min(...[11, 12, 13, 14, 15, 16, 23, 24].map(i => Number.isFinite(p[i].x + p[i].y + p[i].z) ? p[i].visibility ?? 0 : 0));
}
export const bodyCenter = (p: Pose) => mix(mix(p[11], p[12], 0.5), mix(p[23], p[24], 0.5), 0.5);
export const shoulderWidth = (p: Pose) => Math.max(0.06, Math.hypot(p[11].x - p[12].x, p[11].y - p[12].y));
export class PoseFilter {
  last: Pose | null = null; time = 0;
  reset() { this.last = null; this.time = 0; }
  update(p: Pose, time: number): Pose {
    const dt = clamp((time - this.time) / 1000, 0.008, 0.1); this.time = time;
    if (!this.last) return this.last = p.map(q => ({ ...q }));
    this.last = p.map((q, i) => {
      const previous = this.last![i];
      const speed = len(sub(q, previous)) / dt;
      const alpha = 1 - Math.exp(-dt * (14 + 35 * speed));
      return { ...mix(previous, q, alpha), visibility: q.visibility };
    }); return this.last;
  }
}
export class SwingDetector {
  state: SwingState = 'IDLE'; id = 0; elapsed = 0; peak = 0; phase: Motion['phase'] = 'none';
  reset() { this.state = 'IDLE'; this.elapsed = 0; this.peak = 0; }
  update(speed: number, dt: number, purposeful: boolean) {
    this.elapsed += dt; this.phase = 'none';
    const enter = (s: SwingState) => { this.state = s; this.elapsed = 0; };
    if (this.state === 'IDLE' && speed > C.swingStart && purposeful) enter('PREPARING');
    if (this.state === 'PREPARING') {
      if (speed > C.swingPeak && purposeful) { enter('SWINGING'); this.id++; this.peak = speed; this.phase = 'start'; }
      else if (speed < C.swingEnd || this.elapsed > 0.35) enter('IDLE');
    } else if (this.state === 'SWINGING') {
      if (speed > this.peak) { this.peak = speed; this.phase = 'peak'; }
      if (speed < C.swingEnd || this.elapsed > 0.32) { enter('FOLLOW_THROUGH'); this.phase = 'end'; }
    } else if (this.state === 'FOLLOW_THROUGH' && this.elapsed > 0.12) enter('COOLDOWN');
    else if (this.state === 'COOLDOWN' && this.elapsed > C.cooldown) enter('IDLE');
    return this.state === 'SWINGING' || (this.state === 'FOLLOW_THROUGH' && this.elapsed < 0.075);
  }
}
export function classify(direction: V3, speed: number, wristHeight: number): Intent {
  if (direction.y < -0.35 && wristHeight > 1.7 && speed > 4.5) return 'smash';
  if (direction.y > 0.35 && wristHeight < 1.7) return 'lift';
  if (speed < 4) return 'drop';
  if (wristHeight > 1.9 || direction.y > 0.3) return 'clear';
  return 'drive';
}
export class MotionInterpreter {
  filter = new PoseFilter(); detector = new SwingDetector(); history: Motion[] = []; previousWrist: V3 | null = null; previousVelocity = v(); previousTime = 0;
  calibration: Calibration = { center: v(0.5, 0.55), width: 0.22, hand: 'right', range: 0.15, reach: 1.8 };
  reset() { this.filter.reset(); this.detector.reset(); this.history = []; this.previousWrist = null; this.previousTime = 0; this.previousVelocity = v(); }
  update(raw: Pose, time: number, sensitivity = 1, movement = 1): Motion | null {
    if (poseQuality(raw) < C.confidence) { this.reset(); return null; }
    if (time - this.previousTime > C.staleMs) this.reset();
    const p = this.filter.update(raw, time), c = this.calibration;
    const right = c.hand === 'right', s = p[right ? 12 : 11], e = p[right ? 14 : 13], w = p[right ? 16 : 15];
    const center = bodyCenter(p), width = c.width, dt = clamp((time - this.previousTime) / 1000, 1/120, 0.1);
    // Mirrored display coordinates, shoulder-relative motion rejects torso translation.
    const relative = v(-(w.x - s.x) / width, -(w.y - s.y) / width, 0);
    let velocity = this.previousWrist ? mul(sub(relative, this.previousWrist), 1 / dt) : v();
    velocity = mul(norm(velocity), Math.min(18, len(velocity)));
    const speed = len(velocity) * sensitivity;
    const upper = norm(v(-(e.x-s.x), -(e.y-s.y), 0)), forearm = norm(v(-(w.x-e.x), -(w.y-e.y), 0));
    const elbowAngle = Math.acos(clamp(dot(mul(upper,-1),forearm),-1,1)) * 180/Math.PI;
    const displacement = -(center.x-c.center.x) / Math.max(c.range, width * 0.4);
    const playerX = clamp(displacement * 2.1 * movement, -2.35, 2.35);
    const racket = v(clamp(playerX + relative.x * 0.62 + forearm.x * C.racketLength, -3.4, 3.4), clamp(1.5 + relative.y * 0.65 + forearm.y * C.racketLength, 0.25, 3.5), 3.45 - clamp(Math.abs(relative.x)*0.2,0,0.45));
    const purposeful = len(relative) > 0.45 && elbowAngle > 35;
    const swing = this.detector.update(speed, dt, purposeful);
    const direction = norm(velocity);
    const out: Motion = { time, confidence: poseQuality(raw), playerX, racket, velocity, speed, power: clamp(speed / 10, 0.12, 1), direction, intent: classify(direction, speed, racket.y), swing, swingId: this.detector.id, state: this.detector.state, elbowAngle, forearm, upperArm: upper, lean: (mix(p[11],p[12],0.5).x-mix(p[23],p[24],0.5).x)/width, vertical: (c.center.y-center.y)/width, shoulderOrientation: Math.atan2(p[12].z-p[11].z,p[12].x-p[11].x), torsoOrientation: Math.atan2(center.x-c.center.x,c.center.y-center.y), reach: len(relative), acceleration: mul(sub(velocity,this.previousVelocity),1/dt), plane: Math.abs(direction.y)>0.6?'vertical':'horizontal', phase: this.detector.phase };
    this.previousWrist = relative; this.previousVelocity = velocity; this.previousTime = time; this.history.push(out); if (this.history.length > 18) this.history.shift(); return out;
  }
}
export class CalibrationManager {
  stage = 0; progress = 0; samples: Pose[] = []; held = 0; hand: 'left' | 'right' = 'right'; center = v(); width = 0.2; min = 1; max = 0; reach = 0;
  messages = ['Stand centered. Relax your arms.', 'Raise only your racket hand.', 'Sway a little left, then right.', 'Extend your racket arm comfortably.'];
  update(p: Pose | undefined, dt: number): { message: string; done?: Calibration } {
    if (poseQuality(p) < C.confidence) { this.held = 0; return { message: 'Keep shoulders, elbows, wrists and hips in frame.' }; }
    const pose = p!, width = shoulderWidth(pose);
    if (width > 0.46) { this.held=0; return {message:'Step back a little — leave room for your arms.'}; }
    if (width < 0.10) { this.held=0; return {message:'Move closer or improve the lighting.'}; }
    if ([11,12,15,16].some(i=>pose[i].x<0.03||pose[i].x>0.97||pose[i].y<0.02)) { this.held=0; return {message:'Keep both arms inside the camera frame.'}; }
    if (this.stage===0) { this.samples.push(pose); this.held+=dt; if(this.held>1.5) { this.center=mul(this.samples.reduce((a,q)=>add(a,bodyCenter(q)),v()),1/this.samples.length); this.width=this.samples.reduce((a,q)=>a+shoulderWidth(q),0)/this.samples.length; this.next(); } }
    else if(this.stage===1) { const left=pose[15].y<pose[11].y-0.08, right=pose[16].y<pose[12].y-0.08; if(left!==right) { const hand=left?'left':'right'; if(this.hand!==hand)this.held=0; this.hand=hand; this.held+=dt; if(this.held>0.9)this.next(); }else this.held=0; }
    else if(this.stage===2) { const x=bodyCenter(pose).x; this.min=Math.min(this.min,x); this.max=Math.max(this.max,x); this.held+=dt; if(this.held>3 && this.max-this.min>this.width*0.3)this.next(); }
    else if(this.stage===3) { const s=pose[this.hand==='right'?12:11],w=pose[this.hand==='right'?16:15]; this.reach=Math.max(this.reach,len(sub(s,w))/this.width); if(this.reach>1.15)this.held+=dt; if(this.held>1) return {message:'Ready to rally.', done:{ center:this.center,width:this.width,hand:this.hand,range:Math.max(this.width*0.4,(this.max-this.min)/2),reach:this.reach }}; }
    this.progress=(this.stage+Math.min(this.held/2,0.95))/4;
    return {message:this.messages[this.stage]};
  }
  next(){this.stage++;this.held=0;}
}
