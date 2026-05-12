import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getSupabaseClient } from "@/lib/supabaseRuntime";
import { useAuthStore } from "@/stores/authStore";
import { AuthGate } from "@/components/AuthGate";
import { BackendConfigGate } from "@/components/BackendConfigGate";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useMCPServer } from "@/hooks/useMCPServer";
import Overview from "@/pages/Overview";
import ToolTester from "@/pages/ToolTester";
import RequestMonitor from "@/pages/RequestMonitor";
import Settings from "@/pages/Settings";
import AIChat from "@/pages/AIChat";
import DeploymentGuide from "@/pages/DeploymentGuide";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

/** Handle custom GitHub OAuth callback: verifyOtp then load GitHub token from DB */
async function handleOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  const authError = params.get("auth_error");

  if (authError) {
    console.error("GitHub auth error:", authError);
    // Clean URL
    window.history.replaceState({}, "", window.location.pathname);
    return;
  }

  if (tokenHash && type === "magiclink") {
    const supabase = getSupabaseClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "magiclink",
    });
    if (error) {
      console.error("OTP verification failed:", error.message);
    }
    // Clean URL
    window.history.replaceState({}, "", window.location.pathname);
  }
}

/** Load GitHub token in background (non-blocking) */
async function loadGithubToken(userId: string): Promise<string | null> {
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "github_token")
      .eq("user_id", userId)
      .maybeSingle();
    return data?.value ?? null;
  } catch {
    return null;
  }
}

function AuthListener() {
  const { setSession } = useAuthStore();

  useEffect(() => {
    // Fire-and-forget — don't block session loading
    handleOAuthCallback();

    const supabase = getSupabaseClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null;
      // Show UI immediately with null token, then load token in background
      setSession(user, null);
      if (user) {
        loadGithubToken(user.id).then((token) => {
          if (token) setSession(user, token);
        });
      }
    });

    // Initial session check
    supabase.auth.getSession().then(({ data: { session } }) => {
      const user = session?.user ?? null;
      setSession(user, null);
      if (user) {
        loadGithubToken(user.id).then((token) => {
          if (token) setSession(user, token);
        });
      }
    });

    return () => subscription.unsubscribe();
  }, [setSession]);

  return null;
}

function AppContent() {
  const { pingServer } = useMCPServer();
  const [serverOnline, setServerOnline] = useState<boolean | undefined>(
    undefined,
  );

  useEffect(() => {
    pingServer().then(setServerOnline);
    const interval = setInterval(
      () => pingServer().then(setServerOnline),
      30000,
    );
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
        <Route path="/deploy" element={<DeploymentGuide />} />
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
        <BackendConfigGate>
          <AuthListener />
          <AuthGate>
            <AppContent />
          </AuthGate>
        </BackendConfigGate>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
