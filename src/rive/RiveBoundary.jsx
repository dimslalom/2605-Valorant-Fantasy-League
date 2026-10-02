import { Component } from 'react';

// If Rive fails to load or crash (wasm blocked, Lockdown Mode, a bad file), the
// plain DOM version of the surface takes over. Rive is skin, never a dependency.
export default class RiveBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.warn('Rive surface failed, using the DOM fallback:', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
