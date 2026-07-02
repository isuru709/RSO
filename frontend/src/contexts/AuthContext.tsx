import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  sendPasswordResetEmail,
} from 'firebase/auth';
import type { User, IdTokenResult } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { api } from '../lib/api';

interface Claims {
  role?: string;
  app_role?: string;
  tenant_id?: string;
  is_banned?: boolean;
}

interface AuthContextType {
  user: User | null;
  claims: Claims;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, tenantCode: string, fullName: string, memberId?: string, phone?: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [claims, setClaims] = useState<Claims>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Safety timeout — if Firebase doesn't respond in 5s, stop loading
    const timeout = setTimeout(() => {
      setLoading(false);
    }, 5000);

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      clearTimeout(timeout);
      if (firebaseUser) {
        setUser(firebaseUser);
        try {
          const tokenResult: IdTokenResult = await firebaseUser.getIdTokenResult();
          setClaims({
            role: tokenResult.claims.role as string,
            app_role: tokenResult.claims.app_role as string,
            tenant_id: tokenResult.claims.tenant_id as string,
            is_banned: tokenResult.claims.is_banned === true,
          });
        } catch {
          setClaims({});
        }
      } else {
        setUser(null);
        setClaims({});
      }
      setLoading(false);
    });

    return () => {
      clearTimeout(timeout);
      unsubscribe();
    };
  }, []);

  const login = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signup = async (email: string, password: string, tenantCode: string, fullName: string, memberId?: string, phone?: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    // Call backend signup to create profile and set claims
    const res = await api.post('/users/signup', {
      tenant_code: tenantCode,
      full_name: fullName,
      member_id: memberId || undefined,
      phone: phone || undefined,
    });
    if (!res.success) {
      // Rollback: delete the Firebase user since profile creation failed
      await cred.user.delete();
      throw new Error(res.error?.message || 'Failed to create profile. Check your faculty code.');
    }
    // Refresh token to get new claims
    await cred.user.getIdToken(true);
    const tokenResult = await cred.user.getIdTokenResult();
    setClaims({
      role: tokenResult.claims.role as string,
      app_role: tokenResult.claims.app_role as string,
      tenant_id: tokenResult.claims.tenant_id as string,
      is_banned: tokenResult.claims.is_banned === true,
    });
  };

  const loginWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const logout = async () => {
    await signOut(auth);
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  return (
    <AuthContext.Provider value={{ user, claims, loading, login, signup, loginWithGoogle, logout, resetPassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
