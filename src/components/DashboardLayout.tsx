import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard, FlaskConical, Activity, Settings, MessageSquare,
  Menu, X, LogOut, ChevronLeft,
} from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Overview" },
  { to: "/tester", icon: FlaskConical, label: "Tool Tester" },
  { to: "/monitor", icon: Activity, label: "Monitor" },
  { to: "/settings", icon: Settings, label: "Settings" },
  { to: "/chat", icon: MessageSquare, label: "AI Chat" },
];

interface DashboardLayoutProps {
  children: React.ReactNode;
  serverOnline?: boolean;
}

export function DashboardLayout({ children, serverOnline }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuthStore();
  const location = useLocation();

  const currentPage = navItems.find((n) => n.to === location.pathname)?.label ?? "Dashboard";
  const avatarUrl = user?.user_metadata?.avatar_url;
  const username = user?.user_metadata?.user_name ?? user?.email?.split("@")[0] ?? "User";

  return (
    <div className="flex min-h-screen bg-background dot-grid">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-border bg-sidebar transition-transform lg:static lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-display text-sm font-bold tracking-wider text-gradient-cyber">FIRECRAWL MCP</h2>
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)} className="h-7 w-7 lg:hidden">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary border-l-2 border-primary"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border-l-2 border-transparent"
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* User section */}
        <div className="border-t border-border p-4">
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8">
              <AvatarImage src={avatarUrl} />
              <AvatarFallback className="bg-muted text-xs font-mono">{username[0]?.toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{username}</p>
              <p className="text-[10px] text-muted-foreground truncate">GitHub</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => supabase.auth.signOut()}
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/80 backdrop-blur-lg px-4 py-3 lg:px-6">
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)} className="h-8 w-8 lg:hidden">
            <Menu className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ChevronLeft className="h-3 w-3" />
            <span className="font-mono text-xs">{currentPage}</span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <StatusBadge
              status={serverOnline === undefined ? "pending" : serverOnline ? "online" : "offline"}
              label={serverOnline === undefined ? "CHECKING" : serverOnline ? "ONLINE" : "OFFLINE"}
              pulse={serverOnline === true}
            />
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-4 lg:p-6 scrollbar-cyber">
          {children}
        </main>
      </div>
    </div>
  );
}
