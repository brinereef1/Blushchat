/* ═══════════════════════════════════════════════════════════════════════════
   BlushChat — Frontend Application Logic
   ═══════════════════════════════════════════════════════════════════════════ */

// ─── State ───────────────────────────────────────────────────────────────
const state = {
  socket: null,
  username: '',
  currentRoom: null,
  strangerInfo: null,
  isChatting: false,

  // WebRTC
  localStream: null,
  remoteStream: null,
  peerConnection: null,
  isCallActive: false,
  isVideoCall: false,
  isCaller: false,
  callId: null, // unique id per call attempt — used to resolve double-call glare
  isMuted: false,
  isCameraOff: false,
  callTimerInterval: null,
  iceDisconnectTimer: null,
  connectionDisconnectTimer: null,

  // File sharing
  pendingFile: null,

  // Profile saved for reconnection
  userProfile: null,

  // Guard to prevent auto-find after manual cancel
  isSearchCancelled: false,

  // Waiting timer
  waitingTimerInterval: null,

  // Incoming call handling
  incomingCall: {
    offer: null,
    type: null,
    callId: null,
    room: null,
    iceCandidates: []
  }
};

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    // TURN servers require proper formatting: turn:host:port
    // For now, we'll use STUN-only to avoid configuration issues
    // In production, replace with valid TURN server credentials
    // { urls: 'turn:your-turn-server.com:3478', username: 'username', credential: 'credential' }
  ],
};

// ─── File Sharing Limits ────────────────────────────────────────────────
const FILE_LIMITS = {
  image: 5 * 1024 * 1024,   // 5 MB
  video: 20 * 1024 * 1024,  // 20 MB
  audio: 10 * 1024 * 1024,  // 10 MB
};

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp',
                       'video/mp4', 'video/webm', 'video/quicktime',
                       'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4',
                       'audio/webm'];

// ─── Emoji icons per category ───────────────────────────────────────────
const FILE_ICONS = {
  image: '📷',
  video: '🎬',
  audio: '🎵',
};

// ─── DOM References ──────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const DOM = {
  // Existing elements
  // ... (will keep existing entries)
  // Screens
  landingScreen: $('#landing-screen'),
  connectingScreen: $('#connecting-screen'),
  chatScreen: $('#chat-screen'),

  // Landing
  registrationForm: $('#registration-form'),
  usernameInput: $('#username-input'),
  ageSelect: $('#age-select'),
  genderSelect: $('#gender-select'),
  findBtn: $('#find-btn'),

  // Connecting
  cancelBtn: $('#cancel-btn'),

  // Chat
  chatHeader: $('#chat-header'),
  strangerName: $('#stranger-name'),
  strangerMeta: $('#stranger-meta'),
  messagesContainer: $('#messages-container'),
  messageInput: $('#message-input'),
  sendBtn: $('#send-btn'),
  typingIndicator: $('#typing-indicator'),
  voiceCallBtn: $('#voice-call-btn'),
  videoCallBtn: $('#video-call-btn'),
  skipBtn: $('#skip-btn'),
  leaveBtn: $('#leave-btn'),

  // Voice call bar
  voiceCallBar: $('#voice-call-bar'),
  voiceCallTimer: $('#voice-call-timer'),
  voiceMuteBtn: $('#voice-mute-btn'),
  voiceEndBtn: $('#voice-end-btn'),

  // Video overlay
  videoOverlay: $('#video-call-overlay'),
  remoteVideo: $('#remote-video'),
  remoteVideoFallback: $('#remote-video-fallback'),
  localVideo: $('#local-video'),
  remoteAudio: $('#remote-audio'),
  videoCallTimer: $('#video-call-timer'),
  vidMuteBtn: $('#vid-mute-btn'),
  vidCameraBtn: $('#vid-camera-btn'),
  vidEndBtn: $('#vid-end-btn'),

  // File sharing
  filePickerBtn: $('#file-picker-btn'),
  fileInput: $('#file-input'),
  filePreviewArea: $('#file-preview-area'),
  filePreviewIcon: $('#file-preview-icon'),
  filePreviewName: $('#file-preview-name'),
  filePreviewSize: $('#file-preview-size'),
  sendFileBtn: $('#send-file-btn'),
  fileCancelBtn: $('#file-cancel-btn'),
  fileProgress: $('#file-preview-progress'),
  progressFill: $('#progress-fill'),
  progressText: $('#progress-text'),

  // Toast
  toastContainer: $('#toast-container'),

  // Incoming call overlay (will be created dynamically)
  incomingCallOverlay: null,
  incomingCallFrom: null,
  incomingCallType: null,
  incomingCallAcceptBtn: null,
  incomingCallDeclineBtn: null,
};

// ═══════════════════════════════════════════════════════════════════════════
// FILTER SIDEBAR
// ═══════════════════════════════════════════════════════════════════════════

function setupFilterSidebar() {
  const filterBtn = document.getElementById('filter-btn');
  const sidebar = document.getElementById('filter-sidebar');
  const applyBtn = document.getElementById('apply-filter-btn');
  const closeBtn = document.getElementById('close-filter-btn');
  const genderSelect = document.getElementById('sidebar-filter-gender-select');
  const minAgeInput = document.getElementById('sidebar-filter-min-age');
  const maxAgeInput = document.getElementById('sidebar-filter-max-age');

  if (!sidebar) return;

  // Open sidebar and pre-fill current values
  if (filterBtn) {
    filterBtn.addEventListener('click', () => {
      // Pre-fill with current filter values from user profile
      if (state.userProfile) {
        if (genderSelect && state.userProfile.filterGender) genderSelect.value = state.userProfile.filterGender;
        if (minAgeInput && state.userProfile.filterMinAge) minAgeInput.value = state.userProfile.filterMinAge;
        if (maxAgeInput && state.userProfile.filterMaxAge) maxAgeInput.value = state.userProfile.filterMaxAge;
      }
      sidebar.classList.add('visible');
    });
  }

  // Close sidebar
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      sidebar.classList.remove('visible');
    });
  }

  // Click outside to close
  sidebar.addEventListener('click', (e) => {
    if (e.target === sidebar) sidebar.classList.remove('visible');
  });

  // Escape key closes sidebar
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('visible')) {
      sidebar.classList.remove('visible');
    }
  });

  // Apply filters
  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      const filterGender = genderSelect ? genderSelect.value : 'any';
      let filterMinAge = minAgeInput ? parseInt(minAgeInput.value) || 18 : 18;
      let filterMaxAge = maxAgeInput ? parseInt(maxAgeInput.value) || 100 : 100;

      // Clamp age range
      filterMinAge = Math.max(18, Math.min(100, filterMinAge));
      filterMaxAge = Math.max(18, Math.min(100, filterMaxAge));
      if (filterMinAge > filterMaxAge) {
        showToast('Min age cannot be greater than max age.');
        return;
      }

      // Send to server
      if (state.socket && state.socket.connected) {
        state.socket.emit('filter-update', { filterGender, filterMinAge, filterMaxAge });
        showToast('Filters updated!');
      }

      // Store locally for re-registration
      if (state.userProfile) {
        state.userProfile.filterGender = filterGender;
        state.userProfile.filterMinAge = filterMinAge;
        state.userProfile.filterMaxAge = filterMaxAge;
      }

      sidebar.classList.remove('visible');
    });
  }

  // Show filter tip after 20s if user has restrictive filters
  setTimeout(() => {
    const filterTip = document.getElementById('filter-tip');
    if (!filterTip) return;
    const gender = genderSelect ? genderSelect.value : 'any';
    const minAge = minAgeInput ? parseInt(minAgeInput.value) || 18 : 18;
    const maxAge = maxAgeInput ? parseInt(maxAgeInput.value) || 100 : 100;
    if (gender !== 'any' || minAge > 18 || maxAge < 100) {
      filterTip.classList.remove('hidden');
    }
  }, 20000);
}

// ═══════════════════════════════════════════════════════════════════════════
// RANGE SLIDER SETUP
// ═══════════════════════════════════════════════════════════════════════════

function setupRangeSliders() {
  // Landing page filter sliders
  setupSliderPair('filter-min-age', 'filter-max-age', 'filter-min-age-display', 'filter-max-age-display');
  // Sidebar filter sliders
  setupSliderPair('sidebar-filter-min-age', 'sidebar-filter-max-age', 'sidebar-filter-min-age-display', 'sidebar-filter-max-age-display');
}

function setupSliderPair(minId, maxId, minDisplayId, maxDisplayId) {
  const minInput = document.getElementById(minId);
  const maxInput = document.getElementById(maxId);
  const minDisplay = document.getElementById(minDisplayId);
  const maxDisplay = document.getElementById(maxDisplayId);
  if (!minInput || !maxInput) return;

  function updateDisplays() {
    let minVal = parseInt(minInput.value);
    let maxVal = parseInt(maxInput.value);

    // Clamp
    if (minVal > maxVal) {
      // Determine which one changed
      if (minInput === document.activeElement) {
        minVal = maxVal;
        minInput.value = minVal;
      } else {
        maxVal = minVal;
        maxInput.value = maxVal;
      }
    }

    if (minDisplay) minDisplay.textContent = minVal;
    if (maxDisplay) maxDisplay.textContent = maxVal;
  }

  minInput.addEventListener('input', updateDisplays);
  maxInput.addEventListener('input', updateDisplays);
  // Initial sync
  updateDisplays();
}

// ═══════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════

function init() {
  // Set up filter sidebar for matching page
  setupFilterSidebar();
  populateAgeOptions();
  setupEventListeners();
  createFloatingHearts();
  setupRangeSliders();
}

function populateAgeOptions() {
  const select = DOM.ageSelect;
  for (let i = 18; i <= 99; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = i;
    select.appendChild(opt);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FLOATING HEARTS
// ═══════════════════════════════════════════════════════════════════════════

function createFloatingHearts() {
  const container = document.getElementById('hearts-bg');
  const emojis = ['💕', '💗', '❤️', '💖', '💝'];
  const count = 18;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.textContent = emojis[i % emojis.length];
    el.style.left = `${Math.random() * 100}%`;
    el.style.fontSize = `${14 + Math.random() * 18}px`;
    el.style.animationDuration = `${12 + Math.random() * 16}s`;
    el.style.animationDelay = `${Math.random() * 10}s`;
    el.style.opacity = 0.12 + Math.random() * 0.1;
    container.appendChild(el);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SCREEN MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  const target = document.getElementById(screenId);
  if (target) target.classList.add('active');
}

// ─── Waiting Timer ──────────────────────────────────────────────────────────

function startWaitingTimer() {
  stopWaitingTimer();
  const startTime = Date.now();
  state.waitingTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const el = document.getElementById('waiting-timer');
    if (!el) return;
    if (elapsed < 60) {
      el.textContent = `Waiting for ${elapsed}s…`;
    } else {
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      el.textContent = `Waiting for ${mins}m ${secs}s…`;
    }
  }, 500);
}

function stopWaitingTimer() {
  if (state.waitingTimerInterval) {
    clearInterval(state.waitingTimerInterval);
    state.waitingTimerInterval = null;
  }
  const el = document.getElementById('waiting-timer');
  if (el) el.textContent = '';
}

// ═══════════════════════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════

function showToast(message, duration = 3000) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  DOM.toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), duration + 400);
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════════════════

function setupEventListeners() {
  // Registration
  DOM.registrationForm.addEventListener('submit', onRegister);

  // Filter toggle (moved here to avoid duplicate listeners on each submit)
  const filterToggle = document.getElementById('toggle-filter-btn');
  const filterOptions = document.getElementById('filter-options');
  if (filterToggle) {
    filterToggle.addEventListener('click', () => {
      filterOptions.classList.toggle('hidden');
    });
  }

  // Cancel finding
  DOM.cancelBtn.addEventListener('click', onCancelFinding);

  // Chat
  DOM.messageInput.addEventListener('input', onMessageInput);
  DOM.messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  DOM.sendBtn.addEventListener('click', sendMessage);

  // File sharing
  DOM.filePickerBtn.addEventListener('click', () => DOM.fileInput.click());
  DOM.fileInput.addEventListener('change', onFileSelected);
  DOM.sendFileBtn.addEventListener('click', sendFile);
  DOM.fileCancelBtn.addEventListener('click', cancelFileSelection);

  // Header buttons
  DOM.voiceCallBtn.addEventListener('click', () => startCall(false));
  DOM.videoCallBtn.addEventListener('click', () => startCall(true));
  DOM.skipBtn.addEventListener('click', onSkip);
  DOM.leaveBtn.addEventListener('click', onLeave);

  // Voice call controls
  DOM.voiceMuteBtn.addEventListener('click', toggleMute);
  DOM.voiceEndBtn.addEventListener('click', endCall);

  // Video call controls
  DOM.vidMuteBtn.addEventListener('click', toggleMute);
  DOM.vidCameraBtn.addEventListener('click', toggleCamera);
  DOM.vidEndBtn.addEventListener('click', endCall);

  // Keyboard: Escape to end call
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.isCallActive) {
      endCall();
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════

function onRegister(e) {
  e.preventDefault();

  const age = DOM.ageSelect.value;
  const gender = DOM.genderSelect.value;

  // Gather filter preferences (use defaults if UI not shown)
  const filterGenderEl = document.getElementById('filter-gender-select');
  const filterMinAgeEl = document.getElementById('filter-min-age');
  const filterMaxAgeEl = document.getElementById('filter-max-age');
  const filterGender = filterGenderEl ? filterGenderEl.value : 'any';
  const filterMinAge = filterMinAgeEl ? parseInt(filterMinAgeEl.value) : 18;
  const filterMaxAge = filterMaxAgeEl ? parseInt(filterMaxAgeEl.value) : 100;

  if (!age || !gender) {
    showToast('Please select your age and gender.');
    return;
  }

  const username = DOM.usernameInput.value.trim() || '';

  // Disable button
  DOM.findBtn.disabled = true;
  DOM.findBtn.querySelector('.btn-text').textContent = 'Connecting...';

  // Connect socket
  connectSocket({ username, age, gender, filterGender, filterMinAge, filterMaxAge });
}

// ═══════════════════════════════════════════════════════════════════════════
// SOCKET CONNECTION
// ═══════════════════════════════════════════════════════════════════════════

function connectSocket(profile) {
  // If a previous socket is still alive (e.g. the user cancelled a search then
  // re-submitted the form), close it so we don't register twice with the server.
  if (state.socket) state.socket.disconnect();

  state.socket = io({
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionAttempts: 5,
  });

  state.socket.on('connect', () => {
    console.log('🟢 Socket connected:', state.socket.id);
    // Register after connection
    state.socket.emit('register', profile);
    state.userProfile = profile; // Save for reconnection
  });

  state.socket.on('registered', (data) => {
    state.username = data.username;
    showToast(`Connected as ${data.username}`);
    // Server will emit 'start-finding' after registration
  });

  state.socket.on('waiting', () => {
    startWaitingTimer();
    console.log('⏳ Waiting for a match...');
  });

  state.socket.on('matched', (data) => {
    // Clean up any lingering call state from previous match
    if (state.isCallActive) cleanupCall();

    stopWaitingTimer();

    // Clear any previous chat messages for a fresh start
    clearChat();

    state.currentRoom = data.room;
    state.strangerInfo = data.stranger;
    state.isChatting = true;

    // Clear typing indicator from previous matches
    DOM.typingIndicator.classList.add('hidden');

    // Update UI
    DOM.strangerName.textContent = data.stranger.username;
    DOM.strangerMeta.textContent = `${data.stranger.age} • ${data.stranger.gender}`;

    // Show chat
    showScreen('chat-screen');
    // Auto-focus message input
    setTimeout(() => DOM.messageInput.focus(), 300);
    scrollToBottom();
    showToast(`💞 Connected with ${data.stranger.username}!`);
  });

  state.socket.on('stranger-disconnected', (data) => {
    stopWaitingTimer();

    const strangerName = data.partnerUsername ||
      (state.strangerInfo && state.strangerInfo.username) ||
      'Stranger';
    const isSkip = data.reason && data.reason.includes('moved on');

    state.isChatting = false;
    state.currentRoom = null;
    state.strangerInfo = null;

    // End any active call
    if (state.isCallActive) {
      cleanupCall();
    }

    // Clear all previous chat messages
    clearChat();

    // Show who left and why
    const msg = isSkip ? `${strangerName} skipped` : `${strangerName} disconnected`;

    const msgDiv = document.createElement('div');
    msgDiv.className = 'disconnect-message';
    msgDiv.innerHTML = `
      <div class="disconnect-icon">${isSkip ? '⏭️' : '🍃'}</div>
      <p class="disconnect-text">${escapeHtml(msg)}</p>
    `;
    DOM.messagesContainer.appendChild(msgDiv);

    // Connect / Leave buttons
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'disconnect-actions';
    const connectBtn = document.createElement('button');
    connectBtn.className = 'btn-primary';
    connectBtn.textContent = 'Find a New Connection';
    connectBtn.addEventListener('click', () => {
      clearChat();
      state.isSearchCancelled = false;
      showScreen('connecting-screen');
      state.socket.emit('find-stranger');
    });
    const leaveBtn = document.createElement('button');
    leaveBtn.className = 'btn-secondary';
    leaveBtn.textContent = 'Leave';
    leaveBtn.addEventListener('click', () => {
      if (state.socket) state.socket.disconnect();
      resetToLanding();
    });
    actionsDiv.appendChild(connectBtn);
    actionsDiv.appendChild(leaveBtn);
    DOM.messagesContainer.appendChild(actionsDiv);
  });

  state.socket.on('chat-message', (data) => {
    addMessage(data.message, false, data.sender, data.timestamp);
    scrollToBottom();
  });

  state.socket.on('stranger-typing', (data) => {
    DOM.typingIndicator.classList.toggle('hidden', !data.isTyping);
    scrollToBottom();
  });

  // ── File Messages ───────────────────────────────────────────────────
  state.socket.on('file-message', (data) => {
    addFileMessage(data, false);
    scrollToBottom();
  });

  // ── WebRTC Signaling ──────────────────────────────────────────────
  state.socket.on('call-offer', async (data) => {
    await handleOffer(data);
  });

  state.socket.on('call-answer', async (data) => {
    await handleAnswer(data);
  });

  state.socket.on('ice-candidate', async (data) => {
    await handleIceCandidate(data);
  });

  state.socket.on('call-ended', (data) => {
    showToast(data.reason || 'Call ended');
    cleanupCall();
  });

  state.socket.on('call-rejected', (data) => {
    showToast('Call was declined');
    cleanupCall();
  });

  state.socket.on('error-msg', (data) => {
    showToast(data.message);
    // Registration errors (username taken, invalid age, …) leave the submit
    // button disabled from onRegister — re-enable it so the user can fix the
    // form instead of being stuck on "Connecting...".
    if (!state.isChatting) {
      DOM.findBtn.disabled = false;
      const btnText = DOM.findBtn.querySelector('.btn-text');
      if (btnText) btnText.textContent = 'Find a Connection';
    }
  });

  state.socket.on('start-finding', () => {
    clearChat();
    showScreen('connecting-screen');
    state.socket.emit('find-stranger');
  });

  state.socket.on('cancelled-finding', () => {
    stopWaitingTimer();
    showScreen('landing-screen');
    DOM.findBtn.disabled = false;
    DOM.findBtn.querySelector('.btn-text').textContent = 'Find a Connection';
  });

  state.socket.on('disconnect', () => {
    console.log('🔴 Socket disconnected');
    stopWaitingTimer();
    showToast('Connection lost. Reconnecting...');
    if (state.isCallActive) cleanupCall();
    // Clear stale session state so a reconnect/rematch starts clean.
    state.isChatting = false;
    state.currentRoom = null;
    state.strangerInfo = null;
  });

  state.socket.on('reconnect', () => {
    console.log('🟢 Socket reconnected');
    showToast('Reconnected!');
    // Re-register in case server cleaned up old session
    if (state.userProfile) {
      state.socket.emit('register', state.userProfile);
    }
    if (state.isCallActive) cleanupCall();
  });

  state.socket.on('connect_error', (err) => {
    console.error('🔴 Socket connection error:', err && err.message);
    // Re-enable the form so the user can retry — don't leave it stuck on
    // "Connecting..." (this is what happens if the connection is refused).
    if (!state.isChatting) {
      DOM.findBtn.disabled = false;
      const btnText = DOM.findBtn.querySelector('.btn-text');
      if (btnText) btnText.textContent = 'Find a Connection';
    }
    showToast('Could not connect. Please try again.');
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// CANCEL / SKIP / LEAVE
// ═══════════════════════════════════════════════════════════════════════════

function onCancelFinding() {
  state.isSearchCancelled = true;
  if (state.socket) {
    state.socket.emit('cancel-finding');
  }
}

function onSkip() {
  if (!state.socket) return;
  if (state.isCallActive) {
    cleanupCall();
  }
  state.socket.emit('skip-stranger');
  showToast('Finding someone new...');
}

function onLeave() {
  if (state.isCallActive) {
    cleanupCall();
  }
  // Disconnect socket — server auto-cleans user data on disconnect
  if (state.socket) {
    state.socket.disconnect();
  }
  // Reset to landing
  resetToLanding();
}

function resetToLanding() {
  state.isChatting = false;
  state.currentRoom = null;
  state.strangerInfo = null;
  state.socket = null; // Force fresh connection on next registration

  DOM.messagesContainer.innerHTML = `
    <div class="messages-start">
      <div class="start-icon">💬</div>
      <p>You're now connected. Say hello!</p>
    </div>
  `;
  DOM.messageInput.value = '';
  DOM.sendBtn.disabled = true;

  DOM.findBtn.disabled = false;
  DOM.findBtn.querySelector('.btn-text').textContent = 'Find a Connection';

  showScreen('landing-screen');
}

// ═══════════════════════════════════════════════════════════════════════════
// CHAT MESSAGES
// ═══════════════════════════════════════════════════════════════════════════

let typingTimeout = null;

function onMessageInput() {
  const val = DOM.messageInput.value.trim();
  DOM.sendBtn.disabled = !val;

  // Emit typing
  if (state.socket && state.currentRoom) {
    state.socket.emit('typing', { isTyping: val.length > 0 });

    if (typingTimeout) clearTimeout(typingTimeout);
    if (val.length > 0) {
      typingTimeout = setTimeout(() => {
        state.socket.emit('typing', { isTyping: false });
      }, 2000);
    }
  }
}

function sendMessage() {
  const text = DOM.messageInput.value.trim();
  if (!text || !state.socket || !state.currentRoom) return;

  state.socket.emit('chat-message', { message: text });
  addMessage(text, true, 'You', Date.now());
  DOM.messageInput.value = '';
  DOM.sendBtn.disabled = true;
  scrollToBottom();

  // Stop typing
  state.socket.emit('typing', { isTyping: false });
  if (typingTimeout) clearTimeout(typingTimeout);
}

function addMessage(text, isMine, sender, timestamp) {
  const div = document.createElement('div');
  div.className = `message ${isMine ? 'my-message' : 'stranger-message'}`;

  const time = timestamp ? formatTime(timestamp) : '';

  // Remote messages arrive already HTML-escaped by the server (server.js
  // escapeHTML), so render them verbatim — escaping a second time would show
  // literal &lt;...&gt; entities (e.g. "<3" → "&lt;3"). Only our own messages
  // (raw input added locally) need escaping here. The sender name is NOT
  // server-escaped, so it is always escaped client-side.
  div.innerHTML = `
    ${!isMine ? `<span class="msg-sender">${escapeHtml(sender)}</span>` : ''}
    ${isMine ? escapeHtml(text) : text}
    <span class="msg-time">${time}</span>
  `;

  DOM.messagesContainer.appendChild(div);
}

function addSystemMessage(text) {
  const div = document.createElement('div');
  div.className = 'system-message';
  div.textContent = text;
  DOM.messagesContainer.appendChild(div);
  scrollToBottom();
}

function clearChat() {
  DOM.messagesContainer.innerHTML = `
    <div class="messages-start">
      <div class="start-icon">💬</div>
      <p>You're now connected. Say hello!</p>
    </div>
  `;
}

function scrollToBottom() {
  DOM.messagesContainer.scrollTop = DOM.messagesContainer.scrollHeight;
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ═══════════════════════════════════════════════════════════════════════════
// FILE SHARING
// ═══════════════════════════════════════════════════════════════════════════

function getFileCategory(mimeType) {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return null;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFileExtension(filename) {
  return filename.split('.').pop()?.toLowerCase() || '';
}

// ─── File Selection ──────────────────────────────────────────────────────

function onFileSelected() {
  const file = DOM.fileInput.files[0];
  if (!file) return;

  // Validate type
  if (!ALLOWED_TYPES.includes(file.type)) {
    const ext = getFileExtension(file.name);
    showToast(`File type .${ext} is not supported. Use images, videos, or audio.`);
    DOM.fileInput.value = '';
    return;
  }

  const category = getFileCategory(file.type);
  if (!category) {
    showToast('Unsupported file type.');
    DOM.fileInput.value = '';
    return;
  }

  // Validate size
  const maxBytes = FILE_LIMITS[category];
  if (file.size > maxBytes) {
    const sizeNames = { image: '5 MB', video: '20 MB', audio: '10 MB' };
    showToast(`File too large. ${category} files are limited to ${sizeNames[category]}.`);
    DOM.fileInput.value = '';
    return;
  }

  // Store and show preview
  state.pendingFile = file;
  DOM.filePreviewIcon.textContent = FILE_ICONS[category] || '📁';
  DOM.filePreviewName.textContent = file.name;
  DOM.filePreviewSize.textContent = formatFileSize(file.size);
  DOM.filePreviewArea.classList.remove('hidden');
  DOM.fileProgress.classList.add('hidden');
  DOM.sendFileBtn.disabled = false;
}

function cancelFileSelection() {
  state.pendingFile = null;
  DOM.fileInput.value = '';
  DOM.filePreviewArea.classList.add('hidden');
  DOM.fileProgress.classList.add('hidden');
}

// ─── Image Compression ───────────────────────────────────────────────────

function compressImage(file, maxDimension = 1600, quality = 0.75) {
  return new Promise((resolve, reject) => {
    // For GIFs or small files, skip compression
    if (file.type === 'image/gif' || file.size < 100 * 1024) {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        }
        if (height > maxDimension) {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          const r2 = new FileReader();
          r2.onload = () => resolve(r2.result);
          r2.onerror = reject;
          r2.readAsDataURL(blob);
        }, 'image/jpeg', quality);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── Read File as Base64 (for video/audio) ──────────────────────────────

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

// ─── Send File ───────────────────────────────────────────────────────────

async function sendFile() {
  const file = state.pendingFile;
  if (!file || !state.socket || !state.currentRoom) return;

  DOM.sendFileBtn.disabled = true;
  DOM.sendFileBtn.textContent = 'Sending...';
  DOM.fileProgress.classList.remove('hidden');
  DOM.progressFill.style.width = '10%';
  DOM.progressText.textContent = 'Preparing...';

  try {
    let fileData;

    // Compress images, send video/audio as-is
    if (getFileCategory(file.type) === 'image') {
      DOM.progressText.textContent = 'Compressing...';
      fileData = await compressImage(file);
    } else {
      DOM.progressText.textContent = 'Reading...';
      fileData = await readFileAsBase64(file);
    }

    DOM.progressFill.style.width = '70%';
    DOM.progressText.textContent = 'Sending...';

    // Emit via socket
    state.socket.emit('file-message', {
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      fileData: fileData,
    });

    // Show in local chat
    const fileMsgData = {
      sender: state.username,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      fileData: fileData,
      timestamp: Date.now(),
    };
    addFileMessage(fileMsgData, true);

    DOM.progressFill.style.width = '100%';
    DOM.progressText.textContent = 'Sent!';

    // Clear after brief delay
    setTimeout(() => {
      cancelFileSelection();
      scrollToBottom();
    }, 600);
  } catch (err) {
    console.error('❌ sendFile error:', err);
    showToast('Failed to send file.');
    DOM.sendFileBtn.disabled = false;
    DOM.sendFileBtn.textContent = 'Send';
    DOM.fileProgress.classList.add('hidden');
  }
}

// ─── Render File Message ─────────────────────────────────────────────────

function addFileMessage(data, isMine) {
  const container = DOM.messagesContainer;
  const div = document.createElement('div');
  div.className = `message file-message ${isMine ? 'my-message' : 'stranger-message'}`;

  const time = data.timestamp ? formatTime(data.timestamp) : '';
  const category = getFileCategory(data.fileType);

  if (category === 'image') {
    // Inline image — safe DOM API, no innerHTML
    const wrapper = document.createElement('div');
    wrapper.className = 'file-content image-content';

    const img = document.createElement('img');
    img.src = data.fileData;
    img.alt = data.fileName || 'Image';
    img.loading = 'lazy';
    img.addEventListener('click', () => openLightbox(img.src));

    wrapper.appendChild(img);
    div.appendChild(wrapper);

    const timeSpan = document.createElement('span');
    timeSpan.className = 'msg-time';
    timeSpan.style.cssText = 'padding: 4px 14px 8px; display: block;';
    timeSpan.textContent = time;
    div.appendChild(timeSpan);

  } else if (category === 'video') {
    // Video — safe DOM API, no innerHTML
    const wrapper = document.createElement('div');
    wrapper.className = 'file-content video-content';

    const video = document.createElement('video');
    video.src = data.fileData;
    video.controls = true;
    video.preload = 'metadata';

    wrapper.appendChild(video);
    div.appendChild(wrapper);

    const timeSpan = document.createElement('span');
    timeSpan.className = 'msg-time';
    timeSpan.style.cssText = 'padding: 4px 14px 8px; display: block;';
    timeSpan.textContent = time;
    div.appendChild(timeSpan);

  } else if (category === 'audio') {
    // Audio — safe DOM API, no innerHTML
    const wrapper = document.createElement('div');
    wrapper.className = 'file-content audio-content';

    const audio = document.createElement('audio');
    audio.src = data.fileData;
    audio.controls = true;

    wrapper.appendChild(audio);
    div.appendChild(wrapper);

    const timeSpan = document.createElement('span');
    timeSpan.className = 'msg-time';
    timeSpan.style.cssText = 'padding: 4px 14px 8px; display: block;';
    timeSpan.textContent = time;
    div.appendChild(timeSpan);
  }

  container.appendChild(div);
  scrollToBottom();
}

// ─── Image Lightbox ──────────────────────────────────────────────────────

function openLightbox(src) {
  const overlay = document.createElement('div');
  overlay.id = 'image-lightbox';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'lightbox-close';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => overlay.remove());

  const img = document.createElement('img');
  img.src = src;
  img.alt = 'Enlarged image';

  overlay.appendChild(closeBtn);
  overlay.appendChild(img);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
}

// ─── Download File ───────────────────────────────────────────────────────

function downloadFile(dataUri, filename) {
  const link = document.createElement('a');
  link.href = dataUri;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Close lightbox on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const lb = document.getElementById('image-lightbox');
    if (lb) {
      lb.remove();
      document.body.style.overflow = '';
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// WEBRTC — CALL MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

async function startCall(isVideo) {
  if (state.isCallActive) return;
  if (!state.socket || !state.currentRoom) return;

  state.isVideoCall = isVideo;

  // Unique id for this call attempt — lets us deterministically resolve the
  // "both sides dialed" (glare) race so a call always connects.
  state.callId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // Show connecting toast
  showToast(`Starting ${isVideo ? 'video' : 'voice'} call...`);

  try {
    state.localStream = await navigator.mediaDevices.getUserMedia({
      video: isVideo,
      audio: true,
    });

    // Set local video source
    if (isVideo) {
      DOM.localVideo.srcObject = state.localStream;
    }

    // Random jitter (0–500ms) to prevent double-call race condition
    await new Promise(r => setTimeout(r, Math.random() * 500));

    await createPeerConnection();

    // Create and send offer
    const offer = await state.peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: isVideo,
    });
    await state.peerConnection.setLocalDescription(offer);

    state.socket.emit('call-offer', {
      room: state.currentRoom,
      type: isVideo ? 'video' : 'voice',
      offer: offer,
      callId: state.callId,
    });

    state.isCaller = true;
    state.isCallActive = true;

    // Show appropriate UI
    if (isVideo) {
      showVideoCallUI();
    } else {
      showVoiceCallUI();
    }

    startCallTimer();
  } catch (err) {
    console.error('❌ startCall error:', err);
    console.error('Error name:', err.name);
    console.error('Error message:', err.message);

    // Check if this is a media permissions error from getUserMedia
    const isMediaError =
      err.name === 'NotAllowedError' ||
      err.name === 'PermissionDeniedError' ||
      err.name === 'NotFoundError' ||
      err.name === 'NotReadableError' ||
      err.name === 'OverconstrainedError' ||
      (err.message && (
        err.message.includes('Permission denied') ||
        err.message.includes('not allowed') ||
        err.message.includes('Could not start') ||
        err.message.includes('Sensor') ||
        err.message.includes('Device') ||
        err.message.includes('media')
      ));

    if (isMediaError) {
      showToast('Could not access camera/microphone. Check permissions.');
    } else {
      showToast('Could not connect the call. Please try again.');
    }
    cleanupCall();
  }
}

async function handleOffer(data) {
  if (state.isCallActive) {
    // Glare: both sides dialed at once. Deterministically pick one caller to
    // win — the smaller callId keeps its offer; the loser tears down its offer; the loser tears down its own
    // outgoing call and answers the winner's offer. Otherwise both reject each
    // other and no connection is ever established.
    if (state.callId && data.callId && data.callId < state.callId) {
      cleanupCall(); // lose — drop our outgoing call, then answer below
    } else {
      return; // win — keep our call, ignore their offer
    }
  }

  // Store incoming call details
  state.incomingCall.offer = data.offer;
  state.incomingCall.type = data.type;
  state.incomingCall.callId = data.callId;
  state.incomingCall.room = data.room;
  state.incomingCall.iceCandidates = [];

  // Show incoming call UI
  showIncomingCallUI();

  // Note: We do NOT auto-answer here. User must click Accept or Decline.
  // ICE candidates will be buffered until the user accepts.
}

async function handleAnswer(data) {
  if (!state.peerConnection) return;
  try {
    await state.peerConnection.setRemoteDescription(
      new RTCSessionDescription(data.answer)
    );
    console.log('✅ Remote description set (answer)');
  } catch (err) {
    console.error('❌ handleAnswer error:', err);
  }
}

async function handleIceCandidate(data) {
  // If we have an incoming call waiting for user acceptance, buffer the candidate
  if (state.incomingCall.offer && !state.peerConnection) {
    state.incomingCall.iceCandidates.push(data.candidate);
    return;
  }

  if (!state.peerConnection) return;
  try {
    await state.peerConnection.addIceCandidate(
      new RTCIceCandidate(data.candidate)
    );
  } catch (err) {
    console.error('❌ handleIceCandidate error:', err);
  }
}

// ─── Create Peer Connection ──────────────────────────────────────────────

async function createPeerConnection() {
  state.peerConnection = new RTCPeerConnection(ICE_SERVERS, {
    iceCandidatePoolSize: 3,
  });

  // Add local tracks
  if (state.localStream) {
    state.localStream.getTracks().forEach((track) => {
      state.peerConnection.addTrack(track, state.localStream);
    });
  }

  // Remote stream setup
  state.remoteStream = new MediaStream();

  state.peerConnection.ontrack = (event) => {
    console.log('ontrack event:', event);
    state.remoteStream.addTrack(event.track);
    // Route remote media to the right element: video calls play through
    // #remote-video, voice calls through the hidden #remote-audio element
    // (a display:none video element won't reliably play audio in all browsers).
    if (state.isVideoCall) {
      if (DOM.remoteVideo) DOM.remoteVideo.srcObject = state.remoteStream;
      DOM.remoteVideoFallback.classList.add('hidden');
    } else if (DOM.remoteAudio) {
      DOM.remoteAudio.srcObject = state.remoteStream;
    }
  };

  state.peerConnection.onicecandidate = (event) => {
    if (event.candidate && state.socket && state.currentRoom) {
      state.socket.emit('ice-candidate', {
        room: state.currentRoom,
        candidate: event.candidate,
      });
    }
  };

  state.peerConnection.oniceconnectionstatechange = () => {
    const connState = state.peerConnection.iceConnectionState;
    console.log('iceConnectionState:', connState);
    if (connState === 'disconnected' || connState === 'failed') {
      if (state.isCallActive) {
        // Clear any existing timer
        if (state.iceDisconnectTimer) {
          clearTimeout(state.iceDisconnectTimer);
          state.iceDisconnectTimer = null;
        }
        // Start a timer to allow for potential recovery
        state.iceDisconnectTimer = setTimeout(() => {
          // Re-check state after delay
          if (state.isCallActive && state.peerConnection) {
            const currentState = state.peerConnection.iceConnectionState;
            if (currentState === 'disconnected' || currentState === 'failed') {
              showToast('Call connection lost.');
              cleanupCall();
            }
          }
          state.iceDisconnectTimer = null;
        }, 5000); // 5 second grace period
      }
    } else if (connState === 'connected' || connState === 'completed') {
      // Clear timer if connection recovers
      if (state.iceDisconnectTimer) {
        clearTimeout(state.iceDisconnectTimer);
        state.iceDisconnectTimer = null;
      }
    }
  };

  state.peerConnection.onconnectionstatechange = () => {
    const connState = state.peerConnection.connectionState;
    console.log('connectionState:', connState);
    if (connState === 'disconnected' || connState === 'failed') {
      if (state.isCallActive) {
        // Clear any existing timer
        if (state.connectionDisconnectTimer) {
          clearTimeout(state.connectionDisconnectTimer);
          state.connectionDisconnectTimer = null;
        }
        // Start a timer to allow for potential recovery
        state.connectionDisconnectTimer = setTimeout(() => {
          // Re-check state after delay
          if (state.isCallActive && state.peerConnection) {
            const currentState = state.peerConnection.connectionState;
            if (currentState === 'disconnected' || currentState === 'failed') {
              showToast('Call disconnected.');
              cleanupCall();
            }
          }
          state.connectionDisconnectTimer = null;
        }, 5000); // 5 second grace period
      }
    } else if (connState === 'connected' || connState === 'completed') {
      // Clear timer if connection recovers
      if (state.connectionDisconnectTimer) {
        clearTimeout(state.connectionDisconnectTimer);
        state.connectionDisconnectTimer = null;
      }
    }
  };
}

// ─── Mute / Camera Toggle ────────────────────────────────────────────────

function toggleMute() {
  if (!state.localStream) return;
  const audioTrack = state.localStream.getAudioTracks()[0];
  if (!audioTrack) return;

  audioTrack.enabled = !audioTrack.enabled;
  state.isMuted = !audioTrack.enabled;

  // Update UI
  DOM.voiceMuteBtn.classList.toggle('muted', state.isMuted);
  DOM.vidMuteBtn.classList.toggle('muted', state.isMuted);

  const btns = state.isCallActive ? (state.isVideoCall ? [DOM.vidMuteBtn] : [DOM.voiceMuteBtn]) : [];
  btns.forEach((btn) => {
    btn.classList.toggle('muted', state.isMuted);
  });
}

function toggleCamera() {
  if (!state.localStream || !state.isVideoCall) return;
  const videoTrack = state.localStream.getVideoTracks()[0];
  if (!videoTrack) return;

  videoTrack.enabled = !videoTrack.enabled;
  state.isCameraOff = !videoTrack.enabled;

  DOM.vidCameraBtn.classList.toggle('muted', state.isCameraOff);
}

// ─── End Call ────────────────────────────────────────────────────────────

function endCall() {
  if (state.isCallActive && state.socket && state.currentRoom) {
    state.socket.emit('end-call', { room: state.currentRoom });
  }
  cleanupCall();
  showToast('Call ended.');
}

function cleanupCall() {
  // Stop local tracks
  if (state.localStream) {
    state.localStream.getTracks().forEach((track) => track.stop());
    state.localStream = null;
  }

  // Close peer connection
  if (state.peerConnection) {
    state.peerConnection.close();
    state.peerConnection = null;
  }

  state.remoteStream = null;
  state.isCallActive = false;
  state.isVideoCall = false;
  state.isCaller = false;
  state.isMuted = false;
  state.isCameraOff = false;

  // Stop timer
  if (state.callTimerInterval) {
    clearInterval(state.callTimerInterval);
    state.callTimerInterval = null;
  }

  // Hide call UIs
  DOM.voiceCallBar.classList.add('hidden');
  DOM.videoOverlay.classList.add('hidden');

  // Reset video/audio elements
  DOM.remoteVideo.srcObject = null;
  DOM.localVideo.srcObject = null;
  if (DOM.remoteAudio) DOM.remoteAudio.srcObject = null;
  DOM.remoteVideoFallback.classList.remove('hidden');

  // Reset mute/camera button states
  DOM.voiceMuteBtn.classList.remove('muted');
  DOM.vidMuteBtn.classList.remove('muted');
  DOM.vidCameraBtn.classList.remove('muted');
}

// ─── Incoming Call UI ────────────────────────────────────────────────────
function showIncomingCallUI() {
  // Remove any stale overlay from a previous offer
  if (DOM.incomingCallOverlay) {
    DOM.incomingCallOverlay.remove();
    DOM.incomingCallOverlay = null;
  }

  const callerName = (state.strangerInfo && state.strangerInfo.username) || 'Stranger';

  const overlay = document.createElement('div');
  overlay.id = 'incoming-call-overlay';

  const content = document.createElement('div');
  content.className = 'incoming-call-content';

  const title = document.createElement('h2');
  title.textContent = `${callerName} is calling…`;

  const subtitle = document.createElement('p');
  subtitle.textContent = state.incomingCall.type === 'video' ? '📹 Video call' : '🎧 Voice call';

  const actions = document.createElement('div');
  actions.className = 'incoming-call-actions';

  const declineBtn = document.createElement('button');
  declineBtn.className = 'btn-secondary';
  declineBtn.textContent = 'Decline';
  declineBtn.addEventListener('click', declineIncomingCall);

  const acceptBtn = document.createElement('button');
  acceptBtn.className = 'btn-primary';
  acceptBtn.textContent = 'Accept';
  acceptBtn.addEventListener('click', acceptIncomingCall);

  actions.appendChild(declineBtn);
  actions.appendChild(acceptBtn);

  content.appendChild(title);
  content.appendChild(subtitle);
  content.appendChild(actions);

  overlay.appendChild(content);

  document.body.appendChild(overlay);

  DOM.incomingCallOverlay = overlay;
  DOM.incomingCallAcceptBtn = acceptBtn;
  DOM.incomingCallDeclineBtn = declineBtn;
}

async function acceptIncomingCall() {
  // Hide the overlay
  if (DOM.incomingCallOverlay) {
    DOM.incomingCallOverlay.remove();
    DOM.incomingCallOverlay = null;
    DOM.incomingCallAcceptBtn = null;
    DOM.incomingCallDeclineBtn = null;
  }

  try {
    // Set up local stream if not already set (should be from handleOffer)
    if (!state.localStream) {
      state.localStream = await navigator.mediaDevices.getUserMedia({
        video: state.incomingCall.type === 'video',
        audio: true,
      });

      if (state.incomingCall.type === 'video') {
        DOM.localVideo.srcObject = state.localStream;
      }
    }

    // Set call flags BEFORE creating the peer connection so the ontrack
    // handler routes remote media to the correct element (#remote-video for
    // video, #remote-audio for voice). Setting isVideoCall later means an
    // incoming video call's stream is routed to the hidden audio element and
    // the remote picture never appears.
    state.callId = state.incomingCall.callId;
    state.isVideoCall = state.incomingCall.type === 'video';
    state.isCaller = false;
    state.isCallActive = true;

    await createPeerConnection();

    // Set remote description (offer)
    await state.peerConnection.setRemoteDescription(
      new RTCSessionDescription(state.incomingCall.offer)
    );

    // Apply any buffered ICE candidates
    for (const candidate of state.incomingCall.iceCandidates) {
      try {
        await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('Failed to add buffered ICE candidate:', err);
      }
    }

    // Create and send answer
    const answer = await state.peerConnection.createAnswer();
    await state.peerConnection.setLocalDescription(answer);

    state.socket.emit('call-answer', {
      room: state.incomingCall.room,
      answer: answer,
    });

    // Show appropriate UI
    if (state.isVideoCall) {
      showVideoCallUI();
    } else {
      showVoiceCallUI();
    }

    startCallTimer();
    showToast('Incoming call connected!');
  } catch (err) {
    console.error('❌ acceptIncomingCall error:', err);
    showToast('Could not connect the call.');
    cleanupCall();
    // Notify caller of rejection
    if (state.socket && state.incomingCall.room) {
      state.socket.emit('call-rejected', { room: state.incomingCall.room });
    }
    resetIncomingCallState();
  }
}

function declineIncomingCall() {
  // Notify caller
  if (state.socket && state.incomingCall.room) {
    state.socket.emit('call-rejected', { room: state.incomingCall.room });
  }

  // Hide overlay
  if (DOM.incomingCallOverlay) {
    DOM.incomingCallOverlay.remove();
    DOM.incomingCallOverlay = null;
    DOM.incomingCallAcceptBtn = null;
    DOM.incomingCallDeclineBtn = null;
  }

  showToast('Call declined.');
  resetIncomingCallState();
}

function resetIncomingCallState() {
  state.incomingCall = {
    offer: null,
    type: null,
    callId: null,
    room: null,
    iceCandidates: []
  };
}

// ─── Call UI ─────────────────────────────────────────────────────────────

function showVoiceCallUI() {
  DOM.voiceCallBar.classList.remove('hidden');
  DOM.videoOverlay.classList.add('hidden');
  DOM.voiceCallTimer.textContent = '00:00';
}

function showVideoCallUI() {
  DOM.videoOverlay.classList.remove('hidden');
  DOM.voiceCallBar.classList.add('hidden');
  DOM.videoCallTimer.textContent = '00:00';
  DOM.remoteVideoFallback.classList.remove('hidden');
}

// ─── Call Timer ──────────────────────────────────────────────────────────

function startCallTimer() {
  let seconds = 0;
  if (state.callTimerInterval) clearInterval(state.callTimerInterval);

  state.callTimerInterval = setInterval(() => {
    seconds++;
    const mins = String(Math.floor(seconds / 60)).padStart(2, '0');
    const secs = String(seconds % 60).padStart(2, '0');
    const time = `${mins}:${secs}`;

    if (state.isVideoCall) {
      DOM.videoCallTimer.textContent = time;
    } else {
      DOM.voiceCallTimer.textContent = time;
    }
  }, 1000);
}

// ═══════════════════════════════════════════════════════════════════════════
// STRANGER AVATAR COLOR
// ═══════════════════════════════════════════════════════════════════════════
// Used to give each stranger a unique gradient avatar

function getAvatarGradient(username) {
  const colors = [
    ['#ff9bb0', '#ff6b8a'],
    ['#a8e6cf', '#88d8b0'],
    ['#ffd3b6', '#ffaaa5'],
    ['#dcedc1', '#a8e6cf'],
    ['#ffb7b2', '#e2f0cb'],
    ['#b5eaea', '#8ac6d1'],
    ['#f3b9c6', '#ce6a85'],
    ['#c9b1ff', '#8c6aff'],
  ];
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

// ─── Window unload handler ───────────────────────────────────────────────
// When the user closes the tab/window, the socket disconnects automatically.
// The server listens for the 'disconnect' event and cleans up the user data.
// This is our main cleanup mechanism — no explicit action needed here.
// We add a beforeunload as a safety net:

window.addEventListener('beforeunload', () => {
  if (state.socket) {
    state.socket.disconnect();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', init);
