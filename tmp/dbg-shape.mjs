import { detectNoteheadsInMeasure } from '../src/features/omr/detectOmrNoteheads.js'
const W=260,H=180,INK=24, TREBLE=[44,52,60,68,76], BASS=[108,116,124,132,140]
function blank(){return {data:new Uint8ClampedArray(W*H*4).fill(255),width:W,height:H}}
function px(img,x,y,v=INK){const ix=Math.round(x),iy=Math.round(y);if(ix<0||iy<0||ix>=img.width||iy>=img.height)return;const i=(iy*img.width+ix)*4;img.data[i]=img.data[i+1]=img.data[i+2]=v}
function hLine(img,y,x0,x1){for(let x=x0;x<=x1;x++)px(img,x,y)}
function vLine(img,x,y0,y1){for(let y=y0;y<=y1;y++)px(img,x,y)}
function rect(img,x0,y0,x1,y1){for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)px(img,x,y)}
function head(img,cx,cy){rect(img,cx-4,cy-3,cx+4,cy+3)}
function staff(img){for(const y of [...TREBLE,...BASS])hLine(img,y,24,236)}
function mb(){return {measureNumber:1,page:1,x0:12/W,x1:248/W,playableX0:34/W,y0:34/H,y1:150/H,staffLines:{treble:TREBLE.map(y=>y/H),bass:BASS.map(y=>y/H)}}}
const img=blank();staff(img);head(img,120,56)
console.log('plain head:', JSON.stringify(detectNoteheadsInMeasure(img,mb(),170,{}).map(n=>({cx:n.cx,cy:n.cy,midi:n.midi}))))
// dense option
console.log('plain head dense:', detectNoteheadsInMeasure(img,mb(),170,{dense:true}).length)
