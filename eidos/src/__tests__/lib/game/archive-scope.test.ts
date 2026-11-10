// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import {
  CURRENT_ARCHIVE_SCOPE_SESSION_KEY,
  CURRENT_SAVE_SESSION_KEY,
  currentSaveSessionKey,
  readCurrentSaveFromSession,
  writeCurrentSaveToSession,
} from "@/lib/game/archive-scope";

afterEach(() => {
  sessionStorage.clear();
});

describe("archive-scope current save session", () => {
  it("reads the ordinary current save from the ordinary session key", () => {
    writeCurrentSaveToSession({}, "save_ordinary");

    expect(sessionStorage.getItem(CURRENT_ARCHIVE_SCOPE_SESSION_KEY)).toBe("ordinary");
    expect(sessionStorage.getItem(CURRENT_SAVE_SESSION_KEY)).toBe("save_ordinary");
    expect(readCurrentSaveFromSession()).toBe("save_ordinary");
  });

  it("keeps sandbox current saves out of the ordinary current-save key", () => {
    sessionStorage.setItem(CURRENT_SAVE_SESSION_KEY, "save_ordinary");

    writeCurrentSaveToSession({
      sandboxMode: true,
      sandboxDossierId: "002",
    }, "save_sandbox");

    expect(sessionStorage.getItem(CURRENT_SAVE_SESSION_KEY)).toBe("save_ordinary");
    expect(sessionStorage.getItem(currentSaveSessionKey({
      sandboxMode: true,
      sandboxDossierId: "002",
    }))).toBe("save_sandbox");
    expect(readCurrentSaveFromSession()).toBe("save_sandbox");
  });
});
