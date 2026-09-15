import { jsonResponse } from '../_auth.js';

export async function onRequestPost(context) {
  return jsonResponse({ success: true }, 200, {
    'Set-Cookie': 'session_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
  });
}
