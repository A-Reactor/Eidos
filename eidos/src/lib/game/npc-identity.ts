import { normalizeNpcDescription } from './npc-description';

/** 职业只能从本人身份陈述推断；见闻、亲属职业和否定句不能替人物定身份。 */
export function npcIdentityText(description: unknown, name: string): string {
  if (description && typeof description === 'object' && !Array.isArray(description)) {
    const record = description as Record<string, unknown>;
    const roles = ['role', 'occupation', 'profession', 'title']
      .map(key => record[key])
      .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()));
    if (roles.length) return `${name} ${roles.join(' ')}`;
    // 结构化资料的姓名可能排在说明前，不能用扁平化后的首字段代替身份介绍。
    if (typeof record.description === 'string') return npcIdentityText(record.description, name);
  }
  const clauses = normalizeNpcDescription(description, name).split(/[。！？.!?\n；;，,：:]/u);
  const evidence = clauses.flatMap((raw, index) => {
    // 允许身份出现在后句，同时排除亲属主语。“而是”后面可以有正面的身份更正。
    const clause = raw.trim().split('而是').at(-1) ?? '';
    if (/^(?:(?:他|她|其|自己|.+?)的)?(?:父亲|母亲|父母|家人|朋友|邻居|老师|姐姐|妹妹|哥哥|弟弟|妻子|丈夫|儿子|女儿)/u.test(clause)) return [];
    if (/(?:不是|并非|不再是|从未当过|从未做过)/u.test(clause)) return [];
    if (index === 0) return [clause];
    const selfIdentification = /^(?:(?:他|她|它|本人|如今|现在|目前|原来|原本|曾经|仍然)\s*)*(?:是|为|曾任|现任|现为|担任|任职|当|经营|开着|在.+?(?:当|做|任职|担任|从事))/u;
    const namedIdentification = clause.startsWith(name) && /(?:是|担任|任职|当|经营)/u.test(clause.slice(name.length));
    return selfIdentification.test(clause) || namedIdentification ? [clause] : [];
  });
  return `${name} ${evidence.join(' ')}`;
}
