import React, { useState, useMemo, useEffect } from 'react';
import { SceneRecord, AIItem, SceneType } from '../types';
import { updateScene, addCategory, getCategories, getAllScenes, deleteCategory, updateCategoryName, deleteScene, updateCategoryOrder } from '../services/dbService';
import { serializeSceneExport } from '../utils/sceneExport.js';

interface GalleryViewProps {
  scenes: SceneRecord[];
  scenesLoading: boolean;
  scenesLoadError: boolean;
  onRetryLoad: () => void;
  onDelete: (id: string) => void;
  onUpdate: (scene: SceneRecord) => void;
  onReload?: () => Promise<void>;
}

const GalleryView: React.FC<GalleryViewProps> = ({ scenes, scenesLoading, scenesLoadError, onRetryLoad, onDelete, onUpdate, onReload }) => {
  const [selectedScene, setSelectedScene] = useState<SceneRecord | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [existingCategories, setExistingCategories] = useState<string[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Category Drag State
  const [draggingCategory, setDraggingCategory] = useState<string | null>(null);

  // Refs for Touch Drag
  const categoriesRef = React.useRef(existingCategories);
  const draggingCategoryRef = React.useRef(draggingCategory);
  
  useEffect(() => { categoriesRef.current = existingCategories; }, [existingCategories]);
  useEffect(() => { draggingCategoryRef.current = draggingCategory; }, [draggingCategory]);

  const [isEditingName, setIsEditingName] = useState(false);
  const [editingName, setEditingName] = useState('');

  // Management State
  const [managingCategory, setManagingCategory] = useState<string | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [renameInput, setRenameInput] = useState('');
  const [mergeTarget, setMergeTarget] = useState('');

  // Selection Mode State
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBatchMove, setShowBatchMove] = useState(false);
  const [batchMoveTarget, setBatchMoveTarget] = useState('');

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Item Management State
  const [editingItemIndex, setEditingItemIndex] = useState<number | null>(null);
  const [editingItemName, setEditingItemName] = useState('');
  const [editingIsPerishable, setEditingIsPerishable] = useState(false);
  const [editingShelfLife, setEditingShelfLife] = useState<string>('');
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);
  const [newItemName, setNewItemName] = useState('');

  // Drag & Drop State
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const dropTargetRef = React.useRef<string | null>(null);
  const dragStartPos = React.useRef({ x: 0, y: 0 });
  const isDragGesture = React.useRef(false);
  const autoScrollSpeed = React.useRef(0);
  const animationFrameId = React.useRef<number | null>(null);

  // Auto Scroll Loop
  useEffect(() => {
    if (!isDragging) {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
      }
      return;
    }

    const scrollLoop = () => {
      if (containerRef.current && autoScrollSpeed.current !== 0) {
        containerRef.current.scrollTop += autoScrollSpeed.current;
      }
      animationFrameId.current = requestAnimationFrame(scrollLoop);
    };
    scrollLoop();

    return () => {
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    };
  }, [isDragging]);

  const handleGlobalTouchMove = (e: any) => {
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    if (!isDragging && !isDragGesture.current) {
      const dx = clientX - dragStartPos.current.x;
      const dy = clientY - dragStartPos.current.y;
      if (Math.sqrt(dx*dx + dy*dy) > 10) {
        isDragGesture.current = true;
        setIsDragging(true);
      }
    }

    if (isDragGesture.current) {
      if (e.cancelable) e.preventDefault();
      setDragPosition({ x: clientX, y: clientY });
      
      const buffer = 80; // Reduced buffer to be more specific to edges
      const maxSpeed = 15;
      const vh = window.innerHeight;
      
      if (clientY < buffer) {
        autoScrollSpeed.current = -maxSpeed * (1 - clientY / buffer);
      } else if (clientY > vh - buffer) {
        autoScrollSpeed.current = maxSpeed * (1 - (vh - clientY) / buffer);
      } else {
        autoScrollSpeed.current = 0;
      }

      const elements = document.elementsFromPoint(clientX, clientY);
      const categoryEl = elements.find(el => el.getAttribute('data-category'));
      const category = categoryEl?.getAttribute('data-category');
      
      if (category !== dropTargetRef.current) {
        setDropTarget(category || null);
        dropTargetRef.current = category || null;
      }
    }
  };
  
  const handleGlobalTouchEnd = () => {
    window.removeEventListener('touchmove', handleGlobalTouchMove);
    window.removeEventListener('touchend', handleGlobalTouchEnd);
    window.removeEventListener('mousemove', handleGlobalTouchMove);
    window.removeEventListener('mouseup', handleGlobalTouchEnd);

    if (isDragGesture.current && dropTargetRef.current) {
      performBatchMove(dropTargetRef.current);
    }
    
    setIsDragging(false);
    isDragGesture.current = false;
    autoScrollSpeed.current = 0;
    setDropTarget(null);
    dropTargetRef.current = null;
  };

  const handleDragStart = (e: React.TouchEvent | React.MouseEvent, sceneId: string) => {
    if (!isSelectionMode || !selectedIds.has(sceneId)) return;
    
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    
    dragStartPos.current = { x: clientX, y: clientY };
    isDragGesture.current = false;
    
    // Use passive: false to allow preventing scroll on touch devices if needed, 
    // but we generally want to allow scroll unless we are dragging.
    // However, if we start a drag, we need to prevent default scrolling.
    window.addEventListener('touchmove', handleGlobalTouchMove, { passive: false });
    window.addEventListener('touchend', handleGlobalTouchEnd);
    window.addEventListener('mousemove', handleGlobalTouchMove);
    window.addEventListener('mouseup', handleGlobalTouchEnd);
  };

  useEffect(() => {
    loadCategories();
  }, []);

  const loadCategories = async () => {
    try {
      const cats = await getCategories();
      setExistingCategories(cats);
    } catch (e) {
      console.error("Failed to load categories", e);
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleExport = async () => {
    if (exporting || scenesLoading || scenesLoadError) return;
    const agreed = window.confirm(
      '导出的文件包含完整照片、物品名称及存放位置，可能涉及个人隐私。请妥善保管。当前版本尚不支持一键导入恢复。确定导出吗？'
    );
    if (!agreed) return;

    setExporting(true);
    try {
      // Fetch both sets from the server so the file is not a partial UI snapshot.
      const [allScenes, allCategories] = await Promise.all([getAllScenes(), getCategories()]);
      const contents = serializeSceneExport(allScenes, allCategories);
      const objectUrl = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
      try {
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = `Trace-export-${new Date().toISOString().slice(0, 10)}.json`;
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        // Do not revoke synchronously before the browser accepts the download.
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
      }
      showToast('导出已开始，请妥善保存文件');
    } catch (error) {
      console.error('Failed to export inventory', error);
      showToast('导出失败，未生成文件。请检查网络后重试');
    } finally {
      setExporting(false);
    }
  };

  // Group scenes by superCategory, including empty categories
  const groupedScenes = useMemo(() => {
    const groups: Record<string, SceneRecord[]> = {};
    const uncategorized: SceneRecord[] = [];

    // Initialize all existing categories with empty arrays
    existingCategories.forEach(cat => {
        groups[cat] = [];
    });

    scenes.forEach(scene => {
      if (scene.superCategory) {
        if (!groups[scene.superCategory]) {
          groups[scene.superCategory] = [];
        }
        groups[scene.superCategory].push(scene);
      } else {
        uncategorized.push(scene);
      }
    });

    return { groups, uncategorized };
  }, [scenes, existingCategories]);

  const allCategories = useMemo(() => {
    // Merge categories from scenes and explicitly saved categories
    const categories = new Set<string>(existingCategories);
    scenes.forEach(scene => {
      if (scene.superCategory) {
        categories.add(scene.superCategory);
      }
    });
    return Array.from(categories);
  }, [scenes, existingCategories]);

  const handleUpdateCategory = async (scene: SceneRecord, category: string | undefined) => {
    const updatedScene = { ...scene, superCategory: category };
    try {
      await updateScene(updatedScene);
      // Update local state instead of reload
      if (onUpdate) {
          onUpdate(updatedScene);
      }
      // Also update selectedScene so the modal reflects the change immediately
      setSelectedScene(updatedScene);
      showToast("分类已更新");
    } catch (e) {
      console.error("Failed to update scene", e);
      showToast("更新失败，请重试");
    }
  };

  const handleCreateCategory = async (name: string) => {
      if (!name.trim()) return;
      if (allCategories.includes(name.trim())) {
          showToast("空间名已存在");
          return;
      }
      try {
          await addCategory(name.trim());
          await loadCategories(); // Refresh list
          setNewCategoryName('');
          setShowAddCategory(false);
          showToast(`空间 "${name}" 已创建`);
      } catch (e) {
          console.error("Failed to create category", e);
          showToast("创建失败");
      }
  };

  const handleRename = async () => {
      if (!managingCategory || !renameInput.trim()) return;
      if (allCategories.includes(renameInput.trim())) {
          showToast("空间名已存在");
          return;
      }
      try {
          await updateCategoryName(managingCategory, renameInput.trim());
          // Refresh everything
          await loadCategories();
          if (onReload) {
              await onReload();
          }
          setManagingCategory(null);
          showToast("改名成功"); 
      } catch (e) {
          console.error("Failed to rename", e);
          showToast("改名失败");
      }
  };

  const handleMerge = async () => {
      if (!managingCategory || !mergeTarget) return;
      try {
          await updateCategoryName(managingCategory, mergeTarget);
          await loadCategories();
          if (onReload) {
              await onReload();
          }
          setManagingCategory(null);
          showToast("合并成功");
      } catch (e) {
          console.error("Failed to merge", e);
          showToast("合并失败");
      }
  };

  const handleDeleteCategory = async () => {
      if (!managingCategory) return;
      // Double check emptiness
      const count = groupedScenes.groups[managingCategory]?.length || 0;
      if (count > 0) {
          showToast("请先清空或移动角落");
          return;
      }
      try {
          await deleteCategory(managingCategory);
          await loadCategories();
          setManagingCategory(null);
          showToast("空间已删除");
      } catch (e) {
          console.error("Failed to delete", e);
          showToast("删除失败");
      }
  };

  const handleUpdateSceneName = async (scene: SceneRecord, newName: string) => {
    if (!newName.trim()) return;
    const updatedScene = { ...scene, locationCategory: newName.trim() };
    try {
      await updateScene(updatedScene);
      if (onUpdate) {
        onUpdate(updatedScene);
      }
      setSelectedScene(updatedScene);
      showToast("角落名称已更新");
    } catch (e) {
      console.error("Failed to update scene name", e);
      showToast("更新失败");
    }
  };

  // Batch Operations
  const toggleSelection = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`确定要删除选中的 ${selectedIds.size} 个角落吗？`)) return;

    try {
      await Promise.all((Array.from(selectedIds) as string[]).map(id => deleteScene(id)));
      // Instead of reload, call onDelete for each ID to update parent state
      selectedIds.forEach(id => onDelete(id));
      setSelectedIds(new Set());
      setIsSelectionMode(false);
      showToast("批量删除成功");
    } catch (e) {
      console.error("Batch delete failed", e);
      showToast("批量删除失败");
    }
  };

  const performBatchMove = async (targetCategory: string) => {
    if (selectedIds.size === 0 || !targetCategory) return;

    try {
      const scenesToUpdate = scenes.filter(s => selectedIds.has(s.id));
      const updatedScenes = scenesToUpdate.map(scene => ({ ...scene, superCategory: targetCategory }));
      
      await Promise.all(updatedScenes.map(scene => updateScene(scene)));
      
      // Update parent state for each scene
      updatedScenes.forEach(scene => {
          if (onUpdate) onUpdate(scene);
      });

      setSelectedIds(new Set());
      setIsSelectionMode(false);
      setShowBatchMove(false);
      showToast(`已移动到 ${targetCategory}`);
    } catch (e) {
      console.error("Batch move failed", e);
      showToast("移动失败");
    }
  };

  const handleBatchMove = () => {
    performBatchMove(batchMoveTarget);
  };

  // Item Management
  const handleAddItem = async () => {
    if (!selectedScene || !newItemName.trim()) return;
    
    // Check if we have extended details from modal (if we decide to use modal for add too)
    // For now, keep quick add simple, or maybe open modal for add?
    // Let's keep quick add simple for now, but user can edit later.
    
    const newItem: AIItem = {
      itemName: newItemName.trim(),
      category: '手动添加',
      scene: SceneType.OTHER,
      preciseLocation: '',
      remarks: '',
      box_2d: [0, 0, 0, 0],
      isPerishable: false
    };

    const updatedItems = [...selectedScene.items, newItem];
    const updatedScene = { ...selectedScene, items: updatedItems };

    try {
      await updateScene(updatedScene);
      if (onUpdate) onUpdate(updatedScene);
      setSelectedScene(updatedScene);
      setNewItemName('');
      setShowAddItem(false);
      showToast("物品已添加");
    } catch (e) {
      console.error("Failed to add item", e);
      showToast("添加失败");
    }
  };

  const handleDeleteItem = async (index: number) => {
    if (!selectedScene) return;
    
    const updatedItems = [...selectedScene.items];
    updatedItems.splice(index, 1);
    const updatedScene = { ...selectedScene, items: updatedItems };

    try {
      await updateScene(updatedScene);
      if (onUpdate) onUpdate(updatedScene);
      setSelectedScene(updatedScene);
      showToast("物品已删除");
    } catch (e) {
      console.error("Failed to delete item", e);
      showToast("删除失败");
    }
  };

  const handleUpdateItem = async () => {
    if (!selectedScene || editingItemIndex === null || !editingItemName.trim()) return;
    
    const updatedItems = [...selectedScene.items];
    const shelfLife = editingIsPerishable && editingShelfLife ? parseInt(editingShelfLife) : undefined;
    
    updatedItems[editingItemIndex] = { 
        ...updatedItems[editingItemIndex], 
        itemName: editingItemName.trim(),
        isPerishable: editingIsPerishable,
        shelfLifeDays: shelfLife
    };
    const updatedScene = { ...selectedScene, items: updatedItems };

    try {
      await updateScene(updatedScene);
      if (onUpdate) onUpdate(updatedScene);
      setSelectedScene(updatedScene);
      setItemModalOpen(false);
      setEditingItemIndex(null);
      showToast("物品已更新");
    } catch (e) {
      console.error("Failed to update item", e);
      showToast("更新失败");
    }
  };

  const handleUpdateItemName = async (index: number, name: string) => {
    if (!selectedScene || !name.trim()) return;
    
    const updatedItems = [...selectedScene.items];
    updatedItems[index] = { ...updatedItems[index], itemName: name.trim() };
    const updatedScene = { ...selectedScene, items: updatedItems };

    try {
      await updateScene(updatedScene);
      if (onUpdate) onUpdate(updatedScene);
      setSelectedScene(updatedScene);
      setEditingItemIndex(null);
      showToast("物品已更新");
    } catch (e) {
      console.error("Failed to update item", e);
      showToast("更新失败");
    }
  };

  // Category Sorting Handlers
  const handleCategoryDragStart = (e: React.DragEvent, category: string) => {
    e.stopPropagation();
    setDraggingCategory(category);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleCategoryDragOver = (e: React.DragEvent, targetCategory: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggingCategory || draggingCategory === targetCategory) return;
    
    const oldIndex = existingCategories.indexOf(draggingCategory);
    const newIndex = existingCategories.indexOf(targetCategory);
    
    if (oldIndex !== -1 && newIndex !== -1) {
        const newCategories = [...existingCategories];
        newCategories.splice(oldIndex, 1);
        newCategories.splice(newIndex, 0, draggingCategory);
        setExistingCategories(newCategories);
    }
  };

  const handleCategoryDragEnd = async () => {
    if (draggingCategory) {
        try {
           await updateCategoryOrder(existingCategories);
        } catch (e) {
           console.error("Failed to save order", e);
           showToast("排序保存失败");
        }
    }
    setDraggingCategory(null);
  };

  // Touch Handlers for Category Sorting
  const handleCategoryTouchMove = React.useCallback((e: any) => {
      e.preventDefault();
      const touch = e.touches ? e.touches[0] : e;
      
      const element = document.elementFromPoint(touch.clientX, touch.clientY);
      const targetCategoryEl = element?.closest('[data-category]');
      const targetCategory = targetCategoryEl?.getAttribute('data-category');
      
      const currentDrag = draggingCategoryRef.current;
      
      if (targetCategory && currentDrag && targetCategory !== currentDrag) {
         setExistingCategories(prev => {
             const oldIndex = prev.indexOf(currentDrag);
             const newIndex = prev.indexOf(targetCategory);
             if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
                 const newCats = [...prev];
                 newCats.splice(oldIndex, 1);
                 newCats.splice(newIndex, 0, currentDrag);
                 return newCats;
             }
             return prev;
         });
      }
  }, []);

  const handleCategoryTouchEnd = React.useCallback(async () => {
      window.removeEventListener('touchmove', handleCategoryTouchMove);
      window.removeEventListener('touchend', handleCategoryTouchEnd);
      
      if (draggingCategoryRef.current) {
          try {
             await updateCategoryOrder(categoriesRef.current);
          } catch (e) {
             console.error("Failed to save order", e);
             showToast("排序保存失败");
          }
      }
      setDraggingCategory(null);
  }, [handleCategoryTouchMove]); // showToast dependency omitted but captured safely

  const handleCategoryTouchStart = (e: React.TouchEvent, category: string) => {
      e.stopPropagation();
      setDraggingCategory(category);
      
      window.addEventListener('touchmove', handleCategoryTouchMove, { passive: false });
      window.addEventListener('touchend', handleCategoryTouchEnd);
  };

  return (
    <div className="flex flex-col h-full bg-light select-none">
      {/* Drag Avatar */}
      {isDragging && (
        <div 
          className="fixed z-[150] pointer-events-none bg-white/90 backdrop-blur rounded-2xl p-4 shadow-2xl border-2 border-primary transform -translate-x-1/2 -translate-y-1/2 flex items-center gap-3"
          style={{ left: dragPosition.x, top: dragPosition.y }}
        >
           <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
             <i className="fa-solid fa-layer-group text-xl text-gray-400"></i>
           </div>
           <div>
             <p className="font-bold text-black text-sm">移动 {selectedIds.size} 个角落</p>
             <p className="text-xs text-primary font-bold">{dropTarget ? `松手移动到: ${dropTarget}` : '拖动到空间分类...'}</p>
           </div>
        </div>
      )}

      {/* Item Edit Modal */}
      {itemModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-6 w-full max-w-xs shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold text-gray-900 mb-4">编辑物品</h3>
            
            <input 
              type="text" 
              value={editingItemName}
              onChange={e => setEditingItemName(e.target.value)}
              placeholder="物品名称"
              autoFocus
              className="w-full bg-gray-50 border-none rounded-2xl px-4 py-3 text-lg font-bold placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-primary mb-6"
              onKeyDown={e => {
                if (e.key === 'Enter') handleUpdateItem();
              }}
            />
            
            <div className="bg-gray-50 rounded-2xl p-4 mb-6">
               <label className="flex items-center gap-3 mb-3 cursor-pointer">
                 <input 
                   type="checkbox"
                   checked={editingIsPerishable}
                   onChange={e => setEditingIsPerishable(e.target.checked)}
                   className="w-5 h-5 rounded-md text-primary focus:ring-primary"
                 />
                 <span className="font-bold text-gray-700">是生鲜/有保质期</span>
               </label>
               
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
              <button 
                onClick={() => setItemModalOpen(false)}
                className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-2xl active:scale-95 transition-all"
              >
                取消
              </button>
              <button 
                onClick={handleUpdateItem}
                disabled={!editingItemName.trim()}
                className="flex-1 py-3 bg-black text-white font-bold rounded-2xl active:scale-95 transition-all shadow-lg disabled:opacity-50"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-6 left-1/2 transform -translate-x-1/2 z-[120] bg-black/80 text-white px-4 py-2 rounded-full text-sm font-medium animate-in fade-in slide-in-from-top-4">
          {toastMessage}
        </div>
      )}

      <div className="px-6 py-6 pt-6 flex items-center justify-between">
        <div>
           <h1 className="text-3xl font-bold text-black">百宝箱</h1>
           <p className="text-gray-400 text-sm font-medium mt-1">
             {scenes.length} 个角落 · {scenes.reduce((total, scene) => total + (scene.items?.length || 0), 0)} 件物品 · {allCategories.length} 个空间
           </p>
        </div>
        <div className="flex gap-2">
            {!isSelectionMode && (
              <button
                type="button"
                aria-label="导出完整收纳记录"
                title="导出完整记录（含照片）"
                onClick={handleExport}
                disabled={exporting || scenesLoading || scenesLoadError}
                className="w-10 h-10 rounded-full bg-white text-black shadow-sm disabled:opacity-40 active:scale-95"
              >
                <i className={exporting ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-download'} aria-hidden="true"></i>
              </button>
            )}
            <button 
              onClick={() => {
                  setIsSelectionMode(!isSelectionMode);
                  setSelectedIds(new Set());
              }}
              className={`px-4 h-10 rounded-full font-bold text-sm transition-all ${isSelectionMode ? 'bg-black text-white' : 'bg-white text-black'}`}
            >
              {isSelectionMode ? '完成' : '多选'}
            </button>
            {!isSelectionMode && (
              <button 
                onClick={() => setShowAddCategory(true)}
                aria-label="新建空间"
                className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-black shadow-sm active:scale-90 transition-all"
              >
                <i className="fa-solid fa-folder-plus"></i>
              </button>
            )}
        </div>
      </div>

      {showAddCategory && (
        <div className="mx-6 mb-6 p-4 bg-white rounded-2xl shadow-sm animate-in slide-in-from-top-2">
           <h3 className="text-sm font-bold text-gray-500 mb-2">新建空间分类</h3>
           <div className="flex gap-2">
             <input 
               type="text" 
               name="newCategoryName"
               value={newCategoryName}
               onChange={(e) => setNewCategoryName(e.target.value)}
               placeholder="例如：书房、客厅..."
               className="flex-1 bg-gray-50 rounded-xl px-4 py-3 text-black font-bold outline-none focus:ring-2 focus:ring-primary"
               onKeyDown={(e) => {
                   if (e.key === 'Enter') {
                       handleCreateCategory(newCategoryName);
                   }
               }}
             />
             <button 
                onClick={() => handleCreateCategory(newCategoryName)}
                className="bg-primary text-white px-6 rounded-xl font-bold active:scale-95 transition-all"
             >
               确定
             </button>
           </div>
        </div>
      )}

      <div ref={containerRef} className="flex-1 overflow-y-auto px-6 pb-40 no-scrollbar space-y-8">
        {scenesLoadError ? (
          <div role="alert" className="mx-auto mt-14 max-w-md rounded-3xl border border-orange-100 bg-white px-6 py-8 text-center shadow-sm">
            <i className="fa-solid fa-triangle-exclamation mb-4 text-3xl text-orange-500" aria-hidden="true"></i>
            <h2 className="text-lg font-bold text-gray-900">暂时无法读取收纳记录</h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-500">
              可能是网络或服务器问题。这不代表你保存的物品已经被删除。
            </p>
            <button
              type="button"
              onClick={onRetryLoad}
              className="mt-5 rounded-2xl bg-black px-5 py-3 text-sm font-bold text-white"
            >重新加载</button>
          </div>
        ) : scenesLoading ? (
          <div role="status" className="mx-auto mt-20 text-center text-sm font-medium text-gray-500">
            <i className="fa-solid fa-circle-notch fa-spin mr-2" aria-hidden="true"></i>
            正在加载收纳记录…
          </div>
        ) : scenes.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-400">
            <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-6">
              <i className="fa-solid fa-box-open text-4xl opacity-20"></i>
            </div>
            <p className="text-lg font-bold text-gray-500">百宝箱是空的</p>
            <p className="text-sm mt-2 text-center leading-relaxed">打开「记东西」拍下一处收纳空间，
              <span className="block">让 Trace 帮你记住里面的物品。</span>
            </p>
          </div>
        ) : (
          <>
            {/* Render Sorted Categories */}
            {existingCategories.map(category => {
               const groupScenes = groupedScenes.groups[category];
               if (!groupScenes) return null;
               
               return (
              <div 
                key={category} 
                data-category={category} 
                className={`animate-in fade-in slide-in-from-bottom-4 duration-500 transition-all rounded-3xl ${dropTarget === category ? 'bg-primary/10 ring-4 ring-primary/20 p-2 -mx-2' : ''} ${draggingCategory === category ? 'opacity-40' : ''}`}
                onDragOver={(e) => handleCategoryDragOver(e, category)}
              >
                <div className="flex items-center justify-between mb-3">
                    <div 
                        className="flex items-center gap-2 cursor-pointer active:opacity-70 transition-opacity select-none"
                        onClick={() => {
                            const newSet = new Set(collapsedCategories);
                            if (newSet.has(category)) newSet.delete(category);
                            else newSet.add(category);
                            setCollapsedCategories(newSet);
                        }}
                    >
                        <i className={`fa-solid fa-chevron-right text-gray-400 text-sm transition-transform duration-200 ${!collapsedCategories.has(category) ? 'rotate-90' : ''}`}></i>
                        <h2 className="text-xl font-bold text-black">{category}</h2>
                        <span className="bg-gray-200 text-gray-600 px-2 py-0.5 rounded-md text-xs font-bold">{groupScenes.length}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={(e) => {
                                e.stopPropagation();
                                setManagingCategory(category);
                                setRenameInput('');
                                setMergeTarget('');
                            }}
                            className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 hover:bg-gray-200 hover:text-gray-600 active:scale-95 transition-all"
                        >
                            <i className="fa-solid fa-ellipsis"></i>
                        </button>
                        <div 
                            draggable
                            onDragStart={(e) => handleCategoryDragStart(e, category)}
                            onDragEnd={handleCategoryDragEnd}
                            onTouchStart={(e) => handleCategoryTouchStart(e, category)}
                            className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 cursor-grab active:cursor-grabbing hover:bg-gray-200 hover:text-gray-600 transition-all"
                        >
                            <i className="fa-solid fa-sort"></i>
                        </div>
                    </div>
                </div>
                {!collapsedCategories.has(category) && (
                    <div className="grid grid-cols-2 gap-4">
                    {groupScenes.map(scene => (
                        <SceneCard 
                        key={scene.id} 
                        scene={scene} 
                        onClick={() => isSelectionMode ? toggleSelection(scene.id) : setSelectedScene(scene)} 
                        onLongPress={() => {
                          if (!isSelectionMode) {
                            setIsSelectionMode(true);
                            toggleSelection(scene.id);
                          }
                        }}
                        onDragStart={(e) => handleDragStart(e, scene.id)}
                        isSelected={selectedIds.has(scene.id)}
                        isSelectionMode={isSelectionMode}
                        />
                    ))}
                    </div>
                )}
              </div>
            )})}
            
            {/* Render Remaining Unsorted Categories (if any) */}
            {Object.entries(groupedScenes.groups)
                .filter(([cat]) => !existingCategories.includes(cat))
                .map(([category, groupScenes]: [string, SceneRecord[]]) => (
              <div key={category} data-category={category} className={`animate-in fade-in slide-in-from-bottom-4 duration-500 transition-all rounded-3xl ${dropTarget === category ? 'bg-primary/10 ring-4 ring-primary/20 p-2 -mx-2' : ''}`}>
                <div className="flex items-center justify-between mb-3">
                    <div 
                        className="flex items-center gap-2 cursor-pointer active:opacity-70 transition-opacity select-none"
                        onClick={() => {
                            const newSet = new Set(collapsedCategories);
                            if (newSet.has(category)) newSet.delete(category);
                            else newSet.add(category);
                            setCollapsedCategories(newSet);
                        }}
                    >
                        <i className={`fa-solid fa-chevron-right text-gray-400 text-sm transition-transform duration-200 ${!collapsedCategories.has(category) ? 'rotate-90' : ''}`}></i>
                        <h2 className="text-xl font-bold text-black">{category}</h2>
                        <span className="bg-gray-200 text-gray-600 px-2 py-0.5 rounded-md text-xs font-bold">{groupScenes.length}</span>
                    </div>
                    {/* No Drag Handle for Unsaved Categories */}
                    <button 
                        onClick={(e) => {
                            e.stopPropagation();
                            setManagingCategory(category);
                            setRenameInput('');
                            setMergeTarget('');
                        }}
                        className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 hover:bg-gray-200 active:scale-95 transition-all"
                    >
                        <i className="fa-solid fa-ellipsis"></i>
                    </button>
                </div>
                {!collapsedCategories.has(category) && (
                    <div className="grid grid-cols-2 gap-4">
                    {groupScenes.map(scene => (
                        <SceneCard 
                        key={scene.id} 
                        scene={scene} 
                        onClick={() => isSelectionMode ? toggleSelection(scene.id) : setSelectedScene(scene)} 
                        onLongPress={() => {
                          if (!isSelectionMode) {
                            setIsSelectionMode(true);
                            toggleSelection(scene.id);
                          }
                        }}
                        onDragStart={(e) => handleDragStart(e, scene.id)}
                        isSelected={selectedIds.has(scene.id)}
                        isSelectionMode={isSelectionMode}
                        />
                    ))}
                    </div>
                )}
              </div>
            ))}

            {/* Render Uncategorized Scenes */}
            {groupedScenes.uncategorized.length > 0 && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100">
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-xl font-bold text-gray-400">未分类</h2>
                  <span className="bg-gray-100 text-gray-400 px-2 py-0.5 rounded-md text-xs font-bold">{groupedScenes.uncategorized.length}</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {groupedScenes.uncategorized.map(scene => (
                    <SceneCard 
                      key={scene.id} 
                      scene={scene} 
                      onClick={() => isSelectionMode ? toggleSelection(scene.id) : setSelectedScene(scene)} 
                      onLongPress={() => {
                        if (!isSelectionMode) {
                          setIsSelectionMode(true);
                          toggleSelection(scene.id);
                        }
                      }}
                      isSelected={selectedIds.has(scene.id)}
                      isSelectionMode={isSelectionMode}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Batch Action Bar */}
      {isSelectionMode && (
        <div className="fixed bottom-24 left-6 right-6 z-[100] animate-in slide-in-from-bottom-4">
          <div className="bg-black/90 backdrop-blur-md text-white rounded-2xl p-4 shadow-2xl flex items-center justify-between">
            <span className="font-bold ml-2">已选 {selectedIds.size} 项</span>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowBatchMove(true)}
                disabled={selectedIds.size === 0}
                className="bg-white/20 px-4 py-2 rounded-xl text-sm font-bold disabled:opacity-50 active:scale-95 transition-all"
              >
                移动到...
              </button>
              <button 
                onClick={handleBatchDelete}
                disabled={selectedIds.size === 0}
                className="bg-red-500 px-4 py-2 rounded-xl text-sm font-bold disabled:opacity-50 active:scale-95 transition-all"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Move Modal */}
      {showBatchMove && (
        <div className="fixed inset-0 z-[140] bg-black/50 flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-black">移动到空间</h3>
              <button onClick={() => setShowBatchMove(false)} className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-gray-500 active:scale-95 transition-all">
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div className="space-y-4">
              <select 
                value={batchMoveTarget} 
                onChange={e => setBatchMoveTarget(e.target.value)}
                className="w-full bg-gray-50 rounded-xl px-4 py-3 text-black font-bold outline-none focus:ring-2 focus:ring-primary appearance-none"
              >
                <option value="">选择目标空间...</option>
                {allCategories.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <button 
                onClick={handleBatchMove}
                disabled={!batchMoveTarget}
                className="w-full bg-primary text-white py-3 rounded-xl font-bold disabled:opacity-50 active:scale-95 transition-all"
              >
                确认移动
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Management Modal */}
      {managingCategory && (
        <div className="fixed inset-0 z-[130] bg-black/50 flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-black">管理空间 "{managingCategory}"</h3>
              <button 
                onClick={() => setManagingCategory(null)} 
                className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-gray-500 active:scale-95 transition-all"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            
            <div className="space-y-6">
              {/* Rename Section */}
              <div>
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-2">重命名</label>
                <div className="flex gap-2">
                  <input 
                    type="text"
                    name="renameCategory"
                    value={renameInput}
                    onChange={e => setRenameInput(e.target.value)}
                    placeholder={managingCategory}
                    className="flex-1 bg-gray-50 rounded-xl px-4 py-3 text-black font-bold outline-none focus:ring-2 focus:ring-primary"
                  />
                  <button 
                    onClick={handleRename}
                    disabled={!renameInput.trim() || renameInput.trim() === managingCategory}
                    className="bg-primary text-white px-4 rounded-xl font-bold disabled:opacity-50 active:scale-95 transition-all"
                  >
                    保存
                  </button>
                </div>
              </div>

              {/* Merge Section */}
              <div>
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-2">合并到</label>
                <div className="flex gap-2">
                  <select 
                    value={mergeTarget} 
                    onChange={e => setMergeTarget(e.target.value)}
                    className="flex-1 bg-gray-50 rounded-xl px-4 py-3 text-black font-bold outline-none focus:ring-2 focus:ring-primary appearance-none"
                  >
                    <option value="">选择目标空间...</option>
                    {allCategories.filter(c => c !== managingCategory).map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <button 
                    onClick={handleMerge}
                    disabled={!mergeTarget}
                    className="bg-primary text-white px-4 rounded-xl font-bold disabled:opacity-50 active:scale-95 transition-all"
                  >
                    合并
                  </button>
                </div>
              </div>

              {/* Delete Section */}
              <div className="pt-4 border-t border-gray-100">
                <button 
                  onClick={handleDeleteCategory}
                  disabled={groupedScenes.groups[managingCategory]?.length > 0}
                  className="w-full bg-red-50 text-red-500 py-3 rounded-xl font-bold disabled:opacity-50 disabled:bg-gray-50 disabled:text-gray-400 active:scale-95 transition-all"
                >
                  删除空间
                  {groupedScenes.groups[managingCategory]?.length > 0 && (
                    <span className="text-xs font-normal block mt-1">请先清空或移动角落</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 详情模态框 */}
      {selectedScene && (
        <div className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-sm animate-in fade-in duration-300 flex items-center justify-center p-4">
          {/* Floating Buttons */}
          {/* Delete Confirmation Modal */}
          {showDeleteConfirm && (
            <div className="fixed inset-0 z-[130] bg-black/50 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
              <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4 mx-auto">
                  <i className="fa-solid fa-triangle-exclamation text-red-500 text-xl"></i>
                </div>
                <h3 className="text-xl font-bold text-black mb-2 text-center">确认删除?</h3>
                <p className="text-gray-500 mb-8 text-center text-sm">删除后无法恢复，确定要删除这个角落吗？</p>
                <div className="flex gap-3">
                  <button 
                    onClick={() => setShowDeleteConfirm(false)}
                    className="flex-1 py-3.5 rounded-2xl bg-gray-100 text-gray-700 font-bold active:scale-95 transition-transform"
                  >
                    取消
                  </button>
                  <button 
                    onClick={() => {
                      onDelete(selectedScene.id);
                      setShowDeleteConfirm(false);
                      setSelectedScene(null);
                    }}
                    className="flex-1 py-3.5 rounded-2xl bg-red-500 text-white font-bold shadow-lg shadow-red-500/30 active:scale-95 transition-transform"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl max-h-[80vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300 relative group">
            {/* Floating Buttons inside card */}
            <button 
              onClick={() => { setSelectedScene(null); setIsEditingName(false); }} 
              className="absolute top-4 left-4 z-[120] w-10 h-10 bg-black/20 backdrop-blur-md rounded-full flex items-center justify-center text-white active:bg-black/40 transition-all border border-white/10 shadow-lg"
            >
              <i className="fa-solid fa-chevron-left text-lg"></i>
            </button>
            
            <button 
              onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(true); }} 
              className="absolute top-4 right-4 z-[120] w-10 h-10 bg-red-500/80 backdrop-blur-md rounded-full flex items-center justify-center text-white active:bg-red-600 transition-all shadow-lg border border-white/10"
            >
              <i className="fa-solid fa-trash-can text-lg"></i>
            </button>

            <div className="overflow-y-auto flex-1 overscroll-contain [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
              <img src={selectedScene.fullImageUrl} className="w-full h-auto pointer-events-none" draggable={false} />
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1 mr-4">
                    {isEditingName ? (
                      <input 
                        autoFocus
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={() => {
                          if (editingName !== selectedScene.locationCategory) {
                             handleUpdateSceneName(selectedScene, editingName);
                          }
                          setIsEditingName(false);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.blur();
                          }
                        }}
                        className="text-2xl font-bold text-black mb-1 w-full border-b-2 border-primary outline-none bg-transparent"
                      />
                    ) : (
                      <h2 
                        onClick={() => {
                          setEditingName(selectedScene.locationCategory);
                          setIsEditingName(true);
                        }}
                        className="text-2xl font-bold text-black mb-1 cursor-pointer hover:bg-gray-50 rounded px-1 -ml-1 transition-colors flex items-center gap-2 group"
                      >
                        {selectedScene.locationCategory}
                        <i className="fa-solid fa-pen text-xs text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity"></i>
                      </h2>
                    )}
                    <p className="text-gray-400 text-sm font-medium">
                      <i className="fa-regular fa-clock mr-2"></i>
                      {new Date(selectedScene.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>

                {/* Category Selector */}
                <div className="mb-6">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-2">所属空间</label>
                  <div className="flex flex-wrap gap-2">
                     <button
                        onClick={() => handleUpdateCategory(selectedScene, undefined)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${!selectedScene.superCategory ? 'bg-black text-white' : 'bg-gray-100 text-gray-500'}`}
                      >
                        未分类
                      </button>
                      {allCategories.map(cat => (
                        <button
                          key={cat}
                          onClick={() => handleUpdateCategory(selectedScene, cat)}
                          className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${selectedScene.superCategory === cat ? 'bg-black text-white' : 'bg-gray-100 text-gray-500'}`}
                        >
                          {cat}
                        </button>
                      ))}
                       {/* Input for new category inline */}
                       <div className="relative flex items-center">
                          <input 
                            type="text" 
                            name="newCategoryInline"
                            placeholder="+ 新空间"
                            className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-bold outline-none w-24 focus:w-32 transition-all"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleUpdateCategory(selectedScene, e.currentTarget.value);
                                e.currentTarget.value = '';
                              }
                            }}
                          />
                       </div>
                  </div>
                </div>
                
                <div className="flex flex-wrap gap-2">
                  {selectedScene.items.map((it, idx) => (
                    <span 
                        key={idx} 
                        className={`group relative px-3 py-1.5 rounded-xl text-sm font-bold cursor-pointer transition-colors pr-8 border ${
                            it.isPerishable 
                              ? 'bg-orange-50 text-orange-600 border-orange-100 hover:bg-orange-100' 
                              : 'bg-primary/10 text-primary border-transparent hover:bg-primary/20'
                        }`}
                        onClick={() => {
                          setEditingItemIndex(idx);
                          setEditingItemName(it.itemName);
                          setEditingIsPerishable(!!it.isPerishable);
                          setEditingShelfLife(it.shelfLifeDays ? it.shelfLifeDays.toString() : '');
                          setItemModalOpen(true);
                        }}
                      >
                        {it.isPerishable && <i className="fa-solid fa-clock mr-1.5 text-xs opacity-70"></i>}
                        {it.itemName}
                        {it.isPerishable && it.shelfLifeDays && <span className="ml-1 opacity-70 text-xs">({it.shelfLifeDays}天)</span>}
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteItem(idx);
                          }}
                          className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white/50 text-current flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500 hover:text-white"
                        >
                          <i className="fa-solid fa-xmark text-[10px]"></i>
                        </button>
                    </span>
                  ))}
                  
                  {/* Add Item Button/Input */}
                  {showAddItem ? (
                    <input 
                      autoFocus
                      type="text"
                      placeholder="新物品..."
                      value={newItemName}
                      onChange={e => setNewItemName(e.target.value)}
                      onBlur={() => {
                        if (newItemName.trim()) {
                            handleAddItem();
                        } else {
                            setShowAddItem(false);
                        }
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleAddItem();
                      }}
                      className="bg-white border-2 border-gray-200 text-black px-3 py-1.5 rounded-xl text-sm font-bold outline-none w-32 focus:border-primary"
                    />
                  ) : (
                    <button 
                      onClick={() => setShowAddItem(true)}
                      className="bg-gray-100 text-gray-400 px-3 py-1.5 rounded-xl text-sm font-bold hover:bg-gray-200 hover:text-gray-600 transition-colors"
                    >
                      <i className="fa-solid fa-plus mr-1"></i>
                      添加
                    </button>
                  )}
              </div>
            </div>
          </div>
        </div>
        </div>
      )}
    </div>
  );
};

const SceneCard: React.FC<{ 
  scene: SceneRecord; 
  onClick: () => void;
  onLongPress: () => void;
  onDragStart?: (e: React.TouchEvent | React.MouseEvent) => void;
  isSelected?: boolean;
  isSelectionMode?: boolean;
}> = ({ scene, onClick, onLongPress, onDragStart, isSelected, isSelectionMode }) => {
  const timerRef = React.useRef<any>(null);

  const hasPerishable = scene.items && scene.items.some(item => item.isPerishable);

  const handleStart = (e: React.TouchEvent | React.MouseEvent) => {
    if (onDragStart) {
        onDragStart(e);
    }
    timerRef.current = setTimeout(() => {
      onLongPress();
      if (navigator.vibrate) navigator.vibrate(50);
    }, 500);
  };

  const handleEnd = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  return (
    <div 
      onClick={onClick}
      onMouseDown={handleStart}
      onMouseUp={handleEnd}
      onMouseLeave={handleEnd}
      onTouchStart={handleStart}
      onTouchEnd={handleEnd}
      onTouchMove={handleEnd}
      className={`relative bg-white rounded-3xl overflow-hidden border shadow-sm active:scale-95 transition-all select-none ${isSelected ? 'border-primary ring-2 ring-primary ring-offset-2' : 'border-gray-100'}`}
    >
      {isSelectionMode && (
        <div className={`absolute top-2 right-2 w-6 h-6 rounded-full border-2 flex items-center justify-center z-10 ${isSelected ? 'bg-primary border-primary' : 'bg-white/50 border-white'}`}>
          {isSelected && <i className="fa-solid fa-check text-white text-xs"></i>}
        </div>
      )}
      {!isSelectionMode && hasPerishable && (
        <div className="absolute top-2 right-2 bg-orange-500 text-white px-2 py-1 rounded-full text-[10px] font-bold flex items-center gap-1 z-10 shadow-lg border border-white/20">
          <i className="fa-solid fa-clock"></i>
          <span>生鲜</span>
        </div>
      )}
      <div className="aspect-square overflow-hidden bg-gray-50 relative">
        <img src={scene.fullImageUrl} className="w-full h-full object-cover pointer-events-none" draggable={false} alt={scene.locationCategory} />
        {/* Overlay when selected in selection mode */}
        {isSelectionMode && isSelected && (
          <div className="absolute inset-0 bg-primary/20"></div>
        )}
      </div>
      <div className="p-4">
        <p className="text-sm font-bold text-black truncate mb-1">{scene.locationCategory}</p>
        <div className="flex flex-wrap items-center justify-between gap-1">
          <p className="text-xs text-gray-400 font-medium">{new Date(scene.timestamp).toLocaleDateString()}</p>
          <span className="text-xs font-medium text-primary">{scene.items?.length || 0} 件</span>
        </div>
      </div>
    </div>
  );
};

export default GalleryView;
