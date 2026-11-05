import { useSearchParams } from 'react-router-dom';

/** Open a task in the side drawer without leaving the current page (?task=<id>). */
export function useOpenTask() {
  const [params, setParams] = useSearchParams();
  return (id) => {
    const next = new URLSearchParams(params);
    next.set('task', id);
    setParams(next);
  };
}
