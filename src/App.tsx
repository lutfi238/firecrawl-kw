import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { AuthGate } from "@/components/AuthGate";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useMCPServer } from "@/hooks/useMCPServer";
import Overview from "@/pages/Overview";
import ToolTester from "@/pages/ToolTester";
import RequestMonitor from "@/pages/RequestMonitor";
import Settings from "@/pages/Settings";
import AIChat from "@/pages/AIChat";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

function AuthListener() {
  const { setSession, setLoading } = useAuthStore();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        const user = session?.user ?? null;
        const providerToken = session?.provider_token ?? null;
        setSession(user, providerToken);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      const user = session?.user ?? null;
      const providerToken = session?.provider_token ?? null;
      setSession(user, providerToken);
    });

    return () => subscription.unsubscribe();
  }, [setSession, setLoading]);

  return null;
}

function AppContent() {
  const { pingServer } = useMCPServer();
  const [serverOnline, setServerOnline] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    pingServer().then(setServerOnline);
    const interval = setInterval(() => pingServer().then(setServerOnline), 30000);
    return () => clearInterval(interval);
  }, [pingServer]);

  return (
    <DashboardLayout serverOnline={serverOnline}>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/tester" element={<ToolTester />} />
        <Route path="/monitor" element={<RequestMonitor />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/chat" element={<AIChat />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </DashboardLayout>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthListener />
        <AuthGate>
          <AppContent />
        </AuthGate>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
