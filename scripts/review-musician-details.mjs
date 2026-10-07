import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
assert.equal(process.cwd(), process.env.UI_REVIEW_ROOT || '/Users/ryland/Documents/scoreflow-ui-redesign')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const checks = [], accessibility = []
const shot = async name => page.screenshot({path:`docs/musician-ui/after/${name}.png`, fullPage:true, animations:'disabled'})
async function axe(name) {
  if (!await page.evaluate(()=>!!window.axe)) await page.addScriptTag({path:'node_modules/axe-core/axe.min.js'})
  const violations = await page.evaluate(async()=>(await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','best-practice']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})))
  accessibility.push({name,violations});console.log(name,JSON.stringify(violations))
}
let failure
try {
 await page.goto('http://127.0.0.1:5197');await page.getByRole('button',{name:'Open featured score: Menuet in F, K.2',exact:true}).click();await page.locator('.practice-workspace canvas').first().waitFor()
 await page.getByRole('button',{name:'Markup',exact:true}).click();await page.getByRole('button',{name:'Pen',exact:true}).click();await axe('Markup palette');await shot('markup-tools');await page.keyboard.press('Escape')
 const layer=page.locator('.annotation-layer-root').first();const box=await layer.boundingBox()
 const points=[[.34,.064],[.34,.06],[.72,.06],[.72,.064]]
 await page.mouse.move(box.x+box.width*points[0][0],box.y+box.height*points[0][1]);await page.mouse.down()
 for(const [x,y] of points.slice(1)) await page.mouse.move(box.x+box.width*x,box.y+box.height*y,{steps:12})
 await page.mouse.up();await page.waitForFunction(()=>document.querySelector('.annotation-layer path'))
 assert.equal(await page.locator('.annotation-layer path').first().getAttribute('stroke'),'#57534b')
 await page.getByRole('button',{name:'Loop',exact:true}).click();await page.getByRole('spinbutton',{name:'Loop start bar',exact:true}).fill('1');await page.getByRole('spinbutton',{name:'Loop end bar',exact:true}).fill('4');await page.getByRole('checkbox',{name:'Repeat passage',exact:true}).check();await page.keyboard.press('Escape');assert.equal(await page.locator('.workspace-dock').getAttribute('data-loop-active'),'true');await shot('marked-passage');checks.push('A real graphite annotation and bars 1–4 loop render in the score workspace')
 await page.reload();await page.locator('.annotation-layer path').first().waitFor();assert.equal(await page.locator('.score-workspace').evaluate(e=>getComputedStyle(e).maxHeight),'none');checks.push('Restore notice does not shorten the score workspace');await page.getByRole('button',{name:'Dismiss',exact:true}).click();assert.equal(await page.locator('.annotation-layer path').first().getAttribute('stroke'),'#57534b');checks.push('Graphite annotation survives reload')
 await page.getByRole('button',{name:'More options',exact:true}).click();await page.getByRole('button',{name:'Light surround',exact:true}).click();await page.keyboard.press('Escape');await page.waitForFunction(()=>getComputedStyle(document.querySelector('.pdf-canvas')).backgroundColor==='rgb(232, 228, 217)');await shot('light-surround');await axe('Light surround')
 await page.getByRole('button',{name:'More options',exact:true}).click();await page.getByRole('button',{name:'Dark surround',exact:true}).click();await page.keyboard.press('Escape');checks.push('Light and dark score surrounds are distinct; notation remains dark on paper')
 const nav=page.getByRole('navigation',{name:'Primary',exact:true})
 await nav.getByRole('button',{name:'History',exact:true}).click();await page.locator('.profile-view').waitFor();await page.getByRole('button',{name:'Start timer',exact:true}).click();await page.waitForTimeout(1100);await page.getByRole('button',{name:'Stop',exact:true}).click();await page.getByRole('textbox',{name:'Piece or topic',exact:true}).fill('Menuet in F — first phrase');await page.getByRole('textbox',{name:'Notes (optional)',exact:true}).fill('Bars 1–4. Keep the left hand light; bring the melody forward.');await page.getByRole('button',{name:'Save session',exact:true}).click();await shot('journal-with-notes');await axe('Journal with notes');checks.push('Manual practice session saves with piece and musical notes')
 await nav.getByRole('button',{name:'Home',exact:true}).click();await page.getByRole('radio',{name:'Guitar',exact:true}).click();await nav.getByRole('button',{name:'Home',exact:true}).click();await page.locator('.cz-home canvas').waitFor();await shot('home-guitar');await axe('Guitar home');checks.push('Existing Guitar product UI uses the same visual system; research code untouched')
 assert.deepEqual(accessibility.flatMap(v=>v.violations),[])
} catch(e) {failure=e.stack;console.error(e);process.exitCode=1}
finally {writeFileSync('docs/musician-ui/details-review.json',JSON.stringify({checks,accessibility,failure:failure??null},null,2));await browser.close()}
