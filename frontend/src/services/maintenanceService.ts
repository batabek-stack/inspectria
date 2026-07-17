import { apiDelete, apiGet, apiPost } from "./api";

export type MaintenanceBackup = {
  id: string;
  reason: "manual" | "pre-restore" | string;
  status: "running" | "completed" | "failed" | "unreadable" | string;
  createdAt: string;
  completedAt?: string;
  createdByUsername?: string;
  bytes: number;
  dbBytes: number;
  uploadBytes: number;
  tableCounts?: Record<string, number>;
  error?: string;
};

export type MaintenanceBackupList = {
  retentionDays: number;
  activeJob: string | null;
  backups: MaintenanceBackup[];
};

export async function getMaintenanceBackups() {
  return apiGet<MaintenanceBackupList>("/maintenance/backups");
}

export async function createMaintenanceBackup() {
  return apiPost<MaintenanceBackupList & { success: boolean; backup: MaintenanceBackup }>(
    "/maintenance/backups",
    {}
  );
}

export async function restoreMaintenanceBackup(id: string) {
  return apiPost<
    MaintenanceBackupList & {
      success: boolean;
      restoredBackup: MaintenanceBackup;
      safetyBackup: MaintenanceBackup;
    }
  >(`/maintenance/backups/${encodeURIComponent(id)}/restore`, {});
}

export async function deleteMaintenanceBackup(id: string) {
  return apiDelete<MaintenanceBackupList & { success: boolean }>(
    `/maintenance/backups/${encodeURIComponent(id)}`
  );
}
