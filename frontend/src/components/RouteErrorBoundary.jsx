import React from "react";

export default class RouteErrorBoundary extends React.Component {
  state = {
    error: null,
    errorInfo: null,
  };

  static getDerivedStateFromError(error) {
    return {
      error,
    };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Route rendering error", error, errorInfo);

    this.setState({
      errorInfo,
    });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReturnHome = () => {
    window.history.replaceState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  render() {
    if (this.state.error) {
      const errorMessage = this.state.error?.message || String(this.state.error);

      const componentStack = this.state.errorInfo?.componentStack || "";

      return (
        <div className="card">
          <h2>Page error</h2>

          <p>{errorMessage}</p>

          {componentStack ? (
            <details>
              <summary>Technical details</summary>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  fontSize: "12px",
                  marginTop: "12px",
                }}
              >
                {componentStack}
              </pre>
            </details>
          ) : null}

          <div className="form-actions">
            <button className="primary" type="button" onClick={this.handleReload}>
              Reload
            </button>

            <button className="secondary" type="button" onClick={this.handleReturnHome}>
              Return home
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
