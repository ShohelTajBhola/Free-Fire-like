import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Admin Daily Verification & Limits Configuration
  let dailyConfig = {
    shortLinkUrl: 'https://link-provider.com/s/freefire-today',
    shortLinkTitle: 'Daily Official Short Link #1',
    plainCode: '742918', // Stored as hash in production
    codeHash: crypto.createHash('sha256').update('742918').digest('hex'),
    codeLength: 6,
    isActive: true,
    configVersion: 'v1_' + Date.now(),
    globalDailyLimit: 500,
    perUidDailyLimit: 3,
    maxWrongAttempts: 3,
    lockDurationMinutes: 30,
    apiBaseUrl: 'https://api.freefire-likes-gateway.com/v1',
    apiKey: 'ff_live_sec_789456123abc',
    apiStatus: 'active' as 'active' | 'maintenance' | 'not_configured'
  };

  // Tracking wrong verification attempts per IP / Session
  const wrongAttemptStore = new Map<string, { count: number; lockedUntil?: number }>();
  
  // Daily request counters
  const userRequestsToday = new Map<string, { count: number; lastResetDate: string }>();
  let totalGlobalRequestsToday = 184;
  let todayDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });

  function checkAndResetDailyStats() {
    const currentDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });
    if (currentDate !== todayDateStr) {
      todayDateStr = currentDate;
      totalGlobalRequestsToday = 0;
      userRequestsToday.clear();
    }
  }

  function hashString(str: string): string {
    return crypto.createHash('sha256').update(str).digest('hex');
  }

  // 1. GET /api/config
  app.get('/api/config', (req, res) => {
    checkAndResetDailyStats();
    res.json({
      dailyConfig: {
        shortLinkUrl: dailyConfig.shortLinkUrl,
        shortLinkTitle: dailyConfig.shortLinkTitle,
        codeLength: dailyConfig.codeLength,
        isActive: dailyConfig.isActive,
        configVersion: dailyConfig.configVersion,
        globalDailyLimit: dailyConfig.globalDailyLimit,
        perUidDailyLimit: dailyConfig.perUidDailyLimit,
        apiStatus: dailyConfig.apiStatus
        // Note: codeHash and plainCode are never sent to frontend
      },
      stats: {
        globalDailyLimit: dailyConfig.globalDailyLimit,
        totalGlobalRequestsToday,
        remainingGlobalQuota: Math.max(0, dailyConfig.globalDailyLimit - totalGlobalRequestsToday)
      }
    });
  });

  // 2. POST /api/admin/daily-config (Admin updates short link, code, limits)
  app.post('/api/admin/daily-config', (req, res) => {
    const { shortLinkUrl, shortLinkTitle, plainCode, codeLength, isActive, globalDailyLimit, perUidDailyLimit, apiBaseUrl, apiKey, apiStatus } = req.body;
    
    if (shortLinkUrl !== undefined) dailyConfig.shortLinkUrl = shortLinkUrl;
    if (shortLinkTitle !== undefined) dailyConfig.shortLinkTitle = shortLinkTitle;
    if (codeLength !== undefined) dailyConfig.codeLength = codeLength;
    if (isActive !== undefined) dailyConfig.isActive = isActive;
    if (globalDailyLimit !== undefined) dailyConfig.globalDailyLimit = globalDailyLimit;
    if (perUidDailyLimit !== undefined) dailyConfig.perUidDailyLimit = Math.min(3, perUidDailyLimit); // Max 3 per UID
    if (apiBaseUrl !== undefined) dailyConfig.apiBaseUrl = apiBaseUrl;
    if (apiKey !== undefined) dailyConfig.apiKey = apiKey;
    if (apiStatus !== undefined) dailyConfig.apiStatus = apiStatus;

    if (plainCode) {
      dailyConfig.plainCode = plainCode;
      dailyConfig.codeHash = hashString(plainCode);
      dailyConfig.configVersion = 'v_' + Date.now(); // Invalidate old verified sessions upon code change
      wrongAttemptStore.clear(); // Reset wrong attempts on new code
    }

    res.json({
      success: true,
      message: 'Daily configuration updated successfully. Previous verification sessions for old code are invalidated.',
      dailyConfig: {
        shortLinkUrl: dailyConfig.shortLinkUrl,
        codeLength: dailyConfig.codeLength,
        isActive: dailyConfig.isActive,
        configVersion: dailyConfig.configVersion,
        globalDailyLimit: dailyConfig.globalDailyLimit,
        perUidDailyLimit: dailyConfig.perUidDailyLimit
      }
    });
  });

  // 3. POST /api/verify-daily-code (User submits 6/8 digit code to unlock UID section)
  app.post('/api/verify-daily-code', (req, res) => {
    const { code, clientIp } = req.body;
    const clientKey = clientIp || 'default_client';

    if (!dailyConfig.isActive) {
      return res.status(400).json({ error: 'Short link verification is currently disabled by admin.' });
    }

    if (!code || code.trim().length !== dailyConfig.codeLength) {
      return res.status(400).json({ error: `Please enter a valid ${dailyConfig.codeLength}-digit verification code.` });
    }

    const now = Date.now();
    const attemptRecord = wrongAttemptStore.get(clientKey) || { count: 0 };

    if (attemptRecord.lockedUntil && attemptRecord.lockedUntil > now) {
      const minsLeft = Math.ceil((attemptRecord.lockedUntil - now) / 60000);
      return res.status(429).json({ error: `Too many wrong attempts. Verification locked for ${minsLeft} minutes.` });
    }

    const submittedHash = hashString(code.trim());
    if (submittedHash !== dailyConfig.codeHash) {
      attemptRecord.count += 1;
      if (attemptRecord.count >= (dailyConfig.maxWrongAttempts || 3)) {
        attemptRecord.lockedUntil = now + (dailyConfig.lockDurationMinutes || 30) * 60 * 1000;
        wrongAttemptStore.set(clientKey, attemptRecord);
        return res.status(429).json({ error: `Incorrect verification code. Locked for ${dailyConfig.lockDurationMinutes} minutes due to multiple failed attempts.` });
      }
      wrongAttemptStore.set(clientKey, attemptRecord);
      return res.status(400).json({ error: `Invalid verification code. ${dailyConfig.maxWrongAttempts - attemptRecord.count} attempts remaining.` });
    }

    // Reset wrong attempts on success
    wrongAttemptStore.delete(clientKey);

    // Issue Verified Session Token tied to current config version
    const verifiedSessionToken = Buffer.from(
      JSON.stringify({
        verified: true,
        version: dailyConfig.configVersion,
        expiresAt: now + 60 * 60 * 1000 // 1 hour session
      })
    ).toString('base64');

    res.json({
      success: true,
      message: 'Short link verification successful! Free Fire UID section unlocked.',
      verifiedSessionToken
    });
  });

  // 4. POST /api/verify-uid (Requires valid verified session token)
  app.post('/api/verify-uid', (req, res) => {
    const { uid, verifiedSessionToken } = req.body;

    if (!verifiedSessionToken) {
      return res.status(401).json({ error: 'Unauthorized. Please complete short link verification first.' });
    }

    try {
      const sessionData = JSON.parse(Buffer.from(verifiedSessionToken, 'base64').toString('utf8'));
      if (!sessionData.verified || sessionData.version !== dailyConfig.configVersion || Date.now() > sessionData.expiresAt) {
        return res.status(401).json({ error: 'Verification session expired or invalid. Please verify the short link code again.' });
      }
    } catch {
      return res.status(401).json({ error: 'Invalid verification session token.' });
    }

    if (!uid || typeof uid !== 'string' || uid.length < 5 || uid.length > 12) {
      return res.status(400).json({ error: 'Invalid Free Fire UID. Must be 6 to 12 numeric digits.' });
    }

    const numericUid = parseInt(uid, 10);
    if (isNaN(numericUid)) {
      return res.status(400).json({ error: 'UID must contain only numbers.' });
    }

    const sampleNames = ['⚡X_Viper_⚡', '🔥Dragon_FF🔥', '★NEXUS★', '『B2K』PRO', 'ŠHΛĐÖW', 'ASASSIN⚡99', 'KINGS_SG', 'BAD_BOY_77'];
    const regions = ['Bangladesh', 'India', 'Europe', 'Singapore', 'Middle East'];
    
    const nameIndex = numericUid % sampleNames.length;
    const regionIndex = numericUid % regions.length;
    const level = 50 + (numericUid % 35);
    const likes = 1200 + (numericUid % 98500);
    const booyahs = 450 + (numericUid % 2500);

    const playerInfo = {
      uid: uid,
      name: sampleNames[nameIndex],
      region: regions[regionIndex],
      level: level,
      likes: likes,
      booyahs: booyahs,
      avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${uid}`,
      verifiedAt: new Date().toISOString()
    };

    res.json({ success: true, player: playerInfo });
  });

  // 5. POST /api/send-likes (Enforces max 3 per UID, global limit, verified session, real API)
  app.post('/api/send-likes', async (req, res) => {
    const { uid, verifiedSessionToken, playerName, region } = req.body;

    if (!verifiedSessionToken) {
      return res.status(401).json({ error: 'Unauthorized. Please complete short link verification first.' });
    }

    try {
      const sessionData = JSON.parse(Buffer.from(verifiedSessionToken, 'base64').toString('utf8'));
      if (!sessionData.verified || sessionData.version !== dailyConfig.configVersion || Date.now() > sessionData.expiresAt) {
        return res.status(401).json({ error: 'Verification session expired or invalid. Please verify again.' });
      }
    } catch {
      return res.status(401).json({ error: 'Invalid verification session token.' });
    }

    if (!uid) {
      return res.status(400).json({ error: 'Free Fire UID is required.' });
    }

    checkAndResetDailyStats();

    // Check Global Daily Limit
    if (totalGlobalRequestsToday >= dailyConfig.globalDailyLimit) {
      return res.status(429).json({ error: 'Global daily likes quota has been reached for today. Please try again tomorrow after midnight (Asia/Dhaka).' });
    }

    // Check Per-UID Daily Limit (Max 3 per day)
    let userReq = userRequestsToday.get(uid);
    const maxPerUid = Math.min(3, dailyConfig.perUidDailyLimit || 3);

    if (userReq && userReq.count >= maxPerUid) {
      return res.status(429).json({ error: `This UID has reached the maximum daily limit of ${maxPerUid} successful requests today.` });
    }

    // Check API Status
    if (dailyConfig.apiStatus === 'not_configured') {
      return res.status(503).json({ error: 'API Not Configured. Please configure the Free Fire Likes API in the Admin Dashboard.' });
    }
    if (dailyConfig.apiStatus === 'maintenance') {
      return res.status(503).json({ error: 'Likes API is currently under maintenance.' });
    }

    let upstreamSuccess = false;
    let likesDelivered = 0;

    if (dailyConfig.apiStatus === 'active') {
      try {
        const apiResponse = await fetch(`${dailyConfig.apiBaseUrl}/dispatch-likes`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${dailyConfig.apiKey}`
          },
          body: JSON.stringify({ uid, playerName, region, count: 50 })
        });

        if (apiResponse.ok) {
          const apiData = await apiResponse.json() as any;
          upstreamSuccess = true;
          likesDelivered = apiData.delivered || 50;
        } else {
          return res.status(502).json({ error: 'Free Fire Likes API Gateway returned an error. Likes not delivered.' });
        }
      } catch {
        return res.status(502).json({ error: 'Unable to connect to Free Fire Likes API Gateway.' });
      }
    }

    if (!upstreamSuccess) {
      return res.status(500).json({ error: 'Likes dispatch failed.' });
    }

    // Atomic increment upon confirmed success
    totalGlobalRequestsToday += 1;
    if (!userReq) {
      userReq = { count: 1, lastResetDate: todayDateStr };
    } else {
      userReq.count += 1;
    }
    userRequestsToday.set(uid, userReq);

    res.json({
      success: true,
      message: `Successfully delivered ${likesDelivered} likes to Free Fire UID ${uid}!`,
      likesDelivered,
      remainingUidQuota: maxPerUid - userReq.count,
      remainingGlobalQuota: dailyConfig.globalDailyLimit - totalGlobalRequestsToday,
      timestamp: new Date().toISOString()
    });
  });

  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa'
  });

  app.use(vite.middlewares);

  const PORT = process.env.PORT || 3000;
  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
