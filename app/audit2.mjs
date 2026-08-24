import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'
const URL_='https://wqkvzsuwjkowpinxnpld.supabase.co', PUB='sb_publishable_iXr3YY7vMl_Er6eVYEHS1Q_kUM7H8Tm', REF='wqkvzsuwjkowpinxnpld'
const admin=createClient(URL_,process.env.SEC,{auth:{persistSession:false}})
const email='audit2-'+Date.now()+'@example.com', pw='x9Qm2!vBnT7z'
const {data:made}=await admin.auth.admin.createUser({email,password:pw,email_confirm:true})
const {data:trip}=await admin.from('trips').select('id').limit(1).single()
await admin.from('trip_members').insert({trip_id:trip.id,user_id:made.user.id,role:'owner',display_name:'Audit'})
const {data:{session}}=await createClient(URL_,PUB).auth.signInWithPassword({email,password:pw})
const b=await chromium.launch()
for (const [label,w,h] of [['small',360,780],['phone',390,844],['phone-l',430,932],['tablet',768,1024],['laptop',1280,800]]) {
  const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:2,hasTouch:w<800,isMobile:w<800})
  await p.addInitScript(([r,s])=>localStorage.setItem('sb-'+r+'-auth-token',JSON.stringify(s)),[REF,session])
  await p.goto('http://localhost:4173/',{waitUntil:'networkidle'})
  await p.waitForSelector('.mapcanvas',{timeout:25000}); await p.waitForTimeout(3500)
  const r=await p.evaluate(()=>{
    const de=document.documentElement, W=window.innerWidth
    const chrome=[...document.querySelectorAll('.ticker *,.strip *,.pane *')].filter(e=>{
      const b=e.getBoundingClientRect(); return b.width>0 && (b.right>W+1||b.left<-1)
    }).map(e=>`${e.tagName.toLowerCase()}.${(e.className||'').toString().split(' ')[0]}@${Math.round(e.getBoundingClientRect().right)}`)
    const tr=document.querySelector('.tright')?.getBoundingClientRect()
    const small=[...document.querySelectorAll('.ticker button')].filter(e=>{const b=e.getBoundingClientRect();return b.width&&(b.width<30||b.height<30)}).length
    return { hScroll:de.scrollWidth>de.clientWidth, chrome:chrome.slice(0,4),
             trightRight: tr?Math.round(tr.right):null, W, small,
             stops:document.querySelectorAll('.fcard').length }
  })
  console.log(`${label.padEnd(8)} ${String(w).padStart(4)} | h-scroll:${r.hScroll?'YES':'no '} | .tright ends at ${r.trightRight}/${r.W} ${r.trightRight<=r.W?'fits':'OVERFLOWS'} | chrome overflow:${r.chrome.length} | buttons <30px:${r.small}`)
  r.chrome.forEach(x=>console.log('           '+x))
  await p.screenshot({path:`m2-${label}.png`})
  await p.close()
}
await b.close()
await admin.from('trip_members').delete().eq('user_id',made.user.id)
await admin.auth.admin.deleteUser(made.user.id)
