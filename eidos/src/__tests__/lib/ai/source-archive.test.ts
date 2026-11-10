import { describe, expect, it } from "vitest";

import {
  chunkSourceDocument,
  createSourceCorpus,
  isCanonLedger,
  isEvidenceAtom,
  isSourceCorpus,
  summarizeCanonLedger,
} from "@/lib/ai/source-archive";
import type { CanonLedger } from "@/lib/ai/source-archive";

describe("source archive local tools", () => {
  it("chunks source text while preserving source spans", () => {
    const doc = {
      id: "src_1",
      title: "第一章",
      kind: "pasted_text" as const,
      content: "甲".repeat(3200),
      createdAt: 1,
    };

    const chunks = chunkSourceDocument(doc, {
      targetSize: 1200,
      maxSize: 1600,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toMatchObject({ sourceId: "src_1", start: 0 });
    expect(doc.content.slice(chunks[0].start, chunks[0].end)).toBe(chunks[0].text);
    expect(chunks.every((chunk) => chunk.end > chunk.start)).toBe(true);
  });

  it("prefers paragraph boundaries when chunking", () => {
    const doc = {
      id: "src_1",
      title: "设定",
      kind: "pasted_text" as const,
      content: `${"甲".repeat(900)}\n\n${"乙".repeat(900)}\n\n${"丙".repeat(900)}`,
      createdAt: 1,
    };

    const chunks = chunkSourceDocument(doc, {
      targetSize: 1000,
      maxSize: 1400,
    });

    expect(chunks.length).toBe(3);
    expect(chunks[0].text.endsWith("甲")).toBe(true);
    expect(chunks[1].text.startsWith("乙")).toBe(true);
  });

  it("rejects evidence atoms without a source id", () => {
    expect(
      isEvidenceAtom({
        id: "ev_1",
        category: "character",
        claim: "A exists",
        entities: [],
        confidence: 80,
      }),
    ).toBe(false);
  });

  it("accepts evidence atoms with valid source metadata", () => {
    expect(
      isEvidenceAtom({
        id: "ev_1",
        sourceId: "src_001",
        category: "character",
        claim: "林是调查员",
        entities: ["林"],
        confidence: 80,
        sourceSpan: { start: 0, end: 5, excerpt: "林是调查员" },
      }),
    ).toBe(true);
  });

  it("creates a corpus with stable document ids", () => {
    const corpus = createSourceCorpus(
      [{ title: "设定", content: "城市建立在裂隙边缘。" }],
      100,
    );

    expect(corpus.documents[0]).toMatchObject({
      id: "src_001",
      title: "设定",
      kind: "pasted_text",
    });
    expect(corpus.createdAt).toBe(100);
  });

  it("guards source corpus payloads before API reuse", () => {
    expect(
      isSourceCorpus({
        id: "corpus_1",
        language: "zh-CN",
        createdAt: 1,
        documents: [
          {
            id: "src_001",
            title: "设定",
            kind: "pasted_text",
            content: "城市建立在裂隙边缘。",
            createdAt: 1,
          },
        ],
      }),
    ).toBe(true);

    expect(isSourceCorpus({ id: "corpus_1", documents: [] })).toBe(false);
  });

  it("summarizes ledger coverage for UI", () => {
    const ledger = {
      id: "ledger_1",
      title: "档案",
      summary: "",
      entities: [
        {
          id: "ent_1",
          name: "林",
          type: "character",
          description: "",
          status: "source_confirmed",
          evidenceRefs: ["ev_1"],
        },
        {
          id: "ent_2",
          name: "裂隙广场",
          type: "place",
          description: "",
          status: "source_confirmed",
          evidenceRefs: ["ev_2"],
        },
      ],
      relationships: [],
      events: [{ id: "evt_1", title: "裂隙出现", description: "", order: 1, status: "source_confirmed", evidenceRefs: ["ev_3"], involvedEntities: [] }],
      worldRules: [],
      unresolvedQuestions: [
        {
          id: "unk_1",
          question: "城市为何沉没？",
          relatedEntities: [],
          evidenceRefs: [],
        },
      ],
      contradictions: [],
      sourceCoverage: {
        documentCount: 1,
        evidenceCount: 3,
        highConfidenceCount: 2,
      },
    } satisfies CanonLedger;

    expect(summarizeCanonLedger(ledger)).toEqual({
      characters: 1,
      places: 1,
      events: 1,
      unknowns: 1,
      evidence: 3,
    });
  });

  it("guards canon ledgers before they enter world creation", () => {
    expect(
      isCanonLedger({
        id: "ledger_1",
        title: "档案",
        summary: "摘要",
        entities: [],
        relationships: [],
        events: [],
        worldRules: [],
        unresolvedQuestions: [],
        contradictions: [],
        sourceCoverage: {
          documentCount: 1,
          evidenceCount: 0,
          highConfidenceCount: 0,
        },
      }),
    ).toBe(true);

    expect(isCanonLedger({ id: "ledger_1", title: "档案" })).toBe(false);
  });
});
