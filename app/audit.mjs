import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'
const URL_='https://wqkvzsuwjkowpinxnpld.supabase.co', PUB='sb_publishable_iXr3YY7vMl_Er6eVYEHS1Q_kUM7H8Tm', REF='wqkvzsuwjkowpinxnpld'
const admin=createClient(URL_,process.env.SEC,{auth:{persistSession:false}})
const email='audit-'+Date.now()+'@example.com', pw='x9Qm2!vBnT7z'
const {data:made}=await admin.auth.admin.createUser({email,password:pw,email_confirm:true})
const {data:trip}=await admin.from('trips').select('id').limit(1).single()
await admin.from('trip_members').insert({trip_id:trip.id,user_id:made.user.id,role:'owner',display_name:'Audit'})
const {data:{session}}=await createClient(URL_,PUB).auth.signInWithPassword({email,password:pw})

const b=await chromium.launch()
for (const [label,w,h] of [['phone',390,844],['phone-l',430,932],['tablet',768,1024],['laptop',1280,800]]) {
  const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:2})
  await p.addInitScript(([r,s])=>localStorage.setItem('sb-'+r+'-auth-token',JSON.stringify(s)),[REF,session])
  await p.goto('http://localhost:4173/',{waitUntil:'networkidle'})
  await p.waitForSelector('.mapcanvas',{timeout:25000}); await p.waitForTimeout(4000)
  const r=await p.evaluate(()=>{
    const de=document.documentElement
    const over=[...document.querySelectorAll('body *')].filter(e=>{
      const b=e.getBoundingClientRect()
      return b.width>0 && (b.right > window.innerWidth+1 || b.left < -1)
    }).slice(0,6).map(e=>`${e.tagName.toLowerCase()}.${(e.className||'').toString().split(' ')[0]} right=${Math.round(e.getBoundingClientRect().right)}`)
    const tiny=[...document.querySelectorAll('button,a')].filter(e=>{
      const b=e.getBoundingClientRect(); return b.width>0 && (b.width<32||b.height<32)
    }).length
    return { hScroll: de.scrollWidth>de.clientWidth, scrollW:de.scrollWidth, clientW:de.clientWidth, over, tinyTargets:tiny,
             tickerH: document.querySelector('.ticker')?.getBoundingClientRect().height,
             stripVisible: !!document.querySelector('.fcard') }
  })
  console.log(`${label.padEnd(8)} ${String(w).padStart(4)}px | h-scroll:${r.hScroll?'YES '+r.scrollW+'>'+r.clientW:'no '} | overflowing:${r.over.length} | tap targets <32px:${r.tinyTargets} | filmstrip:${r.stripVisible?'yes':'no'}`)
  r.over.forEach(o=>console.log('           '+o))
  await p.screenshot({path:`m-${label}.png`})
  await p.close()
}
await b.close()
await admin.from('trip_members').delete().eq('user_id',made.user.id)
await admin.auth.admin.deleteUser(made.user.id)
