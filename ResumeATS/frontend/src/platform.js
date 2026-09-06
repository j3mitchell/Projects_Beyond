import { createClient } from '@supabase/supabase-js';

const API = (process.env.REACT_APP_API_BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
const url = process.env.REACT_APP_SUPABASE_URL;
const key = process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY;
export const gatewayUrl = 'https://jisystems.net/app/gateway/?tool=resumeats';
export const hosted = Boolean(url && key);
export const platform = hosted ? createClient(url, key) : null;

export async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (platform) {
    const { data, error } = await platform.auth.getSession();
    if (error || !data.session) throw new Error('Sign in through J.I. Systems to use ResumeATS.');
    headers.set('Authorization', `Bearer ${data.session.access_token}`);
  } else if (!['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    throw new Error('Platform sign-in is not configured.');
  }
  const response = await fetch(`${API}${path}`, { ...options, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = typeof body.detail === 'string' ? body.detail : `Request failed (${response.status}). Please try again.`;
    throw new Error(detail);
  }
  return response;
}
