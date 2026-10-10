import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Play } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error inside component tree:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  private handleResume = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-[#ebeae5] text-stone-900 flex items-center justify-center p-6 font-['Plus_Jakarta_Sans',sans-serif]">
          <div className="max-w-md w-full p-8 rounded-3xl bg-stone-100 border border-stone-300 shadow-xl text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <h2 className="text-xl font-display font-extrabold text-stone-900">
              Recovering Exploration Interface
            </h2>
            <p className="text-xs font-mono text-stone-600 leading-relaxed">
              An unexpected component issue was caught. Your progress and outdoor telemetry are safe.
            </p>
            {this.state.error && (
              <div className="p-3 rounded-xl bg-stone-200/70 border border-stone-300/80 font-mono text-[11px] text-stone-800 text-left overflow-x-auto max-h-24">
                {this.state.error.message}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={this.handleResume}
                className="w-full py-3 px-3 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-mono text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Resume App</span>
              </button>
              <button
                onClick={this.handleReset}
                className="w-full py-3 px-3 bg-stone-900 hover:bg-stone-800 text-stone-50 rounded-xl font-mono text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Reload</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Lightweight local boundary for isolating 3D canvases, audio visualizers, or map views
 */
export class ComponentErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode; componentName?: string },
  { hasError: boolean; error: Error | null }
> {
  public state = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.warn(`[${this.props.componentName || 'Component'}] caught error safely:`, error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="w-full h-full min-h-[160px] flex items-center justify-center p-4 rounded-2xl bg-stone-200/60 border border-stone-300 text-center font-mono text-xs text-stone-600">
          <div className="space-y-1">
            <div className="text-stone-800 font-bold">{this.props.componentName || 'Module'} standby</div>
            <div className="text-[11px] text-stone-500">Component safely resting. Other features remain fully active.</div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
