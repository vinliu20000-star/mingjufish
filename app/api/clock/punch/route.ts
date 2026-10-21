import { env } from "cloudflare:workers";

const allowed = new Set(["https://vinliu20000-star.github.io", "http://localhost:3000"]);
function cors(request:Request){const origin=request.headers.get("Origin")||"";return{"Access-Control-Allow-Origin":allowed.has(origin)?origin:"https://vinliu20000-star.github.io","Access-Control-Allow-Headers":"Content-Type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"}}
export async function OPTIONS(request:Request){return new Response(null,{status:204,headers:cors(request)})}
function taipeiNow(){const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());const get=(type:string)=>parts.find(p=>p.type===type)?.value||"";return{date:`${get("year")}-${get("month")}-${get("day")}`,time:`${get("hour")}:${get("minute")}`}}
export async function POST(request:Request){
  const vars=env as unknown as Record<string,unknown>&{DB:D1Database};
  try{
    const body=await request.json() as {challenge?:string;employeeCode?:string;pin?:string;device?:{deviceId?:string;deviceLabel?:string;userAgent?:string;platform?:string;screen?:string;language?:string;timeZone?:string}};
    const challenge=body.challenge?.trim()||"";
    const valid=await vars.DB.prepare("SELECT token FROM qr_challenges WHERE token = ? AND token LIKE 's_%' AND expires_at >= ?").bind(challenge,Date.now()).first();
    if(!valid)return Response.json({error:"打卡時間已超過 2 分鐘，請重新掃描店內 QR"},{status:410,headers:cors(request)});
    const stateRow=await vars.DB.prepare("SELECT data FROM app_state WHERE id = ?").bind(1).first<{data:string}>();
    if(!stateRow)return Response.json({error:"工時資料尚未建立"},{status:503,headers:cors(request)});
    type PunchEvent={action:"上"|"下";time:string;deviceId:string;deviceLabel:string;userAgent?:string;anomaly?:string};
    type Attendance=Record<string,unknown>&{personId:number;date:string;clockIn:string;clockOut:string;punchEvents?:PunchEvent[];punchAnomaly?:string};
    const state=JSON.parse(stateRow.data) as {people:Array<{id:number;name:string;employeeCode?:string;pin?:string}>;rows:Attendance[];schedules:Array<Record<string,unknown>>};
    const person=state.people.find((p,index)=>(p.employeeCode||String(index+1).padStart(3,"0"))===body.employeeCode?.trim()&&(p.pin||"0000")===body.pin);
    if(!person)return Response.json({error:"員編或 PIN 不正確"},{status:401,headers:cors(request)});
    person.employeeCode=person.employeeCode||String(state.people.indexOf(person)+1).padStart(3,"0");person.pin=person.pin||"0000";
    const consumed=await vars.DB.prepare("DELETE FROM qr_challenges WHERE token = ? AND token LIKE 's_%' AND expires_at >= ? RETURNING token").bind(challenge,Date.now()).first();
    if(!consumed)return Response.json({error:"這次打卡通行證已使用或已過期，請重新掃描"},{status:410,headers:cors(request)});
    const {date,time}=taipeiNow();
    const clean=(value:unknown,max:number)=>typeof value==="string"?value.slice(0,max):"";
    const deviceId=clean(body.device?.deviceId,100);
    const deviceLabel=clean(body.device?.deviceLabel,120)||"無法辨識的裝置";
    // Only flag device sharing on the same calendar day. Looking through the
    // entire attendance history made a legitimate shared/replaced device show
    // as an anomaly forever.
    const otherPersonIds=deviceId?[...new Set(state.rows.flatMap(row=>row.date===date?(row.punchEvents||[]).filter(event=>event.deviceId===deviceId&&row.personId!==person.id).map(()=>row.personId):[]))]:[];
    const otherNames=otherPersonIds.map(id=>state.people.find(p=>p.id===id)?.name).filter((name):name is string=>!!name);
    const anomaly=otherNames.length?`同一裝置（${deviceLabel}）曾替其他員工打卡：${otherNames.join("、")}`:"";
    if(anomaly)state.rows.forEach(row=>{if(row.date===date&&row.personId!==person.id&&(row.punchEvents||[]).some(event=>event.deviceId===deviceId)){const currentName=state.people.find(p=>p.id===person.id)?.name||"其他員工";row.punchAnomaly=`同一裝置（${deviceLabel}）也替其他員工打卡：${currentName}`}});
    const punchEvent:PunchEvent={action:"上",time,deviceId:deviceId||"未提供",deviceLabel,userAgent:clean(body.device?.userAgent,500),...(anomaly?{anomaly}:{})};
    const open=[...state.rows].reverse().find(r=>r.personId===person.id&&r.date===date&&r.clockIn&&!r.clockOut);
    let action="上";
    if(open){open.clockOut=time;action="下";punchEvent.action="下";open.punchEvents=[...(open.punchEvents||[]),punchEvent];if(anomaly)open.punchAnomaly=anomaly}else{state.rows.push({id:Date.now(),personId:person.id,date,clockIn:time,clockOut:"",breakMin:0,type:"正常",note:"動態 QR 打卡",confirmed:false,punchEvents:[punchEvent],...(anomaly?{punchAnomaly:anomaly}:{})})}
    await vars.DB.batch([
      vars.DB.prepare("INSERT INTO clock_uses (challenge, person_id) VALUES (?, ?)").bind(challenge,person.id),
      vars.DB.prepare("UPDATE app_state SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(JSON.stringify(state),1),
    ]);
    return Response.json({name:person.name,time,action},{headers:cors(request)});
  }catch(error){
    const message=error instanceof Error?error.message:"";
    if(message.includes("UNIQUE")||message.includes("constraint"))return Response.json({error:"這個 QR 已經使用過，請重新掃描"},{status:409,headers:cors(request)});
    return Response.json({error:"目前無法打卡，請通知管理員"},{status:500,headers:cors(request)});
  }
}
