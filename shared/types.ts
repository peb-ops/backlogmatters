export type Role = 'admin' | 'manager' | 'viewer';
export type Access = 'owner' | 'editor' | 'viewer';
export type MemberRole = 'editor' | 'viewer';
export type ItemType = 'story' | 'task' | 'bug';
export type ItemStatus = 'new' | 'ready' | 'in_progress' | 'done';
export type ReleaseStatus = 'planned' | 'active' | 'done';
/** MoSCoW category: must have, should have, could have, won't have (this time). */
export type Moscow = 'must' | 'should' | 'could' | 'wont';
export type Urgency = 'wait' | 'soon' | 'now';
export type IssueKind =
  | 'no_moscow'
  | 'unestimated'
  | 'missing_ac'
  | 'no_epic'
  | 'stale'
  | 'overdue'
  | 'must_unscheduled'
  | 'duplicate'
  | 'dep_order'
  | 'dep_release';

export interface User {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  disabled: boolean;
  createdAt: string;
}

export interface UserSummary {
  id: number;
  username: string;
  displayName: string;
}

export interface AuthState {
  /** Feature flag: whether sign-in, user management and the administration page are switched on. */
  accounts: boolean;
  needsSetup: boolean;
  user: User | null;
}

export interface Project {
  id: number;
  key: string;
  name: string;
  description: string;
  ownerId: number;
  ownerName: string;
  archived: boolean;
  createdAt: string;
  access: Access;
  itemCount: number;
  openCount: number;
}

export interface Member extends UserSummary {
  role: MemberRole;
}

export interface Epic {
  id: number;
  projectId: number;
  title: string;
  description: string;
  color: string;
  done: boolean;
}

export interface Release {
  id: number;
  projectId: number;
  name: string;
  startDate: string | null;
  endDate: string | null;
  capacity: number | null;
  status: ReleaseStatus;
}

export interface Item {
  id: number;
  projectId: number;
  number: number;
  epicId: number | null;
  releaseId: number | null;
  type: ItemType;
  title: string;
  description: string;
  acceptanceCriteria: string;
  status: ItemStatus;
  moscow: Moscow | null;
  /** Urgency chosen by hand. The due date can raise it; see effectiveUrgency. */
  urgency: Urgency | null;
  dueDate: string | null;
  /** Points. Chosen in the app as a T-shirt size; see SIZES. */
  effort: number | null;
  rank: number;
  createdAt: string;
  updatedAt: string;
}

export interface Dependency {
  blockerId: number;
  blockedId: number;
}

export interface Issue {
  itemId: number;
  kind: IssueKind;
  detail: string;
}

export interface Board {
  project: Project;
  epics: Epic[];
  releases: Release[];
  items: Item[];
  dependencies: Dependency[];
  members: Member[];
  issues: Issue[];
}

export interface ImportResult {
  items: number;
  epics: number;
  releases: number;
  dependencies: number;
  skipped: number;
}
