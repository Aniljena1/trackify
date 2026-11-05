import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import '@fontsource-variable/fraunces';
import '@fontsource-variable/instrument-sans';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import App from './App.jsx';
import { store } from './store/index.js';
import { restoreSession } from './store/authSlice.js';
import { Toasts } from './store/hooks.jsx';

store.dispatch(restoreSession());

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Provider store={store}>
      <BrowserRouter>
        <App />
        <Toasts />
      </BrowserRouter>
    </Provider>
  </React.StrictMode>,
);
