import type { ReportSortState } from "../../logic/Reports/ReportSorting";
import type { ReportData } from "../../logic/Reports/ReportsData";
import type {
  ReportDashboardPanelLayout,
  ResponderAttributionMode,
} from "../../logic/Reports/ReportsPresentation";
import type { WorkingHoursSchedule } from "../../logic/Reports/WorkingHours";

export interface ReportSessionSnapshot {
  report: ReportData | null;
  fromDate: string;
  toDate: string;
  activePreset: string | null;
  selectedMailAccountId: number | null;
  selectedMailFolderId: number | null;
  responseTargetMinutes: number | undefined;
  workingHours: WorkingHoursSchedule;
  categoryFilter: string[] | null;
  responderAttributionMode: ResponderAttributionMode;
  selectedResponderCategoryNames: string[];
  responseDaySort: ReportSortState<string> | null;
  responseDetailSort: ReportSortState<string> | null;
  outsideHoursSort: ReportSortState<string> | null;
  responderSort: ReportSortState<string> | null;
  topicSort: ReportSortState<string> | null;
  categorySort: ReportSortState<string> | null;
  accountSort: ReportSortState<string> | null;
  calendarSort: ReportSortState<string> | null;
  chatSort: ReportSortState<string> | null;
  fileSort: ReportSortState<string> | null;
  dashboardLayout: ReportDashboardPanelLayout[];
  dashboardLayoutMode: boolean;
  reportViewerOpen: boolean;
  reportViewerScrollTop: number;
}

let reportSession: ReportSessionSnapshot | null = null;

export function getReportSession(): ReportSessionSnapshot | null {
  return reportSession;
}

export function setReportSession(snapshot: ReportSessionSnapshot): void {
  reportSession = snapshot;
}
