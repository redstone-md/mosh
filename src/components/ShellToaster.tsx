import { Toaster } from 'react-hot-toast'

export function ShellToaster() {
  return (
    <Toaster
      toastOptions={{
        style: {
          background: 'var(--panel)',
          color: 'var(--foreground)',
          border: '1px solid var(--border)',
        },
      }}
    />
  )
}
