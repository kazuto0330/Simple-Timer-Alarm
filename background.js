// background.js

let isSidePanelOpen = false;
chrome.runtime.onInstalled.addListener((details) => { if (details.reason === 'install') { chrome.storage.local.set({ timers: {}, alarms: {}, volume: 50, finishedTimers: [] }); addTimer({ minutes: 3 }); } });
chrome.action.onClicked.addListener((tab) => { chrome.sidePanel.open({ windowId: tab.windowId }); });
chrome.runtime.onConnect.addListener((port) => { if (port.name === "sidepanel") { isSidePanelOpen = true; port.onDisconnect.addListener(() => { isSidePanelOpen = false; }); } });

// --- メッセージング ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { command, data } = request;
  const actions = {
    addTimer, deleteTimer, updateTimerTime, updateTimerName, pauseTimer, resumeTimer, resetTimer,
    getTimers: sendDataToSidePanel,
    updateVolume,
    getFinishedItems: async (d, r) => {
        const { finishedTimers, finishedAlarms } = await chrome.storage.local.get(['finishedTimers', 'finishedAlarms']);
        r({ success: true, data: [...(finishedTimers || []), ...(finishedAlarms || [])] });
    },
    resetFinishedItems,
    stopSoundOnly,
    addAlarm, deleteAlarm, updateAlarmTime, updateAlarmName, toggleAlarm,
    resetFinishedAlarm,
    reorderItems,
  };
  if (actions[command]) {
    actions[command](data, sendResponse);
    return true;
  }
  sendResponse({ success: false, message: "Unknown command" });
  return true;
});

const onFocusChanged = async (windowId) => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) {
        try {
            const { finishedTimers, finishedAlarms } = await chrome.storage.local.get(["finishedTimers", "finishedAlarms"]);
            const hasFinishedItems = (finishedTimers && finishedTimers.length > 0) || (finishedAlarms && finishedAlarms.length > 0);

            if (hasFinishedItems) {
                await chrome.action.setPopup({ popup: 'popup.html' });
                await chrome.action.openPopup();

                await chrome.action.setBadgeText({ text: '' });
                chrome.windows.onFocusChanged.removeListener(onFocusChanged);
            } else {
                chrome.windows.onFocusChanged.removeListener(onFocusChanged);
            }
        } catch (e) {
            console.error("onFocusChanged: ポップアップの再表示に失敗しました。", e);
            chrome.windows.onFocusChanged.removeListener(onFocusChanged);
        }
    }
};

async function clearFinishedState() {
    stopSound();
    await chrome.action.setPopup({ popup: '' });
    await chrome.action.setBadgeText({ text: '' });
    if (chrome.windows.onFocusChanged.hasListener(onFocusChanged)) {
        chrome.windows.onFocusChanged.removeListener(onFocusChanged);
    }
}

// --- アラーム操作 ---
function addAlarm() {
  chrome.storage.local.get("alarms", ({ alarms = {} }) => {
    const newId = `alarm_${Date.now()}`;
    const alarmCount = Object.keys(alarms).length;
    let maxOrder = 0;
    Object.values(alarms).forEach(a => { if(a.order && a.order > maxOrder) maxOrder = a.order; });

    alarms[newId] = {
      id: newId,
      name: `アラーム ${alarmCount + 1}`,
      time: "00:00",
      isActive: false,
      order: maxOrder + 1,
    };
    chrome.storage.local.set({ alarms }, sendDataToSidePanel);
  });
}

async function deleteAlarm({ id }) {
  const { alarms, finishedAlarms } = await chrome.storage.local.get(["alarms", "finishedAlarms"]);
  delete alarms[id];
  const updatedFinished = (finishedAlarms || []).filter(t => t.id !== id);
  
  await chrome.storage.local.set({ alarms, finishedAlarms: updatedFinished });
  sendDataToSidePanel();
  chrome.alarms.clear(id);

  const { finishedTimers } = await chrome.storage.local.get(["finishedTimers"]);
  if (updatedFinished.length === 0 && (finishedAlarms || []).length > 0 && (finishedTimers || []).length === 0) {
    await clearFinishedState();
  }
}

function updateAlarmTime({ id, time }) {
    chrome.storage.local.get("alarms", ({ alarms = {} }) => {
        if (alarms[id]) {
            alarms[id].time = time;
            chrome.storage.local.set({ alarms }, () => {
                if (alarms[id].isActive) {
                    toggleAlarm({ id, isActive: true });
                } else {
                    sendDataToSidePanel();
                }
            });
        }
    });
}

function updateAlarmName({ id, newName }) {
  chrome.storage.local.get("alarms", ({ alarms = {} }) => {
    if (alarms[id]) {
      alarms[id].name = newName;
      chrome.storage.local.set({ alarms }, sendDataToSidePanel);
    }
  });
}

function toggleAlarm({ id, isActive }) {
    chrome.storage.local.get("alarms", ({ alarms = {} }) => {
        const alarm = alarms[id];
        if (alarm) {
            alarm.isActive = isActive;
            chrome.storage.local.set({ alarms }, sendDataToSidePanel);

            chrome.alarms.clear(id); 

            if (isActive) {
                const [hours, minutes] = alarm.time.split(':').map(Number);
                const now = new Date();
                const alarmTime = new Date();
                alarmTime.setHours(hours, minutes, 0, 0);

                if (alarmTime < now) {
                    alarmTime.setDate(alarmTime.getDate() + 1);
                }
                
                chrome.alarms.create(id, {
                    when: alarmTime.getTime(),
                    periodInMinutes: 24 * 60
                });
            }
        }
    });
}

// --- タイマー操作 ---
async function deleteTimer({ id }) {
  const { timers, finishedTimers } = await chrome.storage.local.get(["timers", "finishedTimers"]);
  delete timers[id];
  const updatedFinished = (finishedTimers || []).filter(t => t.id !== id);
  await chrome.storage.local.set({ timers, finishedTimers: updatedFinished });
  sendDataToSidePanel();
  chrome.alarms.clear(id);

  const { finishedAlarms } = await chrome.storage.local.get(["finishedAlarms"]);
  if (updatedFinished.length === 0 && (finishedTimers || []).length > 0 && (finishedAlarms || []).length === 0) {
    await clearFinishedState();
  }
}

async function resetTimer({ id }) {
    const { timers, finishedTimers } = await chrome.storage.local.get(["timers", "finishedTimers"]);
    if (timers[id]) {
        timers[id].remainingTime = timers[id].originalDuration;
        timers[id].isRunning = false;
        timers[id].endTime = null;
        chrome.alarms.clear(id);
        const updatedFinished = (finishedTimers || []).filter(t => t.id !== id);
        await chrome.storage.local.set({ timers, finishedTimers: updatedFinished });
        sendDataToSidePanel();
        
        const { finishedAlarms } = await chrome.storage.local.get(["finishedAlarms"]);
        if (updatedFinished.length === 0 && (finishedTimers || []).length > 0 && (finishedAlarms || []).length === 0) {
            await clearFinishedState();
        }
    }
}

// --- アラームハンドラ ---
chrome.alarms.onAlarm.addListener(async (alarm) => {
    const { timers, alarms, volume, finishedTimers, finishedAlarms } = await chrome.storage.local.get(["timers", "alarms", "volume", "finishedTimers", "finishedAlarms"]);
    
    let finishedItem = null;
    let storageUpdates = {};
    let newFinishedList;

    if (alarm.name.startsWith('timer_')) {
        const timer = timers[alarm.name];
        if (timer) {
            timer.isRunning = false;
            timer.remainingTime = 0;
            timer.endTime = null;
            finishedItem = { id: timer.id, name: timer.name, type: 'timer' };
            storageUpdates.timers = timers;
            const currentFinished = finishedTimers || [];
            newFinishedList = [...currentFinished.filter(t => t.id !== finishedItem.id), finishedItem];
            storageUpdates.finishedTimers = newFinishedList;
        }
    } else if (alarm.name.startsWith('alarm_')) {
        const userAlarm = alarms[alarm.name];
        if (userAlarm && userAlarm.isActive) {
            finishedItem = { id: userAlarm.id, name: userAlarm.name, type: 'alarm' };
            const currentFinished = finishedAlarms || [];
            newFinishedList = [...currentFinished.filter(t => t.id !== finishedItem.id), finishedItem];
            storageUpdates.finishedAlarms = newFinishedList;
        }
    }

    if (finishedItem) {
        const allFinishedItems = [...(finishedTimers || []), ...(finishedAlarms || [])];
        const isAlarm = finishedItem.type === 'alarm';
        if (allFinishedItems.length === 0) { // Play sound only if this is the first finished item
            playSound(volume, isAlarm);
        }
        
        await chrome.storage.local.set(storageUpdates);
        
        const combinedFinishedList = [...(storageUpdates.finishedTimers || finishedTimers || []), ...(storageUpdates.finishedAlarms || finishedAlarms || [])];

        sendDataToSidePanel();
        chrome.runtime.sendMessage({ command: "updateFinishedList", data: combinedFinishedList }).catch(e=>{});

        try {
            await chrome.action.setPopup({ popup: 'popup.html' });
            await chrome.action.openPopup();
        } catch (e) {
            if (e.message.includes("Could not find an active browser window")) {
                console.log("アクティブなウィンドウがないためポップアップを開けませんでした。フォーカス時に再試行します。");
                await chrome.action.setBadgeText({ text: '!' });
                await chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });

                if (!chrome.windows.onFocusChanged.hasListener(onFocusChanged)) {
                    chrome.windows.onFocusChanged.addListener(onFocusChanged);
                }
            } else {
                console.error("ポップアップを開けませんでした:", e);
            }
        }
    }
});


// --- ポップアップと音声関連 ---
async function resetFinishedTimers() {
    const { finishedTimers, timers, alarms } = await chrome.storage.local.get(["finishedTimers", "timers", "alarms"]);
    if (finishedTimers && finishedTimers.length > 0) {
        finishedTimers.forEach(finished => {
            if (finished.type === 'timer' && timers[finished.id]) {
                timers[finished.id].remainingTime = timers[finished.id].originalDuration;
            } else if (finished.type === 'alarm' && alarms[finished.id]) {
                alarms[finished.id].isActive = false;
                chrome.alarms.clear(finished.id);
            }
        });
        await chrome.storage.local.set({ timers, alarms, finishedTimers: [] });
        sendDataToSidePanel();
    }
    await clearFinishedState();
}

async function resetFinishedItems() {
    const { finishedTimers, finishedAlarms, timers, alarms } = await chrome.storage.local.get(["finishedTimers", "finishedAlarms", "timers", "alarms"]);
    
    if ((finishedTimers && finishedTimers.length > 0) || (finishedAlarms && finishedAlarms.length > 0)) {
        (finishedTimers || []).forEach(finished => {
            if (timers[finished.id]) {
                timers[finished.id].remainingTime = timers[finished.id].originalDuration;
            }
        });
        (finishedAlarms || []).forEach(finished => {
            if (alarms[finished.id]) {
                alarms[finished.id].isActive = false;
                chrome.alarms.clear(finished.id);
            }
        });

        await chrome.storage.local.set({ timers, alarms, finishedTimers: [], finishedAlarms: [] });
        sendDataToSidePanel();
    }
    await clearFinishedState();
}

async function stopSoundOnly() {
    const { finishedTimers, finishedAlarms, timers, alarms } = await chrome.storage.local.get(["finishedTimers", "finishedAlarms", "timers", "alarms"]);
    
    if ((finishedTimers && finishedTimers.length > 0) || (finishedAlarms && finishedAlarms.length > 0)) {
        (finishedTimers || []).forEach(finished => {
            if (finished.type === 'timer' && timers[finished.id]) {
                timers[finished.id].remainingTime = timers[finished.id].originalDuration;
            }
        });
        // アラームの場合は isActive を false にせず、chrome.alarms もクリアしない
        // これにより、繰り返し設定されているアラームは維持される

        await chrome.storage.local.set({ timers, finishedTimers: [], finishedAlarms: [] });
        sendDataToSidePanel();
    }
    await clearFinishedState();
}

async function resetFinishedAlarm({ id }) {
    const { finishedAlarms, alarms } = await chrome.storage.local.get(["finishedAlarms", "alarms"]);
    const updatedFinished = (finishedAlarms || []).filter(t => t.id !== id);

    if (alarms && alarms[id]) {
        alarms[id].isActive = false;
        chrome.alarms.clear(id);
    }

    await chrome.storage.local.set({ finishedAlarms: updatedFinished, alarms });
    sendDataToSidePanel();

    const { finishedTimers } = await chrome.storage.local.get(["finishedTimers"]);
    if (updatedFinished.length === 0 && (finishedAlarms || []).length > 0 && (finishedTimers || []).length === 0) {
        await clearFinishedState();
    }
}

function reorderItems({ type, orderIds }) {
    const storageKey = type === 'timer' ? 'timers' : 'alarms';
    chrome.storage.local.get(storageKey, (itemsWrapper) => {
        const items = itemsWrapper[storageKey];
        if (!items) return;
        
        orderIds.forEach((id, index) => {
            if (items[id]) {
                items[id].order = index;
            }
        });
        
        chrome.storage.local.set({ [storageKey]: items }, sendDataToSidePanel);
    });
}

function sendDataToSidePanel() {
  chrome.storage.local.get(["timers", "alarms", "finishedTimers", "finishedAlarms"], ({ timers, alarms, finishedTimers, finishedAlarms }) => {
    const combinedFinished = [...(finishedTimers || []), ...(finishedAlarms || [])];
    chrome.runtime.sendMessage({ command: "updateData", data: { timers: timers || {}, alarms: alarms || {}, finishedTimers: combinedFinished } })
    .catch(e => { if (!e.message.includes("Receiving end does not exist")) console.error(e); });
  });
}

function addTimer(data) {
    chrome.storage.local.get("timers", ({ timers = {} }) => {
        const newId = `timer_${Date.now()}`;
        const timerCount = Object.keys(timers).length;
        let maxOrder = 0;
        Object.values(timers).forEach(t => { if(t.order && t.order > maxOrder) maxOrder = t.order; });

        const durationMs = (data.minutes || 3) * 60 * 1000;
        timers[newId] = {
            id: newId,
            name: `タイマー ${timerCount + 1}`,
            originalDuration: durationMs,
            remainingTime: durationMs,
            isRunning: false,
            endTime: null,
            order: maxOrder + 1
        };
        chrome.storage.local.set({ timers }, sendDataToSidePanel);
    });
}
function updateTimerTime({ id, totalSeconds }) { chrome.storage.local.get("timers", ({ timers = {} }) => { if (!timers[id]) return; const durationMs = totalSeconds * 1000; timers[id].originalDuration = durationMs; if (timers[id].isRunning) { const newEndTime = Date.now() + durationMs; timers[id].endTime = newEndTime; chrome.alarms.create(id, { when: newEndTime }); } else { timers[id].remainingTime = durationMs; } chrome.storage.local.set({ timers }, sendDataToSidePanel); }); }
function updateTimerName({ id, newName }) { chrome.storage.local.get("timers", ({ timers = {} }) => { if (timers[id]) { timers[id].name = newName; chrome.storage.local.set({ timers }, sendDataToSidePanel); } }); }
function pauseTimer({ id }) { chrome.storage.local.get("timers", ({ timers = {} }) => { const timer = timers[id]; if (timer && timer.isRunning) { const remaining = timer.endTime - Date.now(); timer.remainingTime = remaining > 0 ? remaining : 0; timer.isRunning = false; timer.endTime = null; chrome.alarms.clear(id); chrome.storage.local.set({ timers }, sendDataToSidePanel); } }); }
function resumeTimer({ id }) { chrome.storage.local.get("timers", ({ timers = {} }) => { const timer = timers[id]; if (timer && !timer.isRunning) { const newEndTime = Date.now() + timer.remainingTime; timer.endTime = newEndTime; timer.isRunning = true; chrome.alarms.create(id, { when: newEndTime }); chrome.storage.local.set({ timers }, sendDataToSidePanel); } }); }
function stopSound() { chrome.runtime.sendMessage({ command: 'stopSound' }).catch(e=>{}); }
function updateVolume({ volume }) { chrome.storage.local.set({ volume }); }
async function playSound(volume, loop = false) {
    const source = 'sounds/default.mp3';
    const offscreenData = { command: 'playSound', source, volume, loop };
    if (await chrome.offscreen.hasDocument()) {
        chrome.runtime.sendMessage(offscreenData).catch(e=>{});
        return;
    }
    await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'タイマー終了を通知するため',
    });
    setTimeout(() => {
        chrome.runtime.sendMessage(offscreenData).catch(e=>{});
    }, 100);
}