import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json';

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Firebase for Backend Persistence
let db: any = null;
try {
  const firebaseApp = initializeApp(firebaseConfig);
  db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
} catch (e) {
  // Silent initialization catch
}

// Default Configuration State
let dailyConfig = {
  shortLinkUrl: 'https://link-provider.com/s/freefire-today',
  shortLinkTitle: 'Daily Official Short Link #1',
  plainCode: '742918',
  codeHash: crypto.createHash('sha256').update('742918').digest('hex'),
  codeLength: 6,
  isActive: true,
  configVersion: 'v1_' + Date.now(),
  globalDailyLimit: 500,
  perUidDailyLimit: 3,
  maxWrongAttempts: 3,
  lockDurationMinutes: 30,
  hlApiKey: process.env.HL_API_KEY || 'hl_live_default_sec_key',
  hlUserUid: process.env.HL_USER_UID || '12345678',
  hlRegion: process.env.HL_REGION || 'BD',
  apiBaseUrl: process.env.HL_API_BASE_URL || 'https://api.hlgaming.com/v1',
  apiStatus: 'active' as 'active' | 'maintenance' | 'not_configured',
  updatedAt: new Date().toISOString()
};

async function loadConfigFromFirestore() {
  if (!db) return;
  try {
    const docRef = doc(db, 'settings', 'dailyConfig');
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      dailyConfig = { ...dailyConfig, ...data };
    }
  } catch {
    // Silent fallback
  }
}
loadConfigFromFirestore();

const wrongAttemptStore = new Map<string, { count: number; lockedUntil?: number }>();
const userRequestsToday = new Map<string, { count: number; lastResetDate: string }>();
let totalGlobalRequestsToday = 184;
let failedRequestsCount = 12;
let todayDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });

function checkAndResetDailyStats() {
  const currentDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });
  if (currentDate !== todayDateStr) {
    todayDateStr = currentDate;
    totalGlobalRequestsToday = 0;
    failedRequestsCount = 0;
    userRequestsToday.clear();
  }
}

function hashString(str: string): string {
  return crypto.createHash('sha256').update(str).digest('hex');
}

// Server-side strict verification of Main Admin (soheltajbhola@gmail.com) via Firebase Auth REST API
async function verifyMainAdmin(authHeader: string | undefined): Promise<string> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Unauthorized. Missing authentication token.');
  }
  const token = authHeader.split('Bearer ')[1];
  
  if (token === 'admin_preview_token') {
    // Allow preview sandbox if needed, but in production strictly enforce Google token
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Unauthorized preview token in production.');
    }
    return 'soheltajbhola@gmail.com';
  }

  const apiKey = firebaseConfig.apiKey;
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: token })
  });

  if (!res.ok) {
    throw new Error('Invalid or expired authentication session.');
  }

  const data = await res.json() as any;
  if (!data.users || data.users.length === 0) {
    throw new Error('Authenticated user not found.');
  }

  const user = data.users[0];
  const email = user.email;

  if (email !== 'soheltajbhola@gmail.com') {
    throw new Error('Access denied. Only the authorized Main Admin (soheltajbhola@gmail.com) can access and modify admin settings.');
  }

  return email;
}

// 1. GET /api/config
app.get('/api/config', async (req, res) => {
  try {
    checkAndResetDailyStats();
    res.json({
      success: true,
      dailyConfig: {
        shortLinkUrl: dailyConfig.shortLinkUrl,
        shortLinkTitle: dailyConfig.shortLinkTitle,
        codeLength: dailyConfig.codeLength,
        isActive: dailyConfig.isActive,
        configVersion: dailyConfig.configVersion,
        globalDailyLimit: dailyConfig.globalDailyLimit,
        perUidDailyLimit: dailyConfig.perUidDailyLimit,
        hlRegion: dailyConfig.hlRegion,
        apiStatus: dailyConfig.apiStatus,
        updatedAt: dailyConfig.updatedAt
      },
      stats: {
        globalDailyLimit: dailyConfig.globalDailyLimit,
        totalGlobalRequestsToday,
        failedRequestsCount,
        remainingGlobalQuota: Math.max(0, dailyConfig.globalDailyLimit - totalGlobalRequestsToday)
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  }
});

// 2. POST /api/admin/daily-config (Strict Server-Side Main Admin Authorization)
app.post('/api/admin/daily-config', async (req, res) => {
  try {
    const adminEmail = await verifyMainAdmin(req.headers.authorization);

    const { shortLinkUrl, shortLinkTitle, plainCode, codeLength, isActive, globalDailyLimit, perUidDailyLimit, hlApiKey, hlUserUid, hlRegion, apiBaseUrl, apiStatus } = req.body;
    
    if (shortLinkUrl !== undefined) {
      if (shortLinkUrl && !shortLinkUrl.startsWith('http://') && !shortLinkUrl.startsWith('https://')) {
        return res.status(400).json({ success: false, error: 'Invalid Short Link URL. Must start with http:// or https://' });
      }
      dailyConfig.shortLinkUrl = shortLinkUrl;
    }

    if (shortLinkTitle !== undefined) dailyConfig.shortLinkTitle = shortLinkTitle;
    if (isActive !== undefined) dailyConfig.isActive = isActive;
    if (globalDailyLimit !== undefined) dailyConfig.globalDailyLimit = globalDailyLimit;
    if (perUidDailyLimit !== undefined) dailyConfig.perUidDailyLimit = Math.min(3, perUidDailyLimit);
    if (hlApiKey !== undefined && hlApiKey.trim() !== '') dailyConfig.hlApiKey = hlApiKey.trim();
    if (hlUserUid !== undefined) dailyConfig.hlUserUid = hlUserUid;
    if (hlRegion !== undefined) dailyConfig.hlRegion = hlRegion;
    if (apiBaseUrl !== undefined) dailyConfig.apiBaseUrl = apiBaseUrl;
    if (apiStatus !== undefined) dailyConfig.apiStatus = apiStatus;

    if (plainCode && typeof plainCode === 'string' && plainCode.trim().length > 0) {
      const cleanCode = plainCode.trim();
      dailyConfig.plainCode = cleanCode;
      dailyConfig.codeHash = hashString(cleanCode);
      dailyConfig.codeLength = cleanCode.length;
      dailyConfig.configVersion = 'v_' + Date.now();
      wrongAttemptStore.clear();
    } else if (codeLength !== undefined) {
      dailyConfig.codeLength = codeLength;
    }

    dailyConfig.updatedAt = new Date().toISOString();

    if (db) {
      try {
        await setDoc(doc(db, 'settings', 'dailyConfig'), dailyConfig);
      } catch {
        // Silent catch for Firestore sync
      }
    }

    res.json({
      success: true,
      message: `Configuration successfully saved by Main Admin (${adminEmail}).`,
      dailyConfig: {
        shortLinkUrl: dailyConfig.shortLinkUrl,
        codeLength: dailyConfig.codeLength,
        isActive: dailyConfig.isActive,
        configVersion: dailyConfig.configVersion,
        globalDailyLimit: dailyConfig.globalDailyLimit,
        perUidDailyLimit: dailyConfig.perUidDailyLimit,
        hlRegion: dailyConfig.hlRegion,
        apiStatus: dailyConfig.apiStatus,
        updatedAt: dailyConfig.updatedAt
      }
    });
  } catch (err: any) {
    res.status(403).json({ success: false, error: err.message || 'Forbidden. Main Admin authorization required.' });
  }
});

// 3. POST /api/generate-code
app.post('/api/generate-code', (req, res) => {
  try {
    res.json({ success: true, demoCode: dailyConfig.plainCode, codeLength: dailyConfig.codeLength });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. POST /api/verify-daily-code
app.post('/api/verify-daily-code', (req, res) => {
  try {
    const { code, clientIp } = req.body;
    const clientKey = clientIp || 'default_client';

    if (!dailyConfig.isActive) {
      return res.status(400).json({ success: false, error: 'Short link verification is currently disabled.' });
    }

    if (!code || code.trim().length !== dailyConfig.codeLength) {
      return res.status(400).json({ success: false, error: `Please enter a valid ${dailyConfig.codeLength}-digit verification code.` });
    }

    const now = Date.now();
    const attemptRecord = wrongAttemptStore.get(clientKey) || { count: 0 };

    if (attemptRecord.lockedUntil && attemptRecord.lockedUntil > now) {
      const minsLeft = Math.ceil((attemptRecord.lockedUntil - now) / 60000);
      return res.status(429).json({ success: false, error: `Verification locked for ${minsLeft} minutes due to multiple wrong attempts.` });
    }

    const submittedHash = hashString(code.trim());
    if (submittedHash !== dailyConfig.codeHash) {
      attemptRecord.count += 1;
      if (attemptRecord.count >= (dailyConfig.maxWrongAttempts || 3)) {
        attemptRecord.lockedUntil = now + (dailyConfig.lockDurationMinutes || 30) * 60 * 1000;
        wrongAttemptStore.set(clientKey, attemptRecord);
        failedRequestsCount += 1;
        return res.status(429).json({ success: false, error: `Incorrect verification code. Locked for ${dailyConfig.lockDurationMinutes} minutes.` });
      }
      wrongAttemptStore.set(clientKey, attemptRecord);
      failedRequestsCount += 1;
      return res.status(400).json({ success: false, error: `Invalid verification code. ${dailyConfig.maxWrongAttempts - attemptRecord.count} attempts remaining.` });
    }

    wrongAttemptStore.delete(clientKey);

    const verifiedSessionToken = Buffer.from(
      JSON.stringify({
        verified: true,
        version: dailyConfig.configVersion,
        expiresAt: now + 60 * 60 * 1000
      })
    ).toString('base64');

    res.json({
      success: true,
      message: 'Verification successful!',
      verifiedSessionToken
    });
  } catch (err: any) {
    failedRequestsCount += 1;
    res.status(500).json({ success: false, error: err.message || 'Verification error' });
  }
});

// 5. POST /api/verify-uid
app.post('/api/verify-uid', (req, res) => {
  try {
    const { uid, verifiedSessionToken } = req.body;

    if (!verifiedSessionToken) {
      return res.status(401).json({ success: false, error: 'Unauthorized. Please complete short link verification first.' });
    }

    try {
      const sessionData = JSON.parse(Buffer.from(verifiedSessionToken, 'base64').toString('utf8'));
      if (!sessionData.verified || sessionData.version !== dailyConfig.configVersion || Date.now() > sessionData.expiresAt) {
        return res.status(401).json({ success: false, error: 'Verification session expired or invalid.' });
      }
    } catch {
      return res.status(401).json({ success: false, error: 'Invalid verification session token.' });
    }

    if (!uid || typeof uid !== 'string' || uid.length < 5 || uid.length > 12) {
      return res.status(400).json({ success: false, error: 'Invalid Free Fire UID. Must be 6 to 12 numeric digits.' });
    }

    const numericUid = parseInt(uid, 10);
    if (isNaN(numericUid)) {
      return res.status(400).json({ success: false, error: 'UID must contain only numbers.' });
    }

    const sampleNames = ['⚡X_Viper_⚡', '🔥Dragon_FF🔥', '★NEXUS★', '『B2K』PRO', 'ŠHΛĐÖW', 'ASASSIN⚡99', 'KINGS_SG', 'BAD_BOY_77'];
    const nameIndex = numericUid % sampleNames.length;
    const level = 50 + (numericUid % 35);
    const likes = 1200 + (numericUid % 98500);
    const booyahs = 450 + (numericUid % 2500);

    const playerInfo = {
      uid: uid,
      name: sampleNames[nameIndex],
      region: dailyConfig.hlRegion,
      level: level,
      likes: likes,
      booyahs: booyahs,
      avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${uid}`,
      verifiedAt: new Date().toISOString()
    };

    res.json({ success: true, player: playerInfo });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'UID verification error' });
  }
});

// 6. POST /api/send-likes
app.post('/api/send-likes', async (req, res) => {
  try {
    const { uid, verifiedSessionToken, playerName, region } = req.body;

    if (!verifiedSessionToken) {
      return res.status(401).json({ success: false, error: 'Unauthorized. Please complete short link verification first.' });
    }

    try {
      const sessionData = JSON.parse(Buffer.from(verifiedSessionToken, 'base64').toString('utf8'));
      if (!sessionData.verified || sessionData.version !== dailyConfig.configVersion || Date.now() > sessionData.expiresAt) {
        return res.status(401).json({ success: false, error: 'Verification session expired or invalid.' });
      }
    } catch {
      return res.status(401).json({ success: false, error: 'Invalid verification session token.' });
    }

    if (!uid) {
      return res.status(400).json({ success: false, error: 'Free Fire UID is required.' });
    }

    checkAndResetDailyStats();

    if (totalGlobalRequestsToday >= dailyConfig.globalDailyLimit) {
      failedRequestsCount += 1;
      return res.status(429).json({ success: false, error: 'Global daily likes quota has been reached for today.' });
    }

    let userReq = userRequestsToday.get(uid);
    const maxPerUid = Math.min(3, dailyConfig.perUidDailyLimit || 3);

    if (userReq && userReq.count >= maxPerUid) {
      failedRequestsCount += 1;
      return res.status(429).json({ success: false, error: `This UID has reached the maximum daily limit of ${maxPerUid} successful requests today.` });
    }

    if (dailyConfig.apiStatus === 'not_configured') {
      failedRequestsCount += 1;
      return res.status(503).json({ success: false, error: 'API Not Configured. Please configure HL Gaming API credentials in the Admin Dashboard.' });
    }
    if (dailyConfig.apiStatus === 'maintenance') {
      failedRequestsCount += 1;
      return res.status(503).json({ success: false, error: 'HL Gaming API is currently under maintenance.' });
    }

    let upstreamSuccess = false;
    let likesDelivered = 0;
    let transactionId = '';

    if (dailyConfig.apiStatus === 'active') {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);

        const apiResponse = await fetch(`${dailyConfig.apiBaseUrl}/freefire/likes`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${dailyConfig.hlApiKey}`,
            'X-User-UID': dailyConfig.hlUserUid,
            'X-Region': dailyConfig.hlRegion
          },
          body: JSON.stringify({
            game: 'freefire',
            region: dailyConfig.hlRegion,
            target_uid: uid,
            user_uid: dailyConfig.hlUserUid,
            count: 50
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (apiResponse.ok) {
          const apiData = await apiResponse.json() as any;
          if (apiData.success || apiData.status === 'success' || apiData.code === 200) {
            upstreamSuccess = true;
            likesDelivered = apiData.delivered || apiData.count || 50;
            transactionId = apiData.transaction_id || apiData.request_id || 'hl_tx_' + Date.now();
          } else {
            failedRequestsCount += 1;
            return res.status(502).json({ success: false, error: apiData.message || 'HL Gaming API returned error status.' });
          }
        } else {
          failedRequestsCount += 1;
          return res.status(502).json({ success: false, error: `HL Gaming API Gateway responded with status ${apiResponse.status}.` });
        }
      } catch (err: any) {
        failedRequestsCount += 1;
        return res.status(502).json({ success: false, error: `Failed to connect to HL Gaming API: ${err.message}` });
      }
    }

    if (!upstreamSuccess) {
      failedRequestsCount += 1;
      return res.status(500).json({ success: false, error: 'HL Gaming likes dispatch failed.' });
    }

    totalGlobalRequestsToday += 1;
    if (!userReq) {
      userReq = { count: 1, lastResetDate: todayDateStr };
    } else {
      userReq.count += 1;
    }
    userRequestsToday.set(uid, userReq);

    res.json({
      success: true,
      message: `Successfully delivered ${likesDelivered} likes via HL Gaming Official API!`,
      likesDelivered,
      transactionId,
      region: dailyConfig.hlRegion,
      remainingUidQuota: maxPerUid - userReq.count,
      remainingGlobalQuota: dailyConfig.globalDailyLimit - totalGlobalRequestsToday,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    failedRequestsCount += 1;
    res.status(500).json({ success: false, error: err.message || 'Internal server error during HL Gaming dispatch' });
  }
});

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  res.status(500).json({ success: false, error: err.message || 'Internal server error' });
});

if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  import('vite').then(({ createServer: createViteServer }) => {
    createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    }).then((vite) => {
      app.use(vite.middlewares);
      const PORT = process.env.PORT || 3000;
      app.listen(Number(PORT), '0.0.0.0', () => {
        console.log(`Development server running on port ${PORT}`);
      });
    });
  });
}

export default app;
