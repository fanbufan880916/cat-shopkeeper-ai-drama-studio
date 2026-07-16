export type WorkbenchUpdateState =
  | "current"
  | "available"
  | "dirty"
  | "ahead"
  | "diverged"
  | "unavailable";

export type WorkbenchUpdateStatus = {
  version: string;
  state: WorkbenchUpdateState;
  branch: string;
  upstream: string;
  repositoryUrl: string;
  localCommit: string;
  remoteCommit: string;
  ahead: number;
  behind: number;
  dirty: boolean;
  updateAvailable: boolean;
  canUpdate: boolean;
  message: string;
  checkedAt: string;
  dependenciesInstalled?: boolean;
  buildCompleted?: boolean;
  restartRequired?: boolean;
};
