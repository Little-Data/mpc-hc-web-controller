/* Web Worker */
let mpcWorker = null;
let workerSupported = typeof Worker !== 'undefined';

const state = {
    enableConsole: false, // 是否显示控制台调试信息
};

// 日志输出封装
const debug = {
    log: function(...args) {
        if (COVER_CONFIG.enableConsole) {
            console.log(...args);
        }
    },
    warn: function(...args) {
        if (COVER_CONFIG.enableConsole) {
            console.warn(...args);
        }
    },
    error: function(...args) {
        if (COVER_CONFIG.enableConsole) {
            console.error(...args);
        }
    }
};

function startStatusUpdateLegacy() {
    if (!statusTimer) {
        getPlayStatus();
        statusTimer = setInterval(getPlayStatus, STATUS_UPDATE_INTERVAL);
    }
}

function stopStatusUpdateLegacy() {
    if (statusTimer) {
        clearInterval(statusTimer);
        statusTimer = null;
    }
}

/**
 * 初始化 Web Worker
 */
function initWorker() {
    if (!workerSupported) {
        debug.warn('当前浏览器不支持 Web Worker，将使用传统模式');
        return false;
    }
    
    try {
        // 创建 Worker
        mpcWorker = new Worker('src/worker.js');
        // 监听 Worker 消息
        mpcWorker.onmessage = handleWorkerMessage;
        mpcWorker.onerror = handleWorkerError;
        
        // 初始化 Worker 配置
        mpcWorker.postMessage({
            command: 'init',
            data: {
                config: {
                    statusApi: CONFIG.statusApi,
                    timeout: CONFIG.timeout,
                    interval: STATUS_UPDATE_INTERVAL
                }
            }
        });
        
        debug.log('Web Worker 已初始化');
        return true;
    } catch (e) {
        debug.error('Worker 初始化失败:', e);
        workerSupported = false;
        return false;
    }
}

/**
 * 处理 Worker 消息
 */
function handleWorkerMessage(e) {
    const { type, data, error, context, state } = e.data;
    
    switch (type) {
        case 'status':
            // 接收到状态数据，渲染到 DOM
            if (data) {
                renderPlayStatus(data);
                
                // 触发 skip.js 的跳过检查
                if (typeof window.performSkipCheck === 'function') {
                    window.performSkipCheck(data, sendControlCommand, sendProgressPercentRequest);
                }
                
                // 触发 media.js 的媒体会话更新
                if (typeof window.renderPlayStatus === 'function' && 
                    window.renderPlayStatus !== renderPlayStatus) {
                    // 如果 media.js 已覆盖，调用原始函数
                }
            }
            break;
            
        case 'error':
            debug.warn(`Worker [${context}] 错误:`, error);
            if (context === 'fetch') {
                updateStatus(`状态获取失败: ${error}`);
            }
            break;
            
        case 'state':
            debug.log('Worker 状态:', state);
            break;
            
        default:
            debug.log('Worker 消息:', e.data);
    }
}

/**
 * 处理 Worker 错误
 */
function handleWorkerError(error) {
    debug.error('Worker 错误:', error.message);
    updateStatus('后台线程错误，已切换至兼容模式');
    
    // 降级处理：停止 Worker，使用传统模式
    if (mpcWorker) {
        mpcWorker.terminate();
        mpcWorker = null;
    }
    workerSupported = false;
    
    // 自动切换到传统模式
    startStatusUpdateLegacy();
}

/**
 * 启动 Worker 状态更新
 */
startStatusUpdate = function() {
    if (!mpcWorker && workerSupported) {
        initWorker();
    }
    
    if (mpcWorker) {
        mpcWorker.postMessage({ command: 'start' });
    } else {
        startStatusUpdateLegacy();
    }
};

/**
 * 停止 Worker 状态更新
 */
stopStatusUpdate = function() {
    if (mpcWorker) {
        mpcWorker.postMessage({ command: 'stop' });
    } else {
        stopStatusUpdateLegacy();
    }
};

/**
 * 立即刷新一次（用于用户操作后）
 */
function refreshStatusImmediate() {
    if (mpcWorker) {
        mpcWorker.postMessage({ command: 'fetchOnce' });
    } else {
        getPlayStatus(); // 传统模式
    }
}

/**
 * 更新 Worker 配置（当用户修改设置时）
 */
function updateWorkerConfig(newConfig) {
    if (mpcWorker) {
        mpcWorker.postMessage({
            command: 'updateConfig',
            data: { config: newConfig }
        });
    }
}

// skip.js使用
function timeStrToMs(str) {
  const p = str.split(':').map(Number);
  return ((p[0] || 0) * 3600 + (p[1] || 0) * 60 + (p[2] || 0)) * 1000;
}
// 核心配置
const CONFIG = {
    controlApi: "/command.html",  // POST/GET请求目标地址
    statusApi: "/status.html",    // 播放状态查询接口
    timeout: 5000,                // 请求超时时间(ms)
    previewUrl: location.origin + "/snapshot.jpg",  // 快照基础路径
    previewMaxFPS: 25,      // 目标帧率
    previewRetryMax: 3,     // 单帧超时重试次数
    previewBackoffFactor: 1.5,   // 每次失败间隔倍数
};

// LocalStorage 键名配置
const STORAGE_KEYS = {
    previewEnabled: 'mpcPreviewEnabled',
    previewFps: 'mpcPreviewFps',
    groupFoldedStates: 'mpcGroupFoldedStates',
    autoUpdateStatus: 'mpcAutoUpdateStatus',
    controlAddress: 'mpcControlAddress',
    skipRules: 'mpcSkipRules'
};

// 全局元素获取
const el = {
    previewSwitch: document.getElementById("previewSwitch"),
    previewContainer: document.getElementById("previewContainer"),
    previewImg: document.getElementById("previewImg"),
    previewUnavailable: document.getElementById("previewUnavailable"),
    statusText: document.getElementById("statusText"),
    controlBtns: document.querySelectorAll(".control-btn"),
    // 状态展示元素
    windowTitle: document.getElementById("windowTitle"),
    progressBar: document.getElementById("progressBar"),
    currentTime: document.getElementById("currentTime"),
    totalTime: document.getElementById("totalTime"),
    playStatus: document.getElementById("playStatus"),
    muteStatus: document.getElementById("muteStatus"),
    volumeValue: document.getElementById("volumeValue"),
    filePath: document.getElementById("filePath"),
    progressTrack: document.getElementById("progressTrack"),
    // 时间跳转元素
    jumpTimeInput: document.getElementById("jumpTimeInput"),
    jumpTimeBtn: document.getElementById("jumpTimeBtn"),
    // 进度条悬停提示框
    progressTooltip: document.getElementById("progressTooltip"),
    // 文件路径浮层元素
    pathModal: document.getElementById("pathModal"),
    pathClose: document.getElementById("pathClose"),
    pathText: document.getElementById("pathText"),
    // 实时更新勾选框
    autoUpdateStatus: document.getElementById("autoUpdateStatus"), 
    previewFpsRow:  document.getElementById('previewFpsRow'),
    previewFpsInput:document.getElementById('previewFpsInput'),
};

// 全局变量
let statusTimer = null;         // 状态刷新定时器
let isDragging = false;         // 是否正在拖动进度条
let isHoverProgress = false;    // 是否鼠标悬停在进度条区域
let dragStartX = 0;             // 拖动起始X坐标
let ignoreNextClick = false;    // 阻止点击传播
const DRAG_THRESHOLD = 2;       // 拖动阈值（像素），小于该值视为点击而非拖动
const STATUS_UPDATE_INTERVAL = 1000; // 抽离更新间隔

/* ==========  LocalStorage 状态管理  ========== */

// 保存状态到 LocalStorage
function saveStateToStorage(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        debug.warn('无法保存到 LocalStorage:', e);
    }
}

// 从 LocalStorage 读取状态
function loadStateFromStorage(key, defaultValue) {
    try {
        const stored = localStorage.getItem(key);
        return stored ? JSON.parse(stored) : defaultValue;
    } catch (e) {
        debug.warn('无法从 LocalStorage 读取:', e);
        return defaultValue;
    }
}

// 保存所有状态
function saveAllStates() {
    // 保存视频预览状态
    saveStateToStorage(STORAGE_KEYS.previewEnabled, el.previewSwitch.checked);
    
    // 保存预览帧率
    saveStateToStorage(STORAGE_KEYS.previewFps, CONFIG.previewMaxFPS);
    
    // 保存实时更新状态
    saveStateToStorage(STORAGE_KEYS.autoUpdateStatus, el.autoUpdateStatus.checked);
    
    // 保存控制地址
    saveStateToStorage(STORAGE_KEYS.controlAddress, CONFIG.controlApi.replace('/command.html', ''));
    
    // 保存各组折叠状态
    const groupStates = {};
    document.querySelectorAll('.control-group').forEach((group, index) => {
        groupStates[index] = group.classList.contains('folded');
    });
    saveStateToStorage(STORAGE_KEYS.groupFoldedStates, groupStates);
}

// 恢复所有状态
function restoreAllStates() {
    // 恢复视频预览状态
    const previewEnabled = loadStateFromStorage(STORAGE_KEYS.previewEnabled, false);
    el.previewSwitch.checked = previewEnabled;
    if (previewEnabled) {
        setTimeout(() => togglePreview(), 100); // 延迟执行，等待DOM完全加载
    }
    
    // 恢复预览帧率
    const savedFps = loadStateFromStorage(STORAGE_KEYS.previewFps, 25);
    el.previewFpsInput.value = savedFps;
    CONFIG.previewMaxFPS = savedFps;
    if (preview.active) {
        preview.targetInterval = 1000 / CONFIG.previewMaxFPS;
    }
    
    // 恢复实时更新状态
    const autoUpdate = loadStateFromStorage(STORAGE_KEYS.autoUpdateStatus, true);
    el.autoUpdateStatus.checked = autoUpdate;
    if (!autoUpdate) {
        stopStatusUpdate(); // 如果之前关闭了，停止更新
    }
    
    // 恢复控制地址
    const savedAddress = loadStateFromStorage(STORAGE_KEYS.controlAddress, location.origin);
    elUrlInput.value = savedAddress;
    CONFIG.controlApi = `${savedAddress}/command.html`;
    CONFIG.statusApi = `${savedAddress}/status.html`;
    CONFIG.previewUrl = `${savedAddress}/snapshot.jpg`;
    
    // Worker 初始化后同步配置
    if (mpcWorker) {
        updateWorkerConfig({
            statusApi: CONFIG.statusApi,
            timeout: CONFIG.timeout,
            interval: STATUS_UPDATE_INTERVAL
        });
    }

    // 供 media.js 使用
    window.MPC_CONFIG = {
        previewUrl: CONFIG.previewUrl,
        controlApi: CONFIG.controlApi,
        statusApi: CONFIG.statusApi
    };

    // 恢复各组折叠状态
    const groupStates = loadStateFromStorage(STORAGE_KEYS.groupFoldedStates, null);
    document.querySelectorAll('.control-group').forEach((group, index) => {
        // 本地没存过就不处理，让 HTML 里的默认 folded 生效
        if (groupStates === null) return;

        if (groupStates[index]) {
            group.classList.add('folded');
        } else {
            group.classList.remove('folded');
        }
    });
}

/* ===== 清除本页 LocalStorage ===== */
const elClearBtn = document.getElementById('btnClearStorage');
if (elClearBtn) {
    elClearBtn.addEventListener('click', () => {
        if (confirm('确定要清除本页保存在 LocalStorage 的所有数据吗？清除后将刷新页面')) {
            // 只清本项目用到的 key
            Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k));
            localStorage.removeItem(CUSTOM_KEY);   // 自定义命令
            localStorage.removeItem(ThemeManager.STORAGE_KEY); // 主题设置
            localStorage.removeItem('mediaControlEnabled'); // 媒体控制
            updateStatus('已清除本页 LocalStorage 数据，即将刷新页面。');
            location.reload();
        }
    });
}

/* ==========  预览  ========== */
const preview = {
    active: false,
    retry: 0,
    frameId: 0,
    lastFrameTs: 0,
    targetInterval: 1000 / CONFIG.previewMaxFPS,
    img: new Image(),
    url: '',
    ctrl: new AbortController()
};

// UTF8解码
function decodeUtf8(str) {
    try {
        // 方法1：如果输入是 URL 编码的 UTF-8（标准情况）
        return decodeURIComponent(str);
    } catch (e) {
        // 方法2：处理 GBK 编码的中文
        try {
            // 将字符串转为字节数组，再用 GBK 解码
            const bytes = new Uint8Array(str.split('').map(c => c.charCodeAt(0) & 0xFF));
            return new TextDecoder('gbk').decode(bytes);
        } catch (e2) {
            // 解码失败返回原字符串
            return str;
        }
    }
}

// 解析OnStatus(...)字符串，提取播放状态参数
function parseOnStatusData(str) {
    const reg = /OnStatus\((.*)\)/;
    const match = str.match(reg);
    if (!match || !match[1]) return null;

    const params = [];
    let temp = "";
    let escapeFlag = false;
    let quoteChar = null;

    for (let char of match[1]) {
        if (escapeFlag) {
            temp += char;
            escapeFlag = false;
            continue;
        }
        if (char === "\\") {
            escapeFlag = true;
            temp += char;
            continue;
        }
        if (char === '"' || char === "'") {
            if (quoteChar === null) {
                quoteChar = char;
                continue;
            } else if (quoteChar === char) {
                quoteChar = null;
                continue;
            }
        }
        if (char === "," && quoteChar === null) {
            params.push(temp.trim());
            temp = "";
            continue;
        }
        temp += char;
    }
    params.push(temp.trim());

    const rawFilePath = params[8] || "";

    return {
        windowTitle: decodeUtf8(params[0] || ""),
        playStatus: decodeUtf8(params[1] || ""),
        posMs: Number(params[2] || 0),
        posStr: params[3] || "00:00:00",
        durMs: Number(params[4] || 0),
        durStr: params[5] || "00:00:00",
        isMuted: Number(params[6] || 0),
        volume: Number(params[7] || 0),
        filePath: decodeUtf8(rawFilePath)
    };
}

// 秒数转HH:MM:SS格式（用于悬停时间计算）
function formatSecondsToTime(seconds) {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
}

// 更新页面播放状态（渲染到DOM）
function renderPlayStatus(data) {
    if (!data) return;

    el.windowTitle.textContent = data.windowTitle;
    // 存储总时长毫秒数到DOM，供悬停计算使用
    el.totalTime.dataset.durMs = data.durMs;
    el.currentTime.textContent = data.posStr;
    el.totalTime.textContent = data.durStr;
    // 计算进度百分比（避免除以0）
    const progressPercent = data.durMs > 0 ? (data.posMs / data.durMs) * 100 : 0;
    // 非拖动状态下才更新进度条，避免覆盖拖动视觉
    if (!isDragging) {
        el.progressBar.style.width = `${Math.min(progressPercent, 100)}%`;
    }

    el.playStatus.textContent = data.playStatus || "未知状态";
    el.muteStatus.textContent = data.isMuted === 1 ? "已静音" : "未静音";
    el.muteStatus.style.color = data.isMuted === 1 ? "#dc3545" : "#28a745";
    el.volumeValue.textContent = `${data.volume}%`;
    el.volumeValue.style.color = data.volume === 0 ? "#666" : "#007bff";
    // 存储完整路径并渲染缩略路径
    window.currentFullPath = data.filePath || "";
    el.filePath.textContent = currentFullPath;
    el.filePath.textContent = data.filePath;
    /* ---- 片头片尾跳过 ---- */
    if (typeof window.performSkipCheck === 'function') {
    window.performSkipCheck(data, sendControlCommand, sendProgressPercentRequest);
    }
    /* 警告横幅*/
    if (!sessionStorage.getItem('_mpcWarnShown')) {
    const isBE = /MPC-BE/i.test(data.windowTitle || '');
        if (isBE) {
            document.getElementById('warnBanner').style.display = 'block';
            sessionStorage.setItem('_mpcWarnShown', '1');
        }
    }
}

// 从/status.html拉取播放状态
async function getPlayStatus() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeout);

        const response = await fetch(CONFIG.statusApi, {
            method: "GET",
            signal: controller.signal,
            cache: "no-cache"
        });

        clearTimeout(timeoutId);
        if (response.ok) {
            const text = await response.text();
            const statusData = parseOnStatusData(text);
            renderPlayStatus(statusData);
        } else {
            updateStatus(`获取播放状态失败 [HTTP 状态：${response.status}]`);
        }
    } catch (error) {
        if (error.name === "AbortError") {
            updateStatus(`获取播放状态超时`);
        } else {
            updateStatus(`状态查询异常：${error.message}`);
        }
    }
}

// 预览核心功能
// 加载成功
preview.img.onload = () => {
    el.previewUnavailable.style.display = 'none';
    el.previewImg.style.display = 'block';
    el.previewImg.src = preview.url;
    preview.retry = 0;
    preview.lastFrameTs = performance.now();
    preview.targetInterval = 1000 / CONFIG.previewMaxFPS;   // 恢复正常帧率
};
// 加载失败
preview.img.onerror = () => {
    if (preview.retry < CONFIG.previewRetryMax) {
        preview.retry++;
        return;
    }
    preview.active = false;
    cancelAnimationFrame(preview.frameId);
    updateStatus('预览源不可用，已自动停止刷新');
    el.previewImg.style.display = 'none';
    el.previewUnavailable.style.display = 'block';
};
// 单帧请求
let fetching = false;
function fetchFrame() {
    if (!preview.active || fetching) return;
    fetching = true;
    preview.ctrl.abort();
    preview.ctrl = new AbortController();
    const url = `${CONFIG.previewUrl}?t=${Date.now()}`;
    preview.url = url;

    fetch(url, { method: 'GET', signal: preview.ctrl.signal, cache: 'no-store' })
        .then(r => {
            fetching = false;          // 请求结束立刻放牌
            return r.ok ? preview.img.src = url : Promise.reject();
        })
        .catch(() => {
            fetching = false;
            preview.img.onerror();
            // 网络卡顿时把目标间隔临时放大，成功后恢复
            preview.targetInterval = Math.min(
                preview.targetInterval * CONFIG.previewBackoffFactor,
                2000   // 最多降到 0.5 fps
            );
        });
}
function loop(now) {
    if (!preview.active) return;
    const elapsed = now - preview.lastFrameTs;
    // 必须 >= 目标间隔才拉帧；同时保证"上一帧已回来"
    if (elapsed >= preview.targetInterval && !fetching) {
        fetchFrame();
    }
    preview.frameId = requestAnimationFrame(loop);
}

// 勾选框事件监听
el.autoUpdateStatus.addEventListener("change", function() {
    if (this.checked) {
        startStatusUpdate(); // 勾选时启动更新
    } else {
        stopStatusUpdate();  // 取消勾选时停止更新
    }
    saveStateToStorage(STORAGE_KEYS.autoUpdateStatus, this.checked); // 保存状态
});

function togglePreview() {
    preview.active = el.previewSwitch.checked;
    if (preview.active) {
        el.previewContainer.style.display = 'flex';
        el.previewFpsRow.style.display = 'flex';
        CONFIG.previewMaxFPS = +el.previewFpsInput.value;
        preview.targetInterval = 1000 / CONFIG.previewMaxFPS;
        preview.lastFrameTs = 0;
        loop(performance.now());
        updateStatus('已开启视频预览');
    } else {
        cancelAnimationFrame(preview.frameId);
        preview.ctrl.abort();
        el.previewContainer.style.display = 'none';
        el.previewFpsRow.style.display = 'none';
        updateStatus('已关闭视频预览');
    }
    saveStateToStorage(STORAGE_KEYS.previewEnabled, preview.active); // 保存预览状态
    saveStateToStorage(STORAGE_KEYS.previewFps, CONFIG.previewMaxFPS); // 保存帧率
}

// 指令控制核心功能
function updateStatus(text) {
    el.statusText.textContent = text;
}
async function sendControlCommand(command) {
    const activeBtn = document.querySelector(`[data-command="${command}"]`);
    activeBtn?.classList.add("loading");
    updateStatus(`正在发送指令：wm_command=${command}`);

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeout);

        const response = await fetch(CONFIG.controlApi, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            },
            body: `wm_command=${command}&null=0`,
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        if (response.ok) {
            updateStatus(`指令执行成功 [wm_command=${command}]`);
            getPlayStatus();
        } else {
            updateStatus(`指令执行失败 [HTTP 状态：${response.status}]`);
        }
    } catch (error) {
        if (error.name === "AbortError") {
            updateStatus(`指令发送超时 [wm_command=${command}]`);
        } else {
            updateStatus(`请求异常：${error.message}`);
        }
    } finally {
        activeBtn?.classList.remove("loading");
    }
}

// 发送时间点跳转请求（POST）
async function sendJumpTimeRequest(timeStr) {
    // 容错解析：兼容 8:2、20、1:23:45 等多种输入
    function normalizeTime(str) {
        str = str.trim();
        // 纯数字 → 秒
        if (/^\d+$/.test(str)) {
            const s = parseInt(str, 10);
            return [0, 0, s];
        }
        // 已标准 → 直接返回
        if (/^\d{1,2}:\d{1,2}:\d{1,2}$/.test(str)) {
            return str.split(':').map(Number);
        }
        // 仅分:秒 → 补小时
        if (/^\d{1,2}:\d{1,2}$/.test(str)) {
            const [m, s] = str.split(':').map(Number);
            return [0, m, s];
        }
        return null; // 无法解析
    }

    const parts = normalizeTime(timeStr);
    if (!parts) {
        updateStatus('时间格式错误！');
        return;
    }

    let [h, m, s] = parts;
    // 进位处理
    if (s >= 60) { m += Math.floor(s / 60); s %= 60; }
    if (m >= 60) { h += Math.floor(m / 60); m %= 60; }

    // 格式化为 HH:MM:SS
    const hh = h.toString().padStart(2, '0');
    const mm = m.toString().padStart(2, '0');
    const ss = s.toString().padStart(2, '0');
    const normalized = `${hh}:${mm}:${ss}`;

    el.jumpTimeBtn.classList.add('loading');
    updateStatus(`正在跳转到时间点：${normalized}`);

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeout);

        const response = await fetch(CONFIG.controlApi, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: `wm_command=-1&position=${encodeURIComponent(normalized)}`,
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        if (response.ok) {
            updateStatus(`跳转到 ${normalized} 成功`);
            getPlayStatus();
        } else {
            updateStatus(`跳转失败 [HTTP 状态：${response.status}]`);
        }
    } catch (error) {
        updateStatus(`跳转异常：${error.message}`);
    } finally {
        el.jumpTimeBtn.classList.remove('loading');
    }
}

// 发送进度百分比请求（GET）
async function sendProgressPercentRequest(percent) {
    updateStatus(`正在跳转到进度：${percent.toFixed(2)}%`);

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeout);

        const url = `${CONFIG.controlApi}?wm_command=-1&percent=${encodeURIComponent(percent)}`;
        const response = await fetch(url, {
            method: "GET",
            signal: controller.signal,
            cache: "no-cache"
        });

        clearTimeout(timeoutId);
        if (response.ok) {
            updateStatus(`跳转到进度 ${percent.toFixed(2)}% 成功`);
            getPlayStatus();
        } else {
            updateStatus(`进度跳转失败 [HTTP 状态：${response.status}]`);
        }
    } catch (error) {
        if (error.name === "AbortError") {
            updateStatus(`进度跳转请求超时`);
        } else {
            updateStatus(`进度跳转异常：${error.message}`);
        }
    }
}

// 进度条核心处理
function handleProgressEvent(e) {
    // 非拖动+非悬停：直接隐藏提示框并返回，不执行任何操作
    if (!isDragging && !isHoverProgress) {
        el.progressTooltip.style.display = "none";
        return;
    }
    // 兼容移动触摸事件：获取触摸点/鼠标点的X坐标
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const trackRect = el.progressTrack.getBoundingClientRect();
    // 计算百分比（限制0-100，防止超出进度条）
    let percent = ((clientX - trackRect.left) / trackRect.width) * 100;
    percent = Math.max(0, Math.min(100, percent));

    // 计算并显示悬停/拖动时的时间点
    const totalDurMs = Number(el.totalTime.dataset.durMs) || 0;
    const totalDurSec = totalDurMs / 1000;
    const hoverSec = totalDurSec * (percent / 100);
    const hoverTime = formatSecondsToTime(hoverSec);
    el.progressTooltip.textContent = hoverTime;

    // 定位提示框（水平居中，不超出进度条边界）
    const tooltipWidth = el.progressTooltip.offsetWidth;
    let left = clientX - trackRect.left - (tooltipWidth / 2);
    left = Math.max(0, Math.min(left, trackRect.width - tooltipWidth));
    el.progressTooltip.style.left = `${left}px`;
    el.progressTooltip.style.display = "block";

    // 拖动中/触摸中：实时更新进度条视觉（不发请求，仅预览）
    if (isDragging) {
        el.progressBar.style.width = `${percent}%`;
        return;
    }
}

// 进度条拖动/触摸开始：标记状态+阻止默认行为
function handleProgressStart(e) {
    isDragging = true;
    // 记录拖动起始X坐标
    dragStartX = e.touches ? e.touches[0].clientX : e.clientX;
    e.preventDefault(); // 兼容移动：阻止触摸时页面滚动/缩放
    handleProgressEvent(e);
}

// 进度条拖动/触摸结束：发送进度请求+重置状态
function handleProgressEnd(e) {
    if (!isDragging) return;
    isDragging = false;
    // 兼容移动触摸结束：获取最后一个触摸点坐标
    const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
    // 判断拖动位移是否超过阈值
    const dragDistance = Math.abs(clientX - dragStartX);
    if (dragDistance < DRAG_THRESHOLD) {
        // 无效拖动，交给click事件处理，不发送请求
        el.progressTooltip.style.display = "none";
        return;
    }

    // 有效拖动，才计算百分比并发送请求
    ignoreNextClick = true;
    setTimeout(() => { ignoreNextClick = false; }, 50); // 50ms 后重置

    const trackRect = el.progressTrack.getBoundingClientRect();
    let percent = ((clientX - trackRect.left) / trackRect.width) * 100;
    percent = Math.max(0, Math.min(100, percent));
    sendProgressPercentRequest(percent);
    
    // 拖动结束后隐藏提示框
    el.progressTooltip.style.display = "none";
}

// 鼠标进入进度条区域-标记悬停状态
function handleProgressMouseEnter() {
    isHoverProgress = true;
}

// 鼠标离开进度条区域-重置悬停状态+隐藏提示框
function handleProgressMouseLeave() {
    isHoverProgress = false;
    if (!isDragging) el.progressTooltip.style.display = "none";
}

// 进度条单独点击事件（兼容快速点击，非拖动场景）
function handleProgressTrackClick(e) {
    if (ignoreNextClick) {
        ignoreNextClick = false;
        return;
    }
    const trackRect = el.progressTrack.getBoundingClientRect();
    const percent = ((e.clientX - trackRect.left) / trackRect.width) * 100;
    const clampedPercent = Math.max(0, Math.min(100, percent));
    sendProgressPercentRequest(clampedPercent);
}

// 打开完整路径浮层
function openPathModal() {
    el.pathText.textContent = currentFullPath;
    el.pathModal.style.display = "flex";
    // 禁止页面滚动
    document.body.style.overflow = "hidden";
}

// 关闭完整路径浮层
function closePathModal() {
    el.pathModal.style.display = "none";
    // 恢复页面滚动
    document.body.style.overflow = "auto";
}

// 初始化绑定
function init() {
    // 预览开关绑定事件
    el.previewSwitch.addEventListener("change", togglePreview);
    el.previewContainer.style.display = 'none';

    // 所有控制按钮绑定点击事件
    el.controlBtns.forEach(btn => {
        // 跳过所有不带 data-command 的按钮（自定义区、弹窗、折叠按钮等）
        if (!btn.hasAttribute('data-command')) return;

        btn.addEventListener('click', e => {
            e.stopPropagation();          // 保险，阻止冒泡
            const command = btn.dataset.command;
            sendControlCommand(command);
        });
    });

    // 时间跳转按钮绑定点击事件
    document.getElementById('jumpTimeBtn').addEventListener('click', () => {
        const timeStr = el.jumpTimeInput.value.trim();
        if (!timeStr) {
            updateStatus("请输入要跳转的时间点");
            return;
        }
        sendJumpTimeRequest(timeStr);
    });

    el.jumpTimeInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('jumpTimeBtn').click();
    }
    });

    // 进度条事件绑定
    // PC端：鼠标基础事件
    el.progressTrack.addEventListener("mouseenter", handleProgressMouseEnter);
    el.progressTrack.addEventListener("mouseleave", handleProgressMouseLeave);
    el.progressTrack.addEventListener("mousedown", handleProgressStart);
    // PC端全局鼠标事件（拖动时跟随）
    document.addEventListener("mousemove", handleProgressEvent);
    document.addEventListener("mouseup", handleProgressEnd);
    // 移动端：触摸事件
    el.progressTrack.addEventListener("touchstart", handleProgressStart);
    document.addEventListener("touchmove", handleProgressEvent);
    document.addEventListener("touchend", handleProgressEnd);
    document.addEventListener("touchcancel", handleProgressEnd);
    // 保留单独点击事件（兼容快速点击）
    el.progressTrack.addEventListener("click", handleProgressTrackClick);

    // 文件路径相关事件绑定
    el.filePath.addEventListener("click", openPathModal); // 点击路径打开浮层
    el.pathClose.addEventListener("click", closePathModal); // 点击关闭按钮关闭浮层
    // 点击浮层遮罩关闭
    el.pathModal.addEventListener("click", (e) => {
        if (e.target === el.pathModal) closePathModal();
    });
    // 按ESC键关闭浮层
    document.addEventListener('keydown', (e) => {
        if (e.key === "Escape") closePathModal();
    });
    startStatusUpdate();
    // 初始化状态
    updateStatus("就绪 - 等待指令操作");
}

// 页面卸载时清除定时器+全局事件（防止内存泄漏）
window.onbeforeunload = function() {
    cancelAnimationFrame(preview.frameId);
    preview.ctrl.abort();
    stopStatusUpdate();
    // 移除全局拖动/触摸事件
    document.removeEventListener("mousemove", handleProgressEvent);
    document.removeEventListener("mouseup", handleProgressEnd);
    document.removeEventListener("touchmove", handleProgressEvent);
    document.removeEventListener("touchend", handleProgressEnd);
    document.removeEventListener("touchcancel", handleProgressEnd);
    // 移除ESC键事件
    document.removeEventListener('keydown', closePathModal);
};

// 在页面卸载时清理 Worker
window.addEventListener('beforeunload', () => {
    if (mpcWorker) {
        mpcWorker.terminate();
        mpcWorker = null;
    }
});

document.addEventListener("DOMContentLoaded", () => {
  const btnCollapseAll = document.getElementById("btnCollapseAll");
  const btnExpandAll   = document.getElementById("btnExpandAll");

  if (!btnCollapseAll || !btnExpandAll) return;

  btnCollapseAll.addEventListener('click', () => {
    document.querySelectorAll(".control-group").forEach(g => g.classList.add("folded"));
    setTimeout(() => saveAllStates(), 10); // 保存状态
  });

  btnExpandAll.addEventListener('click', () => {
    document.querySelectorAll(".control-group").forEach(g => g.classList.remove("folded"));
    setTimeout(() => saveAllStates(), 10);
  });
  
  document.addEventListener('click', e => {
    const title = e.target.closest(".group-title");
    if (!title) return;
    title.parentElement.classList.toggle("folded");
    setTimeout(() => saveAllStates(), 10);
  });
});

el.previewFpsInput.addEventListener('input', () => {
    CONFIG.previewMaxFPS = +el.previewFpsInput.value || 24;
    preview.targetInterval = 1000 / CONFIG.previewMaxFPS;
    saveStateToStorage(STORAGE_KEYS.previewFps, CONFIG.previewMaxFPS); // 保存帧率
});

/* ========== 自定义命令相关 ========== */
const CUSTOM_KEY = 'mpcCustomCmds';          // localStorage 键
let customCommands = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]');

const elModal       = document.getElementById('customModal');
const elName        = document.getElementById('custName');
const elId          = document.getElementById('custId');
const elMethod      = document.getElementById('custMethod');
const elAddBtn      = document.getElementById('btnAddCustom');
const elSaveBtn     = document.getElementById('btnSave');
const elCancelBtn   = document.getElementById('btnCancel');
const elCloseSpan   = document.getElementById('modalClose');
const elCustomBox   = document.getElementById('customControls');
const elUrlInput    = document.getElementById('customUrlInput');
const elBtnSetUrl   = document.getElementById('btnSetUrl');
const elCardsBox   = document.getElementById('customCards');
const elExportBtn  = document.getElementById('btnExportCustom');
const elImportFile = document.getElementById('inpImportCustom');

// 渲染自定义命令
function renderCustom() {
  elCardsBox.innerHTML = '';
  customCommands.forEach((c, idx) => {
    const card = document.createElement('div');
    card.className = 'custom-card';
    card.innerHTML = `
      <span>${c.name} (${c.id})</span>
      <button class="control-btn btn-send" data-idx="${idx}">发送</button>
      <button class="control-btn" onclick="editCustom(${idx})" style="padding:4px 8px;font-size:12px;">编辑</button>
      <button class="control-btn btn-del" data-idx="${idx}">删除</button>
    `;
    elCardsBox.appendChild(card);
  });
  // 重新绑定卡片内按钮事件
  elCardsBox.querySelectorAll('.btn-send').forEach(btn =>
    btn.addEventListener('click', e => sendCustomCmd(+e.target.dataset.idx)));
  elCardsBox.querySelectorAll('.btn-del').forEach(btn =>
    btn.addEventListener('click', e => delCustom(+e.target.dataset.idx)));
}

// 绑定导入/导出
elExportBtn.addEventListener('click', exportCustom);
elImportFile.addEventListener('change', importCustom);

//导出函数
function exportCustom() {
    if (!customCommands.length) return updateStatus('暂无自定义命令可导出');
    const blob = new Blob([JSON.stringify(customCommands, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mpc-custom-cmds.json';
    a.click();
    URL.revokeObjectURL(url);
    updateStatus('已导出自定义命令');
}

//导入函数
function importCustom(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const arr = JSON.parse(reader.result);
      if (!Array.isArray(arr)) throw new Error('格式错误');

      arr.forEach((c, i) => {
        if (!c.name || typeof c.name !== 'string') throw new Error(`第 ${i + 1} 条缺少名称`);

        // 允许 string 或 number，空字符串则视为未填写
        const idRaw = c.id ?? '';
        const idNum = idRaw === '' ? NaN : Number(idRaw);
        if (!c.params && (isNaN(idNum) || !Number.isInteger(idNum))) {
          throw new Error(`第 ${i + 1} 条缺少合法 ID`);
        }
        // 写回统一格式（数字或空字符串）
        c.id = isNaN(idNum) ? '' : idNum;
      });

      const merge = confirm(`共 ${arr.length} 条命令。\n“确定”覆盖现有，“取消”合并追加。`);
      customCommands = merge ? arr : [...customCommands, ...arr];
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(customCommands));
      renderCustom();
      updateStatus('导入成功');
    } catch (err) {
      alert('导入失败：' + err.message);
      updateStatus('导入失败');
    } finally {
      e.target.value = '';
    }
  };
  reader.readAsText(file);
}

let editingIndex = -1;   // -1 表示新增模式

// 打开弹窗并回显
function editCustom(idx) {
  const c = customCommands[idx];
  if (!c) return;

  editingIndex = idx;
  openModal();          // 先让弹窗出现

  elName.value   = c.name;
  elId.value     = c.id ?? '';          // 防止 undefined
  elMethod.value = c.method;

  /* 高级面板按需展开 & 赋值 */
  const hasCustom = c.params || c.api !== CONFIG.controlApi;
  advancedPanel.style.display  = hasCustom ? 'block' : 'none';
  advancedToggle.classList.toggle('open', hasCustom);

  document.getElementById('custApi').value    = c.api ?? '';
  document.getElementById('custParams').value = c.params ?? '';
}

// 发送自定义命令
function sendCustomCmd(idx) {
  const c = customCommands[idx];
  if (!c) return;

  // 拼装 URL / BODY
  let url, body;
  if (c.params) {                // 用户填了自定义参数
    if (c.method === 'GET') {
      url = `${c.api}${c.params}`;
      body = undefined;
    } else {
      url = c.api;
      body = c.params;
    }
  } else {                       // 默认用 ID
    if (c.method === 'GET') {
      url = `${c.api}?wm_command=${c.id}`;
      body = undefined;
    } else {
      url = c.api;
      body = `wm_command=${c.id}&null=0`;
    }
  }

  // 公用选项
  const ctrl = new AbortController();
  const opts = {
    method: c.method,
    signal: ctrl.signal,
    cache: 'no-cache'
  };
  if (c.method === 'POST' && body) {
    opts.headers = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };
    opts.body = body;
  }

  // 发请求
  fetch(url, opts)
    .then(r => r.ok
      ? updateStatus(`自定义命令成功，名称： [${c.name}]`)
      : updateStatus(`自定义命令失败 [HTTP ${r.status}]`))
    .catch(err => updateStatus(`自定义异常：${err.message}`));
}

// 删除
function delCustom(idx) {
    const c = customCommands[idx];
    if (!c) return;
    if (!confirm(`确定删除自定义命令“${c.name}”吗？`)) return;

    customCommands.splice(idx, 1);
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(customCommands));
    renderCustom();
}

// 弹窗开关
function openModal() {
    elName.value = '';
    elId.value   = '';
    elMethod.value = 'POST';
    elModal.style.display = 'flex';
}
function closeModal() {
    elModal.style.display = 'none';
    editingIndex = -1;   // 恢复新增模式
}
elAddBtn.addEventListener('click', openModal);
elCloseSpan.addEventListener('click', closeModal);
elCancelBtn.addEventListener('click', () => {
    editingIndex = -1;
    closeModal();
});
window.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
});

// 保存
elSaveBtn.addEventListener('click', () => {
  const name   = elName.value.trim();
  const id     = elId.value.trim();
  const method = elMethod.value;
  const api    = advancedPanel.style.display === 'none'
                 ? CONFIG.controlApi
                 : (document.getElementById('custApi').value || '').trim() || CONFIG.controlApi;
  const params = advancedPanel.style.display === 'none'
                 ? ''
                 : (document.getElementById('custParams').value || '').trim();

  if (!name) return updateStatus('请输入名称');
  // 如果没有自定义参数，就必须有合法数字 ID
  if (!params && (!id || isNaN(id))) return updateStatus('请填写数字命令 ID，或填写自定义参数');
  if (params && method === 'GET' && !params.startsWith('?'))
    return updateStatus('GET 自定义参数请以 ? 开头');

  const payload = { name, method, api, params, id };
  editingIndex === -1 ? customCommands.push(payload)
                      : (customCommands[editingIndex] = payload);
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(customCommands));
  renderCustom();
  closeModal();
});
// 初始化渲染
renderCustom();

// 把当前地址当默认值
const DEFAULT_BASE = location.origin;

// 页面加载时把正在用的地址回显到输入框
elUrlInput.value = CONFIG.controlApi.replace(/\/command\.html$/, '');

// 点击"设置"
elBtnSetUrl.addEventListener('click', () => {
    let base = elUrlInput.value.trim();
    if (!base) {                       // 空值就回到默认
        base = DEFAULT_BASE;
        elUrlInput.value = base;
    }
    // 去掉尾部斜杠，再拼接口路径
    base = base.replace(/\/$/, '');
    CONFIG.controlApi = `${base}/command.html`;
    CONFIG.statusApi  = `${base}/status.html`;
    CONFIG.previewUrl = `${base}/snapshot.jpg`;

    saveStateToStorage(STORAGE_KEYS.controlAddress, base); // 保存控制地址

    // 同步更新 Worker 配置
    updateWorkerConfig({
        statusApi: CONFIG.statusApi,
        timeout: CONFIG.timeout,
        interval: STATUS_UPDATE_INTERVAL
    });

    // media.js 获取新地址
    window.MPC_CONFIG = {
        previewUrl: CONFIG.previewUrl,
        controlApi: CONFIG.controlApi,
        statusApi: CONFIG.statusApi
    };

    // 重启状态刷新，让新地址立即生效
    if (el.autoUpdateStatus.checked) {
        stopStatusUpdate();          // 先停旧定时器
        startStatusUpdate();         // 再开新定时器
    }
    updateStatus(`已切换控制地址到：${base}`);
});

/* ===== 高级折叠交互 ===== */
const advancedToggle = document.getElementById('advancedToggle');
const advancedPanel  = document.getElementById('advancedPanel');
advancedToggle.addEventListener('click', () => {
  const open = advancedPanel.style.display === 'none';
  advancedPanel.style.display = open ? 'block' : 'none';
  advancedToggle.classList.toggle('open', open);
});

/* ========== 回到顶部按钮功能 ========== */
const backToTopBtn = document.getElementById('backToTop');
let scrollTimer = null;
let isVisible = false;

// 显示按钮
function showBackToTop() {
    if (!isVisible) {
        backToTopBtn.classList.add('show');
        isVisible = true;
    }
}

// 隐藏按钮
function hideBackToTop() {
    if (isVisible) {
        backToTopBtn.classList.remove('show');
        isVisible = false;
    }
}

// 回到顶部
function scrollToTop() {
    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });
}

// 滚动事件处理
function handleScroll() {
    // 显示按钮（如果页面滚动超过200px）
    if (window.pageYOffset > 200) {
        showBackToTop();
    } else {
        hideBackToTop();
        return;
    }

    // 清除之前的定时器
    if (scrollTimer) {
        clearTimeout(scrollTimer);
    }

    // 设置新的定时器，3秒后隐藏按钮
    scrollTimer = setTimeout(() => {
        if (window.pageYOffset > 200) {
            hideBackToTop();
        }
    }, 3000);
}

// 绑定事件
backToTopBtn.addEventListener('click', scrollToTop);
window.addEventListener('scroll', handleScroll, { passive: true });

// 页面加载时检查初始状态
if (window.pageYOffset > 200) {
    showBackToTop();
}

// 页面加载完成后初始化并恢复状态
window.onload = function() {
    init();
    setTimeout(() => {
        restoreAllStates();
    }, 200); // 延迟恢复状态，确保所有元素都已加载
};

// 将配置暴露给 media.js 使用
window.MPC_CONFIG = {
    previewUrl: CONFIG.previewUrl,
    controlApi: CONFIG.controlApi,
    statusApi: CONFIG.statusApi
};
