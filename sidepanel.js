// sidepanel.js

document.addEventListener('DOMContentLoaded', () => {
  chrome.runtime.connect({ name: "sidepanel" });

  const timersContainer = document.getElementById("timers-container");
  const alarmsContainer = document.getElementById("alarms-container");
  const addTimerBtn = document.getElementById("add-timer-btn");
  const volumeSlider = document.getElementById("volume-slider");
  const timerModeBtn = document.getElementById("timer-mode-btn");
  const alarmModeBtn = document.getElementById("alarm-mode-btn");
  const timerSection = document.getElementById("timer-section");
  const alarmSection = document.getElementById("alarm-section");
  const nextAlarmMessage = document.getElementById('next-alarm-message');
  
  const finishedSection = document.getElementById('finished-section');
  const finishedList = document.getElementById('finished-timers-list');
  const stopAllBtn = document.getElementById('stop-all-btn');

  let editingState = { id: null, type: null };
  let intervalId = null;
  let currentMode = "timer";
  let allTimers = {};
  let allAlarms = {};

  timerModeBtn.addEventListener("click", () => switchMode("timer"));
  alarmModeBtn.addEventListener("click", () => switchMode("alarm"));

  chrome.storage.local.get("lastActiveMode", ({ lastActiveMode }) => {
    if (lastActiveMode) {
      switchMode(lastActiveMode);
    }
  });

  function switchMode(mode) {
    currentMode = mode;
    chrome.storage.local.set({ lastActiveMode: mode });
    if (mode === "timer") {
      timerModeBtn.classList.add("active");
      alarmModeBtn.classList.remove("active");
      timerSection.style.display = "block";
      alarmSection.style.display = "none";
    } else {
      timerModeBtn.classList.remove("active");
      alarmModeBtn.classList.add("active");
      timerSection.style.display = "none";
      alarmSection.style.display = "block";
    }
    addTimerBtn.style.display = "block";
  }

  chrome.storage.local.get("volume", ({ volume }) => { if (volume !== undefined) volumeSlider.value = volume; });
  addTimerBtn.addEventListener("click", () => {
    if (currentMode === "timer") {
      chrome.runtime.sendMessage({ command: "addTimer", data: { minutes: 3 } });
    } else {
      chrome.runtime.sendMessage({ command: "addAlarm" });
    }
  });
  volumeSlider.addEventListener("input", (e) => chrome.runtime.sendMessage({ command: "updateVolume", data: { volume: parseInt(e.target.value, 10) } }));
  
  // --- Drag and Drop Logic ---
  [timersContainer, alarmsContainer].forEach(container => {
    container.addEventListener('dragover', e => {
        e.preventDefault();
        const afterElement = getDragAfterElement(container, e.clientY);
        const draggable = document.querySelector('.dragging');
        if (draggable) {
            if (afterElement == null) {
                container.appendChild(draggable);
            } else {
                container.insertBefore(draggable, afterElement);
            }
        }
    });
  });

  function getDragAfterElement(container, y) {
      const draggableElements = [...container.querySelectorAll('.timer-card:not(.dragging), .alarm-card:not(.dragging)')];

      return draggableElements.reduce((closest, child) => {
          const box = child.getBoundingClientRect();
          const offset = y - box.top - box.height / 2;
          if (offset < 0 && offset > closest.offset) {
              return { offset: offset, element: child };
          } else {
              return closest;
          }
      }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  function updateOrder(type) {
      const container = type === 'timer' ? timersContainer : alarmsContainer;
      const selector = type === 'timer' ? '.timer-card' : '.alarm-card';
      const cards = container.querySelectorAll(selector);
      const orderIds = Array.from(cards).map(c => c.dataset.id);
      chrome.runtime.sendMessage({ command: "reorderItems", data: { type, orderIds } });
  }
  // ---------------------------

  chrome.runtime.onMessage.addListener((request) => {
    if (request.command === "updateData") {
      const { timers, alarms, finishedTimers } = request.data;
      allTimers = timers || {};
      allAlarms = alarms || {};
      renderTimers(allTimers, finishedTimers);
      renderAlarms(allAlarms, finishedTimers);
      renderFinishedTimers(finishedTimers);
      updateNextAlarmMessage();
      updateNextTimerMessage();
      updateInterval();
    }
  });

  function updateInterval() {
    const hasRunningTimers = Object.values(allTimers).some(t => t.isRunning);
    const hasActiveAlarms = Object.values(allAlarms).some(a => a.isActive);

    if ((hasRunningTimers || hasActiveAlarms) && !intervalId) {
        intervalId = setInterval(updateDynamicDisplays, 1000);
    } else if (!(hasRunningTimers || hasActiveAlarms) && intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
  }

  function updateDynamicDisplays() {
      document.querySelectorAll('.timer-card').forEach(card => {
          const timerId = card.dataset.id;
          const timer = allTimers[timerId];
          if (timer && timer.isRunning) {
              const display = card.querySelector('.timer-display');
              if (display) {
                  const remainingMs = timer.endTime - Date.now();
                  display.textContent = formatTime(remainingMs);
              }
          }
      });
      updateNextAlarmMessage();
      updateNextTimerMessage();
  }

  function updateNextAlarmMessage() {
    const nextAlarmMessage = document.getElementById('next-alarm-message');
    const now = new Date();
    let nextAlarm = null;
    let minTimeDiff = Infinity;

    Object.values(allAlarms).forEach(alarm => {
        if (alarm.isActive) {
            const [hours, minutes] = alarm.time.split(':').map(Number);
            const alarmTime = new Date();
            alarmTime.setHours(hours, minutes, 0, 0);

            if (alarmTime < now) {
                alarmTime.setDate(alarmTime.getDate() + 1);
            }

            const timeDiff = alarmTime.getTime() - now.getTime();
            if (timeDiff > 0 && timeDiff < minTimeDiff) {
                minTimeDiff = timeDiff;
                nextAlarm = alarm;
            }
        }
    });

    if (nextAlarm) {
        const totalMinutes = Math.ceil(minTimeDiff / (1000 * 60));
        const h = Math.floor(totalMinutes / 60);
        const m = totalMinutes % 60;

        let timeString = '';
        if (h > 0) {
            timeString += `${h}時間`;
        }
        if (m > 0) {
            timeString += `${m}分`;
        }
        
        if (timeString === '') {
            timeString = '1分未満';
        }

        nextAlarmMessage.innerHTML = `
          <div class="next-alarm-name">${escapeHTML(nextAlarm.name)}</div>
          <div class="next-alarm-time">${timeString}後に設定されています。</div>
        `;
        nextAlarmMessage.classList.add('visible');
    } else {
        nextAlarmMessage.classList.remove('visible');
    }
  }

  function updateNextTimerMessage() {
    const nextTimerMessage = document.getElementById('next-timer-message');
    const now = Date.now();
    let nextTimer = null;
    let minRemaining = Infinity;

    Object.values(allTimers).forEach(timer => {
        if (timer.isRunning) {
            const remaining = timer.endTime - now;
            if (remaining > 0 && remaining < minRemaining) {
                minRemaining = remaining;
                nextTimer = timer;
            }
        }
    });

    if (nextTimer) {
        const remainingMs = nextTimer.endTime - now;
        const timeString = formatTime(remainingMs); // Use existing formatTime helper

        nextTimerMessage.innerHTML = `
          <div class="next-timer-name">${escapeHTML(nextTimer.name)}</div>
          <div class="next-timer-time">残り ${timeString}</div>
        `;
        nextTimerMessage.classList.add('visible');
    } else {
        nextTimerMessage.classList.remove('visible');
    }
  }

  function renderAlarms(alarms, finishedTimers) {
    const finishedIds = new Set((finishedTimers || []).map(t => t.id));
    const existingCards = new Map();
    alarmsContainer.querySelectorAll('.alarm-card').forEach(card => existingCards.set(card.dataset.id, card));
    const renderedIds = new Set();

    const sortedIds = Object.keys(alarms).sort((a, b) => {
        const orderA = alarms[a].order !== undefined ? alarms[a].order : Infinity;
        const orderB = alarms[b].order !== undefined ? alarms[b].order : Infinity;
        if (orderA !== orderB) return orderA - orderB;
        return a.localeCompare(b);
    });

    for (const id of sortedIds) {
        renderedIds.add(id);
        const alarm = alarms[id];
        const isFinished = finishedIds.has(id);
        if (editingState.id === id) continue;
        if (existingCards.has(id)) {
            // Re-append to ensure DOM order matches sorted order
            alarmsContainer.appendChild(existingCards.get(id));
            updateAlarmCard(existingCards.get(id), alarm, isFinished);
        } else {
            const newCard = createAlarmCard(alarm, isFinished);
            alarmsContainer.appendChild(newCard);
        }
    }
    
    existingCards.forEach((card, id) => { if (!renderedIds.has(id)) card.remove(); });
  }

  function createAlarmCard(alarm, isFinished) {
      const card = document.createElement("div");
      card.className = "alarm-card";
      card.dataset.id = alarm.id;
      card.draggable = true;
      card.addEventListener('dragstart', () => { card.classList.add('dragging'); });
      card.addEventListener('dragend', () => { card.classList.remove('dragging'); updateOrder('alarm'); });
      updateAlarmCard(card, alarm, isFinished);
      return card;
  }

  function updateAlarmCard(card, alarm, isFinished) {
      card.classList.toggle('active', alarm.isActive);
      card.classList.toggle('finished', isFinished);
      card.innerHTML = `
        <div class="timer-name" data-id="${alarm.id}">${escapeHTML(alarm.name)}</div>
        <button class="delete-timer" data-id="${alarm.id}">×</button>
        <div class="timer-display" data-id="${alarm.id}">${alarm.time}</div>
        <div class="timer-actions">
          <label class="toggle-switch">
            <input type="checkbox" class="alarm-toggle" data-id="${alarm.id}" ${alarm.isActive ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
      `;
      addEventListenersToAlarmCard(card, alarm, isFinished);
  }

  function addEventListenersToAlarmCard(card, alarm, isFinished) {
    card.querySelector('.delete-timer').addEventListener('click', (e) => {
        e.stopPropagation();
        chrome.runtime.sendMessage({ command: "deleteAlarm", data: { id: alarm.id } });
    }, { once: true });

    card.querySelector('.alarm-toggle').addEventListener('change', (e) => {
        e.stopPropagation();
        if (isFinished) {
            chrome.runtime.sendMessage({ command: "resetFinishedAlarm", data: { id: alarm.id } });
        } else {
            chrome.runtime.sendMessage({ command: "toggleAlarm", data: { id: alarm.id, isActive: e.target.checked } });
        }
    }, { once: true });

    if (!isFinished) {
        card.querySelector('.timer-name').addEventListener('click', (e) => {
            e.stopPropagation();
            makeEditable(e.currentTarget, 'alarm-name');
        }, { once: true });

        card.querySelector('.timer-display').addEventListener('click', (e) => {
            e.stopPropagation();
            makeEditable(e.currentTarget, 'alarm-time');
        }, { once: true });
    }
  }

  function renderTimers(timers, finishedTimers) {
    const finishedIds = new Set((finishedTimers || []).map(t => t.id));
    const sortedIds = Object.keys(timers).sort((a, b) => {
        const orderA = timers[a].order !== undefined ? timers[a].order : Infinity;
        const orderB = timers[b].order !== undefined ? timers[b].order : Infinity;
        if (orderA !== orderB) return orderA - orderB;
        return a.localeCompare(b);
    });
    const existingCards = new Map();
    timersContainer.querySelectorAll('.timer-card').forEach(card => existingCards.set(card.dataset.id, card));
    const renderedIds = new Set();

    for (const id of sortedIds) {
        renderedIds.add(id);
        const timer = timers[id];
        if (editingState.id === id) continue;
        if (existingCards.has(id)) {
            timersContainer.appendChild(existingCards.get(id)); // Re-append for sorting
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
      card.draggable = true;
      card.addEventListener('dragstart', () => { card.classList.add('dragging'); });
      card.addEventListener('dragend', () => { card.classList.remove('dragging'); updateOrder('timer'); });
      updateCard(card, timer, isFinished);
      return card;
  }

  function updateCard(card, timer, isFinished) {
      card.classList.toggle('finished', isFinished);
      card.classList.toggle('active', timer.isRunning);
      const remainingMs = timer.isRunning ? (timer.endTime - Date.now()) : timer.remainingTime;
      const displayTime = formatTime(remainingMs);
      const playPauseClass = isFinished ? 'running' : (timer.isRunning ? 'running' : 'paused');
      
      const isInitialState = !timer.isRunning && timer.remainingTime === timer.originalDuration;
      const showReset = !isFinished && !isInitialState;
      const resetBtnHtml = showReset ? `<button class="reset-btn" data-id="${timer.id}" title="リセット"></button>` : '';

      card.innerHTML = `
        <div class="timer-name" data-id="${timer.id}">${escapeHTML(timer.name)}</div>
        <button class="delete-timer" data-id="${timer.id}">×</button>
        <div class="timer-display" data-id="${timer.id}">${displayTime}</div>
        <div class="timer-actions">
          ${resetBtnHtml}
          <button class="play-pause-btn ${playPauseClass}" data-id="${timer.id}"></button>
        </div>
      `;
      addEventListenersToCard(card, timer, isFinished);
  }

  function addEventListenersToCard(card, timer, isFinished) {
    card.querySelector('.delete-timer').addEventListener('click', (e) => handleDelete(e, timer), { once: true });
    card.querySelector('.play-pause-btn').addEventListener('click', (e) => handlePlayPause(e, timer), { once: true });
    const resetBtn = card.querySelector('.reset-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', (e) => handleReset(e, timer), { once: true });
    }
    if (!isFinished) {
        card.querySelector('.timer-name').addEventListener('click', handleNameClick, { once: true });
        card.querySelector('.timer-display').addEventListener('click', handleTimeClick, { once: true });
    }
  }

  function handleDelete(e, timer) {
    e.stopPropagation();
    chrome.runtime.sendMessage({ command: "deleteTimer", data: { id: timer.id } });
  }

  function handleReset(e, timer) {
    e.stopPropagation();
    chrome.runtime.sendMessage({ command: "resetTimer", data: { id: timer.id } });
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

  function handleNameClick(e) { e.stopPropagation(); makeEditable(e.currentTarget, 'name'); }
  function handleTimeClick(e) { e.stopPropagation(); makeEditable(e.currentTarget, 'time'); }
  function makeEditable(element, type) { 
    const id = element.dataset.id; 
    if (editingState.id) return; 
    editingState = { id, type }; 
    const isTime = type === 'time' || type === 'alarm-time';
    const originalValue = element.textContent; 
    const input = document.createElement('input'); 
    input.type = 'text'; 
    input.className = isTime ? 'timer-display-input' : 'timer-name-input'; 
    input.value = originalValue; 
    if(isTime) input.placeholder = 'HH:MM'; 
    element.replaceWith(input); 
    input.focus(); 
    input.select(); 
    if (isTime) { 
        input.addEventListener('input', formatInputAsTime); 
        input.addEventListener('compositionend', formatInputAsTime);
    } 
    const finishEditing = () => { 
        input.removeEventListener('blur', finishEditing); 
        editingState = { id: null, type: null }; 
        const newValue = input.value; 
        if (type === 'time') { 
            const timeParts = newValue.split(':').map(Number); 
            let totalSeconds = 0; 
            if (timeParts.length === 3) totalSeconds = timeParts[0] * 3600 + timeParts[1] * 60 + timeParts[2]; 
            else if (timeParts.length === 2) totalSeconds = timeParts[0] * 60 + timeParts[1]; 
            else if (timeParts.length === 1) totalSeconds = timeParts[0]; 
            if (totalSeconds > 0) chrome.runtime.sendMessage({ command: "updateTimerTime", data: { id, totalSeconds } }); 
            else requestDataUpdate(); 
        } else if (type === 'alarm-time') {
            const timeParts = newValue.split(':').map(Number);
            if (timeParts.length === 2 && timeParts[0] >= 0 && timeParts[0] < 24 && timeParts[1] >= 0 && timeParts[1] < 60) {
                const formattedTime = `${String(timeParts[0]).padStart(2, '0')}:${String(timeParts[1]).padStart(2, '0')}`;
                chrome.runtime.sendMessage({ command: "updateAlarmTime", data: { id, time: formattedTime } });
            } else {
                requestDataUpdate();
            }
        } else if (type === 'name') { 
            const newName = newValue.trim(); 
            if (newName) chrome.runtime.sendMessage({ command: "updateTimerName", data: { id, newName } }); 
            else requestDataUpdate(); 
        } else if (type === 'alarm-name') {
            const newName = newValue.trim();
            if (newName) chrome.runtime.sendMessage({ command: "updateAlarmName", data: { id, newName } });
            else requestDataUpdate();
        }
    }; 
    input.addEventListener('blur', finishEditing); 
    input.addEventListener('keydown', e => e.key === 'Enter' && input.blur()); 
  }
  function formatInputAsTime(e) { 
    if (e.isComposing) return;
    let value = e.target.value;
    value = value.replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
    value = value.replace(/[^\d]/g, '');
    const isAlarm = editingState.type === 'alarm-time';
    const maxLength = isAlarm ? 4 : 6;
    if (value.length > maxLength) value = value.substring(0, maxLength); 
    
    let formatted = ''; 
    if (isAlarm) {
        if (value.length > 2) formatted = `${value.slice(0, -2)}:${value.slice(-2)}`;
        else formatted = value;
    } else {
        if (value.length > 4) formatted = `${value.slice(0, -4)}:${value.slice(-4, -2)}:${value.slice(-2)}`; 
        else if (value.length > 2) formatted = `${value.slice(0, -2)}:${value.slice(-2)}`; 
        else formatted = value; 
    }
    e.target.value = formatted; 
  }
  function formatTime(ms) { if (ms < 0) ms = 0; const totalSeconds = Math.floor(ms / 1000); const h = Math.floor(totalSeconds / 3600); const m = Math.floor((totalSeconds % 3600) / 60); const s = totalSeconds % 60; if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; }
  function escapeHTML(str) { const p = document.createElement("p"); p.textContent = str; return p.innerHTML; }
  function requestDataUpdate() { chrome.runtime.sendMessage({ command: "getTimers" }); }
  
  function renderFinishedTimers(items) {
    if (!finishedList) return;
    finishedList.innerHTML = '';
    if (items && items.length > 0) {
        items.forEach(item => {
            const li = document.createElement('li');
            li.textContent = item.type === 'timer' 
                ? `タイマー「${escapeHTML(item.name)}」が終了しました`
                : `アラーム「${escapeHTML(item.name)}」の時間です`;
            finishedList.appendChild(li);
        });
        finishedSection.style.display = 'block';
    } else {
        finishedSection.style.display = 'none';
    }
  }

  if (stopAllBtn) {
    stopAllBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ command: "resetFinishedItems" });
    });
  }

  requestDataUpdate();
});