import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

const slice = createSlice({
  name: 'toasts',
  initialState: [],
  reducers: {
    added: (s, a) => { s.push(a.payload); },
    removed: (s, a) => s.filter((t) => t.id !== a.payload),
  },
});

/** Show a toast and remove it after a few seconds. */
export const toast = createAsyncThunk('toasts/show', async ({ text, tone = 'ok' }, { dispatch }) => {
  const id = Math.random().toString(36).slice(2);
  dispatch(slice.actions.added({ id, text, tone }));
  setTimeout(() => dispatch(slice.actions.removed(id)), 4200);
});

export default slice.reducer;
