import { describe, expect, it } from "vitest";
import * as route0 from "@/app/api/midori/start/route";
import * as route1 from "@/app/api/midori/startup/route";
import * as route2 from "@/app/api/midori/status/route";
import * as route3 from "@/app/api/midori/stop/route";
import * as route4 from "@/app/api/midori/act-readiness/route";
import * as route5 from "@/app/api/midori/compare/route";
import * as route6 from "@/app/api/midori/generate-image/route";
import * as route7 from "@/app/api/midori/icon/route";
import * as route8 from "@/app/api/midori/examine/route";
import * as route9 from "@/app/api/midori/repaint/route";
import * as route10 from "@/app/api/midori/repaint-all/route";
import * as route11 from "@/app/api/midori/repaint-scene/route";
import * as route12 from "@/app/api/midori/report-missing/route";
import * as route13 from "@/app/api/midori/refine-prompt/route";
import * as route14 from "@/app/api/midori/variations/route";
import * as route15 from "@/app/api/world/create/visual/route";
import * as route16 from "@/app/api/world/create/visual/stream/route";

const legacyRoutes = [
  { name: "midori/start", handlers: route0 },
  { name: "midori/startup", handlers: route1 },
  { name: "midori/status", handlers: route2 },
  { name: "midori/stop", handlers: route3 },
  { name: "midori/act-readiness", handlers: route4 },
  { name: "midori/compare", handlers: route5 },
  { name: "midori/generate-image", handlers: route6 },
  { name: "midori/icon", handlers: route7 },
  { name: "midori/examine", handlers: route8 },
  { name: "midori/repaint", handlers: route9 },
  { name: "midori/repaint-all", handlers: route10 },
  { name: "midori/repaint-scene", handlers: route11 },
  { name: "midori/report-missing", handlers: route12 },
  { name: "midori/refine-prompt", handlers: route13 },
  { name: "midori/variations", handlers: route14 },
  { name: "world/create/visual", handlers: route15 },
  { name: "world/create/visual/stream", handlers: route16 },
];

describe("removed AI image endpoints", () => {
  it.each(legacyRoutes)("$name rejects legacy requests", async ({ handlers }) => {
    for (const handler of Object.values(handlers)) {
      const response = handler();
      expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({ code: "IMAGE_GENERATION_REMOVED" });
    }
  });
});
