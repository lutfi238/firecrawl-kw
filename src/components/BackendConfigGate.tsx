import { useEffect, useState } from "react";
import {
  getBackendConfig,
  hasValidBackendConfig,
  shouldShowBackendSetup,
} from "@/lib/backendConfig";
import BackendSetup from "@/pages/BackendSetup";

export function BackendConfigGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(() => !shouldShowBackendSetup());
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const handler = () => {
      setReady(
        !shouldShowBackendSetup() && hasValidBackendConfig(getBackendConfig()),
      );
      setVersion((current) => current + 1);
    };
    window.addEventListener("firecrawl-backend-config-changed", handler);
    return () =>
      window.removeEventListener("firecrawl-backend-config-changed", handler);
  }, []);

  if (!ready) {
    return <BackendSetup key={version} onConfigured={() => setReady(true)} />;
  }

  return <>{children}</>;
}
