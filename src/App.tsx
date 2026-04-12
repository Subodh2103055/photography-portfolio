import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CATEGORIES, PHOTOS as INITIAL_PHOTOS } from './constants';
import { Category, Photo } from './types';
import { cn } from './lib/utils';
import { Camera, Instagram, Mail, Facebook, Globe, Loader2, ChevronDown, Wand2, CheckCircle2, AlertCircle, Heart, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import { db, auth, googleProvider } from './firebase';
import { signInWithPopup } from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  increment, 
  onSnapshot, 
  collection, 
  query, 
  orderBy, 
  limit, 
  serverTimestamp,
  deleteDoc,
  runTransaction
} from 'firebase/firestore';

const CalendarDigit = ({ digit }: { digit: string; key?: string }) => (
  <motion.div 
    initial={{ rotateX: -90, opacity: 0 }}
    animate={{ rotateX: 0, opacity: 1 }}
    transition={{ type: "spring", damping: 12, stiffness: 100 }}
    className="relative w-10 h-14 md:w-14 md:h-20 bg-[#1a1a1a] rounded-lg border border-white/10 shadow-2xl flex items-center justify-center overflow-hidden"
  >
    <div className="absolute inset-0 flex flex-col">
      <div className="h-1/2 border-b border-black/40 bg-gradient-to-b from-white/5 to-transparent" />
      <div className="h-1/2 bg-gradient-to-t from-white/5 to-transparent" />
    </div>
    <span className="relative z-10 text-2xl md:text-4xl font-mono font-bold text-[#5f8d8d] tabular-nums">
      {digit}
    </span>
  </motion.div>
);

const CalendarCounter = ({ count }: { count: number }) => {
  const digits = count.toString().padStart(4, '0').split('');
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex gap-2 md:gap-3 justify-center items-center">
        {digits.map((d, i) => (
          <CalendarDigit key={`${i}-${d}`} digit={d} />
        ))}
      </div>
      <span className="text-[10px] uppercase tracking-[0.4em] text-gray-500 font-medium">Moments Captured</span>
    </div>
  );
};

export default function App() {
  const [activeCategory, setActiveCategory] = useState<Category>('All');
  const [view, setView] = useState<'gallery' | 'about'>('gallery');
  const [photos, setPhotos] = useState<Photo[]>(INITIAL_PHOTOS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const [processingLikes, setProcessingLikes] = useState<Record<string, boolean>>({});
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Helper to make IDs safe for Firestore document paths (removes slashes)
  const getSafeId = (id: string) => id.replace(/\//g, '___');
  const getOriginalId = (safeId: string) => safeId.replace(/___/g, '/');
  
  // Pagination State
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalPhotoCount, setTotalPhotoCount] = useState<number>(0);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  
  // Firebase Stats State
  const [photoStats, setPhotoStats] = useState<Record<string, { likesCount: number }>>({});
  const [userLikes, setUserLikes] = useState<Record<string, boolean>>({});
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  
  // Photo Captions State
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [isEditingCaption, setIsEditingCaption] = useState(false);
  const [editingText, setEditingText] = useState('');
  
  // Photo Overrides State
  const [photoOverrides, setPhotoOverrides] = useState<Record<string, { categories: string[], manuallyCategorized: boolean }>>({});
  const [showCategoryEditor, setShowCategoryEditor] = useState(false);
  
  // Auto-tagging state
  const [isAutoTagging, setIsAutoTagging] = useState(false);
  const [taggingProgress, setTaggingProgress] = useState({ current: 0, total: 0, lastTag: '' });
  const [showAdmin, setShowAdmin] = useState(false);
  const [taggingSession, setTaggingSession] = useState<{
    ids: string[];
    current: number;
    total: number;
    lastTag: string;
  } | null>(null);

  // Infinite Scroll State
  const [visibleCount, setVisibleCount] = useState(24);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisibleCount(24);
  }, [activeCategory]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && nextCursor && !isFetchingMore) {
          fetchMorePhotos();
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [view, activeCategory, nextCursor, isFetchingMore]);

  async function fetchMorePhotos() {
    if (!nextCursor || isFetchingMore) return;
    setIsFetchingMore(true);
    try {
      const response = await fetch(`/api/photos?cursor=${encodeURIComponent(nextCursor)}&limit=50`);
      if (response.ok) {
        const data = await response.json();
        setPhotos(prev => [...prev, ...data.photos]);
        setNextCursor(data.nextCursor);
      }
    } catch (err) {
      console.error('Error fetching more photos:', err);
    } finally {
      setIsFetchingMore(false);
    }
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsCategoryOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Load saved session on mount
  useEffect(() => {
    const saved = localStorage.getItem('ai_tagging_session');
    if (saved) {
      const session = JSON.parse(saved);
      if (session.current < session.total) {
        setTaggingSession(session);
        setTaggingProgress({ 
          current: session.current, 
          total: session.total, 
          lastTag: session.lastTag 
        });
      }
    }
  }, []);

  // Initialize Gemini
  const ai = useMemo(() => new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' }), []);

  // Auto-tagging processor
  useEffect(() => {
    let isMounted = true;
    
    async function processNext() {
      if (!isAutoTagging || !taggingSession || taggingSession.current >= taggingSession.total) {
        if (taggingSession && taggingSession.current >= taggingSession.total) {
          setIsAutoTagging(false);
          localStorage.removeItem('ai_tagging_session');
          setTaggingSession(null);
          alert('Auto-tagging complete!');
          // Refresh photos
          const response = await fetch('/api/photos?limit=50');
          const data = await response.json();
          if (data && data.photos) {
            setPhotos(data.photos);
            setNextCursor(data.nextCursor);
          }
        }
        return;
      }

      const photoId = taggingSession.ids[taggingSession.current];
      const photo = mergedPhotos.find(p => p.id === photoId);

      if (!photo) {
        // Skip if photo not found
        const nextSession = { ...taggingSession, current: taggingSession.current + 1 };
        setTaggingSession(nextSession);
        localStorage.setItem('ai_tagging_session', JSON.stringify(nextSession));
        return;
      }

      try {
        // 1. Fetch image
        const response = await fetch(photo.imageUrl);
        const blob = await response.blob();
        const base64Data = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
          reader.readAsDataURL(blob);
        });

        // 2. Call Gemini
        const prompt = `Analyze this photograph. Based on its visual content, pick exactly ONE category from this list that fits best:
        ${CATEGORIES.filter(c => c !== 'All' && c !== 'Uncategorized').join(', ')}
        
        Return ONLY the category name. If none fit perfectly, return 'Uncategorized'.`;

        const result = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: [{ parts: [{ inlineData: { mimeType: blob.type, data: base64Data } }, { text: prompt }] }]
        });

        const suggestedTag = result.text?.trim() || 'Uncategorized';
        const finalTag = CATEGORIES.includes(suggestedTag as Category) ? suggestedTag : 'Uncategorized';

        // 3. Update backend
        await fetch('/api/admin/update-tag', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publicId: photo.id, tag: finalTag })
        });

        if (isMounted) {
          const nextSession = { 
            ...taggingSession, 
            current: taggingSession.current + 1,
            lastTag: finalTag
          };
          setTaggingSession(nextSession);
          setTaggingProgress({ 
            current: nextSession.current, 
            total: nextSession.total, 
            lastTag: nextSession.lastTag 
          });
          localStorage.setItem('ai_tagging_session', JSON.stringify(nextSession));
        }
      } catch (err) {
        console.error('Failed to tag photo:', photoId, err);
        // Wait a bit and retry or skip
        await new Promise(r => setTimeout(r, 2000));
        if (isMounted) {
          // For now, we just skip to the next one to avoid getting stuck
          const nextSession = { ...taggingSession, current: taggingSession.current + 1 };
          setTaggingSession(nextSession);
          localStorage.setItem('ai_tagging_session', JSON.stringify(nextSession));
        }
      }
    }

    const timer = setTimeout(processNext, 1000); // 1 second delay between photos
    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [isAutoTagging, taggingSession, photos, ai, CATEGORIES]);

  const handleStartAutoTag = () => {
    const photosToTag = mergedPhotos.filter(p => {
      const isUncategorized = p.categories.includes('Uncategorized') || p.categories.length === 0;
      const isManuallyCategorized = photoOverrides[p.id]?.manuallyCategorized;
      return isUncategorized && !isManuallyCategorized;
    });
    
    if (photosToTag.length === 0) {
      alert('All photos are already categorized or manually sorted!');
      return;
    }

    const newSession = {
      ids: photosToTag.map(p => p.id),
      current: 0,
      total: photosToTag.length,
      lastTag: ''
    };

    setTaggingSession(newSession);
    setTaggingProgress({ current: 0, total: newSession.total, lastTag: '' });
    localStorage.setItem('ai_tagging_session', JSON.stringify(newSession));
    setIsAutoTagging(true);
  };

  const handleResumeAutoTag = () => {
    setIsAutoTagging(true);
  };

  const handleStopAutoTag = () => {
    setIsAutoTagging(false);
  };

  const handleResetAutoTag = () => {
    if (confirm('Are you sure you want to reset the current tagging session?')) {
      setIsAutoTagging(false);
      setTaggingSession(null);
      setTaggingProgress({ current: 0, total: 0, lastTag: '' });
      localStorage.removeItem('ai_tagging_session');
    }
  };

  useEffect(() => {
    async function fetchStats() {
      try {
        const response = await fetch('/api/photos/stats');
        if (response.ok) {
          try {
            const data = await response.json();
            setTotalPhotoCount(data.totalCount);
          } catch (e) {
            console.error('Error parsing stats JSON:', e);
          }
        }
      } catch (err) {
        console.error('Error fetching stats:', err);
      }
    }

    async function fetchPhotos() {
      try {
        const response = await fetch('/api/photos?limit=50');
        if (!response.ok) {
          let message = 'Failed to fetch photos';
          try {
            const errorData = await response.json();
            message = typeof errorData.details === 'string' 
              ? errorData.details 
              : (typeof errorData.error === 'string' ? errorData.error : (errorData.error?.message || message));
          } catch (e) {
            // If not JSON, get the status text or a snippet of the body
            const text = await response.text();
            console.error("Non-JSON Error Response:", text);
            message = `Server error ${response.status}: ${response.statusText || 'Check configuration'}`;
          }
          throw new Error(message);
        }
        const data = await response.json();
        if (data && data.photos) {
          setPhotos(data.photos);
          setNextCursor(data.nextCursor);
          if (data.totalCount) setTotalPhotoCount(data.totalCount);
        } else {
          console.log('No photos returned from API, using defaults');
        }
      } catch (error: any) {
        console.error('Error loading photos:', error);
        setError(error.message);
      } finally {
        setIsLoading(false);
      }
    }

    fetchStats();
    fetchPhotos();
  }, []);

  // Listen to Photo Stats
  useEffect(() => {
    if (!db || !db.type && Object.keys(db).length === 0) return;
    const unsubscribe = onSnapshot(collection(db, 'photo_stats'), (snapshot) => {
      const stats: Record<string, { likesCount: number }> = {};
      snapshot.forEach((doc) => {
        stats[getOriginalId(doc.id)] = doc.data() as { likesCount: number };
      });
      setPhotoStats(stats);
    }, (error) => {
      console.error("Firestore Stats Listener Error:", error);
    });

    return () => unsubscribe();
  }, []);

  // Listen to Photo Captions
  useEffect(() => {
    if (!db || !db.type && Object.keys(db).length === 0) return;
    const unsubscribe = onSnapshot(collection(db, 'photo_captions'), (snapshot) => {
      const caps: Record<string, string> = {};
      snapshot.forEach((doc) => {
        caps[getOriginalId(doc.id)] = (doc.data() as { text: string }).text;
      });
      setCaptions(caps);
    }, (error) => {
      console.error("Firestore Captions Listener Error:", error);
    });

    return () => unsubscribe();
  }, []);

  // Listen to Photo Overrides
  useEffect(() => {
    if (!db || !db.type && Object.keys(db).length === 0) return;
    const unsubscribe = onSnapshot(collection(db, 'photo_overrides'), (snapshot) => {
      const overrides: Record<string, { categories: string[], manuallyCategorized: boolean }> = {};
      snapshot.forEach((doc) => {
        overrides[getOriginalId(doc.id)] = doc.data() as { categories: string[], manuallyCategorized: boolean };
      });
      setPhotoOverrides(overrides);
    }, (error) => {
      console.error("Firestore Overrides Listener Error:", error);
    });

    return () => unsubscribe();
  }, []);

  // Listen to User Likes
  useEffect(() => {
    if (!auth || !auth.onAuthStateChanged) return;
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user && db && (db.type || Object.keys(db).length > 0)) {
        console.log("Firebase Auth: User is signed in", user.uid, user.isAnonymous ? "(Anonymous)" : "");
        const userLikesUnsub = onSnapshot(collection(db, 'likes'), (snapshot) => {
          const likes: Record<string, boolean> = {};
          snapshot.forEach((doc) => {
            // Document ID format: {userId}_{safePhotoId}
            if (doc.id.startsWith(user.uid + '_')) {
              const safePhotoId = doc.id.substring(user.uid.length + 1);
              likes[getOriginalId(safePhotoId)] = true;
            }
          });
          setUserLikes(likes);
        }, (error) => {
          console.error("Firestore Likes Listener Error:", error);
        });
        return () => userLikesUnsub();
      } else {
        console.log("Firebase Auth: No user signed in");
      }
    });

    return () => unsubscribe();
  }, []);

  const handleLike = async (photoId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!auth.currentUser || processingLikes[photoId]) return;

    const userId = auth.currentUser.uid;
    const safePhotoId = getSafeId(photoId);
    const likeId = `${userId}_${safePhotoId}`;
    
    setProcessingLikes(prev => ({ ...prev, [photoId]: true }));

    try {
      await runTransaction(db, async (transaction) => {
        const likeRef = doc(db, 'likes', likeId);
        const statsRef = doc(db, 'photo_stats', safePhotoId);
        
        const likeDoc = await transaction.get(likeRef);
        const statsDoc = await transaction.get(statsRef);
        
        const currentLikes = statsDoc.exists() ? (statsDoc.data().likesCount || 0) : 0;

        if (likeDoc.exists()) {
          // Unlike: Remove the like record and decrement count
          transaction.delete(likeRef);
          transaction.set(statsRef, { 
            likesCount: Math.max(0, currentLikes - 1) 
          }, { merge: true });
        } else {
          // Like: Add the like record and increment count
          transaction.set(likeRef, {
            userId,
            photoId, // Store original ID inside
            createdAt: serverTimestamp()
          });
          transaction.set(statsRef, { 
            likesCount: currentLikes + 1 
          }, { merge: true });
        }
      });
    } catch (err: any) {
      console.error("Error toggling like:", err);
    } finally {
      // Small delay to prevent rapid spam clicking
      setTimeout(() => {
        setProcessingLikes(prev => ({ ...prev, [photoId]: false }));
      }, 500);
    }
  };

  const handleSaveCaption = async (photoId: string) => {
    const safePhotoId = getSafeId(photoId);
    try {
      await setDoc(doc(db, 'photo_captions', safePhotoId), {
        text: editingText,
        updatedAt: serverTimestamp()
      });
      setIsEditingCaption(false);
    } catch (err) {
      console.error("Error saving caption:", err);
    }
  };

  const handleToggleCategory = async (photoId: string, category: Category) => {
    if (!isAdmin) return;
    
    const safePhotoId = getSafeId(photoId);
    const photo = mergedPhotos.find(p => p.id === photoId);
    if (!photo) return;

    const currentCategories = photo.categories;
    let newCategories: string[];
    
    if (currentCategories.includes(category)) {
      newCategories = currentCategories.filter(c => c !== category);
    } else {
      const filtered = currentCategories.filter(c => c !== 'Uncategorized');
      newCategories = [...filtered, category];
    }
    
    if (newCategories.length === 0) {
      newCategories = ['Uncategorized'];
    }

    try {
      await setDoc(doc(db, 'photo_overrides', safePhotoId), {
        categories: newCategories,
        manuallyCategorized: true,
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      console.error("Error updating categories:", err);
    }
  };

  const isBengaliText = (text: string) => {
    const bengaliRegex = /[\u0980-\u09FF]/;
    return bengaliRegex.test(text);
  };

  const isAdmin = auth.currentUser?.email === 'nasirparvez2002@gmail.com';

  const mergedPhotos = useMemo(() => {
    return photos.map(photo => {
      const override = photoOverrides[photo.id];
      if (override) {
        return { ...photo, categories: override.categories };
      }
      return photo;
    });
  }, [photos, photoOverrides]);

  const currentPhoto = useMemo(() => {
    if (!selectedPhoto) return null;
    return mergedPhotos.find(p => p.id === selectedPhoto.id) || selectedPhoto;
  }, [selectedPhoto, mergedPhotos]);

  const topPhotos = useMemo(() => {
    return [...mergedPhotos]
      .sort((a, b) => (photoStats[b.id]?.likesCount || 0) - (photoStats[a.id]?.likesCount || 0))
      .slice(0, 9);
  }, [mergedPhotos, photoStats]);

  const filteredPhotos = useMemo(() => {
    if (activeCategory === 'All') return []; // Don't show full gallery on home
    return mergedPhotos.filter((photo) => photo.categories.includes(activeCategory));
  }, [activeCategory, mergedPhotos]);

  const currentGallery = useMemo(() => {
    if (activeCategory === 'All') return topPhotos;
    return filteredPhotos;
  }, [activeCategory, topPhotos, filteredPhotos]);

  const handlePrev = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!currentPhoto) return;
    const index = currentGallery.findIndex(p => p.id === currentPhoto.id);
    if (index === -1) return;
    
    if (index > 0) {
      setSelectedPhoto(currentGallery[index - 1]);
    } else {
      setSelectedPhoto(currentGallery[currentGallery.length - 1]);
    }
  };

  const handleNext = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!currentPhoto) return;
    const index = currentGallery.findIndex(p => p.id === currentPhoto.id);
    if (index === -1) return;

    if (index < currentGallery.length - 1) {
      setSelectedPhoto(currentGallery[index + 1]);
    } else {
      setSelectedPhoto(currentGallery[0]);
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!currentPhoto) return;
      if (e.key === 'ArrowLeft') handlePrev();
      if (e.key === 'ArrowRight') handleNext();
      if (e.key === 'Escape') setSelectedPhoto(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentPhoto, currentGallery]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login error:", error);
    }
  };

  const pagedPhotos = useMemo(() => {
    return filteredPhotos.slice(0, visibleCount);
  }, [filteredPhotos, visibleCount]);

  return (
    <div className="min-h-screen bg-[#000516] text-white font-sans selection:bg-teal-500/30">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-[#000516]/80 backdrop-blur-md border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 flex justify-between items-center gap-4">
          <motion.button 
            onClick={() => setView('gallery')}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-2 cursor-pointer min-w-0"
          >
            <Camera className="w-5 h-5 md:w-6 md:h-6 text-[#5f8d8d] shrink-0" />
            <span className="font-bengali text-base md:text-xl font-bold tracking-wide truncate">চতুর্ভুজে বন্দী মুহূর্ত</span>
          </motion.button>
          
          <div className="flex gap-3 md:gap-8 text-[10px] md:text-sm font-medium tracking-widest uppercase text-gray-400 shrink-0">
            <button 
              onClick={() => {
                setView('gallery');
                setActiveCategory('All');
                setIsCategoryOpen(false);
              }}
              className={cn("hover:text-[#5f8d8d] transition-colors", view === 'gallery' && activeCategory === 'All' && "text-[#5f8d8d]")}
            >
              Home
            </button>
            <button 
              onClick={() => {
                setView('about');
                setIsCategoryOpen(false);
              }}
              className={cn("hover:text-[#5f8d8d] transition-colors", view === 'about' && "text-[#5f8d8d]")}
            >
              About
            </button>
            
            {/* Category Dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button 
                onClick={() => setIsCategoryOpen(!isCategoryOpen)}
                className={cn(
                  "flex items-center gap-1 hover:text-[#5f8d8d] transition-colors",
                  activeCategory !== 'All' && view === 'gallery' && "text-[#5f8d8d]"
                )}
              >
                Category
                <ChevronDown className={cn("w-4 h-4 transition-transform duration-300", isCategoryOpen && "rotate-180")} />
              </button>

              <AnimatePresence>
                {isCategoryOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                    className="absolute right-0 mt-4 w-64 bg-[#000516]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50 py-2"
                  >
                    <div className="max-h-[70vh] overflow-y-auto custom-scrollbar">
                      {CATEGORIES.map((category) => (
                        <button
                          key={category}
                          onClick={() => {
                            setActiveCategory(category);
                            setView('gallery');
                            setIsCategoryOpen(false);
                          }}
                          className={cn(
                            "w-full text-left px-6 py-3 text-[10px] tracking-[0.2em] uppercase transition-colors hover:bg-white/5",
                            activeCategory === category ? "text-[#5f8d8d] bg-white/5" : "text-gray-400"
                          )}
                        >
                          {category}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {view === 'gallery' ? (
            <motion.div
              key="gallery"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.5 }}
            >
              {activeCategory === 'All' ? (
                <div className="space-y-20">
                  {/* Hero Section with Counter */}
                  <section className="py-12 flex flex-col items-center gap-8">
                    <div className="text-center">
                      <h1 className="text-5xl md:text-7xl font-light tracking-tighter text-white mb-10">
                        The World Through <br />
                        <span className="text-[#5f8d8d] italic">My Lens</span>
                      </h1>
                      
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.8 }}
                      >
                        <CalendarCounter count={totalPhotoCount || photos.length} />
                      </motion.div>
                    </div>
                  </section>

                  {/* Featured Section */}
                  <section>
                    <div className="text-center mb-12">
                      <span className="text-[10px] uppercase tracking-[0.4em] text-gray-500 mb-2 block italic">Curated by the community</span>
                      <h2 className="text-4xl font-light tracking-tight text-white">Through Others' Eyes</h2>
                      <div className="w-24 h-px bg-[#5f8d8d] mx-auto mt-6 opacity-50" />
                    </div>

                    {isLoading ? (
                      <div className="flex flex-col items-center justify-center py-20 gap-4">
                        <Loader2 className="w-8 h-8 text-[#5f8d8d] animate-spin" />
                        <p className="text-gray-500 font-light tracking-widest uppercase text-[10px]">Loading gallery...</p>
                      </div>
                    ) : error ? (
                      <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                        <p className="text-red-400 font-light text-sm">Unable to connect to Cloudinary.</p>
                        <p className="text-gray-500 text-[10px] max-w-md italic">Error: {error}</p>
                        <button 
                          onClick={() => window.location.reload()}
                          className="mt-4 px-6 py-2 border border-white/10 rounded-full text-[10px] uppercase tracking-widest hover:bg-white/5 transition-colors"
                        >
                          Try Again
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                          {topPhotos.map((photo, index) => (
                            <PhotoCard 
                              key={photo.id} 
                              photo={photo} 
                              index={index}
                              likesCount={photoStats[photo.id]?.likesCount || 0}
                              isLiked={!!userLikes[photo.id]}
                              onLike={(e) => handleLike(photo.id, e)}
                              onClick={() => setSelectedPhoto(photo)}
                            />
                          ))}
                      </div>
                    )}
                  </section>

                  {/* Call to Action */}
                  <section className="text-center py-20 border-y border-white/5">
                    <p className="text-gray-400 font-light tracking-widest uppercase text-xs mb-8">Want to see more?</p>
                    <div className="flex flex-wrap justify-center gap-4">
                      {CATEGORIES.filter(c => c !== 'All').map((cat) => (
                        <button
                          key={cat}
                          onClick={() => setActiveCategory(cat)}
                          className="px-6 py-3 border border-white/10 rounded-full text-[10px] uppercase tracking-widest hover:bg-[#5f8d8d] hover:border-[#5f8d8d] hover:text-white transition-all"
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  </section>
                </div>
              ) : (
                <>
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-12 text-center"
                  >
                    <span className="text-[10px] uppercase tracking-[0.4em] text-gray-500 mb-2 block">Viewing Category</span>
                    <h2 className="text-3xl font-light tracking-tight text-[#5f8d8d]">{activeCategory}</h2>
                    <button 
                      onClick={() => setActiveCategory('All')}
                      className="mt-4 text-[10px] uppercase tracking-widest text-gray-400 hover:text-white transition-colors"
                    >
                      Back to Featured
                    </button>
                  </motion.div>

                  {/* Photo Grid */}
                  {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-40 gap-4">
                      <Loader2 className="w-10 h-10 text-[#5f8d8d] animate-spin" />
                      <p className="text-gray-500 font-light tracking-widest uppercase text-xs">Fetching your moments...</p>
                    </div>
                  ) : error ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                      <p className="text-red-400 font-light">Unable to connect to Cloudinary.</p>
                      <p className="text-gray-500 text-xs max-w-md italic">Error: {error}</p>
                      <button 
                        onClick={() => window.location.reload()}
                        className="mt-4 px-6 py-2 border border-white/10 rounded-full text-xs hover:bg-white/5 transition-colors"
                      >
                        Try Again
                      </button>
                    </div>
                  ) : (
                    <motion.div 
                      layout
                      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8"
                    >
                      <AnimatePresence mode="popLayout">
                        {pagedPhotos.map((photo, index) => (
                          <PhotoCard 
                            key={photo.id} 
                            photo={photo} 
                            index={index}
                            likesCount={photoStats[photo.id]?.likesCount || 0}
                            isLiked={!!userLikes[photo.id]}
                            onLike={(e) => handleLike(photo.id, e)}
                            onClick={() => setSelectedPhoto(photo)}
                          />
                        ))}
                      </AnimatePresence>
                    </motion.div>
                  )}

                  {/* Infinite Scroll Trigger */}
                  {(nextCursor || isFetchingMore) && (
                    <div ref={loadMoreRef} className="h-40 flex items-center justify-center mt-12">
                      <Loader2 className="w-8 h-8 text-[#5f8d8d] animate-spin opacity-50" />
                    </div>
                  )}

                  {/* Empty State */}
                  {filteredPhotos.length === 0 && !isLoading && (
                    <div className="text-center py-20 text-gray-500">
                      <p className="text-xl font-light">No moments captured in this category yet.</p>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="about"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.5 }}
              className="max-w-3xl mx-auto py-12"
            >
              <div className="space-y-12 font-bengali leading-relaxed text-lg text-gray-200">
                <section className="space-y-6">
                  <p className="text-2xl font-medium text-white italic border-l-4 border-[#5f8d8d] pl-6 py-2">
                    "ফটোগ্রাফি" - শব্দটা সবসময়ই আমার মধ্যে অন্য রকম একটা অনুভূতি জাগায়।
                  </p>
                  
                  <p>ক্যামেরার মাধ্যমে কিভাবে একটা মুহূর্তকে বন্দি করে ফেলা হয় !</p>
                  
                  <p>
                    পরবর্তীতে সেই ছবিটার দিকে তাকালে, চর্মচক্ষুতে দৃষ্টিগোচর না হলেও, অন্তর্চক্ষুর দৃশ্যপটে কি সুন্দর করেই না মুহূর্তটা ভেসে ওঠে !
                  </p>
                  
                  <p>
                    আনাড়ি আলোকচিত্রী আমি। সত্যি বলতে ছবি তোলার সময় আমার হাত সামান্য হলেও কাঁপে। তবে তাও আমি ছবি তুলি একটি মাত্র কারণেই, আর তা হলো - "আত্মতৃপ্তি"।
                  </p>

                  <p>
                    এ কংক্রিটের শহরের নানান ব্যস্ততার ভিড়ে, নানান জটিলতা, দুশ্চিন্তা ঘিরে ধরা দীর্ঘশ্বাসকে ফাঁকি দিয়ে নিজের শখ হিসেবে আমি বেছে নিয়েছি ছবি তোলাকে। 
                  </p>

                  <p className="text-[#5f8d8d] font-bold">সরলতাই সৌন্দর্য।</p>

                  <div className="pt-4">
                    <p className="text-white font-medium">মোঃ নাছির পারভেজ</p>
                  </div>
                </section>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-12 pt-12 border-t border-white/10">
                  <section className="space-y-4">
                    <h3 className="text-[#5f8d8d] uppercase tracking-widest text-sm font-bold font-sans">Tools Used</h3>
                    <ul className="space-y-2">
                      <li className="flex items-center gap-3">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#5f8d8d]" />
                        Adobe Lightroom
                      </li>
                      <li className="flex items-center gap-3">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#5f8d8d]" />
                        Snapseed
                      </li>
                      <li className="flex items-center gap-3">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#5f8d8d]" />
                        PixelLab
                      </li>
                    </ul>
                  </section>

                  <section className="space-y-4">
                    <h3 className="text-[#5f8d8d] uppercase tracking-widest text-sm font-bold font-sans">Devices Used</h3>
                    <ul className="space-y-2">
                      <li className="flex items-center gap-3">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#5f8d8d]" />
                        Lava Iris Fuel 60
                      </li>
                      <li className="flex items-center gap-3">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#5f8d8d]" />
                        Redmi 9C
                      </li>
                      <li className="flex items-center gap-3">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#5f8d8d]" />
                        Vivo Y12
                      </li>
                      <li className="flex items-center gap-3">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#5f8d8d]" />
                        iPhone 11
                      </li>
                    </ul>
                  </section>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Lightbox */}
      <AnimatePresence>
        {currentPhoto && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              setSelectedPhoto(null);
              setIsEditingCaption(false);
              setShowCategoryEditor(false);
            }}
            className="fixed inset-0 z-[100] bg-[#000516]/95 backdrop-blur-2xl overflow-y-auto custom-scrollbar cursor-zoom-out"
          >
            <div className="min-h-screen flex items-center justify-center p-4 md:p-12">
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="fixed top-8 right-8 z-[110] text-white/50 hover:text-white transition-colors p-2"
                onClick={() => {
                  setSelectedPhoto(null);
                  setIsEditingCaption(false);
                  setShowCategoryEditor(false);
                }}
              >
                <X className="w-8 h-8" />
              </motion.button>

              {/* Navigation Arrows */}
              <button
                onClick={handlePrev}
                className="fixed left-4 md:left-8 top-1/2 -translate-y-1/2 z-[110] p-3 rounded-full bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-all border border-white/5 group"
              >
                <ChevronLeft className="w-8 h-8 group-hover:-translate-x-1 transition-transform" />
              </button>

              <button
                onClick={handleNext}
                className="fixed right-4 md:right-8 top-1/2 -translate-y-1/2 z-[110] p-3 rounded-full bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-all border border-white/5 group"
              >
                <ChevronRight className="w-8 h-8 group-hover:translate-x-1 transition-transform" />
              </button>

              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                className="relative max-w-full flex flex-col items-center py-12"
                onClick={(e) => e.stopPropagation()}
              >
                <img
                  src={currentPhoto.imageUrl.includes('cloudinary.com') ? currentPhoto.imageUrl.replace('/upload/', '/upload/f_auto,q_auto:best/') : currentPhoto.imageUrl}
                  alt="Full view"
                  referrerPolicy="no-referrer"
                  className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-[0_0_50px_rgba(0,0,0,0.5)] border border-white/5"
                />
              <div className="mt-6 text-center max-w-2xl px-4">
                <div className="flex gap-2 justify-center mb-4 items-center">
                  {currentPhoto.categories.map(cat => (
                    <span key={cat} className="text-[10px] uppercase tracking-[0.3em] text-[#5f8d8d] font-bold">
                      {cat}
                    </span>
                  ))}
                  <div className="w-px h-3 bg-white/10 mx-2" />
                  <button
                    onClick={(e) => handleLike(currentPhoto.id, e)}
                    disabled={processingLikes[currentPhoto.id]}
                    className={cn(
                      "flex items-center gap-2 group transition-all",
                      processingLikes[currentPhoto.id] && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <Heart 
                      className={cn(
                        "w-4 h-4 transition-all duration-300",
                        userLikes[currentPhoto.id] 
                          ? "fill-red-500 text-red-500 scale-110" 
                          : "text-white/40 group-hover:text-red-400 group-hover:scale-110",
                        processingLikes[currentPhoto.id] && "animate-pulse"
                      )} 
                    />
                    <span className={cn(
                      "text-[10px] font-bold tracking-widest tabular-nums",
                      userLikes[currentPhoto.id] ? "text-red-400" : "text-white/40 group-hover:text-white"
                    )}>
                      {photoStats[currentPhoto.id]?.likesCount || 0}
                    </span>
                  </button>
                </div>

                {/* Caption Section */}
                <div className="mb-6">
                  {isEditingCaption ? (
                    <div className="flex flex-col items-center gap-3">
                      <textarea
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        placeholder="Write a caption..."
                        className={cn(
                          "w-full bg-white/5 border border-white/10 rounded-lg p-4 text-white focus:outline-none focus:border-[#5f8d8d] transition-colors resize-none h-24 text-center",
                          isBengaliText(editingText) ? "font-bengali text-lg" : "font-sans text-sm"
                        )}
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSaveCaption(currentPhoto.id)}
                          className="px-4 py-2 bg-[#5f8d8d] text-white text-xs uppercase tracking-widest font-bold rounded-full hover:bg-[#4a6e6e] transition-colors"
                        >
                          Save Caption
                        </button>
                        <button
                          onClick={() => setIsEditingCaption(false)}
                          className="px-4 py-2 bg-white/5 text-white text-xs uppercase tracking-widest font-bold rounded-full hover:bg-white/10 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="group relative">
                      {captions[currentPhoto.id] ? (
                        <p className={cn(
                          "text-white/90 leading-relaxed",
                          isBengaliText(captions[currentPhoto.id]) ? "font-bengali text-2xl" : "font-sans text-lg italic font-light"
                        )}>
                          {captions[currentPhoto.id]}
                        </p>
                      ) : isAdmin && (
                        <button
                          onClick={() => {
                            setEditingText('');
                            setIsEditingCaption(true);
                          }}
                          className="text-[#5f8d8d] text-xs uppercase tracking-[0.2em] font-bold hover:text-white transition-colors flex items-center gap-2 mx-auto"
                        >
                          <Wand2 className="w-3 h-3" />
                          Write a caption
                        </button>
                      )}
                      
                      {captions[currentPhoto.id] && isAdmin && (
                        <button
                          onClick={() => {
                            setEditingText(captions[currentPhoto.id]);
                            setIsEditingCaption(true);
                          }}
                          className="mt-4 text-white/30 hover:text-[#5f8d8d] text-[10px] uppercase tracking-widest transition-colors"
                        >
                          Edit Caption
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Admin Category Management */}
                {isAdmin && (
                  <div className="mt-8 pt-8 border-t border-white/5 w-full">
                    <button 
                      onClick={() => setShowCategoryEditor(!showCategoryEditor)}
                      className="text-[10px] uppercase tracking-widest text-gray-500 hover:text-[#5f8d8d] transition-colors flex items-center gap-2 mx-auto mb-4"
                    >
                      <ChevronDown className={cn("w-3 h-3 transition-transform", showCategoryEditor && "rotate-180")} />
                      Manage Categories
                    </button>
                    
                    <AnimatePresence>
                      {showCategoryEditor && (
                        <motion.div 
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="flex flex-wrap justify-center gap-2">
                            {CATEGORIES.filter(c => c !== 'All' && c !== 'Uncategorized').map(cat => {
                              const isActive = currentPhoto.categories.includes(cat);
                              return (
                                <button
                                  key={cat}
                                  onClick={() => handleToggleCategory(currentPhoto.id, cat)}
                                  className={cn(
                                    "px-3 py-1.5 rounded-full text-[9px] uppercase tracking-wider transition-all border",
                                    isActive 
                                      ? "bg-[#5f8d8d] border-[#5f8d8d] text-white" 
                                      : "bg-white/5 border-white/10 text-gray-400 hover:border-white/20"
                                  )}
                                >
                                  {cat}
                                </button>
                              );
                            })}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                <p className="text-white/30 text-[10px] uppercase tracking-widest mt-8">Original Ratio View</p>
              </div>
            </motion.div>
          </div>
        </motion.div>
        )}
      </AnimatePresence>

      {/* Admin Toggle (Hidden in plain sight) */}
      <div className="fixed bottom-4 right-4 z-[60]">
        <button 
          onClick={() => setShowAdmin(!showAdmin)}
          className="p-3 rounded-full bg-white/5 hover:bg-white/10 text-gray-600 hover:text-white transition-all border border-white/5"
          title="Admin Panel"
        >
          <Wand2 className="w-4 h-4" />
        </button>
      </div>

      {/* Admin Panel */}
      <AnimatePresence>
        {showAdmin && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-20 right-4 z-[60] w-80 bg-[#000516]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-6 overflow-hidden"
          >
            <h3 className="text-sm font-bold uppercase tracking-widest mb-4 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Wand2 className="w-4 h-4 text-[#5f8d8d]" />
                AI Gallery Assistant
              </div>
              {auth.currentUser?.email && (
                <span className="text-[8px] text-gray-500 lowercase">{auth.currentUser.email}</span>
              )}
            </h3>
            
            {!isAdmin ? (
              <div className="space-y-4">
                <p className="text-xs text-gray-400 leading-relaxed">
                  You are currently browsing as a guest. Please sign in with your admin account to add captions and manage the gallery.
                </p>
                <button
                  onClick={handleLogin}
                  className="w-full py-3 bg-white text-black text-xs font-bold uppercase tracking-widest rounded-xl hover:bg-gray-200 transition-all flex items-center justify-center gap-2"
                >
                  <Globe className="w-4 h-4" />
                  Sign in with Google
                </button>
              </div>
            ) : (
              <>
                <p className="text-xs text-gray-400 mb-6 leading-relaxed">
                  Upload your photos to Cloudinary, then click below. Gemini will analyze your images and automatically sort them into categories.
                </p>

                {isAutoTagging ? (
              <div className="space-y-4">
                <div className="flex justify-between text-[10px] uppercase tracking-widest text-gray-500">
                  <span>Processing...</span>
                  <span>{taggingProgress.current} / {taggingProgress.total}</span>
                </div>
                <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                  <motion.div 
                    className="h-full bg-[#5f8d8d]"
                    initial={{ width: 0 }}
                    animate={{ width: `${(taggingProgress.current / taggingProgress.total) * 100}%` }}
                  />
                </div>
                {taggingProgress.lastTag && (
                  <p className="text-[10px] text-[#5f8d8d] italic text-center">
                    Tagged as: {taggingProgress.lastTag}
                  </p>
                )}
                <div className="flex items-center justify-center gap-2 py-2">
                  <Loader2 className="w-4 h-4 text-[#5f8d8d] animate-spin" />
                  <span className="text-xs text-gray-400">AI is thinking...</span>
                </div>
                <button
                  onClick={handleStopAutoTag}
                  className="w-full py-2 border border-white/10 hover:bg-white/5 text-gray-400 rounded-xl text-[10px] uppercase tracking-widest transition-all"
                >
                  Pause Processing
                </button>
              </div>
            ) : taggingSession ? (
              <div className="space-y-4">
                <div className="flex justify-between text-[10px] uppercase tracking-widest text-gray-500">
                  <span>Paused</span>
                  <span>{taggingProgress.current} / {taggingProgress.total}</span>
                </div>
                <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gray-600"
                    style={{ width: `${(taggingProgress.current / taggingProgress.total) * 100}%` }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={handleResumeAutoTag}
                    className="py-3 bg-[#5f8d8d] hover:bg-[#4d7373] text-white rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all shadow-lg shadow-teal-900/20"
                  >
                    Resume
                  </button>
                  <button
                    onClick={handleResetAutoTag}
                    className="py-3 border border-white/10 hover:bg-white/5 text-gray-400 rounded-xl text-[10px] uppercase tracking-widest transition-all"
                  >
                    Reset
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={handleStartAutoTag}
                className="w-full py-3 bg-[#5f8d8d] hover:bg-[#4d7373] text-white rounded-xl text-xs font-bold uppercase tracking-widest transition-all shadow-lg shadow-teal-900/20 flex items-center justify-center gap-2"
              >
                <Wand2 className="w-4 h-4" />
                Auto-Organize Gallery
              </button>
            )}
          </>
        )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="border-t border-white/5 mt-20 py-12 bg-black/20">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="text-center md:text-left">
            <h2 className="font-bengali text-2xl font-bold mb-2">চতুর্ভুজে বন্দী মুহূর্ত</h2>
            <p className="text-gray-500 text-lg font-bengali max-w-xs leading-relaxed">
              দেখার মতো চোখ থাকলে <br />
              প্রতি ছবি-ই গল্প বলে
            </p>
          </div>
          
          <div className="flex gap-4 md:gap-6">
            <a 
              href="https://facebook.com/nasirparvez8018" 
              target="_blank" 
              rel="noopener noreferrer"
              className="p-3 rounded-full bg-white/5 hover:bg-[#5f8d8d]/20 hover:text-[#5f8d8d] transition-all"
              title="Facebook"
            >
              <Facebook className="w-5 h-5" />
            </a>
            <a 
              href="https://instagram.com/_subodh.18_/" 
              target="_blank" 
              rel="noopener noreferrer"
              className="p-3 rounded-full bg-white/5 hover:bg-[#5f8d8d]/20 hover:text-[#5f8d8d] transition-all"
              title="Instagram"
            >
              <Instagram className="w-5 h-5" />
            </a>
            <a 
              href="mailto:nasirparvez91221@gmail.com" 
              className="p-3 rounded-full bg-white/5 hover:bg-[#5f8d8d]/20 hover:text-[#5f8d8d] transition-all"
              title="Gmail"
            >
              <Mail className="w-5 h-5" />
            </a>
            <a 
              href="https://sites.google.com/view/parvez8018/home" 
              target="_blank" 
              rel="noopener noreferrer"
              className="p-3 rounded-full bg-white/5 hover:bg-[#5f8d8d]/20 hover:text-[#5f8d8d] transition-all"
              title="Google Sites"
            >
              <Globe className="w-5 h-5" />
            </a>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-6 mt-12 pt-8 border-t border-white/5 text-center text-gray-600 text-xs tracking-widest uppercase">
          &copy; {new Date().getFullYear()} চতুর্ভুজে বন্দী মুহূর্ত. All rights reserved.
        </div>
      </footer>
    </div>
  );
}

function PhotoCard({ 
  photo, 
  index, 
  likesCount, 
  isLiked, 
  onLike,
  onClick
}: { 
  photo: Photo; 
  index: number; 
  likesCount: number; 
  isLiked: boolean; 
  onLike: (e: React.MouseEvent) => void | Promise<void>;
  onClick: () => void;
  key?: any;
}) {
  // Cloudinary optimization: f_auto (auto format), q_auto (auto quality)
  // We use q_auto:good to ensure high quality while reducing file size
  const optimizedUrl = photo.imageUrl.includes('cloudinary.com') 
    ? photo.imageUrl.replace('/upload/', '/upload/f_auto,q_auto:good,w_800/')
    : photo.imageUrl;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.4, ease: "easeOut", delay: (index % 24) * 0.05 }}
      onClick={onClick}
      className="group relative aspect-[4/5] overflow-hidden rounded-xl bg-gray-900 shadow-2xl cursor-zoom-in"
    >
      <img
        src={optimizedUrl}
        alt="Photography by Nasir Parvez"
        referrerPolicy="no-referrer"
        className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
        loading="lazy"
      />
      
      {/* Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex flex-col justify-end p-8">
        <div className="flex justify-between items-end">
          <button 
            onClick={onLike}
            className="flex flex-col items-center gap-1 group/heart"
          >
            <motion.div
              whileTap={{ scale: 1.5 }}
              transition={{ type: "spring", stiffness: 400, damping: 10 }}
            >
              <Heart 
                className={cn(
                  "w-6 h-6 transition-all duration-300",
                  isLiked ? "fill-red-500 text-red-500" : "text-white group-hover/heart:text-red-400"
                )} 
              />
            </motion.div>
            <span className="text-[10px] font-mono text-white/70">{likesCount}</span>
          </button>

          <div className="flex flex-wrap gap-2 justify-end">
            {photo.categories.map((cat) => (
              <span 
                key={cat} 
                className="text-[10px] uppercase tracking-[0.2em] text-[#5f8d8d] font-semibold"
              >
                {cat}
              </span>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
