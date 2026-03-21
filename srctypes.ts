export type Subject = 'Chinese' | 'English' | 'History' | 'Biology' | 'Geography' | 'Ethics';

export interface FileMetadata {
  id: string;
  name: string;
  subject: Subject;
  url: string;
  type: string;
  uploadedAt: number;
}

export interface Question {
  id: string;
  type: 'multiple-choice' | 'fill-in-the-blank';
  question: string;
  options?: string[]; // For multiple choice
  answer: string;
  explanation?: string;
  subject: Subject;
}

export interface QuizSession {
  id: string;
  userId: string;
  subject: Subject | 'Mixed';
  questions: Question[];
  answers: Record<string, string>; // questionId -> userAnswer
  score: number;
  total: number;
  timestamp: number;
}

export interface UserStats {
  totalScore: number;
  quizCount: number;
  wrongAnswers: WrongAnswerRecord[];
}

export interface WrongAnswerRecord {
  questionId: string;
  questionText: string;
  userAnswer: string;
  correctAnswer: string;
  subject: Subject;
  timestamp: number;
}