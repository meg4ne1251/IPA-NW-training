export type WrittenSection = 'B-1' | 'B-2';
export type Assessment = 'good' | 'partial' | 'review';
export const assessmentLabels: Record<Assessment, string> = { good: 'できた', partial: '一部できた', review: '要復習' };
export interface WrittenSlot { id: string; label: string; limit?: number; example?: string }
export interface WrittenQuestion {
  id: string; version: number; year: number; season: string; section: WrittenSection; number: number;
  title: string; tags: string[]; minutes: number; pages: number[]; questionPages: number[];
  source: { label: string; url: string; localPdf: string; answerUrl?: string; commentUrl?: string; localAnswer?: string; localComment?: string };
  guide?: string[]; slots: WrittenSlot[];
}
export interface WrittenSession {
  id: string; question: WrittenQuestion; status: 'writing' | 'reviewing' | 'completed'; revision: number;
  startedAt: string; updatedAt: string; revealedAt?: string; completedAt?: string;
  answers: Record<string, string>; assessments: Record<string, Assessment>; notes: string; page: number;
}
export type WrittenDraft = Pick<WrittenSession, 'revision' | 'answers' | 'assessments' | 'notes' | 'page'>;
export interface WrittenSummary {
  id: string; questionId: string; title: string; section: WrittenSection; number: number; year: number;
  status: WrittenSession['status']; startedAt: string; updatedAt: string; answered: number; total: number;
  good: number; partial: number; review: number;
}
export type WrittenCatalog = Pick<WrittenQuestion, 'id' | 'year' | 'season' | 'section' | 'number' | 'title' | 'tags' | 'minutes'> & { slotCount: number };
export interface WrittenDashboard { questions: WrittenCatalog[]; sessions: WrittenSummary[] }
export const characterCount = (text: string) => Array.from(text.replace(/\r?\n/g, '')).length;
