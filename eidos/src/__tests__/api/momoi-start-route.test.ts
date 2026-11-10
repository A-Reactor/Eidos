import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("MOMOI start route", () => {
  it("does not statically trace parent workspace directories", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/api/momoi/start/route.ts"),
      "utf-8",
    );

    expect(source).not.toMatch(/path\.join\(\s*process\.cwd\(\)\s*,\s*["']\.\.["']/);
  });
});
