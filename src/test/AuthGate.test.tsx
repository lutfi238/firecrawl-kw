import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGate } from "@/components/AuthGate";
import { useAuthStore } from "@/stores/authStore";

const authMocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock("@/lib/supabaseRuntime", () => ({
  getSupabaseClient: () => ({
    auth: authMocks,
  }),
}));

vi.mock("@/lib/backendConfig", () => ({
  getBackendConfig: () => ({
    supabaseUrl: "https://example.supabase.co",
  }),
}));

describe("AuthGate", () => {
  beforeEach(() => {
    authMocks.signInWithPassword.mockReset();
    authMocks.signUp.mockReset();
    authMocks.signInWithPassword.mockResolvedValue({ error: null });
    authMocks.signUp.mockResolvedValue({ error: null });
    useAuthStore.setState({
      user: null,
      githubToken: null,
      isAuthenticated: false,
      loading: false,
    });
  });

  it("signs in with a Supabase email and password account", async () => {
    render(
      <AuthGate>
        <div>Dashboard</div>
      </AuthGate>,
    );

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "ada@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "password123" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /sign in with supabase/i }),
    );

    await waitFor(() => {
      expect(authMocks.signInWithPassword).toHaveBeenCalledWith({
        email: "ada@example.com",
        password: "password123",
      });
    });
  });

  it("creates a Supabase auth account from the login gate", async () => {
    render(
      <AuthGate>
        <div>Dashboard</div>
      </AuthGate>,
    );

    fireEvent.click(screen.getByRole("button", { name: /create account/i }));
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "grace@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "strongpassword" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /create supabase account/i }),
    );

    await waitFor(() => {
      expect(authMocks.signUp).toHaveBeenCalledWith({
        email: "grace@example.com",
        password: "strongpassword",
      });
    });
  });
});
