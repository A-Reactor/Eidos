'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildModDocument } from '@/lib/game/plugins/mod-ui';

/** This host page exposes only the author frame's session protocol, never settings. */
export default function ModStagePage() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [content, setContent] = useState<{ html: string; token: string } | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const document = useMemo(() => content ? buildModDocument(content.html, content.token) : '', [content]);
  useEffect(() => {
    const lease = location.hash.slice(1);
    if (!/^[a-f0-9]{32}$/.test(lease)) return;
    const link = new BroadcastChannel(`eidos-stage:${lease}`); channel.current = link;
    link.onmessage = event => {
      if (event.data?.kind === 'document') setContent({ html: event.data.html, token: event.data.token });
      if (event.data?.kind === 'host') frame.current?.contentWindow?.postMessage(event.data.data, '*');
    };
    const receive = (event: MessageEvent) => { if (event.source === frame.current?.contentWindow) link.postMessage({ kind: 'command', data: event.data }); };
    const close = () => link.postMessage({ kind: 'closed' });
    window.addEventListener('message', receive); window.addEventListener('beforeunload', close);
    link.postMessage({ kind: 'connect' });
    return () => { window.removeEventListener('message', receive); window.removeEventListener('beforeunload', close); link.close(); channel.current = null; };
  }, []);
  return <main style={{ width: '100vw', height: '100dvh', background: '#101a27' }}>
    {content ? <iframe ref={frame} title="模组独立舞台" sandbox="allow-scripts" srcDoc={document} style={{ width: '100%', height: '100%', border: 0 }} onLoad={() => frame.current?.contentWindow?.postMessage({ channel: 'eidos-mod-host-ready', token: content.token }, '*')} /> : <p>正在连接模组舞台…</p>}
  </main>;
}
