let csrf = "";
export const setCsrf = (value:string) => { csrf=value; sessionStorage.setItem("quiz-csrf",value); };
csrf=sessionStorage.getItem("quiz-csrf")??"";
export async function api<T=any>(path:string,init:RequestInit={}){
  const headers=new Headers(init.headers);if(init.body&&!(init.body instanceof FormData))headers.set("Content-Type","application/json");if(init.method&&!["GET","HEAD"].includes(init.method.toUpperCase())&&csrf)headers.set("X-CSRF-Token",csrf);
  const response=await fetch(path,{...init,headers,credentials:"same-origin"});if(response.status===204)return undefined as T;const body=await response.json().catch(()=>({error:{message:"Некорректный ответ сервера"}}));if(!response.ok)throw new Error(body.error?.message??`HTTP ${response.status}`);if(body.csrf_token)setCsrf(body.csrf_token);return body as T;
}
export const json=(method:string,body:unknown,headers?:HeadersInit):RequestInit=>({method,body:JSON.stringify(body),headers});

