export type TemplateShift = { personId: number; day: number; start: string; end: string };
export type ScheduleTemplate = { name: string; shifts: TemplateShift[] };
type Shift = { id: number; personId: number; date: string; start: string; end: string };
const min = (time: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) : NaN;
type Attendance = { personId: number; date: string; clockIn: string; clockOut: string; breakMin?: number; type: string; excessApproval?: string };
export const EXCESS_PAY_THRESHOLD_MINUTES = 30;
export const EXCESS_PAY_BLOCK_MINUTES = 30;
export const LATE_MAKEUP_LIMIT_MINUTES = 10;
const time = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2,"0")}:${String(minutes % 60).padStart(2,"0")}`;
export function roundedExcessMinutes(minutes: number) {
  if (!Number.isFinite(minutes) || minutes < EXCESS_PAY_THRESHOLD_MINUTES) return 0;
  return Math.floor(minutes / EXCESS_PAY_BLOCK_MINUTES) * EXCESS_PAY_BLOCK_MINUTES;
}
export function approvalKey(row: Attendance, schedule?: { start: string; end: string }) {
  return excessTime(row, schedule) ? JSON.stringify([row.personId,row.date,row.clockIn,row.clockOut,schedule?.start,schedule?.end]) : "";
}
export function excessApproved(row: Attendance, schedule?: { start: string; end: string }) {
  const key = approvalKey(row, schedule);
  return !!key && row.excessApproval === key;
}
export function actualMinutes(row: Attendance) {
  if (row.type !== "正常") return 0;
  const clockIn=min(row.clockIn),clockOut=min(row.clockOut),breakMin=Math.max(0,Number(row.breakMin)||0);
  if (![clockIn,clockOut].every(Number.isFinite) || clockOut < clockIn) return 0;
  return Math.max(0,clockOut-clockIn-breakMin);
}
export function payableMinutes(row: Attendance, schedule?: { start: string; end: string }) {
  if (!schedule || row.type !== "正常") return 0;
  const values = [min(row.clockIn),min(row.clockOut),min(schedule.start),min(schedule.end)];
  if (!values.every(Number.isFinite) || values[1] < values[0]) return 0;
  const late = Math.max(0, values[0] - values[2]);
  const madeUpLate = late > 0 && late <= LATE_MAKEUP_LIMIT_MINUTES && values[1] >= values[3] + late;
  const regular = madeUpLate
    ? Math.max(0, values[3] - values[2])
    : Math.max(0,Math.min(values[1],values[3])-Math.max(values[0],values[2]));
  const payableRegular = Math.floor(regular / EXCESS_PAY_BLOCK_MINUTES) * EXCESS_PAY_BLOCK_MINUTES;
  const extra = excessTime(row,schedule);
  const payableExtra = extra && excessApproved(row,schedule) ? roundedExcessMinutes(extra.minutes) : 0;
  return payableRegular + payableExtra;
}

export function payableExcessMinutes(row: Attendance, schedule?: { start: string; end: string }) {
  const extra = excessTime(row,schedule);
  return extra && excessApproved(row,schedule) ? roundedExcessMinutes(extra.minutes) : 0;
}

export function excessTime(row: { clockIn: string; clockOut: string; type: string }, schedule?: { start: string; end: string }) {
  if (!schedule || row.type !== "正常") return null;
  const clockIn = min(row.clockIn), clockOut = min(row.clockOut), scheduledStart = min(schedule.start), scheduledEnd = min(schedule.end);
  if (![clockIn, clockOut, scheduledStart, scheduledEnd].every(Number.isFinite) || clockOut < clockIn) return null;
  const late = Math.max(0, clockIn - scheduledStart);
  const madeUpLate = late > 0 && late <= LATE_MAKEUP_LIMIT_MINUTES && clockOut >= scheduledEnd + late;
  const overtimeStart = madeUpLate ? scheduledEnd + late : scheduledEnd;
  const start = Math.max(clockIn, overtimeStart);
  if (clockOut <= start) return null;
  return { start: start === clockIn ? row.clockIn : time(overtimeStart), end: row.clockOut, minutes: clockOut - start };
}

export function applyWeeklyTemplate(schedules: Shift[], template: ScheduleTemplate, dates: string[], personIds: number[], protectedKeys: string[] = []) {
  const protectedSet = new Set(protectedKeys);
  const editable = (personId: number, date: string) => personIds.includes(personId) && dates.includes(date) && !protectedSet.has(`${personId}:${date}`);
  const retained = schedules.filter(s => !editable(s.personId, s.date));
  let id = Math.max(Date.now(), ...schedules.map(s => s.id));
  const added = template.shifts.filter(s => dates[s.day] && editable(s.personId, dates[s.day])).map(s => ({ id: ++id, personId: s.personId, date: dates[s.day], start: s.start, end: s.end }));
  return [...retained, ...added];
}

export function csvText(lines: (string | number)[][]) {
  return "\ufeff" + lines.map(row => row.map(value => {
    const text = String(value);
    const safe = /^[=+@\-\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(",")).join("\r\n");
}

export function downloadCsv(lines: (string | number)[][], filename: string) {
  const url = URL.createObjectURL(new Blob([csvText(lines)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// 計薪規則：遲到超過 10 分鐘仍保留所有完成的半小時一般工時。
