import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import axios from 'axios';

// ─── USER TYPE ───────────────────────────────────────────────
// Mirrors the JWT payload.  forcePasswordChange and passwordExpiresAt
// are set by the server on login and used to gate the UI immediately.
type User = {
  id: number;
  email: string;
  full_name: string;
  role: string;
  company: string | null;
  phone: string | null;
  forcePasswordChange: boolean;
  passwordExpiresAt: string | null;
};

// ─── CONTEXT TYPE ───────────────────────────────────────────
type AuthContextType = {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  updateCredentials: (token: string, user: User) => void;
  isAuthenticated: boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_TOKEN_KEY = 'qmat_auth_token';
const AUTH_USER_KEY  = 'qmat_auth_user';

// ─── AUTH PROVIDER ──────────────────────────────────────────
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  // ── Restore session + set axios header synchronously ────
  // Lazy initializer runs before first render, so child useEffects
  // that fire API calls immediately will already have the header set.
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem(AUTH_USER_KEY);
    if (!stored) return null;
    try { return JSON.parse(stored); } catch { return null; }
  });
  const [token, setToken] = useState<string | null>(() => {
    const stored = localStorage.getItem(AUTH_TOKEN_KEY);
    if (stored) axios.defaults.headers.common.Authorization = `Bearer ${stored}`;
    return stored;
  });

  // ── Keep axios header in sync with token state changes ──
  useEffect(() => {
    if (token) {
      axios.defaults.headers.common.Authorization = `Bearer ${token}`;
    } else {
      delete axios.defaults.headers.common.Authorization;
    }
  }, [token]);

  // ── Belt-and-suspenders: interceptor reads fresh token on every request ──
  // Guards against any race where the default header isn't set yet.
  useEffect(() => {
    const id = axios.interceptors.request.use(config => {
      const stored = localStorage.getItem(AUTH_TOKEN_KEY);
      if (stored && !config.headers?.Authorization) {
        config.headers = config.headers ?? {};
        config.headers.Authorization = `Bearer ${stored}`;
      }
      return config;
    });
    return () => { axios.interceptors.request.eject(id); };
  }, []);

  // ── Login ────────────────────────────────────────────────
  const login = useCallback(async (email: string, password: string) => {
    const response = await axios.post('http://localhost:3001/api/auth/login', { email, password });
    const { token: authToken, user: authUser } = response.data;

    localStorage.setItem(AUTH_TOKEN_KEY, authToken);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(authUser));
    setToken(authToken);
    setUser(authUser);
  }, []);

  // ── Logout ───────────────────────────────────────────────
  const logout = useCallback(() => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    setToken(null);
    setUser(null);
  }, []);

  // ── Update credentials after password change ─────────────
  // Called by ForcePasswordChange and ChangePasswordModal once the
  // server confirms the change.  Re-issues a fresh token so the
  // forcePasswordChange flag is cleared without requiring a re-login.
  const updateCredentials = useCallback((newToken: string, newUser: User) => {
    localStorage.setItem(AUTH_TOKEN_KEY, newToken);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  }, []);

  const value = useMemo(
    () => ({ user, token, login, logout, updateCredentials, isAuthenticated: Boolean(user && token) }),
    [user, token, login, logout, updateCredentials]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// ─── USE AUTH ────────────────────────────────────────────────
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
