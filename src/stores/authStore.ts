import { create } from "zustand";
import type { User } from "@supabase/supabase-js";

interface AuthState {
  user: User | null;
  githubToken: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  setSession: (user: User | null, githubToken: string | null) => void;
  setLoading: (loading: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  githubToken: null,
  isAuthenticated: false,
  loading: true,
  setSession: (user, githubToken) =>
    set({
      user,
      githubToken,
      isAuthenticated: !!user,
      loading: false,
    }),
  setLoading: (loading) => set({ loading }),
  logout: () =>
    set({
      user: null,
      githubToken: null,
      isAuthenticated: false,
      loading: false,
    }),
}));
