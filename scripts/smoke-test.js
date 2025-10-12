#!/usr/bin/env node
// Simple smoke test against the deployed Netlify site and Render API through the proxy
const fetch = global.fetch || ((...args)=>import('node-fetch').then(({default:f})=>f(...args)));

const SITE = process.env.SITE || 'https://canna-bee.netlify.app';

async function main(){
  const jar = {};
  const saveCookies = (res)=>{
    const set = res.headers.get('set-cookie');
    if (set){ jar.cookie = set.split(';')[0]; }
  };
  const withCreds = (init={})=>({
    ...init,
    headers: { ...(init.headers||{}), Cookie: jar.cookie||'' },
    redirect: 'manual'
  });

  // 1) Health (direct API via proxy)
  const h = await fetch(`${SITE}/api/health`);
  if (!h.ok) throw new Error(`Health failed: ${h.status}`);
  console.log('Health OK');

  if (!process.env.SKIP_LOGIN){
    // 2) Login admin
    const login = await fetch(`${SITE}/api/auth`, withCreds({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: process.env.ADMIN_USER||'admin', password: process.env.ADMIN_PASS||'password' })
    }));
    if (!login.ok) throw new Error(`Login failed: ${login.status}`);
    saveCookies(login);
    console.log('Login OK');

    // 3) Auth me
    const me = await fetch(`${SITE}/api/auth/me`, withCreds());
    if (!me.ok) throw new Error(`Auth/me failed: ${me.status}`);
    const j = await me.json();
    if (!j.user) throw new Error('No user in /auth/me');
    console.log('Auth/me OK:', j.user.username);
  } else {
    console.log('Skipping login as requested (SKIP_LOGIN=1)');
  }

  // 4) Strains fetch
  const s = await fetch(`${SITE}/api/strains`, withCreds());
  if (!s.ok) throw new Error(`Strains failed: ${s.status}`);
  const arr = await s.json();
  console.log(`Strains OK: ${arr.length} items`);

  console.log('Smoke test: PASS');
}

main().catch(e=>{ console.error('Smoke test: FAIL'); console.error(e.message||e); process.exit(1); });
