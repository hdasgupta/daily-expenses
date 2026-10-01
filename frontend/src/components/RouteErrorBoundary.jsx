import React from "react";

export default class RouteErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error)
      return (
        <div className="card">
          <h2>Page error</h2>
          <p>{this.state.error.message}</p>
        </div>
      );
    return this.props.children;
  }
}
