// sidepanel.js

document.addEventListener('DOMContentLoaded', () => {
  chrome.runtime.connect({ name: "sidepanel" });

  const timersContainer = document.getElementById("timers-container");
  const addTimerBtn = document.getElementById("add-timer-btn");
  const volumeSlider = document.getElementById("volume-slider");

  let editingState = { id: null, type: null };
  let intervalId = null;

  chrome.storage.local.get("volume", ({ volume }) => { if (volume !== undefined) volumeSlider.value = volume; });
  addTimerBtn.addEventListener("click", () => chrome.runtime.sendMessage({ command: "addTimer", data: { minutes: 3 } }));
  volumeSlider.addEventListener("input", (e) => chrome.runtime.sendMessage({ command: "updateVolume", data: { volume: parseInt(e.target.value, 10) } }));
  
  chrome.runtime.onMessage.addListener((request) => {
    if (request.command === "updateTimers") {
      renderTimers(request.data.timers, request.data.finishedTimers);
    }
  });

  function renderTimers(timers, finishedTimers) {
    const finishedIds = new Set((finishedTimers || []).map(t => t.id));
    const hasRunningTimers = Object.values(timers).some(t => t.isRunning);
    if (hasRunningTimers && !intervalId) {
      intervalId = setInterval(requestTimersUpdate, 1000);
    } else if (!hasRunningTimers && intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }

    const sortedIds = Object.keys(timers).sort((a, b) => a.localeCompare(b));
    const existingCards = new Map();
    timersContainer.querySelectorAll('.timer-card').forEach(card => existingCards.set(card.dataset.id, card));
    const renderedIds = new Set();

    for (const id of sortedIds) {
        renderedIds.add(id);
        const timer = timers[id];
        if (editingState.id === id) continue;
        if (existingCards.has(id)) {
            updateCard(existingCards.get(id), timer, finishedIds.has(id));
        } else {
            const newCard = createCard(timer, finishedIds.has(id));
            timersContainer.appendChild(newCard);
        }
    }
    
    existingCards.forEach((card, id) => { if (!renderedIds.has(id)) card.remove(); });
  }
  
  function createCard(timer, isFinished) {
      const card = document.createElement("div");
      card.className = "timer-card";
      card.dataset.id = timer.id;
      updateCard(card, timer, isFinished);
      return card;
  }

  function updateCard(card, timer, isFinished) {
      card.classList.toggle('finished', isFinished);
      const remainingMs = timer.isRunning ? (timer.endTime - Date.now()) : timer.remainingTime;
      const displayTime = formatTime(remainingMs);
      const playPauseClass = isFinished ? 'running' : (timer.isRunning ? 'running' : 'paused');
      card.innerHTML = `
        <div class="timer-name" data-id="${timer.id}">${escapeHTML(timer.name)}</div>
        <button class="delete-timer" data-id="${timer.id}">×</button>
        <div class="timer-display" data-id="${timer.id}">${displayTime}</div>
        <div class="timer-actions">
          <button class="play-pause-btn ${playPauseClass}" data-id="${timer.id}"></button>
        </div>
      `;
      addEventListenersToCard(card, timer, isFinished);
  }

  function addEventListenersToCard(card, timer, isFinished) {
    card.querySelector('.delete-timer').addEventListener('click', (e) => handleDelete(e, timer), { once: true });
    card.querySelector('.play-pause-btn').addEventListener('click', (e) => handlePlayPause(e, timer), { once: true });
    if (!isFinished) {
        card.querySelector('.timer-name').addEventListener('click', handleNameClick, { once: true });
        card.querySelector('.timer-display').addEventListener('click', handleTimeClick, { once: true });
    }
  }

  // ★ handleDelete, handlePlayPauseを修正
  function handleDelete(e, timer) {
    e.stopPropagation();
    chrome.runtime.sendMessage({ command: "deleteTimer", data: { id: timer.id } });
  }

  function handlePlayPause(e, timer) {
    e.stopPropagation();
    const id = timer.id;
    let command;
    if (timer.remainingTime <= 0 && !timer.isRunning) {
        command = "resetTimer";
    } else if (timer.isRunning) {
        command = "pauseTimer";
    } else {
        command = "resumeTimer";
    }
    chrome.runtime.sendMessage({ command, data: { id } });
  }

  // (以降の関数は変更なし)
  function handleNameClick(e) { e.stopPropagation(); makeEditable(e.currentTarget, 'name'); }
  function handleTimeClick(e) { e.stopPropagation(); makeEditable(e.currentTarget, 'time'); }
  function makeEditable(element, type) { const id = element.dataset.id; if (editingState.id) return; editingState = { id, type }; const isTime = type === 'time'; const originalValue = element.textContent; const input = document.createElement('input'); input.type = 'text'; input.className = isTime ? 'timer-display-input' : 'timer-name-input'; input.value = originalValue; if(isTime) input.placeholder = 'HH:MM:SS'; element.replaceWith(input); input.focus(); input.select(); if (isTime) { input.addEventListener('input', formatInputAsTime); } const finishEditing = () => { input.removeEventListener('blur', finishEditing); editingState = { id: null, type: null }; const newValue = input.value; if (isTime) { const timeParts = newValue.split(':').map(Number); let totalSeconds = 0; if (timeParts.length === 3) totalSeconds = timeParts[0] * 3600 + timeParts[1] * 60 + timeParts[2]; else if (timeParts.length === 2) totalSeconds = timeParts[0] * 60 + timeParts[1]; else if (timeParts.length === 1) totalSeconds = timeParts[0]; if (totalSeconds > 0) chrome.runtime.sendMessage({ command: "updateTimerTime", data: { id, totalSeconds } }); else requestTimersUpdate(); } else { const newName = newValue.trim(); if (newName) chrome.runtime.sendMessage({ command: "updateTimerName", data: { id, newName } }); else requestTimersUpdate(); } }; input.addEventListener('blur', finishEditing); input.addEventListener('keydown', e => e.key === 'Enter' && input.blur()); }
  function formatInputAsTime(e) { let value = e.target.value.replace(/[^\d]/g, ''); if (value.length > 6) value = value.substring(0, 6); let formatted = ''; if (value.length > 4) formatted = `${value.slice(0, -4)}:${value.slice(-4, -2)}:${value.slice(-2)}`; else if (value.length > 2) formatted = `${value.slice(0, -2)}:${value.slice(-2)}`; else formatted = value; e.target.value = formatted; }
  function formatTime(ms) { if (ms < 0) ms = 0; const totalSeconds = Math.floor(ms / 1000); const h = Math.floor(totalSeconds / 3600); const m = Math.floor((totalSeconds % 3600) / 60); const s = totalSeconds % 60; if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; }
  function escapeHTML(str) { const p = document.createElement("p"); p.textContent = str; return p.innerHTML; }
  function requestTimersUpdate() { chrome.runtime.sendMessage({ command: "getTimers" }); }
  requestTimersUpdate();
});
