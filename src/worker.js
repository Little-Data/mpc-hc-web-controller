/**
 * Web Worker 后台任务
 * 负责定时获取播放状态、解析数据，通过消息传递与主线程通信
 */

const state = {
    enableConsole: false, // 是否显示控制台调试信息
};

// 日志输出封装
const debug = {
    log: function(...args) {
        if (state.enableConsole) {
            console.log(...args);
        }
    },
    warn: function(...args) {
        if (state.enableConsole) {
            console.warn(...args);
        }
    },
    error: function(...args) {
        if (state.enableConsole) {
            console.error(...args);
        }
    }
};

// Worker 内部配置（从主线程接收）
let config = {
    statusApi: '/status.html',
    timeout: 5000,
    interval: 1000
};

let statusTimer = null;
let isRunning = false;
let lastStatusData = null;

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

// 解析OnStatus(...)字符串
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
        filePath: decodeUtf8(rawFilePath),
        timestamp: Date.now() // 添加时间戳用于性能监控
    };
}

// 获取播放状态
async function fetchPlayStatus() {
    if (!isRunning) return;
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.timeout);

        const response = await fetch(config.statusApi, {
            method: "GET",
            signal: controller.signal,
            cache: "no-cache"
        });

        clearTimeout(timeoutId);
        
        if (response.ok) {
            const text = await response.text();
            const statusData = parseOnStatusData(text);
            
            if (statusData) {
                // 只有当数据变化时才发送，减少消息开销
                const dataChanged = !lastStatusData || 
                    lastStatusData.posMs !== statusData.posMs ||
                    lastStatusData.playStatus !== statusData.playStatus ||
                    lastStatusData.filePath !== statusData.filePath;
                
                if (dataChanged) {
                    lastStatusData = statusData;
                    self.postMessage({
                        type: 'status',
                        data: statusData
                    });
                }
            }
        } else {
            self.postMessage({
                type: 'error',
                error: `HTTP ${response.status}`,
                context: 'fetch'
            });
        }
    } catch (error) {
        if (error.name === "AbortError") {
            self.postMessage({
                type: 'error',
                error: 'timeout',
                context: 'fetch'
            });
        } else {
            self.postMessage({
                type: 'error',
                error: error.message,
                context: 'fetch'
            });
        }
    }
}

// 启动定时更新
function startStatusUpdate() {
    if (isRunning) return;
    isRunning = true;
    
    // 立即执行一次
    fetchPlayStatus();
    
    // 定时执行
    statusTimer = setInterval(fetchPlayStatus, config.interval);
    
    self.postMessage({ type: 'state', state: 'started' });
}

// 停止定时更新
function stopStatusUpdate() {
    isRunning = false;
    if (statusTimer) {
        clearInterval(statusTimer);
        statusTimer = null;
    }
    self.postMessage({ type: 'state', state: 'stopped' });
}

// 监听主线程消息
self.onmessage = function(e) {
    const { command, data } = e.data;
    
    switch (command) {
        case 'init':
            // 初始化配置
            if (data.config) {
                config = { ...config, ...data.config };
            }
            break;
            
        case 'start':
            startStatusUpdate();
            break;
            
        case 'stop':
            stopStatusUpdate();
            break;
            
        case 'updateConfig':
            // 动态更新配置
            if (data.config) {
                config = { ...config, ...data.config };
                // 如果正在运行，重启以应用新配置
                if (isRunning) {
                    stopStatusUpdate();
                    startStatusUpdate();
                }
            }
            break;
            
        case 'fetchOnce':
            // 单次获取（用于立即刷新）
            fetchPlayStatus();
            break;
            
        default:
            debug.warn('Worker: 未知命令', command);
    }
};

// Worker 错误处理
self.onerror = function(error) {
    self.postMessage({
        type: 'error',
        error: error.message,
        context: 'worker',
        lineno: error.lineno
    });
};