import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { login, logout } from './authSlice.js';
import { toast } from './toastSlice.js';
import { useGetUsersQuery } from './apiSlice.js';

export const useAuth = () => {
  const dispatch = useDispatch();
  const { user, ready } = useSelector((s) => s.auth);
  return {
    user,
    ready,
    isLead: user?.role === 'lead',
    login: (email, password) => dispatch(login({ email, password })).unwrap(),
    logout: () => dispatch(logout()),
  };
};

export const useToast = () => {
  const dispatch = useDispatch();
  return useCallback((text, tone = 'ok') => dispatch(toast({ text, tone })), [dispatch]);
};

/**
 * Run a mutation promise (e.g. `() => trigger(arg).unwrap()`): toast on success or failure,
 * resolve with the result, or undefined when it failed. RTK Query tags refresh the screens.
 */
export function useAction() {
  const notify = useToast();
  return useCallback(async (fn, okMsg) => {
    try {
      const r = await fn();
      if (okMsg) notify(okMsg);
      return r ?? true;
    } catch (e) {
      notify(e.message || 'Something went wrong', 'bad');
      return undefined;
    }
  }, [notify]);
}

export const useUsers = () => useGetUsersQuery().data?.items ?? [];

export function Toasts() {
  const items = useSelector((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => <div key={t.id} className={`toast toast-${t.tone}`}>{t.text}</div>)}
    </div>
  );
}
