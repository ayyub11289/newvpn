import React from 'react';
import ReactDOM from 'react-dom/client';
import 'misans/lib/Normal/MiSansVF.min.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import './index.css';
import { App } from './App';
import { TrayPopoverView } from './components/TrayPopoverView';

const isTrayWindow = window.location.hash === '#tray';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isTrayWindow ? <TrayPopoverView /> : <App />}</React.StrictMode>
);
