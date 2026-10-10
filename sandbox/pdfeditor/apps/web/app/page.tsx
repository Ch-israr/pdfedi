'use client';

import { useEffect } from 'react';
import { DevelopmentLayout } from '@/components/DevelopmentLayout';

export default function EditorPage() {
  // TEMP DEBUG: capture client-side errors in document.title for diagnosis
  useEffect(() => {
    const handler = (e: ErrorEvent) => {
      document.title = `ERR: ${(e.message || 'unknown').slice(0, 100)}`;
    };
    const rejHandler = (e: PromiseRejectionEvent) => {
      document.title = `REJ: ${String(e.reason?.message || e.reason || 'unknown').slice(0, 100)}`;
    };
    window.addEventListener('error', handler);
    window.addEventListener('unhandledrejection', rejHandler);
    return () => {
      window.removeEventListener('error', handler);
      window.removeEventListener('unhandledrejection', rejHandler);
    };
  }, []);
  return <DevelopmentLayout />;
}
