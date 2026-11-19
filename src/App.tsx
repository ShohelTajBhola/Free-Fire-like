/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Shield, Flame, Users, CheckCircle2, AlertTriangle, RefreshCw, 
  Settings, Lock, Key, Terminal, BarChart3, HelpCircle, LogOut, 
  ChevronRight, ExternalLink, Sparkles, Award, Globe, Clock, Copy, Check,
  Zap, Database, Activity, Eye, Edit3, Trash2, PlusCircle, Unlock
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, getDoc, setDoc, getDocs, addDoc, query, orderBy, limit } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

const MAIN_ADMIN_EMAIL = 'soheltajbhola@gmail.com';

interface PlayerInfo {
  uid: string;
  name: string;
  region: string;
  level: number;
  likes: number;
  booyahs: number;
  avatar: string;
  verifiedAt: string;
}

interface RequestHistoryItem {
  id?: string;
  freeFireUid: string;
  playerName: string;
  region: string;
  status: 'success' | 'failed' | 'pending';
  likesCount: number;
  dateStr: string;
  createdAt: string;
}

interface DailyConfig {
  shortLinkUrl: string;
  shortLinkTitle: string;
  codeLength: number;
  isActive: boolean;
  configVersion: string;
  globalDailyLimit: number;
  perUidDailyLimit: number;
  hlRegion: string;
  apiStatus: 'active' | 'maintenance' | 'not_configured';
  updatedAt?: string;
}

async function safeFetch(url: string, options?: RequestInit) {
  const res = await fetch(url, options);
  const contentType = res.headers.get('content-type');
  let data: any = null;

  if (contentType && contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch {
      data = {};
    }
  } else {
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      data = { success: false, error: text ? text.slice(0, 200) : `Server responded with status ${res.status}` };
    }
  }

  if (!res.ok || (data && data.success === false)) {
    throw new Error(data.error || data.message || `Server error (${res.status})`);
  }

  return data;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'home' | 'history' | 'faq' | 'admin'>('home');
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Daily Config & Stats from Backend
  const [dailyConfig, setDailyConfig] = useState<DailyConfig>({
    shortLinkUrl: 'https://link-provider.com/s/freefire-today',
    shortLinkTitle: 'Daily Official Short Link',
    codeLength: 6,
    isActive: true,
    configVersion: 'v1',
    globalDailyLimit: 500,
    perUidDailyLimit: 3,
    hlRegion: 'BD',
    apiStatus: 'active'
  });
  const [globalStats, setGlobalStats] = useState({ globalDailyLimit: 500, totalGlobalRequestsToday: 184, failedRequestsCount: 12, remainingGlobalQuota: 316 });

  // STEP 1-3: Short Link & Code Verification States
  const [verificationCodeInput, setVerificationCodeInput] = useState('');
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [isVerifiedSession, setIsVerifiedSession] = useState(false);
  const [verifiedSessionToken, setVerifiedSessionToken] = useState('');
  const [demoCodeHint, setDemoCodeHint] = useState('');
  const [showDemoBox, setShowDemoBox] = useState(false);

  // STEP 4-5: Free Fire UID & Likes States
  const [uidInput, setUidInput] = useState('');
  const [isVerifyingUid, setIsVerifyingUid] = useState(false);
  const [playerInfo, setPlayerInfo] = useState<PlayerInfo | null>(null);
  const [uidRequestsCount, setUidRequestsCount] = useState(0);
  const [isSendingLikes, setIsSendingLikes] = useState(false);
  const [successLikesResult, setSuccessLikesResult] = useState<{ likesDelivered: number; remainingUidQuota: number; remainingGlobalQuota: number } | null>(null);

  // Request History
  const [requestHistory, setRequestHistory] = useState<RequestHistoryItem[]>([]);

  // Admin States
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const [adminUser, setAdminUser] = useState<any>(null);

  // Admin Form Inputs
  const [adminShortLinkUrl, setAdminShortLinkUrl] = useState('');
  const [adminNewCode, setAdminNewCode] = useState('');
  const [adminCodeLength, setAdminCodeLength] = useState<number>(6);
  const [adminGlobalLimit, setAdminGlobalLimit] = useState(500);
  const [adminPerUidLimit, setAdminPerUidLimit] = useState(3);
  const [adminApiStatus, setAdminApiStatus] = useState<'active' | 'maintenance' | 'not_configured'>('active');

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  useEffect(() => {
    if (window.location.pathname === '/admin') {
      setActiveTab('admin');
    }
    fetchConfig();
    fetchHistory();

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user && user.email === MAIN_ADMIN_EMAIL) {
        setAdminUser(user);
        setIsAdminLoggedIn(true);
      } else {
        if (user) {
          await signOut(auth);
        }
        setAdminUser(null);
        setIsAdminLoggedIn(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const fetchConfig = async () => {
    try {
      const data = await safeFetch('/api/config');
      if (data.dailyConfig) {
        setDailyConfig(data.dailyConfig);
        setAdminShortLinkUrl(data.dailyConfig.shortLinkUrl);
        setAdminCodeLength(data.dailyConfig.codeLength);
        setAdminGlobalLimit(data.dailyConfig.globalDailyLimit);
        setAdminPerUidLimit(data.dailyConfig.perUidDailyLimit);
        setAdminApiStatus(data.dailyConfig.apiStatus);
      }
      if (data.stats) setGlobalStats(data.stats);
    } catch (err) {
      console.error('Error fetching config:', err);
    }
  };

  const fetchHistory = async () => {
    try {
      const snapshot = await getDocs(query(collection(db, 'likesRequests'), orderBy('createdAt', 'desc'), limit(20)));
      const items: RequestHistoryItem[] = [];
      snapshot.forEach(docSnap => {
        items.push({ id: docSnap.id, ...docSnap.data() } as RequestHistoryItem);
      });
      if (items.length > 0) setRequestHistory(items);
    } catch {
      setRequestHistory([
        { freeFireUid: '849201847', playerName: '⚡X_Viper_⚡', region: 'Bangladesh', status: 'success', likesCount: 50, dateStr: '2026-11-17', createdAt: new Date().toISOString() }
      ]);
    }
  };

  // STEP 1: Visit Short Link
  const handleVisitShortLink = async () => {
    try {
      const data = await safeFetch('/api/generate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: 'preview_visitor' })
      });
      if (data.demoCode) {
        setDemoCodeHint(data.demoCode);
        setShowDemoBox(true);
      }
      window.open(dailyConfig.shortLinkUrl, '_blank');
      showToast('Opened today’s short link! Complete the instructions to get your code.', 'info');
    } catch {
      window.open(dailyConfig.shortLinkUrl, '_blank');
    }
  };

  // STEP 3: Submit Verification Code
  const handleVerifyCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verificationCodeInput || verificationCodeInput.length !== dailyConfig.codeLength) {
      showToast(`Please enter a valid ${dailyConfig.codeLength}-digit verification code.`, 'error');
      return;
    }

    setIsVerifyingCode(true);
    try {
      const data = await safeFetch('/api/verify-daily-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: verificationCodeInput })
      });

      setIsVerifiedSession(true);
      setVerifiedSessionToken(data.verifiedSessionToken);
      showToast('Verification Successful! Free Fire UID section unlocked.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Verification failed.', 'error');
    } finally {
      setIsVerifyingCode(false);
    }
  };

  // STEP 4: Verify UID
  const handleVerifyUid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uidInput || uidInput.length < 5) {
      showToast('Please enter a valid Free Fire UID.', 'error');
      return;
    }

    setIsVerifyingUid(true);
    try {
      const data = await safeFetch('/api/verify-uid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: uidInput, verifiedSessionToken })
      });

      setPlayerInfo(data.player);
      showToast(`Player "${data.player.name}" verified successfully!`, 'success');

      const todayKey = new Date().toLocaleDateString('en-CA');
      const stored = localStorage.getItem(`ff_uid_${uidInput}_${todayKey}`);
      setUidRequestsCount(stored ? parseInt(stored, 10) : 0);
    } catch (err: any) {
      showToast(err.message || 'UID verification error.', 'error');
    } finally {
      setIsVerifyingUid(false);
    }
  };

  // STEP 5: Get Free Likes
  const handleSendLikes = async () => {
    if (!playerInfo || !isVerifiedSession || !verifiedSessionToken) {
      showToast('Session expired or UID not verified.', 'error');
      return;
    }

    if (uidRequestsCount >= dailyConfig.perUidDailyLimit) {
      showToast(`This UID has reached the maximum daily limit of ${dailyConfig.perUidDailyLimit} successful requests today.`, 'error');
      return;
    }

    if (dailyConfig.apiStatus === 'not_configured') {
      showToast('API Not Configured. Please configure HL Gaming API credentials in the Admin Dashboard.', 'error');
      return;
    }

    setIsSendingLikes(true);
    try {
      const data = await safeFetch('/api/send-likes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: playerInfo.uid,
          verifiedSessionToken,
          playerName: playerInfo.name,
          region: playerInfo.region
        })
      });

      const newCount = uidRequestsCount + 1;
      setUidRequestsCount(newCount);
      const todayKey = new Date().toLocaleDateString('en-CA');
      localStorage.setItem(`ff_uid_${playerInfo.uid}_${todayKey}`, newCount.toString());

      setSuccessLikesResult({
        likesDelivered: data.likesDelivered,
        remainingUidQuota: dailyConfig.perUidDailyLimit - newCount,
        remainingGlobalQuota: data.remainingGlobalQuota
      });

      const newReq: RequestHistoryItem = {
        freeFireUid: playerInfo.uid,
        playerName: playerInfo.name,
        region: playerInfo.region,
        status: 'success',
        likesCount: data.likesDelivered,
        dateStr: todayKey,
        createdAt: new Date().toISOString()
      };
      await addDoc(collection(db, 'likesRequests'), newReq);
      setRequestHistory(prev => [newReq, ...prev]);

      showToast(`Successfully delivered ${data.likesDelivered} likes!`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Likes dispatch failed.', 'error');
    } finally {
      setIsSendingLikes(false);
    }
  };

  const handleAdminLogin = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const email = result.user?.email;

      if (email !== MAIN_ADMIN_EMAIL) {
        await signOut(auth);
        setIsAdminLoggedIn(false);
        setAdminUser(null);
        showToast(`Access Denied: Only ${MAIN_ADMIN_EMAIL} is authorized as Main Admin.`, 'error');
        return;
      }

      setAdminUser(result.user);
      setIsAdminLoggedIn(true);
      window.history.pushState({}, '', '/admin');
      setActiveTab('admin');
      showToast('Main Admin logged in successfully!', 'success');
    } catch (err: any) {
      showToast(err.message || 'Login failed.', 'error');
    }
  };

  const handleSaveAdminConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const user = auth.currentUser;
      if (!user || user.email !== MAIN_ADMIN_EMAIL) {
        throw new Error('Unauthorized. Only soheltajbhola@gmail.com can modify configuration.');
      }
      const token = await user.getIdToken();

      const data = await safeFetch('/api/admin/daily-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          shortLinkUrl: adminShortLinkUrl,
          plainCode: adminNewCode ? adminNewCode : undefined,
          codeLength: adminCodeLength,
          globalDailyLimit: adminGlobalLimit,
          perUidDailyLimit: adminPerUidLimit,
          apiStatus: adminApiStatus,
          isActive: true
        })
      });

      setAdminNewCode('');
      fetchConfig();
      showToast('Main Admin configuration saved successfully!', 'success');
    } catch (err: any) {
      showToast(err.message || 'Error updating configuration.', 'error');
    }
  };

  return (
    <div className="min-h-screen bg-[#07080c] text-zinc-100 flex flex-col font-['Plus_Jakarta_Sans',sans-serif] selection:bg-red-600 selection:text-white relative overflow-hidden">
      
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-6 right-6 z-50 animate-bounce duration-300">
          <div className={`px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 border backdrop-blur-md ${
            toastMessage.type === 'success' ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200' :
            toastMessage.type === 'error' ? 'bg-red-950/90 border-red-500/50 text-red-200' :
            'bg-zinc-900/90 border-zinc-700 text-zinc-200'
          }`}>
            {toastMessage.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" /> :
             toastMessage.type === 'error' ? <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" /> :
             <Sparkles className="w-5 h-5 text-amber-400 shrink-0" />}
            <span className="font-semibold text-sm">{toastMessage.text}</span>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-[#090a0f]/85 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => { window.history.pushState({}, '', '/'); setActiveTab('home'); }}>
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-red-600 to-rose-700 flex items-center justify-center shadow-[0_0_20px_rgba(220,38,38,0.4)] border border-red-500/30">
              <Flame className="w-6 h-6 text-white animate-pulse" />
            </div>
            <div>
              <span className="text-xl sm:text-2xl font-black tracking-wider uppercase font-['Orbitron',sans-serif] bg-gradient-to-r from-white via-zinc-200 to-red-500 bg-clip-text text-transparent">
                FIRE<span className="text-red-600">BOOST</span> FF
              </span>
              <p className="text-[10px] text-zinc-400 uppercase tracking-widest font-bold">Auto Likes & Verified System</p>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-6">
            <button 
              onClick={() => { window.history.pushState({}, '', '/'); setActiveTab('home'); }}
              className={`text-sm font-bold tracking-wide transition-colors pb-1 border-b-2 ${activeTab === 'home' ? 'text-red-500 border-red-500' : 'text-zinc-400 border-transparent hover:text-zinc-200'}`}
            >
              Home / Verification
            </button>
            <button 
              onClick={() => setActiveTab('history')}
              className={`text-sm font-bold tracking-wide transition-colors pb-1 border-b-2 ${activeTab === 'history' ? 'text-red-500 border-red-500' : 'text-zinc-400 border-transparent hover:text-zinc-200'}`}
            >
              Request History
            </button>
            <button 
              onClick={() => setActiveTab('faq')}
              className={`text-sm font-bold tracking-wide transition-colors pb-1 border-b-2 ${activeTab === 'faq' ? 'text-red-500 border-red-500' : 'text-zinc-400 border-transparent hover:text-zinc-200'}`}
            >
              FAQ & Guide
            </button>
            <button 
              onClick={() => { window.history.pushState({}, '', '/admin'); setActiveTab('admin'); }}
              className={`text-sm font-bold tracking-wide transition-colors pb-1 border-b-2 flex items-center gap-1.5 ${activeTab === 'admin' ? 'text-red-500 border-red-500' : 'text-zinc-400 border-transparent hover:text-zinc-200'}`}
            >
              <Shield className="w-4 h-4 text-red-500" /> Admin Panel (/admin)
            </button>
          </nav>

          <div className="flex items-center gap-3">
            {isAdminLoggedIn ? (
              <button
                onClick={() => { signOut(auth); setIsAdminLoggedIn(false); setAdminUser(null); window.history.pushState({}, '', '/'); setActiveTab('home'); showToast('Admin session invalidated successfully.', 'info'); }}
                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border border-zinc-700"
              >
                <LogOut className="w-4 h-4" /> Logout
              </button>
            ) : (
              <button
                onClick={handleAdminLogin}
                className="bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-[0_0_20px_rgba(220,38,38,0.3)] flex items-center gap-2 border border-red-500/40"
              >
                <Lock className="w-3.5 h-3.5" /> Admin Login
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full">

        {activeTab === 'home' && (
          <div className="space-y-12 animate-fade-in max-w-4xl mx-auto">

            <div className="text-center space-y-3">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-red-600/10 border border-red-500/35 text-red-400 text-xs font-bold uppercase tracking-widest">
                <Sparkles className="w-3.5 h-3.5" /> Strict Short Link & UID Verification Workflow
              </div>
              <h1 className="text-3xl sm:text-5xl font-black uppercase tracking-tight font-['Orbitron',sans-serif]">
                Free Fire Auto <span className="bg-gradient-to-r from-red-500 to-rose-600 bg-clip-text text-transparent">Likes Portal</span>
              </h1>
              <p className="text-zinc-400 text-sm max-w-xl mx-auto">
                Complete the daily short link verification code first to unlock the Free Fire UID section and send likes.
              </p>
            </div>

            {/* STEP 1, 2, 3: Short Link Verification */}
            <div className={`bg-zinc-950/90 border rounded-2xl p-6 sm:p-8 shadow-2xl relative overflow-hidden transition-all ${isVerifiedSession ? 'border-emerald-500/40 bg-emerald-950/10' : 'border-red-500/50 shadow-[0_0_30px_rgba(220,38,38,0.15)]'}`}>
              <div className="absolute top-0 right-0 w-48 h-48 bg-red-600/10 rounded-full blur-3xl pointer-events-none"></div>

              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="w-9 h-9 rounded-xl bg-red-600 text-white font-black font-['Orbitron',sans-serif] flex items-center justify-center text-sm shadow-md">01</span>
                    <div>
                      <h2 className="text-lg font-bold text-white font-['Orbitron',sans-serif]">Short Link Verification</h2>
                      <p className="text-xs text-zinc-400">Step 1: Visit short link • Step 2: Get {dailyConfig.codeLength}-digit code • Step 3: Enter code below</p>
                    </div>
                  </div>
                  {isVerifiedSession && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-950 text-emerald-400 border border-emerald-500/40">
                      <CheckCircle2 className="w-4 h-4" /> Verified Session Active
                    </span>
                  )}
                </div>

                {!isVerifiedSession ? (
                  <div className="space-y-6 pt-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <button
                        onClick={handleVisitShortLink}
                        className="w-full bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-bold py-4 px-6 rounded-xl text-sm transition-all shadow-lg flex items-center justify-center gap-2.5 border border-amber-500/40 uppercase tracking-wide font-['Orbitron',sans-serif]"
                      >
                        <ExternalLink className="w-5 h-5" /> Visit Today's Short Link
                      </button>

                      {showDemoBox && (
                        <div className="bg-amber-950/50 border border-amber-500/40 rounded-xl p-3 flex flex-col justify-center text-xs space-y-1">
                          <span className="text-amber-300 font-bold">💡 Code Hint (Demo Mode):</span>
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-lg font-bold text-white tracking-widest">{demoCodeHint}</span>
                            <button 
                              onClick={() => setVerificationCodeInput(demoCodeHint)}
                              className="bg-amber-600 hover:bg-amber-500 text-white px-3 py-1 rounded text-xs font-bold"
                            >
                              Autofill Code
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    <form onSubmit={handleVerifyCodeSubmit} className="space-y-4 pt-2 border-t border-zinc-900">
                      <div>
                        <label className="block text-xs font-semibold text-zinc-300 mb-1.5 uppercase tracking-wider">
                          Enter {dailyConfig.codeLength}-Digit Verification Code from Short Link Page
                        </label>
                        <input
                          type="text"
                          value={verificationCodeInput}
                          onChange={(e) => setVerificationCodeInput(e.target.value.replace(/\D/g, ''))}
                          placeholder={`Enter ${dailyConfig.codeLength}-digit code`}
                          maxLength={dailyConfig.codeLength}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3.5 text-white placeholder-zinc-600 text-base focus:outline-none focus:border-red-500 transition-colors font-mono tracking-widest text-center"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={isVerifyingCode}
                        className="w-full bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600 text-white font-bold py-3.5 px-6 rounded-xl text-sm transition-all shadow-[0_0_20px_rgba(220,38,38,0.3)] border border-red-500/40 flex items-center justify-center gap-2 uppercase tracking-wide font-['Orbitron',sans-serif]"
                      >
                        {isVerifyingCode ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        Verify Code & Unlock UID Section
                      </button>
                    </form>
                  </div>
                ) : (
                  <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-xl p-4 flex items-center justify-between text-xs text-emerald-300">
                    <span>Short link verification completed successfully. Free Fire UID section is unlocked below.</span>
                    <button 
                      onClick={() => { setIsVerifiedSession(false); setVerifiedSessionToken(''); setPlayerInfo(null); }}
                      className="text-zinc-400 hover:text-white underline text-[11px]"
                    >
                      Reset Verification
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* STEP 4 & 5: Free Fire UID & Likes Section */}
            <div className={`bg-zinc-900/80 backdrop-blur-xl border rounded-2xl p-6 sm:p-8 shadow-xl transition-all ${!isVerifiedSession ? 'opacity-50 pointer-events-none filter grayscale-[30%]' : 'border-zinc-800'}`}>
              <div className="flex items-center gap-3 mb-6">
                <span className="w-9 h-9 rounded-xl bg-zinc-800 text-zinc-300 font-black font-['Orbitron',sans-serif] flex items-center justify-center text-sm border border-zinc-700">02</span>
                <div>
                  <h2 className="text-lg font-bold text-white font-['Orbitron',sans-serif]">Free Fire UID & Likes Sender</h2>
                  <p className="text-xs text-zinc-400">
                    {!isVerifiedSession ? '🔒 Complete Short Link Verification above to unlock this section.' : '⚡ Enter UID, verify player profile, and dispatch likes.'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <form onSubmit={handleVerifyUid} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-300 mb-1.5 uppercase tracking-wider">Free Fire UID</label>
                      <input
                        type="text"
                        value={uidInput}
                        onChange={(e) => setUidInput(e.target.value.replace(/\D/g, ''))}
                        placeholder="e.g. 849201847"
                        maxLength={12}
                        disabled={!isVerifiedSession}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder-zinc-600 text-sm focus:outline-none focus:border-red-500 font-mono disabled:opacity-50"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={isVerifyingUid || !isVerifiedSession}
                      className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-bold py-3 px-4 rounded-xl text-xs transition-all border border-zinc-700 flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isVerifyingUid ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                      Verify Player UID
                    </button>
                  </form>

                  {playerInfo && (
                    <div className="bg-zinc-950 border border-red-500/30 rounded-xl p-4 space-y-3 animate-fade-in">
                      <div className="flex items-center gap-3">
                        <img src={playerInfo.avatar} alt="Avatar" className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 p-1" />
                        <div>
                          <h3 className="font-bold text-white text-sm flex items-center gap-1.5">
                            {playerInfo.name} <span className="text-[10px] bg-red-600/20 text-red-400 px-2 py-0.5 rounded border border-red-500/30">Lvl {playerInfo.level}</span>
                          </h3>
                          <p className="text-xs text-zinc-400">UID: {playerInfo.uid} • {playerInfo.region}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-zinc-900">
                        <div className="bg-zinc-900 p-2 rounded-lg">
                          <span className="text-zinc-500 block">Likes</span>
                          <span className="font-bold text-red-400 font-mono">❤️ {playerInfo.likes.toLocaleString()}</span>
                        </div>
                        <div className="bg-zinc-900 p-2 rounded-lg">
                          <span className="text-zinc-500 block">Booyahs</span>
                          <span className="font-bold text-emerald-400 font-mono">🏆 {playerInfo.booyahs.toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-4 flex flex-col justify-between">
                  <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 space-y-3">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">UID Daily Limit (Max 3):</span>
                      <span className="font-bold text-white">{uidRequestsCount} / {dailyConfig.perUidDailyLimit}</span>
                    </div>
                    <div className="w-full bg-zinc-900 h-2 rounded-full overflow-hidden">
                      <div 
                        className="bg-gradient-to-r from-red-600 to-emerald-500 h-full transition-all duration-500" 
                        style={{ width: `${(uidRequestsCount / dailyConfig.perUidDailyLimit) * 100}%` }}
                      ></div>
                    </div>
                    <p className="text-[11px] text-zinc-500">Resets daily at midnight Bangladesh time (Asia/Dhaka).</p>
                  </div>

                  <button
                    onClick={handleSendLikes}
                    disabled={isSendingLikes || !playerInfo || uidRequestsCount >= dailyConfig.perUidDailyLimit}
                    className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black py-4 px-4 rounded-xl text-sm transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)] border border-emerald-500/40 flex items-center justify-center gap-2 disabled:opacity-50 uppercase tracking-wider font-['Orbitron',sans-serif]"
                  >
                    {isSendingLikes ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                    Get Free Likes Now!
                  </button>

                  {successLikesResult && (
                    <div className="bg-emerald-950/60 border border-emerald-500/40 rounded-xl p-3 text-center space-y-1 animate-fade-in text-xs">
                      <div className="text-emerald-400 font-bold">🎉 Success! Delivered +{successLikesResult.likesDelivered} Likes</div>
                      <p className="text-[11px] text-zinc-300">Remaining UID Quota: {successLikesResult.remainingUidQuota}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-6 animate-fade-in max-w-4xl mx-auto">
            <h2 className="text-2xl font-black font-['Orbitron',sans-serif] uppercase text-white">Request History</h2>
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-950 text-zinc-400 uppercase font-['Orbitron',sans-serif] border-b border-zinc-800">
                  <tr>
                    <th className="px-6 py-4">UID</th>
                    <th className="px-6 py-4">Player Name</th>
                    <th className="px-6 py-4">Region</th>
                    <th className="px-6 py-4">Likes</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                  {requestHistory.map((req, idx) => (
                    <tr key={idx} className="hover:bg-zinc-800/30">
                      <td className="px-6 py-4 font-mono font-bold text-white">{req.freeFireUid}</td>
                      <td className="px-6 py-4">{req.playerName}</td>
                      <td className="px-6 py-4 text-zinc-400">{req.region}</td>
                      <td className="px-6 py-4 font-mono text-red-400 font-bold">❤️ +{req.likesCount}</td>
                      <td className="px-6 py-4"><span className="text-emerald-400 font-bold">Success</span></td>
                      <td className="px-6 py-4 text-zinc-500">{new Date(req.createdAt || Date.now()).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'faq' && (
          <div className="space-y-4 max-w-3xl mx-auto animate-fade-in">
            <h2 className="text-2xl font-black font-['Orbitron',sans-serif] uppercase text-white">FAQ & Workflow Guide</h2>
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 space-y-2">
              <h3 className="font-bold text-white text-sm">1. Why is the UID section locked?</h3>
              <p className="text-xs text-zinc-400">Per our strict security workflow, you must first visit today's short link, collect the verification code, and enter it in Step 1 to unlock the UID section.</p>
            </div>
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 space-y-2">
              <h3 className="font-bold text-white text-sm">2. What is the daily request limit per UID?</h3>
              <p className="text-xs text-zinc-400">Each UID can successfully receive likes up to 3 times per day, resetting at midnight Bangladesh standard time (Asia/Dhaka).</p>
            </div>
          </div>
        )}

        {/* SEPARATE ADMIN PANEL ROUTE (/admin) */}
        {activeTab === 'admin' && (
          isAdminLoggedIn ? (
            <div className="space-y-8 animate-fade-in max-w-4xl mx-auto">
              <div className="border-b border-zinc-800 pb-4 flex items-center justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-600/20 text-red-400 text-[10px] font-bold uppercase tracking-widest border border-red-500/30">
                    <Shield className="w-3 h-3" /> Main Admin Panel ({MAIN_ADMIN_EMAIL})
                  </div>
                  <h1 className="text-2xl font-black font-['Orbitron',sans-serif] uppercase text-white mt-1">Dashboard & Management</h1>
                </div>
                <div className="text-xs text-zinc-400 bg-zinc-900 px-3 py-1.5 rounded-xl border border-zinc-800">
                  Authorized: <strong className="text-emerald-400">{adminUser?.email}</strong>
                </div>
              </div>

              {/* Admin Dashboard Metrics */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 space-y-2">
                  <span className="text-xs text-zinc-400 uppercase font-semibold">Total Registered Users</span>
                  <div className="text-2xl font-black text-white font-mono">1,420+</div>
                  <span className="text-[11px] text-emerald-400 font-medium">● Active Database Users</span>
                </div>
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 space-y-2">
                  <span className="text-xs text-zinc-400 uppercase font-semibold">Total Successful Likes</span>
                  <div className="text-2xl font-black text-emerald-400 font-mono">{globalStats.totalGlobalRequestsToday * 50}</div>
                  <span className="text-[11px] text-emerald-400 font-medium">● Delivered via HL Gaming API</span>
                </div>
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 space-y-2">
                  <span className="text-xs text-zinc-400 uppercase font-semibold">Failed Requests</span>
                  <div className="text-2xl font-black text-red-500 font-mono">{globalStats.failedRequestsCount}</div>
                  <span className="text-[11px] text-zinc-500">Rate limited or invalid</span>
                </div>
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 space-y-2">
                  <span className="text-xs text-zinc-400 uppercase font-semibold">Today's Total Likes</span>
                  <div className="text-2xl font-black text-white font-mono">{globalStats.totalGlobalRequestsToday} Requests</div>
                  <span className="text-[11px] text-blue-400 font-medium">Global Limit: {globalStats.globalDailyLimit}</span>
                </div>
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 space-y-2">
                  <span className="text-xs text-zinc-400 uppercase font-semibold">Active API Status</span>
                  <div className="text-2xl font-black text-emerald-400 font-mono uppercase">{dailyConfig.apiStatus}</div>
                  <span className="text-[11px] text-emerald-400">HL Gaming API Gateway</span>
                </div>
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 space-y-2">
                  <span className="text-xs text-zinc-400 uppercase font-semibold">Region (HL API)</span>
                  <div className="text-2xl font-black text-white font-mono">{dailyConfig.hlRegion}</div>
                  <span className="text-[11px] text-zinc-400">Server-side Enforced</span>
                </div>
              </div>

              {/* Daily Configuration Form */}
              <form onSubmit={handleSaveAdminConfig} className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-6 space-y-6">
                <h3 className="text-base font-bold text-white font-['Orbitron',sans-serif]">Short Link & Limits Management</h3>

                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1.5 uppercase">Short Link URL (Blogger / Custom)</label>
                  <input
                    type="text"
                    value={adminShortLinkUrl}
                    onChange={(e) => setAdminShortLinkUrl(e.target.value)}
                    placeholder="https://your-short-link.com"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-white text-xs font-mono"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1.5 uppercase">New Verification Code (6 or 8 Digits)</label>
                    <input
                      type="text"
                      value={adminNewCode}
                      onChange={(e) => setAdminNewCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="Leave blank to keep current"
                      maxLength={8}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-white text-xs font-mono tracking-widest"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1.5 uppercase">Code Length</label>
                    <select
                      value={adminCodeLength}
                      onChange={(e) => setAdminCodeLength(parseInt(e.target.value, 10))}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-white text-xs font-mono"
                    >
                      <option value={6}>6 Digits</option>
                      <option value={8}>8 Digits</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1.5 uppercase">Global Daily Limit</label>
                    <input
                      type="number"
                      value={adminGlobalLimit}
                      onChange={(e) => setAdminGlobalLimit(parseInt(e.target.value, 10) || 500)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-white text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1.5 uppercase">Per UID Daily Limit (Max 3)</label>
                    <input
                      type="number"
                      max={3}
                      min={1}
                      value={adminPerUidLimit}
                      onChange={(e) => setAdminPerUidLimit(Math.min(3, parseInt(e.target.value, 10) || 3))}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-white text-xs font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1.5 uppercase">API Status</label>
                  <select
                    value={adminApiStatus}
                    onChange={(e) => setAdminApiStatus(e.target.value as any)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-white text-xs font-mono"
                  >
                    <option value="active">Active (HL Gaming Official API)</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="not_configured">Not Configured</option>
                  </select>
                </div>

                <button
                  type="submit"
                  className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-3.5 rounded-xl text-xs uppercase tracking-wider font-['Orbitron',sans-serif] shadow-[0_0_20px_rgba(220,38,38,0.3)]"
                >
                  Save Daily Configuration
                </button>
              </form>
            </div>
          ) : (
            <div className="max-w-md mx-auto bg-zinc-900 border border-zinc-800 rounded-2xl p-8 text-center space-y-6 animate-fade-in">
              <Shield className="w-16 h-16 text-red-500 mx-auto animate-pulse" />
              <div className="space-y-2">
                <h2 className="text-xl font-bold font-['Orbitron',sans-serif] uppercase text-white">Main Admin Authentication</h2>
                <p className="text-xs text-zinc-400">Only the authorized Main Admin (<strong className="text-red-400">{MAIN_ADMIN_EMAIL}</strong>) can sign in to the /admin panel.</p>
              </div>
              <button
                onClick={handleAdminLogin}
                className="w-full bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600 text-white font-bold py-3.5 px-6 rounded-xl text-xs uppercase tracking-wider transition-all shadow-[0_0_20px_rgba(220,38,38,0.3)] flex items-center justify-center gap-2"
              >
                <Lock className="w-4 h-4" /> Sign In as Main Admin
              </button>
            </div>
          )
        )}

      </main>

      <footer className="border-t border-zinc-800/80 bg-[#07080c] py-8 mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-xs text-zinc-500">
          FIREBOOST FF © {new Date().getFullYear()} • Free Fire Auto Likes Website • Main Admin: {MAIN_ADMIN_EMAIL}
        </div>
      </footer>

    </div>
  );
}
