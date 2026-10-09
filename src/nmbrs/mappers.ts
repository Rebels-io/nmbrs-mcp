import type {
  CodeEntry,
  Contract,
  Employment,
  EmployeeRow,
  ManagerEntry,
  Period,
  Salary,
  Schedule,
} from "./endpoints.js";

export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined || value === "") continue;
    out[key] = value;
  }
  return out as Partial<T>;
}

export const day = (value?: string | null): string | undefined => (value ? value.slice(0, 10) : undefined);

export const today = (): string => new Date().toISOString().slice(0, 10);

export function employeeName(info: EmployeeRow["employeeBasicInfo"]): string {
  const first = info.firstName || info.initials || "";
  return [first, info.prefix, info.lastName].filter(Boolean).join(" ");
}

export const isActive = (row: EmployeeRow): boolean => row.employeeBasicInfo.employeeType === "payroll";

function comparePeriod(a: { period?: Period; createdAt?: string }, b: { period?: Period; createdAt?: string }): number {
  return (
    (a.period?.year ?? 0) - (b.period?.year ?? 0) ||
    (a.period?.period ?? 0) - (b.period?.period ?? 0) ||
    (a.createdAt ?? "").localeCompare(b.createdAt ?? "")
  );
}

export function latestByPeriod<T extends { period?: Period; createdAt?: string }>(items: T[] = []): T | undefined {
  return items.reduce<T | undefined>((best, item) => (!best || comparePeriod(item, best) > 0 ? item : best), undefined);
}

export function currentByStartDate<T extends { startDate?: string | null; createdAt?: string }>(
  items: T[] = []
): T | undefined {
  const now = today();
  const started = items.filter((item) => (day(item.startDate) ?? "") <= now);
  return started.reduce<T | undefined>((best, item) => {
    if (!best) return item;
    const a = day(item.startDate) ?? "";
    const b = day(best.startDate) ?? "";
    return a > b || (a === b && (item.createdAt ?? "") > (best.createdAt ?? "")) ? item : best;
  }, undefined);
}

export const codeLabel = (entry?: CodeEntry): string | undefined => entry?.description;

export function managerName(entry?: ManagerEntry): string | undefined {
  return entry ? [entry.firstName, entry.lastName].filter(Boolean).join(" ") || undefined : undefined;
}

export function mapSalary(salary: Salary) {
  return compact({ effectiveDate: day(salary.startDate), amount: salary.value, type: salary.type });
}

export function mapContract(contract?: Contract) {
  if (!contract) return {};
  return compact({
    contractStart: day(contract.startDate),
    contractEnd: day(contract.endDate),
    indefiniteContract: contract.indefinite ?? undefined,
    contractHoursPerWeek: contract.hoursPerWeek ?? undefined,
  });
}

export function mapEmployment(employment?: Employment) {
  if (!employment) return {};
  return compact({
    employmentStart: day(employment.startDate),
    employmentEnd: day(employment.endDate),
    seniorityDate: day(employment.seniorityDate),
  });
}

export function mapSchedule(schedule?: Schedule) {
  if (!schedule) return undefined;
  return compact({
    since: day(schedule.startDate),
    hoursPerWeek: schedule.hoursPerWeek,
    daysPerWeek: schedule.daysPerWeek,
    parttimePercentage: schedule.parttimePercentage,
  });
}

export function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
