import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { http, tokenStore } from './http.js';
import { api } from './apiSlice.js';

export const login = createAsyncThunk('auth/login', async ({ email, password }, { rejectWithValue }) => {
  try {
    const { data } = await http.post('/auth/login', { email, password });
    tokenStore.set(data.token);
    return data.user;
  } catch (e) {
    return rejectWithValue(e);
  }
});

/** Restore the session from a stored token on page load. */
export const restoreSession = createAsyncThunk('auth/restore', async (_, { rejectWithValue }) => {
  if (!tokenStore.get()) return null;
  try {
    const { data } = await http.get('/auth/me');
    return data.user;
  } catch (e) {
    tokenStore.clear();
    return rejectWithValue(e);
  }
});

export const logout = createAsyncThunk('auth/logout', async (_, { dispatch }) => {
  tokenStore.clear();
  dispatch(api.util.resetApiState()); // never show one user's cached data to the next
});

const slice = createSlice({
  name: 'auth',
  initialState: { user: null, ready: !tokenStore.get() },
  reducers: {},
  extraReducers: (b) => {
    b.addCase(login.fulfilled, (s, a) => { s.user = a.payload; s.ready = true; })
      .addCase(restoreSession.fulfilled, (s, a) => { s.user = a.payload; s.ready = true; })
      .addCase(restoreSession.rejected, (s) => { s.user = null; s.ready = true; })
      .addCase(logout.fulfilled, (s) => { s.user = null; });
  },
});

export default slice.reducer;
