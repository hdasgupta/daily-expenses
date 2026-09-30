import React from 'react';

export default class RouteErrorBoundary extends React.Component {
  constructor(props){
    super(props);
    this.state={error:null};
  }
  static getDerivedStateFromError(error){ return {error}; }
  componentDidCatch(error,info){
    console.error('[ROUTE ERROR]',error,info);
  }
  componentDidUpdate(prevProps){
    if(prevProps.routeKey!==this.props.routeKey && this.state.error){
      this.setState({error:null});
    }
  }
  render(){
    if(this.state.error){
      return <section className="card">
        <h2>Unable to open this page</h2>
        <p className="notice">The navigation worked, but this module encountered an error while rendering.</p>
        <details>
          <summary>Technical details</summary>
          <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{this.state.error?.stack||String(this.state.error)}</pre>
        </details>
        <button className="primary" type="button" onClick={()=>this.setState({error:null})}>Try again</button>
      </section>;
    }
    return this.props.children;
  }
}
