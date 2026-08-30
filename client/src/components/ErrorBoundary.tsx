import { Component, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
          <div className="card max-w-md text-center">
            <AlertTriangle className="mx-auto mb-3 text-red-500" size={40} />
            <h2 className="text-lg font-bold text-navy mb-2">משהו השתבש</h2>
            <p className="text-sm text-slate-500 mb-4">{this.state.error.message}</p>
            <button className="btn-primary" onClick={() => window.location.reload()}>
              רענון הדף
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
