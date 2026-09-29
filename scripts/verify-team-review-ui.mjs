import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
const require = createRequire(import.meta.url)
const root = path.resolve('_verify/team-review-ui')
fs.mkdirSync(root, { recursive: true })
const source = path.resolve('src').replaceAll('\\', '/')
// A real PDF, rendered by the production preview component in isolated Electron.
const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
const stream = 'BT /F1 26 Tf 52 720 Td (Week 8 - Study checklist) Tj 0 -50 Td /F1 15 Tf (Monday: Geometry slope practice) Tj 0 -30 Td (Tuesday: Earth science review) Tj ET'
objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
let pdf = '%PDF-1.4\n', offsets = [0]
objects.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n` })
const xref = pdf.length
pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
fs.writeFileSync(path.join(root, 'index.html'), `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:"><div id="app"></div><script type="module" src="/fixture.ts"></script>`)
fs.writeFileSync(path.join(root, 'fixture.ts'), `
import { createApp, h, ref } from 'vue'; import { createPinia } from 'pinia';
import TeamPanel from '${source}/renderer/src/components/TeamPanel.vue';
import TeamLaunchDialog from '${source}/renderer/src/components/TeamLaunchDialog.vue';
import { useTeamStore } from '${source}/renderer/src/stores/team';
import { teamFixtureRun, teamFixtureTask, teamFixtureIntegration } from '${source}/main/services/teamTestFixtures';
const run = teamFixtureRun(); run.leadSessionId = 'fixture-lead';
const task = teamFixtureTask(); task.command.title = 'Week 8 study checklist'; task.status = 'completed';
const blocked = teamFixtureTask(11); blocked.status = 'blocked'; blocked.command.title = 'Reference materials'; blocked.blocker = 'Cannot read Documents reference folder: external_directory denied.';
const integration = teamFixtureIntegration(); integration.status = 'applied';
const snapshot = { run, tasks: [task, blocked], integrations: [integration], attempts: [], members: [], events: [], lastSequence: 1200, hasMoreEvents: true };
const html = '<style>body{font:18px Arial;padding:35px;color:#203347;background:#f5f1e7}h1{color:#136d56}li{padding:14px}</style><h1>Week 8 at a glance</h1><p>Your study plan for the week.</p><ul><li>Monday · Geometry slope practice</li><li>Tuesday · Earth science review</li></ul><script>parent.__previewEscaped = true;<\\/script>';
window.__decisions = []; window.__launches = []; const showLaunch = ref(false); window.__showLaunch = () => { showLaunch.value = true }; const ok = value => ({ok:true,value});
window.chorus = { attachSession: async () => ({sessionId:run.leadSessionId}), team: { capabilities: async () => ok({options:[{key:'lead',member:run.config.lead,label:'Lead',lead:true,enabled:true,reason:''},{key:'helper',member:run.config.helpers[0],label:'Helper',lead:false,enabled:true,reason:''}],accountScope:'Fixture'}), presetList:async()=>ok([]), list:async()=>ok({runs:[run],unavailable:[]}), launch:async q=>{window.__launches.push(q);snapshot.events=[{operation:'lead-started'}];return ok({runId:run.id})}, onChanged: () => () => {}, snapshot: async () => ({ ok:true, value:snapshot }), review: async () => ({ ok:true, value:{ integration, title: task.command.title, explanation:'A printable weekly checklist with the Geometry and Earth Science study sessions. The lead has applied this output. Review it and request any changes.', tests:[], paths:['Week 8.html','Week 8.pdf','data.json'], diff:'+ Study checklist', truncated:false } }), preview: async q => ({ ok:true, value:{ path:q.path, sha:q.side === 'before' ? integration.expectedHead : integration.resultSha, kind:q.path.endsWith('.pdf') ? 'pdf' : q.path.endsWith('.html') ? 'html' : 'text', content:q.path.endsWith('.pdf') ? '${Buffer.from(pdf).toString('base64')}' : q.path.endsWith('.html') ? html : '{ "days": 5 }', note:q.path.endsWith('.html') ? 'Static layout preview. Scripts and external resources are disabled.' : '' } }), decideIntegration: async q => { window.__decisions.push(q); return {ok:true,value:{}}; } } };
const app = createApp({render:()=>showLaunch.value ? h(TeamLaunchDialog,{projectId:run.projectId,onCancel:()=>{showLaunch.value=false}}) : h('div',[h('h1',{style:'font-size:20px;padding:20px'},'Chorus · Team review'),h(TeamPanel,{sessionId:run.leadSessionId}),h('p',{style:'padding:40px;color:#799184'},'Lead terminal remains available here.')])});const pinia=createPinia();app.use(pinia);const teams=useTeamStore(pinia);teams.runs[run.id]=run;teams.snapshots[run.id]=snapshot;app.mount('#app');
const style=document.createElement('style');style.textContent='*{box-sizing:border-box}body{background:#0b0e12;color:#e4eaf1;font:14px Arial;margin:0}button,input,select{font:inherit;color:inherit}button{background:transparent;cursor:pointer}p{margin:6px 0}';document.head.append(style);
`)
await build({ configFile: false, root, base: './', plugins: [vue()], build: { outDir: 'dist', emptyOutDir: true } })
const runner = path.join(root, 'runner.cjs')
fs.writeFileSync(runner, `
const {app,BrowserWindow}=require('electron');const fs=require('node:fs');const assert=require('node:assert/strict');
app.disableHardwareAcceleration();app.setPath('userData',${JSON.stringify(path.join(root, 'profile'))});
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}}); const errors=[];win.webContents.on('console-message',(_e,d)=>{if(d.level==='error')errors.push(d.message)});await win.loadFile(${JSON.stringify(path.join(root, 'dist/index.html'))});const ev=s=>win.webContents.executeJavaScript(s,true);const wait=async s=>{for(let i=0;i<100;i++){if(await ev(s))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timeout: '+s+' '+errors.join(' | '));};const click=text=>ev('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==='+JSON.stringify(text)+')?.click()');
await wait('document.body.innerText.includes("View outputs (1)")');assert(await ev('document.querySelector(".team-body") === null'));fs.writeFileSync(${JSON.stringify(path.join(root, 'compact.png'))},(await win.capturePage()).toPNG());await click('View outputs (1)');await wait('document.querySelector("iframe") !== null');await new Promise(r=>setTimeout(r,400));assert.equal(await ev('window.__previewEscaped'),undefined);assert(await ev('!Array.from(document.querySelectorAll("button")).some(b=>/Approve|Deny/.test(b.textContent))'));fs.writeFileSync(${JSON.stringify(path.join(root, 'html-review.png'))},(await win.capturePage()).toPNG());
await click('Week 8.pdf');await wait('document.querySelector("canvas")?.width > 0 && !document.body.innerText.includes("Rendering PDF")');assert(!(await ev('document.body.innerText')).includes('PDF preview failed'));fs.writeFileSync(${JSON.stringify(path.join(root, 'pdf-review.png'))},(await win.capturePage()).toPNG());assert.equal(await ev('window.__decisions.length'),0);await click('Done');

await ev('document.querySelector(".team-bar button").click()');assert((await ev('document.body.innerText')).includes('external_directory denied'));win.setSize(650,800);await click('View output');await wait('document.querySelector("dialog[open]") !== null');await new Promise(r=>setTimeout(r,300));assert(await ev('document.querySelector("dialog").scrollWidth <= document.querySelector("dialog").clientWidth + 1'));fs.writeFileSync(${JSON.stringify(path.join(root, 'narrow-review.png'))},(await win.capturePage()).toPNG());await click('Done');await ev('window.__showLaunch()');await wait('document.body.innerText.includes("Launch team")');assert.equal(await ev('document.querySelectorAll("select[aria-label^=Helper]").length'),2);assert.equal(await ev('document.querySelector("input[type=number]").value'),'2');assert(!(await ev('document.body.innerText')).includes('Ask me before'));await click('Launch team');await wait('window.__launches.length === 1');const launched=await ev('window.__launches[0].config');assert.equal(launched.integrationPolicy,'lead-integrates');assert.equal(launched.concurrency,2);assert.equal(launched.helpers.length,2);assert.notEqual(launched.helpers[0].id,launched.helpers[1].id);console.log(JSON.stringify({passed:true,evidence:${JSON.stringify(root)},errors}));app.quit();}).catch(e=>{console.error(e);app.exit(1)});
`)
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
const child = spawn(require('electron'), [runner], { env, windowsHide: true, stdio: 'inherit' })
process.exitCode = await new Promise(resolve => child.on('exit', resolve))
