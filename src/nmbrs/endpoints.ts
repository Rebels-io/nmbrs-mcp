import { currentUserKey } from "../auth/requestContext.js";
import { nmbrsFetch, nmbrsFetchAll, nmbrsFetchText, nmbrsPage, type Query } from "./client.js";
import { mapLimit, sleep, ttlCache } from "./util.js";

export interface Period {
  year?: number;
  period?: number;
}

export interface Company {
  companyId: string;
  number?: string;
  name: string;
  debtorId?: string;
}

export interface EmployeeRow {
  employeeId: string;
  employeeBasicInfo: {
    employeeNumber?: number;
    firstName?: string | null;
    prefix?: string | null;
    initials?: string | null;
    lastName: string;
    employeeType?: string;
  };
}

export interface Employment {
  startDate?: string | null;
  endDate?: string | null;
  seniorityDate?: string | null;
  changedDate?: string;
}

export interface Contract {
  startDate?: string | null;
  endDate?: string | null;
  indefinite?: boolean | null;
  hoursPerWeek?: number | null;
  createdAt?: string;
}

export interface Salary {
  startDate: string;
  type?: string;
  value: number;
  createdAt?: string;
}

export interface Schedule {
  startDate: string;
  parttimePercentage?: number;
  hoursPerWeek?: number;
  daysPerWeek?: number;
  createdAt?: string;
}

export interface CodeEntry {
  code?: number;
  description?: string;
  createdAt?: string;
  period?: Period;
}

export interface ManagerEntry {
  firstName?: string | null;
  lastName?: string | null;
  createdAt?: string;
  period?: Period;
}

export interface CostCenterEntry {
  costCenters?: { code?: string; description?: string };
  percentage?: number;
  period?: Period;
  createdAt?: string;
}

export interface LeaveBalance {
  leaveGroupId: string;
  leaveBalance: number;
}

export interface LeaveGroup {
  leaveGroupId: string;
  group?: string;
  description?: string;
}

export interface LeaveRequest {
  leaveGroupId: string;
  status?: string;
  type?: string;
  startDate?: string;
  endDate?: string;
  hours?: number;
}

export interface AbsenceRegistration {
  percentage?: number;
  startDate?: string | null;
  registrationStartDate?: string | null;
  endDate?: string | null;
  registrationEndDate?: string | null;
}

export interface AbsenceDossier {
  absenceDossierType?: string;
  absenceCause?: string;
  employeeAbsences?: AbsenceRegistration[];
}

export interface PayrollRun {
  payrollRunId: string;
  number?: number;
  description?: string;
  year?: number;
  createdAt?: string;
  type?: string;
  locked?: boolean;
}

export const listCompanies = () => nmbrsFetchAll<Company>("/api/companies");

export async function countEmployees(companyId: string, employeeType?: string): Promise<number | undefined> {
  const page = await nmbrsPage<unknown>(`/api/companies/${companyId}/employees`, { employeeType, pageSize: 1 });
  return page.pagination?.totalRecords;
}

export const listEmployees = (companyId: string, filter: { employeeId?: string; employeeType?: string } = {}) =>
  nmbrsFetchAll<EmployeeRow>(`/api/companies/${companyId}/employees`, filter);

export async function companyHistory<T>(
  companyId: string,
  resource: string,
  key: string,
  employeeId?: string,
  extra: Query = {}
): Promise<Map<string, T[]>> {
  const rows = await nmbrsFetchAll<Record<string, unknown>>(`/api/companies/${companyId}/employees/${resource}`, {
    ...extra,
    employeeId,
  });
  const byEmployee = new Map<string, T[]>();
  for (const row of rows) {
    const id = String(row.employeeId);
    const entries = (row[key] as T[] | undefined) ?? [];
    byEmployee.set(id, [...(byEmployee.get(id) ?? []), ...entries]);
  }
  return byEmployee;
}

export const listLeaveBalances = (companyId: string, employeeId: string) =>
  companyHistory<LeaveBalance>(companyId, "leaveBalances", "leaveBalances", employeeId);

export const listLeaveRequests = (companyId: string, filter: { employeeId?: string; status?: string; year?: number }) =>
  companyHistory<LeaveRequest>(companyId, "leaverequests", "EmployeeLeaveRequests", filter.employeeId, {
    status: filter.status,
    year: filter.year,
  });

export const listAbsenceDossiers = (companyId: string, employeeId?: string) =>
  companyHistory<AbsenceDossier>(companyId, "absences", "employeeAbsenceDossiers", employeeId);

export interface VariableWageComponent {
  variableWageComponentId?: string;
  code?: number;
  value?: number;
  comment?: string | null;
}

export async function listVariableWageComponents(
  companyId: string,
  query: { employeeId?: string; year?: number; period?: number }
): Promise<Map<string, VariableWageComponent[]>> {
  const rows = await nmbrsFetchAll<Record<string, unknown>>(
    `/api/companies/${companyId}/employees/variablewagecomponents`,
    query
  );
  const byEmployee = new Map<string, VariableWageComponent[]>();
  for (const row of rows) {
    const id = String(row.employeeId);
    const entries = (row.variablewagecomponents ?? row.variableWageComponents ?? []) as VariableWageComponent[];
    byEmployee.set(id, [...(byEmployee.get(id) ?? []), ...entries]);
  }
  return byEmployee;
}

export const listLeaveGroups = (companyId: string) =>
  nmbrsFetchAll<LeaveGroup>(`/api/companies/${companyId}/leaveGroups`);

export const listPayrollRuns = (companyId: string, year: number) =>
  nmbrsFetchAll<PayrollRun>(`/api/companies/${companyId}/runs`, { year });

export async function countEmployeesInRun(companyId: string, runId: string): Promise<number | undefined> {
  const page = await nmbrsPage<unknown>(`/api/companies/${companyId}/runs/${runId}/employees`, { pageSize: 1 });
  return page.pagination?.totalRecords;
}

const employeeCompany = new Map<string, string>();

export async function findCompanyOfEmployee(employeeId: string, companyId?: string): Promise<string> {
  if (companyId) return companyId;
  const cacheKey = `${currentUserKey()}:${employeeId}`;
  const known = employeeCompany.get(cacheKey);
  if (known) return known;

  const companies = await listCompanies();
  const hits = await mapLimit(companies, 4, async (company) => {
    const page = await nmbrsPage<EmployeeRow>(`/api/companies/${company.companyId}/employees`, {
      employeeId,
      pageSize: 1,
    });
    return (page.data ?? []).length > 0 ? company.companyId : undefined;
  });
  const found = hits.find((id) => id !== undefined);
  if (!found) {
    throw new Error(
      `Medewerker ${employeeId} is niet gevonden in de bedrijven van deze debtor. Zoek de juiste id met nmbrs_search_employees.`
    );
  }
  employeeCompany.set(cacheKey, found);
  return found;
}

export interface CompanySnapshot {
  employees: EmployeeRow[];
  functions: Map<string, CodeEntry[]>;
  departments: Map<string, CodeEntry[]>;
}

const snapshots = ttlCache<CompanySnapshot>(5 * 60_000);

export const getCompanySnapshot = (companyId: string) => {
  const userKey = currentUserKey();
  return snapshots(`${userKey}:${companyId}`, async () => {
    const [employees, functions, departments] = await Promise.all([
      listEmployees(companyId),
      companyHistory<CodeEntry>(companyId, "functions", "functions").catch(() => new Map<string, CodeEntry[]>()),
      companyHistory<CodeEntry>(companyId, "departments", "departments").catch(() => new Map<string, CodeEntry[]>()),
    ]);
    for (const row of employees) employeeCompany.set(`${userKey}:${row.employeeId}`, companyId);
    return { employees, functions, departments };
  });
};

export interface WorkflowCodeLabel {
  code?: number;
  label?: string;
}

export interface WorkflowTrack {
  name: string;
  status: string;
  actions: Array<{ action: WorkflowCodeLabel; status: WorkflowCodeLabel; runAt?: string | null }>;
}

export interface WorkflowYear {
  year: number;
  periods: Array<{ period: number; tracks: WorkflowTrack[] }>;
}

export interface CurrentPeriod {
  period?: Period;
  periodType?: string;
  displayPeriod?: string;
}

export async function getCurrentPeriod(companyId: string): Promise<CurrentPeriod | undefined> {
  const rows = await nmbrsFetchAll<CurrentPeriod>(`/api/companies/${companyId}/period`);
  return rows[0];
}

export const getPayrollWorkflow = (companyId: string, query: Query) =>
  nmbrsFetchAll<WorkflowYear>(`/api/companies/${companyId}/payrollworkflow`, query);

export const listCostPerHour = (companyId: string, query: Query) =>
  nmbrsFetchAll<{ employeeId: string; costPerHour?: string | null }>(
    `/api/companies/${companyId}/employees/costperhour`,
    query
  );

export const JOURNAL_KINDS = {
  total: "journals",
  department: "journalsdepartment",
  employee: "journalsemployee",
  costcenter: "journalscostcenter",
  costunit: "journalscostcenterunit",
} as const;

export type JournalKind = keyof typeof JOURNAL_KINDS;

export async function fetchJournalXml(companyId: string, runId: string, year: number, kind: JournalKind): Promise<string> {
  const task = await nmbrsFetch<{ taskId: string }>(
    `/api/companies/${companyId}/runs/${runId}/${JOURNAL_KINDS[kind]}?year=${year}`
  );
  for (let attempt = 0; attempt < 10; attempt++) {
    const result = await nmbrsFetchText(`/api/documents/${task.taskId}`);
    if (result.status === 200) return result.body;
    await sleep(1500);
  }
  throw new Error("Nmbrs is het journaal nog aan het genereren. Probeer het over een minuut opnieuw.");
}

export interface UserInfo {
  name?: string;
  email?: string;
  debtorId?: string;
}

export interface Debtor {
  debtorId: string;
  number?: string;
  name: string;
}

export const getUserInfo = () => nmbrsFetchAll<UserInfo>("/api/user/info");
export const listDebtors = () => nmbrsFetchAll<Debtor>("/api/debtors");

const cachedCompanies = ttlCache<Company[]>(5 * 60_000);

export const listCompaniesCached = () => cachedCompanies(currentUserKey(), () => listCompanies());

export async function getCompanyName(companyId: string): Promise<string | undefined> {
  return (await listCompaniesCached()).find((company) => company.companyId === companyId)?.name;
}
