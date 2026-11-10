import { createRoot } from 'react-dom/client';
import { AuthorLab } from '@/components/game/AuthorLab';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import type { AuthorRepro } from '@/lib/game/author-repro';
import '@/app/globals.css';

const { world, snapshot } = buildRiftCityStartState();
const initial: AuthorRepro = { format: 'eidos-author-repro-v1', label: '空白实验现场', createdAt: new Date().toISOString(), world: { ...world, gameplayPlugins: [] }, snapshot: { ...snapshot, gameplayModState: undefined }, segments: [{ type: 'narration', text: '导入现场，或选择源码模组开始离线实验。' }] };
const sources = await fetch('/__lab/sources').then(r => r.json()) as string[];
const loadSource = (name: string) => fetch(`/__lab/package?name=${encodeURIComponent(name)}`).then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error); return data; });
const subscribeSource = (fn: (name?: string) => void) => { const receive = (data: { name?: string }) => fn(data.name); import.meta.hot?.on('eidos-lab:changed', receive); return () => import.meta.hot?.off('eidos-lab:changed', receive); };
createRoot(document.getElementById('root')!).render(<AuthorLab initial={initial} sources={sources} loadSource={loadSource} subscribeSource={subscribeSource} />);
