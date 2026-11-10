"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

const CLOUD_API="https://mingjufish-worklog.starssand.chatgpt.site";

export default function QrDisplayPage() {
  const [authToken,setAuthToken]=useState("");
  const [password,setPassword]=useState("");
  const [image,setImage]=useState("");
  const [seconds,setSeconds]=useState(15);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);

  useEffect(()=>{const github=window.location.hostname.endsWith("github.io");const manifest=document.createElement("link");manifest.rel="manifest";manifest.href=github?"/mingjufish/mingjufish-qr.webmanifest":"/mingjufish-qr.webmanifest";document.head.appendChild(manifest);const capable=document.createElement("meta");capable.name="apple-mobile-web-app-capable";capable.content="yes";document.head.appendChild(capable);const status=document.createElement("meta");status.name="apple-mobile-web-app-status-bar-style";status.content="black-translucent";document.head.appendChild(status);if("serviceWorker" in navigator)navigator.serviceWorker.register(github?"/mingjufish/qr-sw.js":"/qr-sw.js",{scope:github?"/mingjufish/qr/":"/qr/"}).catch(()=>{});return()=>{manifest.remove();capable.remove();status.remove()}},[]);
  useEffect(()=>{const saved=localStorage.getItem("mingjufish-qr-device-token")||sessionStorage.getItem("mingjufish-token")||"";if(saved){localStorage.setItem("mingjufish-qr-device-token",saved);setAuthToken(saved)}},[]);
  useEffect(()=>{
    if(!authToken)return;
    let active=true;
    async function refresh(){
      try{
        const response=await fetch(`${CLOUD_API}/api/clock/challenge`,{method:"POST",headers:{Authorization:`Bearer ${authToken}`}});
        if(response.status===401){localStorage.removeItem("mingjufish-qr-device-token");if(active){setAuthToken("");setError("這台平板的啟用已失效，請由管理員重新啟用一次")};return}
        if(!response.ok)throw new Error();
        const data=await response.json();
        const path=window.location.hostname.endsWith("github.io")?"/mingjufish/clock/":"/clock/";
        const url=`${window.location.origin}${path}?token=${encodeURIComponent(data.challenge)}`;
        const qr=await QRCode.toDataURL(url,{width:520,margin:2,color:{dark:"#18322b",light:"#ffffff"}});
        if(active){setImage(qr);setSeconds(15);setError("")}
      }catch{if(active)setError("QR 產生失敗，請檢查網路")}
    }
    refresh();
    const refreshTimer=window.setInterval(refresh,15000);
    const countTimer=window.setInterval(()=>setSeconds(s=>s<=1?15:s-1),1000);
    return()=>{active=false;clearInterval(refreshTimer);clearInterval(countTimer)};
  },[authToken]);

  async function unlock(e:React.FormEvent){
    e.preventDefault();setBusy(true);setError("");
    try{
      const response=await fetch(`${CLOUD_API}/api/auth`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password})});
      if(!response.ok)throw new Error(response.status===401?"管理密碼不正確":"目前無法連線");
      const {token}=await response.json();localStorage.setItem("mingjufish-qr-device-token",token);setAuthToken(token);setPassword("");
    }catch(err){setError(err instanceof Error?err.message:"登入失敗")}finally{setBusy(false)}
  }

  if(!authToken)return <main className="login-page"><section className="login-card"><div className="logo login-logo">桔</div><span className="eyebrow">MINGJU QR DISPLAY</span><h1>首次啟用店內平板</h1><p>僅第一次由管理員完成，之後開機會直接顯示 QR</p><form onSubmit={unlock}><label>管理密碼<input autoFocus type="password" inputMode="numeric" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="由管理員輸入一次"/></label>{error&&<span className="login-error">{error}</span>}<button className="primary submit" disabled={busy}>{busy?"啟用中…":"啟用這台平板"}</button></form><small>員工打卡不需要管理密碼，只需輸入自己的員編與 PIN</small></section></main>;

  return <main className="clock-page qr-display-page"><section className="clock-card qr-display-card"><div className="logo login-logo">桔</div><span className="eyebrow">MINGJU QR DISPLAY</span><h1>名桔鮮魚湯｜員工打卡</h1><div className="qr-panel">{image?<img src={image} alt="店內動態打卡 QR Code"/>:<div className="qr-loading">正在產生 QR…</div>}<strong>{seconds} 秒後更新</strong><p>請用手機相機掃描，再輸入員編與 PIN 完成打卡。</p>{error&&<span className="login-error">{error}</span>}</div><small>此頁只能顯示 QR，無法進入管理後台</small></section></main>;
}

