import { Component, type ReactNode } from 'react';

/** Last line of defence: an unexpected error shows a message and a reload button, not a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('StockMarketView crashed:', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <h1>Something went wrong</h1>
        <p>The page hit an unexpected error. Your watchlists, drawings and paper account are saved in this browser and are not affected.</p>
        <button className="btn primary" onClick={() => window.location.reload()}>
          Reload the page
        </button>
        <pre>{this.state.error.message}</pre>
      </div>
    );
  }
}
