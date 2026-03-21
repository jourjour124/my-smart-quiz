import { Subject } from './types';

export const SUBJECTS: { id: Subject; name: string; color: string }[] = [
  { id: 'Chinese', name: '语文', color: 'bg-red-500' },
  { id: 'English', name: '英语', color: 'bg-blue-500' },
  { id: 'History', name: '历史', color: 'bg-amber-600' },
  { id: 'Biology', name: '生物', color: 'bg-green-500' },
  { id: 'Geography', name: '地理', color: 'bg-cyan-500' },
  { id: 'Ethics', name: '道法', color: 'bg-purple-500' },
];

export const MAX_QUESTIONS = 20;
export const QUESTION_TIME_LIMIT = 60; // 每题 60 秒
export const QUIZ_TIME_LIMIT = 1200; // 整个测验 20 分钟