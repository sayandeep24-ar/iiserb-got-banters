// =========================================================
// IISERB GOT BANTERS - STAGE CONTROLLER
// =========================================================

const socket = io();

// UI Elements
const viewIdle = document.getElementById('view-idle');
const viewPerforming = document.getElementById('view-performing');
const viewReadyVote = document.getElementById('view-ready-vote');
const viewVoting = document.getElementById('view-voting');
const viewRevealed = document.getElementById('view-revealed');

// Inputs & Buttons
const candidateNameInput = document.getElementById('candidateNameInput');
const candidateActInput = document.getElementById('candidateActInput');
const add15sBtn = document.getElementById('add15sBtn');
const endPerformanceBtn = document.getElementById('endPerformanceBtn');
const startVotingDirectBtn = document.getElementById('startVotingDirectBtn');
const startVotingFromReadyBtn = document.getElementById('startVotingFromReadyBtn');
const readyPerformerName = document.getElementById('readyPerformerName');
const readyPerformerAct = document.getElementById('readyPerformerAct');
const add10sVotingBtn = document.getElementById('add10sVotingBtn');
const forceRevealBtn = document.getElementById('forceRevealBtn');
const nextCandidateBtn = document.getElementById('nextCandidateBtn');
const soundToggleBtn = document.getElementById('soundToggleBtn');
const openLeaderboardBtn = document.getElementById('openLeaderboardBtn');
const closeLeaderboardBtn = document.getElementById('closeLeaderboardBtn');
const leaderboardModal = document.getElementById('leaderboardModal');
const podiumContainer = document.getElementById('podiumContainer');
const leaderboardList = document.getElementById('leaderboardList');
const clearLeaderboardBtn = document.getElementById('clearLeaderboardBtn');
const headerLeaderboardCount = document.getElementById('headerLeaderboardCount');

// Network Modal
const networkPill = document.getElementById('networkPill');
const lanIpText = document.getElementById('lanIpText');
const networkModal = document.getElementById('networkModal');
const closeNetworkModalBtn = document.getElementById('closeNetworkModalBtn');
const cancelNetworkBtn = document.getElementById('cancelNetworkBtn');
const saveNetworkBtn = document.getElementById('saveNetworkBtn');
const hostUrlOverrideInput = document.getElementById('hostUrlOverrideInput');

// Performance View Elements
const stagePerformerName = document.getElementById('stagePerformerName');
const stagePerformerAct = document.getElementById('stagePerformerAct');
const performanceDigits = document.getElementById('performanceDigits');
const performanceProgressCircle = document.getElementById('performanceProgressCircle');
const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * 130; // 816.81

// Voting View Elements
const votingPerformerName = document.getElementById('votingPerformerName');
const stageQrImage = document.getElementById('stageQrImage');
const votingDigits = document.getElementById('votingDigits');
const votingDirectLink = document.getElementById('votingDirectLink');
const liveVotesCount = document.getElementById('liveVotesCount');

// Revealed View Elements
const revealPerformerName = document.getElementById('revealPerformerName');
const revealPerformerAct = document.getElementById('revealPerformerAct');
const revealScoreDigits = document.getElementById('revealScoreDigits');
const revealStarsBar = document.getElementById('revealStarsBar');
const revealVotesCount = document.getElementById('revealVotesCount');
const revealRawAvg = document.getElementById('revealRawAvg');
const revealRoundedVal = document.getElementById('revealRoundedVal');
const viewLeaderboardFromRevealBtn = document.getElementById('viewLeaderboardFromRevealBtn');

// State
let soundEnabled = true;
let currentHostUrl = window.location.origin;
let lastKnownStatus = 'IDLE';

// Web Audio API Synthesizer
let audioCtx = null;
function initAudio() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      audioCtx = new AudioContext();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function playTone(freq, type = 'sine', duration = 0.2, gainVal = 0.15) {
  if (!soundEnabled || !audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(gainVal, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {
    console.warn("Audio play error", e);
  }
}

function playClockTick() {
  playTone(880, 'triangle', 0.06, 0.08);
}

function playWarningBeep() {
  playTone(550, 'sawtooth', 0.15, 0.2);
}

function playBuzzer() {
  if (!soundEnabled || !audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, audioCtx.currentTime);
    osc.frequency.linearRampToValueAtTime(80, audioCtx.currentTime + 0.6);
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.6);
  } catch (e) {}
}

function playFanfare() {
  if (!soundEnabled || !audioCtx) return;
  const notes = [
    { freq: 440, delay: 0, dur: 0.18 },
    { freq: 554.37, delay: 0.15, dur: 0.18 },
    { freq: 659.25, delay: 0.30, dur: 0.22 },
    { freq: 880, delay: 0.48, dur: 0.7 }
  ];
  notes.forEach(n => {
    setTimeout(() => {
      playTone(n.freq, 'sine', n.dur, 0.3);
    }, n.delay * 1000);
  });
}

// Canvas Confetti Celebration
const canvas = document.getElementById('confettiCanvas');
const ctx = canvas.getContext('2d');
let confettiParticles = [];
let confettiAnimationId = null;

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function triggerConfetti() {
  confettiParticles = [];
  const colors = ['#E5B842', '#D4AF37', '#FFF3CC', '#E51B24', '#FFFFFF', '#FFD700'];
  for (let i = 0; i < 180; i++) {
    confettiParticles.push({
      x: canvas.width * 0.5 + (Math.random() - 0.5) * 300,
      y: canvas.height * 0.45 + (Math.random() - 0.5) * 100,
      vx: (Math.random() - 0.5) * 18,
      vy: (Math.random() - 1.5) * 14,
      size: Math.random() * 9 + 5,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      rotSpeed: (Math.random() - 0.5) * 10,
      opacity: 1
    });
  }
  if (!confettiAnimationId) {
    animateConfetti();
  }
}

function animateConfetti() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  let active = false;

  for (let p of confettiParticles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.35;
    p.rotation += p.rotSpeed;
    p.opacity -= 0.005;

    if (p.opacity > 0 && p.y < canvas.height + 20) {
      active = true;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, p.opacity);
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
  }

  if (active) {
    confettiAnimationId = requestAnimationFrame(animateConfetti);
  } else {
    confettiAnimationId = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

// Render Stars
function renderStars(score) {
  let starsHtml = '';
  const fullStars = Math.floor(score);
  const hasHalf = (score % 1 !== 0);

  for (let i = 1; i <= 10; i++) {
    if (i <= fullStars) {
      starsHtml += '★';
    } else if (i === fullStars + 1 && hasHalf) {
      starsHtml += '<span style="opacity:0.65;">★</span>';
    } else {
      starsHtml += '<span style="opacity:0.2;">★</span>';
    }
  }
  return starsHtml;
}

// View Transitions
function switchView(targetView) {
  [viewIdle, viewPerforming, viewReadyVote, viewVoting, viewRevealed].forEach(v => {
    if (v) v.style.display = 'none';
  });
  if (targetView) targetView.style.display = 'block';
}

// Generate & Update QR Code
async function updateQrCode(url) {
  // If running on Render or any public domain, automatically use browser's public origin
  const isPublicDomain = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
  const effectiveUrl = isPublicDomain ? `${window.location.origin}/vote` : url;

  try {
    const res = await fetch(`/api/qr?text=${encodeURIComponent(effectiveUrl)}`);
    const data = await res.json();
    if (data.qrCodeDataUrl) {
      stageQrImage.src = data.qrCodeDataUrl;
    }
    votingDirectLink.textContent = effectiveUrl;
  } catch (err) {
    console.error("QR Code generation error:", err);
  }
}

// Automatically sync public host URL with server if running on Render / Cloud
if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
  fetch('/api/config/host-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: window.location.origin })
  }).catch(() => {});
}

// State Update Handler
socket.on('state:update', (state) => {
  lastKnownStatus = state.status;
  const isPublicDomain = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
  currentHostUrl = isPublicDomain ? window.location.origin : state.hostUrl;
  lanIpText.textContent = isPublicDomain ? `${window.location.origin}/vote` : state.votingUrl;
  hostUrlOverrideInput.value = currentHostUrl;

  if (state.status === 'IDLE') {
    switchView(viewIdle);
    candidateNameInput.value = '';
    candidateActInput.value = '';
    candidateNameInput.focus();
  } else if (state.status === 'PERFORMING') {
    switchView(viewPerforming);
    stagePerformerName.textContent = state.currentCandidate?.name || 'Performer';
    stagePerformerAct.textContent = state.currentCandidate?.act || 'Talent Act';
    updatePerformanceTimer(state.timer, state.performanceDuration || 90);
  } else if (state.status === 'READY_TO_VOTE') {
    switchView(viewReadyVote);
    readyPerformerName.textContent = state.currentCandidate?.name || 'Performer';
    readyPerformerAct.textContent = state.currentCandidate?.act || 'Talent Act';
  } else if (state.status === 'VOTING') {
    switchView(viewVoting);
    votingPerformerName.textContent = state.currentCandidate?.name || 'Performer';
    votingDigits.textContent = state.timer;
    liveVotesCount.textContent = state.voteCount || 0;
    updateQrCode(state.votingUrl);
  } else if (state.status === 'REVEALED') {
    switchView(viewRevealed);
    if (state.lastResult) {
      displayRevealedScore(state.lastResult);
    }
  }

  renderLeaderboard(state.leaderboard);
});

// Performance finished broadcast (buzzer & transition to host banter)
socket.on('performance:finished', (data) => {
  playBuzzer();
  switchView(viewReadyVote);
  if (data?.candidate) {
    readyPerformerName.textContent = data.candidate.name;
    readyPerformerAct.textContent = data.candidate.act;
  }
});

// Timer Tick
socket.on('timer:tick', ({ status, secondsLeft }) => {
  if (status === 'PERFORMING') {
    updatePerformanceTimer(secondsLeft, 90);
    if (secondsLeft <= 10 && secondsLeft > 0) {
      playWarningBeep();
    } else if (secondsLeft === 0) {
      playBuzzer();
    } else {
      playClockTick();
    }
  } else if (status === 'VOTING') {
    votingDigits.textContent = secondsLeft;
    if (secondsLeft <= 5 && secondsLeft > 0) {
      playWarningBeep();
    } else if (secondsLeft === 0) {
      playBuzzer();
    }
  }
});

function updatePerformanceTimer(secondsLeft, total = 90) {
  performanceDigits.textContent = secondsLeft;
  
  if (secondsLeft <= 10) {
    performanceDigits.classList.add('urgent');
  } else {
    performanceDigits.classList.remove('urgent');
  }

  const fraction = Math.max(0, secondsLeft / total);
  const offset = CIRCLE_CIRCUMFERENCE * (1 - fraction);
  performanceProgressCircle.style.strokeDasharray = CIRCLE_CIRCUMFERENCE;
  performanceProgressCircle.style.strokeDashoffset = offset;
}

// Live Vote Count update
socket.on('vote:count_updated', ({ voteCount }) => {
  liveVotesCount.textContent = voteCount;
  liveVotesCount.style.transform = 'scale(1.3)';
  setTimeout(() => {
    liveVotesCount.style.transform = 'scale(1)';
  }, 200);
});

// Score Revealed Broadcast
socket.on('score:revealed', (result) => {
  switchView(viewRevealed);
  displayRevealedScore(result);
  triggerConfetti();
  playFanfare();
});

function displayRevealedScore(result) {
  revealPerformerName.textContent = result.candidate?.name || 'Performer';
  revealPerformerAct.textContent = result.candidate?.act || 'Talent Act';
  revealScoreDigits.textContent = result.formattedScore;
  revealStarsBar.innerHTML = renderStars(result.roundedScore);
  revealVotesCount.textContent = result.voteCount;
  revealRawAvg.textContent = result.rawAverage.toFixed(2);
  revealRoundedVal.textContent = result.formattedScore;
}

// Leaderboard Display with Podium & Details
function renderLeaderboard(board = []) {
  headerLeaderboardCount.textContent = board.length;

  if (!board || board.length === 0) {
    podiumContainer.innerHTML = '';
    leaderboardList.innerHTML = `
      <div style="color: var(--text-muted); padding: 2rem 0; text-align: center;">
        No candidates evaluated yet!
      </div>
    `;
    return;
  }

  // Render Top 3 Podium if at least 1 candidate exists
  const top1 = board[0];
  const top2 = board[1];
  const top3 = board[2];

  let podiumHtml = `
    <!-- 2nd Place -->
    <div style="background: rgba(30, 26, 22, 0.85); border: 1px solid #a8a8a8; border-radius: 12px; padding: 0.85rem 0.5rem; text-align: center; ${top2 ? '' : 'opacity: 0.3;'}">
      <div style="font-size: 1.4rem;">🥈</div>
      <div style="font-size: 0.75rem; color: #a8a8a8; text-transform: uppercase; font-weight: 700;">2nd Place</div>
      <div style="font-weight: 800; font-size: 1.05rem; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${top2 ? escapeHtml(top2.name) : '---'}</div>
      <div style="font-family: var(--font-display); font-size: 1.5rem; font-weight: 900; color: #ffffff;">${top2 ? top2.formattedScore : '-'}</div>
      <div style="font-size: 0.7rem; color: var(--text-muted);">${top2 ? top2.voteCount + ' votes' : ''}</div>
    </div>

    <!-- 1st Place (Taller) -->
    <div style="background: radial-gradient(circle, rgba(60, 48, 25, 0.95), rgba(25, 20, 14, 0.95)); border: 2px solid var(--gold-primary); box-shadow: 0 0 20px var(--gold-glow); border-radius: 14px; padding: 1.25rem 0.6rem; text-align: center; transform: translateY(-8px);">
      <div style="font-size: 1.8rem;">👑 🥇</div>
      <div style="font-size: 0.75rem; color: var(--gold-primary); text-transform: uppercase; font-weight: 800; letter-spacing: 1px;">1st Place</div>
      <div style="font-weight: 900; font-size: 1.2rem; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(top1.name)}</div>
      <div style="font-family: var(--font-display); font-size: 2rem; font-weight: 900; color: var(--gold-primary);">${top1.formattedScore}</div>
      <div style="font-size: 0.75rem; color: var(--gold-light);">${top1.voteCount} audience votes</div>
    </div>

    <!-- 3rd Place -->
    <div style="background: rgba(30, 26, 22, 0.85); border: 1px solid #cd7f32; border-radius: 12px; padding: 0.85rem 0.5rem; text-align: center; ${top3 ? '' : 'opacity: 0.3;'}">
      <div style="font-size: 1.4rem;">🥉</div>
      <div style="font-size: 0.75rem; color: #cd7f32; text-transform: uppercase; font-weight: 700;">3rd Place</div>
      <div style="font-weight: 800; font-size: 1.05rem; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${top3 ? escapeHtml(top3.name) : '---'}</div>
      <div style="font-family: var(--font-display); font-size: 1.5rem; font-weight: 900; color: #ffffff;">${top3 ? top3.formattedScore : '-'}</div>
      <div style="font-size: 0.7rem; color: var(--text-muted);">${top3 ? top3.voteCount + ' votes' : ''}</div>
    </div>
  `;
  podiumContainer.innerHTML = podiumHtml;

  // Render Full Table
  leaderboardList.innerHTML = board.map((item, idx) => `
    <div class="leaderboard-row ${idx === 0 ? 'rank-1' : ''}">
      <div class="row-rank">#${idx + 1}</div>
      <div class="row-info">
        <div class="row-name">${escapeHtml(item.name)}</div>
        <div class="row-meta">
          ${escapeHtml(item.act || 'Talent Act')} &bull; 
          <span style="color:var(--gold-light);">${item.voteCount} Votes</span> &bull; 
          Avg: ${item.rawAverage} &bull; 
          ${item.timestamp || ''}
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 1rem;">
        <div>
          <div class="row-score">${item.formattedScore}</div>
          <div class="row-score-label">Marks / 10</div>
        </div>
        <button class="delete-cand-btn" data-id="${item.id}" title="Remove this candidate" style="background:none; border:none; color:#776a5a; font-size:1.1rem; cursor:pointer; padding:0.2rem 0.5rem; transition:color 0.2s;">
          ✕
        </button>
      </div>
    </div>
  `).join('');

  // Attach delete buttons
  document.querySelectorAll('.delete-cand-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const candId = btn.getAttribute('data-id');
      if (confirm("Delete this candidate from leaderboard?")) {
        socket.emit('stage:delete_candidate', candId);
      }
    });
    btn.addEventListener('mouseover', () => btn.style.color = '#ff6b6b');
    btn.addEventListener('mouseout', () => btn.style.color = '#776a5a');
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}

// Action Handlers
function handleStartPerformance() {
  initAudio();
  const name = candidateNameInput.value.trim();
  const act = candidateActInput.value.trim();
  if (!name) return;

  socket.emit('stage:start_performance', {
    candidateName: name,
    actName: act
  });
}

add15sBtn.addEventListener('click', () => {
  initAudio();
  socket.emit('stage:add_time', 15);
});

if (add10sVotingBtn) {
  add10sVotingBtn.addEventListener('click', () => {
    initAudio();
    socket.emit('stage:add_time', 10);
  });
}

endPerformanceBtn.addEventListener('click', () => {
  initAudio();
  socket.emit('stage:end_performance');
});

if (startVotingDirectBtn) {
  startVotingDirectBtn.addEventListener('click', () => {
    initAudio();
    socket.emit('stage:start_voting');
  });
}

if (startVotingFromReadyBtn) {
  startVotingFromReadyBtn.addEventListener('click', () => {
    initAudio();
    socket.emit('stage:start_voting');
  });
}

forceRevealBtn.addEventListener('click', () => {
  initAudio();
  socket.emit('stage:force_reveal');
});

nextCandidateBtn.addEventListener('click', () => {
  initAudio();
  socket.emit('stage:reset_candidate');
});

// Audio & Modal Controls
soundToggleBtn.addEventListener('click', () => {
  initAudio();
  soundEnabled = !soundEnabled;
  soundToggleBtn.textContent = soundEnabled ? '🔊' : '🔇';
  soundToggleBtn.style.color = soundEnabled ? 'var(--gold-primary)' : 'var(--text-muted)';
});

openLeaderboardBtn.addEventListener('click', () => {
  leaderboardModal.classList.add('open');
});

closeLeaderboardBtn.addEventListener('click', () => {
  leaderboardModal.classList.remove('open');
});

viewLeaderboardFromRevealBtn.addEventListener('click', () => {
  leaderboardModal.classList.add('open');
});

clearLeaderboardBtn.addEventListener('click', () => {
  if (confirm("Are you sure you want to completely clear the persistent leaderboard?")) {
    socket.emit('stage:clear_leaderboard');
  }
});

// Network Modal Controls
networkPill.addEventListener('click', () => {
  networkModal.classList.add('open');
});

closeNetworkModalBtn.addEventListener('click', () => {
  networkModal.classList.remove('open');
});

cancelNetworkBtn.addEventListener('click', () => {
  networkModal.classList.remove('open');
});

saveNetworkBtn.addEventListener('click', async () => {
  const newUrl = hostUrlOverrideInput.value.trim();
  if (!newUrl) return;

  try {
    const res = await fetch('/api/config/host-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: newUrl })
    });
    const data = await res.json();
    if (data.success) {
      networkModal.classList.remove('open');
    }
  } catch (e) {
    alert("Failed to update host URL: " + e.message);
  }
});

// Close modal on outside click
window.addEventListener('click', (e) => {
  if (e.target === leaderboardModal) leaderboardModal.classList.remove('open');
  if (e.target === networkModal) networkModal.classList.remove('open');
});

// Initialize audio on first click anywhere
window.addEventListener('click', () => initAudio(), { once: true });
