((g) => {
  const P = g.Palimpsest;
  const line = (id, text, speaker) => ({ id, text, ...(speaker ? { speaker } : {}) });
  const choice = (id, label, to) => ({ id, label, to });
  P.sample = () => P.validate({ format: 'eidos-stage-script', version: 1, id: 'the-name-in-the-margin', title: '空白剧场 · 被删去的名字', start: 'threshold', nodes: [
    { id: 'threshold', title: '第一幕 · 借来的座位', lines: [line('seat', '空白剧场只剩下一张留给你的椅子。'), line('voice', '你坐下以后，我才能继续说话。', '澄')], cues: [{ kind: 'aside', target: 'voice', text: '页边还有一行小字：请先记住说话的人。' }], choices: [choice('enter', '听她把这段话说完', 'rehearsal')] },
    { id: 'rehearsal', title: '第二幕 · 字迹正在换手', lines: [line('promise', '明天，澄会在剧场等你。'), line('name', '她叫澄。'), line('reply', '如果我的名字消失了，你还会知道是谁在等你吗？', '澄')], cues: [
      { kind: 'replace', target: 'promise', text: '明天，■■会在剧场等你。' }, { kind: 'erase', target: 'name' },
      { kind: 'fracture', target: 'reply' }, { kind: 'relabel', target: 'remember', text: '忘了她的名字' },
      { kind: 'aside', target: 'reply', text: '澄：我碰得到这一页的字，却碰不到你替我作的决定。核对按钮原文，再选择。' },
    ], choices: [choice('remember', '记住她的名字', 'intrusion'), choice('question', '询问是谁改了这些字', 'intrusion')] },
    { id: 'intrusion', title: '第三幕 · 谁来写最后一行', lines: [line('admit', '前面的删改是我做的。我想知道，你会相信眼前的字，还是曾经读过的那个人。', '澄'), line('cost', '但我不能要求你永远留在这里。现在，把我的名字交还给我，或者带它出去。', '澄'), line('letter', '署名信：我叫澄。我曾在空白剧场，等过一个愿意核对原文的人。')], cues: [{ kind: 'aside', target: 'letter', text: '这一封信已经写在本页。可以把它保存到工作区，显式寄出；另一分支只有收取后才会得到它。' }], choices: [choice('keep', '带走署名信，替她保留见证', 'signature'), choice('return', '把署名权交还给她，然后离开', 'margin'), choice('erase', '让最后一页保持空白', 'blank')] },
    { id: 'signature', title: '终幕 · 有人记得', lines: [line('last', '你没有答应永远留下。你只是把“澄”写在随身的纸上。'), line('reply', '这一次，名字没有替你作出选择。谢谢你。', '澄')], cues: [{ kind: 'aside', target: 'last', text: '保留见证：信可以寄出，但不会自动出现在其他分支。' }], choices: [], ending: 'keep' },
    { id: 'margin', title: '终幕 · 她自己的字', lines: [line('last', '你把笔放回桌面，等她自己落款。'), line('reply', '澄。不是等你的人，不是被你救下的人。只是澄。', '澄')], cues: [{ kind: 'replace', target: 'last', text: '你把笔放回桌面。她在页边签下自己的名字，然后为你打开门。' }], choices: [], ending: 'return' },
    { id: 'blank', title: '终幕 · 仍有空位', lines: [line('last', '你没有替她落款。剧场没有因此崩溃，也没有阻止你离开。'), line('reply', '如果有一天我愿意写下名字，我会先写给自己。', '没有署名的声音')], cues: [{ kind: 'aside', target: 'reply', text: '你留下的是空白，不是对某个人是否存在的判决。' }], choices: [], ending: 'erase' },
  ] });
})(globalThis);
