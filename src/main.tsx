import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { App } from './App';
import { TrayPopoverView } from './components/TrayPopoverView';

const isTrayWindow = window.location.hash === '#tray';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isTrayWindow ? <TrayPopoverView /> : <App />}</React.StrictMode>
);
