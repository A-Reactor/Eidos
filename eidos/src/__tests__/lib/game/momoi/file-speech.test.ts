import { expect, it } from 'vitest';
import { extractSpokenDialogue } from '@/lib/game/momoi/spoken-text';
import { buildVoiceRequest, DEFAULT_VOICE_CONFIG } from '@/lib/game/momoi/model';

it.each([
 ['查看[0-100偶数.txt](document:ref_note)，然后继续。', '查看0-100偶数，然后继续。'],
 ['打开[资料/测试_报告-v2.md](document://abc/material_0123456789abcdef)。', '打开测试 报告-v2。'],
 ['参考[报告_550e8400-e29b-41d4-a716-446655440000.txt](document:report)。', '参考报告。'],
 ['这是[📎___💾.json](document:file)。', '这是文件。'],
 ['看[记录_2026-11-05.md](document:note)。', '看记录 2026-11-05。'],
 ['看[调查结果](https://example.com/long?id=1)和![现场](images/a.png)。', '看调查结果和现场。'],
 ['打开 `资料/调查_记录.md`，**仔细**核对。', '打开 调查 记录，仔细核对。'],
 ['# 结果\n已完成。\n```json\n{"secret":"文件内容"}\n```\n继续。', '结果\n已完成。\n继续。'],
 ['读取 document://abc/material_0123456789abcdef 后继续。', '读取 后继续。'],
 ['<b>明天</b>&amp;今晚，输入 foo_bar 和 1+2。', '明天&今晚，输入 foo_bar 和 1+2。'],
])('prepares file and formatted speech from %s', (text, expected) => {
 expect(extractSpokenDialogue(text)).toBe(expected);
 expect(extractSpokenDialogue(expected)).toBe(expected);
 expect(buildVoiceRequest({type:'dialogue',speaker:'Alice',text},DEFAULT_VOICE_CONFIG)?.text).toBe(expected);
});
