
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { queryInventory } from '../services/aiService';
import { SceneRecord, ChatMessage, AIItem, ChatAIResponse } from '../types';
import { getChatHistory, addChatMessage } from '../services/dbService';

interface ChatSearchProps {
  scenes: SceneRecord[];
  initialQuery?: string;
  autoStartLive?: boolean;
  onLiveEnd?: () => void;
  onClearInitialQuery?: () => void;
  onStartCapture?: () => void;
}

interface MatchResult {
  scene: SceneRecord;
  items: AIItem[];
}

interface ExtendedChatMessage extends ChatMessage {
  matches?: MatchResult[];
  modelName?: string;
}

const ChatSearch: React.FC<ChatSearchProps> = ({ scenes, initialQuery, autoStartLive, onLiveEnd, onClearInitialQuery, onStartCapture }) => {
  const [messages, setMessages] = useState<ExtendedChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const recordedItems = scenes.flatMap(scene => scene.items || []);
  const firstItem = recordedItems.find(item => item.itemName?.trim());
  const exampleQuestions = firstItem
    ? [
        `${firstItem.itemName}在哪里？`,
        scenes.find(scene => scene.superCategory)?.superCategory
          ? `${scenes.find(scene => scene.superCategory)!.superCategory}里有什么？`
          : '我记过哪些东西？',
        '那个不常用的小东西放在哪里？'
      ]
    : ['我记过哪些东西？', '书房里有什么？', '那个黑色的小东西在哪里？'];
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasSentInitialQuery = useRef(false);
  const historyLoaded = useRef(false);

  useEffect(() => {
    if (historyLoaded.current) return;
    
    getChatHistory().then(history => {
       if (history && history.length > 0) {
         // User requested to ignore match cards in history, so we don't hydrate matches
         const hydrated = history.map(msg => {
           return { ...msg, matches: undefined };
         });
         setMessages(prev => {
            // Prevent duplicates if history loaded late
           const existingIds = new Set(prev.map((m: any) => m.timestamp));
           const newHistory = hydrated.filter((h: any) => !existingIds.has(h.timestamp));
           return [...newHistory, ...prev];
        });
      }
      historyLoaded.current = true;
    }).catch(console.error);
  }, [scenes]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  };

  useEffect(() => {
    scrollToBottom();
    const timer = setTimeout(scrollToBottom, 100);
    return () => clearTimeout(timer);
  }, [messages, loading]);

  const handleSend = useCallback(async (text?: string) => {
    const query = (text ?? inputValue).trim();
    if (!query || loading) return;
    setInputValue('');
    const timestamp = Date.now();
    const userMsg: ExtendedChatMessage & { timestamp?: number } = { role: 'user', content: query, timestamp };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    addChatMessage(userMsg).catch(console.error);
    
    try {
      // Prefer deterministic item-name matches: fast, auditable, and zero model cost.
      // Fall back to the existing AI search for ambiguous or unmatched questions.
      let aiResponse: ChatAIResponse | null = null;
      try {
        const response = await fetch(`/api/core/search?q=${encodeURIComponent(query)}&limit=10`);
        if (response.ok) {
          const local = await response.json() as {
            results?: Array<{
              item: { name: string; sourceSceneId: string };
              location?: { name: string; spaceName: string };
              score: number;
              matchedField: string;
            }>;
          };
          const matched = (local.results || []).filter(hit =>
            hit.score >= 80 && hit.matchedField === 'name'
          );
          if (matched.length > 0) {
            const locationDescriptions = matched.map(hit =>
              `${hit.item.name}：${hit.location?.spaceName || '未分类空间'} / ${hit.location?.name || '未命名位置'}`
            );
            aiResponse = {
              answer: `根据上次记录，${locationDescriptions.join('；')}。位置可能已变化，请以实物为准。`,
              matchedSceneIds: [...new Set(matched.map(hit => hit.item.sourceSceneId))],
              matchedItemDetails: matched.map(hit => ({
                sceneId: hit.item.sourceSceneId,
                itemName: hit.item.name
              })),
              modelName: '本地记录检索'
            };
          }
        }
      } catch (localError) {
        console.warn('Local inventory search unavailable; falling back to AI', localError);
      }
      if (!aiResponse) {
        aiResponse = await queryInventory(query, scenes, messages);
      }
      
      // 聚合匹配结果：一个场景下可能有多个匹配物品
      const matchMap = new Map<string, MatchResult>();
      
      aiResponse.matchedItemDetails?.forEach(detail => {
        const scene = scenes.find(s => s.id === detail.sceneId);
        if (scene) {
          const item = scene.items.find(it => 
            it.itemName === detail.itemName || 
            it.itemName.includes(detail.itemName) || 
            detail.itemName.includes(it.itemName)
          );
          if (item) {
            if (!matchMap.has(scene.id)) {
              matchMap.set(scene.id, { scene, items: [] });
            }
            // Use the fresh box_2d if available, otherwise fallback to existing
            const itemToUse = detail.box_2d ? { ...item, box_2d: detail.box_2d } : item;
            matchMap.get(scene.id)!.items.push(itemToUse);
          }
        }
      });
        
      setMessages(prev => [...prev, { 
        role: 'model', 
        content: aiResponse.answer, 
        matches: Array.from(matchMap.values()),
        modelName: aiResponse.modelName,
        timestamp: Date.now()
      } as ExtendedChatMessage]);

      // Save to DB (exclude matches as per user request)
       addChatMessage({
         role: 'model',
         content: aiResponse.answer,
         matches: undefined,
         modelName: aiResponse.modelName,
         timestamp: Date.now()
       }).catch(console.error);

    } catch (e) {
      const errorMsg = { role: 'model', content: "抱歉，我的大脑断网了。", timestamp: Date.now() };
      setMessages(prev => [...prev, errorMsg as ExtendedChatMessage]);
      addChatMessage(errorMsg).catch(console.error);
    } finally {
      setLoading(false);
    }
  }, [inputValue, loading, messages, scenes]);

  useEffect(() => {
    if (initialQuery && !hasSentInitialQuery.current) {
      hasSentInitialQuery.current = true;
      handleSend(initialQuery);
      onClearInitialQuery?.();
    }
  }, [initialQuery, onClearInitialQuery]);

  return (
    <div className="flex flex-col h-full bg-light relative">
      <div className="px-6 py-4 pt-6 flex items-center justify-center fixed top-0 left-0 w-full z-50 bg-light/90 backdrop-blur-sm">
        <h1 className="text-xl font-bold text-black">找东西</h1>
      </div>
      
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pt-32 pb-40 space-y-6 no-scrollbar">
        {messages.length === 0 && !loading && (
          <section className="mx-auto max-w-lg rounded-3xl border border-teal-100 bg-white px-6 py-7 shadow-sm" aria-label="开始找东西">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary" aria-hidden="true">
              <i className="fa-solid fa-magnifying-glass text-2xl"></i>
            </div>
            <h2 className="mb-2 text-2xl font-bold text-gray-900">想找什么，问我就好</h2>
            <p className="text-sm leading-relaxed text-gray-500">
              {recordedItems.length > 0
                ? `已经记录了 ${recordedItems.length} 件物品。可以用名字、用途或外观特征来描述。`
                : '先去「记东西」拍下收纳的角落，之后就能随时来这里寻找。'}
            </p>
            {recordedItems.length === 0 && onStartCapture && (
              <button
                type="button"
                onClick={onStartCapture}
                className="mt-5 w-full rounded-2xl bg-black px-4 py-3 text-sm font-bold text-white shadow-sm transition-transform active:scale-95"
              >
                <i className="fa-solid fa-camera mr-2" aria-hidden="true"></i>
                拍一张，开始记录
              </button>
            )}
            {recordedItems.length > 0 && (
            <div className="mt-6 space-y-2">
              <p className="text-xs font-semibold tracking-wide text-gray-400">试试这样问</p>
              {exampleQuestions.map(question => (
                <button
                  key={question}
                  type="button"
                  onClick={() => handleSend(question)}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-left text-sm font-medium text-gray-800 transition-colors hover:border-primary/30 hover:bg-primary/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <span>{question}</span>
                  <i className="fa-solid fa-arrow-up-right-from-square text-xs text-primary" aria-hidden="true"></i>
                </button>
              ))}
            </div>
            )}
            <p className="mt-5 text-xs leading-relaxed text-gray-400">
              查询依据已记录的信息；物品移动后，请及时更新位置。
            </p>
          </section>
        )}
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
            <div className={`max-w-[85%] rounded-3xl px-5 py-4 text-lg shadow-sm font-medium ${msg.role === 'user' ? 'bg-primary text-white rounded-br-sm' : 'bg-white text-black rounded-bl-sm border border-gray-100'}`}>
              {msg.content}
              {msg.modelName && (
                <div className="mt-2 text-[10px] opacity-50 font-normal text-right border-t border-gray-200/20 pt-1">
                {msg.modelName}
                </div>
              )}
            </div>
            
            {msg.matches?.map((match, mIdx) => (
              <div key={`${idx}-${mIdx}`} className="mt-4 w-full max-w-[95%] bg-white rounded-3xl border border-primary/20 shadow-xl overflow-hidden animate-in zoom-in-95 duration-500">
                <div className="p-4 border-b border-gray-50 flex justify-between items-center bg-primary/5">
                  <span className="text-sm font-bold text-black flex items-center">
                    <i className="fa-solid fa-location-dot mr-2 text-primary"></i>
                    {match.scene.superCategory ? `${match.scene.superCategory} · ` : ''}{match.scene.locationCategory}
                  </span>
                  <span className="text-xs text-gray-400 font-medium">
                    {new Date(match.scene.timestamp).toLocaleDateString()}
                  </span>
                </div>
                
                <div className="relative w-full bg-gray-100 overflow-hidden">
                  <img 
                    src={match.scene.fullImageUrl} 
                    className="w-full h-auto block" 
                    alt="Search result" 
                    onLoad={scrollToBottom}
                  />
                </div>

                <div className="p-4 bg-white space-y-3">
                  {match.items.map((item, iIdx) => (
                    <div key={iIdx} className="bg-primary/5 p-3 rounded-2xl border border-primary/20 flex gap-4">
                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-lg font-bold text-black truncate">{item.itemName}</span>
                          <span className="text-[10px] bg-white text-primary px-2 py-1 rounded-full font-bold uppercase flex-shrink-0 shadow-sm">{item.category}</span>
                        </div>
                        <p className="text-sm text-gray-600 flex items-start leading-snug">
                          <i className="fa-solid fa-map-pin mr-2 mt-1 text-primary/60 text-xs"></i>
                          <span className="truncate"><strong className="text-black font-medium">{item.preciseLocation}</strong></span>
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
        {loading && (
          <div className="flex items-center space-x-3 px-4 py-2">
            <div className="flex space-x-1.5">
              <div className="w-2 h-2 bg-secondary rounded-full animate-bounce"></div>
              <div className="w-2 h-2 bg-secondary rounded-full animate-bounce [animation-delay:-0.15s]"></div>
              <div className="w-2 h-2 bg-secondary rounded-full animate-bounce [animation-delay:-0.3s]"></div>
            </div>
            <span className="text-primary text-sm font-bold tracking-tight">正在帮你想...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="fixed bottom-28 left-0 w-full px-6 z-40">
        <div className="max-w-lg mx-auto flex items-center bg-white rounded-[2rem] border-2 border-gray-100 shadow-2xl px-3 py-2">
          <input 
            type="text" 
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder="问我吧，比如：我的耳机在哪？"
            className="flex-1 bg-transparent border-none focus:outline-none focus:ring-0 px-4 py-3 text-lg font-bold placeholder-gray-300 min-w-0"
          />
          <button
            type="button"
            aria-label="发送搜索问题"
            onClick={() => handleSend()}
            disabled={!inputValue.trim() || loading}
            className="bg-black text-white w-12 h-12 rounded-full flex items-center justify-center shadow-lg disabled:opacity-30 transition-transform active:scale-90 flex-shrink-0"
          >
            <i className="fa-solid fa-arrow-up text-xl"></i>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatSearch;
