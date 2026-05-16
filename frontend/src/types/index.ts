export type Role = "platform_admin" | "admin" | "user";
export type AnswerType = "FORMAT1" | "DATE" | "TEXT" | "MULTIPLE_CHOICE" | "RADIO_BUTTON";

export type User = {
  id: number;
  organizationId?: number | null;
  organizationName?: string | null;
  username: string;
  password?: string;
  name: string;
  role: Role;
  active?: boolean;
  approvalStatus?: "pending" | "approved" | "rejected";
  created_at?: string;
};

export type Organization = {
  id: number;
  name: string;
  plan: string;
  active: boolean;
  created_at: string;
  userCount: number;
  adminCount: number;
  inspectorCount: number;
  pendingUserCount: number;
  reportCount: number;
  admins: User[];
};

export type BillingCycle = "monthly" | "yearly";

export type BillingPlan = {
  id: number;
  code: string;
  name: string;
  description: string;
  monthlyPriceCents: number;
  yearlyPriceCents: number;
  userLimit: number;
  checklistLimit: number;
  reportRetentionDays: number;
  iyzicoMonthlyPricingPlanReferenceCode?: string | null;
  iyzicoYearlyPricingPlanReferenceCode?: string | null;
  active: boolean;
};

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled";

export type Subscription = {
  id: number;
  organizationId: number;
  organizationName: string;
  billingPlanId: number;
  planCode: string;
  planName: string;
  planDescription: string;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  amountCents: number;
  currency: string;
  paymentMethod: string;
  externalCustomerId?: string | null;
  externalSubscriptionId?: string | null;
  startedAt: string;
  renewsAt: string;
  canceledAt?: string | null;
  createdAt: string;
  userLimit: number;
  checklistLimit: number;
  reportRetentionDays: number;
};

export type BillingSummary = {
  plans: BillingPlan[];
  currentSubscription: Subscription | null;
  subscriptions: Subscription[];
  usage: {
    userCount: number;
    templateCount: number;
  } | null;
};

export type Session = {
  token: string;
  expiresAt: string;
  user: User;
};

export type ChecklistItem = {
  id: number;
  checklist_id: number;
  section_id: number;
  question: string;
  answerType?: AnswerType;
  answer_type?: AnswerType;
  options?: string[];
  options_json?: string;
  sort_order: number;
};

export type ChecklistSection = {
  id: number;
  checklist_id: number;
  title: string;
  sort_order: number;
  items: ChecklistItem[];
};

export type Checklist = {
  id: number;
  title: string;
  image_path?: string;
  imagePath?: string;
  created_at: string;
  sections: ChecklistSection[];
};

export type Assignment = {
  id: number;
  checklist_id: number;
  assigned_to_user_id: number;
  assigned_by_user_id: number;
  assigned_at: string;
  status: "assigned" | "completed";
  checklistTitle: string;
  checklistImagePath?: string;
  assignedToName: string;
  assignedByName: string;
};

export type Report = {
  id: number;
  assignment_id: number;
  checklistTitle: string;
  completedByName: string;
  assignedToName: string;
  assignedByName: string;
  completed_at: string;
  status: string;
  items: Array<{
    id: number;
    checklist_item_id: number;
    question: string;
    answer: string;
    answerType?: AnswerType;
    answer_type?: AnswerType;
    comment: string;
    sectionTitle?: string;
    photos: string[];
  }>;
  checklistImagePath?: string;
};


export type WalkthroughItem = {
  id?: number;
  comment: string;
  severity?: string;
  photos: string[];
};

export type WalkthroughSection = {
  id?: number;
  title: string;
  sort_order?: number;
  items: WalkthroughItem[];
};

export type Walkthrough = {
  id: number;
  organization_id: number;
  created_by_user_id: number;
  title: string;
  location?: string;
  status: "draft" | "completed";
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  createdByName?: string;
  organizationName?: string;
  sections: WalkthroughSection[];
};

export type AiActionPlan = {
  failedItemId: string;
  reportId: string;
  checklistTitle: string;
  sectionTitle: string;
  issue: string;
  failedAnswer: string;
  comment: string;
  rootCause: string;
  correctiveAction: string;
  preventiveAction: string;
  priority: "Critical" | "High" | "Medium" | "Low" | string;
  department: string;
  owner: string;
  departmentReason: string;
  estimatedDurationMinutes: number;
  confidence: "High" | "Medium" | "Low" | string;
  dueDate: string;
  status: "Open" | "In Progress" | "Blocked" | "Completed" | string;
  progress: number;
  followUpNotes: string;
};

export type AiActionPlanResponse = {
  provider: "azure-openai" | "openai" | "fallback" | "none";
  industry?: string;
  actionPlans: AiActionPlan[];
};

export type DraftChecklist = {
  assignmentId: number;
  userId: number;
  form: Record<
    number,
    {
      itemId: number;
      sectionTitle?: string;
      question: string;
      answerType?: AnswerType;
      answer: string;
      comment: string;
      photos: string[];
    }
  >;
  updatedAt: string;
};
