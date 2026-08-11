"use client";

import { useEffect, useMemo, useState } from "react";

type Person = { id: number; name: string; role: string; rate: number; monthlySalary: number; start: string; end: string };
type RecordRow = { id: number; personId: number; date: string; clockIn: string; clockOut: string; breakMin: number; type: string; note: string; confirmed: boolean };
type DailySchedule = { id: number; personId: number; date: string; start: string; end: string };

const seedPeople: Person[] = [
  { id: 1, name: "林怡君", role: "正職", rate: 0, monthlySalary: 42000, start: "09:30", end: "18:30" },
  { id: 2, name: "陳柏宇", role: "計時", rate: 190, monthlySalary: 0, start: "11:00", end: "20:00" },
  { id: 3, name: "王雅婷", role: "計時", rate: 190, monthlySalary: 0, start: "17:00", end: "22:00" },
];

const today = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (offset: number) => { const d = new Date(today); d.setDate(d.getDate() + offset); return iso(d); };
const seedRows: RecordRow[] = [
  { id: 1, personId: 1, date: day(0), clockIn: "09:28", clockOut: "18:36", breakMin: 60, type: "正常", note: "", confirmed: true },
  { id: 2, personId: 2, date: day(0), clockIn: "10:52", clockOut: "20:05", breakMin: 45, type: "正常", note: "備料", confirmed: false },
  { id: 3, personId: 3, date: day(-1), clockIn: "17:08", clockOut: "22:14", breakMin: 15, type: "正常", note: "", confirmed: true },
  { id: 4, personId: 1, date: day(-1), clockIn: "09:31", clockOut: "18:30", breakMin: 60, type: "正常", note: "", confirmed: true },
  { id: 5, personId: 2, date: day(-3), clockIn: "11:03", clockOut: "20:18", breakMin: 45, type: "正常", note: "盤點", confirmed: true },
];
const seedSchedules: DailySchedule[] = [
  { id: 1, personId: 1, date: day(0), start: "09:30", end: "18:30" },
  { id: 2, personId: 2, date: day(0), start: "11:00", end: "20:00" },
  { id: 3, personId: 3, date: day(-1), start: "17:00", end: "22:00" },
  { id: 4, personId: 1, date: day(-1), start: "09:30", end: "18:30" },
  { id: 5, personId: 2, date: day(-3), start: "11:00", end: "20:00" },
];

function minutes(t: string) { const [h, m] = t.split(":").map(Number); return h * 60 + m; }
function workMinutes(row: RecordRow, schedule?: DailySchedule) {
  if (!schedule || !row.clockIn || !row.clockOut || row.type !== "正常") return 0;
  const start = Math.max(minutes(row.clockIn), minutes(schedule.start));
  const end = Math.min(minutes(row.clockOut), minutes(schedule.end));
  return Math.max(0, end - start);
}
function fmtHours(min: number) { return `${(min / 60).toFixed(2)} 小時`; }
function weekday(date: string) { return ["日", "一", "二", "三", "四", "五", "六"][new Date(`${date}T12:00:00`).getDay()]; }
function money(n: number) { return `NT$ ${Math.round(n).toLocaleString("zh-TW")}`; }

export default function Home() {
  const [people, setPeople] = useState<Person[]>(seedPeople);
  const [rows, setRows] = useState<RecordRow[]>(seedRows);
  const [schedules, setSchedules] = useState<DailySchedule[]>(seedSchedules);
  const [range, setRange] = useState("今日");
  const [query, setQuery] = useState("");
  const [personFilter, setPersonFilter] = useState("全部人員");
  const [showPerson, setShowPerson] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showRecord, setShowRecord] = useState(false);
  const [editing, setEditing] = useState<Person | null>(null);
  const [editPerson, setEditPerson] = useState<Person | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("mingjufish-worklog");
    if (saved) { try { const data = JSON.parse(saved); setPeople((data.people || seedPeople).map((p:Person)=>({...p,monthlySalary:p.monthlySalary ?? (p.role==="正職"?42000:0)}))); setRows(data.rows || seedRows); setSchedules(data.schedules || seedSchedules); } catch {} }
  }, []);
  useEffect(() => { localStorage.setItem("mingjufish-worklog", JSON.stringify({ people, rows, schedules })); }, [people, rows, schedules]);
  useEffect(() => { setUnlocked(sessionStorage.getItem("mingjufish-unlocked") === "yes"); }, []);

  const filtered = useMemo(() => {
    const now = new Date();
    const cutoff = new Date(now);
    if (range === "今日") cutoff.setHours(0, 0, 0, 0);
    if (range === "本週") { const delta = (now.getDay() + 6) % 7; cutoff.setDate(now.getDate() - delta); cutoff.setHours(0,0,0,0); }
    if (range === "本月") { cutoff.setDate(1); cutoff.setHours(0,0,0,0); }
    if (range === "近三個月") { cutoff.setMonth(now.getMonth() - 2, 1); cutoff.setHours(0,0,0,0); }
    return rows.filter(r => {
      const p = people.find(x => x.id === r.personId);
      return new Date(`${r.date}T12:00:00`) >= cutoff && (personFilter === "全部人員" || p?.name === personFilter) && (!query || p?.name.includes(query) || r.note.includes(query));
    }).sort((a,b) => b.date.localeCompare(a.date));
  }, [rows, people, range, personFilter, query]);

  const scheduleFor = (r: RecordRow) => schedules.find(s => s.personId === r.personId && s.date === r.date);
  const totalMin = filtered.reduce((sum, r) => sum + workMinutes(r, scheduleFor(r)), 0);
  const hourlyPayroll = filtered.reduce((sum, r) => { const p = people.find(x => x.id === r.personId); return sum + (p?.role === "正職" ? 0 : workMinutes(r,scheduleFor(r)) / 60 * (p?.rate || 0)); }, 0);
  const salaryMonths = range === "近三個月" ? 3 : range === "本月" ? 1 : 0;
  const fixedPayroll = salaryMonths * people.filter(p => p.role === "正職" && (personFilter === "全部人員" || p.name === personFilter)).reduce((sum,p)=>sum+p.monthlySalary,0);
  const payroll = hourlyPayroll + fixedPayroll;
  const pending = filtered.filter(r => !r.confirmed).length;

  function exportCsv() {
    const exportPeople = personFilter === "全部人員" ? people.filter(p=>filtered.some(r=>r.personId===p.id)) : people.filter(p=>p.name===personFilter);
    exportPeople.forEach((person,index) => setTimeout(() => {
      const personRows = filtered.filter(r=>r.personId===person.id);
      const lines = [["日期","星期","姓名","身分","每日排班","打卡上班","打卡下班","出勤工時","計薪方式","薪資金額","狀態","備註"], ...personRows.map(r => { const s=scheduleFor(r); const wm=workMinutes(r,s); return [r.date,`星期${weekday(r.date)}`,person.name,person.role,s?`${s.start}-${s.end}`:"未排班",r.clockIn,r.clockOut,(wm/60).toFixed(2),person.role==="正職"?"固定月薪":`時薪 ${person.rate}`,person.role==="正職"?person.monthlySalary:Math.round(wm/60*person.rate),r.confirmed?"已核對":"待核對",r.note]; })];
      const blob = new Blob(["\ufeff" + lines.map(x=>x.map(v=>`\"${String(v).replaceAll('"','""')}\"`).join(",")).join("\n")], {type:"text/csv;charset=utf-8"});
      const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`名桔鮮魚湯_${person.name}_${range}_${iso(today)}.csv`; a.click(); URL.revokeObjectURL(a.href);
    }, index*250));
  }

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    const data = new TextEncoder().encode(password);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data))).map(b => b.toString(16).padStart(2,"0")).join("");
    if (digest === "5e16c42acc61f7d814b586173a75c7aaab29a278ad7dcc103330c77430210614") { sessionStorage.setItem("mingjufish-unlocked","yes"); setUnlocked(true); setLoginError(false); }
    else { setLoginError(true); setPassword(""); }
  }

  if (!unlocked) return <main className="login-page"><section className="login-card"><div className="logo login-logo">桔</div><span className="eyebrow">MINGJU WORKLOG</span><h1>名桔鮮魚湯</h1><p>工時核對與薪資試算</p><form onSubmit={unlock}><label>管理密碼<input autoFocus type="password" inputMode="numeric" required value={password} onChange={e=>{setPassword(e.target.value);setLoginError(false)}} placeholder="請輸入密碼" /></label>{loginError&&<span className="login-error">密碼不正確，請重新輸入</span>}<button className="primary submit">進入工時管理</button></form><small>僅供授權管理人員使用</small></section></main>;

  return <main>
    <header>
      <div className="brand"><div className="logo">桔</div><div><h1>名桔鮮魚湯</h1><p>工時核對與薪資試算</p></div></div>
      <div className="header-actions"><span className="saved"><i />資料已自動儲存</span><button className="outline" onClick={exportCsv}>↓ 分人匯出 CSV</button><button className="primary" onClick={()=>{setEditPerson(null);setShowPerson(true)}}>＋ 新增人員</button></div>
    </header>

    <section className="hero">
      <div><span className="eyebrow">WORKFORCE OVERVIEW</span><h2>早安，今天也辛苦了。</h2><p>快速核對出勤、工時與預估薪資，所有資料都在這一頁。</p></div>
      <div className="date-card"><span>{today.toLocaleDateString("zh-TW",{year:"numeric",month:"long"})}</span><strong>{String(today.getDate()).padStart(2,"0")}</strong><b>星期{weekday(iso(today))}</b></div>
    </section>

    <section className="stats">
      <article><span>篩選總工時</span><strong>{fmtHours(totalMin)}</strong><small>依排班上限自動計算</small></article>
      <article><span>總人力成本</span><strong>{money(payroll)}</strong></article>
      <article><span>待核對紀錄</span><strong className={pending ? "orange":""}>{pending} 筆</strong><small>請確認異常或未核對項目</small></article>
      <article><span>目前人員</span><strong>{people.length} 人</strong><small>{people.filter(p=>p.role==="正職").length} 位正職 · {people.filter(p=>p.role!=="正職").length} 位計時</small></article>
    </section>

    <section className="workspace">
      <div className="toolbar">
        <div className="tabs">{["今日","本週","本月","近三個月"].map(x=><button key={x} className={range===x?"active":""} onClick={()=>{setRange(x);setPersonFilter(x==="今日"?"全部人員":people[0]?.name||"全部人員")}}>{x}</button>)}</div>
        <div className="filters"><input aria-label="搜尋" placeholder="搜尋姓名或備註..." value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="選取人員查看紀錄" value={personFilter} onChange={e=>setPersonFilter(e.target.value)}>{range==="今日"&&<option>全部人員</option>}{people.map(p=><option key={p.id}>{p.name}</option>)}</select><button className="outline" onClick={()=>{const p=people.find(x=>x.name===personFilter)||people[0];setEditing(p||null);setShowSchedule(true)}}>⚙ 設定 {personFilter==="全部人員"?(people[0]?.name||""):personFilter} 排班</button><button className="primary" onClick={()=>setShowRecord(true)}>＋ 新增紀錄</button></div>
      </div>
      <div className="table-wrap"><table><thead><tr><th>日期</th><th>人員</th><th>身分</th><th>計薪排班</th><th>打卡時間</th><th>計薪工時</th><th>預估薪資</th><th>核對狀態</th><th>備註</th></tr></thead><tbody>
        {filtered.map(r=>{const p=people.find(x=>x.id===r.personId)!;const s=scheduleFor(r);const wm=workMinutes(r,s);return <tr key={r.id}><td><b>{r.date.slice(5).replace("-","/")}</b><small>星期{weekday(r.date)}</small></td><td><span className="avatar">{p.name[0]}</span><b>{p.name}</b></td><td><span className="tag">{p.role}</span></td><td>{s?<>{s.start}–{s.end}</>:<span className="warn">未設定</span>}</td><td><b>{r.clockIn}–{r.clockOut}</b>{s&&(minutes(r.clockIn)<minutes(s.start)||minutes(r.clockOut)>minutes(s.end))&&<small className="warn">超出排班不計薪</small>}</td><td><b>{fmtHours(wm)}</b></td><td>{p.role==="正職"?<><b>{money(p.monthlySalary)}</b><small>固定月薪</small></>:<><b>{money(wm/60*p.rate)}</b><small>時薪 {p.rate}</small></>}</td><td><button className={r.confirmed?"status ok":"status"} onClick={()=>setRows(rows.map(x=>x.id===r.id?{...x,confirmed:!x.confirmed}:x))}>{r.confirmed?"✓ 已核對":"! 待核對"}</button></td><td>{r.note||"—"}</td></tr>})}
        {!filtered.length&&<tr><td colSpan={9} className="empty">此期間沒有符合條件的紀錄</td></tr>}
      </tbody></table></div>
      <div className="table-footer"><span>共 {filtered.length} 筆紀錄</span><b>總工時 {fmtHours(totalMin)}　總人力成本 {money(payroll)}</b></div>
    </section>

    <section className="people-section"><div className="section-title"><div><span className="eyebrow">TEAM & SCHEDULE</span><h3>人員與每日排班</h3></div></div><div className="people-grid">{people.map(p=>{const s=schedules.find(x=>x.personId===p.id&&x.date===iso(today));return <article key={p.id}><div className="person-head"><span className="avatar large">{p.name[0]}</span><div><b>{p.name}</b><small>{p.role} · {p.role==="正職"?`月薪 ${money(p.monthlySalary)}`:`時薪 ${money(p.rate)}`}</small></div></div><button className="schedule person-schedule" onClick={()=>{setEditing(p);setShowSchedule(true)}}><span>今日排班</span><strong>{s?`${s.start} — ${s.end}`:"今日未排班"}　›</strong></button><div className="person-actions"><button onClick={()=>{setEditPerson(p);setShowPerson(true)}}>編輯人員</button><button className="delete-btn" onClick={()=>{if(confirm(`確定刪除 ${p.name}？相關排班與出勤紀錄也會刪除。`)){setPeople(people.filter(x=>x.id!==p.id));setRows(rows.filter(x=>x.personId!==p.id));setSchedules(schedules.filter(x=>x.personId!==p.id));if(personFilter===p.name)setPersonFilter("全部人員")}}}>刪除</button></div></article>})}</div></section>
    <footer><b>名桔鮮魚湯 · 工時管理</b><span>計算結果僅供核對；實際薪資請依勞動契約、加班與休假規定結算。</span></footer>

    {showPerson&&<Modal title={editPerson?"編輯人員":"新增人員"} close={()=>{setShowPerson(false);setEditPerson(null)}}><PersonForm initial={editPerson||undefined} onSave={p=>{if(editPerson)setPeople(people.map(x=>x.id===editPerson.id?{...p,id:editPerson.id}:x));else setPeople([...people,{...p,id:Date.now()}]);setShowPerson(false);setEditPerson(null)}} /></Modal>}
    {showSchedule&&<Modal title="設定每日排班" close={()=>{setShowSchedule(false);setEditing(null)}}><DailyScheduleForm people={people} initialPersonId={editing?.id} schedules={schedules} onSave={s=>{const old=schedules.find(x=>x.personId===s.personId&&x.date===s.date);setSchedules(old?schedules.map(x=>x.id===old.id?{...s,id:old.id}:x):[...schedules,{...s,id:Date.now()}]);setShowSchedule(false);setEditing(null)}} /></Modal>}
    {showRecord&&<Modal title="新增出勤紀錄" close={()=>setShowRecord(false)}><RecordForm people={people} schedules={schedules} onSave={r=>{setRows([...rows,{...r,id:Date.now(),confirmed:false}]);setShowRecord(false)}} /></Modal>}
  </main>;
}

function Modal({title,close,children}:{title:string;close:()=>void;children:React.ReactNode}) { return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><div className="modal"><div className="modal-title"><h3>{title}</h3><button onClick={close}>×</button></div>{children}</div></div>; }
function PersonForm({initial,onSave}:{initial?:Person;onSave:(p:Omit<Person,"id">)=>void}) { const [v,setV]=useState({name:initial?.name||"",role:initial?.role||"計時",rate:initial?.rate||190,monthlySalary:initial?.monthlySalary||42000,start:initial?.start||"09:00",end:initial?.end||"18:00"}); return <form onSubmit={e=>{e.preventDefault();onSave(v)}}><label>姓名<input required value={v.name} onChange={e=>setV({...v,name:e.target.value})} placeholder="請輸入姓名"/></label><div className="form-row"><label>人員身分<select value={v.role} onChange={e=>setV({...v,role:e.target.value})}><option>正職</option><option>計時</option></select></label>{v.role==="計時"?<label>時薪（NT$）<input type="number" min="0" value={v.rate} onChange={e=>setV({...v,rate:+e.target.value})}/></label>:<label>固定月薪（NT$）<input type="number" min="0" required value={v.monthlySalary} onChange={e=>setV({...v,monthlySalary:+e.target.value})}/></label>}</div><p className="hint">可隨時編輯薪資；排班請從人員卡片進入設定。</p><button className="primary submit">儲存人員</button></form>; }
function DailyScheduleForm({people,initialPersonId,schedules,onSave}:{people:Person[];initialPersonId?:number;schedules:DailySchedule[];onSave:(s:Omit<DailySchedule,"id">)=>void}) { const [v,setV]=useState({personId:initialPersonId||people[0]?.id||0,date:iso(today),start:"09:00",end:"18:00"}); useEffect(()=>{const s=schedules.find(x=>x.personId===v.personId&&x.date===v.date);if(s)setV(o=>({...o,start:s.start,end:s.end}))},[v.personId,v.date,schedules]); return <form onSubmit={e=>{e.preventDefault();onSave(v)}}><label>人員<select value={v.personId} onChange={e=>setV({...v,personId:+e.target.value})}>{people.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label><label>排班日期<input type="date" value={v.date} onChange={e=>setV({...v,date:e.target.value})}/></label><div className="form-row"><label>排班上班<TimeSelect value={v.start} onChange={start=>setV({...v,start})}/></label><label>排班下班<TimeSelect value={v.end} onChange={end=>setV({...v,end})}/></label></div><p className="hint">直接選擇小時與分鐘，手機、電腦都容易操作；超出當天排班的打卡時間不計薪。</p><button className="primary submit">儲存每日排班</button></form>; }
function RecordForm({people,schedules,onSave}:{people:Person[];schedules:DailySchedule[];onSave:(r:Omit<RecordRow,"id"|"confirmed">)=>void}) { const [v,setV]=useState({personId:people[0]?.id||0,date:iso(today),clockIn:"09:00",clockOut:"18:00",breakMin:0,type:"正常",note:""}); useEffect(()=>{const s=schedules.find(x=>x.personId===v.personId&&x.date===v.date);if(s)setV(o=>({...o,clockIn:s.start,clockOut:s.end}))},[v.personId,v.date,schedules]);return <form onSubmit={e=>{e.preventDefault();onSave(v)}}><label>人員<select value={v.personId} onChange={e=>setV({...v,personId:+e.target.value})}>{people.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label><div className="form-row"><label>日期<input type="date" value={v.date} onChange={e=>setV({...v,date:e.target.value})}/></label><label>出勤類型<select value={v.type} onChange={e=>setV({...v,type:e.target.value})}><option>正常</option><option>特休</option><option>事假</option><option>病假</option><option>公休</option></select></label></div><div className="form-row"><label>打卡上班<TimeSelect value={v.clockIn} onChange={clockIn=>setV({...v,clockIn})}/></label><label>打卡下班<TimeSelect value={v.clockOut} onChange={clockOut=>setV({...v,clockOut})}/></label></div><label>備註<input value={v.note} onChange={e=>setV({...v,note:e.target.value})} placeholder="如：盤點、支援外場"/></label><button className="primary submit">新增紀錄</button></form>;}
function TimeSelect({value,onChange}:{value:string;onChange:(value:string)=>void}) { const [hour="00",minute="00"] = value.split(":"); const hours=Array.from({length:24},(_,i)=>String(i).padStart(2,"0")); const minuteOptions=Array.from({length:12},(_,i)=>String(i*5).padStart(2,"0")); return <div className="time-select"><select aria-label="小時" value={hour} onChange={e=>onChange(`${e.target.value}:${minute}`)}>{hours.map(h=><option key={h} value={h}>{h} 時</option>)}</select><span>：</span><select aria-label="分鐘" value={minuteOptions.includes(minute)?minute:"00"} onChange={e=>onChange(`${hour}:${e.target.value}`)}>{minuteOptions.map(m=><option key={m} value={m}>{m} 分</option>)}</select></div> }
