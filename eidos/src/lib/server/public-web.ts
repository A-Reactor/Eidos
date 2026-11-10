import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['2001::', 32], ['2001:db8::', 32], ['2002::', 16]] as const) blocked.addSubnet(address, prefix, 'ipv6');
const globalV6 = new BlockList(); globalV6.addSubnet('2000::', 3, 'ipv6');
const proxyV4 = new BlockList(); proxyV4.addSubnet('198.18.0.0', 15, 'ipv4');
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, 'ipv4')
    : family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}
export function isAllowedWebAddress(address: string, url: URL): boolean {
  // TUN proxies deliberately answer public DNS with benchmark-range addresses.
  // This opt-in applies only to named HTTPS hosts; TLS still verifies the hostname.
  return isPublicAddress(address) || process.env.WEB_ALLOW_FAKE_IP_DNS === 'true' && url.protocol === 'https:' &&
    !isIP(url.hostname.replace(/^\[|\]$/g, '')) && isIP(address) === 4 && proxyV4.check(address, 'ipv4');
}
function publicUrl(value: string): URL {
  const url = new URL(value), host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
    host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || isIP(host) && !isPublicAddress(host)) throw new Error('联网工具只读取公网 HTTP(S) 网页');
  return url;
}
export interface PublicPage { url: string; contentType: string; text: string }

/** Resolve and pin public addresses on every hop; a redirect or DNS change cannot reach local services. */
export async function requestPublicText(value: string, parentSignal?: AbortSignal): Promise<PublicPage> {
  const signal = parentSignal ? AbortSignal.any([parentSignal, AbortSignal.timeout(18000)]) : AbortSignal.timeout(18000);
  let url = publicUrl(value);
  for (let hop = 0; hop < 5; hop++) {
    signal.throwIfAborted();
    const response = await new Promise<{ location?: string; contentType: string; text: string }>((resolve, reject) => {
      const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = send(url, { signal,
        headers: { 'User-Agent': 'Eidos/0.1 (public web reader)', Accept: 'text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.1', 'Accept-Encoding': 'identity' },
        lookup: (hostname, options, callback) => {
          lookup(hostname, { all: true }).then(addresses => {
            if (!addresses.length || addresses.some(item => !isAllowedWebAddress(item.address, url))) throw new Error('域名解析到了非公网地址；代理使用198.18/15 Fake-IP时可设置 WEB_ALLOW_FAKE_IP_DNS=true');
            if (options.all) callback(null, addresses);
            else callback(null, addresses[0].address, addresses[0].family);
          }).catch(error => callback(error, '', 4));
        },
      }, res => {
        const status = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
          res.destroy(); resolve({ location: res.headers.location, contentType: '', text: '' }); return;
        }
        if (status < 200 || status >= 300) { res.destroy(); reject(new Error(`网页服务返回 HTTP ${status}`)); return; }
        const contentType = res.headers['content-type'] ?? '';
        if (!/^(text\/|application\/(?:xhtml\+xml|xml|rss\+xml|json))/i.test(contentType)) { res.destroy(); reject(new Error(`暂不支持读取此网页类型：${contentType || '未知'}`)); return; }
        const chunks: Buffer[] = []; let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 2 * 1024 * 1024) { res.destroy(new Error('网页超过2 MiB读取上限')); return; }
          chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          try {
            const charset = contentType.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1] ?? 'utf-8';
            resolve({ contentType, text: new TextDecoder(charset).decode(Buffer.concat(chunks)) });
          } catch { reject(new Error('网页字符编码不支持')); }
        });
      });
      req.on('error', error => reject(new Error(`网页请求失败：${(error as NodeJS.ErrnoException).code ?? error.message}`, { cause: error })));
      req.end();
    });
    signal.throwIfAborted();
    if (!response.location) return { url: url.href, contentType: response.contentType, text: response.text };
    url = publicUrl(new URL(response.location, url).href);
  }
  throw new Error('网页重定向次数过多');
}
