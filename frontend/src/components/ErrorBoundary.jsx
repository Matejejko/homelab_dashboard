import { Component } from 'react';

// Last line of defence: a rendering error shows this instead of a blank page.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="auth">
        <div className="auth__card auth__card--plain" role="alert">
          <p className="notice notice--bad">The dashboard hit an unexpected error.</p>
          <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </main>
    );
  }
}
