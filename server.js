const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const LEADERBOARD_FILE = path.join(DATA_DIR, 'leaderboard.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Load persistent leaderboard from disk
function loadLeaderboard() {
  try {
    if (fs.existsSync(LEADERBOARD_FILE)) {
      const raw = fs.readFileSync(LEADERBOARD_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) return data;
    }
  } catch (err) {
    console.error('Failed to load leaderboard from disk:', err.message);
  }
  return [];
}

// Save persistent leaderboard to disk
function saveLeaderboard(board) {
  try {
    fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(board, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save leaderboard to disk:', err.message);
  }
}

app.use(cors());
app.use(express.json());

// Detect best Local Area Network IPv4 address (Wi-Fi / Ethernet fallback for localhost)
function getLocalNetworkIp() {
  const interfaces = os.networkInterfaces();
  const candidates = [];
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const lowerName = name.toLowerCase();
        const isPriority = lowerName.includes('en0') || lowerName.includes('wlan') || lowerName.includes('wi-fi') || lowerName.includes('eth');
        candidates.push({ address: iface.address, priority: isPriority ? 1 : 2, name });
      }
    }
  }

  candidates.sort((a, b) => a.priority - b.priority);
  return candidates.length > 0 ? candidates[0].address : 'localhost';
}

// Auto-detect Render or Cloud Public URL
// Render automatically provides RENDER_EXTERNAL_URL (e.g. https://iiserb-banters.onrender.com)
const CLOUD_PUBLIC_URL = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || process.env.SERVER_URL;
let configuredHostUrl = CLOUD_PUBLIC_URL || `http://${getLocalNetworkIp()}:${PORT}`;

// Middleware to automatically capture the public domain from incoming browser requests
// (handles Render, Railway, ngrok, custom domains seamlessly)
app.use((req, res, next) => {
  const host = req.get('host');
  if (host && !host.startsWith('localhost') && !host.startsWith('127.0.0.1')) {
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const currentPublicUrl = `${proto}://${host}`;
    
    // If our current configured host is still an internal IP, auto-upgrade to the real public URL
    const isInternal = configuredHostUrl.startsWith('http://10.') || 
                       configuredHostUrl.startsWith('http://172.') || 
                       configuredHostUrl.startsWith('http://192.168.') || 
                       configuredHostUrl.includes('localhost');
                       
    if (isInternal || configuredHostUrl !== currentPublicUrl) {
      configuredHostUrl = currentPublicUrl;
    }
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Configurable Phase Timers
const PERFORMANCE_TIME = 90; // 90 seconds (1.5 minutes)
let VOTING_TIME = 45;        // 45 seconds voting

let appState = {
  status: 'IDLE', // 'IDLE' | 'PERFORMING' | 'READY_TO_VOTE' | 'VOTING' | 'REVEALED'
  currentCandidate: null,
  timer: 0,
  votes: [],
  lastResult: null,
  leaderboard: loadLeaderboard(),
  votingDuration: VOTING_TIME
};

let activeTimerInterval = null;

function calculateScore(votes) {
  if (!votes || votes.length === 0) {
    return {
      rawAverage: 0,
      roundedScore: 0,
      formattedScore: "0.0",
      voteCount: 0,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0 }
    };
  }

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0 };
  let sum = 0;

  for (const v of votes) {
    const s = Math.min(10, Math.max(1, Math.round(v.score)));
    distribution[s] = (distribution[s] || 0) + 1;
    sum += v.score;
  }

  const rawAverage = sum / votes.length;
  // Round strictly to nearest 0.5 (e.g. 1, 1.5, 2, 2.5, ..., 10)
  const roundedScore = Math.round(rawAverage * 2) / 2;
  const formattedScore = (roundedScore % 1 === 0) ? `${roundedScore}.0` : `${roundedScore}`;

  return {
    rawAverage: Number(rawAverage.toFixed(2)),
    roundedScore,
    formattedScore,
    voteCount: votes.length,
    distribution
  };
}

function clearAnyTimer() {
  if (activeTimerInterval) {
    clearInterval(activeTimerInterval);
    activeTimerInterval = null;
  }
}

function startPerformancePhase(candidateName, actName) {
  clearAnyTimer();
  const id = 'cand_' + Date.now();
  appState.status = 'PERFORMING';
  appState.currentCandidate = {
    id,
    name: candidateName.trim() || 'Anonymous Performer',
    act: actName ? actName.trim() : 'Talent Act',
    startedAt: Date.now()
  };
  appState.timer = PERFORMANCE_TIME;
  appState.votes = [];
  appState.lastResult = null;

  io.emit('state:update', getClientState());

  activeTimerInterval = setInterval(() => {
    appState.timer -= 1;
    io.emit('timer:tick', { status: appState.status, secondsLeft: appState.timer });

    if (appState.timer <= 0) {
      clearAnyTimer();
      // Instead of auto-starting voting, enter READY_TO_VOTE so Host Souradip can banters and explicitly click Start Voting
      appState.status = 'READY_TO_VOTE';
      appState.timer = 0;
      io.emit('state:update', getClientState());
      io.emit('performance:finished', { candidate: appState.currentCandidate });
    }
  }, 1000);
}

function startVotingPhase() {
  clearAnyTimer();
  appState.status = 'VOTING';
  appState.timer = VOTING_TIME;

  io.emit('state:update', getClientState());
  io.emit('voting:started', {
    candidate: appState.currentCandidate,
    votingDuration: VOTING_TIME
  });

  activeTimerInterval = setInterval(() => {
    appState.timer -= 1;
    io.emit('timer:tick', { status: appState.status, secondsLeft: appState.timer });

    if (appState.timer <= 0) {
      clearAnyTimer();
      revealScoresPhase();
    }
  }, 1000);
}

function revealScoresPhase() {
  clearAnyTimer();
  appState.status = 'REVEALED';
  appState.timer = 0;

  const results = calculateScore(appState.votes);
  appState.lastResult = {
    candidate: appState.currentCandidate,
    ...results
  };

  // Persist candidate to leaderboard
  if (appState.currentCandidate) {
    appState.leaderboard = appState.leaderboard.filter(c => c.id !== appState.currentCandidate.id);
    appState.leaderboard.push({
      id: appState.currentCandidate.id,
      name: appState.currentCandidate.name,
      act: appState.currentCandidate.act,
      roundedScore: results.roundedScore,
      formattedScore: results.formattedScore,
      rawAverage: results.rawAverage,
      voteCount: results.voteCount,
      distribution: results.distribution,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      date: new Date().toLocaleDateString()
    });

    appState.leaderboard.sort((a, b) => b.roundedScore - a.roundedScore || b.rawAverage - a.rawAverage);
    saveLeaderboard(appState.leaderboard);
  }

  io.emit('state:update', getClientState());
  io.emit('score:revealed', appState.lastResult);
}

function resetToIdle() {
  clearAnyTimer();
  appState.status = 'IDLE';
  appState.currentCandidate = null;
  appState.timer = 0;
  appState.votes = [];
  appState.lastResult = null;

  io.emit('state:update', getClientState());
}

function getClientState() {
  return {
    status: appState.status,
    currentCandidate: appState.currentCandidate,
    timer: appState.timer,
    voteCount: appState.votes.length,
    lastResult: appState.lastResult,
    leaderboard: appState.leaderboard,
    hostUrl: configuredHostUrl,
    votingUrl: `${configuredHostUrl}/vote`,
    votingDuration: VOTING_TIME,
    performanceDuration: PERFORMANCE_TIME,
    hostName: 'Souradip'
  };
}

// REST API Endpoints
app.get('/api/config', (req, res) => {
  const host = req.get('host');
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const autoUrl = (host && !host.startsWith('localhost') && !host.startsWith('127.0.0.1'))
    ? `${proto}://${host}`
    : configuredHostUrl;

  res.json({
    lanIp: getLocalNetworkIp(),
    port: PORT,
    hostUrl: autoUrl,
    votingUrl: `${autoUrl}/vote`,
    votingDuration: VOTING_TIME
  });
});

app.post('/api/config/host-url', (req, res) => {
  const { url } = req.body;
  if (url && typeof url === 'string') {
    let cleanUrl = url.trim();
    if (cleanUrl.endsWith('/')) {
      cleanUrl = cleanUrl.slice(0, -1);
    }
    configuredHostUrl = cleanUrl;
    io.emit('state:update', getClientState());
    return res.json({ success: true, hostUrl: configuredHostUrl, votingUrl: `${configuredHostUrl}/vote` });
  }
  res.status(400).json({ error: 'Invalid URL provided' });
});

app.post('/api/config/voting-time', (req, res) => {
  const { seconds } = req.body;
  const num = parseInt(seconds, 10);
  if (!isNaN(num) && num >= 10 && num <= 300) {
    VOTING_TIME = num;
    appState.votingDuration = VOTING_TIME;
    io.emit('state:update', getClientState());
    return res.json({ success: true, votingDuration: VOTING_TIME });
  }
  res.status(400).json({ error: 'Invalid voting duration' });
});

app.get('/api/state', (req, res) => {
  res.json(getClientState());
});

app.get('/api/qr', async (req, res) => {
  try {
    let text = req.query.text;
    if (!text) {
      const host = req.get('host');
      const proto = req.headers['x-forwarded-proto'] || req.protocol;
      const base = (host && !host.startsWith('localhost') && !host.startsWith('127.0.0.1'))
        ? `${proto}://${host}`
        : configuredHostUrl;
      text = `${base}/vote`;
    }

    const dataUrl = await QRCode.toDataURL(text, {
      margin: 2,
      width: 400,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
    res.json({ qrCodeDataUrl: dataUrl, url: text });
  } catch (err) {
    res.status(500).json({ error: 'QR generation failed', details: err.message });
  }
});

app.get('/api/leaderboard', (req, res) => {
  res.json(appState.leaderboard);
});

app.delete('/api/leaderboard/:id', (req, res) => {
  const { id } = req.params;
  appState.leaderboard = appState.leaderboard.filter(item => item.id !== id);
  saveLeaderboard(appState.leaderboard);
  io.emit('state:update', getClientState());
  res.json({ success: true, leaderboard: appState.leaderboard });
});

app.post('/api/leaderboard/clear', (req, res) => {
  appState.leaderboard = [];
  saveLeaderboard(appState.leaderboard);
  io.emit('state:update', getClientState());
  res.json({ success: true });
});

// CSV Export
app.get('/api/leaderboard/export', (req, res) => {
  let csv = 'Rank,Candidate Name,Act / Talent,Rounded Score,Raw Average,Audience Votes,Time,Date\n';
  appState.leaderboard.forEach((item, index) => {
    csv += `"${index + 1}","${(item.name || '').replace(/"/g, '""')}","${(item.act || '').replace(/"/g, '""')}","${item.formattedScore}","${item.rawAverage}","${item.voteCount}","${item.timestamp}","${item.date || ''}"\n`;
  });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="IISERB_Got_Banters_Leaderboard.csv"');
  res.send(csv);
});

// Frontend Routes
app.get('/vote', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'vote.html'));
});

app.get('/stage', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.IO Events
io.on('connection', (socket) => {
  socket.emit('state:update', getClientState());

  socket.on('stage:start_performance', ({ candidateName, actName }) => {
    startPerformancePhase(candidateName, actName);
  });

  // End performance and move to READY_TO_VOTE state (allowing host banter before opening voting)
  socket.on('stage:end_performance', () => {
    if (appState.status === 'PERFORMING') {
      clearAnyTimer();
      appState.status = 'READY_TO_VOTE';
      appState.timer = 0;
      io.emit('state:update', getClientState());
      io.emit('performance:finished', { candidate: appState.currentCandidate });
    }
  });

  // Explicitly Start Audience Voting (45s Timer & QR Code)
  socket.on('stage:start_voting', () => {
    if (appState.status === 'PERFORMING' || appState.status === 'READY_TO_VOTE') {
      startVotingPhase();
    }
  });

  socket.on('stage:skip_to_voting', () => {
    if (appState.status === 'PERFORMING' || appState.status === 'READY_TO_VOTE') {
      startVotingPhase();
    }
  });

  socket.on('stage:add_time', (seconds = 15) => {
    if (appState.status === 'PERFORMING' || appState.status === 'VOTING') {
      appState.timer += seconds;
      io.emit('timer:tick', { status: appState.status, secondsLeft: appState.timer });
    }
  });

  socket.on('stage:force_reveal', () => {
    if (appState.status === 'VOTING') {
      revealScoresPhase();
    }
  });

  socket.on('stage:reset_candidate', () => {
    resetToIdle();
  });

  socket.on('stage:clear_leaderboard', () => {
    appState.leaderboard = [];
    saveLeaderboard(appState.leaderboard);
    io.emit('state:update', getClientState());
  });

  socket.on('stage:delete_candidate', (id) => {
    appState.leaderboard = appState.leaderboard.filter(c => c.id !== id);
    saveLeaderboard(appState.leaderboard);
    io.emit('state:update', getClientState());
  });

  socket.on('vote:submit', ({ voterId, score }) => {
    if (appState.status !== 'VOTING') {
      return socket.emit('vote:response', {
        success: false,
        message: 'Voting is currently closed!'
      });
    }

    const numScore = parseFloat(score);
    if (isNaN(numScore) || numScore < 1 || numScore > 10) {
      return socket.emit('vote:response', {
        success: false,
        message: 'Marks must be between 1 and 10!'
      });
    }

    const existingIndex = appState.votes.findIndex(v => v.voterId === voterId);
    if (existingIndex !== -1) {
      appState.votes[existingIndex].score = numScore;
      appState.votes[existingIndex].timestamp = Date.now();
      socket.emit('vote:response', {
        success: true,
        score: numScore,
        candidateName: appState.currentCandidate.name,
        message: 'Your score has been updated to ' + numScore + '!'
      });
    } else {
      appState.votes.push({
        voterId: voterId || 'anon_' + Math.random().toString(36).substring(2, 9),
        score: numScore,
        timestamp: Date.now()
      });
      socket.emit('vote:response', {
        success: true,
        score: numScore,
        candidateName: appState.currentCandidate.name,
        message: 'Your vote of ' + numScore + '/10 has been recorded!'
      });
    }

    io.emit('vote:count_updated', {
      voteCount: appState.votes.length
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🎭 IISERB GOT BANTERS / LATENT TALENT SHOW SERVER 🎭`);
  console.log(`====================================================`);
  console.log(`🖥️  Host URL:         ${configuredHostUrl}`);
  console.log(`📱 Audience Voting:   ${configuredHostUrl}/vote`);
  console.log(`⏱️  Voting Timer:     ${VOTING_TIME} seconds`);
  console.log(`====================================================`);
});
