import { describe, it, expect } from 'vitest';
import { corsHeaders, handlePreflight } from '../src/cors.js';

describe('corsHeaders', () => {
  it('指定オリジンに対して必要なヘッダを返す', () => {
    const headers = corsHeaders('https://trip-road.pages.dev');
    expect(headers['Access-Control-Allow-Origin']).toBe('https://trip-road.pages.dev');
    expect(headers['Access-Control-Allow-Methods']).toBe('POST, OPTIONS');
    expect(headers['Access-Control-Allow-Headers']).toContain('Content-Type');
    expect(headers['Access-Control-Allow-Headers']).toContain('X-App-Password');
  });
});

describe('handlePreflight', () => {
  it('OPTIONS リクエストに対して 204 を返す', () => {
    const req = new Request('https://example.com/api/describe', {
      method: 'OPTIONS',
      headers: { Origin: 'https://trip-road.pages.dev' },
    });
    const res = handlePreflight(req, 'https://trip-road.pages.dev');
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://trip-road.pages.dev');
  });

  it('非 OPTIONS リクエストに対して null を返す', () => {
    const req = new Request('https://example.com/api/describe', {
      method: 'POST',
    });
    const res = handlePreflight(req, 'https://trip-road.pages.dev');
    expect(res).toBeNull();
  });
});
