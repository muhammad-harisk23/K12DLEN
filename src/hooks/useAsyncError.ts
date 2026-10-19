import { useState } from 'react';

export function useAsyncError() {
  const [error, setError] = useState<string | null>(null);

  function capture(err: unknown) {
    if (err instanceof Error) setError(err.message);
    else if (typeof err === 'string') setError(err);
    else setError('Something went wrong. Please try again.');
  }

  return { error, setError, capture };
}
