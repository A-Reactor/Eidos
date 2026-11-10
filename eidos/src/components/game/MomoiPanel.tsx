"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useGameStore } from "@/store/game-store";
import { ArchiveScreen } from '@/components/ui/ArchiveScreen';
import { ResponsiveSidebar } from '@/components/ui/ResponsiveSidebar';
import { BackButton } from '@/components/ui/BackButton';
import { VoiceConnection } from "./momoi/VoiceConnection";
import { VoiceResources } from "./momoi/VoiceResources";
import { VoiceQueue } from "./momoi/VoiceQueue";
import { VoicePlayback } from './momoi/VoicePlayback';
import { VoiceTrainingWorkspace } from './momoi/VoiceTraining';
import { VoiceInstallationCheck, VoiceInstallationProvider } from './momoi/VoiceInstallation';
import { getVoiceLibrary, voiceScope } from "@/lib/game/momoi/runtime";
import type { StorySegment } from "@/lib/ai/types";
import { useVoiceServiceMonitor } from "@/lib/game/momoi/service-status";

const sections = [
  { id: 'reading', label: '播放与语言', description: '播放习惯、音量和配音语言。' },
  { id: 'connection', label: '模型与音色', description: '连接服务，为默认音色或角色选择模型与参考录音。' },
  { id: 'training', label: '训练音色', description: '导入录音，校对后训练，试听满意再应用。' },
  { id: 'resources', label: '音频资源', description: '当前周目的对话录音。' },
  { id: 'installation', label: '安装检查', description: '查看模型与语言支持，处理缺失项。' },
] as const;
type AudioPage = typeof sections[number]['id'];
const groups = [{ label: '使用与配置', ids: ['reading', 'connection'] }, { label: '制作与管理', ids: ['training', 'resources'] }, { label: '环境', ids: ['installation'] }];

export function MomoiPanel({ open, onClose, segments }: { open: boolean; onClose: () => void; segments?: StorySegment[] }) {
  // A generation session changes when language changes; it must not erase form drafts or navigation.
  const scope = useGameStore(voiceScope);
  return open ? <VoiceInstallationProvider key={scope}><VoicePanel onClose={onClose} segments={segments} /></VoiceInstallationProvider> : null;
}
export function AudioScreen() {
  return <MomoiPanel open onClose={() => useGameStore.getState().goBack()} />;
}
function VoicePanel({ onClose, segments }: { onClose: () => void; segments?: StorySegment[] }) {
  const ui = useInterfaceText();
  const savedSegments = useGameStore(state => state.savedSegments);
  const session = useGameStore(state => state.voiceSession);
  const error = useGameStore(state => state.voiceError);
  const [page, setPage] = useState<AudioPage>('reading');
  const [speaker, setSpeaker] = useState('');
  const [trainingVisited, setTrainingVisited] = useState(false);
  const main = useRef<HTMLElement>(null);
  useLayoutEffect(() => { if (main.current) main.current.scrollTop = 0; }, [page]);
  const section = sections.find(section => section.id === page)!;
  useVoiceServiceMonitor(true);
  useEffect(() => {
    let active = true;
    void getVoiceLibrary().catch(error => { if (active) useGameStore.setState({ voiceError: error instanceof Error ? error.message : ui("音频资源读取失败") }); });
    return () => { active = false; };
  }, [ui, session]);
  function navigate(next: AudioPage) {
    if (next === 'training') setTrainingVisited(true);
    setPage(next);
  }
  return <ArchiveScreen directoryFirst className="eidos-settings-screen eidos-audio-screen" title={ui("音频管理")} label={ui("音频管理")} subtitle={ui("播放、音色与录音。设置即时生效。")} onBack={onClose} action={<BackButton label={ui("返回上一级")} onClick={onClose} />}>
    <div className="eidos-settings-layout">
      <ResponsiveSidebar as="nav" label={ui("音频管理分类")} current={ui(section.label)} className="eidos-settings-nav">
        {groups.map(group => <div key={group.label} role="group" aria-label={ui(group.label)} className="eidos-settings-nav-group">
          <p className="eidos-settings-nav-label">{ui(group.label)}</p>
          {sections.filter(section => group.ids.includes(section.id)).map(section => <button type="button" key={section.id} className="eidos-focus eidos-settings-category" aria-current={page === section.id ? 'page' : undefined} onClick={() => navigate(section.id)}>{ui(section.label)}</button>)}
        </div>)}
      </ResponsiveSidebar>
      <main ref={main} className="eidos-settings-main" aria-label={ui(section.label)} data-audio-page={page}>
        <div className="eidos-settings-main-inner eidos-settings-page">
          <h2>{ui(section.label)}</h2><p className="eidos-settings-description">{ui(section.description ?? '')}</p>
          <VoiceQueue />
          {error && <p role="alert" className="eidos-audio-notice">{error}</p>}
          {page === 'reading' && <VoicePlayback onModels={() => navigate('connection')} onInstallation={() => navigate('installation')} />}
          {page === 'connection' && <VoiceConnection speaker={speaker} onSpeakerChange={setSpeaker} onInstallation={() => navigate('installation')} />}
          {/* Keep in-progress imports and transcript edits when consulting another category. */}
          {trainingVisited && <div hidden={page !== 'training'}><VoiceTrainingWorkspace speaker={speaker} onSpeakerChange={setSpeaker} onModels={() => navigate('connection')} active={page === 'training'} /></div>}
          {page === 'resources' && <VoiceResources segments={segments ?? savedSegments} />}
          {page === 'installation' && <VoiceInstallationCheck />}
        </div>
      </main>
    </div>
  </ArchiveScreen>;
}
export default MomoiPanel;
