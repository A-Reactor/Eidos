import { afterEach, expect, it, vi } from 'vitest';
import { isPublicAddress, isAllowedWebAddress, requestPublicText } from '@/lib/server/public-web';
afterEach(() => vi.unstubAllEnvs());

it.each(['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.31.0.1', '169.254.169.254', '0.0.0.0', '100.64.0.1',
  '::1', '::ffff:127.0.0.1', '::ffff:192.168.1.1', 'fc00::1', 'fe80::1', '2001:db8::1', '2002:7f00:1::', 'invalid'])('rejects non-public destination %s', ip => {
  expect(isPublicAddress(ip)).toBe(false);
});
it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('allows public destination %s', ip => {
  expect(isPublicAddress(ip)).toBe(true);
});
it.each(['file:///etc/passwd', 'http://127.1/', 'http://2130706433/', 'http://[::ffff:127.0.0.1]/', 'http://localhost/', 'https://user:secret@example.com/'])('rejects a non-public URL before making a request: %s', async url => {
  await expect(requestPublicText(url)).rejects.toThrow();
});
it('does not start an already cancelled page request', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(requestPublicText('https://example.com/', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
});
it('allows opt-in proxy Fake-IP DNS only for named HTTPS destinations', () => {
  vi.stubEnv('WEB_ALLOW_FAKE_IP_DNS', 'false');
  expect(isAllowedWebAddress('198.18.0.80', new URL('https://cn.bing.com/'))).toBe(false);
  vi.stubEnv('WEB_ALLOW_FAKE_IP_DNS', 'true');
  expect(isAllowedWebAddress('198.18.0.80', new URL('https://cn.bing.com/'))).toBe(true);
  expect(isAllowedWebAddress('198.18.0.80', new URL('http://cn.bing.com/'))).toBe(false);
  expect(isAllowedWebAddress('198.18.0.80', new URL('https://198.18.0.80/'))).toBe(false);
  expect(isAllowedWebAddress('127.0.0.1', new URL('https://example.com/'))).toBe(false);
});
