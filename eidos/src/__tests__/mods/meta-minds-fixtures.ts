import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
export interface Cue { kind: 'replace' | 'erase' | 'aside' | 'fracture' | 'relabel'; target: string; text?: string }
export interface StageNode { id: string; title: string; lines: Array<{ id: string; text: string; speaker?: string }>; cues: Cue[]; choices: Array<{ id: string; label: string; to: string }>; ending?: string }
export interface Script { format: string; version: number; id: string; title: string; start: string; nodes: StageNode[] }
export interface StageRun { script: Script; nodeId: string; played: number; history: Array<{ nodeId: string; choice: string; label: string; shown: string }>; log: string[] }
export interface MindActor { id: string; name: string; trust: number; stress: number; withdrew: boolean; helped: boolean; belief: { cause: string; confidence: number; source: string }; received: string[] }
export interface MindRun { turn: number; repair: number; evidence: string[]; publicEvidence: string[]; actors: Record<string, MindActor>; promises: Array<{ actor: string; due: number; outcome: string }>; log: string[]; lastPublic: string[]; status: string; ending?: string }
export interface Operation { state: Record<string, unknown>; summary: string; facts: Record<string, unknown>; segments: Array<{ type: string; text: string }> }
export interface StageApi { sample(): Script; validate(script: Script): Script; parse(text: string): Script; start(script: Script): StageRun; act(run: StageRun, action: Record<string, unknown>): StageRun; view(run: StageRun): { lines: Array<{ id: string; text: string; original: string; aside?: string; fracture?: boolean }>; choices: Array<{ id: string; label: string; original: string }>; complete: boolean; ending?: string }; operation(run: StageRun): Operation; letter(run: StageRun): { format: string; version: number; title: string; scene: string; text: string }; parseLetter(text: string): { text: string } }
export interface MindApi { start(): MindRun; act(run: MindRun, action: Record<string, unknown>): MindRun; view(run: MindRun): { actors: Array<{ id: string; name: string; attitude: string; action: string }>; evidence: string[] }; operation(run: MindRun): Operation }
export function loadMetaMinds() {
  const root: { Palimpsest?: StageApi; SocialMinds?: MindApi } = {};
  for (const [folder, files] of [['palimpsest-stage', ['protocol', 'story', 'engine']], ['social-minds', ['scenario', 'engine']]] as const) {
    for (const file of files) runInNewContext(readFileSync(`mods/${folder}/${file}.js`, 'utf8'), { globalThis: root });
  }
  return { meta: root.Palimpsest!, mind: root.SocialMinds! };
}
