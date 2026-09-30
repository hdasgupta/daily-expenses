const base=import.meta.env.VITE_API_BASE_URL||'http://localhost:4000/api';

export async function api(path,options={}){
  const token=localStorage.getItem('token');
  const headers={...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),...(options.headers||{})};
  if(token)headers.Authorization=`Bearer ${token}`;
  window.dispatchEvent(new CustomEvent('app:api:start',{detail:{message:options.loadingMessage||'Please wait…',path}}));
  try{
    const r=await fetch(base+path,{...options,headers});
    if(!r.ok){let e={};try{e=await r.json()}catch{};throw new Error(e.error||`Request failed (${r.status})`)}
    return r.status===204?null:r.json();
  }finally{
    window.dispatchEvent(new CustomEvent('app:api:end'));
  }
}
