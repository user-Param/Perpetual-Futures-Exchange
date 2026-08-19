// bot/utils.ts
import { CONFIG } from './config.js';

export async function apiRequest(
  token: string | null,
  method: string,
  path: string,
  body?: any
) {
  const url = `${CONFIG.API_BASE}${path}`;
  const headers: any = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${data.error || JSON.stringify(data)}`);
  }
  return data;
}

export function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

export function randomBetween(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

export function randomInt(min: number, max: number) {
  return Math.floor(randomBetween(min, max + 1));
}
