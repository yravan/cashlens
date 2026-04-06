import {
  LayoutDashboard,
  ArrowLeftRight,
  CheckCircle,
  Camera,
  CalendarHeart,
  BarChart3,
  MessageSquare,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  badge?: number;
};

export const navItems: NavItem[] = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Transactions", url: "/transactions", icon: ArrowLeftRight },
  { title: "Review", url: "/review", icon: CheckCircle },
  { title: "Scanner", url: "/scanner", icon: Camera },
  { title: "Events", url: "/events", icon: CalendarHeart },
  { title: "Reports", url: "/reports", icon: BarChart3 },
  { title: "Chat", url: "/chat", icon: MessageSquare },
  { title: "Settings", url: "/settings", icon: Settings },
];
