export type ImportPerson = { id: number; name: string };
export type ParsedSchedule = { personId: number; personName: string; date: string; start: string; end: string; source: string };
export type ImportIssue = { line: string; reason: string };

const fixedAliases: Record<string, { name: string; start?: string; end?: string }> = {
  "泓哥": { name: "張正泓", start: "04:00", end: "13:00" },
  "穎舒": { name: "穎舒", start: "15:30", end: "22:00" },
  "俊嘉": { name: "俊嘉", start: "15:30", end: "22:00" },
  "翰": { name: "宗翰" },
  "峰": { name: "洪峰" },
};

const cleanName = (value: string) => value
  .replace(/[（(].*?[）)]/g, "")
  .replace(/^[\s\-—–•・●○]+/, "")
  .replace(/店長/g, "")
  .replace(/\s+/g, "")
  .trim();

function findPerson(rawName: string, people: ImportPerson[]) {
  const cleaned = cleanName(rawName);
  const alias = fixedAliases[cleaned];
  const target = alias?.name || cleaned;
  const normalized = target.replace(/\s+/g, "");
  const direct = people.find(person => person.name.replace(/\s+/g, "") === normalized);
  if (direct) return { person: direct, defaults: alias };
  const suffix = people.filter(person => {
    const name = person.name.replace(/\s+/g, "");
    return name.endsWith(normalized) || normalized.endsWith(name) || (normalized.length >= 2 && name.includes(normalized));
  });
  if (suffix.length === 1) return { person: suffix[0], defaults: alias };
  if (normalized.length === 1) {
    const lastNameMatch = people.filter(person => person.name.replace(/\s+/g, "").endsWith(normalized));
    if (lastNameMatch.length === 1) return { person: lastNameMatch[0], defaults: alias };
  }
  return { person: undefined, defaults: alias };
}

function formatTime(hour: string, colonMinute?: string, compactMinute?: string) {
  const h = Number(hour);
  const m = Number(colonMinute ?? compactMinute ?? "0");
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function parseScheduleText(text: string, people: ImportPerson[], defaultYear: number) {
  const schedules: ParsedSchedule[] = [];
  const issues: ImportIssue[] = [];
  let activeDate = "";
  const lines = text.replace(/\r/g, "").split("\n").map(line => line.trim()).filter(Boolean);
  for (const original of lines) {
    const dateMatch = original.match(/^(?:(\d{4})\s*[\/.-]\s*)?(\d{1,2})\s*[\/.-]\s*(\d{1,2})/);
    if (dateMatch) {
      const year = Number(dateMatch[1] || defaultYear);
      const month = Number(dateMatch[2]);
      const date = Number(dateMatch[3]);
      const candidate = new Date(year, month - 1, date, 12);
      if (candidate.getFullYear() === year && candidate.getMonth() === month - 1 && candidate.getDate() === date) {
        activeDate = `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
      } else {
        activeDate = "";
        issues.push({ line: original, reason: "日期格式不正確" });
      }
      continue;
    }
    if (/^(早午班|晚班|早班|午班|備註|提醒)[：:]?$/.test(original)) continue;
    if (!activeDate) { issues.push({ line: original, reason: "前面沒有日期" }); continue; }
    const timeMatch = original.match(/(\d{1,2})(?:\s*[:：]\s*(\d{1,2})|(\d{2}))?\s*[-–—~～至]\s*(\d{1,2})(?:\s*[:：]\s*(\d{1,2})|(\d{2}))?/);
    const namePart = timeMatch ? original.slice(0, timeMatch.index).trim() : original.replace(/[（(].*?[）)]/g, "").trim();
    const { person, defaults } = findPerson(namePart, people);
    if (!person) { issues.push({ line: original, reason: `找不到人員「${cleanName(namePart)}」` }); continue; }
    let start = defaults?.start;
    let end = defaults?.end;
    if (timeMatch) {
      start = formatTime(timeMatch[1], timeMatch[2], timeMatch[3]) || undefined;
      end = formatTime(timeMatch[4], timeMatch[5], timeMatch[6]) || undefined;
    }
    if (!start || !end) { issues.push({ line: original, reason: `${person.name} 沒有上、下班時間` }); continue; }
    if (start >= end) { issues.push({ line: original, reason: `${person.name} 的下班時間必須晚於上班時間` }); continue; }
    schedules.push({ personId: person.id, personName: person.name, date: activeDate, start, end, source: original });
  }
  const unique = new Map<string, ParsedSchedule>();
  schedules.forEach(item => unique.set(`${item.personId}:${item.date}`, item));
  return { schedules: [...unique.values()], issues };
}

export function missingScheduleDates(schedules: Array<{ date: string }>, year: number, month: number) {
  const scheduled = new Set(schedules.map(item => item.date));
  const lastDate = new Date(year, month, 0).getDate();
  const missing: string[] = [];
  for (let date = 1; date <= lastDate; date += 1) {
    const current = new Date(year, month - 1, date, 12);
    if (current.getDay() === 6) continue;
    const value = `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
    if (!scheduled.has(value)) missing.push(value);
  }
  return missing;
}

