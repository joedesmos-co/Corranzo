import { clefForY, midiFromStaffPosition } from '../src/features/omr/pitchFromStaffPosition.js'
import { contentPixelBounds, isInk } from '../src/features/omr/omrInk.js'
const W=260,H=180,INK=24, TREBLE=[44,52,60,68,76], BASS=[108,116,124,132,140]
const tN=TREBLE.map(y=>y/H), bN=BASS.map(y=>y/H)
const sl={treble:tN,bass:bN}
for (const cy of [56,60,48]) {
  const yN=cy/H
  console.log(`cy=${cy} yN=${yN.toFixed(3)} clef=${clefForY(yN,sl)} midi=${midiFromStaffPosition(yN,clefForY(yN,sl)==='bass'?bN:tN,clefForY(yN,sl))}`)
}
// bounds
function blank(){return {data:new Uint8ClampedArray(W*H*4).fill(255),width:W,height:H}}
function px(img,x,y,v=INK){const i=(Math.round(y)*img.width+Math.round(x))*4;img.data[i]=img.data[i+1]=img.data[i+2]=v}
function hLine(img,y,x0,x1){for(let x=x0;x<=x1;x++)px(img,x,y)}
function rect(img,x0,y0,x1,y1){for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)px(img,x,y)}
const img=blank();for(const y of [...TREBLE,...BASS])hLine(img,y,24,236);rect(img,116,53,124,59)
const b=contentPixelBounds(img,{x0:34/W,x1:248/W,y0:34/H,y1:150/H})
console.log('bounds',b)
// staffSpacePx
const ys=tN.map(v=>v*H); console.log('ss px=',(ys[4]-ys[0])/4)
