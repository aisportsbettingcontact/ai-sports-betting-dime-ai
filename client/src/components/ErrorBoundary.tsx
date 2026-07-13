import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Error message:', error.message);
    console.error('[ErrorBoundary] Component stack:', info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        // Use explicit dark colors — never semantic tokens that depend on ThemeProvider.
        // Previously used bg-background/text-destructive which resolved to invisible
        // dark-on-dark when ThemeProvider defaultTheme="dark" was active.
        <div className="flex items-center justify-center min-h-screen p-8 bg-black">
          <div className="flex flex-col items-center w-full max-w-2xl p-8">
            <AlertTriangle
              size={48}
              className="text-white mb-6 flex-shrink-0"
            />

            <h2 className="text-xl mb-4 text-white font-bold">An unexpected error occurred.</h2>

            <div className="p-4 w-full rounded-lg bg-black border border-white overflow-auto mb-6">
              <pre className="text-sm text-white font-bold whitespace-break-spaces mb-2">
                {this.state.error?.message}
              </pre>
              <pre className="text-xs text-white whitespace-break-spaces">
                {this.state.error?.stack}
              </pre>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, error: null })}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-black text-white transition-colors cursor-pointer"
              >
                <RotateCcw size={16} />
                Try Again
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#45E0A8] text-white transition-colors cursor-pointer"
              >
                <RotateCcw size={16} />
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
