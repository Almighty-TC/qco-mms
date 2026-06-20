import { useState } from 'react';
import axios from 'axios';
import { API } from '../lib/api';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // ── Forgot-password view state ──────────────────────────────
  const [mode, setMode] = useState<'signin' | 'forgot'>('signin');
  const [forgotMsg, setForgotMsg] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setForgotMsg('');
    setForgotLoading(true);
    try {
      const { data } = await axios.post(`${API}/auth/forgot-password`, { email });
      setForgotMsg(data?.message || 'If an account with that email exists, a temporary password has been emailed.');
    } catch (err: any) {
      // The endpoint is intentionally generic; only a missing email returns an error.
      setError(err.response?.data?.error || 'Could not process the request. Please try again.');
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0a0a',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Inter', -apple-system, sans-serif",
    }}>
      {/* Left accent bar */}
      <div style={{
        position: 'fixed',
        left: 0, top: 0, bottom: 0,
        width: 4,
        background: '#E84E0F',
      }} />

      <div style={{ width: 400, padding: '0 1rem' }}>

        {/* Logo area */}
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: '1rem',
          }}>
            {/* QCO text logo fallback — replace src with actual logo path later */}
            <div style={{
              fontSize: 36,
              fontWeight: 900,
              color: '#fff',
              letterSpacing: -1,
            }}>
              QC<span style={{ color: '#E84E0F' }}>O</span>.
            </div>
          </div>
          <div style={{
            fontSize: 13,
            fontWeight: 500,
            color: '#666',
            letterSpacing: 3,
            textTransform: 'uppercase',
          }}>
            Material Management System
          </div>
        </div>

        {/* Card */}
        <div style={{
          background: '#141414',
          border: '1px solid #222',
          borderRadius: 12,
          padding: '2rem',
        }}>
          <h2 style={{
            color: '#fff',
            fontSize: 18,
            fontWeight: 600,
            margin: '0 0 1.5rem 0',
          }}>
            {mode === 'signin' ? 'Sign in to your account' : 'Reset your password'}
          </h2>

          {mode === 'forgot' && (
            <p style={{ color: '#888', fontSize: 13, margin: '0 0 1.25rem 0', lineHeight: 1.5 }}>
              Enter your account email and we'll send you a temporary password. You'll set a new one when you sign in.
            </p>
          )}

          <form onSubmit={mode === 'signin' ? handleSubmit : handleForgot}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{
                display: 'block',
                color: '#888',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: 1,
                textTransform: 'uppercase',
                marginBottom: 6,
              }}>
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@qcogroup.com.au"
                required
                style={{
                  width: '100%',
                  padding: '0.7rem 0.875rem',
                  borderRadius: 6,
                  border: '1px solid #2a2a2a',
                  background: '#0a0a0a',
                  color: '#fff',
                  fontSize: 14,
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              />
            </div>

            {mode === 'signin' && (
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{
                display: 'block',
                color: '#888',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: 1,
                textTransform: 'uppercase',
                marginBottom: 6,
              }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                style={{
                  width: '100%',
                  padding: '0.7rem 0.875rem',
                  borderRadius: 6,
                  border: '1px solid #2a2a2a',
                  background: '#0a0a0a',
                  color: '#fff',
                  fontSize: 14,
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              />
            </div>
            )}

            {mode === 'forgot' && forgotMsg && (
              <div style={{
                background: '#0a1a0f',
                border: '1px solid #1a3a24',
                borderRadius: 6,
                padding: '0.6rem 0.875rem',
                color: '#4ade80',
                fontSize: 13,
                marginBottom: '1rem',
                lineHeight: 1.5,
              }}>
                {forgotMsg}
              </div>
            )}

            {error && (
              <div style={{
                background: '#1a0a0a',
                border: '1px solid #3a1a1a',
                borderRadius: 6,
                padding: '0.6rem 0.875rem',
                color: '#f87171',
                fontSize: 13,
                marginBottom: '1rem',
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || forgotLoading}
              style={{
                width: '100%',
                padding: '0.75rem',
                borderRadius: 6,
                background: (loading || forgotLoading) ? '#b33a0c' : '#E84E0F',
                color: '#fff',
                fontWeight: 700,
                fontSize: 14,
                border: 'none',
                cursor: (loading || forgotLoading) ? 'not-allowed' : 'pointer',
                letterSpacing: 0.5,
                transition: 'background 0.2s',
              }}
            >
              {mode === 'signin'
                ? (loading ? 'Signing in...' : 'Sign In')
                : (forgotLoading ? 'Sending...' : 'Send temporary password')}
            </button>

            {/* Mode toggle */}
            <div style={{ textAlign: 'center', marginTop: '1rem' }}>
              <button
                type="button"
                onClick={() => {
                  setError('');
                  setForgotMsg('');
                  setMode(mode === 'signin' ? 'forgot' : 'signin');
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#888',
                  fontSize: 13,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  fontFamily: 'inherit',
                }}
              >
                {mode === 'signin' ? 'Forgot password?' : '← Back to sign in'}
              </button>
            </div>
          </form>
        </div>

        {/* Footer */}
        <div style={{
          textAlign: 'center',
          marginTop: '1.5rem',
          color: '#444',
          fontSize: 12,
        }}>
          © {new Date().getFullYear()} QCO Group · qcogroup.com.au
        </div>
      </div>
    </div>
  );
}