import { isInk } from '../src/features/omr/omrInk.js'
const W=260,H=180,INK=24, TREBLE=[44,52,60,68,76]
function blank(){return {data:new Uint8ClampedArray(W*H*4).fill(255),width:W,height:H}}
function px(img,x,y,v=INK){const i=(Math.round(y)*img.width+Math.round(x))*4;img.data[i]=img.data[i+1]=img.data[i+2]=v}
function rect(img,x0,y0,x1,y1){for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)px(img,x,y)}
function span(img,cx,cy,win){let mn=1e9,mx=-1e9;for(let dx=-1;dx<=1;dx++){const x=cx+dx;for(let y=cy-win;y<=cy+win;y++){if(y>=0&&y<H&&isInk(img.data,(y*W+x)*4,170)){if(y<mn)mn=y;if(y>mx)mx=y}}}return mx>=mn?mx-mn+1:0}
const ss=(TREBLE[4]-TREBLE[0])/4
const midHalfH=Math.max(2,Math.min(10,Math.round(ss*0.6)))
const minV=Math.max(4,Math.round(ss*0.7))
console.log('ss',ss,'midHalfH',midHalfH,'minVExt',minV)
// filled head at cy=56 (no staff lines drawn here, isolate)
let img=blank();rect(img,116,53,124,59)
console.log('filled head span@56:', span(img,120,56,midHalfH))
// hollow head ring at cy=56 (outline 9x7)
img=blank();for(let x=116;x<=124;x++){px(img,x,53);px(img,x,59)}for(let y=53;y<=59;y++){px(img,116,y);px(img,124,y)}
console.log('hollow head span@56:', span(img,120,56,midHalfH))
// beam 4px at y36-39
img=blank();rect(img,108,36,140,39)
console.log('beam span@37:', span(img,124,37,midHalfH))
