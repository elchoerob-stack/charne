const path=require('path');
const {chromium}=require('playwright');(async()=>{
// Agent Studio check: an agent's full workflow (details, listings with photos, clients, all three books, backup).
// Run after build.py:  node src/check_studio.js   (exit code 1 = do not send)
const P=path.join(__dirname,'photos')+'/';const shots=path.join(__dirname,'..','.pdf-work','device-check');require('fs').mkdirSync(shots,{recursive:true});
const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1366,height:820},acceptDownloads:true});
const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('dialog',d=>d.accept());
await p.goto('file://'+encodeURI(path.join(__dirname,'..','.pdf-work','RB Brand Agent Studio','studio.html')));
await p.waitForSelector('#addListing');
// my details
await p.click('nav [data-tab=settings]');
for(const [k,v] of Object.entries({name:'Thandi Mokoena',title:'Property Practitioner',phone:'083 123 4567',email:'thandi@rbbrand.co.za',ffc:'2026123456'})) await p.fill(`[data-p=${k}]`,v);
await p.click('#saveProfile');
// listings
await p.click('nav [data-tab=listings]');
async function listing(f,photos){await p.click('#addListing');for(const [k,v] of Object.entries(f)){const el=await p.$(`#dlg [data-k=${k}]`);if((await el.evaluate(e=>e.tagName))==='SELECT')await el.selectOption(v);else await el.fill(v);}
 if(photos){const [fc]=await Promise.all([p.waitForEvent('filechooser'),p.click('#dlg [data-addphoto]')]);await fc.setFiles(photos.map(x=>P+x+'.jpg'));await p.waitForSelector(`#dlg .photos figure:nth-child(${photos.length})`);}
 await p.click('#dlg [data-save]');await p.waitForTimeout(150);}
await listing({address:'12 Jacaranda Street',suburb:'Faerie Glen',price:'3 450 000',beds:'4',baths:'3',garages:'2',floor:'320',features:'heated pool, solar power'},['white','int1']);
await listing({address:'7 Kiaat Avenue',suburb:'Faerie Glen',status:'sold',price:'3 300 000',soldPrice:'3 250 000',soldDate:'2026-09-14',days:'28',beds:'4',floor:'300'},['dusk']);
await listing({address:'3 Olienhout Close',suburb:'Faerie Glen',status:'sold',price:'3 600 000',soldPrice:'3 520 000',soldDate:'2026-08-02',days:'41',beds:'4',floor:'340'},['garden']);
await listing({address:'21 Bloekom Road',suburb:'Moreleta Park',status:'sold',price:'2 900 000',soldPrice:'2 880 000',soldDate:'2026-10-01',days:'19',beds:'3',floor:'260'},['classic']);
await listing({address:'5 Wilger Lane',suburb:'Silver Lakes',price:'4 950 000',beds:'5',baths:'4'},['hero']);
await p.screenshot({path:shots+'/st-listings.png'});
// clients
await p.click('nav [data-tab=clients]');
async function client(f,pick){await p.click('#addClient');for(const [k,v] of Object.entries(f)){const el=await p.$(`#dlg [data-k=${k}]`);if((await el.evaluate(e=>e.tagName))==='SELECT')await el.selectOption(v);else await el.fill(v);}
 for(const t of pick) await p.click(`#dlg .pick label:has-text("${t}") input`);
 await p.click('#dlg [data-save]');await p.waitForTimeout(150);}
await client({name:'Mnr & Mev Botha',type:'seller',lang:'af'},['12 Jacaranda Street']);
await client({name:'Lerato Dlamini',type:'buyer'},['12 Jacaranda Street','5 Wilger Lane']);
await client({name:'The Naidoo Family',type:'owner',regDate:'2026-11-20'},['21 Bloekom Road']);
await p.screenshot({path:shots+'/st-clients.png'});
const frame=()=>p.frames().find(f=>f!==p.mainFrame());
async function open(name,book){await p.click(`tr:has-text("${name}") [data-book=${book}]`);await p.waitForTimeout(300);const f=frame();await f.waitForSelector('#quietOpen');await f.click('#quietOpen');return f;}
// seller (Afrikaans) listing presentation
let f=await open('Botha','listing-presentation');
const seller=await f.evaluate(()=>{const t=s=>document.querySelector(s)?.textContent.trim();const img=s=>/url\(['"]?data:image/.test(document.querySelector(s)?.style.getPropertyValue('--img')||'');
 return {lang:document.documentElement.lang,title:document.title,who:t('.j-cover .who'),addr:t('.j-cover .addr2'),date:t('.j-cover .cv-meta span'),dear:t('.j-letter h2 em'),sig:t('.j-letter .sigline'),area:t('.j-area h2'),price:t('.j-value .price strong'),
 mock:t('.j-mkt .lst span'),social:t('.j-mkt .so-cap'),comps:[...document.querySelectorAll('.j-value .comps tbody tr')].map(r=>r.textContent.trim().replace(/\s+/g,' ')),
 sold:[...document.querySelectorAll('.j-proof .sc h4')].map(e=>e.textContent),coverPhoto:img('[data-key=home]'),mirror:img('[data-mirror=home]'),wa:document.querySelector('a[data-link=wa]').href,creds:t('.creds'),calc:document.querySelector('#netCalc [data-k=price]').value,net:t('[data-out=net]'),team:t('.j-team .tm b'),leftover:[...document.querySelectorAll('.j-cover .who,.j-cover .addr2,.j-letter h2,.j-area h2,.j-value .price strong')].filter(e=>/\[/.test(e.textContent)).length}});
await p.screenshot({path:shots+'/st-book.png'});
// edit persists per client
await f.click('#editBtn');await f.$eval('.j-cover .who',e=>{e.textContent='Mnr & Mev J Botha';e.dispatchEvent(new Event('input',{bubbles:true}))});await f.click('#editBtn');await p.waitForTimeout(600);
await f.click('a.back');await p.waitForTimeout(200);
p.removeAllListeners('dialog');p.once('dialog',d=>d.accept());   // keep my edits
f=await open('Botha','listing-presentation');const kept=await f.$eval('.j-cover .who',e=>e.textContent);await f.click('a.back');p.on('dialog',d=>d.accept());
// buyer guide
f=await open('Lerato','buyer-guide');
const buyer=await f.evaluate(()=>({who:document.querySelector('.j-cover .who').textContent,cards:[...document.querySelectorAll('.j-listings .sc')].map(s=>s.querySelector('h4').textContent+' | '+s.querySelector('.pr b').textContent+' | '+(/data:image/.test(s.querySelector('.ph').style.getPropertyValue('--img'))?'photo':'no photo'))}));
await f.click('a.back');
// moving pack
f=await open('Naidoo','moving-day-pack');
const owner=await f.evaluate(()=>({who:document.querySelector('.j-cover .who').textContent,meta:document.querySelector('.j-cover .cv-meta span').textContent,hand:document.querySelector('.j-hand .hd-in > p').textContent,kick:document.querySelector('.j-hand .hd-head .kick').textContent,photo:/data:image/.test(document.querySelector('[data-key=home]').style.getPropertyValue('--img')),sig:document.querySelector('.sig').textContent.replace(/\s+/g,' ')}));
await f.click('a.back');
// backup + restore count
await p.click('nav [data-tab=settings]');const [dl]=await Promise.all([p.waitForEvent('download'),p.click('#backup')]);const bk=JSON.parse(require('fs').readFileSync(await dl.path(),'utf8'));
await p.reload();await p.waitForSelector('nav');await p.click('nav [data-tab=listings]');const afterReload=await p.$$eval('.card[data-id]',c=>c.length);
const bad=[];const want=(ok,msg)=>ok||bad.push(msg);
want(seller.lang==='af'&&seller.who==='Mnr & Mev Botha','seller book: wrong language or name');
want(seller.addr==='12 Jacaranda Street, Faerie Glen','seller book: address not filled');
want(seller.dear==='Mnr & Mev Botha','seller book: letter greeting wrong');
want(seller.price==='R 3 450 000'&&seller.calc==='3 450 000','seller book: price not filled');
want(seller.comps.length===3&&!seller.comps.join().includes('NaN')&&seller.comps[0].includes('Faerie Glen'),'seller book: comparable sales wrong');
want(seller.coverPhoto&&seller.mirror,'seller book: house photo missing');
want(seller.sig==='Thandi Mokoena'&&seller.team==='Thandi Mokoena'&&seller.wa.endsWith('27831234567'),'seller book: agent details missing');
want(!seller.leftover,'seller book: placeholders left on the cover or key pages');
want(kept==='Mnr & Mev J Botha','edits were not kept for the client');
want(buyer.cards.length===2&&buyer.cards.every(c=>c.endsWith('photo')&&!c.includes('[')),'buyer guide: homes not filled');
want(owner.photo&&owner.hand.includes('21 Bloekom Road')&&owner.meta.includes('20 November 2026'),'moving day pack: not filled');
want(bk.listings.length===5&&bk.clients.length===3&&bk.profile.name==='Thandi Mokoena','backup incomplete');
want(afterReload===5,'listings not kept after closing the window');
errs.forEach(e=>bad.push('script error: '+e));
console.log((bad.length?'✗':'✓')+' Agent Studio: listings, clients, all three books, edits and backup'+bad.map(x=>'\n    - '+x).join(''));
await b.close();process.exit(bad.length?1:0)})()
