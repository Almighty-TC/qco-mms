// ─── TOAST CONTEXT + HOOK ────────────────────────────────────
// Shared toast state. Wrap a page with ToastProvider and call
// useToast() in any descendant component to get addToast.
import { createContext, useContext, useState, useCallback } from 'react'
import type { ReactNode } from 'react'

export type ToastType = 'success' | 'error' | 'warning'

export interface ToastItem {
  id: number
  type: ToastType
  message: string
}

interface ToastCtx {
  toasts: ToastItem[]
  addToast: (type: ToastType, message: string) => void
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastCtx | null>(null)

let _nextId = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = ++_nextId
    setToasts(prev => [...prev, { id, type, message }])
    const duration = type === 'error' ? 5000 : type === 'warning' ? 4000 : 3000
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration)
  }, [])

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toasts, addToast, dismiss }}>
      {children}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
