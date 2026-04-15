'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Send, Book, MessageCircle, BookOpen, BrainCircuit, Pin, ChevronDown, ChevronUp, Layers, Check } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, User } from 'firebase/auth';
import { getFirestore, collection, doc, addDoc, updateDoc, onSnapshot } from 'firebase/firestore';

// グローバル変数の型宣言
declare const __firebase_config: string | undefined;
declare const __app_id: string | undefined;

// 型定義
interface Situation {
  type: string;
  indonesian: string;
  japanese: string;
  structure: string;
  explanation: string;
  trivia: string;
}

interface Word {
  id: string;
  word: string;
  translation: string;
  englishSimilarity?: string;
  situations?: Situation[];
  stats: { correct: number; total: number };
  isPinned: boolean;
  note?: string;
  createdAt?: number;
  createdBy?: string;
}

interface Message {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  isSystem?: boolean;
  emoji?: string;
}

interface QuizState {
  word: Word;
  target: string;
}

interface GeminiPayload {
  contents: { parts: { text: string }[] }[];
  generationConfig?: { responseMimeType: string };
}

/**
 * 【環境設定 / ENVIRONMENT CONFIG】
 */
const firebaseConfig = typeof __firebase_config !== 'undefined'
  ? JSON.parse(__firebase_config)
  : (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_FIREBASE_CONFIG
      ? JSON.parse(process.env.NEXT_PUBLIC_FIREBASE_CONFIG)
      : {
          "apiKey": "AIzaSyDpVJds7uSRdTqmMBVIxs_4q-Vo5Qkbmdk",
          "authDomain": "indonesian-learning.firebaseapp.com",
          "projectId": "indonesian-learning",
          "storageBucket": "indonesian-learning.firebasestorage.app",
          "messagingSenderId": "81777562248",
          "appId": "1:81777562248:web:aaa9f899871d5146cf853d"
        });

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'my-indonesian-app';

// Gemini API Key
const apiKey = (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_GEMINI_API_KEY)
  ? process.env.NEXT_PUBLIC_GEMINI_API_KEY
  : "";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState('chat');
  const [words, setWords] = useState<Word[]>([]);
  const [messages, setMessages] = useState<Message[]>([
    { id: 'init', sender: 'ai', text: 'Selamat datang! インドネシア語の疑問は何でも聞いてや！クイズをやりたいときは脳みそボタンを押してな🧠', isSystem: true }
  ]);

  const [inputWord, setInputWord] = useState('');
  const [isGeneratingWords, setIsGeneratingWords] = useState(false);
  const [expandedWords, setExpandedWords] = useState<Record<string, boolean>>({});
  const [chatInput, setChatInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [roleplayTarget, setRoleplayTarget] = useState('Bro/Sist (砕けた表現)');
  const [currentQuiz, setCurrentQuiz] = useState<QuizState | null>(null);
  const [fcQueue, setFcQueue] = useState<Word[]>([]);
  const [fcCurrentIdx, setFcCurrentIdx] = useState(0);
  const [fcIsFlipped, setFcIsFlipped] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 1. Authentication
  useEffect(() => {
    const initAuth = async () => {
      try {
        const token = typeof (window as Window & { __initial_auth_token?: string }).__initial_auth_token !== 'undefined'
          ? (window as Window & { __initial_auth_token?: string }).__initial_auth_token
          : null;
        if (token) {
          await signInWithCustomToken(auth, token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Auth error:", error);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. Data Sync
  useEffect(() => {
    if (!user) return;
    const wordsRef = collection(db, 'artifacts', appId, 'public', 'data', 'words');
    const unsubscribe = onSnapshot(wordsRef, (snapshot) => {
      const wordsData: Word[] = snapshot.docs.map(d => ({
        id: d.id,
        ...(d.data() as Omit<Word, 'id'>)
      }));
      setWords(wordsData);
    }, (error) => {
      console.error("Firestore sync error:", error);
    });
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // API Helper
  const callGeminiAPI = async (prompt: string, expectJson = false): Promise<unknown> => {
    if (!apiKey) {
      alert('Gemini APIキーが設定されていません。.env.local に NEXT_PUBLIC_GEMINI_API_KEY を設定してください。');
      return null;
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const payload: GeminiPayload = {
      contents: [{ parts: [{ text: prompt }] }],
    };
    if (expectJson) payload.generationConfig = { responseMimeType: "application/json" };

    const retryDelays = [1000, 2000, 4000];
    for (let i = 0; i <= retryDelays.length; i++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          console.error('Gemini API error:', res.status, errBody);
          // 4xx はリトライしない（APIキー不正・リクエスト不正）
          if (res.status >= 400 && res.status < 500) {
            alert(`Gemini API エラー (${res.status}): APIキーを確認してください。`);
            return null;
          }
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        const text = data.candidates[0].content.parts[0].text;
        return expectJson ? JSON.parse(text) : text;
      } catch (e) {
        if (i === retryDelays.length) {
          alert('Gemini API への接続に失敗しました。ネットワークを確認してください。');
          return null;
        }
        await new Promise(r => setTimeout(r, retryDelays[i]));
      }
    }
    return null;
  };

  // 3. Actions with Firestore
  const handleAddWord = async () => {
    if (!inputWord.trim() || !user) return;
    setIsGeneratingWords(true);

    const prompt = `
      ユーザーが入力した日本語「${inputWord}」の文脈を読み取り、最も適した日常的なインドネシア語の単語やフレーズを一つ選定し、以下の情報を出力してください。
      出力は以下のJSON形式のみにしてください。
      {
        "indonesianWord": "...",
        "translation": "...",
        "englishSimilarity": "...",
        "situations": [
          {"type": "Bro/Sist", "indonesian": "...", "japanese": "...", "structure": "...", "explanation": "...", "trivia": "..."},
          {"type": "Teman", "indonesian": "...", "japanese": "...", "structure": "...", "explanation": "...", "trivia": "..."},
          {"type": "Orang Tua", "indonesian": "...", "japanese": "...", "structure": "...", "explanation": "...", "trivia": "..."}
        ]
      }
    `;

    try {
      const result = await callGeminiAPI(prompt, true) as { indonesianWord: string; translation: string; englishSimilarity: string; situations: Situation[] } | null;
      if (result) {
        const wordsRef = collection(db, 'artifacts', appId, 'public', 'data', 'words');
        await addDoc(wordsRef, {
          word: result.indonesianWord,
          translation: result.translation,
          englishSimilarity: result.englishSimilarity,
          situations: result.situations,
          stats: { correct: 0, total: 0 },
          isPinned: false,
          note: `検索した日本語: ${inputWord}`,
          createdAt: Date.now(),
          createdBy: user.uid
        });
        setInputWord('');
      }
    } catch (e) {
      console.error('単語の保存に失敗:', e);
      alert('保存に失敗しました。Firestore のセキュリティルールを確認してください。');
    } finally {
      setIsGeneratingWords(false);
    }
  };

  const togglePin = async (id: string, currentVal: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'words', id);
    await updateDoc(docRef, { isPinned: !currentVal });
  };

  const updateNote = async (id: string, newNote: string) => {
    if (!user) return;
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'words', id);
    await updateDoc(docRef, { note: newNote });
  };

  const toggleExpand = (id: string) => {
    setExpandedWords(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const sortedWords = [...words].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  const generateQuiz = async () => {
    if (words.length === 0) {
      alert("まずは辞書に単語を登録してや！");
      setActiveTab('dictionary');
      return;
    }
    setIsLoading(true);
    const randomWord = words[Math.floor(Math.random() * words.length)];
    const target = roleplayTarget.split(' ')[0];
    const prompt = `あなたはインドネシア語の先生（関西弁）です。「${randomWord.word}」を使って「${target}」に向けたお題をチャット風に出して。`;
    const questionText = await callGeminiAPI(prompt, false) as string | null;
    if (questionText) {
      setCurrentQuiz({ word: randomWord, target });
      setMessages(prev => [...prev, { id: Date.now().toString(), sender: 'ai', text: questionText }]);
    }
    setIsLoading(false);
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || !user) return;
    const userMsg: Message = { id: Date.now().toString(), sender: 'user', text: chatInput };
    setMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setIsLoading(true);

    if (currentQuiz) {
      const prompt = `お題:「${currentQuiz.word.word}」、相手:「${currentQuiz.target}」、回答:「${chatInput}」。添削かヒント（なんだっけ？と言われたらヒント）をJSON {"type":"evaluation|hint", "isCorrect":bool, "emoji":"...", "feedback":"..."} で出力。関西弁で。`;
      const evalResult = await callGeminiAPI(prompt, true) as { type: string; isCorrect: boolean; emoji: string; feedback: string } | null;
      if (evalResult) {
        if (evalResult.type === 'evaluation') {
          const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'words', currentQuiz.word.id);
          await updateDoc(docRef, {
            'stats.total': (currentQuiz.word.stats.total || 0) + 1,
            'stats.correct': (currentQuiz.word.stats.correct || 0) + (evalResult.isCorrect ? 1 : 0)
          });
          setCurrentQuiz(null);
        }
        setMessages(prev => [...prev, { id: Date.now().toString(), sender: 'ai', text: evalResult.feedback, emoji: evalResult.emoji }]);
      }
    } else {
      // 自由質問モード：インドネシア語の疑問に何でも答える
      const prompt = `あなたはインドネシア語の先生（関西弁）です。登録済み単語一覧: ${words.map(w => w.word).join(', ')}。
ユーザーの質問: 「${chatInput}」
インドネシア語に関する質問なら丁寧に関西弁で答えてください。例文も添えてください。
クイズをやりたいと言われたら「クイズボタン（脳みそアイコン）を押してや！」と案内してください。`;
      const answer = await callGeminiAPI(prompt, false) as string | null;
      if (answer) {
        setMessages(prev => [...prev, { id: Date.now().toString(), sender: 'ai', text: answer }]);
      }
    }
    setIsLoading(false);
  };

  const startFlashcards = () => {
    if (words.length === 0) return;
    setFcQueue([...words].sort(() => Math.random() - 0.5));
    setFcCurrentIdx(0);
    setFcIsFlipped(false);
    setActiveTab('flashcard_play');
  };

  const handleFlashcardAnswer = async (isCorrect: boolean) => {
    const currentWord = fcQueue[fcCurrentIdx];
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'words', currentWord.id);
    await updateDoc(docRef, {
      'stats.total': (currentWord.stats.total || 0) + 1,
      'stats.correct': (currentWord.stats.correct || 0) + (isCorrect ? 1 : 0)
    });

    if (fcCurrentIdx + 1 < fcQueue.length) {
      setFcCurrentIdx(fcCurrentIdx + 1);
      setFcIsFlipped(false);
    } else {
      setFcQueue([]);
      setActiveTab('flashcard');
    }
  };

  const renderChat = () => (
    <div className="flex flex-col h-full bg-[#7494C0]">
      <div className="bg-[#2c3e50] text-white p-4 flex justify-between items-center shadow-md z-10">
        <h1 className="font-bold text-lg flex items-center gap-2"><MessageCircle size={20}/> Guru Indo</h1>
        <div className="bg-[#34495e] px-3 py-1 rounded-full text-[10px]">
          {user ? `User: ${user.uid.substring(0, 6)}...` : 'Connecting...'}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-2 shadow-sm relative ${msg.sender === 'user' ? 'bg-[#85e249] text-black rounded-tr-none' : msg.isSystem ? 'bg-black/20 text-white mx-auto text-[10px] text-center rounded-full px-6' : 'bg-white text-black rounded-tl-none'}`}>
              {msg.emoji && <div className="text-4xl absolute -top-4 -left-4 bg-white rounded-full p-1 shadow-md">{msg.emoji}</div>}
              <div className={`whitespace-pre-wrap ${msg.emoji ? 'mt-2' : ''}`}>{msg.text}</div>
            </div>
          </div>
        ))}
        {isLoading && <div className="flex justify-start"><div className="bg-white p-2 rounded-2xl animate-pulse">Thinking...</div></div>}
        <div ref={messagesEndRef} />
      </div>
      <div className="bg-white p-2 flex gap-2 items-center">
        <button onClick={generateQuiz} className="p-2 text-[#7494C0] hover:bg-gray-100 rounded-full" title="クイズを出題"><BrainCircuit size={24} /></button>
        <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()} placeholder={currentQuiz ? '回答または「ヒント」を入力...' : 'インドネシア語について質問する...'} className="flex-1 bg-gray-100 rounded-full px-4 py-2 outline-none text-black placeholder:text-gray-400"/>
        <button onClick={handleSendMessage} className="p-2 bg-[#7494C0] text-white rounded-full"><Send size={20} /></button>
      </div>
    </div>
  );

  const renderDictionary = () => (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="bg-white p-4 shadow-sm z-10 flex justify-between items-center">
        <h1 className="font-bold text-xl text-gray-800 flex items-center gap-2"><BookOpen className="text-blue-500"/> みんなの単語帳</h1>
      </div>
      <div className="p-4 flex-1 overflow-y-auto">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 mb-6 sticky top-0 z-20">
          <div className="flex gap-2">
            <input type="text" value={inputWord} onChange={(e) => setInputWord(e.target.value)} placeholder="日本語で入力 (例: お腹すいた)" className="flex-1 border rounded-lg px-4 py-2 outline-none focus:border-blue-500 bg-gray-50 text-black placeholder:text-gray-400" onKeyDown={(e) => e.key === 'Enter' && handleAddWord()}/>
            <button onClick={handleAddWord} disabled={isGeneratingWords || !inputWord.trim()} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium whitespace-nowrap">{isGeneratingWords ? '保存中...' : '追加'}</button>
          </div>
        </div>
        <div className="space-y-3">
          {sortedWords.map(w => (
            <div key={w.id} className={`bg-white rounded-xl shadow-sm border ${w.isPinned ? 'border-yellow-300 shadow-yellow-50' : 'border-gray-200'}`}>
              <div className="p-4 flex justify-between items-center cursor-pointer" onClick={() => toggleExpand(w.id)}>
                <div className="flex items-center gap-2">
                  <button onClick={(e) => togglePin(w.id, w.isPinned, e)} className={`${w.isPinned ? 'text-yellow-500' : 'text-gray-300'}`}><Pin size={18} fill={w.isPinned ? "currentColor" : "none"}/></button>
                  <div>
                    <h3 className="font-bold text-gray-900">{w.word}</h3>
                    <p className="text-xs text-gray-500">{w.translation}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-gray-400">
                  {Math.round((w.stats?.correct / (w.stats?.total || 1)) * 100)}%
                  {expandedWords[w.id] ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
                </div>
              </div>
              {expandedWords[w.id] && (
                <div className="p-4 pt-0 border-t border-gray-50">
                  {w.englishSimilarity && <div className="mt-2 text-xs p-2 bg-purple-50 text-purple-700 rounded">🇬🇧 {w.englishSimilarity}</div>}
                  <div className="mt-2 space-y-2">
                    {w.situations?.map((s, i) => (
                      <div key={i} className="text-xs p-2 bg-white rounded border border-gray-100">
                        <span className="font-bold text-[8px] text-gray-400">{s.type}</span>
                        <p className="font-bold text-gray-800">{s.indonesian}</p>
                        <p className="text-gray-500">{s.japanese}</p>
                        <p className="text-blue-600 mt-1 opacity-70">{s.structure}</p>
                        <p className="mt-1 p-1 bg-yellow-50 text-yellow-700 rounded border border-yellow-100 italic">💡 {s.trivia}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2">
                    <p className="text-[10px] font-bold text-amber-800 mb-1">My Note:</p>
                    <textarea value={w.note || ''} onChange={(e) => updateNote(w.id, e.target.value)} className="w-full p-2 text-xs border border-amber-100 rounded bg-amber-50/30 min-h-[60px]" placeholder="自分だけのメモ..."/>
                  </div>
                </div>
              )}
            </div>
          ))}
          {words.length === 0 && !isGeneratingWords && <div className="text-center text-gray-400 py-10">まだデータがないで。何か入力してな！</div>}
        </div>
      </div>
    </div>
  );

  const renderFlashcardPlay = () => (
    <div className="flex flex-col h-full bg-gray-800 text-white">
      <div className="p-4 flex justify-between border-b border-gray-700">
        <span className="text-xs">Card {fcCurrentIdx + 1} / {fcQueue.length}</span>
        <button onClick={() => setActiveTab('flashcard')}>終了</button>
      </div>
      <div className="flex-1 flex items-center justify-center p-6">
        <div className={`w-full max-w-sm aspect-[4/5] bg-white text-black rounded-2xl shadow-xl flex flex-col items-center justify-center p-8 text-center transition-all cursor-pointer ${fcIsFlipped ? 'bg-amber-50' : ''}`} onClick={() => setFcIsFlipped(!fcIsFlipped)}>
          {!fcIsFlipped ? (
            <><h2 className="text-4xl font-black">{fcQueue[fcCurrentIdx]?.word}</h2><p className="mt-4 text-gray-400 animate-pulse text-sm">Tap to reveal</p></>
          ) : (
            <div className="w-full h-full overflow-y-auto">
              <h2 className="text-2xl font-bold border-b pb-2">{fcQueue[fcCurrentIdx]?.translation}</h2>
              <div className="mt-4 text-sm text-left space-y-2">
                <p><strong>🇬🇧 英語:</strong> {fcQueue[fcCurrentIdx]?.englishSimilarity}</p>
                {fcQueue[fcCurrentIdx]?.note && <p><strong>📌 Note:</strong> {fcQueue[fcCurrentIdx]?.note}</p>}
              </div>
            </div>
          )}
        </div>
      </div>
      {fcIsFlipped && (
        <div className="p-6 flex gap-4">
          <button onClick={() => handleFlashcardAnswer(false)} className="flex-1 py-4 bg-red-500 rounded-xl font-bold shadow-lg">忘れた</button>
          <button onClick={() => handleFlashcardAnswer(true)} className="flex-1 py-4 bg-green-500 rounded-xl font-bold shadow-lg flex items-center justify-center gap-2"><Check size={18}/>覚えた！</button>
        </div>
      )}
    </div>
  );

  return (
    <div className="h-screen w-full flex justify-center bg-gray-200 font-sans">
      <div className="w-full max-w-md bg-white h-full flex flex-col relative overflow-hidden shadow-2xl">
        <div className="flex-1 overflow-hidden">
          {activeTab === 'chat' && renderChat()}
          {activeTab === 'dictionary' && renderDictionary()}
          {activeTab === 'flashcard' && (
            <div className="flex flex-col h-full items-center justify-center p-8 text-center bg-gray-50">
              <Layers size={64} className="text-orange-400 mb-4"/>
              <h2 className="text-2xl font-bold text-gray-800">暗記モード</h2>
              <p className="text-gray-400 mt-2 mb-8">みんなが登録した {words.length} 単語を復習しよか！</p>
              <button onClick={startFlashcards} disabled={words.length === 0} className="w-full py-4 bg-orange-500 text-white rounded-2xl font-bold shadow-lg disabled:bg-gray-300">スタート</button>
            </div>
          )}
          {activeTab === 'flashcard_play' && renderFlashcardPlay()}
        </div>
        {activeTab !== 'flashcard_play' && (
          <div className="flex border-t bg-gray-50">
            <button onClick={() => setActiveTab('chat')} className={`flex-1 py-3 flex flex-col items-center gap-1 text-[10px] font-bold ${activeTab === 'chat' ? 'text-blue-600' : 'text-gray-400'}`}><MessageCircle size={22}/>チャット</button>
            <button onClick={() => setActiveTab('dictionary')} className={`flex-1 py-3 flex flex-col items-center gap-1 text-[10px] font-bold ${activeTab === 'dictionary' ? 'text-blue-600' : 'text-gray-400'}`}><Book size={22}/>単語帳</button>
            <button onClick={() => setActiveTab('flashcard')} className={`flex-1 py-3 flex flex-col items-center gap-1 text-[10px] font-bold ${activeTab === 'flashcard' ? 'text-orange-500' : 'text-gray-400'}`}><Layers size={22}/>暗記</button>
          </div>
        )}
      </div>
    </div>
  );
}
