import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();

describe("development server configuration", () => {
  it("uses webpack dev server instead of Turbopack by default", () => {
    const pkg = JSON.parse(
      readFileSync(join(projectRoot, "package.json"), "utf-8"),
    ) as { scripts?: Record<string, string> };

    expect(pkg.scripts?.dev).toContain("--webpack");
    expect(pkg.scripts?.dev).not.toContain("--turbo");
  });

  it("keeps Tauri dev mode routed through the guarded npm dev script", () => {
    const tauriConfig = JSON.parse(
      readFileSync(join(projectRoot, "src-tauri", "tauri.conf.json"), "utf-8"),
    ) as { build?: { beforeDevCommand?: string } };

    expect(tauriConfig.build?.beforeDevCommand).toBe("npm run dev");
  });
});
