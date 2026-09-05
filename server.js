import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USE_MEMORY_STORAGE = process.env.VERCEL === '1';
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');
const LIBRARY_FILE = path.join(DATA_DIR, 'library.json');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const SCHEDULES_FILE = path.join(DATA_DIR, 'schedules.json');
if (!USE_MEMORY_STORAGE) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
  if (!fs.existsSync(CHATS_FILE)) fs.writeFileSync(CHATS_FILE, '[]');
  if (!fs.existsSync(LIBRARY_FILE)) fs.writeFileSync(LIBRARY_FILE, '[]');
  if (!fs.existsSync(PROJECTS_FILE)) fs.writeFileSync(PROJECTS_FILE, '[]');
  if (!fs.existsSync(SCHEDULES_FILE)) fs.writeFileSync(SCHEDULES_FILE, '[]');
}
function readJson(file, fallback){ try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch { return fallback; }}
// Vercel's runtime filesystem is not a durable writable database. For the
// demo deployment we keep mutable app data in the function instance memory.
// Local development continues to use the JSON files under /data.
const memoryStore = globalThis.__SINTAS_MEMORY_STORE || (globalThis.__SINTAS_MEMORY_STORE={users:null,chats:null,library:null,projects:null,schedules:null});
function loadCollection(key,file){
  if(USE_MEMORY_STORAGE){
    if(memoryStore[key]===null) memoryStore[key]=readJson(file,[]);
    return memoryStore[key];
  }
  return readJson(file,[]);
}
function saveCollection(key,file,value){
  if(USE_MEMORY_STORAGE){ memoryStore[key]=value; return; }
  fs.writeFileSync(file, JSON.stringify(value,null,2));
}
function loadUsers(){ return loadCollection('users',USERS_FILE); }
function saveUsers(users){ saveCollection('users',USERS_FILE,users); }
function loadChats(){ return loadCollection('chats',CHATS_FILE); }
function saveChats(chats){ saveCollection('chats',CHATS_FILE,chats); }
function loadLibrary(){ return loadCollection('library',LIBRARY_FILE); }
function saveLibrary(items){ saveCollection('library',LIBRARY_FILE,items); }
function loadProjects(){ return loadCollection('projects',PROJECTS_FILE); }
function saveProjects(items){ saveCollection('projects',PROJECTS_FILE,items); }
function loadSchedules(){ return loadCollection('schedules',SCHEDULES_FILE); }
function saveSchedules(items){ saveCollection('schedules',SCHEDULES_FILE,items); }
function getUserById(id){ return loadUsers().find(u=>u.id===id); }
function ensureUsage(user){
  const today = new Date().toISOString().slice(0,10);
  if(user.usageDate !== today){ user.usageDate=today; user.dailyChats=0; }
  if(typeof user.dailyChats !== 'number') user.dailyChats=0;
  if(!user.plan) user.plan='free';
}
function saveUser(user){ const users=loadUsers(); const i=users.findIndex(u=>u.id===user.id); if(i>=0){users[i]=user;saveUsers(users);} }
function safeUser(user){ ensureUsage(user); return {loggedIn:true,username:user.username,plan:user.plan,dailyChats:user.dailyChats,dailyLimit:user.plan==='pro'?null:FREE_DAILY_LIMIT}; }
function loadEnvFile(){
  const file=path.join(__dirname,'.env');
  if(!fs.existsSync(file)) return;
  for(const raw of fs.readFileSync(file,'utf8').split(/\r?\n/)){
    const line=raw.trim(); if(!line || line.startsWith('#')) continue;
    const i=line.indexOf('='); if(i<1) continue;
    const key=line.slice(0,i).trim(); let value=line.slice(i+1).trim();
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'"))) value=value.slice(1,-1);
    if(process.env[key]===undefined) process.env[key]=value;
  }
}
loadEnvFile();

const FREE_DAILY_LIMIT=20;
const PRO_PRICE_IDR=25000;
const PRO_PRICE_USD=1.50;
const AI_API_KEY=process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '';
const AI_BASE_URL=(process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://co.agentrouter.org/v1').replace(/\/$/,'');
const ANTHROPIC_BASE_URL=(process.env.ANTHROPIC_BASE_URL || 'https://co.agentrouter.org').replace(/\/$/,'');
// The names shown in the UI are friendly labels. The actual model IDs are configurable
// because a gateway/provider may use different IDs for Claude and DeepSeek models.
const AI_MODELS={
  'claude-opus-4-8': process.env.CLAUDE_OPUS_4_8_MODEL || 'claude-opus-4-8',
  'claude-opus-5': process.env.CLAUDE_OPUS_5_MODEL || 'claude-opus-5',
  'deepseek-v4-flash': process.env.DEEPSEEK_V4_FLASH_MODEL || 'deepseek-v4-flash'
};
const OPENAI_API_KEY=AI_API_KEY;
const OPENAI_BASE_URL=AI_BASE_URL;
const OPENAI_MODEL=AI_MODELS['claude-opus-4-8'];
// AgentRouter uses the same API key for its compatible endpoints.
// Claude uses Anthropic Messages; DeepSeek uses OpenAI-compatible Chat Completions.
const ANTHROPIC_API_KEY=process.env.ANTHROPIC_API_KEY || AI_API_KEY;
const DEEPSEEK_API_KEY=process.env.DEEPSEEK_API_KEY || AI_API_KEY;
const PAYMENT_DANA=process.env.PAYMENT_DANA || '083874907101';
const PAYMENT_OVO=process.env.PAYMENT_OVO || '083874907101';
const PAYMENT_GOPAY=process.env.PAYMENT_GOPAY || '083874907101';
const ADMIN_KEY=process.env.ADMIN_KEY || '';
const SESSION_SECRET=process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const app=express();
app.set('trust proxy', 1);
// Vercel can run this Express app as a Node function. Locally we still
// start a normal HTTP server.

// Allow the optional local preview (for example localhost:7700) to use the
// Node backend on localhost:3000. Production can stay same-origin.
app.use((req,res,next)=>{
  const origin=req.get('origin');
  if(origin && /^https?:\/\/localhost(?::\d+)?$/.test(origin)){
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials','true');
    res.setHeader('Access-Control-Allow-Headers','Content-Type');
    res.setHeader('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS');
  }
  if(req.method==='OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({limit:'25mb'}));
app.use(session({
  secret:SESSION_SECRET,resave:false,saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:'lax',secure:process.env.VERCEL==='1',maxAge:1000*60*60*24*30}
}));
function requireAuth(req,res,next){ if(req.session?.userId)return next(); res.status(401).json({error:'Sesi login tidak ditemukan. Silakan masuk lagi.'}); }

app.get('/api/health',(req,res)=>res.json({ok:true,service:'Sintas AI',apiConfigured:Boolean(AI_API_KEY),baseUrl:AI_BASE_URL,anthropicBaseUrl:ANTHROPIC_BASE_URL,models:Object.keys(AI_MODELS)}));
app.post('/api/auth/register',(req,res)=>{
  const username=String(req.body?.username||'').trim(); const password=String(req.body?.password||'');
  if(!/^[\p{L}\p{N}_.-]{3,40}$/u.test(username)) return res.status(400).json({error:'Nama pengguna 3–40 karakter. Gunakan huruf, angka, titik, garis bawah, atau strip.'});
  if(password.length<6) return res.status(400).json({error:'Kata sandi minimal 6 karakter.'});
  const users=loadUsers();
  if(users.some(u=>u.username.toLowerCase()===username.toLowerCase())) return res.status(409).json({error:'Nama pengguna sudah dipakai.'});
  const user={id:crypto.randomUUID(),username,passwordHash:bcrypt.hashSync(password,10),plan:'free',dailyChats:0,usageDate:new Date().toISOString().slice(0,10),paymentRequests:[],createdAt:new Date().toISOString()};
  users.push(user); saveUsers(users);
  req.session.regenerate(err=>{ if(err)return res.status(500).json({error:'Akun berhasil dibuat, tetapi sesi gagal dibuat. Silakan masuk lagi.'}); req.session.userId=user.id; req.session.username=user.username; res.json({ok:true,user:safeUser(user)}); });
});
app.post('/api/auth/login',(req,res)=>{
  const username=String(req.body?.username||'').trim(); const password=String(req.body?.password||'');
  if(!username || !password) return res.status(400).json({error:'Nama pengguna dan kata sandi wajib diisi.'});
  const user=loadUsers().find(u=>u.username.toLowerCase()===username.toLowerCase());
  if(!user || !user.passwordHash || !bcrypt.compareSync(password,user.passwordHash)) return res.status(401).json({error:'Nama pengguna atau kata sandi salah.'});
  ensureUsage(user); saveUser(user);
  req.session.regenerate(err=>{ if(err)return res.status(500).json({error:'Gagal membuat sesi login. Silakan coba lagi.'}); req.session.userId=user.id; req.session.username=user.username; req.session.save(saveErr=>{ if(saveErr)return res.status(500).json({error:'Sesi login gagal disimpan. Silakan coba lagi.'}); res.json({ok:true,user:safeUser(user)}); }); });
});
app.post('/api/auth/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/auth/me',(req,res)=>{ if(!req.session?.userId)return res.json({loggedIn:false}); const user=getUserById(req.session.userId); if(!user){req.session.destroy(()=>{});return res.json({loggedIn:false});} ensureUsage(user); saveUser(user); res.json(safeUser(user)); });

app.get('/api/chats',requireAuth,(req,res)=>{
  const chats=loadChats().filter(c=>c.userId===req.session.userId).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
  res.json({chats:chats.map(c=>({id:c.id,title:c.title,updatedAt:c.updatedAt,messageCount:c.messages?.length||0}))});
});
app.get('/api/chats/:id',requireAuth,(req,res)=>{
  const chat=loadChats().find(c=>c.id===req.params.id && c.userId===req.session.userId);
  if(!chat)return res.status(404).json({error:'Riwayat chat tidak ditemukan.'});
  res.json({chat});
});
app.post('/api/chats',requireAuth,(req,res)=>{
  const id=String(req.body?.id||'').trim(); const messages=Array.isArray(req.body?.messages)?req.body.messages:[];
  if(!messages.length)return res.status(400).json({error:'Belum ada pesan untuk disimpan.'});
  const firstUser=messages.find(m=>m.role==='user');
  const title=String(req.body?.title||firstUser?.content||'Obrolan baru').replace(/\s+/g,' ').trim().slice(0,70)||'Obrolan baru';
  const chats=loadChats();
  let chat=id?chats.find(c=>c.id===id && c.userId===req.session.userId):null;
  if(!chat){ chat={id:id||crypto.randomUUID(),userId:req.session.userId,title,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),messages:[]}; chats.push(chat); }
  chat.title=chat.title||title; chat.messages=messages.map(m=>({role:m.role,content:String(m.content||'')})); chat.updatedAt=new Date().toISOString();
  saveChats(chats); res.json({ok:true,chat:{id:chat.id,title:chat.title,updatedAt:chat.updatedAt,messageCount:chat.messages.length}});
});
app.delete('/api/chats/:id',requireAuth,(req,res)=>{const chats=loadChats();const i=chats.findIndex(c=>c.id===req.params.id&&c.userId===req.session.userId);if(i<0)return res.status(404).json({error:'Riwayat chat tidak ditemukan.'});chats.splice(i,1);saveChats(chats);res.json({ok:true});});

// Library: files/images saved per user so the sidebar item is functional.
app.get('/api/library',requireAuth,(req,res)=>{
  const items=loadLibrary().filter(x=>x.userId===req.session.userId).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  res.json({items:items.map(({userId,...x})=>x)});
});
app.post('/api/library',requireAuth,(req,res)=>{
  const name=String(req.body?.name||'').trim().slice(0,120);
  const mime=String(req.body?.mime||'application/octet-stream').slice(0,100);
  const data=String(req.body?.data||'');
  if(!name||!data)return res.status(400).json({error:'File tidak lengkap.'});
  if(data.length>12_000_000)return res.status(413).json({error:'File terlalu besar untuk pustaka demo (maksimal sekitar 9 MB).'});
  const items=loadLibrary(); const item={id:crypto.randomUUID(),userId:req.session.userId,name,mime,data,createdAt:new Date().toISOString()}; items.push(item); saveLibrary(items); const {userId,...safe}=item; res.json({ok:true,item:safe});
});
app.delete('/api/library/:id',requireAuth,(req,res)=>{const items=loadLibrary();const i=items.findIndex(x=>x.id===req.params.id&&x.userId===req.session.userId);if(i<0)return res.status(404).json({error:'File tidak ditemukan.'});items.splice(i,1);saveLibrary(items);res.json({ok:true});});

// Projects: lightweight chat grouping, persisted per account.
app.get('/api/projects',requireAuth,(req,res)=>res.json({projects:loadProjects().filter(x=>x.userId===req.session.userId).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt)).map(({userId,...x})=>x)}));
app.post('/api/projects',requireAuth,(req,res)=>{const name=String(req.body?.name||'').trim().slice(0,60);if(!name)return res.status(400).json({error:'Nama proyek wajib diisi.'});const items=loadProjects();const project={id:crypto.randomUUID(),userId:req.session.userId,name,chatIds:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};items.push(project);saveProjects(items);const {userId,...safe}=project;res.json({ok:true,project:safe});});
app.post('/api/projects/:id/chats',requireAuth,(req,res)=>{const items=loadProjects();const p=items.find(x=>x.id===req.params.id&&x.userId===req.session.userId);if(!p)return res.status(404).json({error:'Proyek tidak ditemukan.'});const chatId=String(req.body?.chatId||'');if(!chatId)return res.status(400).json({error:'Chat tidak valid.'});if(!p.chatIds.includes(chatId))p.chatIds.push(chatId);p.updatedAt=new Date().toISOString();saveProjects(items);res.json({ok:true});});
app.delete('/api/projects/:id',requireAuth,(req,res)=>{const items=loadProjects();const i=items.findIndex(x=>x.id===req.params.id&&x.userId===req.session.userId);if(i<0)return res.status(404).json({error:'Proyek tidak ditemukan.'});items.splice(i,1);saveProjects(items);res.json({ok:true});});

// Scheduled prompts: stored and surfaced in the UI. A small server loop marks due items.
app.get('/api/schedules',requireAuth,(req,res)=>res.json({items:loadSchedules().filter(x=>x.userId===req.session.userId).sort((a,b)=>new Date(a.runAt)-new Date(b.runAt)).map(({userId,...x})=>x)}));
app.post('/api/schedules',requireAuth,(req,res)=>{const prompt=String(req.body?.prompt||'').trim().slice(0,500);const runAt=new Date(req.body?.runAt||'');if(!prompt||Number.isNaN(runAt.getTime()))return res.status(400).json({error:'Isi tugas dan waktu yang valid.'});if(runAt.getTime()<Date.now())return res.status(400).json({error:'Waktu jadwal harus di masa depan.'});const items=loadSchedules();const item={id:crypto.randomUUID(),userId:req.session.userId,prompt,runAt:runAt.toISOString(),status:'scheduled',createdAt:new Date().toISOString()};items.push(item);saveSchedules(items);const {userId,...safe}=item;res.json({ok:true,item:safe});});
app.delete('/api/schedules/:id',requireAuth,(req,res)=>{const items=loadSchedules();const i=items.findIndex(x=>x.id===req.params.id&&x.userId===req.session.userId);if(i<0)return res.status(404).json({error:'Jadwal tidak ditemukan.'});items.splice(i,1);saveSchedules(items);res.json({ok:true});});

// Built-in plugin actions that do not expose server secrets.
app.post('/api/tools/calculate',requireAuth,(req,res)=>{const expr=String(req.body?.expression||'').trim();if(!expr||expr.length>120||!/^[0-9+\-*/().%\s]+$/.test(expr))return res.status(400).json({error:'Ekspresi kalkulator tidak valid.'});try{const value=Function('"use strict"; return ('+expr+')')();if(!Number.isFinite(value))throw new Error();res.json({ok:true,result:value});}catch{res.status(400).json({error:'Tidak dapat menghitung ekspresi tersebut.'});}});


app.get('/api/pricing',(req,res)=>res.json({free:{dailyLimit:FREE_DAILY_LIMIT,reset:'daily'},pro:{priceIdr:PRO_PRICE_IDR,priceUsd:PRO_PRICE_USD,unlimited:true},payments:{dana:PAYMENT_DANA,ovo:PAYMENT_OVO,gopay:PAYMENT_GOPAY}}));
app.post('/api/payment/request',requireAuth,(req,res)=>{
  const method=String(req.body?.method||''); const reference=String(req.body?.reference||'').trim();
  if(!['dana','ovo','gopay'].includes(method)||reference.length<3)return res.status(400).json({error:'Pilih metode pembayaran dan isi ID/referensi transaksi.'});
  const user=getUserById(req.session.userId); if(!user)return res.status(401).json({error:'Akun tidak ditemukan.'}); ensureUsage(user);
  if(user.plan==='pro')return res.json({ok:true,message:'Akun ini sudah Pro.'});
  user.paymentRequests=Array.isArray(user.paymentRequests)?user.paymentRequests:[];
  user.paymentRequests.push({id:crypto.randomUUID(),method,reference:reference.slice(0,100),amountIdr:PRO_PRICE_IDR,status:'pending',createdAt:new Date().toISOString()}); saveUser(user);
  res.json({ok:true,message:'Permintaan pembayaran diterima. Pro akan aktif setelah pembayaran diverifikasi admin.'});
});
app.post('/api/admin/approve-pro',(req,res)=>{
  if(!ADMIN_KEY || req.get('x-admin-key')!==ADMIN_KEY)return res.status(403).json({error:'Admin key tidak valid.'});
  const username=String(req.body?.username||'').trim(); const paymentId=req.body?.paymentId; const users=loadUsers(); const user=users.find(u=>u.username.toLowerCase()===username.toLowerCase());
  if(!user)return res.status(404).json({error:'User tidak ditemukan.'}); user.plan='pro'; user.proActivatedAt=new Date().toISOString();
  if(paymentId && Array.isArray(user.paymentRequests)){const p=user.paymentRequests.find(x=>x.id===paymentId);if(p)p.status='approved';} saveUsers(users); res.json({ok:true,username:user.username,plan:user.plan});
});

async function callOpenAI(messages,model){
  if(!AI_API_KEY) throw Object.assign(new Error('API key AI belum terbaca. Pastikan file .env berada di folder yang sama dengan server.js lalu restart server.'),{status:500});
  const payloadMessages=messages.map(m=>{
    if(m.role!=='user' || !m.images?.length)return {role:m.role,content:m.content||''};
    const content=[{type:'text',text:m.content||''},...m.images.map(img=>({type:'image_url',image_url:{url:`data:${img.mediaType};base64,${img.dataBase64}`}}))];
    return {role:'user',content};
  });
  const requestedModel=AI_MODELS[model] || model || OPENAI_MODEL;
  const url=`${AI_BASE_URL}/chat/completions`;
  let r;
  try{
    r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${AI_API_KEY}`},body:JSON.stringify({model:requestedModel,messages:payloadMessages,max_tokens:2048})});
  }catch(err){
    throw Object.assign(new Error(`Tidak dapat menghubungi AgentRouter. Periksa koneksi server dan endpoint ${AI_BASE_URL}.`),{status:502,cause:err});
  }
  const raw=await r.text();
  let data={}; try{data=raw?JSON.parse(raw):{};}catch{data={raw};}
  if(!r.ok){
    const upstream=data?.error?.message || data?.message || (typeof data?.raw==='string'?data.raw.slice(0,500):'') || `HTTP ${r.status}`;
    throw Object.assign(new Error(`AgentRouter ${r.status}: ${upstream}`),{status:r.status,code:data?.error?.code||''});
  }
  const reply=data.choices?.[0]?.message?.content;
  if(!reply) throw Object.assign(new Error('AgentRouter tidak mengembalikan jawaban. Periksa model ID yang tersedia untuk API key ini.'),{status:502});
  return reply;
}
async function callAnthropic(messages,model){
  if(!AI_API_KEY)throw Object.assign(new Error('API key AI belum terbaca.'),{status:500});
  const msgs=messages.map(m=>{
    if(m.images?.length){return {role:m.role,content:[...m.images.map(img=>({type:'image',source:{type:'base64',media_type:img.mediaType,data:img.dataBase64}})),{type:'text',text:m.content||''}]};}
    return {role:m.role,content:m.content||''};
  });
  const url=`${ANTHROPIC_BASE_URL}/v1/messages`;
  let r;
  try{
    r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-api-key':AI_API_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model,max_tokens:2048,messages:msgs})});
  }catch(err){throw Object.assign(new Error(`Tidak dapat menghubungi AgentRouter Anthropic di ${ANTHROPIC_BASE_URL}.`),{status:502,cause:err});}
  const raw=await r.text(); let data={}; try{data=raw?JSON.parse(raw):{};}catch{data={raw};}
  if(!r.ok){const upstream=data?.error?.message || data?.message || data?.raw || `HTTP ${r.status}`;throw Object.assign(new Error(`AgentRouter Anthropic ${r.status}: ${String(upstream).slice(0,500)}`),{status:r.status});}
  const reply=(data.content||[]).map(x=>x.text||'').join('\n').trim();
  if(!reply)throw Object.assign(new Error('AgentRouter Anthropic tidak mengembalikan jawaban.'),{status:502});
  return reply;
}
app.post('/api/chat',requireAuth,async(req,res)=>{
  const provider=String(req.body?.provider||'gateway'); const model=String(req.body?.model||''); const messages=req.body?.messages;
  if(!model||!Array.isArray(messages))return res.status(400).json({error:'Data chat tidak lengkap.'});
  const user=getUserById(req.session.userId);if(!user)return res.status(401).json({error:'Akun tidak ditemukan.'});ensureUsage(user);
  if(user.plan!=='pro'&&user.dailyChats>=FREE_DAILY_LIMIT){saveUser(user);return res.status(429).json({error:'Batas 20 chat gratis hari ini sudah habis. Kuota akan kembali besok.',code:'DAILY_LIMIT',dailyChats:user.dailyChats,dailyLimit:FREE_DAILY_LIMIT});}
  try{
    let reply='';
    // One AgentRouter key can be reused across its compatible endpoints.
    // Claude models use Anthropic Messages; DeepSeek uses OpenAI-compatible Chat Completions.
    if(provider==='gateway' || provider==='openai') {
      if(model.startsWith('claude-')) reply=await callAnthropic(messages,model);
      else if(model.startsWith('deepseek-')) reply=await callOpenAI(messages,model);
      else reply=await callOpenAI(messages,model);
    }
    else if(provider==='anthropic') reply=await callAnthropic(messages,model);
    else if(provider==='deepseek') reply=await callOpenAI(messages,model);
    else return res.status(400).json({error:'Provider AI tidak dikenal.'});
    user.dailyChats+=1;saveUser(user);res.json({reply,plan:user.plan,dailyChats:user.dailyChats,dailyLimit:user.plan==='pro'?null:FREE_DAILY_LIMIT});
  }catch(e){res.status(e.status||500).json({error:e.message||'Gagal memanggil AI.'});}
});

const PUBLIC_DIR=path.join(__dirname,'public');
// API fallback: always return JSON instead of a static HTML 404.
app.use('/api',(req,res,next)=>{
  if(req.method==='OPTIONS') return res.sendStatus(204);
  next();
});

// Protected HTML routes must be registered BEFORE express.static, otherwise
// express.static would serve app.html directly and bypass the login check.
app.get('/app.html',(req,res)=>{
  if(!req.session?.userId)return res.redirect('/login.html');
  res.sendFile(path.join(PUBLIC_DIR,'app.html'));
});
app.get('/pricing.html',(req,res)=>{
  if(!req.session?.userId)return res.redirect('/login.html');
  res.sendFile(path.join(PUBLIC_DIR,'pricing.html'));
});
app.get('/',(req,res)=>res.redirect(req.session?.userId?'/app.html':'/login.html'));

app.use(express.static(PUBLIC_DIR));
app.use('/api',(req,res)=>res.status(404).json({error:`Endpoint API tidak ditemukan: ${req.method} ${req.path}`,code:'API_NOT_FOUND'}));

// Keep server errors as JSON so Vercel can return a clean response instead of
// terminating the function on an unhandled Express error.
app.use((err,req,res,next)=>{
  console.error('Sintas request error:', err);
  if(res.headersSent) return next(err);
  res.status(Number(err?.status)||500).json({error:'Internal server error di Sintas.',code:'INTERNAL_SERVER_ERROR'});
});

// Export the Express app for Vercel. The local server is only started when
// this file is executed directly with `node server.js`.
export default app;

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if(isMain){
  const PORT=Number(process.env.PORT||3000);
  app.listen(PORT,()=>console.log(`Sintas AI berjalan di http://localhost:${PORT}`));
}
