"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import type { StorySegment } from "@/lib/ai/types";
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useDialogueHeight } from './use-dialogue-height';
import {
  type MidoriAssetRegistry,
} from "@/lib/game/midori/asset-registry";
import { useGameStore } from "@/store/game-store";
import { segmentKaomoji } from "@/lib/game/kaomoji";
import { cuesForTarget } from '@/lib/game/presentation';
import { NarrativeText } from './NarrativeText';
import { characterAssetId } from '@/lib/game/midori/character-target';
import { selectDialogueImageResource } from '@/lib/game/midori/image-selection';
import type { WorldDefinition } from '@/lib/game/types';

interface DialogueReadoutProps {
  passageKey?: string; playbackKey?:string; animate?:boolean;
  nodeId?: string; segmentIndex?: number; originId?:string;
  sourceComplete?: boolean;
  currentSegment: StorySegment | null;
  displayedText: string;
  sceneName: string;
  hasSceneImage: boolean;
  hideNarration?: boolean;
  onAdvance?: () => void;
  onReplay?: () => void;
}

interface DialogueReadoutModel {
  tone: "dialogue" | "narration";
  label: string;
  speakerName: string;
  text: string;
  imageUrl: string | null;
}

interface DialogueReadoutModelInput extends DialogueReadoutProps {
  assetRegistry?: MidoriAssetRegistry | null;
  worldId?: string;
  world?: Pick<WorldDefinition, 'npcs'> | null;
}

export function buildDialogueReadoutModel({
  currentSegment,
  displayedText,
  hideNarration = true,
  assetRegistry,
  worldId,
  world,
}: DialogueReadoutModelInput): DialogueReadoutModel | null {
  if (!currentSegment) return null;

  const isDialogue = currentSegment.type === "dialogue";
  if (!isDialogue && hideNarration) return null;

  const speakerName = isDialogue
    ? currentSegment.speaker || "NPC"
    : "";
  const tone = isDialogue ? "dialogue" : "narration";
  const text = (displayedText || currentSegment.text || "");
  const avatarAsset = isDialogue && assetRegistry
    ? selectDialogueImageResource(assetRegistry, {
        worldId,
        targetId: characterAssetId(world, speakerName),
        emotion: currentSegment.emotion, imageId: currentSegment.imageId,
        expressionTags: currentSegment.expressionTags, imagePath: currentSegment.imagePath,
      })
    : null;

  return {
    tone,
    label: isDialogue ? "DIALOGUE / CHARACTER FEED" : "NARRATION / SCENE FEED",
    speakerName,
    text: text || "……",
    imageUrl: avatarAsset?.imageUrl ?? null,
  };
}

export function DialogueReadout({
  passageKey, nodeId, segmentIndex, playbackKey, animate, originId,
  sourceComplete,
  currentSegment,
  displayedText,
  sceneName,
  hasSceneImage,
  hideNarration,
  onAdvance,
  onReplay,
}: DialogueReadoutProps) {
  const ui = useInterfaceText();
  const nodes=useGameStore(s=>s.allNodes),origin=useGameStore(s=>s.currentNode?.id);
  const native=useGameStore(s=>s.currentWorld?.gameplayPlugins?.some(p=>p.ui?.presentation==='native-text'));
  const hiddenSpeaker=native && (currentSegment?.textEffects?.some(e=>e.target==='speaker' && ['mask','erase','garble','replace'].includes(e.kind)) || cuesForTarget(nodes,originId ?? origin,nodeId ?? origin ?? '').some(c=>c.active && c.field==='speaker' && (segmentIndex===undefined || c.segment===segmentIndex) && ['mask','erase','garble','replace'].includes(c.effect.kind)));
  const assetRegistry = useGameStore((s) => s.midoriAssetRegistry);
  const world = useGameStore(s => s.currentWorld);
  const model = buildDialogueReadoutModel({
    currentSegment,
    displayedText,
    sceneName,
    hasSceneImage,
    hideNarration,
    assetRegistry,
    worldId: world?.id,
    world,
  });
  const readoutRef = useRef<HTMLElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const pointer = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const height = useDialogueHeight(readoutRef);
  const [imageShape, setImageShape] = useState<{ url: string; ratio: number } | null>(null);
  const visible = Boolean(model);
  useEffect(() => {
    const readout = readoutRef.current;
    const stage = readout?.closest<HTMLElement>('[data-story-stage]');
    if (!readout || !stage || typeof ResizeObserver === 'undefined') return;
    // HUDs and record positioning share the player's chosen height.
    const measure = () => {
      stage.style.setProperty('--eidos-dialogue-height', `${readout.getBoundingClientRect().height}px`);
      stage.dispatchEvent(new Event('eidos-dialogue-resize'));
    };
    const observer = new ResizeObserver(measure);
    measure(); observer.observe(readout);
    return () => { observer.disconnect(); stage.style.removeProperty('--eidos-dialogue-height'); stage.dispatchEvent(new Event('eidos-dialogue-resize')); };
  }, [visible]);

  const scrollProgress = useRef<{ key?: string; height: number } | null>(null);
  useEffect(() => {
    const readout = textRef.current;
    if (!readout) return;
    const previous = scrollProgress.current;
    // Follow speech while typing, but preserve an intentional scroll back or text selection.
    if (!previous || previous.key !== passageKey) readout.scrollTop = 0;
    else if (animate !== false && previous.height - readout.scrollTop - readout.clientHeight < 24 && !window.getSelection()?.toString()) readout.scrollTop = readout.scrollHeight;
    scrollProgress.current = { key: passageKey, height: readout.scrollHeight };
  }, [displayedText, passageKey, visible, animate]);

  if (!model) return null;

  return (
    <section
      ref={readoutRef}
      aria-label={ui("当前对话读条")}
      className={`eidos-dialogue-readout is-${model.tone}`}
      style={{ ...height.style, '--eidos-dialogue-image-ratio': imageShape?.url === model.imageUrl ? imageShape.ratio : 1 } as CSSProperties}
      onClick={event => {
        event.stopPropagation();
        if (pointer.current?.moved || window.getSelection()?.toString()) return;
        if ((event.target as Element).closest('button, a, input, textarea, select, [role="separator"]')) return;
        onAdvance?.();
      }}
      onDoubleClick={event => event.stopPropagation()}
      onPointerDown={event => { event.stopPropagation(); pointer.current = { x: event.clientX, y: event.clientY, moved: false }; }}
      onPointerMove={event => { if (pointer.current && Math.hypot(event.clientX - pointer.current.x, event.clientY - pointer.current.y) > 6) pointer.current.moved = true; }}
    >
      <div {...height.handle} className="eidos-dialogue-readout__resizer" title={ui("拖动调整对话框高度，或使用上下方向键")} />
      <div className="eidos-dialogue-readout__copy">
        <div className="eidos-dialogue-readout__label">{ui(model.label)}</div>
        {model.tone === "dialogue" && <h2 className="eidos-dialogue-readout__speaker"><button type="button" className="eidos-focus pointer-events-auto" onClick={onReplay} title={ui("重播当前对话")}><NarrativeText originId={originId} playbackKey={playbackKey} animate={animate} nodeId={nodeId} segmentIndex={segmentIndex} occurrence={passageKey} text={model.speakerName} effects={currentSegment?.textEffects} target="speaker" /></button></h2>}
        <p ref={textRef} data-reading-text data-reading-dialogue={model.tone === 'dialogue' ? '' : undefined} className="eidos-dialogue-readout__text pointer-events-auto select-text">
          {model.tone === 'dialogue' && '「'}<NarrativeText originId={originId} playbackKey={playbackKey} animate={animate} nodeId={nodeId} segmentIndex={segmentIndex} occurrence={passageKey} sourceComplete={sourceComplete} text={currentSegment?.textEffects?.length && !displayedText ? "" : model.text} searchSources={currentSegment?.searchSources} source={currentSegment?.text} effects={currentSegment?.textEffects} />{model.tone === 'dialogue' && '」'}
        </p>
      </div>
      {model.tone === 'dialogue' && <div className="eidos-dialogue-readout__avatar" aria-label={hiddenSpeaker ? ui("人物头像") : ui("{0} 头像", {"0": model.speakerName})}>
        {model.imageUrl ? (
          <img src={model.imageUrl} alt={hiddenSpeaker ? ui("人物头像") : model.speakerName} onLoad={event => {
            const image = event.currentTarget;
            if (image.naturalHeight) setImageShape({ url: model.imageUrl!, ratio: image.naturalWidth / image.naturalHeight });
          }} />
        ) : (
          <DialogueAvatarPlaceholder name={hiddenSpeaker ? "" : model.speakerName} tone={model.tone} expression={segmentKaomoji(currentSegment)} />
        )}
      </div>}
    </section>
  );
}

function DialogueAvatarPlaceholder({
  name,
  tone,
  expression,
}: {
  name: string;
  tone: "dialogue" | "narration";
  expression: string;
}) {
  const ui = useInterfaceText();
  return (
    <div className={`eidos-dialogue-avatar-placeholder is-${tone}`}>
      {expression ? <div className="eidos-dialogue-avatar-expression" aria-label={ui("人物表情")}>{expression}</div> : <span className="eidos-dialogue-avatar-placeholder__name">{name}</span>}
      <span className="eidos-dialogue-avatar-placeholder__bar" />
      <span className="eidos-dialogue-avatar-placeholder__circle" />
      <span className="eidos-dialogue-avatar-placeholder__square" />
      <span className="eidos-dialogue-avatar-placeholder__line" />
    </div>
  );
}
