import { configureStore } from '@reduxjs/toolkit';
import { api } from './apiSlice.js';
import auth, { logout } from './authSlice.js';
import toasts from './toastSlice.js';
import { setUnauthorizedHandler } from './http.js';

export const store = configureStore({
  reducer: { [api.reducerPath]: api.reducer, auth, toasts },
  middleware: (getDefault) => getDefault().concat(api.middleware),
});

// An expired or revoked token anywhere signs the user out.
setUnauthorizedHandler(() => store.dispatch(logout()));
