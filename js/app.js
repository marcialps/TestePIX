import { Auth } from './auth.js';
import { DB } from './db.js';
import { generatePixPayload, sanitizeChave } from './pix.js';
import { parseBankFile, reconcileBank, fingerprintList, daysBetween } from './reconciliation.js';

/* =====================================================
   UTILITÁRIOS
===================================================== */
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const fmt = v => 'R$ ' + Number(v).toFixed(2).replace('.',',').replace(/\B(?=(\d{3})+(?!\d))/g,'.');
const fmtDate = d => {
  if(!d) return '';
  const [y,m,dd] = d.split('-');
  return `${dd}/${m}/${y}`;
};
const fmtLong = d => {
  if(!d) return '';
  return new Date(d+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
};
const fmtDatetime = iso => {
  if(!iso) return '';
  const d = new Date(iso);
  if(isNaN(d)) return String(iso);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
};
const dayMonth = d => {
  if(!d) return {day:'',mon:''};
  const [,m,dd] = d.split('-');
  const M = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return {day:dd, mon:M[+m-1]};
};
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const svcIcon = name => {
  const n = (name||'').toLowerCase();
  if(n.includes('barba')) return '🪒';
  if(n.includes('corte')) return '✂️';
  if(n.includes('hidrat')) return '💧';
  if(n.includes('sobrancelha')) return '👁️';
  if(n.includes('pigment')||n.includes('color')) return '🎨';
  return '💈';
};
const initials = name => (name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
const AV_COLORS = ['#C9A227','#3b82f6','#22c55e','#a855f7','#f59e0b','#06b6d4','#ef4444'];
const avColor = name => {
  let h = 0;
  for(let c of (name||'')) h = (h*31 + c.charCodeAt(0)) & 0xffffffff;
  return AV_COLORS[Math.abs(h) % AV_COLORS.length];
};
const esc = (str) => String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const wsIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M13.601 2.326A7.854 7.854 0 0 0 7.994 0C3.627 0 .068 3.558.064 7.926c0 1.399.366 2.76 1.057 3.965L0 16l4.204-1.102a7.933 7.933 0 0 0 3.79.965h.004c4.368 0 7.926-3.558 7.93-7.93A7.898 7.898 0 0 0 13.6 2.326zM7.994 14.521a6.573 6.573 0 0 1-3.356-.92l-.24-.144-2.494.654.666-2.433-.156-.251a6.56 6.56 0 0 1-1.007-3.505c0-3.626 2.957-6.584 6.591-6.584a6.56 6.56 0 0 1 4.66 1.931 6.557 6.557 0 0 1 1.928 4.66c-.004 3.639-2.961 6.592-6.592 6.592zm3.615-4.934c-.197-.099-1.17-.578-1.353-.646-.182-.065-.315-.099-.445.099-.133.197-.513.646-.627.775-.114.133-.232.148-.43.05-.197-.1-.836-.308-1.592-.985-.59-.525-.985-1.175-1.103-1.372-.114-.198-.011-.304.088-.403.087-.088.197-.232.296-.346.1-.114.133-.198.198-.33.065-.134.034-.248-.015-.347-.05-.099-.445-1.076-.612-1.47-.16-.389-.323-.335-.445-.34-.114-.007-.247-.007-.38-.007a.729.729 0 0 0-.529.247c-.182.198-.691.677-.691 1.654 0 .977.71 1.916.81 2.049.098.133 1.394 2.132 3.383 2.992.47.205.84.326 1.129.418.475.152.904.129 1.246.08.38-.058 1.17-.478 1.338-.94.166-.463.166-.86.117-.94-.049-.08-.182-.133-.38-.232z"/></svg>`;

const PAY_METHODS = [
  { v:'pix',     l:'PIX',      i:'⚡' },
  { v:'credito', l:'Crédito',  i:'💳' },
  { v:'debito',  l:'Débito',   i:'🏧' },
  { v:'dinheiro',l:'Dinheiro', i:'💵' },
];
const PAY_LABEL = v => (PAY_METHODS.find(p => p.v === v)?.l) || '—';
const PAY_ICON = v => (PAY_METHODS.find(p => p.v === v)?.i) || '';
const PAY_BADGE = v => {
  switch(v){
    case 'pix': return 'b-success';
    case 'credito': return 'b-info';
    case 'debito': return 'b-warning';
    case 'dinheiro': return 'b-gold';
    default: return 'b-grey';
  }
};

const formatWorkingHours = (wh) => {
  if (!wh) return '';
  let res = `${wh.start || '—'} – ${wh.end || '—'}`;
  if (wh.start2 && wh.end2) {
    res += ` / ${wh.start2} – ${wh.end2}`;
  }
  return res;
};

const renderTenantLogo = (alt, cls) => {
  if (!_tenantInfo?.logoUrl) return '';
  return `<img src="${esc(_tenantInfo.logoUrl)}" alt="${esc(alt)}" class="${cls}">`;
};

/* =====================================================
   TOAST
   ===================================================== */
const T = {
  show(msg, type='s'){
    const icons = {s:'✓',e:'✕',w:'⚠',i:'ℹ'};
    const w = document.getElementById('toastWrap');
    if(!w) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="ticon">${icons[type]||'ℹ'}</span><span class="tmsg">${esc(msg)}</span>`;
    w.appendChild(el);
    setTimeout(()=>{
      el.style.cssText='transition:.3s ease;opacity:0;transform:translateX(100%)';
      setTimeout(()=>el.remove(),300);
    },3200);
  },
  ok(m){this.show(m,'s')}, err(m){this.show(m,'e')},
  warn(m){this.show(m,'w')}, info(m){this.show(m,'i')}
};

/* =====================================================
   DISPONIBILIDADE
   ===================================================== */
const Avail = {
  slots(proId, date){
    const pro=DB.pros().find(p=>p.id===proId);
    if(!pro) return [];
    const dow=new Date(date+'T12:00:00').getDay();
    if(!pro.workingDays.includes(dow)) return [];
    
    const out=[];
    
    // Turno 1 (Manhã)
    if (pro.workingHours?.start && pro.workingHours?.end) {
      const [sh,sm]=pro.workingHours.start.split(':').map(Number);
      const [eh,em]=pro.workingHours.end.split(':').map(Number);
      const s=sh*60+sm, e=eh*60+em;
      for(let m=s;m<e;m+=30){
        const h=Math.floor(m/60), mn=m%60;
        out.push(`${String(h).padStart(2,'0')}:${String(mn).padStart(2,'0')}`);
      }
    }
    
    // Turno 2 (Tarde)
    if (pro.workingHours?.start2 && pro.workingHours?.end2) {
      const [sh2,sm2]=pro.workingHours.start2.split(':').map(Number);
      const [eh2,em2]=pro.workingHours.end2.split(':').map(Number);
      const s2=sh2*60+sm2, e2=eh2*60+em2;
      for(let m=s2;m<e2;m+=30){
        const h=Math.floor(m/60), mn=m%60;
        const timeStr = `${String(h).padStart(2,'0')}:${String(mn).padStart(2,'0')}`;
        if (!out.includes(timeStr)) {
          out.push(timeStr);
        }
      }
    }
    
    out.sort();
    return out;
  },
  canBook(proId, date, time, dur, skipId=null){
    const [h,m]=time.split(':').map(Number);
    const s=h*60+m, n=Math.ceil(dur/30);
    const need=new Set();
    for(let i=0;i<n;i++){const t=s+i*30;need.add(`${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`)}
    const svcs=DB.services();
    return !DB.apts().filter(a=>a.professionalId===proId&&a.date===date&&a.status!=='cancelado'&&a.id!==skipId).some(a=>{
      const sv=svcs.find(s=>s.id===a.serviceId); if(!sv) return false;
      const [ah,am]=a.time.split(':').map(Number);
      const as2=ah*60+am, an=Math.ceil(sv.duration/30);
      for(let i=0;i<an;i++){
        const t=as2+i*30;
        if(need.has(`${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`)) return true;
      }
      return false;
    });
  }
};

/* =====================================================
   BOOKING STATE
===================================================== */
const BS = {
  step:1, service:null, pro:null, date:null, time:null, products:[],
  calM:new Date().getMonth(), calY:new Date().getFullYear(),
  reset(){
    this.step=1;this.service=null;this.pro=null;this.date=null;this.time=null;this.products=[];
    const d=new Date();this.calM=d.getMonth();this.calY=d.getFullYear();
  }
};

/* =====================================================
   ROUTER / NAV
===================================================== */
const Nav = {
  go(page){
    let base = window.location.href.split('#')[0];
    window.location.href = base + '#' + page;
    App.render();
  }
};
window.Nav = Nav;

let _tenantInfo = null;
let _tenantUsers = [];

/* =====================================================
   RENDER COMPONENTS
===================================================== */
const rNavbar = () => {
  if(!Auth.ok()) return '';
  const hash=window.location.hash.slice(1).split('?')[0];
  const isAdm=Auth.isAdmin();
  const isSuper=Auth.isSuperAdmin();
  const isBarber=Auth.isBarber();
  
  let desktopLinks = [];
  let mobileLinks = [];
  
  if(isSuper) {
    desktopLinks = [{h:'superadmin',l:'Super Admin',i:'👑'}];
    mobileLinks = [{h:'superadmin',l:'Super Admin',i:'👑'}];
  } else if(isAdm) {
    desktopLinks = [
      {h:'admin',l:'Dashboard',i:'◈'},
      {h:'admin-services',l:'Serviços',i:'✦'},
      {h:'admin-barbers',l:'Barbeiros',i:'✂'},
      {h:'admin-store',l:'Loja',i:'🛒'},
      {h:'admin-appointments',l:'Agendamentos',i:'📅'},
      {h:'admin-dreport',l:'Relatório Detalhado',i:'🧾'},
      {h:'admin-recon',l:'Conciliação',i:'⇄'}
    ];
    mobileLinks = [
      {h:'admin',l:'Dashboard',i:'◈'},
      {h:'admin-services',l:'Serviços',i:'✦'},
      {h:'admin-barbers',l:'Barbeiros',i:'✂'},
      {h:'admin-store',l:'Loja',i:'🛒'},
      {h:'admin-appointments',l:'Agendamentos',i:'📅'},
      {h:'admin-clients',l:'Clientes',i:'👥'},
      {h:'admin-reports',l:'Relatórios',i:'📊'},
      {h:'admin-dreport',l:'Relatório Detalhado',i:'🧾'},
      {h:'admin-recon',l:'Conciliação',i:'⇄'},
      {h:'admin-pix',l:'Configurações PIX',i:'⚡'},
      {h:'admin-reminders',l:'Lembretes Whats',i:'💬'}
    ];
  } else if(isBarber) {
    desktopLinks = [
      {h:'barber-schedule',l:'Minha Agenda',i:'📅'},
      {h:'barber-earnings',l:'Meus Ganhos',i:'💰'},
      {h:'barber-clients',l:'Meus Clientes',i:'👥'}
    ];
    mobileLinks = [
      {h:'barber-schedule',l:'Minha Agenda',i:'📅'},
      {h:'barber-earnings',l:'Meus Ganhos',i:'💰'},
      {h:'barber-clients',l:'Meus Clientes',i:'👥'}
    ];
  } else {
    desktopLinks = [
      {h:'home',l:'Início',i:'⌂'},
      {h:'booking',l:'Agendar',i:'＋'},
      {h:'store',l:'Loja',i:'🛒'},
      {h:'appointments',l:'Meus Agendamentos',i:'📅'}
    ];
    mobileLinks = [
      {h:'home',l:'Início',i:'⌂'},
      {h:'booking',l:'Agendar',i:'＋'},
      {h:'store',l:'Loja',i:'🛒'},
      {h:'appointments',l:'Meus Agendamentos',i:'📅'}
    ];
  }
  
  const u=Auth.cur;
  const ac=avColor(u.name);
  const tc=ac==='#C9A227'?'#000':'#fff';
  const logoText = _tenantInfo ? _tenantInfo.name : 'Hora Barbearia';

  return `
<nav class="navbar">
  <div class="nb-inner">
    <div class="nb-logo" onclick="Nav.go('${isSuper?'superadmin':isAdm?'admin':'home'}')">
      <div class="nb-logo-icon">💈</div>
      <span>${esc(logoText)}</span>
    </div>
    <ul class="nb-nav">
      ${desktopLinks.map(l=>`<li><a href="#${l.h}" class="${hash===l.h?'active':''}">${l.i} ${l.l}</a></li>`).join('')}
    </ul>
    <div class="nb-right">
      <div class="user-pill" onclick="App.toggleUserDD()" id="uPill">
        <div class="uavatar" style="background:${ac};color:${tc}">${initials(u.name)}</div>
        <span class="uname">${esc(u.name)}</span>
        <span style="color:var(--text2);font-size:.65rem">▼</span>
      </div>
    </div>
    <div class="hamburger" onclick="App.toggleMob()" id="hambBtn">
      <span></span><span></span><span></span>
    </div>
  </div>
</nav>
<div class="mob-menu" id="mobMenu">
  ${mobileLinks.map(l=>`<a href="#${l.h}" class="${hash===l.h?'active':''}" onclick="App.closeMob()">${l.i} ${l.l}</a>`).join('')}
  <div style="height:1px;background:var(--border);margin:8px 0"></div>
  <div style="padding:10px 14px;display:flex;align-items:center;gap:11px">
    <div class="uavatar" style="background:${ac};color:${tc};width:38px;height:38px;font-size:.9rem">${initials(u.name)}</div>
    <div>
      <div style="font-weight:600;font-size:.9rem">${esc(u.name)}</div>
      <div style="font-size:.78rem;color:var(--text2)">${esc(u.email)}</div>
      ${u.points>0?`<div style="font-size:.72rem;color:var(--gold);margin-top:2px">⭐ ${u.points} pontos</div>`:''}
    </div>
  </div>
  <button class="btn btn-ghost w-full" onclick="App.logout()" style="margin-top:6px">⏻ Sair da conta</button>
</div>`;
};

const rLogin = () => `
<div class="auth-page">
  <div class="auth-card">
    <div style="text-align:center;margin-bottom:28px">
      ${renderTenantLogo(_tenantInfo?.name || 'Sistema', 'auth-logo-img') || '<div class="auth-logo-wrap">💈</div>'}
      <span class="auth-logo-text">${esc(_tenantInfo?.name || 'SISTEMA')}</span>
      <span class="auth-logo-sub">Sistema de Agendamentos</span>
    </div>
    <h2 class="auth-title">Bem-vindo de volta</h2>
    <p class="auth-sub">Entre com seus dados para continuar</p>
    <form id="loginF">
      <div class="fg">
        <label class="flabel">E-mail ou Telefone</label>
        <input type="text" name="emailOrPhone" class="fc" placeholder="seu@email.com ou (11) 99999-9999" required>
      </div>
      <div class="fg">
        <label class="flabel">Senha</label>
        <input type="password" name="pw" class="fc" placeholder="••••••••" required>
      </div>
      <div id="loginErr" class="ferr" style="margin-bottom:12px;display:none"></div>
      <button type="submit" class="btn btn-primary btn-lg w-full" id="btnLogin">Entrar</button>
      <div class="divider" style="color:var(--text3);font-size:.8rem;text-align:center;position:relative;margin:24px 0">
        <span style="background:var(--bg2);padding:0 10px;position:relative;z-index:1;font-weight:600">OU</span>
        <div style="position:absolute;top:50%;left:0;right:0;height:1px;background:var(--border);transform:translateY(-50%)"></div>
      </div>
      <button type="button" class="btn btn-ghost btn-lg w-full" style="margin-bottom:18px;gap:10px" onclick="App.loginGoogle()">
        <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" style="width:20px"> Continuar com Google
      </button>
    </form>
    ${DB.getBarbeariaId() ? `<p class="auth-foot">Não tem conta? <a href="#register" style="font-weight:600">Cadastre-se grátis</a></p>` : ''}
  </div>
</div>`;

const rRegister = () => `
<div class="auth-page">
  <div class="auth-card">
    <div style="text-align:center;margin-bottom:28px">
      ${renderTenantLogo(_tenantInfo?.name || 'Sistema', 'auth-logo-img') || '<div class="auth-logo-wrap">💈</div>'}
      <span class="auth-logo-text">${esc(_tenantInfo?.name || 'SISTEMA')}</span>
      <span class="auth-logo-sub">Sistema de Agendamentos</span>
    </div>
    <h2 class="auth-title">Criar conta</h2>
    <p class="auth-sub">Preencha os dados abaixo para se cadastrar</p>
    <form id="regF">
      <div class="fg"><label class="flabel">Nome completo *</label><input type="text" name="name" class="fc" required></div>
      <div class="fg"><label class="flabel">E-mail ou Telefone *</label><input type="text" name="emailOrPhone" class="fc" required placeholder="seu@email.com ou (11) 99999-9999"></div>
      <div class="fg"><label class="flabel">Senha * (mín 6 caracteres)</label><input type="password" name="pw" class="fc" required minlength="6"></div>
      <div class="fg"><label class="flabel">Confirmar senha *</label><input type="password" name="pw2" class="fc" required></div>
      <div id="regErr" class="ferr" style="margin-bottom:12px;display:none"></div>
      <button type="submit" class="btn btn-primary btn-lg w-full" id="btnReg">Criar minha conta</button>
      <div class="divider" style="color:var(--text3);font-size:.8rem;text-align:center;position:relative;margin:24px 0">
        <span style="background:var(--bg2);padding:0 10px;position:relative;z-index:1;font-weight:600">OU</span>
        <div style="position:absolute;top:50%;left:0;right:0;height:1px;background:var(--border);transform:translateY(-50%)"></div>
      </div>
      <button type="button" class="btn btn-ghost btn-lg w-full" style="margin-bottom:18px;gap:10px" onclick="App.loginGoogle()">
        <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" style="width:20px"> Continuar com Google
      </button>
    </form>
    <p class="auth-foot">Já tem conta? <a href="#login" style="font-weight:600">Entrar</a></p>
  </div>
</div>`;

const rNoTenant = () => `
<div class="page" style="min-height:100vh;display:flex;flex-direction:column;justify-content:center;background:radial-gradient(ellipse at 50% 0%,rgba(201,162,39,.12) 0%,transparent 70%)">
  
  <div style="position:absolute;top:20px;right:20px;z-index:100">
    <button class="btn btn-ghost" style="opacity:0.35;background:transparent;border:none;font-size:0.75rem;padding:5px 10px;text-transform:uppercase;letter-spacing:1px;transition:var(--tr)" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.35'" onclick="Nav.go('login')" title="Acesso ao Painel Administrativo">Painel</button>
  </div>

  <div class="container" style="text-align:center;max-width:900px;margin:0 auto;padding:60px 20px;">
    
    <div style="width:80px;height:80px;background:var(--gold);border-radius:20px;display:flex;align-items:center;justify-content:center;font-size:2.5rem;color:#000;box-shadow:0 8px 32px rgba(201,162,39,.4);margin:0 auto 28px;">💈</div>
    
    <span class="slabel" style="font-size:0.9rem;letter-spacing:4px;margin-bottom:14px;display:block">✦ Hora Barbearia ✦</span>
    
    <h1 style="font-family:var(--ft);font-size:clamp(2.8rem,7vw,4.8rem);font-weight:700;letter-spacing:1px;margin-bottom:20px;line-height:1.1;color:var(--text)">
      Sistema de Agendamento<br><span style="color:var(--gold)">Premium</span>
    </h1>
    
    <p style="font-size:1.15rem;color:var(--text2);max-width:580px;margin:0 auto 40px;line-height:1.6">
      A solução definitiva para barbearias modernas. Escale seu negócio com gestão de agenda, controle de clientes e pagamentos via PIX automatizados.
    </p>

    <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;margin-bottom:60px;">
      <button class="btn btn-primary btn-lg" style="box-shadow:var(--shg);font-size:1.05rem;padding:16px 36px;border-radius:100px" onclick="window.open('https://wa.me/5592137686', '_blank')">✦ Quero Escalar Minha Barbearia</button>
    </div>

    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:24px;text-align:left;">
      
      <div class="card card-hover" style="background:rgba(24,24,24,.6);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.04);padding:30px">
        <div style="width:54px;height:54px;background:rgba(245,158,11,.1);color:var(--warning);border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:1.5rem;margin-bottom:20px;">⚡</div>
        <div style="font-family:var(--ft);font-size:1.3rem;font-weight:600;margin-bottom:10px">Integração PIX</div>
        <p style="font-size:0.95rem;color:var(--text2);line-height:1.5">Recebimentos diretos na sua conta. O sistema gera um QR Code exclusivo para cada agendamento.</p>
      </div>

      <div class="card card-hover" style="background:rgba(24,24,24,.6);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.04);padding:30px">
        <div style="width:54px;height:54px;background:rgba(34,197,94,.1);color:var(--success);border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:1.5rem;margin-bottom:20px;">📅</div>
        <div style="font-family:var(--ft);font-size:1.3rem;font-weight:600;margin-bottom:10px">Agenda Inteligente</div>
        <p style="font-size:0.95rem;color:var(--text2);line-height:1.5">Fim do papel e caneta. Seus clientes escolhem barbeiro e horário disponíveis de forma 100% autônoma.</p>
      </div>

      <div class="card card-hover" style="background:rgba(24,24,24,.6);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.04);padding:30px">
        <div style="width:54px;height:54px;background:rgba(59,130,246,.1);color:var(--info);border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:1.5rem;margin-bottom:20px;">📊</div>
        <div style="font-family:var(--ft);font-size:1.3rem;font-weight:600;margin-bottom:10px">Painel de Controle</div>
        <p style="font-size:0.95rem;color:var(--text2);line-height:1.5">Tenha previsibilidade financeira e controle total sobre a performance dos seus barbeiros em tempo real.</p>
      </div>

    </div>
  </div>
</div>`;

const rHome = () => {
  const svcs=DB.services(), pros=DB.pros(), u=Auth.cur;
  const upApts=DB.apts().filter(a=>a.userId===u.id&&a.status==='confirmado'&&a.date>=todayStr()).sort((a,b)=>a.date.localeCompare(b.date));
  const next=upApts[0];
  return `
<div class="page">
  <div class="container">
    <section class="hero">
      ${renderTenantLogo(_tenantInfo?.name || 'Sistema', 'home-logo-img') || '<div class="home-logo-placeholder">💈</div>'}
      <span class="slabel">✦ Bem-vindo, ${esc(u.name.split(' ')[0])}</span>
      <h1>Seu estilo,<br><span>seu horário.</span></h1>
      <p>Agende agora na ${esc(_tenantInfo?.name || 'barbearia')}. Rápido, fácil e sem espera.</p>
      <div class="hero-btns">
        <button class="btn btn-primary btn-lg" onclick="Nav.go('booking')">✦ Agendar Agora</button>
        <button class="btn btn-ghost btn-lg" onclick="Nav.go('appointments')">📅 Meus Agendamentos</button>
      </div>
      ${next ? (() => {
        const sv=svcs.find(s=>s.id===next.serviceId); const pr=pros.find(p=>p.id===next.professionalId);
        return `<div style="max-width:400px;margin:28px auto 0;background:var(--ga1);border:1px solid var(--gold3);border-radius:var(--r);padding:14px 18px;text-align:left">
          <div style="font-size:.68rem;text-transform:uppercase;letter-spacing:1px;color:var(--gold);font-weight:700;margin-bottom:6px">📅 Próximo Agendamento</div>
          <div style="font-weight:700;font-size:.97rem;font-family:var(--ft)">${esc(sv?.name||'')}</div>
          <div style="font-size:.82rem;color:var(--text2);margin-top:3px">com ${esc(pr?.name||'')} · ${fmtDate(next.date)} às ${next.time}</div>
        </div>`;
      })() : ''}
    </section>
    <div class="gold-line"></div>
    <section>
      <div class="sec-head"><span class="slabel">✦ O que oferecemos</span><h2>Nossos Serviços</h2></div>
      <div class="grid g3">
        ${svcs.map(s=>`
        <div class="svc-card" onclick="App.bookWith('${s.id}')">
          <div class="svc-icon">${svcIcon(s.name)}</div>
          <div class="svc-name">${esc(s.name)}</div>
          <div class="svc-meta"><span class="svc-price">${fmt(s.price)}</span><span class="svc-dur">⏱ ${s.duration} min</span></div>
        </div>`).join('')}
      </div>
    </section>
    <div class="gold-line"></div>
    <section style="margin-bottom:60px">
      <div class="sec-head"><span class="slabel">✦ Nossa equipe</span><h2>Nossos Barbeiros</h2></div>
      <div class="grid g3">
        ${pros.map(p=>{
          const ac=avColor(p.name), tc=ac==='#C9A227'?'#000':'#fff';
          const bgImg = p.photo ? `background-image:url(${p.photo});background-size:cover;background-position:center;` : '';
          return `<div class="brb-card card-hover" onclick="Nav.go('booking')">
            <div class="brb-av" style="background:${ac};color:${tc};${bgImg}">${p.photo ? '' : initials(p.name)}</div>
            <div class="brb-name">${esc(p.name)}</div>
            <div class="tags">${(p.specialties||[]).map(s=>`<span class="tag">${esc(s)}</span>`).join('')}</div>
          </div>`;
        }).join('')}
      </div>
    </section>
  </div>
</div>`;
};

// --- BOOKING ---
const rBooking = () => {
  const {step} = BS;
  const stepDefs = ['Serviço','Barbeiro','Data & Hora','Loja','Confirmar'];
  const stepsH = stepDefs.map((lbl,i)=>{
    const n=i+1, act=n===step, done=n<step;
    const cc=done?'done':act?'active':'';
    return `${i>0?`<div class="step-line ${n-1<step?'done':''}"></div>`:''}<div class="wiz-step"><div class="step-c ${cc}">${done?'✓':n}</div><span class="step-lbl ${cc}">${lbl}</span></div>`;
  }).join('');

  if(step===6) return `<div class="page"><div class="container">${rBkSuccess(_lastPixPayload, _lastPixTotal, _lastPixAptId, _lastBkProducts)}</div></div>`;

  const content = step===1?rBkS1():step===2?rBkS2():step===3?rBkS3():step===4?rBkS4():rBkS5();
  return `
<div class="page">
  <div class="container">
    <div class="ph"><div><h1 class="ptitle">Novo Agendamento</h1><p class="psub">Siga os passos para reservar seu horário</p></div></div>
    <div class="wiz-steps">${stepsH}</div>
    <div class="card" style="max-width:820px;margin:0 auto">${content}</div>
  </div>
</div>`;
};

const rBkS1 = () => {
  const svcs=DB.services();
  return `
  <h3 style="font-family:var(--ft);font-size:1.15rem;margin-bottom:18px">1. Escolha um serviço</h3>
  <div class="grid g2" style="margin-bottom:22px">
    ${svcs.map(s=>`
    <div class="svc-card ${BS.service?.id===s.id?'sel':''}" onclick="App.selSvc('${s.id}')">
      <div class="svc-icon">${svcIcon(s.name)}</div>
      <div class="svc-name">${esc(s.name)}</div>
      <div class="svc-meta"><span class="svc-price">${fmt(s.price)}</span><span class="svc-dur">⏱ ${s.duration} min</span></div>
    </div>`).join('')}
  </div>
  <div style="display:flex;justify-content:flex-end">
    <button class="btn btn-primary" onclick="App.bkNext()" ${!BS.service?'disabled':''}>Próximo: Barbeiro →</button>
  </div>`;
};

const rBkS2 = () => {
  const pros=DB.pros();
  return `
  <div style="display:flex;align-items:center;gap:11px;margin-bottom:18px"><button class="btn btn-ghost btn-sm" onclick="App.bkBack()">← Voltar</button><h3 style="font-family:var(--ft);font-size:1.15rem">2. Escolha o barbeiro</h3></div>
  <div class="grid g3" style="margin-bottom:22px">
    ${pros.map(p=>{
      const ac=avColor(p.name), tc=ac==='#C9A227'?'#000':'#fff';
      const bgImg = p.photo ? `background-image:url(${p.photo});background-size:cover;background-position:center;` : '';
      return `<div class="brb-card ${BS.pro?.id===p.id?'sel':''}" onclick="App.selPro('${p.id}')">
        <div class="brb-av" style="background:${ac};color:${tc};${bgImg}">${p.photo ? '' : initials(p.name)}</div>
        <div class="brb-name">${esc(p.name)}</div>
        <div style="font-size:.72rem;color:var(--text2);margin-top:10px">🕐 ${formatWorkingHours(p.workingHours)}</div>
      </div>`;
    }).join('')}
  </div>
  <div style="display:flex;justify-content:flex-end">
    <button class="btn btn-primary" onclick="App.bkNext()" ${!BS.pro?'disabled':''}>Próximo: Data →</button>
  </div>`;
};

const rBkS3 = () => {
  const {calM,calY,date:sd,time:st,pro,service}=BS;
  const mNames=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const first=new Date(calY,calM,1).getDay();
  const days=new Date(calY,calM+1,0).getDate();
  const today=new Date(); today.setHours(0,0,0,0);
  const dows=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

  let calH=`<div class="cal-wrap"><div class="cal-head"><button class="cal-nav" onclick="App.calP()">‹</button><div class="cal-month">${mNames[calM]} ${calY}</div><button class="cal-nav" onclick="App.calN()">›</button></div><div class="cal-grid">${dows.map(d=>`<div class="cal-dow">${d}</div>`).join('')}`;
  for(let i=0;i<first;i++) calH+=`<div class="cal-day om"></div>`;
  for(let d=1;d<=days;d++){
    const dObj=new Date(calY,calM,d); dObj.setHours(0,0,0,0);
    const ds=`${calY}-${String(calM+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dis=dObj<today||(pro&&!pro.workingDays.includes(dObj.getDay()));
    let cls='cal-day'+(dis?' dis':ds===sd?' picked':dObj.getTime()===today.getTime()?' today':'');
    calH+=`<div class="${cls}" ${!dis?`onclick="App.selDate('${ds}')"`:''}>${d}</div>`;
  }
  calH+=`</div></div>`;

  let timesH='';
  if(sd&&pro&&service){
    const allSlots=Avail.slots(pro.id,sd);
    if(allSlots.length===0){ timesH=`<div style="text-align:center;padding:24px;color:var(--text2)">Barbeiro não atende neste dia.</div>`; } 
    else {
      timesH=`<h4 style="font-size:.8rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Horários — ${fmtDate(sd)}</h4>
      <div class="slots-grid">
        ${allSlots.map(slot=>{
          const avail=Avail.canBook(pro.id,sd,slot,service.duration);
          let cls='slot'+(!avail?' booked':slot===st?' picked':'');
          return `<div class="${cls}" ${avail?`onclick="App.selTime('${slot}')"`:''}>${slot}</div>`;
        }).join('')}
      </div>`;
    }
  }

  return `
  <div style="display:flex;align-items:center;gap:11px;margin-bottom:18px"><button class="btn btn-ghost btn-sm" onclick="App.bkBack()">← Voltar</button><h3 style="font-family:var(--ft);font-size:1.15rem">3. Escolha data e horário</h3></div>
  <div class="booking-date-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-bottom:22px">
    <div>${calH}</div>
    <div style="min-height:200px">${timesH||`<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text2);font-size:.87rem">Selecione uma data</div>`}</div>
  </div>
  <div style="display:flex;justify-content:flex-end">
    <button class="btn btn-primary" onclick="App.bkNext()" ${!sd||!st?'disabled':''}>Próximo: Confirmar →</button>
  </div>`;
};

const rBkS4 = () => {
  const prods = DB.products();
  const sel = BS.products || [];
  const prodTotal = sel.reduce((s,p)=>s+p.price*p.qty,0);
  return `
  <div style="display:flex;align-items:center;gap:11px;margin-bottom:12px"><button class="btn btn-ghost btn-sm" onclick="App.bkBack()">← Voltar</button><h3 style="font-family:var(--ft);font-size:1.15rem">4. Loja — Produtos (opcional)</h3></div>
  <p style="font-size:.84rem;color:var(--text2);margin-bottom:16px">Adicione produtos da barbearia à sua compra. A quantidade em estoque é atualizada automaticamente.</p>
  ${prods.length === 0 ? `<div class="empty"><div class="empty-ico">🛒</div><div class="empty-t">Nenhum produto disponível</div><div class="empty-d">A loja da barbearia ainda não tem produtos cadastrados.</div></div>` : `
  <div class="grid g2" style="margin-bottom:16px">
    ${prods.map(p=>{
      const inSel = sel.find(s=>s.id===p.id);
      const out = Number(p.stock||0) <= 0;
      const bgImg = p.image ? `background-image:url(${p.image});background-size:cover;background-position:center;` : '';
      return `
      <div class="svc-card ${inSel?'sel':''}" style="padding:16px">
        <div class="prod-photo" style="${bgImg}">${p.image ? '' : '🛒'}</div>
        <div class="svc-name" style="font-size:.98rem">${esc(p.name)}</div>
        <div style="font-size:.75rem;color:${out?'var(--danger)':'var(--text2)'};margin-bottom:8px">${out?'⚠ Esgotado':`📦 ${p.stock} em estoque`}</div>
        <div class="svc-meta" style="padding-top:11px">
          <span class="svc-price" style="font-size:1.08rem">${fmt(p.price)}</span>
          <div style="display:flex;gap:6px;align-items:center">
            ${inSel ? `
              <button class="btn btn-ghost btn-sm" onclick="App.chgProd('${p.id}',-1)">−</button>
              <span style="font-weight:700;min-width:22px;text-align:center">${inSel.qty}</span>
              <button class="btn btn-primary btn-sm" onclick="App.chgProd('${p.id}',1)" ${inSel.qty>=p.stock?'disabled':''}>＋</button>
            ` : `
              <button class="btn btn-primary btn-sm" onclick="App.chgProd('${p.id}',1)" ${out?'disabled':''}>Adicionar</button>
            `}
          </div>
        </div>
      </div>`;
    }).join('')}
  </div>`}
  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
    ${sel.length ? `<span style="font-size:.87rem;color:var(--text2)">🛒 ${sel.reduce((s,p)=>s+p.qty,0)} item(ns) · <strong style="color:var(--gold)">${fmt(prodTotal)}</strong></span>` : `<span style="font-size:.85rem;color:var(--text3)">Nenhum produto selecionado</span>`}
    <button class="btn btn-primary" onclick="App.bkNext()">Próximo: Confirmar →</button>
  </div>`;
};

const rBkS5 = () => {
  const {service,pro,date,time,products}=BS; const u=Auth.cur;
  const prodTotal = (products||[]).reduce((s,p)=>s+p.price*p.qty,0);
  const total = service.price + prodTotal;
  return `
  <div style="display:flex;align-items:center;gap:11px;margin-bottom:18px"><button class="btn btn-ghost btn-sm" onclick="App.bkBack()">← Voltar</button><h3 style="font-family:var(--ft);font-size:1.15rem">5. Confirme seu agendamento</h3></div>
  <div class="conf-sum">
    <div class="conf-row"><span class="conf-lbl">👤 Cliente</span><span class="conf-val">${esc(u.name)}</span></div>
    <div class="conf-row"><span class="conf-lbl">${svcIcon(service.name)} Serviço</span><span class="conf-val">${esc(service.name)}</span></div>
    <div class="conf-row"><span class="conf-lbl">✂ Barbeiro</span><span class="conf-val">${esc(pro.name)}</span></div>
    <div class="conf-row"><span class="conf-lbl">📅 Data</span><span class="conf-val">${fmtLong(date)}</span></div>
    <div class="conf-row"><span class="conf-lbl">🕐 Horário</span><span class="conf-val">${time}</span></div>
    ${products&&products.length?`
    <div class="conf-row"><span class="conf-lbl">🛒 Produtos</span><span class="conf-val">${products.map(p=>`${esc(p.name)} × ${p.qty}`).join('<br>')}</span></div>
    <div class="conf-row"><span class="conf-lbl" style="font-size:.8rem;color:var(--text2)">Subtotal serviços</span><span class="conf-val">${fmt(service.price)}</span></div>
    <div class="conf-row"><span class="conf-lbl" style="font-size:.8rem;color:var(--text2)">Subtotal produtos</span><span class="conf-val">${fmt(prodTotal)}</span></div>`:''}
    <div class="conf-row" style="padding-top:14px"><span class="conf-lbl" style="font-size:.87rem;color:var(--text)">💰 Total a pagar</span><span class="conf-val conf-total">${fmt(total)}</span></div>
  </div>
  ${_tenantInfo?.pixConfig?.chave ? `
  <div style="background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.25);border-radius:var(--r2);padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px">
    <span style="font-size:1.1rem">⚡</span>
    <span style="font-size:.82rem;color:var(--text2)">Após confirmar, você receberá o <strong style="color:var(--warning)">QR Code PIX</strong> para pagamento.</span>
  </div>` : ''}
  <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
    <button class="btn btn-primary btn-lg" id="btnConfirmBk" onclick="App.confirmBk()">✓ Confirmar Agendamento</button>
  </div>`;
};

// Estado do PIX gerado (para reexibir no modal)
let _lastPixPayload = null;
let _lastPixAptId = null;
let _lastPixTotal = 0;
let _lastBkProducts = [];

const rBkSuccess = (pixPayload = null, valor = 0, aptId = null, products = []) => {
  const pixCfg = _tenantInfo?.pixConfig;
  const hasPixCfg = !!(pixCfg?.chave);

  let pixSection = '';
  if (hasPixCfg && pixPayload) {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(pixPayload)}`;
    pixSection = `
    <div class="pix-box" id="pixBox" style="margin:28px auto 0;max-width:460px">
      <div class="pix-box-head">
        <span class="pix-logo">⚡</span>
        <div>
          <div style="font-weight:700;font-size:.97rem">Pague via PIX</div>
          <div style="font-size:.8rem;color:var(--text2)">Escaneie o QR Code ou copie a linha digitável</div>
        </div>
        <div class="pix-valor">${fmt(valor)}</div>
      </div>
      <div class="pix-qr-area">
        <img src="${qrUrl}" alt="QR Code PIX" class="pix-qr-img" onerror="this.style.display='none'">
        <div style="flex:1">
          <div style="font-size:.72rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:7px">Linha Copia e Cola</div>
          <div class="pix-code" id="pixCode" onclick="App.copyPix('${esc(pixPayload)}')">${esc(pixPayload)}</div>
          <button class="btn btn-primary" style="margin-top:10px;width:100%" onclick="App.copyPix('${esc(pixPayload)}')">📋 Copiar código PIX</button>
        </div>
      </div>
      <div style="font-size:.75rem;color:var(--text3);margin-top:12px;text-align:center">Após pagar, o pagamento será confirmado pela equipe.</div>
    </div>`;
  } else if (!hasPixCfg) {
    pixSection = `<p style="color:var(--text2);font-size:.82rem;margin-top:10px">Pagamento presencial — combine com a equipe.</p>`;
  }

  return `
<div class="success-scr">
  <div class="success-ico">✓</div>
  <h2 style="font-family:var(--ft);font-size:1.75rem;margin-bottom:7px">Agendamento Confirmado!</h2>
  <p style="color:var(--text2);font-size:.9rem">Seu horário está reservado.</p>
  ${products&&products.length?`
  <div style="max-width:400px;margin:18px auto 0;background:var(--ga1);border:1px solid var(--gold3);border-radius:var(--r2);padding:12px 16px;text-align:left">
    <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:1px;color:var(--gold);font-weight:700;margin-bottom:8px">🛒 Produtos selecionados</div>
    ${products.map(p=>`<div style="display:flex;justify-content:space-between;font-size:.85rem;padding:3px 0"><span>${esc(p.name)} × ${p.qty}</span><strong>${fmt(p.price*p.qty)}</strong></div>`).join('')}
  </div>`:''}
  ${pixSection}
  <div style="display:flex;gap:10px;justify-content:center;margin-top:24px;flex-wrap:wrap">
    <button class="btn btn-primary btn-lg" onclick="App.newBk()">＋ Novo Agendamento</button>
    <button class="btn btn-ghost btn-lg" onclick="Nav.go('appointments')">📅 Ver meus agendamentos</button>
  </div>
</div>`;
};

// --- APPOINTMENTS ---
const rAppointments = () => {
  const u=Auth.cur, td=todayStr();
  const svcs=DB.services(), pros=DB.pros();
  const all=DB.apts();
  const upcoming=all.filter(a=>a.date>=td&&a.status!=='cancelado').sort((a,b)=>a.date.localeCompare(b.date));
  const past=all.filter(a=>a.date<td||a.status==='cancelado').sort((a,b)=>b.date.localeCompare(a.date));

  const rCard = (apt, showAct) => {
    const sv=svcs.find(s=>s.id===apt.serviceId), pr=pros.find(p=>p.id===apt.professionalId);
    const dm=dayMonth(apt.date);
    const [bc,bl]=apt.status==='confirmado'?['b-success','Confirmado']:apt.status==='cancelado'?['b-danger','Cancelado']:['b-info','Concluído'];
    const isUp=apt.date>=td&&apt.status!=='cancelado';
    // PIX status badge p/ cliente
    const hasPix=!!(_tenantInfo?.pixConfig?.chave);
    let pixInfo='';
    if(hasPix&&apt.pixStatus==='pendente'){
      pixInfo=`<div style="margin-top:9px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span class="badge b-warning" style="font-size:.68rem">⏳ PIX Pendente</span>
        <button class="btn btn-sm" style="background:var(--warning);color:#000;font-size:.72rem;padding:3px 10px" onclick="App.openPixModal('${apt.id}')">Ver QR Code PIX</button>
      </div>`;
    } else if(hasPix&&apt.pixStatus==='pago'){
      pixInfo=`<div style="margin-top:9px"><span class="badge b-success" style="font-size:.68rem">✅ PIX Confirmado</span></div>`;
    }
    return `
    <div class="apt-card">
      <div class="apt-dbox"><div class="apt-day">${dm.day}</div><div class="apt-mon">${dm.mon}</div></div>
      <div style="flex:1;min-width:0">
        <div class="apt-svc">${esc(sv?.name||'Serviço excluído')}</div>
        <div class="apt-det">✂ ${esc(pr?.name||'—')} · 🕐 ${apt.time}</div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="badge ${bc}">${bl}</span>
          <span class="tgold" style="font-weight:700;font-size:.87rem">${fmt(apt.price)}</span>
        </div>
        ${pixInfo}
        ${showAct&&isUp?`
        <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:10px">
          <button class="btn btn-danger btn-sm" onclick="App.cancelApt('${apt.id}')">✕ Cancelar</button>
        </div>`:''}
      </div>
    </div>`;
  };

  return `<div class="page"><div class="container">
    <div class="ph"><div><h1 class="ptitle">Meus Agendamentos</h1></div><button class="btn btn-primary" onclick="Nav.go('booking')">＋ Novo Agendamento</button></div>
    <div class="tabs">
      <div class="tab active" id="tU" onclick="App.tabApt('u')">Próximos (${upcoming.length})</div>
      <div class="tab" id="tH" onclick="App.tabApt('h')">Histórico (${past.length})</div>
    </div>
    <div id="tcU" style="display:flex;flex-direction:column;gap:11px">
      ${upcoming.length===0?`<div class="empty"><div class="empty-ico">📅</div><div class="empty-t">Nenhum agendamento</div></div>`:upcoming.map(a=>rCard(a,true)).join('')}
    </div>
    <div id="tcH" style="display:none;flex-direction:column;gap:11px">
      ${past.map(a=>rCard(a,false)).join('')}
    </div>
  </div></div>`;
};

const rStore = () => {
  const prods = DB.products();
  const sel = BS.products || [];
  const prodTotal = sel.reduce((s,p)=>s+p.price*p.qty,0);
  const totalQty = sel.reduce((s,p)=>s+p.qty,0);
  return `
<div class="page">
  <div class="container">
    <div class="ph">
      <div><h1 class="ptitle">🛒 Loja</h1><p class="psub">Produtos disponíveis na ${esc(_tenantInfo?.name || 'barbearia')}</p></div>
    </div>
    <div style="background:var(--ga1);border:1px solid var(--gold3);border-radius:var(--r2);padding:14px 18px;margin-bottom:22px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
      <span style="font-size:.85rem;color:var(--text2)">Escolha seus produtos e finalize a compra junto com o <strong style="color:var(--gold)">agendamento</strong>.</span>
      <button class="btn btn-ghost btn-sm" onclick="Nav.go('booking')">＋ Agendar Agora</button>
    </div>
    ${prods.length === 0 ? `<div class="empty"><div class="empty-ico">🛒</div><div class="empty-t">Nenhum produto disponível</div><div class="empty-d">A loja ainda não tem produtos cadastrados. Volte em breve!</div></div>` : `
    <div class="grid g2" style="margin-bottom:22px">
      ${prods.map(p=>{
        const inSel = sel.find(s=>s.id===p.id);
        const out = Number(p.stock||0) <= 0;
        const bgImg = p.image ? `background-image:url(${p.image});background-size:cover;background-position:center;` : '';
        return `
        <div class="svc-card ${inSel?'sel':''}" style="padding:16px">
          <div class="prod-photo" style="${bgImg}">${p.image ? '' : '🛒'}</div>
          <div class="svc-name" style="font-size:.98rem">${esc(p.name)}</div>
          <div style="font-size:.75rem;color:${out?'var(--danger)':'var(--text2)'};margin-bottom:8px">${out?'⚠ Esgotado':`📦 ${p.stock} em estoque`}</div>
          <div class="svc-meta" style="padding-top:11px">
            <span class="svc-price" style="font-size:1.08rem">${fmt(p.price)}</span>
            <div style="display:flex;gap:6px;align-items:center">
              ${inSel ? `
                <button class="btn btn-ghost btn-sm" onclick="App.chgProd('${p.id}',-1)">−</button>
                <span style="font-weight:700;min-width:22px;text-align:center">${inSel.qty}</span>
                <button class="btn btn-primary btn-sm" onclick="App.chgProd('${p.id}',1)" ${inSel.qty>=p.stock?'disabled':''}>＋</button>
              ` : `
                <button class="btn btn-primary btn-sm" onclick="App.chgProd('${p.id}',1)" ${out?'disabled':''}>Adicionar</button>
              `}
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>`}
    <div class="card" style="padding:16px 20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;position:sticky;bottom:14px">
      <div>
        <div style="font-size:.72rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px">Selecionados</div>
        <div style="font-size:1.25rem;font-weight:700;font-family:var(--ft);color:var(--gold)">${fmt(prodTotal)}</div>
        <div style="font-size:.75rem;color:var(--text3)">${totalQty>0 ? totalQty+' item(ns)' : 'Nenhum produto selecionado'}</div>
      </div>
      <button class="btn btn-primary btn-lg" onclick="Nav.go('booking')">✓ Continuar com o Agendamento</button>
    </div>
  </div>
</div>`;
};

/* =====================================================
   BARBER SCREENS
===================================================== */
const rBarberSchedule = () => {
  const u = Auth.cur;
  const td = todayStr();
  const svcs = DB.services();
  const pros = DB.pros();
  
  // Find the professional record linked to this barber user
  const pro = pros.find(p => p.userId === u.id);
  if (!pro) {
    return `<div class="page"><div class="container">
      <div class="ph"><div><h1 class="ptitle">Minha Agenda</h1></div></div>
      <div style="text-align:center;padding:40px;color:var(--text2)">
        <div style="font-size:3rem;margin-bottom:16px">⚠️</div>
        <p>Seu usuário não está vinculado a um perfil de barbeiro.</p>
        <p>Entre em contato com o administrador.</p>
      </div>
    </div></div>`;
  }
  
  // Filter appointments for this barber only
  const allApts = DB.apts().filter(a => a.professionalId === pro.id && a.status !== 'cancelado');
  const upcoming = allApts.filter(a => a.date >= td).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const past = allApts.filter(a => a.date < td).sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));

  const rCard = (apt) => {
    const sv = svcs.find(s => s.id === apt.serviceId);
    const user = _tenantUsers.find(u => u.id === apt.userId);
    const dm = dayMonth(apt.date);
    const [bc, bl] = apt.status === 'confirmado' ? ['b-success', 'Confirmado'] : apt.status === 'cancelado' ? ['b-danger', 'Cancelado'] : ['b-info', 'Concluído'];
    
    return `
    <div class="apt-card">
      <div class="apt-dbox"><div class="apt-day">${dm.day}</div><div class="apt-mon">${dm.mon}</div></div>
      <div style="flex:1;min-width:0">
        <div class="apt-svc">${esc(sv?.name || 'Serviço excluído')}</div>
        <div class="apt-det">👤 ${esc(user?.name || 'Cliente')} · 🕐 ${apt.time}</div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="badge ${bc}">${bl}</span>
          <span class="tgold" style="font-weight:700;font-size:.87rem">${fmt(apt.price)}</span>
        </div>
      </div>
    </div>`;
  };

  return `<div class="page"><div class="container">
    <div class="ph"><div><h1 class="ptitle">Minha Agenda</h1><p class="psub">Seus agendamentos</p></div></div>
    <div class="tabs">
      <div class="tab active" id="tU" onclick="App.tabBarberApt('u')">Próximos (${upcoming.length})</div>
      <div class="tab" id="tH" onclick="App.tabBarberApt('h')">Histórico (${past.length})</div>
    </div>
    <div id="tcU" style="display:flex;flex-direction:column;gap:11px">
      ${upcoming.length === 0 ? `<div class="empty"><div class="empty-ico">📅</div><div class="empty-t">Nenhum agendamento futuro</div></div>` : upcoming.map(a => rCard(a)).join('')}
    </div>
    <div id="tcH" style="display:none;flex-direction:column;gap:11px">
      ${past.length === 0 ? `<div class="empty"><div class="empty-ico">📅</div><div class="empty-t">Nenhum agendamento passado</div></div>` : past.map(a => rCard(a)).join('')}
    </div>
  </div></div>`;
};

const rBarberEarnings = () => {
  const u = Auth.cur;
  const pros = DB.pros();
  const svcs = DB.services();
  
  // Find the professional record linked to this barber user
  const pro = pros.find(p => p.userId === u.id);
  if (!pro) {
    return `<div class="page"><div class="container">
      <div class="ph"><div><h1 class="ptitle">Meus Ganhos</h1></div></div>
      <div style="text-align:center;padding:40px;color:var(--text2)">
        <div style="font-size:3rem;margin-bottom:16px">⚠️</div>
        <p>Seu usuário não está vinculado a um perfil de barbeiro.</p>
        <p>Entre em contato com o administrador.</p>
      </div>
    </div></div>`;
  }
  
  const td = todayStr();
  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay());
  const weekStartStr = weekStart.toISOString().split('T')[0];
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthStartStr = monthStart.toISOString().split('T')[0];
  
  // Filter completed appointments for this barber
  const barberApts = DB.apts().filter(a => a.professionalId === pro.id && a.status === 'concluído');
  
  // Calculate earnings
  const todayApts = barberApts.filter(a => a.date === td);
  const todayTotal = todayApts.reduce((sum, a) => sum + Number(a.price || 0), 0);
  
  const weekApts = barberApts.filter(a => a.date >= weekStartStr);
  const weekTotal = weekApts.reduce((sum, a) => sum + Number(a.price || 0), 0);
  
  const monthApts = barberApts.filter(a => a.date >= monthStartStr);
  const monthTotal = monthApts.reduce((sum, a) => sum + Number(a.price || 0), 0);
  
  // Prepare chart data (last 7 days)
  const chartLabels = [];
  const chartData = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dStr = d.toISOString().split('T')[0];
    const dayName = d.toLocaleDateString('pt-BR', { weekday: 'short' });
    chartLabels.push(dayName);
    const dayTotal = barberApts.filter(a => a.date === dStr).reduce((sum, a) => sum + Number(a.price || 0), 0);
    chartData.push(dayTotal);
  }
  
  // Services table
  const recentServices = barberApts.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time)).slice(0, 20);
  
  const rServiceRow = (apt) => {
    const sv = svcs.find(s => s.id === apt.serviceId);
    const user = _tenantUsers.find(u => u.id === apt.userId);
    return `
    <tr>
      <td>${fmtDate(apt.date)}</td>
      <td>${esc(user?.name || '—')}</td>
      <td>${esc(sv?.name || '—')}</td>
      <td style="font-weight:700;color:var(--gold)">${fmt(apt.price)}</td>
    </tr>`;
  };

  return `<div class="page"><div class="container">
    <div class="ph"><div><h1 class="ptitle">Meus Ganhos</h1><p class="psub">Seus rendimentos</p></div></div>
    
    <div class="grid g3" style="margin-bottom:24px">
      <div class="card" style="text-align:center;padding:24px">
        <div style="font-size:.8rem;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Hoje</div>
        <div style="font-size:2rem;font-weight:700;font-family:var(--ft);color:var(--gold)">${fmt(todayTotal)}</div>
      </div>
      <div class="card" style="text-align:center;padding:24px">
        <div style="font-size:.8rem;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Esta Semana</div>
        <div style="font-size:2rem;font-weight:700;font-family:var(--ft);color:var(--gold)">${fmt(weekTotal)}</div>
      </div>
      <div class="card" style="text-align:center;padding:24px">
        <div style="font-size:.8rem;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Este Mês</div>
        <div style="font-size:2rem;font-weight:700;font-family:var(--ft);color:var(--gold)">${fmt(monthTotal)}</div>
      </div>
    </div>
    
    <div class="card" style="margin-bottom:24px;padding:20px">
      <h3 style="font-family:var(--ft);font-size:1.1rem;margin-bottom:16px">Últimos 7 dias</h3>
      <div style="height:250px">
        <canvas id="barberEarningsChart"></canvas>
      </div>
    </div>
    
    <div class="card" style="padding:20px">
      <h3 style="font-family:var(--ft);font-size:1.1rem;margin-bottom:16px">Serviços Realizados</h3>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="border-bottom:1px solid var(--border)">
              <th style="text-align:left;padding:12px 8px;font-size:.85rem;color:var(--text2)">Data</th>
              <th style="text-align:left;padding:12px 8px;font-size:.85rem;color:var(--text2)">Cliente</th>
              <th style="text-align:left;padding:12px 8px;font-size:.85rem;color:var(--text2)">Serviço</th>
              <th style="text-align:right;padding:12px 8px;font-size:.85rem;color:var(--text2)">Valor</th>
            </tr>
          </thead>
          <tbody>
            ${recentServices.length === 0 ? '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--text2)">Nenhum serviço realizado</td></tr>' : recentServices.map(a => rServiceRow(a)).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </div></div>`;
};

const rBarberClients = () => {
  const u = Auth.cur;
  const pros = DB.pros();
  
  // Find the professional record linked to this barber user
  const pro = pros.find(p => p.userId === u.id);
  if (!pro) {
    return `<div class="page"><div class="container">
      <div class="ph"><div><h1 class="ptitle">Meus Clientes</h1></div></div>
      <div style="text-align:center;padding:40px;color:var(--text2)">
        <div style="font-size:3rem;margin-bottom:16px">⚠️</div>
        <p>Seu usuário não está vinculado a um perfil de barbeiro.</p>
        <p>Entre em contato com o administrador.</p>
      </div>
    </div></div>`;
  }
  
  // Get all appointments for this barber
  const barberApts = DB.apts().filter(a => a.professionalId === pro.id);
  
  // Get unique clients
  const clientMap = new Map();
  barberApts.forEach(apt => {
    if (!clientMap.has(apt.userId)) {
      const user = _tenantUsers.find(u => u.id === apt.userId);
      if (user) {
        const clientApts = barberApts.filter(a => a.userId === apt.userId);
        const totalSpent = clientApts.reduce((sum, a) => sum + Number(a.price || 0), 0);
        const lastVisit = clientApts.sort((a, b) => b.date.localeCompare(a.date))[0];
        clientMap.set(apt.userId, {
          ...user,
          totalSpent,
          visitCount: clientApts.length,
          lastVisit: lastVisit?.date || ''
        });
      }
    }
  });
  
  const clients = Array.from(clientMap.values()).sort((a, b) => b.lastVisit.localeCompare(a.lastVisit));
  
  const rClientCard = (client) => {
    const ac = avColor(client.name);
    const tc = ac === '#C9A227' ? '#000' : '#fff';
    return `
    <div class="card" style="padding:16px;display:flex;align-items:center;gap:14px">
      <div class="uavatar" style="background:${ac};color:${tc};width:48px;height:48px;font-size:1.1rem">${initials(client.name)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:1rem;margin-bottom:4px">${esc(client.name)}</div>
        <div style="font-size:.85rem;color:var(--text2)">
          ${client.phone ? esc(client.phone) : esc(client.email)}
        </div>
        <div style="font-size:.8rem;color:var(--text3);margin-top:4px">
          ${client.visitCount} visita${client.visitCount !== 1 ? 's' : ''} · Última: ${fmtDate(client.lastVisit)}
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:700;color:var(--gold);font-size:1rem">${fmt(client.totalSpent)}</div>
        <div style="font-size:.75rem;color:var(--text2)">Total gasto</div>
      </div>
    </div>`;
  };

  return `<div class="page"><div class="container">
    <div class="ph"><div><h1 class="ptitle">Meus Clientes</h1><p class="psub">${clients.length} cliente${clients.length !== 1 ? 's' : ''}</p></div></div>
    <div style="display:flex;flex-direction:column;gap:12px">
      ${clients.length === 0 ? `<div class="empty"><div class="empty-ico">👥</div><div class="empty-t">Nenhum cliente ainda</div></div>` : clients.map(c => rClientCard(c)).join('')}
    </div>
  </div></div>`;
};

/* =====================================================
   ADMIN SCREENS
===================================================== */
const rAdmLayout = (active, content) => {
  const items=[
    {id:'admin',i:'◈',l:'Dashboard'},
    {id:'admin-services',i:'✦',l:'Serviços'},
    {id:'admin-barbers',i:'✂',l:'Barbeiros'},
    {id:'admin-store',i:'🛒',l:'Loja'},
    {id:'admin-appointments',i:'📅',l:'Agendamentos'},
    {id:'admin-clients',i:'👥',l:'Clientes'},
    {id:'admin-reports',i:'📊',l:'Relatórios'},
    {id:'admin-dreport',i:'🧾',l:'Relatório Detalhado'},
    {id:'admin-recon',i:'⇄',l:'Conciliação'},
    {id:'admin-pix',i:'⚡',l:'Configurações PIX'},
    {id:'admin-reminders',i:'💬',l:'Lembretes Whats'},
    {id:'admin-settings',i:'⚙️',l:'Minha Conta'},
  ];
  const showTenantEditor = Auth.isAdmin() && DB.getBarbeariaId();
  return `
<div class="adm-layout">
  <div class="adm-mob-nav">
    ${items.map(it=>`<button class="btn ${active===it.id?'btn-active':''} btn-sm" onclick="Nav.go('${it.id}')">${it.i} <span>${it.l}</span></button>`).join('')}
  </div>
  <aside class="adm-sidebar">
    <div class="adm-sidebar-brand" id="admBrandLogo" onclick="App.changeLogoQuick('${DB.getBarbeariaId()}')" title="Alterar Logo">
      <div class="adm-logo-wrap">
        ${renderTenantLogo(_tenantInfo?.name || 'Painel Barbearia', 'adm-logo-img') || '<div class="adm-logo-placeholder">💈</div>'}
        <div class="adm-logo-overlay">
          <span style="font-size:1.4rem">📷</span>
          <span style="font-size:0.75rem;font-weight:600;margin-top:4px">Alterar Logo</span>
        </div>
      </div>
    </div>
    <div class="adm-st">Painel Barbearia</div>
    ${items.map(it=>`<a href="#${it.id}" class="adm-nav-item ${active===it.id?'active':''}" onclick="Nav.go('${it.id}'); return false;">${it.i} <span>${it.l}</span></a>`).join('')}
  </aside>
  <main class="adm-content">${content}</main>
</div>`;
};

const rAdmDashCal = () => {
  const v = App._dashCalView || 'dia';
  const cd = App._dashCalDate || new Date();
  
  // Calculate days to show
  const days = [];
  if(v === 'dia') {
    days.push(new Date(cd));
  } else {
    // Semana starts on Sunday
    const d = new Date(cd);
    const day = d.getDay();
    const diff = d.getDate() - day;
    const startOfWeek = new Date(d.setDate(diff));
    for(let i=0; i<7; i++) {
      const nd = new Date(startOfWeek);
      nd.setDate(startOfWeek.getDate() + i);
      days.push(nd);
    }
  }

  const dNames = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const p2 = n => n.toString().padStart(2,'0');
  const dStr = d => `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;

  const allApts = DB.apts().filter(a => a.status !== 'cancelado');
  const pros = DB.pros();
  const svcs = DB.services();

  // Generate random non-repeating colors for each appointment card
  const usedColors = new Set();
  const getRandomCardColor = () => {
    const colors = [
      '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#0ea5e9', '#f43f5e',
      '#6366f1', '#14b8a6', '#f97316', '#84cc16', '#06b6d4', '#d946ef', '#eab308'
    ];
    const availableColors = colors.filter(c => !usedColors.has(c));
    if (availableColors.length === 0) {
      usedColors.clear();
      return colors[Math.floor(Math.random() * colors.length)];
    }
    const color = availableColors[Math.floor(Math.random() * availableColors.length)];
    usedColors.add(color);
    return color;
  };

  // Create grid lines (07:00 to 22:00)
  const startHour = 7;
  const endHour = 22;
  const hours = [];
  for(let i=startHour; i<=endHour; i++) hours.push(i);

  const calHtml = `
  <div class="dash-cal-wrap">
    <div class="dash-cal-toolbar">
      <div class="dash-cal-nav">
        <button class="btn btn-ghost" onclick="App.navDashCal(-1)">◀</button>
        <span class="dash-cal-title">${v === 'dia' ? `${dNames[cd.getDay()]}, ${p2(cd.getDate())}/${p2(cd.getMonth()+1)}` : `${p2(days[0].getDate())}/${p2(days[0].getMonth()+1)} - ${p2(days[6].getDate())}/${p2(days[6].getMonth()+1)}`}</span>
        <button class="btn btn-ghost" onclick="App.navDashCal(1)">▶</button>
      </div>
      <div class="dash-cal-views">
        <button class="btn btn-sm ${v==='dia'?'btn-primary':'btn-ghost'}" onclick="App.setDashCalView('dia')">Dia</button>
        <button class="btn btn-sm ${v==='semana'?'btn-primary':'btn-ghost'}" onclick="App.setDashCalView('semana')">Semana</button>
      </div>
    </div>
    
    <div class="dash-cal-scrollable-container">
      <div class="dash-cal-header">
        <div class="dash-cal-header-spacer"></div>
        <div class="dash-cal-days">
          ${days.map(d => `<div class="dash-cal-day-header ${dStr(d)===dStr(new Date())?'active':''}">${dNames[d.getDay()]}<br><span style="font-size:.75rem;font-weight:400">${p2(d.getDate())}/${p2(d.getMonth()+1)}</span></div>`).join('')}
        </div>
      </div>
  
      <div class="dash-cal-body">
        <div class="dash-cal-time-col">
          ${hours.map(h => `<div class="dash-cal-time-cell">${p2(h)}:00</div>`).join('')}
        </div>
        <div class="dash-cal-days">
          ${days.map(d => {
            const ds = dStr(d);
            const dApts = allApts.filter(a => a.date === ds);
            
            // Calculate overlapping appointments and their positions
            const processedApts = dApts.map(apt => {
              const [h,m] = apt.time.split(':').map(Number);
              if(h < startHour || h > endHour) return null;
              
              const sv = svcs.find(s => s.id === apt.serviceId);
              const dur = sv ? Number(sv.duration) : 30;
              
              const startMinutes = h * 60 + m;
              const endMinutes = startMinutes + dur;
              
              return {
                ...apt,
                startMinutes,
                endMinutes,
                top: (h - startHour) * 90 + (m * 1.5),
                height: dur * 1.5
              };
            }).filter(Boolean);
            
            // Group overlapping appointments
            const groups = [];
            processedApts.forEach(apt => {
              let added = false;
              for (let group of groups) {
                const overlaps = group.some(g => 
                  !(apt.endMinutes <= g.startMinutes || apt.startMinutes >= g.endMinutes)
                );
                if (overlaps) {
                  group.push(apt);
                  added = true;
                  break;
                }
              }
              if (!added) {
                groups.push([apt]);
              }
            });
            
            // Calculate positions for each group
            groups.forEach(group => {
              const count = group.length;
              group.forEach((apt, idx) => {
                apt.left = (idx / count) * 100;
                apt.width = 100 / count;
              });
            });
            
            let evs = '';
            processedApts.forEach(apt => {
              const sv = svcs.find(s => s.id === apt.serviceId);
              const pr = pros.find(p => p.id === apt.professionalId);
              
              // Use random non-repeating color for each card
              const baseColor = getRandomCardColor();
              
              const isDone = apt.status === 'concluido';
              const bg = isDone ? 'rgba(34,197,94,0.15)' : `${baseColor}22`;
              const border = isDone ? '#22c55e' : baseColor;
              const textC = isDone ? '#4ade80' : baseColor;
              const clName = apt.userId ? _tenantUsers.find(u=>u.id===apt.userId)?.name || 'Cliente' : apt.clientName || 'Cliente';
              const [h,m] = apt.time.split(':').map(Number);
              
              evs += `<div class="dash-cal-event" style="top:${apt.top}px;height:${apt.height}px;left:${apt.left}%;width:${apt.width}%;background:${bg};border-left-color:${border};opacity:${isDone?0.8:1}" onclick="App.dashAptClick('${apt.id}')">
                <div class="dash-cal-event-title" style="color:${textC}">${isDone ? '✓ ' : ''}${esc(clName)}</div>
                <div class="dash-cal-event-sub" style="color:${textC}">${esc(sv?.name||'—')} às ${p2(h)}:${p2(m)}</div>
              </div>`;
            });
            
            return `<div class="dash-cal-day-col">
              <div class="dash-cal-grid-lines">
                ${hours.map(() => '<div class="dash-cal-grid-line"></div>').join('')}
              </div>
              ${evs}
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>
  </div>`;

  return calHtml;
};

const rAdmDash = () => {
  const all=DB.apts(), pros=DB.pros(), svcs=DB.services();
  const td=todayStr();
  const rev=all.filter(a=>a.status!=='cancelado').reduce((s,a)=>s+Number(a.price||0),0);
  const conf=all.filter(a=>a.status==='confirmado'&&a.date>=td);
  const pixPend=all.filter(a=>a.pixStatus==='pendente'&&a.status!=='cancelado');
  const pixOk=all.filter(a=>a.pixStatus==='pago');
  const hasPix=!!(_tenantInfo?.pixConfig?.chave);

  return rAdmLayout('admin',`
  <div class="ph"><div><h1 class="ptitle">Dashboard</h1><p class="psub">${_tenantInfo?.name||''}</p></div><button class="btn btn-primary" onclick="App.openAdmBkModal()">＋ Novo Agendamento</button></div>
  <div class="stats-grid">
    <div class="stat-card"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><span class="tsm tmuted" style="font-weight:700">Total Agendamentos</span></div><div class="scv">${all.length}</div></div>
    <div class="stat-card"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><span class="tsm tmuted" style="font-weight:700">Receita Total</span></div><div class="scv" style="color:var(--success)">${fmt(rev)}</div></div>
    <div class="stat-card"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><span class="tsm tmuted" style="font-weight:700">Confirmados Futuros</span></div><div class="scv" style="color:var(--info)">${conf.length}</div></div>
    ${hasPix?`<div class="stat-card" style="border-color:rgba(245,158,11,.35)"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><span class="tsm tmuted" style="font-weight:700">⚡ PIX Aguardando</span></div><div class="scv" style="color:var(--warning)">${pixPend.length}</div></div>
    <div class="stat-card" style="border-color:rgba(34,197,94,.3)"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><span class="tsm tmuted" style="font-weight:700">✅ PIX Confirmados</span></div><div class="scv" style="color:var(--success)">${pixOk.length}</div></div>`:''}
  </div>
  ${rAdmDashCal()}
  ${!hasPix?`<div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.3);border-radius:var(--r);padding:14px 18px;display:flex;align-items:center;gap:12px;margin-bottom:20px">
    <span style="font-size:1.4rem">⚡</span>
    <div style="flex:1"><div style="font-weight:600;font-size:.9rem">PIX não configurado</div><div style="font-size:.8rem;color:var(--text2)">Configure sua chave PIX para oferecer pagamento via QR Code aos clientes.</div></div>
    <button class="btn btn-warning btn-sm" onclick="Nav.go('admin-pix')" style="background:var(--warning);color:#000;white-space:nowrap">Configurar agora</button>
  </div>`:''}`);
};

const rAdmServices = () => {
  const svcs=DB.services();
  return rAdmLayout('admin-services',`
  <div class="ph">
    <div><h1 class="ptitle">Gerenciar Serviços</h1></div>
    <button class="btn btn-primary" onclick="App.openSvcModal()">＋ Novo Serviço</button>
  </div>
  <div class="grid g2">
    ${svcs.map(s=>`
    <div class="card card-hover">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:11px">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="svc-icon" style="width:38px;height:38px;margin:0;font-size:1.05rem;flex-shrink:0">${svcIcon(s.name)}</div>
          <div><div style="font-weight:700;font-family:var(--ft)">${esc(s.name)}</div><div style="font-size:.75rem;color:var(--text2)">${s.duration} min</div></div>
        </div>
        <div style="display:flex;gap:5px;flex-shrink:0">
          <button class="btn btn-ghost btn-sm btn-icon" onclick="App.openSvcModal('${s.id}')">✎</button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="App.delSvc('${s.id}')">✕</button>
        </div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding-top:11px;border-top:1px solid var(--border)">
        <span class="tgold" style="font-family:var(--ft);font-size:1.2rem;font-weight:700">${fmt(s.price)}</span>
      </div>
    </div>`).join('')}
  </div>`);
};

const rAdmBarbers = () => {
  const pros=DB.pros();
  return rAdmLayout('admin-barbers',`
  <div class="ph">
    <div><h1 class="ptitle">Gerenciar Barbeiros</h1></div>
    <button class="btn btn-primary" onclick="App.openBrbModal()">＋ Novo Barbeiro</button>
  </div>
  <div class="grid g2">
    ${pros.map(p=>{
      const ac=avColor(p.name), tc=ac==='#C9A227'?'#000':'#fff';
      const bgImg = p.photo ? `background-image:url(${p.photo});background-size:cover;background-position:center;` : '';
      const linkedUser = _tenantUsers.find(u => u.id === p.userId);
      return `
      <div class="card card-hover">
        <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:14px">
          <div class="brb-av" style="background:${ac};color:${tc};flex-shrink:0;${bgImg}">${p.photo ? '' : initials(p.name)}</div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:7px">
              <div>
                <div style="font-weight:700;font-family:var(--ft);font-size:1rem">${esc(p.name)}</div>
                <div style="font-size:.75rem;color:var(--text2)">🕐 ${formatWorkingHours(p.workingHours)}</div>
                ${linkedUser ? `<div style="font-size:.75rem;color:var(--success);margin-top:4px">✓ Vinculado a: ${esc(linkedUser.name)}</div>` : `<div style="font-size:.75rem;color:var(--warning);margin-top:4px">⚠ Sem usuário vinculado</div>`}
              </div>
              <div style="display:flex;gap:5px;flex-shrink:0">
                <button class="btn btn-ghost btn-sm btn-icon" onclick="App.openBrbModal('${p.id}')">✎</button>
                <button class="btn btn-danger btn-sm btn-icon" onclick="App.delBrb('${p.id}')">✕</button>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    }).join('')}
  </div>`);
};

const rAdmStore = () => {
  const prods = DB.products();
  return rAdmLayout('admin-store',`
  <div class="ph">
    <div><h1 class="ptitle">🛒 Loja</h1><p class="psub">Gerencie os produtos vendidos na barbearia</p></div>
    <button class="btn btn-primary" onclick="App.openProdModal()">＋ Novo Produto</button>
  </div>
  ${prods.length === 0 ? `<div class="empty"><div class="empty-ico">🛒</div><div class="empty-t">Nenhum produto cadastrado</div><div class="empty-d">Cadastre produtos como pomadas, shampoos, acessórios etc. Eles aparecerão na tela de agendamento do cliente.</div></div>` : `
  <div class="grid g2">
    ${prods.map(p=>{
      const bgImg = p.image ? `background-image:url(${p.image});background-size:cover;background-position:center;` : '';
      const out = Number(p.stock || 0) <= 0;
      return `
      <div class="card card-hover">
        <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:14px">
          <div class="prod-img" style="${bgImg}">${p.image ? '' : '🛒'}</div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:7px">
              <div style="min-width:0">
                <div style="font-weight:700;font-family:var(--ft);font-size:1rem">${esc(p.name)}</div>
                <div style="font-size:.75rem;color:${out?'var(--danger)':'var(--text2)'};margin-top:4px">${out ? '⚠ Esgotado' : `📦 ${p.stock} em estoque`}</div>
              </div>
              <div style="display:flex;gap:5px;flex-shrink:0">
                <button class="btn btn-ghost btn-sm btn-icon" onclick="App.openProdModal('${p.id}')">✎</button>
                <button class="btn btn-danger btn-sm btn-icon" onclick="App.delProd('${p.id}')">✕</button>
              </div>
            </div>
          </div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding-top:11px;border-top:1px solid var(--border)">
          <span class="tgold" style="font-family:var(--ft);font-size:1.2rem;font-weight:700">${fmt(p.price)}</span>
          <span class="badge ${out?'b-danger':'b-success'}" style="font-size:.65rem">${out?'Esgotado':'Em estoque'}</span>
        </div>
      </div>`;
    }).join('')}
  </div>`}
  `);
};

const rAdmApts = () => {
  const all = [...DB.apts()].sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
  const hasPix = !!(_tenantInfo?.pixConfig?.chave);
  const pros = DB.pros();

  const period = App._aptPeriod || 'todo';
  const cd = App._aptDate || new Date();
  const barberId = App._aptBarber || '';

  const p2 = n => n.toString().padStart(2, '0');
  const dStr = d => `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;

  let filtered = all;
  if(period === 'dia') {
    const ds = dStr(cd);
    filtered = filtered.filter(a => a.date === ds);
  } else if(period === 'semana') {
    const start = new Date(cd);
    start.setDate(cd.getDate() - cd.getDay());
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const s = dStr(start), e = dStr(end);
    filtered = filtered.filter(a => a.date >= s && a.date <= e);
  } else if(period === 'mes') {
    const ym = `${cd.getFullYear()}-${p2(cd.getMonth()+1)}`;
    filtered = filtered.filter(a => a.date.startsWith(ym));
  }

  if(barberId) {
    filtered = filtered.filter(a => a.professionalId === barberId);
  }

  const emEspera = filtered.filter(a => a.status === 'confirmado');
  const concluidos = filtered.filter(a => a.status === 'concluido');
  const cancelados = filtered.filter(a => a.status === 'cancelado');

  const dNames = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  let periodLabel = 'Todo Intervalo';
  if(period === 'dia') {
    periodLabel = `${dNames[cd.getDay()]}, ${p2(cd.getDate())}/${p2(cd.getMonth()+1)}/${cd.getFullYear()}`;
  } else if(period === 'semana') {
    const start = new Date(cd);
    start.setDate(cd.getDate() - cd.getDay());
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    periodLabel = `${p2(start.getDate())}/${p2(start.getMonth()+1)} - ${p2(end.getDate())}/${p2(end.getMonth()+1)}/${end.getFullYear()}`;
  } else if(period === 'mes') {
    periodLabel = `${MONTHS[cd.getMonth()]} ${cd.getFullYear()}`;
  }

  const filterBar = `
  <div class="apt-filter-bar">
    <div class="apt-filter-period">
      <button class="btn btn-ghost" ${period === 'todo' ? 'disabled style="opacity:.3"' : ''} onclick="App.navAptDate(-1)">◀</button>
      <span class="apt-filter-title">${periodLabel}</span>
      <button class="btn btn-ghost" ${period === 'todo' ? 'disabled style="opacity:.3"' : ''} onclick="App.navAptDate(1)">▶</button>
    </div>
    <div class="apt-filter-seg">
      <button class="btn btn-sm ${period==='dia'?'btn-primary':'btn-ghost'}" onclick="App.setAptPeriod('dia')">Dia</button>
      <button class="btn btn-sm ${period==='semana'?'btn-primary':'btn-ghost'}" onclick="App.setAptPeriod('semana')">Semana</button>
      <button class="btn btn-sm ${period==='mes'?'btn-primary':'btn-ghost'}" onclick="App.setAptPeriod('mes')">Mês</button>
      <button class="btn btn-sm ${period==='todo'?'btn-primary':'btn-ghost'}" onclick="App.setAptPeriod('todo')">Todo Intervalo</button>
    </div>
    <select class="fc apt-filter-barber" onchange="App.setAptBarber(this.value)" title="Filtrar por barbeiro">
      <option value="">Todos os barbeiros</option>
      ${pros.map(p => `<option value="${p.id}" ${barberId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
    </select>
  </div>`;

  const renderSection = (title, apts, color, icon) => `
    <div style="margin-bottom: 40px;">
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 18px;">
        <div style="width: 40px; height: 40px; background: ${color}15; border: 1px solid ${color}33; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 1.2rem;">${icon}</div>
        <div>
          <h2 style="font-family: var(--ft); font-size: 1.25rem; letter-spacing: 0.5px;">${title}</h2>
          <div style="font-size: 0.75rem; color: var(--text2); font-weight: 600; text-transform: uppercase;">${apts.length} agendamento${apts.length !== 1 ? 's' : ''}</div>
        </div>
      </div>
      <div class="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Cliente</th><th>Serviço</th><th>Barbeiro</th><th>Data</th><th>Hora</th><th>Status</th><th>Pagamento</th><th>Valor</th>${hasPix ? '<th>PIX</th>' : ''}<th>Ações</th>
            </tr>
          </thead>
          <tbody>${rAptRows(apts)}</tbody>
        </table>
      </div>
    </div>
  `;

  return rAdmLayout('admin-appointments', `
    <div class="ph"><div><h1 class="ptitle">Gerenciar Agendamentos</h1><p class="psub">Visualize e controle os horários da sua barbearia</p></div><button class="btn btn-primary" onclick="App.openAdmBkModal()">＋ Novo Agendamento</button></div>
    ${filterBar}
    ${filtered.length === 0 ? `<div class="empty"><div class="empty-ico">📅</div><div class="empty-t">Nenhum agendamento no período</div><div class="empty-d">Ajuste os filtros de período ou barbeiro.</div></div>` : `
      ${renderSection('Em Espera', emEspera, '#3b82f6', '⏳')}
      ${renderSection('Concluídos', concluidos, '#22c55e', '✅')}
      ${renderSection('Cancelados', cancelados, '#ef4444', '✕')}
    `}
  `);
};

const rAptRows = (apts) => {
  const hasPix=!!(_tenantInfo?.pixConfig?.chave);
  if(!apts.length) return `<tr><td colspan="${hasPix ? 11 : 10}" style="text-align:center;padding:36px;color:var(--text2)">Nenhum agendamento encontrado.</td></tr>`;
  const svcs=DB.services(), pros=DB.pros();
  return apts.map(apt=>{
    const sv=svcs.find(s=>s.id===apt.serviceId), pr=pros.find(p=>p.id===apt.professionalId), usr=_tenantUsers.find(u=>u.id===apt.userId);
    const [bc,bl]=apt.status==='confirmado'?['b-success','Confirmado']:apt.status==='cancelado'?['b-danger','Cancelado']:['b-info','Concluído'];
    // PIX badge
    let pixBadge='';
    if(hasPix&&apt.pixStatus==='pago') pixBadge=`<span class="badge b-success" style="font-size:.65rem">✅ PIX Pago</span>`;
    else if(hasPix&&apt.pixStatus==='pendente') pixBadge=`<span class="badge b-warning" style="font-size:.65rem">⏳ Aguardando PIX</span>`;
    else if(hasPix) pixBadge=`<span class="badge b-grey" style="font-size:.65rem">— Sem PIX</span>`;

    // Forma de pagamento
    const curPay = apt.payMethod || '';
    const payBadge = curPay
      ? `<span class="badge ${PAY_BADGE(curPay)}" style="font-size:.65rem">${PAY_ICON(curPay)} ${PAY_LABEL(curPay)}</span>`
      : `<span class="badge b-grey" style="font-size:.65rem">— Sem registro</span>`;
    const payBtns = PAY_METHODS.map(p=>`
      <button class="btn btn-xs ${curPay===p.v ? 'btn-primary' : 'btn-ghost'}" onclick="App.setPayMethod('${apt.id}','${p.v}')" title="Marcar como ${p.l}">${p.i} ${p.l}</button>`).join('');

    const cleanPhone = (usr?.phone || '').replace(/\D/g, '');
    const waLink = cleanPhone ? `https://wa.me/55${cleanPhone.length > 11 ? cleanPhone.slice(-11) : cleanPhone}` : null;
    
    // Use clientName if available, otherwise use user name, otherwise show dash
    const clientName = apt.clientName || usr?.name || '—';

    // Valor (com desconto quando aplicado)
    const hasDisc = Number(apt.discount || 0) > 0;
    const valCol = hasDisc
      ? `<div style="line-height:1.5">
          <span style="text-decoration:line-through;color:var(--text3);font-size:.78rem">${fmt(apt.originalPrice || apt.price)}</span>
          <span style="font-weight:700;color:var(--gold)">${fmt(apt.price)}</span><br>
          <span class="badge b-gold" style="font-size:.6rem;margin-top:3px">-${fmt(apt.discount)}</span>
        </div>`
      : `<span style="font-weight:700">${fmt(apt.price)}</span>`;

    return `<tr>
      <td>${esc(clientName)}</td><td>${esc(sv?.name||'—')}</td><td>${esc(pr?.name||'—')}</td>
      <td>${fmtDate(apt.date)}</td><td>${apt.time}</td>
      <td><span class="badge ${bc}">${bl}</span></td>
      <td>${payBadge}</td>
      <td>${valCol}</td>
      ${hasPix ? `<td>${pixBadge}</td>` : ''}
      <td>
        <div style="display:flex;flex-direction:column;gap:5px">
          <div style="display:flex;gap:4px;flex-wrap:wrap">${payBtns}</div>
          <div style="display:flex;gap:4px;flex-wrap:wrap">
            ${waLink ? `<a href="${waLink}" target="_blank" class="btn btn-xs" style="background:#25d366;color:#fff;gap:4px">${wsIcon} Contato</a>` : ''}
            ${apt.status!=='cancelado'?`<button class="btn btn-xs btn-danger" onclick="App.admCancel('${apt.id}')">Cancelar</button>`:''}
            ${apt.status==='confirmado'?`<button class="btn btn-xs btn-success" onclick="App.askDiscount('${apt.id}')">Concluir</button>`:''}
            <button class="btn btn-xs" style="background:#ef4444;color:#fff" onclick="App.admDelete('${apt.id}')">Excluir</button>
            ${hasPix&&apt.pixStatus==='pendente'?`<button class="btn btn-xs" style="background:var(--warning);color:#000" onclick="App.admMarkPixPaid('${apt.id}')">✓ PIX Pago</button>`:''}
          </div>
        </div>
      </td>
    </tr>`;
  }).join('');
};

const rAdmClients = () => {
  const clients = _tenantUsers.filter(u => u.role !== 'superadmin' && u.role !== 'admin');
  clients.sort((a,b) => (a.name||'').localeCompare(b.name||''));

  return rAdmLayout('admin-clients', `
  <div class="ph"><div><h1 class="ptitle">Clientes</h1><p class="psub">Gerencie seus clientes e veja o histórico</p></div><button class="btn btn-primary" onclick="App.openAdmNewClientModal()">＋ Novo Cliente</button></div>
  <div class="tbl-wrap">
    <table>
      <thead>
        <tr><th>Nome</th><th>E-mail</th><th>Telefone</th><th>Ações</th></tr>
      </thead>
      <tbody>
        ${clients.length ? clients.map(c => {
          const ac=avColor(c.name); const tc=ac==='#C9A227'?'#000':'#fff';
          const cleanPhone = (c.phone || '').replace(/\D/g, '');
          const waLink = cleanPhone ? `https://wa.me/55${cleanPhone.length > 11 ? cleanPhone.slice(-11) : cleanPhone}` : null;
          return `<tr>
            <td>
              <div style="display:flex;align-items:center;gap:10px">
                <div class="uavatar" style="background:${ac};color:${tc}">${initials(c.name)}</div>
                <strong style="cursor:pointer;color:var(--text);transition:var(--tr)" onmouseover="this.style.color='var(--gold)'" onmouseout="this.style.color='var(--text)'" onclick="App.openClientHistory('${c.id}')">${esc(c.name)}</strong>
              </div>
            </td>
            <td>${esc(c.email)}</td>
            <td>${esc(c.phone||'—')}</td>
            <td>
              <div style="display:flex;gap:5px;flex-wrap:wrap">
                <button class="btn btn-ghost btn-sm" onclick="App.openClientHistory('${c.id}')">Ver Histórico</button>
                ${waLink ? `<a href="${waLink}" target="_blank" class="btn btn-sm" style="background:#25d366;color:#fff;gap:5px">${wsIcon} Contato</a>` : ''}
              </div>
            </td>
          </tr>`;
        }).join('') : `<tr><td colspan="4" style="text-align:center;padding:36px;color:var(--text2)">Nenhum cliente encontrado.</td></tr>`}
      </tbody>
    </table>
  </div>`);
};

/* =====================================================
   ADMIN PIX CONFIG
===================================================== */
const rAdmPix = () => {
  const cfg = _tenantInfo?.pixConfig || {};
  const tipos = [
    {v:'cpf',l:'CPF (ex: 123.456.789-09)'},
    {v:'cnpj',l:'CNPJ (ex: 12.345.678/0001-00)'},
    {v:'telefone',l:'Telefone (ex: +5511999999999)'},
    {v:'email',l:'E-mail'},
    {v:'aleatoria',l:'Chave Aleatória (EVP)'},
  ];
  return rAdmLayout('admin-pix',`
  <div class="ph"><div><h1 class="ptitle">⚡ Configurações PIX</h1><p class="psub">Defina sua chave PIX para receber pagamentos dos agendamentos</p></div></div>
  <div class="card" style="max-width:560px">
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:22px;padding-bottom:18px;border-bottom:1px solid var(--border)">
      <div style="width:50px;height:50px;background:rgba(245,158,11,.12);border:2px solid var(--warning);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.6rem;flex-shrink:0">⚡</div>
      <div>
        <div style="font-weight:700;font-family:var(--ft);font-size:1.05rem">Pagamento via PIX</div>
        <div style="font-size:.82rem;color:var(--text2)">Após configurar, um QR Code será gerado automaticamente em cada agendamento.</div>
      </div>
    </div>
    <form id="pixFrm">
      <div class="fg">
        <label class="flabel">Tipo de Chave PIX *</label>
        <select name="tipo" class="fc" required>
          ${tipos.map(t=>`<option value="${t.v}" ${cfg.tipo===t.v?'selected':''}>${t.l}</option>`).join('')}
        </select>
      </div>
      <div class="fg">
        <label class="flabel">Chave PIX *</label>
        <input type="text" name="chave" class="fc" value="${esc(cfg.chave||'')}" placeholder="Sua chave PIX" required>
        <div style="font-size:.75rem;color:var(--text3);margin-top:5px">Digite exatamente como cadastrou no banco, sem formatação (ex: 12345678901 para CPF)</div>
      </div>
      <div class="fg">
        <label class="flabel">Nome do Beneficiário *</label>
        <input type="text" name="nome" class="fc" value="${esc(cfg.nome||'')}" placeholder="Nome que aparece no PIX (máx 25 chars)" maxlength="25" required>
        <div style="font-size:.75rem;color:var(--text3);margin-top:5px">Sem acentos. Exibido no app do cliente ao pagar.</div>
      </div>
      <div class="fg">
        <label class="flabel">Cidade *</label>
        <input type="text" name="cidade" class="fc" value="${esc(cfg.cidade||'')}" placeholder="Cidade (máx 15 chars)" maxlength="15" required>
      </div>
      <button type="submit" class="btn btn-primary w-full btn-lg" id="btnSavePix">✓ Salvar Configurações PIX</button>
    </form>
    ${cfg.chave?`
    <div style="margin-top:20px;padding:14px;background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.25);border-radius:var(--r2)">
      <div style="font-size:.75rem;font-weight:700;color:var(--success);text-transform:uppercase;letter-spacing:.5px;margin-bottom:7px">✓ PIX Ativo</div>
      <div style="font-size:.85rem;color:var(--text2)">Chave: <strong style="color:var(--text)">${esc(cfg.chave)}</strong></div>
      <div style="font-size:.85rem;color:var(--text2)">Beneficiário: <strong style="color:var(--text)">${esc(cfg.nome||'')}</strong></div>
    </div>`:''}
  </div>`);
};

/* =====================================================
   ADMIN SETTINGS (Minha Conta)
===================================================== */
const rAdmSettings = () => {
  const u = Auth.cur;
  return rAdmLayout('admin-settings',`
  <div class="ph"><div><h1 class="ptitle">⚙️ Minha Conta</h1><p class="psub">Atualize suas informações de acesso</p></div></div>
  <div class="card" style="max-width:560px">
    <form id="settingsFrm">
      <div class="fg">
        <label class="flabel">Nome</label>
        <input type="text" name="name" class="fc" value="${esc(u?.name||'')}" required>
      </div>
      <div class="fg">
        <label class="flabel">E-mail atual</label>
        <input type="email" class="fc" value="${esc(u?.email||'')}" readonly style="background:var(--bg3);cursor:not-allowed">
      </div>
      <div class="fg">
        <label class="flabel">Novo E-mail</label>
        <input type="email" name="newEmail" class="fc" placeholder="Digite seu novo e-mail">
        <div style="font-size:.75rem;color:var(--text3);margin-top:5px">Um e-mail de verificação será enviado para o novo endereço. O e-mail só será alterado após você clicar no link de confirmação.</div>
      </div>
      <hr style="border-color:var(--border);margin:20px 0">
      <div style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:var(--text3);margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border">
        🔐 Alterar Senha
      </div>
      <div class="fg">
        <label class="flabel">Senha Atual</label>
        <input type="password" name="currentPassword" class="fc" placeholder="Digite sua senha atual">
      </div>
      <div class="fg">
        <label class="flabel">Nova Senha</label>
        <input type="password" name="newPassword" class="fc" placeholder="Digite sua nova senha (mínimo 6 caracteres)" minlength="6">
      </div>
      <div class="fg">
        <label class="flabel">Confirmar Nova Senha</label>
        <input type="password" name="confirmPassword" class="fc" placeholder="Confirme sua nova senha">
      </div>
      <div id="settingsErr" class="ferr" style="display:none;margin-bottom:12px"></div>
      <button type="submit" class="btn btn-primary w-full btn-lg" id="btnSaveSettings">✓ Salvar Alterações</button>
    </form>
  </div>`);
};

/* =====================================================
   LEMBRETES WHATSAPP
===================================================== */
const rAdmReminders = () => {
  const filter = App._remindersFilter || 'hoje';
  const today = todayStr();
  
  // Calcular data de amanhã
  const tomorrow = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  })();

  const allConfirmed = DB.apts()
    .filter(a => a.status === 'confirmado')
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  let filtered = [];
  if (filter === 'hoje') {
    filtered = allConfirmed.filter(a => a.date === today);
  } else if (filter === 'amanha') {
    filtered = allConfirmed.filter(a => a.date === tomorrow);
  } else {
    filtered = allConfirmed;
  }

  const svcs = DB.services();
  const pros = DB.pros();

  const buildWaLink = (apt) => {
    const client = _tenantUsers.find(u => u.id === apt.userId);
    if (!client?.phone) return null;
    const sv = svcs.find(s => s.id === apt.serviceId);
    const pr = pros.find(p => p.id === apt.professionalId);
    
    const cleanPhone = client.phone.replace(/\D/g, '');
    const phone = `55${cleanPhone.length > 11 ? cleanPhone.slice(-11) : cleanPhone}`;
    
    const clientName = client.name?.split(' ')[0] || client.name || 'Cliente';
    const svcName = sv?.name || 'serviço';
    const barberName = pr?.name?.split(' ')[0] || pr?.name || 'nosso profissional';
    const time = apt.time || '';
    
    let dateRef = '';
    if (apt.date === today) {
      dateRef = `hoje às ${time}`;
    } else if (apt.date === tomorrow) {
      dateRef = `amanhã às ${time}`;
    } else {
      dateRef = `no dia ${fmtDate(apt.date)} às ${time}`;
    }

    const msg = `Olá ${clientName}, tudo bem? 😊\n\nPassando para confirmar seu horário de *${svcName}* ${dateRef} com *${barberName}*. ✂️\n\nPodemos confirmar? Qualquer dúvida é só responder por aqui! 💈`;
    
    return `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(msg)}`;
  };

  const tabs = [
    { id: 'hoje', l: `Hoje`, count: allConfirmed.filter(a => a.date === today).length },
    { id: 'amanha', l: 'Amanhã', count: allConfirmed.filter(a => a.date === tomorrow).length },
    { id: 'todos', l: 'Todos Confirmados', count: allConfirmed.length },
  ];

  const rowsHtml = filtered.length === 0
    ? `<div class="empty" style="padding:52px 20px">
        <div class="empty-ico">💬</div>
        <div class="empty-t">Nenhum agendamento ${filter === 'hoje' ? 'para hoje' : filter === 'amanha' ? 'para amanhã' : 'confirmado'}</div>
        <div class="empty-d">Quando houver agendamentos confirmados, eles aparecerão aqui.</div>
      </div>`
    : filtered.map(apt => {
        const client = _tenantUsers.find(u => u.id === apt.userId);
        const sv = svcs.find(s => s.id === apt.serviceId);
        const pr = pros.find(p => p.id === apt.professionalId);
        const waLink = buildWaLink(apt);
        const hasPhone = !!client?.phone;
        const clientName = client?.name || apt.clientName || 'Cliente';
        const ac = avColor(clientName);
        const tc = ac === '#C9A227' ? '#000' : '#fff';
        
        const dateLabel = apt.date === today
          ? `<span style="color:var(--gold);font-weight:700">Hoje</span>, ${apt.time}`
          : apt.date === tomorrow
          ? `<span style="color:var(--info);font-weight:700">Amanhã</span>, ${apt.time}`
          : `${fmtDate(apt.date)}, ${apt.time}`;

        return `<tr>
          <td>
            <div style="display:flex;align-items:center;gap:10px">
              <div class="uavatar" style="background:${ac};color:${tc};flex-shrink:0">${initials(clientName)}</div>
              <div>
                <div style="font-weight:600;font-size:.9rem">${esc(clientName)}</div>
                <div style="font-size:.78rem;color:var(--text2)">${esc(client?.phone || '—')}</div>
              </div>
            </div>
          </td>
          <td>
            <div style="font-weight:500">${esc(sv?.name || '—')}</div>
            <div style="font-size:.78rem;color:var(--text2)">✂ ${esc(pr?.name || '—')}</div>
          </td>
          <td>${dateLabel}</td>
          <td>
            ${waLink
              ? `<a href="${waLink}" target="_blank" class="btn btn-sm" id="wa-btn-${apt.id}" style="background:#25d366;color:#fff;gap:6px;font-weight:700;box-shadow:0 2px 8px rgba(37,211,102,.3);transition:all .2s ease" onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 4px 14px rgba(37,211,102,.45)'" onmouseout="this.style.transform='';this.style.boxShadow='0 2px 8px rgba(37,211,102,.3)'">
                  ${wsIcon} Enviar Lembrete
                </a>`
              : `<span style="font-size:.78rem;color:var(--text3);display:flex;align-items:center;gap:5px">
                  <span>⚠</span> Sem telefone
                </span>`
            }
          </td>
        </tr>`;
      }).join('');

  return rAdmLayout('admin-reminders', `
  <div class="ph">
    <div>
      <h1 class="ptitle">💬 Lembretes WhatsApp</h1>
      <p class="psub">Envie lembretes personalizados para seus clientes com um clique — 100% gratuito</p>
    </div>
  </div>

  <!-- Informativo -->
  <div style="background:rgba(37,211,102,.07);border:1px solid rgba(37,211,102,.25);border-radius:var(--r2);padding:12px 16px;margin-bottom:22px;display:flex;align-items:center;gap:12px">
    <span style="font-size:1.3rem;flex-shrink:0">💡</span>
    <span style="font-size:.85rem;color:var(--text2)">Clique em <strong style="color:#25d366">Enviar Lembrete</strong> para abrir o WhatsApp com a mensagem já preenchida. Basta apertar <strong style="color:var(--text)">Enviar</strong> no WhatsApp.</span>
  </div>

  <!-- Filtros -->
  <div class="tabs" style="margin-bottom:22px">
    ${tabs.map(t => `
      <div class="tab ${filter === t.id ? 'active' : ''}" onclick="App.setRemindersFilter('${t.id}')" style="cursor:pointer;display:flex;align-items:center;gap:7px">
        ${t.l}
        <span style="background:${filter === t.id ? 'var(--gold)' : 'var(--bg4)'};color:${filter === t.id ? '#000' : 'var(--text2)'};border-radius:100px;padding:1px 8px;font-size:.72rem;font-weight:700;transition:all .2s">${t.count}</span>
      </div>`).join('')}
  </div>

  <!-- Tabela -->
  <div class="tbl-wrap">
    <table>
      <thead>
        <tr>
          <th>Cliente</th>
          <th>Serviço / Profissional</th>
          <th>Data &amp; Hora</th>
          <th>Ação</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  </div>
  `);
};

const rAdmReports = () => {
  const all = DB.apts();
  const pros = DB.pros();
  const svcs = DB.services();
  const now = new Date();

  const period = App._reportFilter || 'mes';
  const barberId = App._reportBarber || '';
  const svcId = App._reportService || '';
  const from = App._reportFrom || '';
  const to = App._reportTo || '';

  const getStartOfWeek = (d) => {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
  };

  const inPeriod = (dateStr) => {
    if (!dateStr) return false;
    const d = new Date(dateStr + 'T12:00:00');
    if (period === 'hoje') return d.toDateString() === now.toDateString();
    if (period === 'ontem') {
      const y = new Date(); y.setDate(now.getDate() - 1);
      return d.toDateString() === y.toDateString();
    }
    if (period === 'semana') {
      const start = getStartOfWeek(new Date()); start.setHours(0,0,0,0);
      return d >= start;
    }
    if (period === 'mes') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    if (period === 'custom') {
      if (from && dateStr < from) return false;
      if (to && dateStr > to) return false;
      return from || to; // exige ao menos um limite
    }
    return true; // todo o período
  };

  const businessMatch = (a) =>
    !barberId || a.professionalId === barberId;

  const svcMatch = (a) =>
    !svcId || a.serviceId === svcId;

  const matched = all.filter(a =>
    a.status !== 'cancelado' && inPeriod(a.date) && businessMatch(a) && svcMatch(a)
  );
  const cancellations = all.filter(a =>
    a.status === 'cancelado' && inPeriod(a.date) && businessMatch(a) && svcMatch(a)
  );

  const count = matched.length;
  const revenue = matched.reduce((s, a) => s + Number(a.price || 0), 0);
  const avgTicket = count ? revenue / count : 0;
  const concluidos = matched.filter(a => a.status === 'concluído').length;
  const totalWanted = count + cancellations.length;
  const cancelRate = totalWanted ? (cancellations.length / totalWanted) * 100 : 0;
  const clientIds = new Set();
  matched.forEach(a => { if (a.userId) clientIds.add('u:' + a.userId); else if (a.clientName) clientIds.add('c:' + a.clientName); });

  // Dados do gráfico conforme o período
  let labels = [], dataPoints = [];
  const grouped = {};
  const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  if (period === 'hoje' || period === 'ontem') {
    const d = new Date(); d.setDate(d.getDate() - (period === 'ontem' ? 1 : 0));
    const ds = d.toISOString().split('T')[0];
    labels = [fmtDate(ds)];
    dataPoints = [matched.filter(a => a.date === ds).reduce((s, a) => s + Number(a.price || 0), 0)];
  } else if (period === 'semana') {
    const start = getStartOfWeek(new Date()); start.setHours(0,0,0,0);
    const days = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
    labels = days;
    dataPoints = days.map((_, i) => {
      const dd = new Date(start); dd.setDate(dd.getDate() + i);
      const ds = dd.toISOString().split('T')[0];
      return matched.filter(a => a.date === ds).reduce((s, a) => s + Number(a.price || 0), 0);
    });
  } else if (period === 'custom') {
    const start = from ? new Date(from + 'T12:00:00') : new Date();
    const end = to ? new Date(to + 'T12:00:00') : new Date(now);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const ds = d.toISOString().split('T')[0];
      labels.push(ds.split('-')[2] + '/' + ds.split('-')[1]);
      dataPoints.push(matched.filter(a => a.date === ds).reduce((s, a) => s + Number(a.price || 0), 0));
    }
    if (labels.length > 90) { labels = labels.slice(-90); dataPoints = dataPoints.slice(-90); }
  } else if (period === 'mes') {
    const last30 = [];
    for (let i = 29; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); last30.push(d.toISOString().split('T')[0]); }
    labels = last30.map(d => d.split('-')[2] + '/' + d.split('-')[1]);
    dataPoints = last30.map(ds => matched.filter(a => a.date === ds).reduce((s, a) => s + Number(a.price || 0), 0));
  } else {
    matched.forEach(a => {
      const d = new Date(a.date + 'T12:00:00');
      const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      grouped[k] = (grouped[k] || 0) + Number(a.price || 0);
    });
    const keys = Object.keys(grouped).sort();
    labels = keys.map(k => { const [y, m] = k.split('-'); return MONTHS[+m - 1] + '/' + y.slice(2); });
    dataPoints = keys.map(k => grouped[k]);
  }

  setTimeout(() => App._drawReportChart(labels, dataPoints), 100);

  // Ranking por barbeiro
  const barberMap = {};
  matched.forEach(a => {
    const pid = a.professionalId || '';
    barberMap[pid] = barberMap[pid] || { count: 0, revenue: 0, done: 0 };
    barberMap[pid].count++;
    barberMap[pid].revenue += Number(a.price || 0);
    if (a.status === 'concluído') barberMap[pid].done++;
  });
  const barberRanking = Object.entries(barberMap)
    .map(([pid, s]) => {
      const pro = pros.find(p => p.id === pid);
      return { name: pro ? pro.name : 'Sem barbeiro', count: s.count, revenue: s.revenue, done: s.done };
    })
    .sort((a, b) => b.revenue - a.revenue);

  // Ranking por serviço
  const svcMap = {};
  matched.forEach(a => {
    const sid = a.serviceId || '';
    svcMap[sid] = svcMap[sid] || { count: 0, revenue: 0 };
    svcMap[sid].count++;
    svcMap[sid].revenue += Number(a.price || 0);
  });
  const svcRanking = Object.entries(svcMap)
    .map(([sid, s]) => {
      const sv = svcs.find(x => x.id === sid);
      return { name: sv ? sv.name : 'Sem serviço', count: s.count, revenue: s.revenue };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const PERIODS = [
    { v: 'hoje', l: 'Hoje' },
    { v: 'ontem', l: 'Ontem' },
    { v: 'semana', l: 'Esta Semana' },
    { v: 'mes', l: 'Este Mês' },
    { v: 'todos', l: 'Todo Período' }
  ];

  const footerNote = `Agendamentos ${period === 'custom' ? 'no período selecionado' : 'no período'} · ${esc(barberId ? 'barbeiro ' + (pros.find(p => p.id === barberId)?.name || 'selecionado') : 'todos os barbeiros')} · ${esc(svcId ? 'serviço ' + (svcs.find(s => s.id === svcId)?.name || 'selecionado') : 'todos os serviços')}`;

  return rAdmLayout('admin-reports', `
    <div class="ph">
      <div><h1 class="ptitle">Relatórios & Métricas</h1><p class="psub">Análise de desempenho da sua barbearia</p></div>
      <div class="tabs" style="margin-bottom:0">
        ${PERIODS.map(p => `<div class="tab ${period === p.v ? 'active' : ''}" onclick="App.changeReportFilter('${p.v}')">${p.l}</div>`).join('')}
      </div>
    </div>

    <div class="card" style="padding:16px;margin-bottom:20px">
      <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end">
        <div class="fg" style="margin-bottom:0;min-width:180px">
          <label class="flabel">Barbeiro</label>
          <select class="fc" onchange="App.changeReportBarber(this.value)">
            <option value="">Todos os barbeiros</option>
            ${pros.map(p => `<option value="${p.id}" ${p.id === barberId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select>
        </div>
        <div class="fg" style="margin-bottom:0;min-width:180px">
          <label class="flabel">Serviço</label>
          <select class="fc" onchange="App.changeReportService(this.value)">
            <option value="">Todos os serviços</option>
            ${svcs.map(s => `<option value="${s.id}" ${s.id === svcId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
          </select>
        </div>
        <div class="fg" style="margin-bottom:0">
          <label class="flabel">De</label>
          <input type="date" class="fc" id="repFrom" value="${from}" onchange="App.reportSetRange('from', this.value)">
        </div>
        <div class="fg" style="margin-bottom:0">
          <label class="flabel">Até</label>
          <input type="date" class="fc" id="repTo" value="${to}" onchange="App.reportSetRange('to', this.value)">
        </div>
        ${(barberId || svcId || period === 'custom') ? `<button class="btn btn-ghost btn-sm" onclick="App.reportResetFilters()">✕ Limpar filtros</button>` : ''}
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="scl">Agendamentos</div>
        <div class="scv">${count}</div>
        <div style="font-size:.7rem;color:var(--text3);margin-top:4px">${concluidos} concluído(s)</div>
      </div>
      <div class="stat-card">
        <div class="scl">Faturamento</div>
        <div class="scv" style="color:var(--success)">${fmt(revenue)}</div>
        <div style="font-size:.7rem;color:var(--text3);margin-top:4px">Receita bruta do período</div>
      </div>
      <div class="stat-card">
        <div class="scl">Ticket Médio</div>
        <div class="scv" style="color:var(--info)">${fmt(avgTicket)}</div>
        <div style="font-size:.7rem;color:var(--text3);margin-top:4px">Média por atendimento</div>
      </div>
      <div class="stat-card">
        <div class="scl">Cancelamentos</div>
        <div class="scv" style="color:var(--danger)">${cancellations.length}</div>
        <div style="font-size:.7rem;color:var(--text3);margin-top:4px">Taxa de cancelamento ${cancelRate.toFixed(1)}%</div>
      </div>
      <div class="stat-card">
        <div class="scl">Clientes</div>
        <div class="scv" style="color:var(--gold)">${clientIds.size}</div>
        <div style="font-size:.7rem;color:var(--text3);margin-top:4px">Atendidos no período</div>
      </div>
    </div>

    <div class="card" style="padding:20px;height:350px;margin-bottom:20px">
      <div style="font-size:.75rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:20px;display:flex;align-items:center;gap:8px">
        <span>📊</span> Evolução do Faturamento
      </div>
      <div style="height:260px;position:relative">
        <canvas id="reportChart"></canvas>
      </div>
    </div>

    <div class="g2" style="gap:20px;margin-bottom:20px">
      <div class="card" style="padding:20px">
        <div style="font-size:.75rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:16px">💈 Desempenho por Barbeiro</div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Barbeiro</th><th>Atend.</th><th>Faturamento</th></tr></thead>
            <tbody>
              ${barberRanking.length ? barberRanking.map(b => `<tr>
                <td><strong>${esc(b.name)}</strong></td>
                <td>${b.count}</td>
                <td style="font-weight:700;color:var(--success)">${fmt(b.revenue)}</td>
              </tr>`).join('') : `<tr><td colspan="3" style="text-align:center;padding:24px;color:var(--text3)">Sem dados no período.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card" style="padding:20px">
        <div style="font-size:.75rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:16px">✂ Desempenho por Serviço</div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Serviço</th><th>Qtd</th><th>Faturamento</th></tr></thead>
            <tbody>
              ${svcRanking.length ? svcRanking.map(s => `<tr>
                <td><strong>${esc(s.name)}</strong></td>
                <td>${s.count}</td>
                <td style="font-weight:700;color:var(--success)">${fmt(s.revenue)}</td>
              </tr>`).join('') : `<tr><td colspan="3" style="text-align:center;padding:24px;color:var(--text3)">Sem dados no período.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div style="font-size:.75rem;color:var(--text3);text-align:center;padding-bottom:10px">${footerNote}</div>
  `);
};

/* =====================================================
   RELATÓRIO DETALHADO (Aluguel de Cadeiras / Comissão)
===================================================== */
const DPERIODS = [
  { v: 'hoje', l: 'Hoje' },
  { v: 'ontem', l: 'Ontem' },
  { v: 'semana', l: 'Essa Semana' },
  { v: 'mes', l: 'Este Mês' },
  { v: 'mesAnterior', l: 'Mês Anterior' },
  { v: 'custom', l: 'Período Personalizado' }
];

const isDoneApt = (st) => st === 'concluido' || st === 'concluída' || st === 'concluído';

const rAdmDReport = () => {
  const all = DB.apts();
  const pros = DB.pros();
  const svcs = DB.services();

  const period = App._dreportPeriod || 'mes';
  const barberId = App._dreportBarber || '';
  const discount = Math.max(0, parseFloat(App._dreportDiscount) || 0);
  const from = App._dreportFrom || '';
  const to = App._dreportTo || '';

  const p2 = n => String(n).padStart(2, '0');
  const dStr = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  // Calcula o intervalo do período
  const now = new Date();
  let fromDate = null, toDate = null;
  if (period === 'hoje') { fromDate = new Date(now); toDate = new Date(now); }
  else if (period === 'ontem') { fromDate = addDays(now, -1); toDate = addDays(now, -1); }
  else if (period === 'semana') {
    const dow = now.getDay();
    fromDate = addDays(now, -(dow === 0 ? 6 : dow - 1));
    toDate = new Date(now);
  }
  else if (period === 'mes') { fromDate = new Date(now.getFullYear(), now.getMonth(), 1); toDate = new Date(now); }
  else if (period === 'mesAnterior') {
    fromDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    toDate = new Date(now.getFullYear(), now.getMonth(), 0);
  }
  else {
    fromDate = from ? new Date(from + 'T12:00:00') : null;
    toDate = to ? new Date(to + 'T12:00:00') : null;
  }

  const fromStr = fromDate ? dStr(fromDate) : '';
  const toStr = toDate ? dStr(toDate) : '';

  const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  let periodLabel = 'Período';
  if (period === 'hoje') periodLabel = 'Hoje';
  else if (period === 'ontem') periodLabel = 'Ontem';
  else if (period === 'semana') periodLabel = 'Esta Semana';
  else if (period === 'mes') periodLabel = `${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
  else if (period === 'mesAnterior') {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    periodLabel = `${MONTHS[prev.getMonth()]} ${prev.getFullYear()}`;
  }
  else periodLabel = `${fmtDate(fromStr)} a ${fmtDate(toStr)}`;

  const barber = pros.find(p => p.id === barberId);
  const barberName = barber ? barber.name : '';

  // Filtra atendimentos concluídos do barbeiro no período
  let rows = [];
  if (barberId) {
    rows = all.filter(a =>
      a.professionalId === barberId &&
      isDoneApt(a.status) &&
      (!fromStr || (a.date || '') >= fromStr) &&
      (!toStr || (a.date || '') <= toStr)
    ).sort((a, b) => (a.date === b.date ? (a.time || '').localeCompare(b.time || '') : (a.date || '').localeCompare(b.date || '')));
  }

  const revenue = rows.reduce((s, a) => s + Number(a.price || 0), 0);
  const count = rows.length;
  const avgTicket = count ? revenue / count : 0;
  const commission = revenue * discount / 100;
  const net = revenue - commission;

  // Dados do gráfico de evolução diária
  const chartLabels = [], chartData = [];
  if (fromStr && toStr) {
    for (let d = new Date(fromStr + 'T12:00:00'); d <= new Date(toStr + 'T12:00:00'); d = addDays(d, 1)) {
      const ds = dStr(d);
      chartLabels.push(ds.split('-')[2] + '/' + ds.split('-')[1]);
      chartData.push(rows.filter(a => a.date === ds).reduce((s, a) => s + Number(a.price || 0), 0));
    }
  }

  // Dados do gráfico de formas de pagamento
  const payMap = {};
  rows.forEach(a => {
    const k = a.payMethod || 'sem_registro';
    payMap[k] = (payMap[k] || 0) + Number(a.price || 0);
  });
  const payLabels = Object.keys(payMap);
  const payData = payLabels.map(k => payMap[k]);

  setTimeout(() => {
    App._drawDReportCharts(chartLabels, chartData, payLabels, payData);
  }, 100);

  const filterCard = `
    <div class="card" style="padding:16px;margin-bottom:20px">
      <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end">
        <div class="fg" style="margin-bottom:0;min-width:200px;flex:1">
          <label class="flabel">Barbeiro</label>
          <select class="fc" onchange="App.dReportSetBarber(this.value)">
            <option value="">Selecione o barbeiro...</option>
            ${pros.map(p => `<option value="${p.id}" ${p.id === barberId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select>
        </div>
        <div class="fg" style="margin-bottom:0;min-width:190px">
          <label class="flabel">Taxa de desconto (%)</label>
          <input type="number" id="drepDiscount" class="fc" min="0" max="100" step="0.01" value="${App._dreportDiscount || ''}" placeholder="Ex: 30" onchange="App.dReportSetDiscount(this.value)">
        </div>
        <div class="fg" style="margin-bottom:0;min-width:210px">
          <label class="flabel">Período</label>
          <select class="fc" onchange="App.dReportSetPeriod(this.value)">
            ${DPERIODS.map(p => `<option value="${p.v}" ${period === p.v ? 'selected' : ''}>${p.l}</option>`).join('')}
          </select>
        </div>
        ${period === 'custom' ? `
          <div class="fg" style="margin-bottom:0">
            <label class="flabel">De</label>
            <input type="date" class="fc" value="${from}" onchange="App.dReportSetRange('from', this.value)">
          </div>
          <div class="fg" style="margin-bottom:0">
            <label class="flabel">Até</label>
            <input type="date" class="fc" value="${to}" onchange="App.dReportSetRange('to', this.value)">
          </div>
        ` : ''}
        <button class="btn btn-primary btn-sm" onclick="App.dReportGenerate()">⚡ Gerar Relatório</button>
      </div>
    </div>`;

  if (!barberId) {
    return rAdmLayout('admin-dreport', `
      <div class="ph">
        <div><h1 class="ptitle">🧾 Relatório Detalhado</h1><p class="psub">Relatório para barbearias que alugam cadeiras e cobram uma porcentagem sobre os serviços</p></div>
      </div>
      ${filterCard}
      <div class="empty">
        <div class="empty-ico">✂️</div>
        <div class="empty-t">Selecione um barbeiro para gerar o relatório</div>
        <div class="empty-d">Escolha o barbeiro, informe a taxa de desconto (%) e o período desejado.</div>
      </div>
    `);
  }

  return rAdmLayout('admin-dreport', `
    <div class="ph">
      <div><h1 class="ptitle">🧾 Relatório Detalhado</h1><p class="psub">Faturamento e comissão do barbeiro ${esc(barberName)} · ${periodLabel}</p></div>
    </div>

    ${filterCard}

    <div class="stats-grid">
      <div class="stat-card">
        <div class="scl">Faturamento do Período</div>
        <div class="scv" style="color:var(--success)">${fmt(revenue)}</div>
        <div style="font-size:.7rem;color:var(--text3);margin-top:4px">${esc(barberName)} · ${periodLabel}</div>
      </div>
      <div class="stat-card">
        <div class="scl">Atendimentos</div>
        <div class="scv" style="color:var(--info)">${count}</div>
        <div style="font-size:.7rem;color:var(--text3);margin-top:4px">Atendimentos concluídos no período</div>
      </div>
      <div class="stat-card">
        <div class="scl">Ticket Médio</div>
        <div class="scv" style="color:var(--gold)">${fmt(avgTicket)}</div>
        <div style="font-size:.7rem;color:var(--text3);margin-top:4px">Faturamento ÷ atendimentos</div>
      </div>
      <div class="stat-card">
        <div class="scl">Valor Líquido</div>
        <div class="scv" style="color:var(--info)">${fmt(net)}</div>
        <div style="font-size:.7rem;color:var(--text3);margin-top:4px">Após taxa de ${discount.toLocaleString('pt-BR')}% (${fmt(commission)} de desconto)</div>
      </div>
    </div>

    <div class="g2" style="gap:20px;margin-bottom:20px">
      <div class="card" style="padding:20px;height:330px">
        <div style="font-size:.75rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:20px">📈 Evolução do Faturamento</div>
        <div style="height:250px;position:relative">
          <canvas id="dReportChart"></canvas>
        </div>
      </div>
      <div class="card" style="padding:20px;height:330px">
        <div style="font-size:.75rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:20px">💳 Faturamento por Forma de Pagamento</div>
        <div style="height:250px;position:relative">
          <canvas id="dReportPayChart"></canvas>
        </div>
      </div>
    </div>

    <div class="card" style="padding:20px">
      <div style="font-size:.75rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:16px;display:flex;align-items:center;gap:8px">
        <span>📋</span> Serviços Realizados no Período
        <span class="badge b-info" style="margin-left:auto">${count} atendimento${count !== 1 ? 's' : ''}</span>
      </div>
      <div class="tbl-wrap">
        <table>
          <thead>
            <tr><th>Data</th><th>Cliente</th><th>Serviço</th><th>Forma de Pagamento</th><th>Valor</th><th>Líquido p/ Barbeiro</th></tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map(a => {
              const sv = svcs.find(s => s.id === a.serviceId);
              const usr = _tenantUsers ? _tenantUsers.find(u => u.id === a.userId) : null;
              const clName = a.clientName || usr?.name || 'Cliente';
              const itemDiscount = Number(a.discount || 0);
              const pago = Number(a.price || 0);
              const itemNet = pago * (1 - discount / 100);
              return `<tr>
                <td style="white-space:nowrap">${fmtDate(a.date)}</td>
                <td><strong>${esc(clName)}</strong></td>
                <td>${esc(sv?.name || '—')}</td>
                <td>${a.payMethod ? `<span class="badge ${PAY_BADGE(a.payMethod)}">${PAY_ICON(a.payMethod)} ${PAY_LABEL(a.payMethod)}</span>` : `<span class="badge b-grey">—</span>`}</td>
                <td style="font-weight:700;color:var(--success)">${fmt(pago)}${itemDiscount > 0 ? ` <span style="font-size:.65rem;color:var(--danger);font-weight:600">(-${fmt(itemDiscount)})</span>` : ''}</td>
                <td style="font-weight:700;color:var(--info)">${fmt(itemNet)}</td>
              </tr>`;
            }).join('') : `<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text3)">Nenhum atendimento concluído no período.</td></tr>`}
          </tbody>
          ${rows.length ? `<tfoot>
            <tr>
              <td colspan="3" style="font-weight:700">Total</td>
              <td></td>
              <td style="font-weight:700;color:var(--success)">${fmt(revenue)}</td>
              <td style="font-weight:700;color:var(--info)">${fmt(net)}</td>
            </tr>
          </tfoot>` : ''}
        </table>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px">
        <span class="badge b-grey">Faturamento: ${fmt(revenue)}</span>
        <span class="badge b-warning">Taxa de desconto: ${discount.toLocaleString('pt-BR')}%</span>
        <span class="badge b-danger">Desconto: ${fmt(commission)}</span>
        <span class="badge b-success">Valor Líquido: ${fmt(net)}</span>
      </div>
    </div>
  `);
};

/* =====================================================
   CONCILIAÇÃO BANCÁRIA
===================================================== */
const reconStatusBadge = (t, result) => {
  if (t.tipo === 'D') return '<span class="badge b-grey">💸 Despesa/Taxa</span>';
  if (result.matchMap && result.matchMap[t.id]) return '<span class="badge b-success">✓ Conciliado</span>';
  return '<span class="badge b-warning">⚠ Sem correspondência</span>';
};

const reconAptName = (aptId) => {
  if (!aptId) return '';
  const apt = DB.apts().find(a => a.id === aptId);
  if (!apt) return '';
  const sv = DB.services().find(s => s.id === apt.serviceId);
  const client = _tenantUsers ? _tenantUsers.find(u => u.id === apt.userId) : null;
  const label = client?.name || _tenantUsers?.find(n => n.id === apt.userId)?.name || 'Agendamento';
  return `<div style="font-size:.75rem;color:var(--success)">↳ ${esc(label)} · ${esc(sv?.name || '')}</div>`;
};

const rAdmRecon = () => {
  if (App._reconTxs === undefined) {
    setTimeout(() => App.reconInit(), 50);
    return rAdmLayout('admin-recon', `<div style="padding:100px;text-align:center;color:var(--gold)">Carregando conciliação...</div>`);
  }

  const imports = App._reconImports || [];
  const txs = App._reconTxs || [];
  const result = App._reconResult;
  const st = App._reconState || { status: 'idle' };
  const filter = App._reconFilter || 'todos';
  const map = result && result.matchMap ? result.matchMap : {};
  const fmtCr = (t) => (t.tipo === 'D' ? '−' : '+') + fmt(t.valor);

  let rows = result ? txs.slice().sort((a, b) => String(b.data).localeCompare(String(a.data))) : [];
  if (filter === 'conciliados') rows = txs.filter(t => t.tipo === 'C' && map[t.id]);
  else if (filter === 'despesas') rows = txs.filter(t => t.tipo === 'D');
  else if (filter === 'divergencias') rows = txs.filter(t => t.tipo === 'C' && !map[t.id]);

  const stats = result ? [
    { l: 'Créditos no extrato', v: fmt(result.totalCredits || 0), c: 'var(--success)', s: `${result.creditsUnmatched.length} sem casar` },
    { l: 'Conciliado', v: fmt(result.totalConciliado || 0), c: 'var(--info)', s: `${result.conciliados.length} casamentos` },
    { l: 'Divergências', v: result.totalDivergencias || 0, c: 'var(--warning)', s: `${result.esperadosNaoRecebidos.length} não recebidos` },
    { l: 'Despesas/Taxas', v: fmt(result.totalDespesas || 0), c: 'var(--danger)', s: `${result.debitsUnmatched.length} débitos` }
  ] : [];

  const previewCard = st.status === 'preview' ? `
    <div class="card" style="margin-bottom:24px;border-color:rgba(201,162,39,.4);padding:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:14px">
        <div>
          <div style="font-weight:700;font-family:var(--ft);font-size:1.05rem">📂 Arquivo lido</div>
          <div style="font-size:.82rem;color:var(--text2)">${esc(st.fileName)} · formato <strong>${String(st.format).toUpperCase()}</strong></div>
          <div style="font-size:.82rem;color:var(--text2)">${st.txs.length} transação(ões) detectada(s) — revise e confirme a importação</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" onclick="App.reconImport()">✓ Importar ${st.txs.length} transações</button>
          <button class="btn btn-ghost" onclick="App.reconDiscard()">Cancelar</button>
        </div>
      </div>
      <div class="tbl-wrap" style="max-height:280px;overflow-y:auto">
        <table>
          <thead><tr><th>Data</th><th>Descrição</th><th>Valor</th><th>Tipo</th></tr></thead>
          <tbody>
            ${st.txs.slice(0, 15).map(t => `<tr>
              <td>${fmtDate(t.data)}</td><td>${esc(t.descricao || '—')}</td>
              <td style="font-weight:700;${t.tipo==='D'?'color:var(--danger)':'color:var(--success)'}">${fmtCr(t)}</td>
              <td><span class="badge ${t.tipo==='D'?'b-danger':'b-success'}">${t.tipo}</span></td>
            </tr>`).join('')}
            ${st.txs.length > 15 ? `<tr><td colspan="4" style="text-align:center;color:var(--text3)">… e mais ${st.txs.length - 15} transações</td></tr>` : ''}
          </tbody>
        </table>
      </div>
    </div>` : '';

  const importsCard = `
    <div class="card" style="padding:20px;margin-bottom:24px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px">
        <div style="font-weight:700;font-family:var(--ft);font-size:1.05rem">📥 Extratos importados</div>
      </div>
      ${imports.length === 0 ? '<div style="font-size:.85rem;color:var(--text2)">Nenhum extrato importado ainda.</div>' : `
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>Arquivo</th><th>Formato</th><th>Transações</th><th>Importado em</th><th></th></tr></thead>
          <tbody>
            ${imports.map(im => `<tr>
              <td>${esc(im.fileName || im.id)}</td>
              <td>${String(im.format || '').toUpperCase()}</td>
              <td>${im.count ?? '—'}</td>
              <td>${im.createdAt ? fmtDatetime(im.createdAt) : '—'}</td>
              <td><button class="btn btn-danger btn-sm" onclick="App.reconDeleteImport('${im.id}')">Excluir</button></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`}
    </div>`;

  const expectedCard = result && result.esperadosNaoRecebidos.length ? `
    <div class="card" style="margin-bottom:24px;border-color:rgba(245,158,11,.4);padding:20px">
      <div style="font-weight:700;font-family:var(--ft);font-size:1.05rem;margin-bottom:6px;color:var(--warning)">⚠️ Lançamentos internos sem recebimento no extrato</div>
      <div style="font-size:.8rem;color:var(--text2);margin-bottom:14px">Agendamentos concluídos/PIX confirmados que NÃO aparecem no extrato do banco.</div>
      ${result.esperadosNaoRecebidos.map(a => {
        const sv = DB.services().find(s => s.id === a.serviceId);
        const client = _tenantUsers.find(u => u.id === a.userId);
        return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);flex-wrap:wrap">
          <div>
            <div style="font-weight:600;font-size:.88rem">${esc(client?.name || '—')} · ${esc(sv?.name || '')}</div>
            <div style="font-size:.74rem;color:var(--text2)">${fmtDate(a.date)} · PIX: ${esc(a.pixStatus || '—')}</div>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-weight:700;color:var(--gold)">${fmt(a.price)}</span>
            <a href="#admin-appointments" class="btn btn-sm" onclick="Nav.go('admin-appointments')">Abrir</a>
          </div>
        </div>`;
      }).join('')}
    </div>` : '';

  const tabs = [
    { id: 'todos', l: `Tudo (${txs.length})` },
    { id: 'conciliados', l: `Conciliados (${result ? result.conciliados.length : 0})` },
    { id: 'divergencias', l: `Divergências (${result ? txs.filter(t => t.tipo === 'C' && !map[t.id]).length : 0})` },
    { id: 'despesas', l: `Despesas (${result ? txs.filter(t => t.tipo === 'D').length : 0})` }
  ];

  return rAdmLayout('admin-recon', `
    <div class="ph">
      <div><h1 class="ptitle">⇄ Conciliação Bancária</h1><p class="psub">Importe seu extrato e cruze com os agendamentos</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button class="btn btn-ghost btn-sm" onclick="App.reconSample('ofx')">⬇ exemplo OFX</button>
        <button class="btn btn-ghost btn-sm" onclick="App.reconSample('ofd')">⬇ exemplo OFD</button>
        <button class="btn btn-ghost btn-sm" onclick="App.reconSample('csv')">⬇ exemplo CSV</button>
        <input type="file" id="reconFile" accept=".ofx,.ofd,.csv,text/csv,text/plain,application/xml" style="display:none" onchange="App.reconFileSelected(event)">
        <button class="btn btn-primary" onclick="document.getElementById('reconFile').click()">📥 Importar Extrato</button>
      </div>
    </div>

    ${previewCard}

    <div class="stats-grid">
      ${stats.map(s => `<div class="stat-card"><div class="scl">${s.l}</div><div class="scv" style="color:${s.c}">${s.v}</div><div style="font-size:.7rem;color:var(--text3);margin-top:4px">${s.s}</div></div>`).join('')}
    </div>

    ${expectedCard}

    ${importsCard}

    <div class="card" style="padding:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px">
        <div style="font-weight:700;font-family:var(--ft);font-size:1.05rem">Movimentações do extrato</div>
        ${txs.length === 0 ? '' : `<button class="btn btn-ghost btn-sm" onclick="App.reconRun()">↻ Recalcular</button>`}
      </div>
      <div class="tabs" style="margin-bottom:16px">
        ${tabs.map(t => `<div class="tab ${filter === t.id ? 'active' : ''}" onclick="App.reconSelectFilter('${t.id}')">${t.l}</div>`).join('')}
      </div>
      ${rows.length === 0 ? `<div class="empty"><div class="empty-ico">⇄</div><div class="empty-t">Nenhuma movimentação neste filtro.</div></div>` : `
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>Data</th><th>Descrição</th><th>Valor</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${rows.map(t => `<tr>
              <td>${fmtDate(t.date)}</td>
              <td>${esc(t.descricao || '—')}<br>${reconAptName(t.aptId || map[t.id])}</td>
              <td style="font-weight:700;${t.tipo==='D'?'color:var(--danger)':'color:var(--success)'}">${fmtCr(t)}</td>
              <td>${reconStatusBadge(t, result)}</td>
              <td>
                ${t.tipo === 'C' && !map[t.id] ? `<button class="btn btn-sm" onclick="App.reconLinkModal('${t.id}')">🔗 Vincular</button>` :
                 (map[t.id] ? `<button class="btn btn-ghost btn-sm" onclick="App.reconUnlink('${t.id}')">Desvincular</button>` : '')}
                ${!map[t.id] ? `<button class="btn btn-danger btn-sm" onclick="App.reconDeleteTx('${t.id}')">✕</button>` : ''}
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`}
    </div>
  `);
};
const rSuperAdmin = () => `
<div class="adm-layout">
  <aside class="adm-sidebar"><div class="adm-st">Super Admin</div><a href="#superadmin" class="adm-nav-item active">◈ <span>Tenants</span></a></aside>
  <main class="adm-content">
    <div class="ph">
      <div><h1 class="ptitle">Super Admin</h1><p class="psub">Gerenciamento de Barbearias (Tenants)</p></div>
      <button class="btn btn-primary" onclick="App.openTenantModal()">＋ Novo Tenant</button>
    </div>
    <div class="tbl-wrap">
      <table>
        <thead><tr><th>ID (Slug)</th><th>Nome da Barbearia</th><th>Status</th><th>Acesso Público</th><th>Ações</th></tr></thead>
        <tbody id="tbTenants"><tr><td colspan="4">Carregando...</td></tr></tbody>
      </table>
    </div>
  </main>
</div>`;

const openTenantModal = () => {
  document.getElementById('modalRoot').innerHTML = `
  <div class="modal-ov" onclick="if(event.target===this)App.closeModal()">
    <div class="modal">
      <div class="modal-head"><h3 class="modal-title">Cadastrar Novo Tenant</h3><button class="modal-close" onclick="App.closeModal()">✕</button></div>
      <form id="tntFrm">
        <div class="fg"><label class="flabel">ID do Tenant (slug sem espaços) *</label><input type="text" name="slug" class="fc" placeholder="minha-barbearia" required pattern="[a-z0-9-]+"></div>
        <div class="fg"><label class="flabel">Nome da Barbearia *</label><input type="text" name="name" class="fc" required></div>
        <hr style="border-color:var(--border);margin:20px 0">
        <p style="font-size:.8rem;color:var(--text2);margin-bottom:10px">Criar conta de Dono (Admin):</p>
        <div class="fg"><label class="flabel">E-mail do Dono *</label><input type="email" name="demail" class="fc" required></div>
        <div class="fg"><label class="flabel">Senha do Dono *</label><input type="password" name="dpw" class="fc" required minlength="6"></div>
        <button type="submit" class="btn btn-primary w-full" id="btnCTnt">Criar Tenant e Admin</button>
      </form>
    </div>
  </div>`;
  
  document.getElementById('tntFrm').onsubmit = async e => {
    e.preventDefault();
    const fd=new FormData(e.target);
    const slug=fd.get('slug'), name=fd.get('name'), email=fd.get('demail'), pw=fd.get('dpw');
    try{
      document.getElementById('btnCTnt').disabled=true;
      const ex = await DB.getBarbeariaBySlug(slug);
      if(ex) throw new Error('Este slug já está em uso.');

      T.warn('Você será logado como o novo Admin.');
      await Auth.register({name: 'Dono ' + name, emailOrPhone: email, pw, role: 'admin', barbeariaId: slug});
      await DB.createBarbearia(slug, name, Auth.cur.id);
      
      App.closeModal(); T.ok('Tenant criado com sucesso!'); window.location.href = `?b=${slug}#admin`;
    }catch(err){ document.getElementById('btnCTnt').disabled=false; T.err(err.message); }
  };
};

/* =====================================================
   APP CONTROLLER PRINCIPAL
===================================================== */
export const App = {
  _dashCalView: 'dia',
  _dashCalDate: new Date(),
  _aptPeriod: 'todo',
  _aptDate: new Date(),
  _aptBarber: '',
  async render(){
    const hash=window.location.hash.slice(1).split('?')[0]||'home';
    const app=document.getElementById('app');
    const dd=document.getElementById('userDD');if(dd)dd.remove();

    const hasTenant = !!DB.getBarbeariaId();
    if(!hasTenant && hash !== 'superadmin' && hash !== 'login' && hash !== 'register'){
      if(Auth.isSuperAdmin()){ Nav.go('superadmin'); return; }
      else if(Auth.isAdmin() && Auth.cur.barbeariaId){ window.location.href = `?b=${Auth.cur.barbeariaId}#admin`; return; }
      else { app.innerHTML = rNoTenant(); return; }
    }

    if(!Auth.ok()&&!['login','register'].includes(hash)){window.location.hash='login';return;}
    
    if(Auth.ok()){
      if(['login','register'].includes(hash)){window.location.hash=Auth.isAdmin()?'admin':Auth.isBarber()?'barber-schedule':'home';return;}
      if(Auth.isAdmin() && hash === 'home') { window.location.hash='admin'; return; }
      if(Auth.isSuperAdmin() && hash !== 'superadmin') { window.location.hash='superadmin'; return; }
      if(Auth.isBarber() && hash === 'home') { window.location.hash='barber-schedule'; return; }
    }

    // Rotas que não precisam de dados do Firestore
    const fastRoutes = ['login', 'register', 'superadmin'];
    if(fastRoutes.includes(hash)){
      let content = '';
      if(hash==='login'){content=rLogin(); this._draw(app, content); this._bindAuth(); return;}
      if(hash==='register'){content=rRegister(); this._draw(app, content); this._bindAuth(); return;}
      if(hash==='superadmin'){
        content=rSuperAdmin(); this._draw(app, rNavbar() + content);
        this._loadTenants(); return;
      }
    }

    if(hasTenant && Auth.ok()){
      const isAdmin = Auth.isAdmin();
      const isBarber = Auth.isBarber();
      const alreadyCached = DB.hasCache(isAdmin);

      if(!alreadyCached){
        // Primeira carga: exibe spinner e busca dados em paralelo
        app.innerHTML = '<div style="padding:100px;text-align:center;color:var(--gold)">Carregando...</div>';
        if(isAdmin){
          await Promise.all([
            DB.loadServices(),
            DB.loadPros(),
            DB.loadApts(),
            DB.loadProducts()
          ]);
          _tenantUsers = await DB.loadTenantUsers();
        } else if(isBarber){
          await Promise.all([
            DB.loadServices(),
            DB.loadPros(),
            DB.loadApts(),
            DB.loadProducts()
          ]);
          _tenantUsers = await DB.loadTenantUsers();
        } else {
          await Promise.all([
            DB.loadServices(),
            DB.loadPros(),
            DB.loadUserApts(Auth.cur.id),
            DB.loadProducts()
          ]);
        }
      }
      // Se já tem cache: renderiza diretamente (sem spinner, sem rede)
    }

    let content = '';
    if(hash==='home') content=rHome();
    else if(hash==='booking') content=rBooking();
    else if(hash==='store') content=rStore();
    else if(hash==='appointments') content=rAppointments();
    else if(hash==='barber-schedule') content=rBarberSchedule();
    else if(hash==='barber-earnings') content=rBarberEarnings();
    else if(hash==='barber-clients') content=rBarberClients();
    else if(hash==='admin') content=rAdmDash();
    else if(hash==='admin-services') content=rAdmServices();
    else if(hash==='admin-barbers') content=rAdmBarbers();
    else if(hash==='admin-store') content=rAdmStore();
    else if(hash==='admin-appointments') content=rAdmApts();
    else if(hash==='admin-clients') content=rAdmClients();
    else if(hash==='admin-reports') content=rAdmReports();
    else if(hash==='admin-dreport') content=rAdmDReport();
    else if(hash==='admin-recon') content=rAdmRecon();
    else if(hash==='admin-pix') content=rAdmPix();
    else if(hash==='admin-reminders') content=rAdmReminders();
    else if(hash==='admin-settings') content=rAdmSettings();
    else content = rHome();

    this._draw(app, rNavbar() + `<div style="flex:1">${content}</div>`);

    // Bind PIX form se estiver na tela admin-pix
    if(hash==='admin-pix'){
      const pf=document.getElementById('pixFrm');
      if(pf) pf.onsubmit = (e) => this.savePix(e);
    }

    // Bind Settings form se estiver na tela admin-settings
    if(hash==='admin-settings'){
      const sf=document.getElementById('settingsFrm');
      if(sf) sf.onsubmit = (e) => this.saveSettings(e);
    }

    // Draw barber earnings chart
    if(hash==='barber-earnings'){
      this._drawBarberEarningsChart();
    }
  },

  _draw(app, html){ app.innerHTML = html; },

  /**
   * Renderiza a p\u00e1gina atual usando apenas o cache em mem\u00f3ria.
   * N\u00e3o mostra spinner, n\u00e3o faz chamadas de rede.
   * Usado em intera\u00e7\u00f5es locais: sele\u00e7\u00e3o de servi\u00e7o, barbeiro, data, filtros, etc.
   */
  _renderInPlace(){
    const hash = window.location.hash.slice(1).split('?')[0] || 'home';
    const app = document.getElementById('app');
    if(!app) return;

    let content = '';
    if(hash==='home') content=rHome();
    else if(hash==='booking') content=rBooking();
    else if(hash==='store') content=rStore();
    else if(hash==='appointments') content=rAppointments();
    else if(hash==='barber-schedule') content=rBarberSchedule();
    else if(hash==='barber-earnings') content=rBarberEarnings();
    else if(hash==='barber-clients') content=rBarberClients();
    else if(hash==='admin') content=rAdmDash();
    else if(hash==='admin-services') content=rAdmServices();
    else if(hash==='admin-barbers') content=rAdmBarbers();
    else if(hash==='admin-store') content=rAdmStore();
    else if(hash==='admin-appointments') content=rAdmApts();
    else if(hash==='admin-clients') content=rAdmClients();
    else if(hash==='admin-reports') content=rAdmReports();
    else if(hash==='admin-dreport') content=rAdmDReport();
    else if(hash==='admin-recon') content=rAdmRecon();
    else if(hash==='admin-pix') content=rAdmPix();
    else if(hash==='admin-reminders') content=rAdmReminders();
    else if(hash==='admin-settings') content=rAdmSettings();
    else content=rHome();

    this._draw(app, rNavbar() + `<div style="flex:1">${content}</div>`);

    if(hash==='admin-pix'){
      const pf=document.getElementById('pixFrm');
      if(pf) pf.onsubmit = (e) => this.savePix(e);
    }

    if(hash==='admin-settings'){
      const sf=document.getElementById('settingsFrm');
      if(sf) sf.onsubmit = (e) => this.saveSettings(e);
    }

    // Draw barber earnings chart
    if(hash==='barber-earnings'){
      this._drawBarberEarningsChart();
    }
  },

  _bindAuth(){
    const lf=document.getElementById('loginF');
    if(lf) lf.onsubmit=async e=>{
      e.preventDefault();
      const b=document.getElementById('btnLogin'); b.disabled=true; b.textContent='Entrando...';
      const fd=new FormData(e.target), err=document.getElementById('loginErr');
      try{
        const u = await Auth.login(fd.get('emailOrPhone'), fd.get('pw'));
        if(u.role === 'customer' || u.role === 'admin' || u.role === 'barber') {
           if(u.barbeariaId !== DB.getBarbeariaId() && DB.getBarbeariaId()) {
             await Auth.logout(); throw new Error('Conta não pertence a esta barbearia.');
           }
        }
        T.ok(`Bem-vindo!`); Nav.go(u.role==='admin'?'admin':u.role==='superadmin'?'superadmin':u.role==='barber'?'barber-schedule':'home');
      }
      catch(ex){err.textContent=ex.message;err.style.display='block'; b.disabled=false; b.textContent='Entrar';}
    };
    
    const rf=document.getElementById('regF');
    if(rf) rf.onsubmit=async e=>{
      e.preventDefault();
      const b=document.getElementById('btnReg'); b.disabled=true; b.textContent='Criando...';
      const fd=new FormData(e.target), err=document.getElementById('regErr');
      if(fd.get('pw')!==fd.get('pw2')){err.textContent='As senhas não conferem.';err.style.display='block';b.disabled=false;b.textContent='Criar minha conta';return;}
      try{
        await Auth.register({name:fd.get('name'),emailOrPhone:fd.get('emailOrPhone'),pw:fd.get('pw')});
        T.ok('Cadastro realizado com sucesso!'); Nav.go('home');
      }
      catch(ex){err.textContent=ex.message;err.style.display='block'; b.disabled=false;b.textContent='Criar minha conta';}
    };
  },

  async loginGoogle() {
    const err = document.getElementById('loginErr') || document.getElementById('regErr');
    try {
      const u = await Auth.loginWithGoogle(DB.getBarbeariaId());
      if(u.role === 'customer' || u.role === 'admin') {
         if(u.barbeariaId !== DB.getBarbeariaId() && DB.getBarbeariaId()) {
           await Auth.logout(); throw new Error('Conta não pertence a esta barbearia.');
         }
      }
      T.ok(`Bem-vindo, ${u.name}!`); Nav.go(u.role==='admin'?'admin':u.role==='superadmin'?'superadmin':'home');
    } catch(ex) {
      if (err) { err.textContent=ex.message; err.style.display='block'; }
      else { T.err(ex.message); }
    }
  },

  async _loadTenants(){
    const tnts = await DB.getAllBarbearias();
    const tb = document.getElementById('tbTenants');
    if(!tb) return;

    // Busca dados dos donos para pegar telefone
    const tenantsWithOwners = await Promise.all(tnts.map(async t => {
      let ownerPhone = '';
      if (t.donoId) {
        try {
          const owner = await DB.getUserById(t.donoId);
          ownerPhone = owner?.phone || '';
        } catch(e) {}
      }
      return { ...t, ownerPhone };
    }));

    tb.innerHTML = tenantsWithOwners.map(t => {
      const isAct = t.status === 'active';
      // Prioriza o telefone da barbearia (tenant), senão usa o do dono
      const phoneToUse = t.phone || t.ownerPhone || '';
      const cleanPhone = phoneToUse.replace(/\D/g, '');
      const waLink = cleanPhone ? `https://wa.me/55${cleanPhone.length > 11 ? cleanPhone.slice(-11) : cleanPhone}` : null;

      return `<tr>
        <td><code style="background:var(--bg3);padding:2px 7px;border-radius:5px;font-size:.82rem;color:var(--gold)">${esc(t.id)}</code></td>
        <td><strong>${esc(t.name)}</strong></td>
        <td>
          <div style="display:flex;align-items:center;gap:10px">
            <label class="toggle-switch">
              <input type="checkbox" onchange="App.toggleTenant('${t.id}', this.checked)" ${isAct ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
            <span style="font-size:.75rem;font-weight:700;color:var(--${isAct?'success':'text3'})">${isAct ? 'ATIVO' : 'INATIVO'}</span>
          </div>
        </td>
        <td><a href="?b=${t.id}" target="_blank" style="${!isAct?'pointer-events:none;opacity:0.5':''}">Acessar 🔗</a></td>
        <td>
          <div style="display:flex;gap:5px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" onclick="App.openEditTenantModal('${esc(t.id)}')" title="Editar informações">
              ✎ Editar
            </button>
            <button class="btn btn-danger btn-sm" onclick="App.deleteTenant('${esc(t.id)}')" title="Excluir barbearia">
              ✕ Excluir
            </button>
            ${waLink ? `<a href="${waLink}" target="_blank" class="btn btn-sm" style="background:#25d366;color:#fff;gap:5px" title="Falar com o dono">${wsIcon} Contato</a>` : ''}
          </div>
        </td>
      </tr>`;
    }).join('');
  },

  async openEditTenantModal(slug) {
    // Busca dados do tenant
    let tenant;
    try {
      tenant = await DB.getBarbeariaBySlug(slug);
      if (!tenant) { T.err('Tenant não encontrado.'); return; }
    } catch(e) { T.err('Erro ao carregar tenant.'); return; }

    // Busca dados do dono
    let owner = null;
    if (tenant.donoId) {
      try { owner = await DB.getUserById(tenant.donoId); } catch(e) { /* ok */ }
    }

    document.getElementById('modalRoot').innerHTML = `
    <div class="modal-ov" onclick="if(event.target===this)App.closeModal()">
      <div class="modal" style="max-width:520px">
        <div class="modal-head">
          <h3 class="modal-title">✎ Editar Barbearia</h3>
          <button class="modal-close" onclick="App.closeModal()">&#x2715;</button>
        </div>

        <!-- Identidade da barbearia -->
        <div style="background:var(--ga1);border:1px solid var(--gold3);border-radius:var(--r2);padding:12px 15px;margin-bottom:22px;display:flex;align-items:center;gap:10px">
          <span style="font-size:1.3rem">&#x1F4C8;</span>
          <div>
            <div style="font-weight:700;font-size:.88rem;color:var(--gold)">${esc(tenant.name)}</div>
            <div style="font-size:.75rem;color:var(--text2)">Slug: <code style="color:var(--text3)">${esc(slug)}</code></div>
          </div>
        </div>

        <form id="editTntFrm">
          <!-- Dados da barbearia -->
          <div style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:var(--text3);margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border)">
            🏢 Informações da Barbearia
          </div>
          <div class="fg">
            <label class="flabel">Nome da Barbearia *</label>
            <input type="text" name="barbName" class="fc" value="${esc(tenant.name)}" required>
          </div>
          <div class="fg">
            <label class="flabel">WhatsApp da Barbearia (ex: 11999999999)</label>
            <input type="text" name="barbPhone" class="fc" value="${esc(tenant.phone||'')}" placeholder="Somente números">
            <div style="font-size:.72rem;color:var(--text3);margin-top:4px">Se preenchido, este será usado no botão de Contato em vez do telefone do dono.</div>
          </div>

          <div class="fg">
            <label class="flabel">Logo da Barbearia</label>
            <div style="display:flex;flex-direction:column;gap:10px;">
              <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                ${tenant.logoUrl ? `<img src="${esc(tenant.logoUrl)}" alt="Logo atual" class="adm-logo-img" style="max-width:120px;">` : '<div class="adm-logo-placeholder">💈</div>'}
                <button type="button" class="btn btn-ghost btn-sm" onclick="App.removeTenantLogo('${esc(slug)}')" style="${tenant.logoUrl ? '' : 'display:none;'}">Remover logo</button>
              </div>
              <input type="file" name="logoFile" accept="image/png,image/jpeg,image/webp" class="fc">
              <div style="font-size:.72rem;color:var(--text3);">A logo será exibida no painel da barbearia, na tela de login e na tela do cliente. Se não quiser usar logo, mantenha em branco.</div>
            </div>
          </div>

          <!-- Dados do dono -->
          <div style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:var(--text3);margin-bottom:12px;margin-top:8px;padding-bottom:8px;border-bottom:1px solid var(--border)">
            👤 Dados do Dono
          </div>
          <div class="fg">
            <label class="flabel">Nome do Dono</label>
            <input type="text" name="ownerName" class="fc" value="${esc(owner?.name||'')}" placeholder="Nome completo do dono">
          </div>
          <div class="fg">
            <label class="flabel">E-mail do Dono</label>
            <input type="email" name="ownerEmail" class="fc" value="${esc(owner?.email||'')}" placeholder="email@exemplo.com" readonly style="background:var(--bg3);cursor:not-allowed">
            <div style="font-size:.72rem;color:var(--warning);margin-top:4px">⚠️ O e-mail não pode ser alterado aqui. O dono deve atualizar seu próprio e-mail acessando o painel admin e indo em Configurações.</div>
          </div>

          <div id="editTntErr" class="ferr" style="display:none;margin-bottom:12px"></div>

          <button type="submit" class="btn btn-primary w-full" id="btnSaveEditTnt">
            ✓ Salvar Alterações
          </button>
        </form>

        <!-- Reset de senha -->
        <div style="margin-top:20px;padding:16px;background:var(--bg3);border:1px solid var(--border2);border-radius:var(--r2)">
          <div style="font-size:.75rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">🔐 Redefinir Senha do Dono</div>
          <p style="font-size:.82rem;color:var(--text2);margin-bottom:12px">Envie um link de redefinição de senha para o e-mail do dono. O link é válido por 1 hora.</p>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <input type="email" id="resetEmailInput" class="fc" value="${esc(owner?.email||'')}" placeholder="E-mail para envio" style="flex:1;min-width:200px">
            <button type="button" class="btn btn-ghost btn-sm" id="btnSendReset" onclick="App.sendPasswordReset('${esc(slug)}')" style="white-space:nowrap">
              📧 Enviar Link
            </button>
          </div>
          <div id="resetMsg" style="font-size:.78rem;margin-top:8px;display:none"></div>
        </div>

      </div>
    </div>`;

    // Bind form submit
    document.getElementById('editTntFrm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const barbName   = fd.get('barbName').trim();
      const barbPhone  = fd.get('barbPhone').trim();
      const ownerName  = fd.get('ownerName').trim();
      const ownerEmail = fd.get('ownerEmail').trim();
      const btn = document.getElementById('btnSaveEditTnt');
      const errEl = document.getElementById('editTntErr');
      errEl.style.display = 'none';
      if (!barbName) { errEl.textContent = 'O nome da barbearia é obrigatório.'; errEl.style.display = 'block'; return; }
      btn.disabled = true; btn.textContent = 'Salvando...';
      try {
        // Atualiza dados da barbearia se mudaram
        const tntUpd = {};
        if (barbName !== tenant.name) tntUpd.name = barbName;
        if (barbPhone !== (tenant.phone||'')) tntUpd.phone = barbPhone;
        
        const logoFile = fd.get('logoFile');
        if (logoFile && logoFile.size > 0) {
          const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Falha ao ler arquivo.'));
            reader.readAsDataURL(logoFile);
          });
          tntUpd.logoUrl = base64;
        }

        if (Object.keys(tntUpd).length > 0) {
          await DB.updateBarbeariaData(slug, tntUpd);
        }
        // Atualiza dados do dono no Firestore (apenas nome, email não pode ser alterado aqui)
        if (tenant.donoId) {
          const upd = {};
          if (ownerName  && ownerName  !== owner?.name)  upd.name  = ownerName;
          if (Object.keys(upd).length > 0) await DB.updateUserProfile(tenant.donoId, upd);
        }
        T.ok('✓ Informações atualizadas com sucesso!');
        App.closeModal();
        App._loadTenants();
      } catch(err) {
        errEl.textContent = 'Erro: ' + err.message;
        errEl.style.display = 'block';
        btn.disabled = false; btn.textContent = '✓ Salvar Alterações';
      }
    };
  },

  async sendPasswordReset(slug) {
    const emailInput = document.getElementById('resetEmailInput');
    const msgEl = document.getElementById('resetMsg');
    const btn = document.getElementById('btnSendReset');
    const email = emailInput?.value?.trim();
    if (!email) { 
      if(msgEl){ msgEl.textContent = '⚠️ Informe o e-mail.'; msgEl.style.display = 'block'; msgEl.style.color = 'var(--warning)'; }
      return; 
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
    try {
      await DB.sendOwnerPasswordReset(email);
      if(msgEl) {
        msgEl.textContent = '✅ Link enviado! O dono deve verificar o e-mail (incluindo caixa de spam).';
        msgEl.style.color = 'var(--success)';
        msgEl.style.display = 'block';
      }
      T.ok('📧 E-mail de redefinição enviado para ' + email);
    } catch(err) {
      const msg = err.code === 'auth/user-not-found' ? 'Nenhuma conta encontrada com este e-mail.' : err.message;
      if(msgEl) {
        msgEl.textContent = '❌ ' + msg;
        msgEl.style.color = 'var(--danger)';
        msgEl.style.display = 'block';
      }
      T.err('Erro: ' + msg);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '📧 Enviar Link'; }
    }
  },

  async toggleTenant(id, isActive) {
    const newStatus = isActive ? 'active' : 'inactive';
    try {
      await DB.updateBarbeariaStatus(id, newStatus);
      T.ok(`Tenant ${isActive ? 'ativado' : 'desativado'}.`);
      this._loadTenants();
    } catch(e) {
      console.error(e);
      T.err('Erro ao atualizar status.');
      this._loadTenants();
    }
  },

  async deleteTenant(id) {
    if (!confirm(`TEM CERTEZA? Isso excluirá permanentemente a barbearia "${id}" e todos os seus dados não poderão ser recuperados.`)) return;
    try {
      await DB.deleteBarbearia(id);
      T.ok('Barbearia excluída com sucesso.');
      this._loadTenants();
    } catch(e) {
      console.error(e);
      T.err('Erro ao excluir barbearia.');
    }
  },

  async logout(){
    DB.invalidateCache();
    _tenantUsers = [];
    await Auth.logout();
    T.info('Você saiu.');
    window.location.hash='login';
    this.render();
  },

  // Booking Methods
  bookWith(svcId){ BS.reset(); const s=DB.services().find(x=>x.id===svcId); if(s){BS.service=s;BS.step=2;} Nav.go('booking'); },
  newBk(){BS.reset();Nav.go('booking');},
  selSvc(id){BS.service=DB.services().find(x=>x.id===id)||null; this._renderInPlace();},
  selPro(id){BS.pro=DB.pros().find(x=>x.id===id)||null; this._renderInPlace();},
  selDate(d){BS.date=d;BS.time=null; this._renderInPlace();},
  selTime(t){BS.time=t; this._renderInPlace();},
  calP(){BS.calM--;if(BS.calM<0){BS.calM=11;BS.calY--;} this._renderInPlace();},
  calN(){BS.calM++;if(BS.calM>11){BS.calM=0;BS.calY++;} this._renderInPlace();},
  bkNext(){
    const {step,service,pro,date,time}=BS;
    if(step===1&&!service){T.warn('Selecione um serviço.');return;}
    if(step===2&&!pro){T.warn('Selecione um barbeiro.');return;}
    if(step===3&&(!date||!time)){T.warn('Selecione data e horário.');return;}
    BS.step++; this._renderInPlace();
  },
  bkBack(){BS.step=Math.max(1,BS.step-1); this._renderInPlace();},
  
  async confirmBk(){
    const {service,pro,date,time,products}=BS; const u=Auth.cur;
    if(!service||!pro||!date||!time){T.err('Dados incompletos.');return;}
    document.getElementById('btnConfirmBk').disabled = true;
    try {
      if(!Avail.canBook(pro.id,date,time,service.duration)){
        T.err('Horário indisponível.');BS.step=3;this._renderInPlace();return;
      }

      // Verifica estoque antes de confirmar
      const selProds = products || [];
      for(const p of selProds){
        const prod = DB.products().find(x=>x.id===p.id);
        if(!prod || Number(prod.stock||0) < p.qty){
          T.err(`Estoque insuficiente para "${p.name}".`); BS.step=4; this._renderInPlace(); return;
        }
      }

      const prodTotal = selProds.reduce((s,p)=>s+p.price*p.qty,0);
      const totalPrice = Math.round((service.price + prodTotal) * 100) / 100;

      // Verifica se PIX está configurado
      const pixCfg = _tenantInfo?.pixConfig;
      const pixStatus = pixCfg?.chave ? 'pendente' : null;

      const apt={userId:u.id,serviceId:service.id,professionalId:pro.id,date,time,status:'confirmado',createdAt:new Date().toISOString(),price:totalPrice};
      if(selProds.length) apt.products = selProds;
      if(pixStatus) apt.pixStatus = pixStatus;

      const docRef = await DB.addAptAndReturn(apt);
      const aptId = docRef?.id || null;
      _lastPixAptId = aptId;
      _lastPixTotal = totalPrice;
      _lastBkProducts = selProds;

      // Gera payload PIX se configurado
      _lastPixPayload = null;
      if(pixCfg?.chave && totalPrice > 0){
        try{
          _lastPixPayload = generatePixPayload({
            chave: pixCfg.chave,
            nome:  pixCfg.nome  || 'Barbearia',
            cidade:pixCfg.cidade|| 'Brasil',
            valor: totalPrice,
            txId:  (aptId || uid()).slice(0,25).replace(/[^a-zA-Z0-9]/g,''),
            desc:  service.name.slice(0,36)
          });
        }catch(pe){ console.warn('PIX gen error',pe); }
      }

      // Desconta o estoque dos produtos selecionados
      for(const p of selProds){
        const prod = DB.products().find(x=>x.id===p.id);
        if(prod) await DB.updateProductStock(p.id, Math.max(0, Number(prod.stock||0) - p.qty));
      }

      await DB.updateUserPoints(u.id, (u.points||0) + Math.floor(service.price));
      BS.step=6; T.ok('Agendamento confirmado!'); this._renderInPlace();
    } catch(e) {
      console.error(e); T.err('Erro ao agendar.'); document.getElementById('btnConfirmBk').disabled = false;
    }
  },

  async cancelApt(id){
    if(!confirm('Cancelar este agendamento?')) return;
    await DB.updateAptStatus(id, 'cancelado');
    T.ok('Agendamento cancelado.');
    // Cache de agendamentos já foi atualizado em memória pelo DB.updateAptStatus
    this._renderInPlace();
  },

  tabApt(tab){
    const u=document.getElementById('tcU'), h=document.getElementById('tcH');
    const tu=document.getElementById('tU'), th=document.getElementById('tH');
    if(tab==='u'){u.style.display='flex';h.style.display='none';tu.classList.add('active');th.classList.remove('active');}
    else{u.style.display='none';h.style.display='flex';tu.classList.remove('active');th.classList.add('active');}
  },

  // Admin Methods
  openAdmNewClientModal(){
    document.getElementById('modalRoot').innerHTML = `
    <div class="modal-ov" onclick="if(event.target===this)App.closeModal()">
      <div class="modal" style="max-width:460px">
        <div class="modal-head"><h3 class="modal-title">＋ Novo Cliente</h3><button class="modal-close" onclick="App.closeModal()">✕</button></div>
        <form id="admClientFrm">
          <div class="fg"><label class="flabel">Nome *</label><input type="text" name="name" class="fc" placeholder="Ex: João da Silva" required></div>
          <div class="fg"><label class="flabel">E-mail ou Telefone *</label><input type="text" name="emailOrPhone" class="fc" placeholder="Digite o e-mail ou telefone do cliente" required></div>
          <div class="fg"><label class="flabel">Senha para o cliente *</label><input type="password" name="pw" class="fc" minlength="6" placeholder="Mínimo 6 caracteres" required></div>
          <div style="font-size:.75rem;color:var(--text3);margin:-6px 0 16px">O cliente usará esse e-mail/telefone e senha para acessar o app da barbearia.</div>
          <button type="submit" class="btn btn-primary w-full" id="btnAdmClientSave">Cadastrar Cliente</button>
        </form>
      </div>
    </div>`;

    document.getElementById('admClientFrm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const btn = document.getElementById('btnAdmClientSave');
      btn.disabled = true; btn.textContent = 'Cadastrando...';
      try {
        await Auth.registerByAdmin({ name: fd.get('name'), emailOrPhone: fd.get('emailOrPhone'), pw: fd.get('pw'), role: 'customer' });
        _tenantUsers = await DB.loadTenantUsers();
        T.ok('Cliente cadastrado com sucesso!');
        App.closeModal();
        App._renderInPlace();
      } catch(ex) {
        T.err(ex.message);
        btn.disabled = false; btn.textContent = 'Cadastrar Cliente';
      }
    };
  },

  openAdmBkModal(){
    const svcs = DB.services();
    const pros = DB.pros();
    const today = todayStr();
    
    document.getElementById('modalRoot').innerHTML = `
    <div class="modal-ov" onclick="if(event.target===this)App.closeModal()">
      <div class="modal" style="max-width:500px">
        <div class="modal-head"><h3 class="modal-title">Novo Agendamento</h3><button class="modal-close" onclick="App.closeModal()">✕</button></div>
        <form id="admBkFrm">
          <div class="fg"><label class="flabel">Nome do Cliente *</label><input type="text" name="clientName" class="fc" placeholder="Ex: João da Silva" required></div>
          <div class="fg"><label class="flabel">Serviço *</label>
            <select name="serviceId" class="fc" required>
              <option value="">Selecione o serviço...</option>
              ${svcs.map(s=>`<option value="${s.id}">${esc(s.name)} - ${fmt(s.price)}</option>`).join('')}
            </select>
          </div>
          <div class="fg"><label class="flabel">Barbeiro *</label>
            <select name="proId" class="fc" required>
              <option value="">Selecione o profissional...</option>
              ${pros.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}
            </select>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
            <div class="fg" style="margin-bottom:0"><label class="flabel">Data *</label><input type="date" name="date" class="fc" value="${today}" required></div>
            <div class="fg" style="margin-bottom:0"><label class="flabel">Horário *</label><input type="time" name="time" class="fc" step="900" required></div>
          </div>
          <div class="fg">
            <label class="flabel">Forma de Pagamento</label>
            <select name="payMethod" class="fc">
              <option value="">Selecione...</option>
              ${PAY_METHODS.map(p=>`<option value="${p.v}">${p.i} ${p.l}</option>`).join('')}
            </select>
          </div>
          <button type="submit" class="btn btn-primary w-full" id="btnAdmBkSave">Salvar Agendamento</button>
        </form>
      </div>
    </div>`;

    document.getElementById('admBkFrm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const svcId = fd.get('serviceId');
      const proId = fd.get('proId');
      const date = fd.get('date');
      const time = fd.get('time');
      const clientName = fd.get('clientName').trim();
      const service = svcs.find(s=>s.id===svcId);
      
      const btn = document.getElementById('btnAdmBkSave');
      btn.disabled = true; btn.textContent = 'Salvando...';

      try {
        if(!Avail.canBook(proId, date, time, service.duration)){
          T.err('Horário indisponível para este barbeiro.');
          btn.disabled = false; btn.textContent = 'Salvar Agendamento';
          return;
        }

        const apt = {
          userId: '',
          clientName: clientName,
          serviceId: service.id,
          professionalId: proId,
          date: date,
          time: time,
          status: 'confirmado',
          payMethod: fd.get('payMethod') || '',
          createdAt: new Date().toISOString(),
          price: service.price
        };

        await DB.addAptAndReturn(apt);
        T.ok('Agendamento salvo com sucesso!');
        App.closeModal();
        App._renderInPlace();
      } catch(err) {
        T.err('Erro ao salvar agendamento: ' + err.message);
        btn.disabled = false; btn.textContent = 'Salvar Agendamento';
      }
    };
  },

  openSvcModal(id=null){
    const s=id?DB.services().find(x=>x.id===id):null;
    document.getElementById('modalRoot').innerHTML = `
    <div class="modal-ov" onclick="if(event.target===this)App.closeModal()">
      <div class="modal">
        <div class="modal-head"><h3 class="modal-title">${s?'Editar Serviço':'Novo Serviço'}</h3><button class="modal-close" onclick="App.closeModal()">✕</button></div>
        <form id="svcFrm">
          <div class="fg"><label class="flabel">Nome *</label><input type="text" name="name" class="fc" value="${esc(s?.name||'')}" required></div>
          <div class="fg"><label class="flabel">Duração (min) *</label><input type="number" name="dur" class="fc" value="${s?.duration||30}" min="15" step="15" required></div>
          <div class="fg"><label class="flabel">Preço (R$) *</label><input type="number" name="price" class="fc" value="${s?.price||''}" min="0" step="0.01" required></div>
          <button type="submit" class="btn btn-primary w-full">${s?'Salvar':'Criar'}</button>
        </form>
      </div>
    </div>`;
    document.getElementById('svcFrm').onsubmit = async e => {
      e.preventDefault(); const fd=new FormData(e.target);
      const data={name:fd.get('name'),duration:+fd.get('dur'),price:+fd.get('price')};
      if(s) data.id = s.id;
      await DB.saveService(data); App.closeModal(); T.ok(s?'Atualizado!':'Criado!'); this._renderInPlace();
    };
  },
  
  openBrbModal(id=null){
    const p=id?DB.pros().find(x=>x.id===id):null; const dn=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    let currentPhotoBase64 = p?.photo || '';
    
    document.getElementById('modalRoot').innerHTML = `
    <div class="modal-ov" onclick="if(event.target===this)App.closeModal()">
      <div class="modal" style="max-height: 95vh;">
        <div class="modal-head"><h3 class="modal-title">${p?'Editar Barbeiro':'Novo Barbeiro'}</h3><button class="modal-close" onclick="App.closeModal()">✕</button></div>
        <form id="brbFrm">
          <!-- Área de visualização e controle da foto -->
          <div style="display:flex;flex-direction:column;align-items:center;margin-bottom:20px;gap:10px">
            <div id="brbPhotoPreview" class="brb-av" style="margin:0;background:${p?avColor(p.name):'var(--bg3)'};color:${p?((avColor(p.name)==='#C9A227')?'#000':'#fff'):'var(--text)'};${p?.photo ? `background-image:url(${p.photo});background-size:cover;background-position:center;` : ''}">
              ${p?.photo ? '' : (p ? initials(p.name) : '💈')}
            </div>
            
            <div style="display:flex;gap:8px">
              <button type="button" class="btn btn-ghost btn-sm" id="btnUploadPhoto">📁 Foto</button>
              <button type="button" class="btn btn-ghost btn-sm" id="btnCameraPhoto">📸 Câmera</button>
              <button type="button" class="btn btn-danger btn-sm" id="btnRemovePhoto" style="${p?.photo ? '' : 'display:none'}">✕ Remover</button>
            </div>
            <input type="file" id="brbPhotoFile" accept="image/*" style="display:none">
          </div>
          
          <!-- Área do streaming da câmera -->
          <div id="cameraArea" style="display:none;margin-bottom:18px;background:var(--bg3);border:1px solid var(--border2);border-radius:12px;padding:12px;text-align:center">
            <video id="videoElement" autoplay playsinline style="width:100%;max-width:240px;border-radius:8px;background:#000;display:block;margin:0 auto 10px"></video>
            <div style="display:flex;gap:10px;justify-content:center">
              <button type="button" class="btn btn-primary btn-sm" id="btnCapture">📸 Capturar</button>
              <button type="button" class="btn btn-ghost btn-sm" id="btnCancelCamera">Cancelar</button>
            </div>
          </div>

          <div class="fg"><label class="flabel">Nome *</label><input type="text" name="name" class="fc" value="${esc(p?.name||'')}" required></div>
          <div class="fg"><label class="flabel">Especialidades (separadas por vírgula)</label><input type="text" name="specs" class="fc" value="${esc((p?.specialties||[]).join(', '))}"></div>
          <div class="fg"><label class="flabel">Vincular Usuário (para acesso do barbeiro)</label>
            <select name="userId" class="fc">
              <option value="">-- Selecione um usuário --</option>
              ${_tenantUsers.filter(u => u.role === 'customer' || u.role === 'barber').map(u => `<option value="${u.id}" ${p?.userId === u.id ? 'selected' : ''}>${esc(u.name)} (${esc(u.email)})</option>`).join('')}
            </select>
            <div style="font-size:.72rem;color:var(--text3);margin-top:4px">Selecione o usuário que terá acesso como barbeiro. O usuário deve ter a role "barber".</div>
          </div>
          
          <!-- Turnos de Trabalho -->
          <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--text2);margin-bottom:8px">🕐 Turno 1 (Manhã)</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
            <div class="fg" style="margin-bottom:0"><label class="flabel">Entrada</label><input type="time" name="start" class="fc" value="${p?.workingHours?.start||'09:00'}"></div>
            <div class="fg" style="margin-bottom:0"><label class="flabel">Saída</label><input type="time" name="end" class="fc" value="${p?.workingHours?.end||'12:00'}"></div>
          </div>
          
          <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--text2);margin-bottom:8px">🕐 Turno 2 (Tarde) - Opcional</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px">
            <div class="fg" style="margin-bottom:0"><label class="flabel">Entrada</label><input type="time" name="start2" class="fc" value="${p?.workingHours?.start2||''}"></div>
            <div class="fg" style="margin-bottom:0"><label class="flabel">Saída</label><input type="time" name="end2" class="fc" value="${p?.workingHours?.end2||''}"></div>
          </div>

          <div class="fg"><label class="flabel">Dias de trabalho</label>
            <div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:5px">
              ${dn.map((d,i)=>`<label style="display:flex;align-items:center;gap:5px;cursor:pointer;padding:5px;background:var(--bg3);border:1px solid var(--border);border-radius:6px;font-size:.82rem"><input type="checkbox" name="wd" value="${i}" ${(p?.workingDays||[1,2,3,4,5]).includes(i)?'checked':''}>${d}</label>`).join('')}
            </div>
          </div>
          <button type="submit" class="btn btn-primary w-full">${p?'Salvar':'Cadastrar'}</button>
        </form>
      </div>
    </div>`;

    const previewEl = document.getElementById('brbPhotoPreview');
    const uploadBtn = document.getElementById('btnUploadPhoto');
    const cameraBtn = document.getElementById('btnCameraPhoto');
    const removeBtn = document.getElementById('btnRemovePhoto');
    const fileInput = document.getElementById('brbPhotoFile');
    const cameraArea = document.getElementById('cameraArea');
    const videoEl = document.getElementById('videoElement');
    const captureBtn = document.getElementById('btnCapture');
    const cancelCameraBtn = document.getElementById('btnCancelCamera');

    const resizeAndCrop = (imageOrVideo, isVideo = false) => {
      const canvas = document.createElement('canvas');
      canvas.width = 300;
      canvas.height = 300;
      const ctx = canvas.getContext('2d');
      
      let w = isVideo ? imageOrVideo.videoWidth : imageOrVideo.width;
      let h = isVideo ? imageOrVideo.videoHeight : imageOrVideo.height;
      
      const size = Math.min(w, h);
      const sx = (w - size) / 2;
      const sy = (h - size) / 2;
      
      ctx.drawImage(imageOrVideo, sx, sy, size, size, 0, 0, 300, 300);
      return canvas.toDataURL('image/jpeg', 0.82);
    };

    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const base64 = resizeAndCrop(img, false);
          currentPhotoBase64 = base64;
          previewEl.style.backgroundImage = `url(${base64})`;
          previewEl.style.backgroundSize = 'cover';
          previewEl.style.backgroundPosition = 'center';
          previewEl.innerHTML = '';
          removeBtn.style.display = 'inline-flex';
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    };

    uploadBtn.onclick = () => fileInput.click();

    cameraBtn.onclick = async () => {
      try {
        if (window._currentCameraStream) {
          window._currentCameraStream.getTracks().forEach(t => t.stop());
        }
        window._currentCameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
        });
        videoEl.srcObject = window._currentCameraStream;
        cameraArea.style.display = 'block';
        cameraBtn.disabled = true;
      } catch (err) {
        T.err('Não foi possível acessar a câmera: ' + err.message);
      }
    };

    captureBtn.onclick = () => {
      if (!window._currentCameraStream) return;
      try {
        const base64 = resizeAndCrop(videoEl, true);
        currentPhotoBase64 = base64;
        previewEl.style.backgroundImage = `url(${base64})`;
        previewEl.style.backgroundSize = 'cover';
        previewEl.style.backgroundPosition = 'center';
        previewEl.innerHTML = '';
        removeBtn.style.display = 'inline-flex';
        
        // Parar câmera
        window._currentCameraStream.getTracks().forEach(t => t.stop());
        window._currentCameraStream = null;
        cameraArea.style.display = 'none';
        cameraBtn.disabled = false;
      } catch (err) {
        T.err('Erro ao capturar foto: ' + err.message);
      }
    };

    cancelCameraBtn.onclick = () => {
      if (window._currentCameraStream) {
        window._currentCameraStream.getTracks().forEach(t => t.stop());
        window._currentCameraStream = null;
      }
      cameraArea.style.display = 'none';
      cameraBtn.disabled = false;
    };

    removeBtn.onclick = () => {
      currentPhotoBase64 = '';
      previewEl.style.backgroundImage = 'none';
      previewEl.innerHTML = p ? initials(p.name) : '💈';
      removeBtn.style.display = 'none';
      fileInput.value = '';
    };

    document.getElementById('brbFrm').onsubmit = async e => {
      e.preventDefault(); const fd=new FormData(e.target);
      const wds=Array.from(e.target.querySelectorAll('input[name="wd"]:checked')).map(el=>+el.value);
      
      const workingHours = {
        start: fd.get('start'),
        end: fd.get('end'),
        start2: fd.get('start2') || '',
        end2: fd.get('end2') || ''
      };

      const selectedUserId = fd.get('userId');
      
      const data={
        name: fd.get('name'),
        specialties: fd.get('specs').split(',').map(s=>s.trim()).filter(Boolean),
        workingHours: workingHours,
        workingDays: wds,
        photo: currentPhotoBase64
      };
      
      if(p) data.id = p.id;
      
      // Se a câmera ainda estiver aberta por engano, parar ela
      if (window._currentCameraStream) {
        window._currentCameraStream.getTracks().forEach(t => t.stop());
        window._currentCameraStream = null;
      }
      
      await DB.savePro(data);
      
      // Update user role to barber if a user is selected
      if(selectedUserId) {
        data.userId = selectedUserId;
        await DB.savePro(data);
        await DB.updateUserProfile(selectedUserId, { role: 'barber' });
      } else if(p?.userId) {
        // If user was previously linked but now unlinked, reset role to customer
        await DB.updateUserProfile(p.userId, { role: 'customer' });
        data.userId = '';
        await DB.savePro(data);
      }
      
      App.closeModal(); T.ok(p?'Atualizado!':'Cadastrado!'); this._renderInPlace();
    };
  },

  async delSvc(id){
    if(confirm('Excluir este serviço?')){
      await DB.deleteService(id);
      T.ok('Serviço excluído.');
      // deleteService já recarrega services no cache
      this._renderInPlace();
    }
  },
  async delBrb(id){
    if(confirm('Excluir este barbeiro?')){
      await DB.deletePro(id);
      T.ok('Barbeiro excluído.');
      // deletePro já recarrega pros no cache
      this._renderInPlace();
    }
  },

  chgProd(id, delta){
    const prod = DB.products().find(p=>p.id===id);
    if(!prod) return;
    const idx = BS.products.findIndex(s=>s.id===id);
    if(delta > 0){
      const cur = idx>=0 ? BS.products[idx].qty : 0;
      if(cur >= Number(prod.stock||0)){ T.warn('Estoque insuficiente.'); return; }
      if(idx >= 0) BS.products[idx].qty++;
      else BS.products.push({ id: prod.id, name: prod.name, price: prod.price, qty: 1 });
    } else {
      if(idx >= 0){
        if(BS.products[idx].qty > 1) BS.products[idx].qty--;
        else BS.products.splice(idx,1);
      }
    }
    this._renderInPlace();
  },

  openProdModal(id=null){
    const p=id?DB.products().find(x=>x.id===id):null;
    let currentPhotoBase64 = p?.image || '';
    document.getElementById('modalRoot').innerHTML = `
    <div class="modal-ov" onclick="if(event.target===this)App.closeModal()">
      <div class="modal">
        <div class="modal-head"><h3 class="modal-title">${p?'Editar Produto':'Novo Produto'}</h3><button class="modal-close" onclick="App.closeModal()">✕</button></div>
        <form id="prodFrm">
          <div style="display:flex;flex-direction:column;align-items:center;margin-bottom:20px;gap:10px">
            <div id="prodPhotoPreview" class="prod-photo-preview" style="${currentPhotoBase64?`background-image:url(${currentPhotoBase64});background-size:cover;background-position:center;border-style:solid;`:''}">
              ${currentPhotoBase64 ? '' : (p ? esc(p.name)[0].toUpperCase() : '🛒')}
            </div>
            <div style="display:flex;gap:8px">
              <button type="button" class="btn btn-ghost btn-sm" id="btnUploadProdPhoto">📁 Foto</button>
              <button type="button" class="btn btn-danger btn-sm" id="btnRemoveProdPhoto" style="${currentPhotoBase64?'':'display:none'}">✕ Remover</button>
            </div>
            <input type="file" id="prodPhotoFile" accept="image/*" style="display:none">
            <div style="font-size:.72rem;color:var(--text3);text-align:center;margin-top:-4px">Envie uma imagem do produto (será exibida na tela de agendamento do cliente).</div>
          </div>
          <div class="fg"><label class="flabel">Nome *</label><input type="text" name="name" class="fc" value="${esc(p?.name||'')}" placeholder="Ex: Pomada modeladora" required></div>
          <div class="fg"><label class="flabel">Valor (R$) *</label><input type="number" name="price" class="fc" value="${p?.price||''}" min="0" step="0.01" placeholder="Ex: 29.90" required></div>
          <div class="fg"><label class="flabel">Quantidade em estoque *</label><input type="number" name="stock" class="fc" value="${p?.stock ?? 0}" min="0" step="1" required></div>
          <button type="submit" class="btn btn-primary w-full">${p?'Salvar':'Cadastrar Produto'}</button>
        </form>
      </div>
    </div>`;

    const previewEl = document.getElementById('prodPhotoPreview');
    const uploadBtn = document.getElementById('btnUploadProdPhoto');
    const removeBtn = document.getElementById('btnRemoveProdPhoto');
    const fileInput = document.getElementById('prodPhotoFile');

    const resizeImage = (file, cb) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const max = 600;
          let w = img.width, h = img.height;
          if(w > max || h > max){
            const ratio = Math.min(max/w, max/h);
            w = Math.round(w*ratio); h = Math.round(h*ratio);
          }
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          cb(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    };

    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if(!file) return;
      resizeImage(file, (base64) => {
        currentPhotoBase64 = base64;
        previewEl.style.backgroundImage = `url(${base64})`;
        previewEl.style.backgroundSize = 'cover';
        previewEl.style.backgroundPosition = 'center';
        previewEl.style.borderStyle = 'solid';
        previewEl.innerHTML = '';
        removeBtn.style.display = 'inline-flex';
      });
    };

    uploadBtn.onclick = () => fileInput.click();

    removeBtn.onclick = () => {
      currentPhotoBase64 = '';
      previewEl.style.backgroundImage = 'none';
      previewEl.style.borderStyle = 'dashed';
      previewEl.innerHTML = p ? esc(p.name)[0].toUpperCase() : '🛒';
      removeBtn.style.display = 'none';
      fileInput.value = '';
    };

    document.getElementById('prodFrm').onsubmit = async e => {
      e.preventDefault(); const fd=new FormData(e.target);
      const data={
        name: fd.get('name').trim(),
        price: Math.max(0, parseFloat(fd.get('price'))||0),
        stock: Math.max(0, Math.floor(parseInt(fd.get('stock'),10)||0)),
        image: currentPhotoBase64
      };
      if(p) data.id = p.id;
      try{
        await DB.saveProduct(data); App.closeModal(); T.ok(p?'Produto atualizado!':'Produto cadastrado!'); this._renderInPlace();
      }catch(err){ T.err('Erro ao salvar produto: '+err.message); }
    };
  },

  async delProd(id){
    if(confirm('Excluir este produto?')){
      await DB.deleteProduct(id);
      T.ok('Produto excluído.');
      this._renderInPlace();
    }
  },
  async admCancel(id){
    if(confirm('Cancelar agendamento?')){
      await DB.updateAptStatus(id, 'cancelado');
      T.ok('Cancelado.');
      this._renderInPlace();
    }
  },
  async admComplete(id){
    await DB.updateAptStatus(id, 'concluido');
    T.ok('Concluído.');
    this._renderInPlace();
  },

  askDiscount(id){
    const apt = DB.apts().find(a=>a.id===id);
    if(!apt) return;
    const sv  = DB.services().find(s=>s.id===apt.serviceId);
    const pr  = DB.pros().find(p=>p.id===apt.professionalId);
    const clName = apt.clientName || _tenantUsers.find(u=>u.id===apt.userId)?.name || 'Cliente';
    const base = Number(apt.originalPrice || apt.price || 0);
    this._completeAptId = id;

    document.getElementById('modalRoot').innerHTML = `
    <div class="modal-ov" onclick="if(event.target===this)App.closeModal()">
      <div class="modal" style="max-width:440px">
        <div class="modal-head"><h3 class="modal-title">✓ Concluir Atendimento</h3><button class="modal-close" onclick="App.closeModal()">✕</button></div>
        <div style="font-size:.85rem;color:var(--text2);margin-bottom:16px">
          <strong style="color:var(--text);font-size:.95rem">${esc(clName)}</strong><br>
          ${esc(sv?.name||'—')} com ${esc(pr?.name||'—')} · ${fmtDate(apt.date)} às ${apt.time}
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r2);margin-bottom:16px">
          <span style="font-size:.85rem;color:var(--text2)">Valor original</span>
          <span style="font-family:var(--ft);font-weight:700">${fmt(base)}</span>
        </div>
        <div class="fg">
          <label class="flabel">Tem desconto?</label>
          <select id="discountType" class="fc" onchange="App.calcDiscount()">
            <option value="0">Não, sem desconto</option>
            <option value="pct">Sim — percentual (%)</option>
            <option value="valor">Sim — valor fixo (R$)</option>
          </select>
        </div>
        <div class="fg" id="discountInputWrap" style="display:none">
          <label class="flabel" id="discountInputLabel">Percentual de desconto (%)</label>
          <input type="number" id="discountInput" class="fc" min="0" step="0.01" placeholder="Ex: 10" oninput="App.calcDiscount()">
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.3);border-radius:var(--r2);margin:16px 0">
          <span style="font-size:.85rem;color:var(--text2)">Valor final</span>
          <span id="finalPrice" style="font-family:var(--ft);font-weight:700;font-size:1.15rem;color:var(--gold)">${fmt(base)}</span>
        </div>
        <button class="btn btn-success w-full" id="btnConfirmComplete" onclick="App.confirmComplete('${apt.id}')">✓ Confirmar e Concluir</button>
      </div>
    </div>`;
  },

  calcDiscount(){
    const id = this._completeAptId;
    const apt = id ? DB.apts().find(a=>a.id===id) : null;
    if(!apt) return;
    const base = Number(apt.originalPrice || apt.price || 0);
    const type = document.getElementById('discountType')?.value || '0';
    const wrap = document.getElementById('discountInputWrap');
    const input = document.getElementById('discountInput');
    const finalEl = document.getElementById('finalPrice');
    if(!finalEl) return;

    if(type === '0'){
      if(wrap) wrap.style.display = 'none';
      finalEl.textContent = fmt(base);
      return;
    }
    if(wrap){
      wrap.style.display = '';
      const lbl = document.getElementById('discountInputLabel');
      if(lbl) lbl.textContent = type === 'pct' ? 'Percentual de desconto (%)' : 'Valor do desconto (R$)';
    }
    let finalPrice = base;
    const v = parseFloat(input?.value) || 0;
    if(type === 'pct') finalPrice = base - (base * v / 100);
    else finalPrice = base - v;
    finalPrice = Math.max(0, finalPrice);
    finalEl.textContent = fmt(finalPrice);
  },

  async confirmComplete(id){
    const apt = DB.apts().find(a=>a.id===id);
    if(!apt) return;
    const type = document.getElementById('discountType')?.value || '0';
    const input = document.getElementById('discountInput');
    let discountPct = 0, discountVal = 0;
    if(type === 'pct') discountPct = Math.max(0, parseFloat(input?.value) || 0);
    else if(type === 'valor') discountVal = Math.max(0, parseFloat(input?.value) || 0);

    const btn = document.getElementById('btnConfirmComplete');
    if(btn){ btn.disabled = true; btn.textContent = 'Salvando...'; }

    try{
      await DB.completeApt(id, discountPct, discountVal);
      this.closeModal();
      T.ok(discountPct > 0 || discountVal > 0 ? 'Concluído com desconto!' : 'Concluído!');
      this._renderInPlace();
    }catch(e){
      T.err('Erro ao concluir: ' + e.message);
      if(btn){ btn.disabled = false; btn.textContent = '✓ Confirmar e Concluir'; }
    }
  },
  async admDelete(id){
    if(confirm('Excluir este agendamento permanentemente? Esta ação não pode ser desfeita.')){
      await DB.deleteApt(id);
      T.ok('Agendamento excluído.');
      this._renderInPlace();
    }
  },

  setDashCalView(view) {
    this._dashCalView = view;
    this._renderInPlace();
  },

  setAptPeriod(period) {
    this._aptPeriod = period;
    this._aptDate = new Date();
    this._renderInPlace();
  },

  navAptDate(dir) {
    const d = new Date(this._aptDate || new Date());
    const p = this._aptPeriod || 'todo';
    if(p === 'dia') d.setDate(d.getDate() + dir);
    else if(p === 'semana') d.setDate(d.getDate() + (dir * 7));
    else if(p === 'mes') d.setMonth(d.getMonth() + dir);
    this._aptDate = d;
    this._renderInPlace();
  },

  setAptBarber(id) {
    this._aptBarber = id;
    this._renderInPlace();
  },
  
  navDashCal(dir) {
    const d = new Date(this._dashCalDate || new Date());
    const v = this._dashCalView || 'dia';
    if(v === 'dia') {
      d.setDate(d.getDate() + dir);
    } else {
      d.setDate(d.getDate() + (dir * 7));
    }
    this._dashCalDate = d;
    this._renderInPlace();
  },
  
  dashAptClick(id) {
    const apt = DB.apts().find(a => a.id === id);
    if(!apt) return;
    const sv = DB.services().find(s => s.id === apt.serviceId);
    const pr = DB.pros().find(p => p.id === apt.professionalId);
    const clName = apt.userId ? _tenantUsers.find(u=>u.id===apt.userId)?.name || 'Cliente' : apt.clientName || 'Cliente';
    const isDone = apt.status === 'concluido';
    
    document.getElementById('modalRoot').innerHTML = `
    <div class="modal-ov" onclick="if(event.target===this)App.closeModal()">
      <div class="modal" style="max-width:400px;text-align:center">
        <div class="modal-head" style="margin-bottom:10px">
          <h3 class="modal-title">Detalhes do Agendamento</h3>
          <button class="modal-close" onclick="App.closeModal()">✕</button>
        </div>
        <div class="uavatar" style="margin:0 auto 10px;width:60px;height:60px;font-size:1.5rem;background:var(--gold);color:#000">${initials(clName)}</div>
        <h3 style="font-size:1.2rem;font-weight:700;margin-bottom:5px">${esc(clName)}</h3>
        <p style="color:var(--text2);margin-bottom:20px">${esc(sv?.name||'—')} com ${esc(pr?.name||'—')}<br>${fmtDate(apt.date)} às ${apt.time}</p>
        
        ${!isDone ? `<button class="btn btn-success w-full" style="margin-bottom:10px" onclick="App.closeModal();App.askDiscount('${apt.id}')">✓ Marcar como Concluído</button>` : `<button class="btn btn-success w-full" style="margin-bottom:10px;opacity:0.9;cursor:default" disabled>✓ Serviço Concluído</button>`}
        ${apt.status !== 'cancelado' && !isDone ? `<button class="btn btn-danger w-full btn-outline" onclick="App.closeModal();App.admCancel('${apt.id}')">✕ Cancelar Agendamento</button>` : ''}
      </div>
    </div>`;
  },

  openClientHistory(userId) {
    const client = _tenantUsers.find(u => u.id === userId);
    if (!client) return;

    const allApts = DB.apts().filter(a => a.userId === userId).sort((a,b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
    const last5 = allApts.slice(0, 5);
    const svcs = DB.services();
    const pros = DB.pros();

    let histHtml = '';
    if (last5.length === 0) {
      histHtml = '<div style="text-align:center;padding:24px;color:var(--text2)">Nenhum agendamento encontrado.</div>';
    } else {
      histHtml = last5.map(apt => {
        const sv = svcs.find(s => s.id === apt.serviceId);
        const pr = pros.find(p => p.id === apt.professionalId);
        const [bc,bl] = apt.status==='confirmado'?['b-success','Confirmado']:apt.status==='cancelado'?['b-danger','Cancelado']:['b-info','Concluído'];
        return `
        <div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--r2);padding:14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-weight:600;font-family:var(--ft);font-size:1.05rem;margin-bottom:4px">${esc(sv?.name||'—')}</div>
            <div style="font-size:0.85rem;color:var(--text2)">✂ ${esc(pr?.name||'—')} · 📅 ${fmtDate(apt.date)} às ${apt.time}</div>
          </div>
          <div style="text-align:right">
            <span class="badge ${bc}" style="margin-bottom:6px">${bl}</span>
            <div style="font-weight:700;color:var(--gold);font-size:1.05rem">${fmt(apt.price)}</div>
          </div>
        </div>`;
      }).join('');
    }

    const ac=avColor(client.name); const tc=ac==='#C9A227'?'#000':'#fff';
    document.getElementById('modalRoot').innerHTML = `
    <div class="modal-ov" onclick="if(event.target===this)App.closeModal()">
      <div class="modal" style="max-width:540px">
        <div class="modal-head">
          <h3 class="modal-title">Histórico do Cliente</h3>
          <button class="modal-close" onclick="App.closeModal()">✕</button>
        </div>
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:24px;padding-bottom:18px;border-bottom:1px solid var(--border)">
          <div class="uavatar" style="width:52px;height:52px;font-size:1.3rem;background:${ac};color:${tc}">${initials(client.name)}</div>
          <div>
            <div style="font-weight:700;font-size:1.15rem;font-family:var(--ft);margin-bottom:2px">${esc(client.name)}</div>
            <div style="font-size:0.85rem;color:var(--text2)">${esc(client.email)} ${client.phone ? `· ${esc(client.phone)}` : ''}</div>
          </div>
        </div>
        <h4 style="font-size:0.8rem;text-transform:uppercase;color:var(--text3);margin-bottom:14px;letter-spacing:1px;font-weight:700">Últimos Agendamentos</h4>
        <div style="max-height:300px;overflow-y:auto;padding-right:5px">
          ${histHtml}
        </div>
      </div>
    </div>`;
  },

  // --- Métodos PIX ---
  async admMarkPixPaid(id){
    try{
      await DB.updateAptPixStatus(id, 'pago');
      T.ok('✅ PIX marcado como pago!');
      this._renderInPlace();
    }catch(e){ T.err('Erro ao atualizar PIX.'); }
  },

  async setPayMethod(id, method){
    try{
      await DB.updateAptPayment(id, method);
      T.ok(`Forma de pagamento: ${PAY_LABEL(method)}`);
      this._renderInPlace();
    }catch(e){ T.err('Erro ao atualizar forma de pagamento.'); }
  },

  openPixModal(aptId){
    const apt = DB.apts().find(a=>a.id===aptId);
    const sv  = DB.services().find(s=>s.id===apt?.serviceId);
    const pixCfg = _tenantInfo?.pixConfig;
    if(!apt||!pixCfg?.chave){ T.warn('PIX não disponível.'); return; }
    let payload = null;
    try{
      payload = generatePixPayload({
        chave:  pixCfg.chave,
        nome:   pixCfg.nome   || 'Barbearia',
        cidade: pixCfg.cidade || 'Brasil',
        valor:  apt.price,
        txId:   aptId.slice(0,25).replace(/[^a-zA-Z0-9]/g,''),
        desc:   sv?.name?.slice(0,36)||''
      });
    }catch(e){ T.err('Erro ao gerar código PIX.'); return; }
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(payload)}`;
    document.getElementById('modalRoot').innerHTML = `
    <div class="modal-ov" onclick="if(event.target===this)App.closeModal()">
      <div class="modal">
        <div class="modal-head"><h3 class="modal-title">⚡ Pagar via PIX</h3><button class="modal-close" onclick="App.closeModal()">✕</button></div>
        <div style="text-align:center">
          <div style="font-size:.85rem;color:var(--text2);margin-bottom:14px">Escaneie o QR Code com seu app de banco</div>
          <img src="${qrUrl}" alt="QR Code PIX" style="width:200px;height:200px;border-radius:12px;border:2px solid var(--border2);margin:0 auto;display:block">
          <div style="margin:18px 0 6px;font-size:.75rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px">Ou copie a linha digitável</div>
          <div class="pix-code" onclick="App.copyPix('${esc(payload)}')" style="cursor:pointer">${esc(payload)}</div>
          <button class="btn btn-primary w-full" style="margin-top:12px" onclick="App.copyPix('${esc(payload)}')">📋 Copiar código PIX</button>
          <div style="margin-top:12px;font-size:.82rem;color:var(--gold);font-weight:700">${fmt(apt.price)}</div>
        </div>
      </div>
    </div>`;
  },

  copyPix(payload){
    const txt = payload.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"');
    navigator.clipboard?.writeText(txt).then(()=>T.ok('Código PIX copiado! Cole no app do banco.')).catch(()=>{
      const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();
      T.ok('Código PIX copiado!');
    });
  },

  async savePix(e){
    e.preventDefault();
    const fd=new FormData(e.target);
    const tipo=fd.get('tipo');
    const chaveRaw=fd.get('chave').trim();
    const chave=sanitizeChave(tipo, chaveRaw);
    const pixConfig={tipo, chave, nome:fd.get('nome').trim(), cidade:fd.get('cidade').trim()};
    const btn=document.getElementById('btnSavePix');
    btn.disabled=true; btn.textContent='Salvando...';
    console.log('[PIX Config] Tipo:', tipo, '| Chave original:', chaveRaw, '| Chave sanitizada:', chave);
    try{
      const slug=DB.getBarbeariaId();
      await DB.saveBarbeariaPixConfig(slug, pixConfig);
      _tenantInfo = await DB.refreshTenantInfo(slug);
      T.ok(`⚡ PIX configurado! Chave salva: ${chave}`);
      this._renderInPlace();
    }catch(err){ T.err('Erro ao salvar: '+err.message); btn.disabled=false; btn.textContent='✓ Salvar Configurações PIX'; }
  },

  async saveSettings(e){
    e.preventDefault();
    const fd=new FormData(e.target);
    const name=fd.get('name').trim();
    const newEmail=fd.get('newEmail').trim();
    const currentPassword=fd.get('currentPassword');
    const newPassword=fd.get('newPassword');
    const confirmPassword=fd.get('confirmPassword');
    const btn=document.getElementById('btnSaveSettings');
    const errEl=document.getElementById('settingsErr');
    errEl.style.display='none';
    btn.disabled=true; btn.textContent='Salvando...';
    try{
      // Atualiza nome no Firestore
      if(name && name !== Auth.cur.name){
        await DB.updateUserProfile(Auth.cur.id, {name});
        Auth.cur.name = name;
      }
      // Atualiza email se fornecido
      if(newEmail && newEmail !== Auth.cur.email){
        await Auth.updateCurrentUserEmail(newEmail);
        T.ok('✓ Um e-mail de verificação foi enviado para ' + newEmail + '. Clique no link para confirmar a alteração.');
        this._renderInPlace();
        return;
      }
      // Atualiza senha se fornecida
      if(currentPassword || newPassword || confirmPassword){
        if(!currentPassword || !newPassword || !confirmPassword){
          throw new Error('Para alterar a senha, preencha todos os campos de senha.');
        }
        if(newPassword !== confirmPassword){
          throw new Error('A nova senha e a confirmação não coincidem.');
        }
        if(newPassword.length < 6){
          throw new Error('A nova senha deve ter pelo menos 6 caracteres.');
        }
        await Auth.updateCurrentUserPassword(currentPassword, newPassword);
        T.ok('✓ Senha atualizada com sucesso!');
        this._renderInPlace();
        return;
      }
      T.ok('✓ Informações atualizadas!');
      this._renderInPlace();
    }catch(err){
      errEl.textContent='Erro: '+err.message;
      errEl.style.display='block';
      btn.disabled=false; btn.textContent='✓ Salvar Alterações';
    }
  },

  // --- Relatórios ---
  changeReportFilter(filter){
    this._reportFilter = filter;
    if (filter !== 'custom') { this._reportFrom = ''; this._reportTo = ''; }
    this._renderInPlace();
  },

  changeReportBarber(id){
    this._reportBarber = id;
    this._renderInPlace();
  },

  changeReportService(id){
    this._reportService = id;
    this._renderInPlace();
  },

  reportSetRange(which, value){
    if (which === 'from') this._reportFrom = value; else this._reportTo = value;
    this._reportFilter = 'custom';
    this._renderInPlace();
  },

  reportResetFilters(){
    this._reportFilter = 'mes';
    this._reportBarber = '';
    this._reportService = '';
    this._reportFrom = '';
    this._reportTo = '';
    this._renderInPlace();
  },

  // --- Relatório Detalhado ---
  dReportSetPeriod(p){
    this._dreportPeriod = p;
    if (p !== 'custom') { this._dreportFrom = ''; this._dreportTo = ''; }
    this._renderInPlace();
  },

  dReportSetBarber(id){
    this._dreportBarber = id;
    this._renderInPlace();
  },

  dReportSetRange(which, value){
    if (which === 'from') this._dreportFrom = value; else this._dreportTo = value;
    if (this._dreportPeriod !== 'custom') this._dreportPeriod = 'custom';
    this._renderInPlace();
  },

  dReportSetDiscount(v){
    this._dreportDiscount = v;
    this._renderInPlace();
  },

  dReportGenerate(){
    const el = document.getElementById('drepDiscount');
    if (el) this._dreportDiscount = el.value;
    this._renderInPlace();
  },

  _drawDReportCharts(labels, data, payLabels, payData){
    const ctx = document.getElementById('dReportChart');
    if(ctx){
      if(window._dReportChart) window._dReportChart.destroy();
      window._dReportChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            label: 'Faturamento (R$)',
            data: data,
            backgroundColor: '#C9A227',
            borderRadius: 6,
            borderSkipped: false
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, grid: { color: '#252525' }, ticks: { color: '#a0a0a0', font: { size: 10 } } },
            x: { grid: { display: false }, ticks: { color: '#a0a0a0', font: { size: 10 } } }
          }
        }
      });
    }
    const pctx = document.getElementById('dReportPayChart');
    if(pctx){
      if(window._dReportPayChart) window._dReportPayChart.destroy();
      window._dReportPayChart = new Chart(pctx, {
        type: 'doughnut',
        data: {
          labels: payLabels.map(k => k === 'sem_registro' ? 'Sem registro' : PAY_LABEL(k)),
          datasets: [{
            data: payData,
            backgroundColor: ['#C9A227','#3b82f6','#22c55e','#a855f7','#06b6d4','#ef4444'],
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { color: '#a0a0a0', font: { size: 11 } } } }
        }
      });
    }
  },

  // --- Lembretes WhatsApp ---
  setRemindersFilter(filter){
    this._remindersFilter = filter;
    this._renderInPlace();
  },

  _drawReportChart(labels, data){
    const ctx = document.getElementById('reportChart');
    if(!ctx) return;
    if(window._myChart) window._myChart.destroy();
    window._myChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Faturamento (R$)',
          data: data,
          backgroundColor: '#C9A227',
          borderRadius: 6,
          borderSkipped: false,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, grid: { color: '#252525' }, ticks: { color: '#a0a0a0', font: { size: 10 } } },
          x: { grid: { display: false }, ticks: { color: '#a0a0a0', font: { size: 10 } } }
        }
      }
    });
  },

  _drawBarberEarningsChart(){
    const u = Auth.cur;
    const pros = DB.pros();
    const pro = pros.find(p => p.userId === u.id);
    if(!pro) return;

    const td = todayStr();
    const today = new Date();
    const chartLabels = [];
    const chartData = [];
    
    for(let i = 6; i >= 0; i--){
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dStr = d.toISOString().split('T')[0];
      const dayName = d.toLocaleDateString('pt-BR', { weekday: 'short' });
      chartLabels.push(dayName);
      const barberApts = DB.apts().filter(a => a.professionalId === pro.id && a.status === 'concluído' && a.date === dStr);
      const dayTotal = barberApts.reduce((sum, a) => sum + Number(a.price || 0), 0);
      chartData.push(dayTotal);
    }

    const ctx = document.getElementById('barberEarningsChart');
    if(!ctx) return;
    if(window._barberChart) window._barberChart.destroy();
    window._barberChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: chartLabels,
        datasets: [{
          label: 'Ganhos (R$)',
          data: chartData,
          backgroundColor: '#C9A227',
          borderRadius: 6,
          borderSkipped: false,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, grid: { color: '#252525' }, ticks: { color: '#a0a0a0', font: { size: 10 } } },
          x: { grid: { display: false }, ticks: { color: '#a0a0a0', font: { size: 10 } } }
        }
      }
    });
  },

  // --- Conciliação Bancária ---
  async reconInit(){
    try {
      const [imports, txs] = await Promise.all([DB.loadBankImports(), DB.loadBankTransactions()]);
      this._reconImports = imports;
      this._reconTxs = txs;
      this._reconResult = reconcileBank(txs, DB.apts());
      this._reconFilter = this._reconFilter || 'todos';
      this._renderInPlace();
    } catch(e){ T.err('Erro ao carregar conciliação: '+e.message); }
  },

  reconSelectFilter(filter){
    this._reconFilter = filter;
    this._reconResetState();
    this._renderInPlace();
  },

  _reconResetState(){
    if(this._reconState && this._reconState.status === 'preview') this._reconState = { status:'idle' };
  },

  reconReadFile(file, cb){
    if(!file.arrayBuffer){ file.text().then(cb); return; }
    file.arrayBuffer().then(ab => {
      let text = new TextDecoder('utf-8').decode(ab);
      if(text.includes('\uFFFD')){
        try{ text = new TextDecoder('windows-1252').decode(ab); }catch(e){}
      }
      cb(text);
    }).catch(() => cb(''));
  },

  reconFileSelected(e){
    const file = e.target.files && e.target.files[0];
    if(!file) return;
    this.reconReadFile(file, (content) => {
      try{
        const parsed = parseBankFile(file.name, content);
        if(!parsed.count){ T.err('Nenhuma transação reconhecida no arquivo.'); return; }
        this._reconState = { status:'preview', format:parsed.format, fileName:file.name, txs:parsed.transactions };
        this._renderInPlace();
        T.ok(`Arquivo ${String(parsed.format).toUpperCase()} lido com ${parsed.count} transação(ões).`);
      }catch(err){ T.err(err.message); this._renderInPlace(); }
    });
  },

  async reconImport(){
    const st = this._reconState;
    if(!st || st.status !== 'preview') return;
    try{
      const fp = fingerprintList(st.txs);
      const exists = (this._reconImports || []).find(i => i.fingerprint === fp);
      if(exists){ T.warn('Este arquivo já foi importado anteriormente.'); return; }
      const importId = await DB.createBankImport({
        fileName: st.fileName,
        format: st.format,
        count: st.txs.length,
        fingerprint: fp
      });
      await DB.addBankTransactions(st.txs.map(t => ({ ...t, importId })));
      this._reconState = { status:'idle' };
      this._reconTxs = undefined;
      T.ok(`Importadas ${st.txs.length} transações!`);
      await this.reconInit();
    }catch(e){ T.err('Erro ao importar: '+e.message); }
  },

  reconDiscard(){
    this._reconState = { status:'idle' };
    this._renderInPlace();
  },

  reconRun(){
    this._reconResult = reconcileBank(this._reconTxs || [], DB.apts());
    this._renderInPlace();
    T.ok('Conciliação recalculada.');
  },

  async reconDeleteImport(id){
    if(!confirm('Excluir este extrato e todas as suas transações? Esta ação não pode ser desfeita.')) return;
    try{
      await DB.deleteBankImport(id);
      T.ok('Extrato excluído.');
      this._reconTxs = undefined;
      await this.reconInit();
    }catch(e){ T.err('Erro: '+e.message); }
  },

  async reconDeleteTx(id){
    if(!confirm('Remover esta transação do extrato?')) return;
    try{
      await DB.deleteBankTransaction(id);
      T.ok('Transação removida.');
      await this.reconInit();
    }catch(e){ T.err('Erro: '+e.message); }
  },

  async reconLink(bankTxId, aptId){
    try{
      await DB.updateBankTransaction(bankTxId, { aptId, linkedAt: new Date().toISOString() });
      T.ok('Transação vinculada com sucesso!');
      App.closeModal();
      await this.reconInit();
    }catch(e){ T.err('Erro ao vincular: '+e.message); }
  },

  async reconUnlink(bankTxId){
    try{
      await DB.updateBankTransaction(bankTxId, { aptId: null, linkedAt: null });
      T.ok('Vínculo removido.');
      await this.reconInit();
    }catch(e){ T.err('Erro: '+e.message); }
  },

  reconLinkModal(bankTxId){
    const tx = (this._reconTxs || []).find(t => t.id === bankTxId);
    if(!tx){ T.err('Transação não encontrada.'); return; }
    const apts = DB.apts().filter(a => a.status !== 'cancelado' && a.status !== 'cancelada');
    const sameVal = apts.filter(a => Math.abs(Number(a.price || 0) - tx.valor) < 0.01);
    const nearDate = sameVal.filter(a => Math.abs(daysBetween(tx.data, a.date)) <= 2);
    const others = apts.filter(a => !sameVal.includes(a))
      .map(a => ({ a, d: Math.abs(daysBetween(tx.data, a.date)) }))
      .filter(o => o.d <= 3).sort((x, y) => x.d - y.d).map(o => o.a);
    const candidates = [...nearDate, ...sameVal.filter(a => !nearDate.includes(a)), ...others].slice(0, 25);

    const rows = candidates.length ? candidates.map(a => {
      const sv = DB.services().find(s => s.id === a.serviceId);
      const client = _tenantUsers.find(u => u.id === a.userId);
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);flex-wrap:wrap">
        <div>
          <div style="font-weight:600;font-size:.86rem">${esc(client?.name || '—')} · ${esc(sv?.name || '')}</div>
          <div style="font-size:.72rem;color:var(--text2)">${fmtDate(a.date)} · ${fmt(a.price)} · ${esc(a.status || '')}</div>
        </div>
        <button class="btn btn-sm" onclick="App.reconLink('${bankTxId}','${a.id}')">Vincular</button>
      </div>`;
    }).join('') : '<div style="padding:16px;text-align:center;color:var(--text2)">Nenhum agendamento candidato.</div>';

    document.getElementById('modalRoot').innerHTML = `
    <div class="modal-ov" onclick="if(event.target===this)App.closeModal()">
      <div class="modal">
        <div class="modal-head"><h3 class="modal-title">🔗 Vincular transação</h3><button class="modal-close" onclick="App.closeModal()">✕</button></div>
        <div style="font-size:.82rem;color:var(--text2);margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)">
          <strong style="color:var(--text)">${fmtDate(tx.data)}</strong> · ${esc(tx.descricao || '—')} ·
          <span style="color:${tx.tipo==='D'?'var(--danger)':'var(--success)'}">${(tx.tipo==='D'?'−':'+')+fmt(tx.valor)}</span>
        </div>
        <div style="font-size:.75rem;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Sugestões de agendamento</div>
        ${rows}
      </div>
    </div>`;
  },

  reconSample(format){
    let text = '';
    if(format === 'ofx'){
      text = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0</CODE></STATUS></SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260115120000</DTPOSTED><TRNAMT>45.00</TRNAMT><FITID>20260115001</FITID><MEMO>PIX RECEBIDO</MEMO></STMTTRN>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260115120000</DTPOSTED><TRNAMT>30.00</TRNAMT><FITID>20260115002</FITID><MEMO>PIX RECEBIDO CORTE</MEMO></STMTTRN>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260116090000</DTPOSTED><TRNAMT>-12.90</TRNAMT><FITID>20260116001</FITID><MEMO>TARIFA BANCARIA</MEMO></STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;
    } else if(format === 'ofd'){
      text = `<?xml version="1.0" encoding="UTF-8"?>
<OFD>
  <Arquivo>
    <Movimentos>
      <Movimento><Data>2026-01-15</Data><Valor Tipo="C">45.00</Valor><Historico>PIX RECEBIDO</Historico></Movimento>
      <Movimento><Data>2026-01-15</Data><Valor Tipo="C">30.00</Valor><Historico>PIX RECEBIDO CORTE</Historico></Movimento>
      <Movimento><Data>2026-01-16</Data><Valor Tipo="D">12.90</Valor><Historico>TARIFA BANCARIA</Historico></Movimento>
    </Movimentos>
  </Arquivo>
</OFD>`;
    } else {
      text = `Data;Valor;Historico
2026-01-15;45.00;PIX RECEBIDO
2026-01-15;30.00;PIX RECEBIDO CORTE
2026-01-16;-12.90;TARIFA BANCARIA`;
    }
    const blob = new Blob([text], { type:'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'exemplo-conciliacao.' + format;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  },

  tabBarberApt(tab){
    const tU = document.getElementById('tU');
    const tH = document.getElementById('tH');
    const tcU = document.getElementById('tcU');
    const tcH = document.getElementById('tcH');
    if(!tU || !tH || !tcU || !tcH) return;
    
    if(tab === 'u'){
      tU.classList.add('active');
      tH.classList.remove('active');
      tcU.style.display = 'flex';
      tcH.style.display = 'none';
    } else {
      tU.classList.remove('active');
      tH.classList.add('active');
      tcU.style.display = 'none';
      tcH.style.display = 'flex';
    }
  },
  
  toggleUserDD(){
    const existing=document.getElementById('userDD'); if(existing){existing.remove();return;}
    const u=Auth.cur; const ac=avColor(u.name); const tc=ac==='#C9A227'?'#000':'#fff';
    document.body.insertAdjacentHTML('beforeend',`
    <div id="userDD" style="position:fixed;top:62px;right:18px;background:var(--bg2);border:1px solid var(--border2);border-radius:12px;padding:7px;min-width:195px;box-shadow:var(--sh);z-index:1100;animation:slideUp .15s ease">
      <div style="padding:9px 11px;border-bottom:1px solid var(--border);margin-bottom:4px"><div style="font-weight:700;font-size:.88rem">${esc(u.name)}</div><div style="font-size:.78rem;color:var(--text2)">${esc(u.email)}</div></div>
      <button class="btn btn-ghost w-full" style="justify-content:flex-start;gap:9px;padding:7px 11px;font-size:.85rem" onclick="App.logout()">⏻ Sair da conta</button>
    </div>`);
    setTimeout(()=>{
      document.addEventListener('click',function h(e){
        if(!e.target.closest('#userDD')&&!e.target.closest('#uPill')){ const dd=document.getElementById('userDD');if(dd)dd.remove(); document.removeEventListener('click',h); }
      });
    },0);
  },
  toggleMob(){const m=document.getElementById('mobMenu');if(m)m.classList.toggle('open');},
  closeMob(){const m=document.getElementById('mobMenu');if(m)m.classList.remove('open');},
  closeModal(){
    if (window._currentCameraStream) {
      try {
        window._currentCameraStream.getTracks().forEach(t => t.stop());
      } catch (err) {
        console.warn('Error closing camera track:', err);
      }
      window._currentCameraStream = null;
    }
    document.getElementById('modalRoot').innerHTML='';
  },
  async removeTenantLogo(slug){
    const btn = document.getElementById('btnSaveEditTnt');
    if(btn) { btn.disabled = true; btn.textContent = 'Removendo...'; }
    try {
      await DB.updateBarbeariaData(slug, { logoUrl: '' });
      T.ok('Logo removida com sucesso.');
      App.closeModal();
      App._loadTenants();
    } catch(err) {
      T.err('Não foi possível remover a logo.');
    } finally {
      if(btn) { btn.disabled = false; btn.textContent = '✓ Salvar Alterações'; }
    }
  },

  async changeLogoQuick(slug){
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if(!file) return;
      
      const btn = document.getElementById('admBrandLogo');
      if (btn) {
        btn.style.pointerEvents = 'none';
        btn.style.opacity = '0.6';
      }
      
      try {
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Falha ao ler arquivo.'));
          reader.readAsDataURL(file);
        });
        
        await DB.updateBarbeariaData(slug, { logoUrl: base64 });
        _tenantInfo = await DB.refreshTenantInfo(slug);
        T.ok('Logo atualizada com sucesso!');
        App._renderInPlace();
      } catch(err) {
        T.err('Erro: ' + err.message);
      } finally {
        if (btn) {
          btn.style.pointerEvents = 'auto';
          btn.style.opacity = '1';
        }
      }
    };
    input.click();
  },
  openTenantModal(){openTenantModal();},

  // Init
  async init(){
    window.App = this; 
    const params = new URLSearchParams(window.location.search);
    const tenantId = params.get('b');
    
    if(tenantId){
      DB.setBarbeariaId(tenantId);
      _tenantInfo = await DB.getBarbeariaBySlug(tenantId);
      if(!_tenantInfo || _tenantInfo.status !== 'active') { document.getElementById('app').innerHTML = rNoTenant(); return; }
    }

    Auth.init((user) => { this.render(); });
    window.addEventListener('hashchange',()=>this.render());
  }
};

App.init();
