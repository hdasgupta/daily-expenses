const DEFAULT_API="https://daily-expenses-g4ze.onrender.com/api";
function base(){return (String(import.meta.env.VITE_API_BASE_URL||"").trim()||DEFAULT_API).replace(/\/$/,"");}
let busy=false,last="",lastAt=0;
function user(){try{return JSON.parse(localStorage.getItem("daily-expenses:user")||"null")}catch{return null}}
export async function reportClientError({category="frontend-runtime",error,message,stack,requestId,method,path}={}){
 const msg=String(message||error?.message||error||"Unknown client-side error"), fp=`${category}|${msg}|${path||location.pathname}`, now=Date.now();
 if(busy||(fp===last&&now-lastAt<5000)) return; busy=true; last=fp; lastAt=now;
 const u=user();
 try{await fetch(`${base()}/client-errors`,{method:"POST",headers:{"Content-Type":"application/json","X-App-Timezone":Intl.DateTimeFormat().resolvedOptions().timeZone||"Asia/Kolkata"},body:JSON.stringify({category,failureTime:new Date().toISOString(),failureMessage:msg,stack:String(stack||error?.stack||""),userFullName:u?.fullName||null,userEmail:u?.email||null,requestId:requestId||null,method:method||null,path:path||location.pathname}),keepalive:true});}catch{}finally{busy=false;}
}
