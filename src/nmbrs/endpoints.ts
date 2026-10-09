import { nmbrsFetchAll, nmbrsPage } from "./client.js";
import { mapLimit, ttlCache } from "./util.js";

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
  employeeId?: string
): Promise<Map<string, T[]>> {
  const rows = await nmbrsFetchAll<Record<string, unknown>>(`/api/companies/${companyId}/employees/${resource}`, {
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
  const known = employeeCompany.get(employeeId);
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
  employeeCompany.set(employeeId, found);
  return found;
}

export interface CompanySnapshot {
  employees: EmployeeRow[];
  functions: Map<string, CodeEntry[]>;
  departments: Map<string, CodeEntry[]>;
}

const snapshots = ttlCache<CompanySnapshot>(5 * 60_000);

export const getCompanySnapshot = (companyId: string) =>
  snapshots(companyId, async () => {
    const [employees, functions, departments] = await Promise.all([
      listEmployees(companyId),
      companyHistory<CodeEntry>(companyId, "functions", "functions").catch(() => new Map<string, CodeEntry[]>()),
      companyHistory<CodeEntry>(companyId, "departments", "departments").catch(() => new Map<string, CodeEntry[]>()),
    ]);
    for (const row of employees) employeeCompany.set(row.employeeId, companyId);
    return { employees, functions, departments };
  });
