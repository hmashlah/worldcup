import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { supabase, ADMIN_EMAIL } from '@/lib/supabase';
import { useMyProfile } from '@/hooks/useProfiles';

interface User {
  id: string;
  email: string;
  displayName?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  /** Profile loaded; user is approved by admin. Admin is always approved. */
  isApproved: boolean;
  /** Profile fetch is still in flight (we don't yet know approval status). */
  approvalLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function userFromSession(session: { user: { id: string; email?: string; user_metadata?: Record<string, unknown> } }): User {
  return {
    id: session.user.id,
    email: session.user.email!,
    displayName: (session.user.user_metadata as { display_name?: string } | undefined)?.display_name,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      if (session?.user) setUser(userFromSession(session));
      setLoading(false);
    }).catch(() => setLoading(false));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      if (session?.user) setUser(userFromSession(session));
      else setUser(null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Load own profile to check approval. Polls every 30s so an
  // admin-approved user picks up access without a refresh.
  const profileQ = useMyProfile(user?.id ?? null);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signUp = async (email: string, password: string, displayName?: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });
    if (error) throw error;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const isAdmin = !!ADMIN_EMAIL && !!user && user.email.toLowerCase() === ADMIN_EMAIL;
  const isApproved = isAdmin || !!profileQ.data?.approved;
  const approvalLoading = !!user && profileQ.isLoading;

  return (
    <AuthContext.Provider value={{
      user, loading, isAdmin, isApproved, approvalLoading,
      signIn, signUp, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
