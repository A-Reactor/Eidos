import type { EncyclopediaEntry, GameTime, WorldLineNode, WorldSnapshot } from './types';
import { findPublicFactQuote, getPlayerVisibleText, getReadingPath } from './player-reading';

export interface DossierSource {
  nodeId: string;
  sceneName: string;
  time: GameTime;
  quote: string;
}
export interface DossierFact { text: string; source: DossierSource }
export interface NpcDossier {
  name: string;
  description?: DossierFact;
  knowledge: DossierFact[];
  contacts: Array<DossierSource & { dialogue: boolean }>;
  related: Array<DossierFact & { name: string; type: string }>;
  note: string;
}
export interface NpcDossierInput {
  nodes: Record<string, WorldLineNode>;
  currentId: string | null;
  entriesByNode: Record<string, EncyclopediaEntry[]>;
  candidateNames?: string[];
  playerName?: string;
}

/** Read only the public knowledge domain: personality and private behavior never enter the view. */
export function getDossierEntries(snapshot: Pick<WorldSnapshot, 'encyclopedia' | 'npcMemory'>): EncyclopediaEntry[] {
  const entries = [...(snapshot.encyclopedia ?? [])];
  for (const record of Object.values(snapshot.npcMemory?.records ?? {})) {
    const known = record.playerKnowledge;
    if (!known) continue;
    entries.push({ id: known.entryId, name: record.name, type: 'npc',
      description: known.description, knowledge: known.knowledge,
      firstEncountered: known.firstEncountered, lastUpdated: known.lastUpdated,
      relatedEntries: known.relatedEntries });
  }
  return entries;
}

export function buildNpcDossiers(input: NpcDossierInput): NpcDossier[] {
  const path = getReadingPath(input.nodes, input.currentId);
  const names = collectNames(path, input);
  const dossiers = names.map(name => createDossier(name, path));
  const publicEntries = collectPublicEntries(path, input.entriesByNode);
  for (const dossier of dossiers) {
    const entry = publicEntries.get(`npc:${dossier.name}`);
    dossier.description = entry?.description;
    dossier.knowledge = entry?.knowledge ?? [];
    dossier.related = [...publicEntries.values()].filter(other => other.type !== 'npc' &&
      dossier.contacts.some(contact => contact.quote.includes(other.name)))
      .flatMap(other => other.description ? [{ ...other.description, name: other.name, type: other.type }] : []);
  }
  return dossiers;
}

function collectNames(path: WorldLineNode[], input: NpcDossierInput): string[] {
  const candidates = new Set(input.candidateNames ?? []);
  for (const node of path) {
    for (const entry of input.entriesByNode[node.id] ?? []) if (entry.type === 'npc') candidates.add(entry.name);
    for (const match of getPlayerVisibleText(node).matchAll(/「([^：\n」]+)：/g)) candidates.add(match[1]);
  }
  return [...candidates].filter(name => name.trim() && !['旁白', '你'].includes(name) && name !== input.playerName &&
    path.some(node => getPlayerVisibleText(node).includes(name)))
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

function createDossier(name: string, path: WorldLineNode[]): NpcDossier {
  const contacts = path.flatMap(node => getPlayerVisibleText(node).split(/\n\n+/)
    .filter(quote => quote.includes(name))
    .map(quote => ({ ...makeSource(node, quote), dialogue: quote.startsWith(`「${name}：`) })));
  let note = '';
  for (const node of path) {
    // An empty override clears an inherited note on this branch.
    if (Object.hasOwn(node.playerNpcNotes ?? {}, name)) note = node.playerNpcNotes![name];
  }
  return { name, contacts, knowledge: [], related: [], note };
}

interface PublicEntry {
  name: string;
  type: string;
  description?: DossierFact;
  knowledge: DossierFact[];
}

function collectPublicEntries(path: WorldLineNode[], entriesByNode: NpcDossierInput['entriesByNode']) {
  const visible = new Map<string, PublicEntry>();
  for (const node of path) {
    const passages = getPlayerVisibleText(node).split(/\n\n+/);
    for (const entry of entriesByNode[node.id] ?? []) updatePublicEntry(node, entry, passages, visible);
  }
  return visible;
}

function updatePublicEntry(node: WorldLineNode, entry: EncyclopediaEntry, passages: string[], visible: Map<string, PublicEntry>) {
  const key = `${entry.type}:${entry.name}`;
  const current = visible.get(key) ?? { name: entry.name, type: entry.type, knowledge: [] };
  // Legacy snapshots may include backstage settings even after the corresponding scene was read.
  const description = findPublicFactQuote(passages, entry.name, entry.description);
  if (description && current.description?.text !== entry.description) {
    current.description = { text: entry.description, source: makeSource(node, description) };
  }
  for (const item of entry.knowledge ?? []) {
    const quote = findPublicFactQuote(passages, entry.name, item.text);
    if (quote && !current.knowledge.some(known => known.text === item.text)) current.knowledge.push({ text: item.text, source: makeSource(node, quote) });
  }
  if (current.description || current.knowledge.length) visible.set(key, current);
}

function makeSource(node: WorldLineNode, quote: string): DossierSource {
  return { nodeId: node.id, sceneName: node.sceneName, time: node.gameTime, quote };
}
export function formatDossierTime(time: GameTime): string {
  return `DAY ${String(time.day).padStart(2, '0')} · ${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}
