// background.js

// (ファイルの先頭部分は変更なしのため省略)
let isSidePanelOpen = false;
chrome.runtime.onInstalled.addListener((details) => { if (details.reason === 'install') { chrome.storage.local.set({ timers: {}, volume: 50, finishedTimers: [] }); addTimer({ minutes: 3 }); } });
chrome.action.onClicked.addListener((tab) => { chrome.sidePanel.open({ windowId: tab.windowId }); });
chrome.runtime.onConnect.addListener((port) => { if (port.name === "sidepanel") { isSidePanelOpen = true; port.onDisconnect.addListener(() => { isSidePanelOpen = false; }); } });

// --- メッセージング ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { command, data } = request;
  const actions = {
    addTimer, deleteTimer, updateTimerTime, updateTimerName, pauseTimer, resumeTimer, resetTimer,
    getTimers: sendTimersToSidePanel,
    updateVolume,
    getFinishedTimers: (d, r) => chrome.storage.local.get('finishedTimers', (res) => r({ success: true, data: res.finishedTimers })),
    resetFinishedTimers,
  };
  if (actions[command]) {
    actions[command](data, sendResponse);
    return true;
  }
  sendResponse({ success: false, message: "Unknown command" });
  return true;
});

// --- タイマー操作 ---
async function deleteTimer({ id }) {
  const { timers, finishedTimers } = await chrome.storage.local.get(["timers", "finishedTimers"]);
  delete timers[id];
  const updatedFinished = (finishedTimers || []).filter(t => t.id !== id);
  await chrome.storage.local.set({ timers, finishedTimers: updatedFinished });
  sendTimersToSidePanel();
  chrome.alarms.clear(id);
  if (updatedFinished.length === 0) {
    stopSound();
  }
}

async function resetTimer({ id }) {
    const { timers, finishedTimers } = await chrome.storage.local.get(["timers", "finishedTimers"]);
    if (timers[id]) {
        timers[id].remainingTime = timers[id].originalDuration;
        timers[id].isRunning = false;
        timers[id].endTime = null;
        const updatedFinished = (finishedTimers || []).filter(t => t.id !== id);
        await chrome.storage.local.set({ timers, finishedTimers: updatedFinished });
        sendTimersToSidePanel();
        if (updatedFinished.length === 0) {
            stopSound();
        }
    }
}

// --- アラームハンドラ ---
chrome.alarms.onAlarm.addListener(async (alarm) => {
  const { timers, volume, finishedTimers } = await chrome.storage.local.get(["timers", "volume", "finishedTimers"]);
  const timer = timers[alarm.name];
  if (timer) {
    timer.isRunning = false;
    timer.remainingTime = 0;
    timer.endTime = null;

    if ((finishedTimers || []).length === 0) {
        playSound(volume);
    }
    
    const newFinishedList = [...(finishedTimers || []).filter(t => t.id !== timer.id), { id: timer.id, name: timer.name }];
    await chrome.storage.local.set({ timers, finishedTimers: newFinishedList });
    sendTimersToSidePanel();
    chrome.runtime.sendMessage({ command: "updateFinishedList", data: newFinishedList }).catch(e=>{});

    if (!isSidePanelOpen) {
        await chrome.action.setPopup({ popup: 'popup.html' });
        chrome.action.openPopup();
    }
  }
});

// --- ポップアップと音声関連 ---
async function resetFinishedTimers() {
    const { finishedTimers, timers } = await chrome.storage.local.get(["finishedTimers", "timers"]);
    if (finishedTimers && finishedTimers.length > 0) {
        finishedTimers.forEach(finished => {
            if (timers[finished.id]) {
                timers[finished.id].remainingTime = timers[finished.id].originalDuration;
            }
        });
        await chrome.storage.local.set({ timers, finishedTimers: [] });
        sendTimersToSidePanel();
        stopSound();
    }
    await chrome.action.setPopup({ popup: '' });
}

function sendTimersToSidePanel() {
  chrome.storage.local.get(["timers", "finishedTimers"], ({ timers, finishedTimers }) => {
    chrome.runtime.sendMessage({ command: "updateTimers", data: { timers: timers || {}, finishedTimers: finishedTimers || [] } })
    .catch(e => { if (!e.message.includes("Receiving end does not exist")) console.error(e); });
  });
}

// (省略された関数は変更なし)
function addTimer(data) { chrome.storage.local.get("timers", ({ timers = {} }) => { const newId = `timer_${Date.now()}`; const timerCount = Object.keys(timers).length; const durationMs = (data.minutes || 3) * 60 * 1000; timers[newId] = { id: newId, name: `タイマー ${timerCount + 1}`, originalDuration: durationMs, remainingTime: durationMs, isRunning: false, endTime: null, }; chrome.storage.local.set({ timers }, sendTimersToSidePanel); }); }
function updateTimerTime({ id, totalSeconds }) { chrome.storage.local.get("timers", ({ timers = {} }) => { if (!timers[id]) return; const durationMs = totalSeconds * 1000; timers[id].originalDuration = durationMs; if (timers[id].isRunning) { const newEndTime = Date.now() + durationMs; timers[id].endTime = newEndTime; chrome.alarms.create(id, { when: newEndTime }); } else { timers[id].remainingTime = durationMs; } chrome.storage.local.set({ timers }, sendTimersToSidePanel); }); }
function updateTimerName({ id, newName }) { chrome.storage.local.get("timers", ({ timers = {} }) => { if (timers[id]) { timers[id].name = newName; chrome.storage.local.set({ timers }, sendTimersToSidePanel); } }); }
function pauseTimer({ id }) { chrome.storage.local.get("timers", ({ timers = {} }) => { const timer = timers[id]; if (timer && timer.isRunning) { const remaining = timer.endTime - Date.now(); timer.remainingTime = remaining > 0 ? remaining : 0; timer.isRunning = false; timer.endTime = null; chrome.alarms.clear(id); chrome.storage.local.set({ timers }, sendTimersToSidePanel); } }); }
function resumeTimer({ id }) { chrome.storage.local.get("timers", ({ timers = {} }) => { const timer = timers[id]; if (timer && !timer.isRunning) { const newEndTime = Date.now() + timer.remainingTime; timer.endTime = newEndTime; timer.isRunning = true; chrome.alarms.create(id, { when: newEndTime }); chrome.storage.local.set({ timers }, sendTimersToSidePanel); } }); }
function stopSound() { chrome.runtime.sendMessage({ command: 'stopSound' }).catch(e=>{}); }
function updateVolume({ volume }) { chrome.storage.local.set({ volume }); }
async function playSound(volume) { const source = 'sounds/sound.mp3'; const offscreenData = { command: 'playSound', source, volume }; if (await chrome.offscreen.hasDocument()) { chrome.runtime.sendMessage(offscreenData).catch(e=>{}); return; } await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK'], justification: 'タイマー終了を通知するため', }); setTimeout(() => { chrome.runtime.sendMessage(offscreenData).catch(e=>{}); }, 100); }