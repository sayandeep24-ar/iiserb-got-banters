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
app.use(express.static(path.join(__dirname, 'public')));

// Detect best Local Area Network IPv4 address (Wi-Fi / Ethernet)
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

let configuredHostUrl = `http://${getLocalNetworkIp()}:${PORT}`;

// Configurable Phase Timers
const PERFORMANCE_TIME = 60; // 1 minute performance
let VOTING_TIME = 45;        // 45 seconds voting (increased from 20s as requested)

let appState = {
  status: 'IDLE', // 'IDLE' | 'PERFORMING' | 'VOTING' | 'REVEALED'
  currentCandidate: null,
  timer: 0,
  votes: [], // [ { voterId, score, timestamp } ]
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
      startVotingPhase();
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
    // Remove if candidate already exists in leaderboard, then add updated
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

    // Sort leaderboard by roundedScore descending, then rawAverage
    appState.leaderboard.sort((a, b) => b.roundedScore - a.roundedScore || b.rawAverage - a.rawAverage);
    
    // Save to disk
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
    votingDuration: VOTING_TIME
  };
}

// REST API Endpoints
app.get('/api/config', (req, res) => {
  const lanIp = getLocalNetworkIp();
  res.json({
    lanIp,
    port: PORT,
    hostUrl: configuredHostUrl,
    votingUrl: `${configuredHostUrl}/vote`,
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
    const text = req.query.text || `${configuredHostUrl}/vote`;
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

  // Host: Start Performance
  socket.on('stage:start_performance', ({ candidateName, actName }) => {
    startPerformancePhase(candidateName, actName);
  });

  // Host: Skip/End Performance early and open voting immediately
  socket.on('stage:skip_to_voting', () => {
    if (appState.status === 'PERFORMING') {
      startVotingPhase();
    }
  });

  // Host: Add extra performance time (+15s)
  socket.on('stage:add_time', (seconds = 15) => {
    if (appState.status === 'PERFORMING' || appState.status === 'VOTING') {
      appState.timer += seconds;
      io.emit('timer:tick', { status: appState.status, secondsLeft: appState.timer });
    }
  });

  // Host: Force Reveal Scores early if voting is done
  socket.on('stage:force_reveal', () => {
    if (appState.status === 'VOTING') {
      revealScoresPhase();
    }
  });

  // Host: Reset / Next Candidate
  socket.on('stage:reset_candidate', () => {
    resetToIdle();
  });

  // Host: Clear Leaderboard
  socket.on('stage:clear_leaderboard', () => {
    appState.leaderboard = [];
    saveLeaderboard(appState.leaderboard);
    io.emit('state:update', getClientState());
  });

  // Host: Delete single candidate from leaderboard
  socket.on('stage:delete_candidate', (id) => {
    appState.leaderboard = appState.leaderboard.filter(c => c.id !== id);
    saveLeaderboard(appState.leaderboard);
    io.emit('state:update', getClientState());
  });

  // Voter: Submit Rating
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
  const lanIp = getLocalNetworkIp();
  console.log(`====================================================`);
  console.log(`🎭 IISERB GOT BANTERS / LATENT TALENT SHOW SERVER 🎭`);
  console.log(`====================================================`);
  console.log(`🖥️  Stage Screen:     http://localhost:${PORT}`);
  console.log(`📱 Audience Voting:   http://${lanIp}:${PORT}/vote`);
  console.log(`🌐 Local Network IP:  ${lanIp}`);
  console.log(`⏱️  Voting Timer:     ${VOTING_TIME} seconds`);
  console.log(`💾 Leaderboard File:  ${LEADERBOARD_FILE}`);
  console.log(`====================================================`);
});
