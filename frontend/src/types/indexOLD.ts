export type Role = "admin" | "user";

export type User = {
  id: number;
  username: string;
  name: string;
  role: Role;
  active?: number | boolean;
};

export type Session = {
  token: string;
  user: User;
  expiresAt: string;
};

export type Checklist = {
  id: number;
  title: string;
  created_at: string;
  items: Array<{
    id: number;
    checklist_id: number;
    question: string;
    sort_order: number;
  }>;
};

export type Assignment = {
  id: number;
  checklist_id: number;
  assigned_to_user_id: number;
  assigned_by_user_id: number;
  assigned_at: string;
  status: "assigned" | "completed";
  checklistTitle: string;
  assignedToName: string;
  assignedByName: string;
};

export type FillItem = {
  itemId: number;
  question: string;
  answer: "YES" | "NO" | "N/A" | "";
  comment: string;
  photos: string[];
};

export type Report = {
  id: number;
  assignment_id: number;
  completed_by_user_id: number;
  completed_at: string;
  status: string;
  checklistTitle: string;
  completedByName: string;
  assignedToName: string;
  assignedByName: string;
  items: Array<{
    id: number;
    checklist_item_id: number;
    question: string;
    answer: string;
    comment: string;
    photos: string[];
  }>;
};
