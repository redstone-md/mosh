import { Component, type ErrorInfo, type ReactNode } from 'react'

type AppErrorBoundaryProps = {
  children: ReactNode
}

type AppErrorBoundaryState = {
  errorMessage: string | null
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    errorMessage: null,
  }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      errorMessage: error.message || 'Unknown desktop shell error',
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('MOSH render failure', error, info)
  }

  render() {
    if (this.state.errorMessage) {
      return (
        <main className="min-h-screen flex items-center justify-center p-4 bg-background text-foreground">
          <section className="bg-red-500/5 border border-red-500/20 rounded-3xl p-8 max-w-lg w-full text-center space-y-4">
            <p className="text-xs uppercase tracking-widest text-red-400 font-bold">Render error</p>
            <h1 className="text-2xl font-bold">Desktop shell crashed</h1>
            <p className="text-sm text-foreground/70 bg-black/40 p-4 rounded-xl font-mono overflow-auto text-left">
              {this.state.errorMessage}
            </p>
          </section>
        </main>
      )
    }

    return this.props.children
  }
}
