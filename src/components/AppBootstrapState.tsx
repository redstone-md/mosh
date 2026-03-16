type BootstrapStateProps = {
  message?: string
}

export function LoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--app)] text-sm text-[var(--muted-foreground)]">
      Loading mesh shell...
    </main>
  )
}

export function BootstrapErrorScreen({ message }: BootstrapStateProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--app)] p-6">
      <section className="w-full max-w-lg rounded-lg border border-border bg-[var(--panel)] p-6 text-foreground">
        <p className="text-sm font-medium">Bootstrap error</p>
        <p className="mt-3 text-sm text-[var(--muted-foreground)]">{message}</p>
      </section>
    </main>
  )
}
