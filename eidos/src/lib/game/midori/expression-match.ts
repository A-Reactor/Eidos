import type { ImageResource } from './image-resource';
import { expressionTags, imageTag } from './image-tags';

const synonyms = [
  ['平静', '冷静', '平常'], ['开心', '高兴', '快乐', '愉快', '欣喜'], ['悲伤', '伤心', '难过', '低落'],
  ['生气', '愤怒', '恼怒'], ['惊讶', '吃惊', '震惊'], ['思考', '沉思', '若有所思'],
  ['担忧', '担心', '忧虑', '焦虑'], ['微笑', '含笑', '笑眯眯', 'smile'],
];
const normalized = (text: string) => text.normalize('NFKC').toLocaleLowerCase();
function keywordPattern(keyword: string): RegExp {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Numeric/custom suffixes are identities: 猫猫脸 must not accidentally select 猫猫脸2.
  const boundary = '\\p{Script=Latin}\\p{N}_';
  return new RegExp(`(^|[^${boundary}])${escaped}(?=$|[^${boundary}])`, 'u');
}

/** Local lexical retrieval; exact album tags outweigh synonyms and descriptive keywords. */
export function expressionMatcher(value: unknown): (image: ImageResource) => number {
  const terms = expressionTags(value).map(tag => {
    const keyword = normalized(tag), group = synonyms.find(group => group.includes(keyword));
    return { keyword, pattern: keywordPattern(keyword), related: group?.filter(other => other !== keyword) ?? [] };
  });
  if (!terms.length) return () => 0;
  return image => {
    const tags = image.tags.map(tag => normalized(imageTag(tag))), label = normalized(image.label), description = normalized(image.description);
    return terms.reduce((score, { keyword, pattern, related }) => score + (tags.includes(keyword) ? 100
      : related.some(term => tags.includes(term)) ? 60 : pattern.test(label) ? 24 : pattern.test(description) ? 8 : 0), 0);
  };
}
