import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BookOpen,
  Bot,
  LayoutDashboard,
  Layers,
  MessageSquare,
  MessagesSquare,
  Radio,
  Settings,
  Share2,
  Sparkles,
  Workflow,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** If true, only users with admin role see this item */
  adminOnly?: boolean;
};

export type NavSection = {
  id: string;
  label: string;
  items: NavItem[];
};

const COMMAND: NavItem[] = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/live", label: "Live events", icon: Radio },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
];

const BUILD: NavItem[] = [
  { href: "/platform", label: "Agent builder", icon: Layers },
  { href: "/platform/agents", label: "Agent studio", icon: Bot },
];

const OMNICHANNEL: NavItem[] = [
  { href: "/channels", label: "Channels", icon: Share2 },
  { href: "/conversations", label: "Conversations", icon: MessagesSquare },
];

const AI_AUTOMATION: NavItem[] = [
  { href: "/assistant", label: "AI copilot", icon: Sparkles },
  { href: "/workflows", label: "Workflows", icon: Workflow },
  { href: "/knowledge", label: "Knowledge base", icon: BookOpen },
];

const SANDBOX: NavItem[] = [{ href: "/demo", label: "Client chat simulator", icon: MessageSquare }];

const ADMINISTRATION: NavItem[] = [{ href: "/settings", label: "Settings", icon: Settings }];

function filterItems(items: NavItem[], isAdmin: boolean): NavItem[] {
  return items.filter((i) => !i.adminOnly || isAdmin);
}

/** Bank / frontline staff: governed chat only (no full admin console). */
const AGENT_STAFF_SECTIONS: NavSection[] = [
  {
    id: "assistants",
    label: "Assistants",
    items: [{ href: "/assistant", label: "Chat with assistants", icon: MessageSquare }],
  },
];

/**
 * Sidebar sections for the dashboard. Sandbox section is omitted when demo nav is hidden.
 * Non-admin users (e.g. bank employees) see chat + voice only.
 */
export function getDashboardNavSections(options: { showDemoNav: boolean; isAdmin: boolean }): NavSection[] {
  const { showDemoNav, isAdmin } = options;
  if (!isAdmin) {
    return AGENT_STAFF_SECTIONS;
  }

  const sections: NavSection[] = [
    { id: "command", label: "Command center", items: filterItems(COMMAND, isAdmin) },
    { id: "build", label: "Build", items: filterItems(BUILD, isAdmin) },
    { id: "omnichannel", label: "Omnichannel", items: filterItems(OMNICHANNEL, isAdmin) },
    { id: "ai", label: "AI & automation", items: filterItems(AI_AUTOMATION, isAdmin) },
  ];

  if (showDemoNav) {
    sections.push({ id: "sandbox", label: "Sandbox", items: SANDBOX });
  }

  sections.push({ id: "admin", label: "Administration", items: filterItems(ADMINISTRATION, isAdmin) });

  return sections;
}

/** Deployment label for chrome (set NEXT_PUBLIC_APP_ENV=production|sandbox). */
export function getDeploymentLabel(): string {
  const env = process.env.NEXT_PUBLIC_APP_ENV?.trim().toLowerCase();
  if (env === "production" || env === "prod") return "Production";
  if (env === "sandbox" || env === "staging" || env === "uat") return "Sandbox";
  if (process.env.NODE_ENV === "production") return "Production";
  return "Development";
}

export function shouldShowDemoNav(): boolean {
  return process.env.NEXT_PUBLIC_HIDE_DEMO_NAV !== "true";
}
