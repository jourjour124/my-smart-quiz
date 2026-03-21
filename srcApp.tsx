import React, { useState, useEffect } from 'react';
import { 
  BookOpen, 
  FileText, 
  Trophy, 
  Settings, 
  Plus, 
  Trash2, 
  ChevronRight, 
  CheckCircle2, 
  XCircle, 
  BarChart3,
  History,
  LayoutGrid,
  Upload,
  BrainCircuit,
  ArrowLeft,
  RotateCcw,
  AlertCircle,
  Clock,
  Timer
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import { SUBJECTS, MAX_QUESTIONS, QUESTION_TIME_LIMIT, QUIZ_TIME_LIMIT } from './constants';
type View = 'dashboard' | 'quiz' | 'files' | 'stats' | 'review' | 'results';
type Subject = 'Chinese' | 'English' | 'History' | 'Biology' | 'Geography' | 'Ethics';

interface Question {
  id: string;
  type: 'multiple-choice' | 'fill-in-the-blank';
  question: string;
  options?: string[];
  answer: string;
  explanation?: string;
  subject: string;
}

interface QuizResult {
  score: number;
  total: number;
  wrongAnswers: {
    questionText: string;
    userAnswer: string;
    correctAnswer: string;
    subject: string;
  }[];
}

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

import FileManager from './components/FileManager';

export default function App() {
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [selectedSubject, setSelectedSubject] = useState<Subject | 'Mixed' | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [quizResult, setQuizResult] = useState<QuizResult | null>(null);
  const [stats, setStats] = useState<{ scores: any[], wrongAnswers: any[], fileCounts: Record<string, number> }>({ 
    scores: [], 
    wrongAnswers: [],
    fileCounts: {}
  });
  const [totalScore, setTotalScore] = useState(0);
  const [showChineseModeModal, setShowChineseModeModal] = useState(false);
  const [questionTimeLeft, setQuestionTimeLeft] = useState(QUESTION_TIME_LIMIT);
  const [quizTimeLeft, setQuizTimeLeft] = useState(QUIZ_TIME_LIMIT);
  const [timerActive, setTimerActive] = useState(false);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStats();
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (timerActive && currentView === 'quiz' && !isGenerating) {
      interval = setInterval(() => {
        setQuestionTimeLeft((prev) => {
          if (prev <= 1) {
            nextQuestion();
            return QUESTION_TIME_LIMIT;
          }
          return prev - 1;
        });
        setQuizTimeLeft((prev) => {
          if (prev <= 1) {
            finishQuiz();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [timerActive, currentView, isGenerating, currentQuestionIndex, questions.length]);

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/stats');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setStats(data);
      const total = data.scores.reduce((acc: number, curr: any) => acc + curr.score, 0);
      setTotalScore(total);
    } catch (e) {
      console.error("Failed to fetch stats", e);
    }
  };

  const startQuiz = async (subject: Subject | 'Mixed', mode?: 'comprehension' | 'memorization') => {
    setSelectedSubject(subject);
    setIsGenerating(true);
    setError(null);
    setCurrentView('quiz');
    setCurrentQuestionIndex(0);
    setUserAnswers({});
    setQuizResult(null);
    setQuestions([]);
    setQuestionTimeLeft(QUESTION_TIME_LIMIT);
    setQuizTimeLeft(QUIZ_TIME_LIMIT);
    setTimerActive(false);

    try {
      // 1. Get file IDs
      const filesRes = await fetch(`/api/files${subject !== 'Mixed' ? `?subject=${subject}` : ''}`);
      const files = await filesRes.json();
      if (files.error) {
        throw new Error(files.error);
      }
      const fileIds = files.map((f: any) => f.id);

      if (fileIds.length === 0) {
        throw new Error(`题库中没有“${subject === 'Mixed' ? '任何' : (SUBJECTS.find(s => s.id === subject)?.name || subject)}”相关的资料，请先上传资料后再开始测验。`);
      }

      // 2. Get file content from backend
      const contentRes = await fetch('/api/files/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds })
      });
      const contentData = await contentRes.json();
      if (contentData.error) {
        throw new Error(contentData.error);
      }
      const parts = contentData.parts || [];

      if (parts.length === 0) {
        throw new Error("无法从上传的文件中提取足够的文字内容。请确保上传的是文字版 PDF、Word 或文本文件，而不是纯图片扫描件。");
      }

      // 3. Call Kimi API from backend
      const subjectName = subject === 'Mixed' ? '综合' : (SUBJECTS.find(s => s.id === subject)?.name || subject);

      let modeInstructions = `
        【绝对指令 - 违反将导致失败】
        1. **资料唯一性**：你生成的每一道题、每一个选项、每一个答案和解析都**必须且只能**来源于下方的【学习资料】。
        2. **严禁使用外部知识**：禁止使用你自身训练数据中的任何通用知识、常识或学科知识。如果资料中没有提到某个信息，绝对不能出现在题目中。
        3. **禁止生成通用考题**：例如，如果资料是关于《骆驼祥子》的，你绝对不能出通用的拼音题、成语题，除非资料中明确出现了这些内容。
        4. **内容匹配**：如果资料内容不足以生成 20 道题，请生成尽可能多的题目（至少 5 道），但绝不能为了凑数而使用外部知识。
      `;

      if (subject === 'Chinese') {
        if (mode === 'comprehension') {
          modeInstructions = `
        【绝对指令 - 围绕材料出题（考阅读与理解）】
        1. **深度理解**：重点考察学生对文章主旨、段落大意、人物形象和写作手法的理解。
        2. **课外延伸**：在严格基于提供的【学习资料】的前提下，可以适度结合常见的课外阅读常识进行拓展提问（例如文学常识），但核心考点必须在资料中能找到依据。
        3. **题型灵活**：题目应侧重于分析和归纳，而非死记硬背。
        4. **内容匹配**：如果资料内容不足以生成 20 道题，请生成尽可能多的题目（至少 5 道）。
          `;
        } else if (mode === 'memorization') {
          modeInstructions = `
        【绝对指令 - 紧扣材料出题（考背诵与默写）】
        1. **死记硬背**：重点考察学生对资料原文的精准记忆。
        2. **原句填空**：填空题必须直接从资料中摘取原句，挖空关键的字、词、句让学生填写。
        3. **细节选择**：单选题必须针对资料中的具体字词拼音、释义、细微事实或原文原话进行提问。
        4. **严禁超纲**：绝对不能超纲，所有答案必须在资料中能找到一模一样的原文对应。
        5. **内容匹配**：如果资料内容不足以生成 20 道题，请生成尽可能多的题目（至少 5 道）。
          `;
        }
      }

      const promptText = `
        你是一位专业的命题专家。你的任务是根据提供的学习资料，为《${subjectName}》学科生成 20 道练习题。
        
        ${modeInstructions}
        
        【输出要求】
        1. 语言：简体中文。
        2. 题型：单选题 (multiple-choice) 或 填空题 (fill-in-the-blank)。
        3. 仅返回 JSON 数组。
        
        JSON 结构：
        [
          {
            "id": "q1",
            "type": "multiple-choice",
            "question": "基于资料的问题",
            "options": ["选项A", "选项B", "选项C", "选项D"],
            "answer": "正确答案",
            "explanation": "引用资料原文进行解析",
            "subject": "${subjectName}"
          }
        ]
      `;

      const generateRes = await fetch('/api/generate-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptText, parts })
      });
      
      const generateData = await generateRes.json();
      if (generateData.error) {
        throw new Error(generateData.error);
      }
      
      const responseText = generateData.text;

      let generatedQuestions = [];
      try {
        generatedQuestions = JSON.parse(responseText || "[]");
      } catch (parseErr) {
        console.error("JSON Parse Error from AI response:", parseErr);
        const jsonMatch = responseText?.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          generatedQuestions = JSON.parse(jsonMatch[0]);
        }
      }

      if (generatedQuestions.length === 0) {
        throw new Error("AI 未能生成有效的题目，请重试。");
      }

      setQuestions(generatedQuestions);
      setTimerActive(true);
    } catch (e: any) {
      console.error("Failed to generate quiz", e);
      setError(e.message || "生成失败，请重试");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAnswer = (answer: string) => {
    const currentQuestion = questions[currentQuestionIndex];
    setUserAnswers({ ...userAnswers, [currentQuestion.id]: answer });
  };

  const nextQuestion = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      setQuestionTimeLeft(QUESTION_TIME_LIMIT);
    } else {
      finishQuiz();
    }
  };

  const finishQuiz = async () => {
    setTimerActive(false);
    let score = 0;
    const wrongAnswers: any[] = [];

    questions.forEach(q => {
      const userAnswer = userAnswers[q.id];
      if (userAnswer?.trim().toLowerCase() === q.answer.trim().toLowerCase()) {
        score++;
      } else {
        wrongAnswers.push({
          questionText: q.question,
          userAnswer: userAnswer || "未回答",
          correctAnswer: q.answer,
          subject: q.subject
        });
      }
    });

    const result = { score, total: questions.length, wrongAnswers };
    setQuizResult(result);
    setCurrentView('results');

    if (!selectedSubject) return;

    try {
      await fetch('/api/quiz/results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: selectedSubject,
          score,
          total: questions.length,
          wrongAnswers
        })
      });
      fetchStats();
    } catch (e) {
      console.error("Failed to save results", e);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F0] text-[#141414] font-sans pb-24 md:pb-0">
      {/* Desktop Sidebar */}
      <nav className="hidden md:flex fixed left-0 top-0 h-full w-64 bg-white border-r border-[#141414]/10 p-6 flex-col z-50">
        <div className="flex items-center gap-3 mb-12">
          <div className="w-10 h-10 bg-[#141414] rounded-xl flex items-center justify-center text-white">
            <BrainCircuit size={24} />
          </div>
          <h1 className="font-bold text-xl tracking-tight">智能小测验</h1>
        </div>

        <div className="space-y-2 flex-1">
          <NavItem 
            icon={<LayoutGrid size={20} />} 
            label="仪表盘" 
            active={currentView === 'dashboard'} 
            onClick={() => setCurrentView('dashboard')} 
          />
          <NavItem 
            icon={<FileText size={20} />} 
            label="题库管理" 
            active={currentView === 'files'} 
            onClick={() => setCurrentView('files')} 
          />
          <NavItem 
            icon={<Trophy size={20} />} 
            label="积分统计" 
            active={currentView === 'stats'} 
            onClick={() => setCurrentView('stats')} 
          />
          <NavItem 
            icon={<History size={20} />} 
            label="错题整理" 
            active={currentView === 'review'} 
            onClick={() => setCurrentView('review')} 
          />
        </div>

        <div className="pt-6 border-t border-[#141414]/10">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-[#141414]/5">
            <div className="w-8 h-8 rounded-full bg-[#141414] flex items-center justify-center text-white text-xs font-bold">
              JJ
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-medium truncate">JourJour</p>
              <p className="text-xs opacity-50 truncate">累计积分: {totalScore}</p>
            </div>
          </div>
          <button 
            onClick={async () => {
              try {
                const res = await fetch('/api/test-kimi');
                const data = await res.json();
                alert(data.message);
              } catch (e) {
                alert("测试失败，请检查网络连接");
              }
            }}
            className="mt-3 w-full py-2 px-3 rounded-lg border border-[#141414]/10 text-xs font-medium hover:bg-[#141414]/5 transition-colors flex items-center justify-center gap-2"
          >
            <div className="w-2 h-2 rounded-full bg-green-500"></div>
            测试国内 API 连接
          </button>
        </div>
      </nav>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 w-full bg-white/80 backdrop-blur-lg border-t border-[#141414]/5 px-2 py-1 flex justify-around items-center z-50 shadow-[0_-8px_30px_rgba(0,0,0,0.08)]">
        <MobileNavItem 
          icon={<LayoutGrid size={18} />} 
          label="首页"
          active={currentView === 'dashboard'} 
          onClick={() => setCurrentView('dashboard')} 
        />
        <MobileNavItem 
          icon={<FileText size={18} />} 
          label="题库"
          active={currentView === 'files'} 
          onClick={() => setCurrentView('files')} 
        />
        <MobileNavItem 
          icon={<Trophy size={18} />} 
          label="积分"
          active={currentView === 'stats'} 
          onClick={() => setCurrentView('stats')} 
        />
        <MobileNavItem 
          icon={<History size={18} />} 
          label="错题"
          active={currentView === 'review'} 
          onClick={() => setCurrentView('review')} 
        />
      </nav>

      {/* Mobile Header */}
      <header className="md:hidden bg-white border-b border-[#141414]/10 p-4 sticky top-0 z-40 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-[#141414] rounded-lg flex items-center justify-center text-white">
            <BrainCircuit size={18} />
          </div>
          <h1 className="font-bold text-lg tracking-tight">智能小测验</h1>
        </div>
        <div className="flex items-center gap-2 bg-[#141414]/5 px-3 py-1.5 rounded-full">
          <Trophy size={14} className="text-amber-500" />
          <span className="text-xs font-bold">{totalScore}</span>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="md:ml-64 p-6 md:p-12 max-w-6xl mx-auto relative">
        <AnimatePresence>
          {showChineseModeModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-[#141414]/40 backdrop-blur-sm p-4"
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-white rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl"
              >
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h3 className="text-xl font-bold">选择语文出题模式</h3>
                    <p className="text-xs text-[#141414]/40 mt-1 flex items-center gap-2">
                      <Clock size={12} /> 限时 {QUIZ_TIME_LIMIT / 60} 分钟 | {QUESTION_TIME_LIMIT} 秒/题
                    </p>
                  </div>
                  <button onClick={() => setShowChineseModeModal(false)} className="p-2 hover:bg-[#141414]/5 rounded-full transition-colors">
                    <XCircle size={24} className="text-[#141414]/40 hover:text-[#141414]" />
                  </button>
                </div>
                <div className="space-y-4">
                  <button
                    onClick={() => {
                      setShowChineseModeModal(false);
                      startQuiz('Chinese', 'comprehension');
                    }}
                    className="w-full text-left p-5 rounded-2xl border-2 border-transparent bg-red-50 hover:border-red-200 transition-all hover:shadow-md group"
                  >
                    <div className="font-bold text-red-600 mb-1 flex items-center justify-between">
                      <span>围绕材料出题</span>
                      <ChevronRight size={18} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <div className="text-sm text-red-900/60 leading-relaxed">
                      考查对文章的理解和课外阅读量，题目灵活，侧重主旨归纳与分析。
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      setShowChineseModeModal(false);
                      startQuiz('Chinese', 'memorization');
                    }}
                    className="w-full text-left p-5 rounded-2xl border-2 border-transparent bg-blue-50 hover:border-blue-200 transition-all hover:shadow-md group"
                  >
                    <div className="font-bold text-blue-600 mb-1 flex items-center justify-between">
                      <span>紧扣材料出题</span>
                      <ChevronRight size={18} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <div className="text-sm text-blue-900/60 leading-relaxed">
                      做填空和选择题，严格考查背诵和原文记忆，绝不超纲。
                    </div>
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {currentView === 'dashboard' && (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6 md:space-y-8"
            >
              <header className="flex flex-col md:flex-row md:items-end justify-between gap-3">
                <div>
                  <h2 className="text-2xl md:text-4xl font-bold tracking-tight mb-1">欢迎回来</h2>
                  <p className="text-[#141414]/60 text-xs md:text-base">选择一个学科开始智能测验吧</p>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-50 border border-green-100 text-[9px] md:text-xs text-green-700 font-medium self-start md:self-auto">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
                  国内 Kimi 引擎已就绪 (无需 VPN)
                </div>
              </header>

              <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
                <SubjectCard 
                  title="语文" 
                  description="古诗词、文言文、现代文阅读" 
                  color="bg-red-50" 
                  accent="text-red-600"
                  icon={<BookOpen size={24} />}
                  fileCount={stats.fileCounts['Chinese'] || 0}
                  onClick={() => setShowChineseModeModal(true)}
                />
                <SubjectCard 
                  title="英语" 
                  description="词汇、语法、阅读理解" 
                  color="bg-blue-50" 
                  accent="text-blue-600"
                  icon={<BookOpen size={24} />}
                  fileCount={stats.fileCounts['English'] || 0}
                  onClick={() => startQuiz('English')}
                />
                <SubjectCard 
                  title="历史" 
                  description="中国史、世界史、重大事件" 
                  color="bg-amber-50" 
                  accent="text-amber-600"
                  icon={<BookOpen size={24} />}
                  fileCount={stats.fileCounts['History'] || 0}
                  onClick={() => startQuiz('History')}
                />
                <SubjectCard 
                  title="生物" 
                  description="细胞、遗传、生态系统" 
                  color="bg-green-50" 
                  accent="text-green-600"
                  icon={<BookOpen size={24} />}
                  fileCount={stats.fileCounts['Biology'] || 0}
                  onClick={() => startQuiz('Biology')}
                />
                <SubjectCard 
                  title="地理" 
                  description="地形、气候、人文地理" 
                  color="bg-cyan-50" 
                  accent="text-cyan-600"
                  icon={<BookOpen size={24} />}
                  fileCount={stats.fileCounts['Geography'] || 0}
                  onClick={() => startQuiz('Geography')}
                />
                <SubjectCard 
                  title="道法" 
                  description="道德、法律、社会责任" 
                  color="bg-purple-50" 
                  accent="text-purple-600"
                  icon={<BookOpen size={24} />}
                  fileCount={stats.fileCounts['Ethics'] || 0}
                  onClick={() => startQuiz('Ethics')}
                />
                <SubjectCard 
                  title="混合学科" 
                  description="全学科杂糅测试，挑战极限" 
                  color="bg-slate-900" 
                  accent="text-white"
                  icon={<LayoutGrid size={24} />}
                  dark
                  fileCount={Object.values(stats.fileCounts).reduce((a, b) => a + b, 0)}
                  onClick={() => startQuiz('Mixed')}
                />
              </div>
            </motion.div>
          )}

          {currentView === 'files' && (
            <motion.div
              key="files"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <FileManager />
            </motion.div>
          )}

          {currentView === 'quiz' && (
            <motion.div
              key="quiz"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-3xl mx-auto"
            >
              {isGenerating ? (
                <div className="bg-white rounded-3xl p-12 md:p-24 flex flex-col items-center justify-center text-center space-y-6">
                  <div className="w-12 h-12 md:w-16 md:h-16 border-4 border-[#141414] border-t-transparent rounded-full animate-spin" />
                  <div>
                    <h3 className="text-xl md:text-2xl font-bold">正在为您生成题目</h3>
                    <p className="text-[#141414]/60 mt-2 text-sm md:text-base">AI 正在深度解析您的学习资料...</p>
                  </div>
                </div>
              ) : questions.length > 0 ? (
                <div className="bg-white rounded-3xl p-6 md:p-12 shadow-xl shadow-[#141414]/5 border border-[#141414]/5">
                  <div className="flex justify-between items-center mb-8 md:mb-12">
                    <div className="flex flex-col gap-2">
                      <span className="px-3 py-1 md:px-4 md:py-1.5 rounded-full bg-[#141414] text-white text-[10px] md:text-xs font-bold uppercase tracking-wider w-fit">
                        {selectedSubject === 'Mixed' ? '混合学科' : (SUBJECTS.find(s => s.id === selectedSubject)?.name || selectedSubject)}
                      </span>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-red-500">
                          <Timer size={14} />
                          <span>本题: {questionTimeLeft}s</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs font-bold text-[#141414]/60">
                          <Clock size={14} />
                          <span>总计: {Math.floor(quizTimeLeft / 60)}:{String(quizTimeLeft % 60).padStart(2, '0')}</span>
                        </div>
                      </div>
                    </div>
                    <span className="text-xs md:text-sm font-mono opacity-50">QUESTION {String(currentQuestionIndex + 1).padStart(2, '0')} / {questions.length}</span>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full h-1 bg-[#141414]/5 rounded-full mb-8 overflow-hidden">
                    <motion.div 
                      className="h-full bg-red-500"
                      initial={{ width: "100%" }}
                      animate={{ width: `${(questionTimeLeft / QUESTION_TIME_LIMIT) * 100}%` }}
                      transition={{ duration: 1, ease: "linear" }}
                    />
                  </div>

                  <div className="space-y-6 md:space-y-8">
                    <h3 className="text-lg md:text-2xl font-medium leading-relaxed">
                      {questions[currentQuestionIndex].question}
                    </h3>

                    <div className="space-y-2 md:space-y-4">
                      {questions[currentQuestionIndex].type === 'multiple-choice' ? (
                        questions[currentQuestionIndex].options?.map((opt, i) => (
                          <QuizOption 
                            key={i}
                            label={String.fromCharCode(65 + i)} 
                            text={opt} 
                            selected={userAnswers[questions[currentQuestionIndex].id] === opt}
                            onClick={() => handleAnswer(opt)}
                          />
                        ))
                      ) : (
                        <div className="space-y-2">
                          <p className="text-xs md:text-sm font-bold opacity-40">请输入答案：</p>
                          <input 
                            type="text" 
                            className="w-full p-4 md:p-5 rounded-2xl border-2 border-[#141414]/5 focus:border-[#141414] outline-none transition-all text-sm md:text-base"
                            placeholder="在这里输入..."
                            value={userAnswers[questions[currentQuestionIndex].id] || ''}
                            onChange={(e) => handleAnswer(e.target.value)}
                          />
                        </div>
                      )}
                    </div>

                    <div className="pt-4 md:pt-8 flex justify-end md:static fixed bottom-0 left-0 w-full md:w-auto p-4 md:p-0 bg-white/80 md:bg-transparent backdrop-blur-md md:backdrop-blur-none border-t md:border-none border-[#141414]/5 md:z-auto z-40">
                      <button 
                        onClick={nextQuestion}
                        className="w-full md:w-auto px-8 py-4 bg-[#141414] text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-[#141414]/90 transition-all active:scale-[0.98] shadow-xl shadow-[#141414]/20 text-base"
                      >
                        {currentQuestionIndex === questions.length - 1 ? '提交测验' : '下一题'} <ChevronRight size={20} />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-3xl p-12 md:p-24 flex flex-col items-center justify-center text-center space-y-6">
                  <AlertCircle size={48} className="text-red-500" />
                  <div>
                    <h3 className="text-xl md:text-2xl font-bold">生成失败</h3>
                    <p className="text-[#141414]/60 mt-2 text-sm md:text-base">{error || "无法生成题目，请检查您的文件或重试。"}</p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <button 
                      onClick={() => startQuiz(selectedSubject as Subject | 'Mixed')} 
                      className="px-8 py-3 bg-[#141414] text-white rounded-xl font-bold flex items-center gap-2"
                    >
                      <RotateCcw size={18} /> 重试
                    </button>
                    <button 
                      onClick={() => setCurrentView('dashboard')} 
                      className="px-8 py-3 bg-[#141414]/5 text-[#141414] rounded-xl font-bold"
                    >
                      回到首页
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {currentView === 'results' && quizResult && (
            <motion.div
              key="results"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-2xl mx-auto space-y-6 md:space-y-8"
            >
              <div className="bg-white rounded-3xl p-8 md:p-12 text-center space-y-6 md:space-y-8 shadow-xl">
                <div className="w-20 h-20 md:w-24 md:h-24 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto">
                  <Trophy className="w-10 h-10 md:w-12 md:h-12" />
                </div>
                
                <div>
                  <h2 className="text-3xl md:text-4xl font-bold">测验结束！</h2>
                  <p className="text-[#141414]/60 mt-2 text-sm md:text-base">
                    {quizResult.score === quizResult.total ? '太棒了！满分通过！' : '再接再厉，你已经很棒了！'}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 md:gap-4">
                  <div className="p-4 md:p-6 bg-[#141414]/5 rounded-2xl">
                    <p className="text-[10px] md:text-sm opacity-40 uppercase font-bold tracking-widest">答对题数</p>
                    <p className="text-2xl md:text-4xl font-bold mt-1 md:mt-2">{quizResult.score} / {quizResult.total}</p>
                  </div>
                  <div className="p-4 md:p-6 bg-[#141414]/5 rounded-2xl">
                    <p className="text-[10px] md:text-sm opacity-40 uppercase font-bold tracking-widest">获得积分</p>
                    <p className="text-2xl md:text-4xl font-bold mt-1 md:mt-2">+{quizResult.score}</p>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 md:gap-4">
                  <button 
                    onClick={() => setCurrentView('dashboard')}
                    className="flex-1 py-4 bg-[#141414] text-white rounded-2xl font-bold hover:bg-[#141414]/90 transition-colors"
                  >
                    回到首页
                  </button>
                  <button 
                    onClick={() => startQuiz(selectedSubject as Subject)}
                    className="flex-1 py-4 border-2 border-[#141414] text-[#141414] rounded-2xl font-bold hover:bg-[#141414]/5 transition-colors flex items-center justify-center gap-2"
                  >
                    <RotateCcw size={20} /> 再测一次
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {currentView === 'stats' && (
            <motion.div
              key="stats"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-8 md:space-y-12"
            >
              <header>
                <h2 className="text-2xl md:text-4xl font-bold tracking-tight mb-1">积分统计</h2>
                <p className="text-[#141414]/60 text-xs md:text-base">您的学习进度与成就概览</p>
              </header>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-8">
                <StatCard label="累计积分" value={totalScore} icon={<Trophy className="text-amber-500" />} />
                <StatCard label="完成测验" value={stats.scores.length} icon={<CheckCircle2 className="text-green-500" />} />
                <StatCard label="错题总数" value={stats.wrongAnswers.length} icon={<XCircle className="text-red-500" />} />
              </div>

              <div className="bg-white p-4 md:p-8 rounded-2xl md:rounded-3xl border border-[#141414]/5 h-[240px] md:h-[400px]">
                <h3 className="font-bold text-base md:text-lg mb-4 md:mb-8">最近测验表现</h3>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.scores.slice(0, 7).reverse()}>
                    <XAxis dataKey="timestamp" tickFormatter={(t) => new Date(t).toLocaleDateString()} />
                    <YAxis />
                    <Tooltip labelFormatter={(t) => new Date(t).toLocaleString()} />
                    <Bar dataKey="score" fill="#141414" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          )}

          {currentView === 'review' && (
            <motion.div
              key="review"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6 md:space-y-8"
            >
              <header>
                <h2 className="text-2xl md:text-4xl font-bold tracking-tight mb-1">错题整理</h2>
                <p className="text-[#141414]/60 text-xs md:text-base">温故而知新，攻克薄弱环节</p>
              </header>

              <div className="space-y-3 md:space-y-4">
                {stats.wrongAnswers.length > 0 ? (
                  stats.wrongAnswers.map((wa: any, i: number) => (
                    <div key={i} className="bg-white p-4 md:p-6 rounded-2xl md:rounded-3xl border border-[#141414]/5 space-y-3 md:space-y-4">
                      <div className="flex justify-between items-start">
                        <span className="px-2 py-0.5 md:px-3 md:py-1 bg-[#141414]/5 rounded-full text-[8px] md:text-[10px] font-bold uppercase tracking-wider">
                          {wa.subject}
                        </span>
                        <span className="text-[8px] md:text-[10px] opacity-40">{new Date(wa.timestamp).toLocaleString()}</span>
                      </div>
                      <h4 className="text-sm md:text-lg font-medium leading-snug">{wa.questionText}</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 md:gap-4">
                        <div className="p-3 md:p-4 bg-red-50 rounded-xl md:rounded-2xl border border-red-100">
                          <p className="text-[8px] md:text-[10px] text-red-400 font-bold uppercase mb-0.5 md:mb-1">您的答案</p>
                          <p className="text-red-700 font-medium text-xs md:text-base">{wa.userAnswer}</p>
                        </div>
                        <div className="p-3 md:p-4 bg-green-50 rounded-xl md:rounded-2xl border border-green-100">
                          <p className="text-[8px] md:text-[10px] text-green-400 font-bold uppercase mb-0.5 md:mb-1">正确答案</p>
                          <p className="text-green-700 font-medium text-xs md:text-base">{wa.correctAnswer}</p>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-12 md:py-24 text-center bg-white rounded-2xl md:rounded-3xl border-2 border-dashed border-[#141414]/5">
                    <CheckCircle2 className="mx-auto text-green-500 mb-3 md:mb-4 w-8 h-8 md:w-12 md:h-12" />
                    <p className="text-base md:text-lg font-bold">暂无错题</p>
                    <p className="text-[#141414]/40 text-xs md:text-base">继续保持，你是最棒的！</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function MobileNavItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-all duration-200",
        active ? "text-[#141414]" : "text-[#141414]/30"
      )}
    >
      <div className={cn(
        "p-1.5 rounded-lg transition-all",
        active ? "bg-[#141414] text-white shadow-md" : ""
      )}>
        {icon}
      </div>
      <span className={cn("text-[10px] font-bold", active ? "opacity-100" : "opacity-60")}>{label}</span>
    </button>
  );
}

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200",
        active ? "bg-[#141414] text-white shadow-lg shadow-[#141414]/20" : "text-[#141414]/60 hover:bg-[#141414]/5 hover:text-[#141414]"
      )}
    >
      {icon}
      <span className="font-medium">{label}</span>
    </button>
  );
}

function SubjectCard({ title, description, color, accent, icon, onClick, dark, fileCount }: { title: string, description: string, color: string, accent: string, icon: React.ReactNode, onClick: () => void, dark?: boolean, fileCount?: number }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "group relative p-4 md:p-8 rounded-2xl md:rounded-3xl border border-[#141414]/5 text-left transition-all duration-300 hover:shadow-xl",
        color
      )}
    >
      <div className={cn("w-8 h-8 md:w-12 md:h-12 rounded-xl md:rounded-2xl flex items-center justify-center mb-3 md:mb-6 transition-transform group-hover:scale-110", dark ? "bg-white/20" : "bg-white shadow-sm")}>
        <div className={cn(accent, "[&_svg]:w-4 [&_svg]:h-4 md:[&_svg]:w-6 md:[&_svg]:h-6")}>{icon}</div>
      </div>
      <h3 className={cn("text-lg md:text-2xl font-bold mb-1 md:mb-2", dark ? "text-white" : "text-[#141414]")}>{title}</h3>
      <p className={cn("text-[10px] md:text-sm leading-tight md:leading-relaxed opacity-60 line-clamp-2", dark ? "text-white" : "text-[#141414]")}>{description}</p>
      
      <div className="mt-3 md:mt-4 flex flex-wrap gap-2">
        {fileCount !== undefined && (
          <div className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 md:px-3 md:py-1 rounded-full text-[8px] md:text-[10px] font-bold uppercase tracking-wider",
            dark ? "bg-white/10 text-white/80" : "bg-[#141414]/5 text-[#141414]/60"
          )}>
            <FileText className="w-2 h-2 md:w-3 md:h-3" />
            {fileCount}
          </div>
        )}
        <div className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 md:px-3 md:py-1 rounded-full text-[8px] md:text-[10px] font-bold uppercase tracking-wider",
          dark ? "bg-white/10 text-white/80" : "bg-[#141414]/5 text-[#141414]/60"
        )}>
          <Timer className="w-2 h-2 md:w-3 md:h-3" />
          {QUESTION_TIME_LIMIT}s/题
        </div>
      </div>

      <div className={cn("absolute bottom-4 right-4 md:bottom-8 md:right-8 w-6 h-6 md:w-10 md:h-10 rounded-full flex items-center justify-center transition-transform group-hover:translate-x-1 md:group-hover:translate-x-2", dark ? "bg-white/10 text-white" : "bg-[#141414] text-white")}>
        <ChevronRight className="w-3.5 h-3.5 md:w-5 md:h-5" />
      </div>
    </button>
  );
}

function QuizOption({ label, text, selected, onClick }: { label: string, text: string, selected?: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 md:gap-4 p-3 md:p-5 rounded-xl md:rounded-2xl border-2 transition-all duration-200 text-left",
        selected ? "border-[#141414] bg-[#141414]/5" : "border-[#141414]/5 hover:border-[#141414]/20 bg-white"
      )}
    >
      <span className={cn(
        "w-6 h-6 md:w-8 md:h-8 rounded-lg flex items-center justify-center text-xs md:text-sm font-bold flex-shrink-0",
        selected ? "bg-[#141414] text-white" : "bg-[#141414]/5 text-[#141414]"
      )}>
        {label}
      </span>
      <span className="flex-1 font-medium text-sm md:text-base leading-snug">{text}</span>
    </button>
  );
}

function StatCard({ label, value, icon }: { label: string, value: string | number, icon: React.ReactNode }) {
  return (
    <div className="bg-white p-4 md:p-8 rounded-2xl md:rounded-3xl border border-[#141414]/5 flex items-center gap-4 md:gap-6">
      <div className="w-10 h-10 md:w-16 md:h-16 rounded-xl md:rounded-2xl bg-[#141414]/5 flex items-center justify-center text-xl md:text-2xl">
        {icon}
      </div>
      <div>
        <p className="text-[10px] md:text-sm opacity-40 uppercase font-bold tracking-widest">{label}</p>
        <p className="text-xl md:text-3xl font-bold mt-0.5 md:mt-1">{value}</p>
      </div>
    </div>
  );
}
