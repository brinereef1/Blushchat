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

  // File sharing
  pendingFile: null,

  // Profile saved for reconnection
  userProfile: null,

  // True when the user (or the tab closing) intentionally disconnected — used
  // to suppress the misleading "Connection lost. Reconnecting..." toast.
  intentionalDisconnect: false,

  // Waiting timer
  waitingTimerInterval: null,
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
  skipBtn: $('#skip-btn'),
  leaveBtn: $('#leave-btn'),

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

  // Show filter tip after 20s if the user has restrictive filters APPLIED.
  // Base it on state.userProfile (the actual applied filters), not the sidebar's
  // current DOM values — the sidebar may never have been opened, and filters set
  // on the landing page wouldn't otherwise be reflected here.
  setTimeout(() => {
    const filterTip = document.getElementById('filter-tip');
    if (!filterTip) return;
    const profile = state.userProfile;
    if (!profile) return; // not registered yet — no filters applied, no tip
    const gender = profile.filterGender || 'any';
    const minAge = profile.filterMinAge || 18;
    const maxAge = profile.filterMaxAge || 100;
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
  setupThemeToggle();
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
  DOM.skipBtn.addEventListener('click', onSkip);
  DOM.leaveBtn.addEventListener('click', onLeave);
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

  // Any disconnect from here on is an intentional new connection.
  state.intentionalDisconnect = false;

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
      showScreen('connecting-screen');
      state.socket.emit('find-stranger');
    });
    const leaveBtn = document.createElement('button');
    leaveBtn.className = 'btn-secondary';
    leaveBtn.textContent = 'Leave';
    leaveBtn.addEventListener('click', () => {
      state.intentionalDisconnect = true;
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
    // Only warn about a lost connection if it wasn't deliberate (leaving,
    // closing the tab). Showing "Reconnecting..." right after the user hits
    // Leave is confusing.
    if (!state.intentionalDisconnect) {
      showToast('Connection lost. Reconnecting...');
    }
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
  if (state.socket) {
    state.socket.emit('cancel-finding');
  }
}

function onSkip() {
  if (!state.socket) return;
  state.socket.emit('skip-stranger');
  showToast('Finding someone new...');
}

function onLeave() {
  // Mark the disconnect as deliberate so the client's 'disconnect' handler
  // doesn't show a misleading "Connection lost. Reconnecting..." toast.
  state.intentionalDisconnect = true;
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

// ═══════════════════════════════════════════════════════════════════════════
// THEME TOGGLE (dark / light)
// ═══════════════════════════════════════════════════════════════════════════

function getSavedTheme() {
  try {
    return localStorage.getItem('blushchat-theme') === 'dark' ? 'dark' : 'light';
  } catch (e) {
    return 'light';
  }
}

// Reflect the current theme on every .theme-toggle button (icon + tooltip).
function updateThemeButtons() {
  const isDark = document.documentElement.dataset.theme === 'dark';
  document.querySelectorAll('.theme-toggle').forEach((btn) => {
    const icon = btn.querySelector('.theme-toggle-icon');
    if (icon) icon.textContent = isDark ? '☀️' : '🌙';
    btn.title = isDark ? 'Switch to light theme' : 'Switch to dark theme';
    btn.setAttribute('aria-label', btn.title);
  });
}

function applyTheme(theme, animate) {
  const root = document.documentElement;
  const body = document.body;

  const commit = () => {
    // Enable CSS transitions so every surface fades into the new theme.
    root.classList.add('theme-anim');
    root.dataset.theme = theme;
    try {
      localStorage.setItem('blushchat-theme', theme);
    } catch (e) {}
    updateThemeButtons();
    clearTimeout(root._themeAnimTimer);
    root._themeAnimTimer = setTimeout(() => {
      root.classList.remove('theme-anim');
      body.classList.remove('theme-fading');
    }, 650);
  };

  if (animate) {
    // Fade the page gradient out, swap the theme mid-fade, then let the new
    // gradient fade back in over the freshly-transitioned solid colors.
    body.classList.add('theme-fading');
    setTimeout(commit, 180);
  } else {
    commit();
  }
}

function toggleTheme() {
  const root = document.documentElement;
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next, true);
}

function setupThemeToggle() {
  updateThemeButtons();
  document.querySelectorAll('.theme-toggle').forEach((btn) => {
    btn.addEventListener('click', toggleTheme);
  });
}

// ─── Window unload handler ───────────────────────────────────────────────
// When the user closes the tab/window, the socket disconnects automatically.
// The server listens for the 'disconnect' event and cleans up the user data.
// This is our main cleanup mechanism — no explicit action needed here.
// We add a beforeunload as a safety net:

window.addEventListener('beforeunload', () => {
  // Tab/window closing is deliberate — don't surface "Reconnecting..." toast.
  state.intentionalDisconnect = true;
  if (state.socket) {
    state.socket.disconnect();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', init);
