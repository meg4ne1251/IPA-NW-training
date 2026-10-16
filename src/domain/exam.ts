// 出典・確認日は docs/exam-2026.md を参照。
export const exam2026 = {
  year: 2026, method: 'CBT', verifiedAt: '2026-10-16',
  sections: [
    { id: 'A-1', name: '科目A-1', minutes: 50, questions: 30, answers: 30, format: '四肢択一' },
    { id: 'A-2', name: '科目A-2', minutes: 40, questions: 25, answers: 25, format: '四肢択一' },
    { id: 'B-1', name: '科目B-1', minutes: 90, questions: 3, answers: 2, format: '記述式' },
    { id: 'B-2', name: '科目B-2', minutes: 120, questions: 2, answers: 1, format: '記述式' },
  ],
} as const;
