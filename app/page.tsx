"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { excessTime, excessApproved, approvalKey, payableMinutes, payableExcessMinutes, EXCESS_PAY_THRESHOLD_MINUTES, applyWeeklyTemplate, downloadCsv, type ScheduleTemplate } from "./worklog-helpers";

type Person = { id: number; name: string; employeeCode: string; pin: string; role: string; rate: number; monthlySalary: number; start: string; end: string };
type PunchEvent = { action: "上"|"下"; time: string; deviceId: string; deviceLabel: string; userAgent?: string; anomaly?: string };
type RecordRow = { id: number; personId: number; date: string; clockIn: string; clockOut: string; breakMin: number; type: string; note: string; confirmed: boolean; excessApproval?: string; punchEvents?: PunchEvent[]; punchAnomaly?: string };
type DailySchedule = { id: number; personId: number; date: string; start: string; end: string };

const seedPeople: Person[] = [
  { id: 1, name: "林怡君", employeeCode: "001", pin: "0000", role: "正職", rate: 0, monthlySalary: 42000, start: "09:30", end: "18:30" },
  { id: 2, name: "陳柏宇", employeeCode: "002", pin: "0000", role: "計時", rate: 190, monthlySalary: 0, start: "11:00", end: "20:00" },
  { id: 3, name: "王雅婷", employeeCode: "003", pin: "0000", role: "計時", rate: 190, monthlySalary: 0, start: "17:00", end: "22:00" },
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

const CLOUD_API = "https://mingjufish-worklog.starssand.chatgpt.site";

function minutes(t: string) { const [h, m] = t.split(":").map(Number); return h * 60 + m; }
function workMinutes(row: RecordRow, schedule?: DailySchedule) {
  return payableMinutes(row, schedule);
}
function fmtHours(min: number) { return `${(min / 60).toFixed(2)} 小時`; }
function weekday(date: string) { return ["日", "一", "二", "三", "四", "五", "六"][new Date(`${date}T12:00:00`).getDay()]; }
function money(n: number) { return `NT$ ${Math.round(n).toLocaleString("zh-TW")}`; }

export default function Home() {
  const [people, setPeople] = useState<Person[]>(seedPeople);
  const [rows, setRows] = useState<RecordRow[]>(seedRows);
  const [schedules, setSchedules] = useState<DailySchedule[]>(seedSchedules);
  const [scheduleTemplate, setScheduleTemplate] = useState<ScheduleTemplate | null>(null);
  const [range, setRange] = useState("今日");
  const [query, setQuery] = useState("");
  const [personFilter, setPersonFilter] = useState("全部人員");
  const [showPerson, setShowPerson] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showRecord, setShowRecord] = useState(false);
  const [credentialPerson, setCredentialPerson] = useState<Person | null>(null);
  const [editing, setEditing] = useState<Person | null>(null);
  const [editingDate, setEditingDate] = useState<string>();
  const [editPerson, setEditPerson] = useState<Person | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState(false);
  const [loginMessage, setLoginMessage] = useState("");
  const [cloudReady, setCloudReady] = useState(false);
  const [saveState, setSaveState] = useState<"saved"|"saving"|"error">("saved");
  const skipNextSave = useRef(false);

  useEffect(() => {
    const token = sessionStorage.getItem("mingjufish-token");
    if (token) loadCloud(token);
  }, []);
  useEffect(() => {
    if (!cloudReady) return;
    if (skipNextSave.current) { skipNextSave.current=false; return; }
    setSaveState("saving");
    const timer = window.setTimeout(async () => {
      const token = sessionStorage.getItem("mingjufish-token");
      if (!token) return;
      try {
        const response = await fetch(`${CLOUD_API}/api/state`, {method:"PUT",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({people,rows,schedules,scheduleTemplate})});
        if (!response.ok) throw new Error();
        localStorage.setItem("mingjufish-worklog", JSON.stringify({people,rows,schedules}));
        setSaveState("saved");
      } catch { setSaveState("error"); }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [people, rows, schedules, scheduleTemplate, cloudReady]);

  useEffect(()=>{
    if(!cloudReady||saveState!=="saved")return;
    const timer=window.setInterval(()=>{const token=sessionStorage.getItem("mingjufish-token");if(token)loadCloud(token)},8000);
    return()=>window.clearInterval(timer);
  },[cloudReady,saveState]);

  async function loadCloud(token: string) {
    try {
      const response = await fetch(`${CLOUD_API}/api/state`, {headers:{Authorization:`Bearer ${token}`}});
      if (response.status === 401) throw new Error("登入已失效");
      if (!response.ok) throw new Error("雲端資料讀取失敗");
      const result = await response.json();
      let data = result.state;
      const needsCredentialMigration=!!data?.people?.some((p:Person)=>!p.employeeCode||!p.pin);
      if(data&&!needsCredentialMigration)skipNextSave.current=true;
      if (!data) {
        const saved = localStorage.getItem("mingjufish-worklog");
        data = saved ? JSON.parse(saved) : {people:seedPeople,rows:seedRows,schedules:seedSchedules};
      }
      setPeople((data.people || []).map((p:Person,index:number)=>({...p,employeeCode:p.employeeCode||String(index+1).padStart(3,"0"),pin:p.pin||"0000",monthlySalary:p.monthlySalary ?? (p.role==="正職"?42000:0)})));
      setRows(data.rows || []); setSchedules(data.schedules || []);
      setScheduleTemplate(data.scheduleTemplate || null);
      setUnlocked(true); setCloudReady(true); setLoginError(false);
    } catch (error) {
      sessionStorage.removeItem("mingjufish-token"); setUnlocked(false); setCloudReady(false);
      setLoginError(true); setLoginMessage(error instanceof Error ? error.message : "目前無法連線，請稍後再試");
    }
  }

  const periodRows = useMemo(() => {
    const now = new Date();
    const cutoff = new Date(now);
    if (range === "今日") cutoff.setHours(0, 0, 0, 0);
    if (range === "本週") { const delta = (now.getDay() + 6) % 7; cutoff.setDate(now.getDate() - delta); cutoff.setHours(0,0,0,0); }
    if (range === "本月") { cutoff.setDate(1); cutoff.setHours(0,0,0,0); }
    if (range === "近三個月") { cutoff.setMonth(now.getMonth() - 2, 1); cutoff.setHours(0,0,0,0); }
    return rows.filter(r => new Date(`${r.date}T12:00:00`) >= cutoff);
  }, [rows, range]);
  const filtered = useMemo(() => periodRows.filter(r => {
    const p = people.find(x => x.id === r.personId);
    return (personFilter === "全部人員" || p?.name === personFilter) && (!query || p?.name.includes(query) || r.note.includes(query) || r.punchAnomaly?.includes(query) || r.punchEvents?.some(e=>e.deviceLabel.includes(query)));
  }).sort((a,b) => b.date.localeCompare(a.date)), [periodRows, people, personFilter, query]);

  const scheduleFor = (r: RecordRow) => schedules.find(s => s.personId === r.personId && s.date === r.date);
  const totalMin = filtered.reduce((sum, r) => sum + workMinutes(r, scheduleFor(r)), 0);
  const hourlyPayroll = periodRows.reduce((sum, r) => { const p = people.find(x => x.id === r.personId); return sum + (p?.role === "正職" ? 0 : workMinutes(r,scheduleFor(r)) / 60 * (p?.rate || 0)); }, 0);
  const salaryMonths = range === "近三個月" ? 3 : range === "本月" ? 1 : 0;
  const fixedPayroll = salaryMonths * people.filter(p => p.role === "正職").reduce((sum,p)=>sum+p.monthlySalary,0);
  const payroll = hourlyPayroll + fixedPayroll;
  const pending = filtered.filter(r => !r.confirmed).length;
  const excessRows = filtered.flatMap(row => { const extra = excessTime(row, scheduleFor(row)); return extra ? [{ row, extra }] : []; });
  function exportExcess() {
    const exportRows = periodRows.flatMap(row => { const extra=excessTime(row,scheduleFor(row)); return extra?[{row,extra}]:[]; });
    const lines: (string | number)[][] = [["名桔鮮魚湯｜超過下班時間紀錄"], ["期間", range, "全部人員（包含未審核）"], ["說明", `所有超過排班下班時間的紀錄都列出；提早上班不計。超時達 ${EXCESS_PAY_THRESHOLD_MINUTES} 分鐘且審核通過才計入工時與計時薪資，正職月薪不變`], [], ["日期", "星期", "員編", "姓名", "排班下班", "超過開始", "超過結束", "超過總分鐘", "超過總時數", "審核狀態", "計薪資格", "計入分鐘", "備註"]];
    exportRows.forEach(({ row, extra }) => { const person = people.find(p => p.id === row.personId); const paid=payableExcessMinutes(row,scheduleFor(row)); lines.push([row.date, `星期${weekday(row.date)}`, person?.employeeCode || "", person?.name || "已刪除人員", scheduleFor(row)!.end, extra.start, extra.end, extra.minutes, (extra.minutes / 60).toFixed(2), excessApproved(row,scheduleFor(row)) ? "審核通過" : "尚未審核", extra.minutes>=EXCESS_PAY_THRESHOLD_MINUTES?"已達30分鐘":"未滿30分鐘，不計薪", paid, row.note]); });
    const total = exportRows.reduce((sum, item) => sum + item.extra.minutes, 0);
    lines.push(["合計", "", "", "", "", "", "", total, (total / 60).toFixed(2), "", "", exportRows.reduce((sum,{row})=>sum+payableExcessMinutes(row,scheduleFor(row)),0)]);
    downloadCsv(lines, `名桔鮮魚湯_超過下班時間_${range}_${iso(new Date())}.csv`);
  }

  function exportCsv() {
    const exportPeople = personFilter === "全部人員" ? people.filter(p=>filtered.some(r=>r.personId===p.id)) : people.filter(p=>p.name===personFilter);
    exportPeople.forEach((person,index) => setTimeout(() => {
      const personRows = filtered.filter(r=>r.personId===person.id);
      const lines = [["日期","星期","姓名","身分","每日排班","打卡上班","打卡下班","出勤工時","計薪方式","薪資金額","打卡檢查","裝置","狀態","備註"], ...personRows.map(r => { const s=scheduleFor(r); const wm=workMinutes(r,s); const devices=[...new Set((r.punchEvents||[]).map(e=>e.deviceLabel).filter(Boolean))].join("／"); return [r.date,`星期${weekday(r.date)}`,person.name,person.role,s?`${s.start}-${s.end}`:"未排班",r.clockIn,r.clockOut,(wm/60).toFixed(2),person.role==="正職"?"固定月薪":`時薪 ${person.rate}`,person.role==="正職"?person.monthlySalary:Math.round(wm/60*person.rate),r.punchAnomaly||"正常／無裝置資料",devices,r.confirmed?"已核對":"待核對",r.note]; })];
      const blob = new Blob(["\ufeff" + lines.map(x=>x.map(v=>`\"${String(v).replaceAll('"','""')}\"`).join(",")).join("\n")], {type:"text/csv;charset=utf-8"});
      const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`名桔鮮魚湯_${person.name}_${range}_${iso(today)}.csv`; a.click(); URL.revokeObjectURL(a.href);
    }, index*250));
  }

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setLoginError(false); setLoginMessage("正在連線雲端資料…");
    try {
      const response = await fetch(`${CLOUD_API}/api/auth`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password})});
      if (!response.ok) throw new Error(response.status===401?"密碼不正確，請重新輸入":"目前無法連線，請稍後再試");
      const {token} = await response.json(); sessionStorage.setItem("mingjufish-token",token); await loadCloud(token);
    } catch (error) { setLoginError(true); setLoginMessage(error instanceof Error?error.message:"登入失敗"); setPassword(""); }
  }

  if (!unlocked) return <main className="login-page"><section className="login-card"><div className="logo login-logo">桔</div><span className="eyebrow">MINGJU WORKLOG</span><h1>名桔鮮魚湯</h1><p>工時核對與薪資試算</p><form onSubmit={unlock}><label>管理密碼<input autoFocus type="password" inputMode="numeric" required value={password} onChange={e=>{setPassword(e.target.value);setLoginError(false)}} placeholder="請輸入密碼" /></label>{loginMessage&&<span className={loginError?"login-error":"hint"}>{loginMessage}</span>}<button className="primary submit">進入工時管理</button></form><small>手機與電腦會共用同一份雲端資料</small></section></main>;

  return <main>
    <header>
      <div className="brand"><div className="logo">桔</div><div><h1>名桔鮮魚湯</h1><p>工時核對與薪資試算</p></div></div>
      <div className="header-actions"><span className="saved"><i />{saveState==="saving"?"正在同步…":saveState==="error"?"同步失敗，請檢查網路":"已同步至雲端"}</span><button className="outline qr-button" onClick={()=>{const path=window.location.hostname.endsWith("github.io")?"/mingjufish/qr/":"/qr/";window.open(`${window.location.origin}${path}`,"mingjufish-qr")}}>▦ 開啟店內 QR 頁</button><button className="outline" onClick={exportCsv}>↓ 分人匯出 CSV</button><button className="primary" onClick={()=>{setEditPerson(null);setShowPerson(true)}}>＋ 新增人員</button></div>
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
        <div className="tabs">{["今日","本週","本月","近三個月"].map(x=><button key={x} className={range===x?"active":""} onClick={()=>setRange(x)}>{x}</button>)}</div>
        <div className="filters"><input aria-label="搜尋" placeholder="搜尋姓名、備註或異常..." value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="選取人員查看紀錄" value={personFilter} onChange={e=>setPersonFilter(e.target.value)}><option>全部人員</option>{people.map(p=><option key={p.id}>{p.name}</option>)}</select><button className="outline" disabled={personFilter==="全部人員"||!people.length} onClick={()=>{const p=people.find(x=>x.name===personFilter);setEditing(p||null);setShowSchedule(true)}}>⚙ {personFilter==="全部人員"?"請先選人員":"設定 "+personFilter+" 排班"}</button><button className="primary" onClick={()=>setShowRecord(true)}>＋ 新增紀錄</button></div>
      </div>
      <div className="table-wrap"><table><thead><tr><th>日期</th><th>人員</th><th>身分</th><th>計薪排班</th><th>打卡時間</th><th>計薪工時</th><th>預估薪資</th><th>打卡檢查</th><th>核對狀態</th><th>備註</th><th>操作</th></tr></thead><tbody>
        {filtered.map(r=>{const p=people.find(x=>x.id===r.personId)!;const s=scheduleFor(r);const wm=workMinutes(r,s);const devices=[...new Set((r.punchEvents||[]).map(e=>e.deviceLabel).filter(Boolean))];return <tr className={r.punchAnomaly?"anomaly-row":""} key={r.id}><td><b>{r.date.slice(5).replace("-","/")}</b><small>星期{weekday(r.date)}</small></td><td><span className="avatar">{p.name[0]}</span><b>{p.name}</b></td><td><span className="tag">{p.role}</span></td><td>{s?<>{s.start}–{s.end}</>:<span className="warn">未設定</span>}</td><td><b>{r.clockIn}–{r.clockOut}</b>{s&&(minutes(r.clockIn)<minutes(s.start)||minutes(r.clockOut)>minutes(s.end))&&<small className="warn">{excessApproved(r,s)?"超過下班時數已審核；提早上班不計入":"超過下班須審核；提早上班不計入"}</small>}</td><td><b>{fmtHours(wm)}</b></td><td>{p.role==="正職"?<><b>{money(p.monthlySalary)}</b><small>固定月薪</small></>:<><b>{money(wm/60*p.rate)}</b><small>時薪 {p.rate}</small></>}</td><td>{r.punchAnomaly?<><span className="anomaly-badge">⚠ 打卡異常</span><small className="anomaly-detail">{r.punchAnomaly}</small></>:r.punchEvents?.length?<><span className="device-ok">裝置已記錄</span><small>{devices.join("／")}</small></>:<small>舊紀錄／手動新增</small>}</td><td><button className={r.confirmed?"status ok":"status"} onClick={()=>setRows(rows.map(x=>x.id===r.id?{...x,confirmed:!x.confirmed}:x))}>{r.confirmed?"✓ 已核對":"! 待核對"}</button></td><td>{r.note||"—"}</td><td><button className="record-delete" onClick={()=>{if(confirm(`確定刪除 ${p.name} ${r.date} 的出勤紀錄？`))setRows(rows.filter(x=>x.id!==r.id))}}>刪除</button></td></tr>})}
        {!filtered.length&&<tr><td colSpan={11} className="empty">此期間沒有符合條件的紀錄</td></tr>}
      </tbody></table></div>
      <div className="table-footer"><span>共 {filtered.length} 筆紀錄</span><b>總工時 {fmtHours(totalMin)}　總人力成本 {money(payroll)}</b></div>
    </section>

    <section className="people-section"><div className="section-title"><div><h3>超過下班時間紀錄</h3><p className="hint">依上方日期與人員篩選。提早上班不計入；所有超時都保留完整紀錄。超時達 30 分鐘且審核通過，才計入總工時與計時薪資；正職月薪不變。變更打卡或排班時間後須重新審核。</p></div><button className="outline" onClick={exportExcess}>↓ 超過時數 CSV</button></div><div className="weekly-wrap"><table className="weekly-table"><thead><tr><th>日期</th><th>姓名</th><th>超過開始</th><th>超過結束</th><th>超過總時間</th><th>計薪資格</th><th>審核</th></tr></thead><tbody>{excessRows.map(({row,extra})=><tr key={row.id}><td>{row.date}</td><td>{people.find(p=>p.id===row.personId)?.name || "已刪除人員"}</td><td>{extra.start}</td><td>{extra.end}</td><td>{Math.floor(extra.minutes/60)} 小時 {extra.minutes%60} 分鐘</td><td>{extra.minutes>=EXCESS_PAY_THRESHOLD_MINUTES?"達 30 分鐘":"未滿 30 分鐘，不計薪"}</td><td><button type="button" className={excessApproved(row,scheduleFor(row))?"status ok":"status"} aria-pressed={excessApproved(row,scheduleFor(row))} aria-label={`${people.find(p=>p.id===row.personId)?.name} ${row.date} 超過時數審核`} onClick={()=>setRows(current=>current.map(r=>r.id===row.id?{...r,excessApproval:excessApproved(r,scheduleFor(r))?undefined:approvalKey(r,scheduleFor(r))}:r))}>{excessApproved(row,scheduleFor(row))?"✓ 審核通過":"尚未審核"}</button></td></tr>)}{!excessRows.length&&<tr><td colSpan={7}>目前篩選範圍沒有超過下班時間的紀錄</td></tr>}</tbody></table></div></section>
    <WeeklyPlanner people={people} rows={rows} schedules={schedules} template={scheduleTemplate} onTemplate={setScheduleTemplate} onApply={(template,dates)=>setSchedules(current=>applyWeeklyTemplate(current,template,dates,people.map(p=>p.id),rows.map(r=>`${r.personId}:${r.date}`)))} onEdit={(person,date)=>{setEditing(person);setEditingDate(date);setShowSchedule(true)}}/>

    <section className="people-section"><div className="section-title"><div><span className="eyebrow">TEAM & SCHEDULE</span><h3>人員與每日排班</h3></div></div><div className="people-grid">{people.map(p=>{const s=schedules.find(x=>x.personId===p.id&&x.date===iso(today));return <article key={p.id}><div className="person-head"><span className="avatar large">{p.name[0]}</span><div><b>{p.name}</b><small>{p.role} · {p.role==="正職"?`月薪 ${money(p.monthlySalary)}`:`時薪 ${money(p.rate)}`}</small></div></div><button className="schedule person-schedule" onClick={()=>{setEditing(p);setShowSchedule(true)}}><span>今日排班</span><strong>{s?`${s.start} — ${s.end}`:"今日未排班"}　›</strong></button><div className="person-actions"><button onClick={()=>setCredentialPerson(p)}>設定員編 / PIN</button><button onClick={()=>{setEditPerson(p);setShowPerson(true)}}>編輯資料</button><button className="delete-btn" onClick={()=>{if(confirm(`確定刪除 ${p.name}？相關排班與出勤紀錄也會刪除。`)){setPeople(people.filter(x=>x.id!==p.id));setRows(rows.filter(x=>x.personId!==p.id));setSchedules(schedules.filter(x=>x.personId!==p.id));if(personFilter===p.name)setPersonFilter("全部人員")}}}>刪除</button></div></article>})}</div></section>
    <footer><b>名桔鮮魚湯 · 工時管理</b><span>計算結果僅供核對；實際薪資請依勞動契約、加班與休假規定結算。</span></footer>

    {showPerson&&<Modal title={editPerson?"編輯人員":"新增人員"} close={()=>{setShowPerson(false);setEditPerson(null)}}><PersonForm initial={editPerson||undefined} onSave={p=>{if(editPerson)setPeople(people.map(x=>x.id===editPerson.id?{...p,id:editPerson.id}:x));else setPeople([...people,{...p,id:Date.now()}]);setShowPerson(false);setEditPerson(null)}} /></Modal>}
    {showSchedule&&<Modal title="設定每日排班" close={()=>{setShowSchedule(false);setEditing(null);setEditingDate(undefined)}}><DailyScheduleForm people={people} initialPersonId={editing?.id} initialDate={editingDate} schedules={schedules} onSave={s=>{const old=schedules.find(x=>x.personId===s.personId&&x.date===s.date);setSchedules(old?schedules.map(x=>x.id===old.id?{...s,id:old.id}:x):[...schedules,{...s,id:Date.now()}]);setShowSchedule(false);setEditing(null);setEditingDate(undefined)}} /></Modal>}
    {showRecord&&<Modal title="新增出勤紀錄" close={()=>setShowRecord(false)}><RecordForm people={people} schedules={schedules} onSave={r=>{setRows([...rows,{...r,id:Date.now(),confirmed:false}]);setRange("今日");setPersonFilter("全部人員");setQuery("");setShowRecord(false)}} /></Modal>}
    {credentialPerson&&<Modal title="管理員設定員編與 PIN" close={()=>setCredentialPerson(null)}><CredentialForm person={credentialPerson} people={people} onSave={(employeeCode,pin)=>{setPeople(people.map(p=>p.id===credentialPerson.id?{...p,employeeCode,pin}:p));setCredentialPerson(null)}}/></Modal>}
  </main>;
}

function Modal({title,close,children}:{title:string;close:()=>void;children:React.ReactNode}) { return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><div className="modal"><div className="modal-title"><h3>{title}</h3><button onClick={close}>×</button></div>{children}</div></div>; }
function PersonForm({initial,onSave}:{initial?:Person;onSave:(p:Omit<Person,"id">)=>void}) { const [v,setV]=useState({name:initial?.name||"",employeeCode:initial?.employeeCode||"",pin:initial?.pin||"",role:initial?.role||"計時",rate:initial?.rate||190,monthlySalary:initial?.monthlySalary||42000,start:initial?.start||"09:00",end:initial?.end||"18:00"}); return <form onSubmit={e=>{e.preventDefault();onSave(v)}}><label>姓名<input required value={v.name} onChange={e=>setV({...v,name:e.target.value})} placeholder="請輸入姓名"/></label><div className="form-row"><label>員工編號<input required inputMode="numeric" value={v.employeeCode} onChange={e=>setV({...v,employeeCode:e.target.value})} placeholder="例如 001"/></label><label>打卡 PIN<input required inputMode="numeric" minLength={4} value={v.pin} onChange={e=>setV({...v,pin:e.target.value})} placeholder="至少 4 碼"/></label></div><div className="form-row"><label>人員身分<select value={v.role} onChange={e=>setV({...v,role:e.target.value})}><option>正職</option><option>計時</option></select></label>{v.role==="計時"?<label>時薪（NT$）<input type="number" min="0" value={v.rate} onChange={e=>setV({...v,rate:+e.target.value})}/></label>:<label>固定月薪（NT$）<input type="number" min="0" required value={v.monthlySalary} onChange={e=>setV({...v,monthlySalary:+e.target.value})}/></label>}</div><p className="hint">員編與 PIN 供動態 QR 打卡使用；請為每位人員設定不同 PIN。</p><button className="primary submit">儲存人員</button></form>; }
function CredentialForm({person,people,onSave}:{person:Person;people:Person[];onSave:(employeeCode:string,pin:string)=>void}) { const [employeeCode,setEmployeeCode]=useState(person.employeeCode);const [pin,setPin]=useState(person.pin);const [error,setError]=useState("");return <form onSubmit={e=>{e.preventDefault();if(people.some(p=>p.id!==person.id&&p.employeeCode===employeeCode.trim())){setError("員工編號不可重複");return}onSave(employeeCode.trim(),pin)}}><p className="hint">只有輸入管理密碼後才能設定。員工打卡頁只能輸入，無法查看或修改 PIN。</p><label>人員<input value={person.name} disabled/></label><label>員工編號<input required inputMode="numeric" value={employeeCode} onChange={e=>{setEmployeeCode(e.target.value);setError("")}} placeholder="例如 001"/></label><label>個人打卡 PIN<input required type="text" autoComplete="off" spellCheck={false} inputMode="numeric" minLength={4} value={pin} onChange={e=>setPin(e.target.value)} placeholder="至少 4 碼"/></label>{error&&<span className="login-error">{error}</span>}<button className="primary submit">儲存打卡設定</button></form>}
function DailyScheduleForm({people,initialPersonId,initialDate,schedules,onSave}:{people:Person[];initialPersonId?:number;initialDate?:string;schedules:DailySchedule[];onSave:(s:Omit<DailySchedule,"id">)=>void}) { const [v,setV]=useState({personId:initialPersonId||people[0]?.id||0,date:initialDate||iso(today),start:"09:00",end:"18:00"}); useEffect(()=>{const s=schedules.find(x=>x.personId===v.personId&&x.date===v.date);if(s)setV(o=>({...o,start:s.start,end:s.end}))},[v.personId,v.date,schedules]); return <form onSubmit={e=>{e.preventDefault();onSave(v)}}><label>人員<select value={v.personId} onChange={e=>setV({...v,personId:+e.target.value})}>{people.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label><label>排班日期<input type="date" value={v.date} onChange={e=>setV({...v,date:e.target.value})}/></label><div className="form-row"><label>排班上班<TimeSelect value={v.start} onChange={start=>setV({...v,start})}/></label><label>排班下班<TimeSelect value={v.end} onChange={end=>setV({...v,end})}/></label></div><p className="hint">直接選擇小時與分鐘，手機、電腦都容易操作；超出當天排班的打卡時間不計薪。</p><button className="primary submit">儲存每日排班</button></form>; }
function RecordForm({people,schedules,onSave}:{people:Person[];schedules:DailySchedule[];onSave:(r:Omit<RecordRow,"id"|"confirmed">)=>void}) { const [v,setV]=useState({personId:people[0]?.id||0,date:iso(today),clockIn:"09:00",clockOut:"18:00",breakMin:0,type:"正常",note:""}); useEffect(()=>{const s=schedules.find(x=>x.personId===v.personId&&x.date===v.date);if(s)setV(o=>({...o,clockIn:s.start,clockOut:s.end}))},[v.personId,v.date,schedules]);return <form onSubmit={e=>{e.preventDefault();onSave(v)}}><label>人員<select value={v.personId} onChange={e=>setV({...v,personId:+e.target.value})}>{people.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label><div className="form-row"><label>日期<input type="date" value={v.date} onChange={e=>setV({...v,date:e.target.value})}/></label><label>出勤類型<select value={v.type} onChange={e=>setV({...v,type:e.target.value})}><option>正常</option><option>特休</option><option>事假</option><option>病假</option><option>公休</option></select></label></div><div className="form-row"><label>打卡上班<TimeSelect value={v.clockIn} onChange={clockIn=>setV({...v,clockIn})}/></label><label>打卡下班<TimeSelect value={v.clockOut} onChange={clockOut=>setV({...v,clockOut})}/></label></div><label>備註<input value={v.note} onChange={e=>setV({...v,note:e.target.value})} placeholder="如：盤點、支援外場"/></label><button className="primary submit">新增紀錄</button></form>;}

function WeeklyPlanner({people,rows,schedules,template,onTemplate,onApply,onEdit}:{people:Person[];rows:RecordRow[];schedules:DailySchedule[];template:ScheduleTemplate|null;onTemplate:(template:ScheduleTemplate)=>void;onApply:(template:ScheduleTemplate,dates:string[])=>void;onEdit:(person:Person,date:string)=>void}) {
  const [offset,setOffset]=useState(0);
  const [editingTemplate,setEditingTemplate]=useState<ScheduleTemplate|null>(null);
  const dates=useMemo(()=>{const d=new Date();const delta=(d.getDay()+6)%7;d.setDate(d.getDate()-delta+offset*7);return Array.from({length:7},(_,i)=>{const x=new Date(d);x.setDate(d.getDate()+i);return iso(x)})},[offset]);
  function downloadCsv(lines:(string|number)[][],filename:string){const csv="\ufeff"+lines.map(row=>row.map(value=>`"${String(value).replaceAll('"','""')}"`).join(",")).join("\n");const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=filename;a.click();URL.revokeObjectURL(a.href)}
  function exportWeekSchedule(){
    const weekNames=["星期一","星期二","星期三","星期四","星期五","星期六","星期日"];
    const lines:(string|number)[][]=[["名桔鮮魚湯｜每週排班表"],["期間",dates[0],"至",dates[6]],[],["員工","身分",...dates.map((d,i)=>`${weekNames[i]} ${d.slice(5).replace("-","/")}`),"本週時數"]];
    people.forEach(person=>{let total=0;const shifts=dates.map(date=>{const s=schedules.find(x=>x.personId===person.id&&x.date===date);if(!s)return "休";total+=Math.max(0,minutes(s.end)-minutes(s.start));return `${s.start}–${s.end}`});lines.push([person.name,person.role,...shifts,(total/60).toFixed(1)]);});
    downloadCsv(lines,`名桔鮮魚湯_員工週班表_${dates[0]}_${dates[6]}.csv`);
  }
  function exportMonthSchedule(){
    const anchor=new Date(`${dates[0]}T12:00:00`),year=anchor.getFullYear(),month=anchor.getMonth();
    const first=`${year}-${String(month+1).padStart(2,"0")}-01`,lastDate=new Date(year,month+1,0).getDate(),last=`${year}-${String(month+1).padStart(2,"0")}-${String(lastDate).padStart(2,"0")}`;
    const monthRows=rows.filter(r=>r.date>=first&&r.date<=last).sort((a,b)=>a.date.localeCompare(b.date));
    const lines:(string|number)[][]=[["名桔鮮魚湯｜會計月工時與薪資核對表"],["月份",`${year}年${month+1}月`],["說明","一般工時與核准超時分開統計；核准超時不換算加班費"],[]];
    people.forEach(person=>{
      const personRows=monthRows.filter(r=>r.personId===person.id);
      let regularMinutes=0,approvedExtraMinutes=0;
      const details=personRows.map(r=>{const schedule=schedules.find(s=>s.personId===r.personId&&s.date===r.date);const extra=excessTime(r,schedule);const approvedMinutes=payableExcessMinutes(r,schedule);const total=payableMinutes(r,schedule);const regular=Math.max(0,total-approvedMinutes);regularMinutes+=regular;approvedExtraMinutes+=approvedMinutes;return{r,regular,extra:approvedMinutes?extra:null};});
      const regularAmount=person.role==="正職"?person.monthlySalary:Math.round(regularMinutes/60*person.rate);
      lines.push(["員工",person.name,"員編",person.employeeCode,"身分",person.role]);
      lines.push(["一般工時合計",(regularMinutes/60).toFixed(2),"小時","對應金額",regularAmount,"計薪方式",person.role==="正職"?"固定月薪":`時薪 ${person.rate}`]);
      lines.push(["核准超時合計",(approvedExtraMinutes/60).toFixed(2),"小時","加班費","不換算"]);
      lines.push(["日期","星期","打卡上班","打卡下班","一般工時","對應金額","核准超時開始","核准超時結束","核准超時"]);
      details.forEach(({r,regular,extra})=>lines.push([r.date,`星期${weekday(r.date)}`,r.clockIn,r.clockOut,(regular/60).toFixed(2),person.role==="正職"?"固定月薪":Math.round(regular/60*person.rate),extra?.start||"",extra?.end||"",extra?(extra.minutes/60).toFixed(2):""]));
      if(!details.length)lines.push(["本月沒有出勤紀錄"]);
      lines.push([]);
    });
    downloadCsv(lines,`名桔鮮魚湯_會計月工時薪資_${first}_${last}.csv`)
  }
  return <section className="people-section weekly-section"><div className="section-title"><div><span className="eyebrow">WEEKLY SCHEDULE</span><h3>每週排班表</h3></div><div className="week-nav"><button onClick={()=>setOffset(offset-1)}>‹ 上週</button><button onClick={()=>setOffset(0)} className={offset===0?"active":""}>本週</button><button onClick={()=>setOffset(offset+1)}>下週 ›</button><button className="download-schedule" onClick={exportWeekSchedule}>↓ 員工週班表 CSV</button><button className="download-schedule month-download" onClick={exportMonthSchedule}>↓ 會計月班表 CSV</button></div></div><div className="template-toolbar"><b>每週班表範本：{template?.name || "尚未建立"}</b><button className="outline" onClick={()=>{if(template&&!confirm("要以目前這週班表取代範本內容？儲存後才會生效。"))return;setEditingTemplate({name:template?.name || "常用班表",shifts:schedules.filter(s=>dates.includes(s.date)&&people.some(p=>p.id===s.personId)).map(s=>({personId:s.personId,day:dates.indexOf(s.date),start:s.start,end:s.end}))})}}>以本週建立範本</button><button className="outline" disabled={!template} onClick={()=>setEditingTemplate(template)}>修改範本</button><button className="primary" disabled={!template||!people.length} onClick={()=>{if(template&&confirm(`將「${template.name}」套用至 ${dates[0]} ～ ${dates[6]}？這週未打卡的排班會被取代，範本休息日將清除該日排班；已有出勤紀錄的日期不變。`)){onApply(template,dates);alert("範本已套用，可繼續點選日期修改排班。已有出勤紀錄的日期已保留。")}}}>一鍵套用至這週</button><p className="hint">範本依週一至週日保存；修改範本不會更動已排好的班表。套用後仍可個別調整。</p></div>{editingTemplate&&<Modal title="編輯每週班表範本" close={()=>setEditingTemplate(null)}><TemplateForm people={people} initial={editingTemplate} onSave={value=>{onTemplate(value);setEditingTemplate(null)}}/></Modal>}<div className="weekly-wrap"><table className="weekly-table"><thead><tr><th>人員</th>{dates.map((date,i)=><th key={date}><b>週{["一","二","三","四","五","六","日"][i]}</b><span>{date.slice(5).replace("-","/")}</span></th>)}</tr></thead><tbody>{people.map(person=><tr key={person.id}><td><b>{person.name}</b><small>{person.employeeCode}</small></td>{dates.map(date=>{const s=schedules.find(x=>x.personId===person.id&&x.date===date);return <td key={date}><button className={s?"shift-cell set":"shift-cell"} onClick={()=>onEdit(person,date)}>{s?<><b>{s.start}</b><span>{s.end}</span></>:"＋ 設定"}</button></td>})}</tr>)}</tbody></table></div><p className="week-hint">週班表提供員工查看；月班表依目前顯示週所在月份整理，提供會計核對。每次只會下載你按下的那一份。</p></section>
}

function TemplateForm({people,initial,onSave}:{people:Person[];initial:ScheduleTemplate;onSave:(value:ScheduleTemplate)=>void}) {
  const [draft,setDraft]=useState<ScheduleTemplate>({name:initial.name,shifts:initial.shifts.filter(s=>people.some(p=>p.id===s.personId)).map(s=>({...s}))});
  const [selectedDay,setSelectedDay]=useState(0);
  const [error,setError]=useState("");
  function update(personId:number,shift:{start:string;end:string}|null){setDraft(current=>({...current,shifts:[...current.shifts.filter(s=>s.personId!==personId||s.day!==selectedDay),...(shift?[{personId,day:selectedDay,...shift}]:[])]}));setError("")}
  return <form onSubmit={e=>{e.preventDefault();if(!draft.name.trim())return;if(draft.shifts.some(s=>s.end<=s.start)){setError("下班時間必須晚於上班時間，請檢查各人員的範本。");return}onSave({...draft,name:draft.name.trim()})}}><label>範本名稱<input required maxLength={50} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label><label>設定星期<select value={selectedDay} onChange={e=>setSelectedDay(Number(e.target.value))}>{["一","二","三","四","五","六","日"].map((name,index)=><option key={index} value={index}>星期{name}</option>)}</select></label><p className="hint">先選星期，再設定當天所有人員。取消「上班」表示休息；儲存會包含整週設定，切換星期不會清除已填內容。</p>{people.map(person=>{const shift=draft.shifts.find(s=>s.personId===person.id&&s.day===selectedDay);return <fieldset className="template-day" key={person.id}><legend>{person.name} · {person.role}</legend><label><input type="checkbox" checked={!!shift} onChange={e=>update(person.id,e.target.checked?{start:"09:00",end:"18:00"}:null)}/> 上班</label>{shift&&<div className="form-row"><label>上班<TimeSelect value={shift.start} onChange={start=>update(person.id,{...shift,start})}/></label><label>下班<TimeSelect value={shift.end} onChange={end=>update(person.id,{...shift,end})}/></label></div>}</fieldset>})}{error&&<p role="alert" className="login-error">{error}</p>}<button className="primary submit" disabled={!people.length}>儲存範本</button></form>;
}

function TimeSelect({value,onChange}:{value:string;onChange:(value:string)=>void}) { const [hour="00",minute="00"] = value.split(":"); const hours=Array.from({length:24},(_,i)=>String(i).padStart(2,"0")); const minuteOptions=Array.from({length:60},(_,i)=>String(i).padStart(2,"0")); return <div className="time-select"><select aria-label="小時" value={hour} onChange={e=>onChange(`${e.target.value}:${minute}`)}>{hours.map(h=><option key={h} value={h}>{h} 時</option>)}</select><span>：</span><select aria-label="分鐘" value={minute} onChange={e=>onChange(`${hour}:${e.target.value}`)}>{minuteOptions.map(m=><option key={m} value={m}>{m} 分</option>)}</select></div> }
