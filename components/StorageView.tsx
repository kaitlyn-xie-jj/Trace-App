
import React, { useState, useRef, useEffect } from 'react';
import { analyzeImage } from '../services/aiService';
import { getCategories, addCategory } from '../services/dbService';
import { SceneRecord, AIItem, SceneType } from '../types';

interface StorageViewProps {
  onAddScene: (scene: SceneRecord) => Promise<void>;
  onUpdateScene: (scene: SceneRecord) => Promise<void>;
  initialImage?: string | null;
  existingScenes: SceneRecord[];
  onDeleteScene: (id: string) => Promise<void>;
}

const StorageView: React.FC<StorageViewProps> = ({ onAddScene, onUpdateScene, initialImage, existingScenes }) => {
  const [image, setImage] = useState<string | null>(initialImage || null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [categoryLoadError, setCategoryLoadError] = useState(false);
  const analysisRunId = useRef(0);
  const [syncing, setSyncing] = useState(false);
  const [batchLocation, setBatchLocation] = useState(''); 
  const [detectedItems, setDetectedItems] = useState<AIItem[]>([]);
  const isMounted = useRef(true);
  const locationInputRef = useRef<HTMLInputElement>(null);
  const [needFocusLocation, setNeedFocusLocation] = useState(false);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [conflictId, setConflictId] = useState<string | null>(null);

  // Space Management
  const [existingCategories, setExistingCategories] = useState<string[]>([]);
  const [selectedSpace, setSelectedSpace] = useState<string>('');
  const [showSpaceSelector, setShowSpaceSelector] = useState(false);
  const [showNewSpaceModal, setShowNewSpaceModal] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);

  // Item Edit Management
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingIsPerishable, setEditingIsPerishable] = useState(false);
  const [editingShelfLife, setEditingShelfLife] = useState<string>('');

  useEffect(() => {
    isMounted.current = true;
    getCategories().then(cats => {
      setExistingCategories(cats);
      setCategoriesLoaded(true);
    }).catch(error => {
      console.error('Unable to load spaces', error);
      setCategoryLoadError(true);
      // A failed category fetch must not prevent photo recognition/manual entry.
      setCategoriesLoaded(true);
    });
    const lastSpace = localStorage.getItem('last_selected_space');
    if (lastSpace) setSelectedSpace(lastSpace);
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    if (selectedSpace) {
      localStorage.setItem('last_selected_space', selectedSpace);
    }
  }, [selectedSpace]);

  useEffect(() => {
    if (!needFocusLocation) return;
    const start = Date.now();
    const tryFocus = () => {
      const el = locationInputRef.current;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus();
        el.select();
        setNeedFocusLocation(false);
        return;
      }
      if (Date.now() - start < 1000) {
        requestAnimationFrame(tryFocus);
      } else {
        setNeedFocusLocation(false);
      }
    };
    tryFocus();
  }, [needFocusLocation]);

  const generateId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

  // 压缩图片以节省存储空间
  const resizeImage = (base64: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Unable to load the selected image'));
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 1024;
          let width = img.width;
          let height = img.height;
          if (!width || !height) throw new Error('Invalid image dimensions');

          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }

          canvas.width = Math.round(width);
          canvas.height = Math.round(height);
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Image canvas unavailable');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        } catch (error) {
          reject(error);
        }
      };
      img.src = base64;
    });
  };

  useEffect(() => {
    if (initialImage && categoriesLoaded) {
      // This component may stay mounted when the user chooses another photo.
      setImage(initialImage);
      setDetectedItems([]);
      setBatchLocation('');
      triggerAnalysis(initialImage);
    }
  }, [initialImage, categoriesLoaded]);

  const triggerAnalysis = async (base64: string) => {
    if (!isMounted.current) return;
    const currentRun = ++analysisRunId.current;
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const data = await analyzeImage(base64, existingCategories);
      if (!isMounted.current || currentRun !== analysisRunId.current) return;
      setDetectedItems(data.items || []);
      
      // Auto-select space if suggested and exists in current categories
      if (data.suggestedSpace) {
        // Try to find a matching category (case-insensitive fuzzy match could be better but exact for now)
        // Or simply if it's in the list
        const match = existingCategories.find(c => c === data.suggestedSpace);
        if (match) {
          setSelectedSpace(match);
        }
      }

      if (data.suggestedLocation) {
        setBatchLocation(previous => previous || data.suggestedLocation || '');
      }
    } catch (e) {
      if (isMounted.current && currentRun === analysisRunId.current) {
        console.error('Image recognition failed', e);
        setAnalysisError('识别失败了。这不代表照片里没有物品，你可以重试，或者手动添加物品。');
      }
    } finally {
      if (isMounted.current && currentRun === analysisRunId.current) setAnalyzing(false);
    }
  };

  const handleCreateNewSpace = async () => {
    if (!newSpaceName.trim()) return;
    try {
      await addCategory(newSpaceName.trim());
      setExistingCategories(prev => [...prev, newSpaceName.trim()]);
      setSelectedSpace(newSpaceName.trim());
      setShowNewSpaceModal(false);
      setNewSpaceName('');
    } catch (e) {
      alert("创建空间失败");
    }
  };

  const handleSaveScene = async () => {
    if (!image || syncing) return;
    
    const locationName = batchLocation.trim() || '未命名位置';
    const existing = existingScenes.find(s => s.locationCategory === locationName && (s.superCategory || '') === selectedSpace);
    
    if (existing) {
      setConflictId(existing.id);
      setShowConflictModal(true);
      return;
    }

    await performSave(locationName);
  };

  const performSave = async (locationName: string, replaceId?: string): Promise<boolean> => {
    setSyncing(true);
    try {
      const compressedImage = await resizeImage(image!); // image checked before
      const newScene: SceneRecord = {
        id: replaceId || generateId(),
        fullImageUrl: compressedImage,
        timestamp: Date.now(),
        locationCategory: locationName,
        superCategory: selectedSpace || undefined,
        items: detectedItems
      };
      if (replaceId) {
        await onUpdateScene(newScene);
      } else {
        await onAddScene(newScene);
      }
      return true;
    } catch (e) {
      console.error('Scene save failed', e);
      alert("保存失败，请重试。原记录不会被删除。");
      return false;
    } finally {
      setSyncing(false);
    }
  };

  const handleConfirmOverwrite = async () => {
    if (!conflictId || syncing) return;
    const locationName = batchLocation.trim() || '未命名位置';
    // Update the existing record in place; never delete it before persistence succeeds.
    const saved = await performSave(locationName, conflictId);
    if (saved) {
      setShowConflictModal(false);
      setConflictId(null);
    }
  };

  const handleCancelOverwrite = () => {
    setShowConflictModal(false);
    setConflictId(null);
    setNeedFocusLocation(true);
  };

  const handleItemClick = (index: number) => {
    const item = detectedItems[index];
    setEditingIndex(index);
    setEditingName(item.itemName);
    setEditingIsPerishable(item.isPerishable || false);
    setEditingShelfLife(item.shelfLifeDays ? item.shelfLifeDays.toString() : '');
    setItemModalOpen(true);
  };

  const handleAddClick = () => {
    setEditingIndex(null);
    setEditingName('');
    setEditingIsPerishable(false);
    setEditingShelfLife('');
    setItemModalOpen(true);
  };

  const handleSaveItem = () => {
    if (!editingName.trim()) return;
    
    const shelfLife = editingIsPerishable && editingShelfLife ? parseInt(editingShelfLife) : undefined;

    if (editingIndex !== null) {
      // Edit
      const newItems = [...detectedItems];
      newItems[editingIndex] = { 
        ...newItems[editingIndex], 
        itemName: editingName.trim(),
        isPerishable: editingIsPerishable,
        shelfLifeDays: shelfLife
      };
      setDetectedItems(newItems);
    } else {
      // Add
      const newItem: AIItem = {
        itemName: editingName.trim(),
        category: '手动添加',
        scene: SceneType.OTHER,
        preciseLocation: batchLocation || '未命名位置',
        remarks: '',
        box_2d: [0, 0, 0, 0],
        isPerishable: editingIsPerishable,
        shelfLifeDays: shelfLife
      };
      setDetectedItems([...detectedItems, newItem]);
    }
    setItemModalOpen(false);
  };

  const handleDeleteItem = () => {
    if (editingIndex !== null) {
      const newItems = [...detectedItems];
      newItems.splice(editingIndex, 1);
      setDetectedItems(newItems);
    }
    setItemModalOpen(false);
  };

  return (
    <div className="flex flex-col h-full bg-light relative">
      <div className="px-6 py-4 pt-6 flex items-center justify-center fixed top-0 left-0 w-full z-50 bg-light/90 backdrop-blur-sm">
        <h1 className="text-xl font-bold text-black">记东西</h1>
      </div>
      
      <div className="flex-1 overflow-y-auto px-6 pt-32 pb-40 no-scrollbar">

        <div className="w-full bg-white rounded-3xl p-6 border border-gray-100 mb-6 shadow-sm">
          <label className="text-sm font-bold text-primary mb-3 block">
            <i className="fa-solid fa-location-dot mr-2"></i>
            这是哪里？
          </label>
          <div className="flex gap-3">
            <button
              onClick={() => setShowSpaceSelector(true)}
              className="relative w-1/3 min-w-[120px] bg-gray-50 rounded-2xl pl-4 pr-8 py-4 text-left flex items-center active:scale-95 transition-all"
            >
              <span className={`text-lg font-bold truncate ${selectedSpace ? 'text-black' : 'text-gray-400'}`}>
                {selectedSpace || '空间...'}
              </span>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                <i className="fa-solid fa-chevron-down text-xs"></i>
              </div>
            </button>
            <input 
              ref={locationInputRef}
              type="text" 
              value={batchLocation}
              onChange={e => setBatchLocation(e.target.value)}
              placeholder="比如：书桌..."
              className="flex-1 bg-gray-50 border-none rounded-2xl px-5 py-4 text-lg font-bold placeholder-gray-300 focus:outline-none focus:ring-0 transition-all min-w-0"
            />
          </div>
        </div>

        <div className="w-full bg-white rounded-3xl overflow-hidden border border-gray-100 shadow-sm relative mb-6">
          <img src={image || ''} className="w-full h-auto object-cover max-h-[50vh]" />
          {analyzing && (
            <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center text-primary">
              <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-4"></div>
              <p className="text-lg font-bold animate-pulse">正在努力看清...</p>
            </div>
          )}
          {!analyzing && detectedItems.length > 0 && (
             <div className="absolute top-4 right-4 bg-black/70 text-white px-4 py-2 rounded-full text-xs font-bold backdrop-blur-md">
               看见了 {detectedItems.length} 个东西
             </div>
          )}
        </div>

        {categoryLoadError && (
          <p role="status" className="mb-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            暂时无法加载已有空间。仍可识别和编辑物品，但保存前请检查网络连接。
          </p>
        )}

        {analysisError && !analyzing && (
          <div role="alert" className="mb-4 rounded-2xl border border-orange-200 bg-orange-50 p-4 text-orange-900">
            <p className="text-sm font-medium mb-3">{analysisError}</p>
            <button
              type="button"
              onClick={() => image && triggerAnalysis(image)}
              className="rounded-xl bg-white border border-orange-300 px-4 py-2 text-sm font-bold"
            >重新识别</button>
          </div>
        )}

        {!analyzing && (
          <div className="w-full bg-white rounded-3xl p-6 border border-gray-100">
            <h3 className="text-sm font-bold text-primary mb-4 block">
              <i className="fa-solid fa-wand-magic-sparkles mr-2"></i>
              我发现了这些
            </h3>
            <div className="flex flex-wrap gap-2">
              {detectedItems.map((it, idx) => (
                <button 
                  key={idx} 
                  onClick={() => handleItemClick(idx)}
                  className={`px-4 py-2 rounded-xl text-sm font-bold active:scale-95 transition-transform border ${
                    it.isPerishable 
                      ? 'bg-orange-50 text-orange-600 border-orange-100 hover:bg-orange-100' 
                      : 'bg-primary/10 text-primary border-transparent hover:bg-primary/20'
                  }`}
                >
                  {it.isPerishable && <i className="fa-solid fa-clock mr-1.5 text-xs opacity-70"></i>}
                  {it.itemName}
                  {it.shelfLifeDays && <span className="ml-1 opacity-70 text-xs">({it.shelfLifeDays}天)</span>}
                </button>
              ))}
              <button 
                  onClick={handleAddClick}
                  className="bg-gray-100 text-gray-400 px-4 py-2 rounded-xl text-sm font-bold active:scale-95 transition-transform hover:bg-gray-200 border border-dashed border-gray-300"
              >
                  <i className="fa-solid fa-plus mr-1"></i>
                  添加
              </button>
              {detectedItems.length === 0 && <p className="text-gray-400 font-medium">没发现特别的东西，手动加一个？</p>}
            </div>
          </div>
        )}
      </div>

      {!analyzing && (
        <div className="fixed bottom-24 left-0 w-full px-6 z-40">
          <button 
            onClick={handleSaveScene} 
            disabled={syncing}
            className="w-full py-5 bg-black text-white rounded-3xl font-bold text-xl shadow-xl disabled:opacity-50 active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            {syncing ? (
              <>
                <i className="fa-solid fa-circle-notch animate-spin"></i>
                <span>正在记...</span>
              </>
            ) : (
              <>
                <i className="fa-solid fa-check-circle"></i>
                <span>记住了！</span>
              </>
            )}
          </button>
        </div>
      )}

      {showConflictModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-6 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold text-gray-900 mb-2">位置重复啦</h3>
            <p className="text-gray-500 mb-6 text-base font-medium">
              “<span className="text-black font-bold">{batchLocation}</span>”已经存在了，要覆盖旧的照片吗？
            </p>
            <div className="flex gap-3">
              <button 
                onClick={handleCancelOverwrite}
                disabled={syncing}
                className="flex-1 py-4 bg-gray-100 text-gray-700 font-bold rounded-2xl active:scale-95 transition-all text-lg"
              >
                我去改名
              </button>
              <button 
                onClick={handleConfirmOverwrite}
                disabled={syncing}
                className="flex-1 py-4 bg-black text-white font-bold rounded-2xl active:scale-95 transition-all text-lg shadow-lg"
              >
                覆盖它
              </button>
            </div>
          </div>
        </div>
      )}

      {itemModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-6 w-full max-w-xs shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold text-gray-900 mb-4">
              {editingIndex !== null ? '编辑物品' : '添加物品'}
            </h3>
            
            <input 
              type="text" 
              value={editingName}
              onChange={e => setEditingName(e.target.value)}
              placeholder="物品名称"
              autoFocus
              className="w-full bg-gray-50 border-none rounded-2xl px-4 py-3 text-lg font-bold placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-primary mb-4"
              onKeyDown={e => {
                if (e.key === 'Enter') handleSaveItem();
              }}
            />

            <div className="bg-gray-50 rounded-2xl p-4 mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-gray-500 text-sm">会有保质期吗？</span>
                <button 
                  onClick={() => setEditingIsPerishable(!editingIsPerishable)}
                  className={`w-12 h-7 rounded-full transition-colors relative ${editingIsPerishable ? 'bg-primary' : 'bg-gray-300'}`}
                >
                  <div className={`w-5 h-5 bg-white rounded-full absolute top-1 transition-all ${editingIsPerishable ? 'left-6' : 'left-1'}`} />
                </button>
              </div>

               {editingIsPerishable && (
                 <div className="animate-in slide-in-from-top-2 duration-200">
                   <div className="text-xs text-gray-400 font-bold mb-1 ml-1">保质期（天）</div>
                   <input 
                     type="number" 
                     value={editingShelfLife}
                     onChange={e => setEditingShelfLife(e.target.value)}
                     placeholder="多少天后过期？"
                     className="w-full bg-white border-none rounded-xl px-4 py-3 text-base font-bold placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                   />
                   <div className="flex gap-2 mt-2 overflow-x-auto no-scrollbar pb-1">
                     {[3, 7, 15, 30, 90, 180, 365].map(days => (
                       <button
                         key={days}
                         onClick={() => setEditingShelfLife(days.toString())}
                         className="px-3 py-1 bg-white rounded-lg text-xs font-bold text-gray-500 hover:bg-gray-100 hover:text-primary whitespace-nowrap border border-gray-100"
                       >
                         {days}天
                       </button>
                     ))}
                   </div>
                 </div>
               )}
            </div>
            
            <div className="flex gap-3">
              {editingIndex !== null && (
                <button 
                    onClick={handleDeleteItem}
                    className="w-12 flex items-center justify-center bg-red-50 text-red-500 font-bold rounded-2xl active:scale-95 transition-all"
                >
                    <i className="fa-solid fa-trash"></i>
                </button>
              )}
              <button 
                onClick={() => setItemModalOpen(false)}
                className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-2xl active:scale-95 transition-all"
              >
                取消
              </button>
              <button 
                onClick={handleSaveItem}
                disabled={!editingName.trim()}
                className="flex-1 py-3 bg-black text-white font-bold rounded-2xl active:scale-95 transition-all shadow-lg disabled:opacity-50"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Space Selector Action Sheet */}
      {showSpaceSelector && (
        <div className="fixed inset-0 z-[100] flex flex-col justify-end bg-black/50 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setShowSpaceSelector(false)}>
          <div className="bg-white rounded-t-3xl p-6 pb-10 w-full max-h-[70vh] flex flex-col shadow-2xl animate-in slide-in-from-bottom duration-300" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-gray-900">选择空间</h3>
              <button 
                onClick={() => setShowSpaceSelector(false)}
                className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto space-y-2 no-scrollbar">
              {existingCategories.map(c => (
                <button
                  key={c}
                  onClick={() => {
                    setSelectedSpace(c);
                    setShowSpaceSelector(false);
                  }}
                  className={`w-full py-4 px-6 rounded-2xl text-left font-bold text-lg transition-all flex items-center justify-between ${selectedSpace === c ? 'bg-black text-white' : 'bg-gray-50 text-black hover:bg-gray-100'}`}
                >
                  <span>{c}</span>
                  {selectedSpace === c && <i className="fa-solid fa-check"></i>}
                </button>
              ))}
              
              <button
                onClick={() => {
                  setShowNewSpaceModal(true);
                  setShowSpaceSelector(false);
                }}
                className="w-full py-4 px-6 rounded-2xl text-left font-bold text-lg text-primary bg-primary/10 hover:bg-primary/20 transition-all flex items-center gap-3 mt-4"
              >
                <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-sm">
                   <i className="fa-solid fa-plus"></i>
                </div>
                新建空间
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Space Modal */}
      {showNewSpaceModal && (
        <div className="fixed inset-0 z-[110] bg-black/50 flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl p-6">
            <h3 className="text-xl font-bold text-black mb-6">新建空间</h3>
            <input 
              type="text" 
              value={newSpaceName}
              onChange={e => setNewSpaceName(e.target.value)}
              placeholder="例如：书房、客厅..."
              autoFocus
              className="w-full bg-gray-50 border-none rounded-2xl px-4 py-3 text-lg font-bold placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-primary mb-6"
              onKeyDown={e => {
                if (e.key === 'Enter') handleCreateNewSpace();
              }}
            />
            <div className="flex gap-3">
              <button 
                onClick={() => setShowNewSpaceModal(false)}
                className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-2xl active:scale-95 transition-all"
              >
                取消
              </button>
              <button 
                onClick={handleCreateNewSpace}
                disabled={!newSpaceName.trim()}
                className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl active:scale-95 transition-all shadow-lg disabled:opacity-50"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StorageView;
