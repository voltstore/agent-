'use strict';
require('dotenv').config();
const express=require('express');
const cors=require('cors');
const jwt=require('jsonwebtoken');
const cron=require('node-cron');
const crypto=require('crypto');
const {runSora}=require('./agents/sora');
const {runDeep}=require('./agents/deep');
const {runGold}=require('./agents/gold');
const {fbGet,fbSet,fbUpdate,logEvent,notifyOwner,DEFAULT_SETTINGS}=require('./agents/utils');
const app=express();
const PORT=process.env.PORT||3000;
const JWT_SECRET=crypto.createHash('sha256').update(process.env.DASHBOARD_PIN+':'+process.env.ANTHROPIC_API_KEY+':sdg-2025').digest('hex');
const MONTHLY_BUDGET=parseFloat(process.env.MONTHLY_BUDGET_SAR||'230');
const loginAttempts=new Map();
let cronJobs={};
app.use(cors());
app.use(express.json());
function requireAuth(req,res,next){const token=req.headers.authorization?.replace('Bearer ','');if(!token)return res.status(401).json({error:'يلزم تسجيل الدخول'});try{req.user=jwt.verify(token,JWT_SECRET);next();}catch{res.status(401).json({error:'جلسة منتهية'});}}
function timeToCron(hhmm,days){const[h,m]=hhmm.split(':').map(Number);const map={sunday:0,monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6};const nums=Object.entries(days).filter(([,on])=>on).map(([d])=>map[d]).sort().join(',');return m+' '+h+' * * '+(nums||'0-6');}
async function initSchedule(){Object.values(cronJobs).forEach(j=>j?.destroy?.());cronJobs={};try{const s=await fbGet('settings')||DEFAULT_SETTINGS;const sch=s.schedule||DEFAULT_SETTINGS.schedule;const day=s.days||DEFAULT_SETTINGS.days;cronJobs.sora=cron.schedule(timeToCron(sch.soraStart||'08:00',day),async()=>{const c=await fbGet('settings');if(c?.mode==='manual')return;await runSora();},{timezone:'Asia/Riyadh'});cronJobs.deep=cron.schedule(timeToCron(sch.deepStart||'10:00',day),async()=>{const c=await fbGet('settings');if(c?.mode==='manual')return;await runDeep();},{timezone:'Asia/Riyadh'});cronJobs.gold=cron.schedule(timeToCron(sch.goldStart||'20:00',day),async()=>{const c=await fbGet('settings');if(c?.mode==='manual')return;await runGold();},{timezone:'Asia/Riyadh'});}catch(e){cronJobs.sora=cron.schedule('0 8 * * 0-5',()=>runSora(),{timezone:'Asia/Riyadh'});cronJobs.deep=cron.schedule('0 10 * * 0-5',()=>runDeep(),{timezone:'Asia/Riyadh'});cronJobs.gold=cron.schedule('0 20 * * 0-5',()=>runGold(),{timezone:'Asia/Riyadh'});}}
app.post('/api/auth/login',(req,res)=>{const{pin}=req.body;const ip=req.ip;const now=Date.now();const att=loginAttempts.get(ip)||{count:0,at:0};if(att.count>=5&&now-att.at<15*60*1000){const mins=Math.ceil((15*60*1000-(now-att.at))/60000);return res.status(429).json({error:'حاول بعد '+mins+' دقيقة'});}if(!pin||String(pin)!==String(process.env.DASHBOARD_PIN)){loginAttempts.set(ip,{count:att.count+1,at:now});return res.status(401).json({error:'رمز خاطئ'});}loginAttempts.delete(ip);const token=jwt.sign({role:'owner'},JWT_SECRET,{expiresIn:'7d'});res.json({token});});
app.get('/api/stats',requireAuth,async(req,res)=>{try{const[leads,outreach,settings]=await Promise.all([fbGet('leads'),fbGet('outreach'),fbGet('settings')]);const la=Object.values(leads||{});const oa=Object.values(outreach||{});const tod=new Date().toISOString().split('T')[0];res.json({total:{leads:la.length,sent:la.filter(l=>['أُرسل','ردّ','عميل'].includes(l.status)).length,replies:oa.filter(o=>o.status==='ردّ').length,clients:la.filter(l=>l.status==='عميل').length},today:{discovered:la.filter(l=>l.discoveredAt?.startsWith(tod)).length,sent:oa.filter(o=>o.sentAt?.startsWith(tod)).length,replies:oa.filter(o=>o.repliedAt?.startsWith(tod)).length},budget:{used:settings?.budgetUsed||0,limit:MONTHLY_BUDGET,remaining:MONTHLY_BUDGET-(settings?.budgetUsed||0)},byStatus:{new:la.filter(l=>l.status==='جديد').length,sent:la.filter(l=>l.status==='أُرسل').length,replied:la.filter(l=>l.status==='ردّ').length,client:la.filter(l=>l.status==='عميل').length}});}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/settings',requireAuth,async(req,res)=>{try{res.json(await fbGet('settings')||DEFAULT_SETTINGS);}catch(e){res.status(500).json({error:e.message});}});
app.put('/api/settings',requireAuth,async(req,res)=>{try{await fbUpdate('settings',req.body);if(req.body.schedule||req.body.days)await initSchedule();res.json({success:true,message:'تم الحفظ'});}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/leads',requireAuth,async(req,res)=>{try{const{status,limit=50,offset=0}=req.query;const all=await fbGet('leads')||{};let list=Object.entries(all).map(([id,d])=>({id,...d}));if(status)list=list.filter(l=>l.status===status);list.sort((a,b)=>new Date(b.discoveredAt)-new Date(a.discoveredAt));res.json({total:list.length,leads:list.slice(Number(offset),Number(offset)+Number(limit))});}catch(e){res.status(500).json({error:e.message});}});
app.put('/api/leads/:id',requireAuth,async(req,res)=>{try{await fbUpdate('leads/'+req.params.id,req.body);res.json({success:true});}catch(e){res.status(500).json({error:e.message});}});
app.delete('/api/leads/:id',requireAuth,async(req,res)=>{try{const all=await fbGet('leads')||{};delete all[req.params.id];await fbSet('leads',all);res.json({success:true});}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/agents/sora/run',requireAuth,(req,res)=>{res.json({success:true,message:'سورا يعمل...'});runSora(req.body).catch(e=>logEvent('error','سورا',{error:e.message}));});
app.post('/api/agents/deep/run',requireAuth,(req,res)=>{res.json({success:true,message:'ديب يعمل...'});runDeep(req.body).catch(e=>logEvent('error','ديب',{error:e.message}));});
app.post('/api/agents/gold/run',requireAuth,(req,res)=>{res.json({success:true,message:'جولد يعمل...'});runGold().catch(e=>logEvent('error','جولد',{error:e.message}));});
app.get('/api/reports',requireAuth,async(req,res)=>{try{const all=await fbGet('reports')||{};const list=Object.entries(all).map(([date,d])=>({date,...d})).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,30);res.json(list);}catch(e){res.status(500).json({error:e.message});}});
app.get('/health',(_,res)=>res.json({status:'ok',time:new Date().toISOString()}));
app.listen(PORT,async()=>{console.log('TRIPLE AGENTS منفذ '+PORT);try{const e=await fbGet('settings');if(!e)await fbSet('settings',DEFAULT_SETTINGS);}catch{}await initSchedule();});
