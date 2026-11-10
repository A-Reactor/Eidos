'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import type { GameplayPlugin } from '@/lib/game/plugins/types';
import type { GlobalPlugin } from '@/lib/game/global-plugins/types';
import { PLUGIN_IMPACTS, pluginImpactSummary } from '@/lib/game/plugins/introduction';

export function PluginIntroduction({ plugin }: { plugin: GameplayPlugin | GlobalPlugin }) {
  const ui = useInterfaceText();
  const info = plugin.introduction ?? { impacts: [], images: [] }, impact = pluginImpactSummary(plugin);
  return <section className="eidos-plugin-introduction space-y-3 my-4" aria-label={ui("{0}影响范围与图片", {"0": plugin.name})}>
    <p className="text-xs leading-6">{ui("插件类型 ·")}{plugin.format === 'eidos-gameplay-plugin' ? ui("世界模组（随世界版本保存）") : ui("全局插件（跨世界）")}</p>
    <p className="text-xs leading-6">{ui("功能范围 ·")}{impact.detected.map(key => PLUGIN_IMPACTS[key]).join(ui("、")) || ui("未声明固定界面或规则变化")}{impact.script ? ui("；含应用脚本，可修改界面与应用逻辑") : ''}</p>
    {impact.declared.length > 0 && <p className="text-xs leading-6 opacity-70">{ui("作者补充标注 ·")}{impact.declared.map(key => PLUGIN_IMPACTS[key]).join(ui("、"))}</p>}
    <p className="text-xs leading-6 opacity-60">{ui("功能范围仅作说明，安装时使用完整插件。")}</p>
    {info.images.length > 0 && <div className="grid gap-3 sm:grid-cols-2">{info.images.map((image, index) => <figure key={`${index}:${image.alt}`} className="min-w-0 border border-current/15 p-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- Embedded user images need no remote optimizer. */}
      <img src={image.src} alt={image.alt} className="w-full max-h-64 object-contain" loading="lazy" /><figcaption className="mt-2 text-xs break-words opacity-65">{image.alt}</figcaption>
    </figure>)}</div>}
  </section>;
}
