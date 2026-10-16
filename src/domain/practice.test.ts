import { describe, expect, it } from 'vitest';
import { generatePractice, grade, questions } from './practice';
describe('演習の生成と採点', () => {
  it('元のバンクを変えずに重複のない問題を生成する', () => {
    const original = questions.map(q => q.id);
    const result = generatePractice(questions, 2, () => 0);
    expect(result).toHaveLength(2);
    expect(new Set(result.map(q => q.id)).size).toBe(2);
    expect(questions.map(q => q.id)).toEqual(original);
  });
  it('不足する問題数や不正な指定を拒否する', () => {
    for (const count of [0, -1, 1.5, 4]) expect(() => generatePractice(questions, count)).toThrow(RangeError);
  });
  it('正答だけを加点し、誤答と未回答は加点しない', () => {
    expect(grade(questions, { 'subnet-01': 1, 'dns-01': 0 })).toBe(1);
    expect(grade(questions, {})).toBe(0);
  });
});
