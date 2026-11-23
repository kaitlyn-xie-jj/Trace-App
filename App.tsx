import React, { useState, useEffect, useRef, useMemo } from 'react';
import Navigation from './components/Navigation';
import HomeView from './components/HomeView';
import StorageView from './components/StorageView';
import ChatSearch from './components/ChatSearch';
import GalleryView from './components/GalleryView';
import { StorageItem, SceneType, SceneRecord } from './types';
import { getAIModel, setAIModel, AIModelType } from './services/aiService';
import { getAllScenes, addScene, updateScene, deleteScene } from './services/dbService';

const STORAGE_KEY = 'smart_organize_items_v2';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'home' | 'storage' | 'menu' | 'chat' | 'gallery'>('gallery');
  const [items, setItems] = useState<StorageItem[]>([]);
  const [scenes, setScenes] = useState<SceneRecord[]>([]);
  const [scenesLoading, setScenesLoading] = useState(true);
  const [scenesLoadError, setScenesLoadError] = useState(false);
  const [preselectedScene, setPreselectedScene] = useState<SceneType | null>(null);
  const [initialChatQuery, setInitialChatQuery] = useState('');
  const [liveAutoStart, setLiveAutoStart] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [currentAIModel, setCurrentAIModel] = useState<AIModelType>(getAIModel());
  
  const [isMediaModalOpen, setIsMediaModalOpen] = useState(false);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [pendingImageVersion, setPendingImageVersion] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reloadScenes = async (): Promise<void> => {
    setScenesLoading(true);
    try {
      const records = await getAllScenes();
      if (!Array.isArray(records)) throw new Error('Scene response is not an array');
      setScenes(records);
      setScenesLoadError(false);
    } catch (error) {
      console.error('Failed to load recorded scenes', error);
      setScenesLoadError(true);
      throw error;
    } finally {
      setScenesLoading(false);
    }
  };

  useEffect(() => {
    // Load legacy items
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setItems(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load items", e);
      }
    }
    // Never mistake a failed fetch for an empty inventory.
    void reloadScenes().catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);


  const handleAddScene = async (newScene: SceneRecord) => {
    try {
      await addScene(newScene);
      setScenes(prev => [...prev, newScene]);
      setPendingImage(null);
      setActiveTab('gallery');
    } catch (e) {
      console.error("Failed to add scene", e);
      throw e;
    }
  };

  const handleUpdateScene = async (updatedScene: SceneRecord) => {
    await updateScene(updatedScene);
    setScenes(prev => prev.map(s => s.id === updatedScene.id ? updatedScene : s));
    setPendingImage(null);
    setActiveTab('gallery');
  };

  const handleDeleteScene = async (id: string, skipConfirm = false) => {
    if (!skipConfirm && !window.confirm('确定要删除这段记忆吗？相关识别记录也将消失。')) return;
    try {
      await deleteScene(id);
      setScenes(prev => prev.filter(s => s.id !== id));
    } catch (e) {
      console.error("Delete failed", e);
    }
  };

  const startChat = (query: string, autoLive = false) => {
    setInitialChatQuery(query);
    setLiveAutoStart(autoLive);
    setActiveTab('chat');
  };

  const openMediaSource = (useCamera: boolean) => {
    if (fileInputRef.current) {
      if (useCamera) fileInputRef.current.setAttribute('capture', 'environment');
      else fileInputRef.current.removeAttribute('capture');
      fileInputRef.current.click();
    }
    setIsMediaModalOpen(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPendingImage(reader.result as string);
        // Even selecting the same image again should start a fresh scan.
        setPendingImageVersion(version => version + 1);
        setActiveTab('storage');
      };
      reader.onerror = () => window.alert('读取照片失败，请重新选择图片。');
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  return (
    <div className="min-h-screen bg-light flex flex-col relative overflow-hidden text-black">
      <button 
        onClick={() => setIsSidebarOpen(true)}
        className="fixed top-3 left-3 z-50 w-10 h-10 flex items-center justify-center text-black hover:opacity-70 transition-opacity hidden"
      >
        <i className="fa-solid fa-bars-staggered text-2xl"></i>
      </button>

      {isMediaModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center px-4 pb-8">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsMediaModalOpen(false)}></div>
          <div className="relative w-full max-w-md animate-in slide-in-from-bottom duration-300">
            <div className="bg-white rounded-3xl overflow-hidden mb-3 shadow-2xl">
              <button onClick={() => openMediaSource(true)} className="w-full py-6 text-xl text-black font-bold active:bg-gray-50 transition-colors border-b border-gray-100 flex items-center justify-center gap-2">
                <i className="fa-solid fa-camera text-primary"></i>
                拍一张
              </button>
              <button onClick={() => openMediaSource(false)} className="w-full py-6 text-xl text-black font-bold active:bg-gray-50 transition-colors flex items-center justify-center gap-2">
                <i className="fa-solid fa-image text-primary"></i>
                选一张
              </button>
            </div>
            <button 
              onClick={() => setIsMediaModalOpen(false)}
              className="w-full py-4 bg-white rounded-3xl text-xl text-gray-500 font-bold active:scale-95 transition-all shadow-lg"
            >
              算了
            </button>
          </div>
        </div>
      )}

      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        accept="image/*" 
        className="hidden" 
      />

      <main className="flex-1 overflow-hidden h-full">
        {activeTab === 'home' && (
          <HomeView 
            onStartChat={startChat} 
            onStartCamera={() => setIsMediaModalOpen(true)}
            onOpenMenu={() => setActiveTab('gallery')}
          />
        )}
        {activeTab === 'storage' && (
          <div className="h-full">
            <StorageView
              key={pendingImageVersion}
              onAddScene={handleAddScene} 
              onUpdateScene={handleUpdateScene}
              initialImage={pendingImage} 
              existingScenes={scenes}
              onDeleteScene={(id) => handleDeleteScene(id, true)}
            />
          </div>
        )}
        {activeTab === 'chat' && (
          <div className="h-full">
            <ChatSearch 
              scenes={scenes} 
              initialQuery={initialChatQuery} 
              autoStartLive={liveAutoStart}
              onLiveEnd={() => setLiveAutoStart(false)}
              onClearInitialQuery={() => setInitialChatQuery('')}
              onStartCapture={() => setIsMediaModalOpen(true)}
            />
          </div>
        )}
        {activeTab === 'gallery' && (
          <div className="h-full">
            <GalleryView 
              scenes={scenes}
              scenesLoading={scenesLoading}
              scenesLoadError={scenesLoadError}
              onRetryLoad={() => { void reloadScenes().catch(() => {}); }}
              onDelete={handleDeleteScene}
              onUpdate={(updatedScene) => {
                 setScenes(prev => prev.map(s => s.id === updatedScene.id ? updatedScene : s));
              }}
              onReload={reloadScenes}
            />
          </div>
        )}
      </main>

      {activeTab !== 'home' && !isMediaModalOpen && (
        <Navigation activeTab={activeTab as any} setActiveTab={setActiveTab} onCameraClick={() => setIsMediaModalOpen(true)} />
      )}
    </div>
  );
};

export default App;
