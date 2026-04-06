"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { SidebarMenuButton } from "@/components/ui/sidebar";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <SidebarMenuButton
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      tooltip="Toggle theme"
    >
      <Sun className="dark:hidden" />
      <Moon className="hidden dark:block" />
      <span>Toggle Theme</span>
    </SidebarMenuButton>
  );
}
