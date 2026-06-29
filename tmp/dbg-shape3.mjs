import { detectNoteheadsInMeasure } from '../src/features/omr/detectOmrNoteheads.js'
import { isInk } from '../src/features/omr/omrInk.js'
const W=260,H=180,INK=24, TREBLE=[44,52,60,68,76], BASS=[108,116,124,132,140]
function blank(){return {data:new Uint8ClampedArray(W*H*4).fill(255),width:W,height:H}}
function px(img,x,y,v=INK){const i=(Math.round(y)*img.width+Math.round(x))*4;img.data[i]=img.data[i+1]=img.data[i+2]=v}
function hLine(img,y,x0,x1){for(let x=x0;x<=x1;x++)px(img,x,y)}
function vLine(img,x,y0,y1){for(let y=y0;y<=y1;y++)px(img,x,y)}
function rect(img,x0,y0,x1,y1){for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)px(img,x,y)}
function staff(img){for(const y of [...TREBLE,...BASS])hLine(img,y,24,236)}
function mb(){return {measureNumber:1,page:1,x0:12/W,x1:248/W,playableX0:34/W,y0:34/H,y1:150/H,staffLines:{treble:TREBLE.map(y=>y/H),bass:BASS.map(y=>y/H),splitY:((TREBLE[4]+BASS[0])/2)/H}}}
// vertical ink extent through a column at the detected center
function vext(img,cx,cy){let a=cy,b=cy;const ink=(y)=>y>=0&&y<H&&isInk(img.data,(y*W+cx)*4,170);if(!ink(cy)){for(let d=1;d<=6;d++){if(ink(cy-d)){cy-=d;break}if(ink(cy+d)){cy+=d;break}}}a=b=cy;while(a-1>=0&&ink(a-1))a--;while(b+1<H&&ink(b+1))b++;return b-a+1}
let img=blank();staff(img);rect(img,110,54,140,57)
console.log('beam frag ->', detectNoteheadsInMeasure(img,mb(),170,{}).map(n=>({cx:n.cx,cy:n.cy,vext:vext(img,n.cx,n.cy)})))
img=blank();staff(img);vLine(img,120,40,78);vLine(img,121,40,78)
console.log('bare stem ->', detectNoteheadsInMeasure(img,mb(),170,{}).map(n=>({cx:n.cx,cy:n.cy,vext:vext(img,n.cx,n.cy)})))
img=blank();staff(img);rect(img,116,53,124,59)
console.log('plain head ->', detectNoteheadsInMeasure(img,mb(),170,{}).map(n=>({cx:n.cx,cy:n.cy,vext:vext(img,n.cx,n.cy)})))
