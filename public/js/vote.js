// =========================================================
// IISERB GOT BANTERS - AUDIENCE MOBILE VOTER CONTROLLER
// =========================================================

const socket = io();

// Anonymous Voter ID
let voterId = localStorage.getItem('banters_voter_id');
if (!voterId) {
  voterId = 'voter_' + Math.random().toString(36).substring(2, 11) + Date.now();
  localStorage.setItem('banters_voter_id', voterId);
}

// UI Elements
const cardVoting = document.getElementById('card-voting');
const cardSubmitted = document.getElementById('card-submitted');
const cardClosed = document.getElementById('card-closed');

const voterCandidateName = document.getElementById('voterCandidateName');
const voterCandidateAct = document.getElementById('voterCandidateAct');
const voterTimerSecs = document.getElementById('voterTimerSecs');
const ratingDescriptor = document.getElementById('ratingDescriptor');
const submitVoteBtn = document.getElementById('submitVoteBtn');
const submittedScoreNotice = document.getElementById('submittedScoreNotice');
const changeVoteBtn = document.getElementById('changeVoteBtn');

const closedStatusHeading = document.getElementById('closedStatusHeading');
const closedStatusText = document.getElementById('closedStatusText');

const ratingBtns = document.querySelectorAll('.rating-btn');

// Mobile Leaderboard Elements
const mobileLeaderboardBtn = document.getElementById('mobileLeaderboardBtn');
const mobileLeaderboardModal = document.getElementById('mobileLeaderboardModal');
const closeMobileLeaderboardBtn = document.getElementById('closeMobileLeaderboardBtn');
const mobileLeaderboardList = document.getElementById('mobileLeaderboardList');
const viewLeaderboardFromClosedBtn = document.getElementById('viewLeaderboardFromClosedBtn');
const viewLeaderboardFromSubmittedBtn = document.getElementById('viewLeaderboardFromSubmittedBtn');

// Descriptors for grades 1 to 10
const DESCRIPTORS = {
  1: "💀 1 - Get Off Stage!",
  2: "😬 2 - Awkward / Cringe",
  3: "😐 3 - Needs Work",
  4: "🙂 4 - Fair Attempt",
  5: "👍 5 - Mid / Average",
  6: "👏 6 - Decent Banter",
  7: "🔥 7 - Solid Talent!",
  8: "🌟 8 - Superb Act!",
  9: "🚀 9 - Outstanding!",
  10: "👑 10 - GOD LEVEL BANTER!"
};

let selectedScore = null;
let currentCandidateId = null;
let hasVotedForCurrent = false;

// Rating Button Click Handlers
ratingBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const score = parseInt(btn.getAttribute('data-score'), 10);
    selectScore(score);
  });
});

function selectScore(score) {
  selectedScore = score;
  ratingBtns.forEach(b => {
    if (parseInt(b.getAttribute('data-score'), 10) === score) {
      b.classList.add('selected');
    } else {
      b.classList.remove('selected');
    }
  });

  ratingDescriptor.textContent = DESCRIPTORS[score] || `Grade: ${score}/10`;
  submitVoteBtn.disabled = false;
}

// Submit Vote
submitVoteBtn.addEventListener('click', () => {
  if (!selectedScore || !currentCandidateId) return;

  submitVoteBtn.disabled = true;
  submitVoteBtn.textContent = 'Submitting...';

  socket.emit('vote:submit', {
    voterId: voterId,
    score: selectedScore
  });
});

// Socket Response for Vote
socket.on('vote:response', (res) => {
  submitVoteBtn.textContent = '✨ Submit Grade';
  submitVoteBtn.disabled = false;

  if (res.success) {
    hasVotedForCurrent = true;
    submittedScoreNotice.textContent = `You rated ${res.score} / 10 for ${res.candidateName || 'Performer'}`;
    showView('SUBMITTED');
  } else {
    alert(res.message || 'Could not submit vote');
  }
});

// Change Vote
changeVoteBtn.addEventListener('click', () => {
  showView('VOTING');
});

// View Switcher
function showView(view) {
  cardVoting.style.display = 'none';
  cardSubmitted.style.display = 'none';
  cardClosed.style.display = 'none';

  if (view === 'VOTING') {
    cardVoting.style.display = 'block';
  } else if (view === 'SUBMITTED') {
    cardSubmitted.style.display = 'block';
  } else {
    cardClosed.style.display = 'block';
  }
}

// State Synchronization
socket.on('state:update', (state) => {
  handleStateUpdate(state);
  renderMobileLeaderboard(state.leaderboard);
});

socket.on('voting:started', (data) => {
  currentCandidateId = data.candidate?.id;
  hasVotedForCurrent = false;
  selectedScore = null;
  ratingBtns.forEach(b => b.classList.remove('selected'));
  ratingDescriptor.textContent = 'Tap a grade above';
  submitVoteBtn.disabled = true;

  voterCandidateName.textContent = data.candidate?.name || 'Performer';
  voterCandidateAct.textContent = data.candidate?.act || 'Talent Act';
  voterTimerSecs.textContent = data.votingDuration || 45;

  showView('VOTING');
});

socket.on('timer:tick', ({ status, secondsLeft }) => {
  if (status === 'VOTING') {
    voterTimerSecs.textContent = secondsLeft;
  }
});

function handleStateUpdate(state) {
  if (state.currentCandidate && state.currentCandidate.id !== currentCandidateId) {
    currentCandidateId = state.currentCandidate.id;
    hasVotedForCurrent = false;
    selectedScore = null;
    ratingBtns.forEach(b => b.classList.remove('selected'));
    ratingDescriptor.textContent = 'Tap a grade above';
    submitVoteBtn.disabled = true;
  }

  if (state.status === 'VOTING') {
    voterCandidateName.textContent = state.currentCandidate?.name || 'Performer';
    voterCandidateAct.textContent = state.currentCandidate?.act || 'Talent Act';
    voterTimerSecs.textContent = state.timer;

    if (hasVotedForCurrent) {
      showView('SUBMITTED');
    } else {
      showView('VOTING');
    }
  } else if (state.status === 'PERFORMING') {
    closedStatusHeading.textContent = 'Act in Progress';
    closedStatusText.textContent = `${state.currentCandidate?.name || 'Candidate'} is on stage! Performance timer running. 45-second voting starts shortly!`;
    showView('CLOSED');
  } else if (state.status === 'REVEALED') {
    closedStatusHeading.textContent = 'Voting Locked';
    closedStatusText.textContent = 'Audience votes locked! The rounded score is on the stage screen!';
    showView('CLOSED');
  } else {
    closedStatusHeading.textContent = 'Next Act Coming Up';
    closedStatusText.textContent = 'Waiting for the next contestant to take the stage. Stay tuned!';
    showView('CLOSED');
  }
}

// Mobile Leaderboard Render
function renderMobileLeaderboard(board = []) {
  if (!board || board.length === 0) {
    mobileLeaderboardList.innerHTML = `
      <div style="color: var(--text-muted); padding: 2rem 0; text-align: center;">
        No candidates evaluated yet!
      </div>
    `;
    return;
  }

  mobileLeaderboardList.innerHTML = board.map((item, idx) => `
    <div class="leaderboard-row ${idx === 0 ? 'rank-1' : ''}" style="padding: 0.75rem 1rem;">
      <div class="row-rank" style="font-size: 1.1rem; width: 30px;">
        ${idx === 0 ? '👑' : `#${idx + 1}`}
      </div>
      <div class="row-info">
        <div class="row-name" style="font-size: 1rem;">${escapeHtml(item.name)}</div>
        <div class="row-meta">${escapeHtml(item.act || 'Act')} &bull; ${item.voteCount} votes</div>
      </div>
      <div>
        <div class="row-score" style="font-size: 1.25rem;">${item.formattedScore}</div>
        <div class="row-score-label">/ 10</div>
      </div>
    </div>
  `).join('');
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

// Mobile Leaderboard Open/Close
function openLeaderboard() {
  mobileLeaderboardModal.classList.add('open');
}

function closeLeaderboard() {
  mobileLeaderboardModal.classList.remove('open');
}

if (mobileLeaderboardBtn) mobileLeaderboardBtn.addEventListener('click', openLeaderboard);
if (closeMobileLeaderboardBtn) closeMobileLeaderboardBtn.addEventListener('click', closeLeaderboard);
if (viewLeaderboardFromClosedBtn) viewLeaderboardFromClosedBtn.addEventListener('click', openLeaderboard);
if (viewLeaderboardFromSubmittedBtn) viewLeaderboardFromSubmittedBtn.addEventListener('click', openLeaderboard);

window.addEventListener('click', (e) => {
  if (e.target === mobileLeaderboardModal) closeLeaderboard();
});
