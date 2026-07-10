import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './styles/main.css';
import './lang/i18n';
import { getDebugConfig } from './debug/debugConfig';
import { overrideConsole } from './debug/consoleOverride';

overrideConsole(getDebugConfig());

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
