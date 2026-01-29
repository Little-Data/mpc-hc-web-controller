/**
 * media.js - 浏览器媒体控制集成
 */

(function() {
    'use strict';

    // ===== 配置区域 =====
    const COVER_CONFIG = {
        updateInterval: 30000,  // 封面更新间隔（毫秒），默认 30 秒
        enableConsole: false,    // 是否显示控制台调试信息
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

    // 移动端检测
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

    // 获取音频元素
    const mediaElement = document.getElementById('silentAudio');

    if (!mediaElement) {
        debug.warn('未找到 silentAudio 元素，媒体控制功能不可用');
        return;
    }

    // 确保音频元素具有移动端所需的属性
    mediaElement.setAttribute('playsinline', '');
    mediaElement.setAttribute('webkit-playsinline', '');
    mediaElement.setAttribute('preload', 'auto');
    
    // 确保音频默认暂停，音量极低（保持激活但不影响用户）
    mediaElement.pause();
    mediaElement.volume = 0.01;
    mediaElement.loop = true;
    mediaElement.muted = false;

    // 状态追踪
    let wasPlaying = false;
    let currentFileName = null;  // 当前文件名，用于检测文件变化
    let lastCoverUrl = '';       // 当前使用的封面URL
    let audioUnlocked = false;   // 音频是否已解锁（移动端需要）
    let lastDurationMs = 0;      // 上次有效的时长
    let lastPreviewBaseUrl = null; // 上次使用的基础预览URL（用于检测地址变化）
    
    // 媒体控制开关状态（从LocalStorage读取，默认启用）
    let mediaControlEnabled = localStorage.getItem('mediaControlEnabled') !== 'false';

    // 兼容旧浏览器的媒体会话 API 检测
    if (!navigator.mediaSession) {
        debug.warn('当前浏览器不支持 Media Session API');
        return;
    }

    /**
     * 移动端音频解锁
     */
    function unlockAudio() {
        if (audioUnlocked) return;
        
        // 如果媒体控制被禁用，不解锁
        if (!mediaControlEnabled) return;
        
        // 尝试播放并立即暂停来"解锁"音频上下文
        const playPromise = mediaElement.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                mediaElement.pause();
                audioUnlocked = true;
                debug.log('音频已解锁');
                // 解锁后如果当前应该是播放状态，则恢复播放
                if (wasPlaying && mediaControlEnabled) {
                    mediaElement.play().catch(() => {});
                }
            }).catch(err => {
                debug.log('音频解锁失败（等待用户交互）:', err);
            });
        }
    }

    // 监听全局触摸/点击事件来解锁音频（只执行一次）
    const unlockEvents = ['touchstart', 'touchend', 'click'];
    unlockEvents.forEach(eventName => {
        document.addEventListener(eventName, function unlockHandler() {
            unlockAudio();
            // 解锁后移除监听器
            if (audioUnlocked) {
                unlockEvents.forEach(e => document.removeEventListener(e, unlockHandler));
            }
        }, { once: true, passive: true });
    });

    /**
     * 生成预览图 URL（带时间戳防缓存）
     */
    function generateCoverUrl() {
        const baseUrl = (window.MPC_CONFIG && window.MPC_CONFIG.previewUrl) 
            ? window.MPC_CONFIG.previewUrl 
            : (location.origin + "/snapshot.jpg");

        // 检测预览基础URL是否发生变化
        if (lastPreviewBaseUrl !== baseUrl) {
            lastCoverUrl = '';
            lastPreviewBaseUrl = baseUrl;
            debug.log('预览基础URL已更新:', baseUrl);
        }

        return `${baseUrl}?t=${Date.now()}`;
    }

    /**
     * 获取部署artwork数组
     */
    function getArtworkArray(url) {
        return [
            { src: url, sizes: '512x512', type: 'image/jpeg' },
            { src: url, sizes: '256x256', type: 'image/jpeg' },
            { src: url, sizes: '128x128', type: 'image/jpeg' }
        ];
    }

    /**
     * 设置/更新媒体元数据
     * @param {string} fileName - 文件名
     * @param {string} folderPath - 文件夹路径
     * @param {string} windowTitle - 窗口标题
     * @param {boolean} forceNewCover - 是否强制使用新封面URL
     */
    function setMetadata(fileName, folderPath, windowTitle, forceNewCover = false) {
        // 如果媒体控制被禁用，不设置元数据
        if (!mediaControlEnabled) return;
        
        if (!fileName) return;

        try {
            // 只有在需要新封面时才生成新URL，否则复用上一次的URL
            if (forceNewCover || !lastCoverUrl) {
                lastCoverUrl = generateCoverUrl();
                debug.log('生成新封面URL:', lastCoverUrl);
            }

            // iOS 不显示 album 字段，所以将路径信息合并到 artist
            const artistText = isIOS 
                ? (folderPath ? `${folderPath}` : 'MPC-HC')
                : (folderPath ? `${folderPath}` : 'MPC-HC');

            navigator.mediaSession.metadata = new MediaMetadata({
                title: fileName,
                artist: artistText,
                album: windowTitle || 'MPC-HC Web Controller',
                artwork: getArtworkArray(lastCoverUrl)
            });
        } catch (e) {
            debug.warn('设置 MediaMetadata 失败:', e);
        }
    }

    /**
     * 根据 MPC-HC 状态控制音频播放/暂停
     */
    function syncAudioWithMpc(isPlaying) {
        // 如果媒体控制被禁用，暂停音频并重置状态
        if (!mediaControlEnabled) {
            mediaElement.pause();
            wasPlaying = false;
            return;
        }
        
        if (isPlaying === wasPlaying) return;

        if (isPlaying) {
            if (!audioUnlocked && isMobile) {
                debug.log('等待用户交互解锁音频...');
                return;
            }
            mediaElement.play().catch(err => {
                debug.log('音频播放被阻止（可能需要用户交互）:', err);
            });
        } else {
            mediaElement.pause();
        }
        wasPlaying = isPlaying;
    }

    function safeSetPositionState(durationSec, positionSec, playbackRate = 1.0) {
        if (!navigator.mediaSession.setPositionState) return;
        
        // 如果媒体控制被禁用，不设置进度状态
        if (!mediaControlEnabled) return;

        try {
            // 移动端要求：
            // 1. duration 必须是正数（> 0）
            // 2. position 必须 >= 0 且 < duration
            // 3. playbackRate 必须 > 0
            
            let safeDuration = Math.max(0.001, durationSec || 0.001); // 最小 0.001 秒
            let safePosition = Math.max(0, Math.min(positionSec || 0, safeDuration - 0.001)); // 确保 position < duration
            let safeRate = Math.max(0.1, playbackRate || 1.0); // 确保 > 0

            // 如果之前没有有效时长，使用上次的有效时长
            if (durationSec <= 0 && lastDurationMs > 0) {
                safeDuration = lastDurationMs / 1000;
                safePosition = Math.min(safePosition, safeDuration - 0.001);
            }

            navigator.mediaSession.setPositionState({
                duration: safeDuration,
                position: safePosition,
                playbackRate: safeRate
            });
        } catch (e) {
            debug.warn('设置进度状态失败:', e);
        }
    }

    /**
     * 更新浏览器媒体会话（仅更新播放状态和进度，不更新封面）
     */
    function updateMediaSession(data) {
        // 如果媒体控制被禁用，不更新会话
        if (!mediaControlEnabled) {
            // 清除现有会话状态
            try {
                navigator.mediaSession.playbackState = 'none';
                navigator.mediaSession.metadata = null;
            } catch (e) {
                debug.warn('清除 MediaSession 失败:', e);
            }
            return;
        }
        
        if (!data) return;

        const isPlaying = data.playStatus === '正在播放';
        const positionMs = data.posMs || 0;
        const durationMs = data.durMs || 0;
        const fileName = (data.filePath || '').split(/[\\\\/]/).pop() || data.windowTitle || '未知文件';
        const folderPath = (data.filePath || '').replace(/[^\\\\/]*$/, '') || '';

        // 保存有效的时长用于后续修复
        if (durationMs > 0) {
            lastDurationMs = durationMs;
        }

        // 同步音频播放状态
        syncAudioWithMpc(isPlaying);

        // 更新播放状态
        try {
            navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
        } catch (e) {
            debug.warn('设置 playbackState 失败:', e);
        }

        // 文件变化检测：只有文件名变化时才更新metadata
        if (fileName !== currentFileName) {
            debug.log('文件变化:', currentFileName, '->', fileName);
            currentFileName = fileName;
            setMetadata(fileName, folderPath, data.windowTitle, false);
        }

        // metadata从未设置过时，初始化一次
        if (!navigator.mediaSession.metadata && fileName) {
            setMetadata(fileName, folderPath, data.windowTitle, true);
            currentFileName = fileName;
        }

        // 更新进度条状态 - 即使 duration 为 0 也使用上次的有效值
        if (lastDurationMs > 0) {
            safeSetPositionState(
                lastDurationMs / 1000,
                Math.min(positionMs / 1000, lastDurationMs / 1000),
                1.0
            );
        } else {
            // 如果连上次有效值也没有，尝试使用当前值（容错）
            safeSetPositionState(durationMs / 1000, positionMs / 1000, 1.0);
        }
    }

    /**
     * 定时器回调：更新封面
     */
    function scheduledCoverUpdate() {
        if (!mediaControlEnabled) return;
        if (!currentFileName || !navigator.mediaSession.metadata) return;

        debug.log('定时更新封面...');
        // 强制生成新URL并更新metadata
        const lastStatus = window.lastMpcStatus;
        if (lastStatus) {
            const folderPath = (lastStatus.filePath || '').replace(/[^\\\\/]*$/, '') || '';
            setMetadata(currentFileName, folderPath, lastStatus.windowTitle, true);
            // 更新封面后也重新设置进度状态
            if (lastDurationMs > 0 && lastStatus.posMs) {
                safeSetPositionState(
                    lastDurationMs / 1000,
                    Math.min(lastStatus.posMs / 1000, lastDurationMs / 1000),
                    1.0
                );
            }
        }
    }

    /**
     * 启动封面定时更新
     */
    function startCoverUpdate() {
        if (window.coverUpdateTimer) {
            clearInterval(window.coverUpdateTimer);
        }
        
        // 如果媒体控制被禁用，不启动定时器
        if (!mediaControlEnabled) return;

        window.coverUpdateTimer = setInterval(scheduledCoverUpdate, COVER_CONFIG.updateInterval);
        debug.log(`封面定时更新已启动，间隔: ${COVER_CONFIG.updateInterval}ms`);
    }

    /**
     * 停止封面定时更新
     */
    function stopCoverUpdate() {
        if (window.coverUpdateTimer) {
            clearInterval(window.coverUpdateTimer);
            window.coverUpdateTimer = null;
            debug.log('封面定时更新已停止');
        }
    }

    // ===== 媒体控制开关功能 =====
    
    /**
     * 启用媒体控制
     */
    function enableMediaControl() {
        mediaControlEnabled = true;
        localStorage.setItem('mediaControlEnabled', 'true');
        updateToggleButtonUI();
        startCoverUpdate();
        debug.log('媒体控制已启用');
        
        // 更新状态提示
        const statusText = document.getElementById('statusText');
        if (statusText) {
            statusText.textContent = '媒体控制已启用';
            setTimeout(() => {
                statusText.textContent = '就绪 - 等待指令操作';
            }, 2000);
        }
    }
    
    /**
     * 禁用媒体控制
     */
    function disableMediaControl() {
        mediaControlEnabled = false;
        localStorage.setItem('mediaControlEnabled', 'false');
        updateToggleButtonUI();
        
        // 停止封面更新
        stopCoverUpdate();
        
        // 停止音频
        mediaElement.pause();
        wasPlaying = false;
        
        // 清除媒体会话
        try {
            navigator.mediaSession.playbackState = 'none';
            navigator.mediaSession.metadata = null;
        } catch (e) {
            debug.warn('清除 MediaSession 失败:', e);
        }
        
        debug.log('媒体控制已禁用');
        
        // 更新状态提示
        const statusText = document.getElementById('statusText');
        if (statusText) {
            statusText.textContent = '媒体控制已禁用';
            setTimeout(() => {
                statusText.textContent = '就绪 - 等待指令操作';
            }, 2000);
        }
    }
    
    /**
     * 切换媒体控制状态
     */
    function toggleMediaControl() {
        if (mediaControlEnabled) {
            disableMediaControl();
        } else {
            enableMediaControl();
        }
    }
    
    /**
     * 更新切换按钮UI
     */
    function updateToggleButtonUI() {
        const btn = document.getElementById('btnToggleMediaControl');
        if (!btn) return;
        
        if (mediaControlEnabled) {
            btn.textContent = '禁用媒体控制';
            btn.classList.remove('disabled');
            btn.classList.add('enabled');
        } else {
            btn.textContent = '启用媒体控制';
            btn.classList.remove('enabled');
            btn.classList.add('disabled');
        }
    }
    
    /**
     * 初始化媒体控制开关按钮
     */
    function initMediaControlToggle() {
        const btn = document.getElementById('btnToggleMediaControl');
        if (!btn) {
            debug.warn('未找到媒体控制开关按钮');
            return;
        }
        
        // 初始化按钮状态
        updateToggleButtonUI();
        
        // 绑定点击事件
        btn.addEventListener('click', toggleMediaControl);
        
        debug.log('媒体控制开关已初始化，当前状态:', mediaControlEnabled ? '启用' : '禁用');
    }

    // ===== 媒体控制事件处理 =====

    /**
     * 发送命令到 MPC-HC
     */
    function sendMpcCommand(command) {
        if (typeof window.sendControlCommand === 'function') {
            window.sendControlCommand(command);
        }
    }

    // 配置媒体控制动作处理器
    // 为移动端优化：iOS 在同时有 seekbackward/seekforward 和 previoustrack/nexttrack 时
    // 会优先显示 seek 按钮。这里根据平台选择注册哪些 handler
    
    const handlers = [
        { action: 'play', command: 887, desc: '播放' },
        { action: 'pause', command: 888, desc: '暂停' },
        { action: 'stop', command: 890, desc: '停止' },
        { action: 'previoustrack', command: 919, desc: '上一个' },
        { action: 'nexttrack', command: 920, desc: '下一个' },
        { action: 'seekbackward', command: 901, desc: '后退' },
        { action: 'seekforward', command: 902, desc: '前进' }
    ];

    handlers.forEach(handler => {
        try {
            // iOS 策略：如果用户想要上一曲/下一曲按钮，就不要注册 seekbackward/seekforward
            // 或者提供选项让用户选择。这里我们保留所有 handler 但注意 iOS 限制
            
            navigator.mediaSession.setActionHandler(handler.action, () => {
                debug.log(`媒体控制: ${handler.desc}`);
                sendMpcCommand(handler.command);
                
                // 执行操作后重置音频解锁状态（某些移动端浏览器需要）
                if (isMobile && !audioUnlocked) {
                    unlockAudio();
                }
            });
        } catch (e) {
            debug.warn(`注册 ${handler.action} 失败:`, e);
        }
    });

    // 处理进度条拖拽跳转
    try {
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (!mediaControlEnabled) return;
            
            if (details.seekTime !== undefined && details.seekTime >= 0) {
                const durationSec = (window.lastMpcDuration || lastDurationMs || 0) / 1000;
                if (durationSec > 0 && typeof window.sendProgressPercentRequest === 'function') {
                    const percent = (details.seekTime / durationSec) * 100;
                    window.sendProgressPercentRequest(percent);
                    
                    // 跳转后更新本地位置状态
                    safeSetPositionState(durationSec, details.seekTime, 1.0);
                }
            }
        });
    } catch (e) {
        debug.log('seekto 不支持:', e.message);
    }

    // ===== 拦截 tools.js 的状态更新 =====

    const originalRenderPlayStatus = window.renderPlayStatus;

    window.renderPlayStatus = function(data) {
        // 先调用原始函数（如果存在且不是当前函数）
        if (originalRenderPlayStatus && originalRenderPlayStatus !== window.renderPlayStatus) {
            originalRenderPlayStatus(data);
        }

        // 更新媒体会话（仅更新播放状态和进度，不更新封面）
        updateMediaSession(data);

        // 保存状态数据和时长
        if (data) {
            window.lastMpcStatus = data;
            if (data.durMs > 0) {
                window.lastMpcDuration = data.durMs;
            }
        }
    };

    // ===== 初始化 =====
    
    // 根据初始状态决定是否启动封面更新
    if (mediaControlEnabled) {
        startCoverUpdate();
    } else {
        // 如果初始为禁用状态，确保清除媒体会话
        try {
            navigator.mediaSession.playbackState = 'none';
            navigator.mediaSession.metadata = null;
        } catch (e) {
            debug.warn('初始清除 MediaSession 失败:', e);
        }
    }
    
    // 初始化开关按钮（确保DOM已加载）
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMediaControlToggle);
    } else {
        initMediaControlToggle();
    }

    window.addEventListener('beforeunload', () => {
        stopCoverUpdate();
    });

    debug.log('Media Session 集成已加载');
    debug.log('移动端检测:', isMobile, 'iOS:', isIOS);
    debug.log('媒体控制状态:', mediaControlEnabled ? '启用' : '禁用');
    window.COVER_CONFIG = COVER_CONFIG;
    
    // 暴露解锁函数供外部调用（如用户点击播放按钮时）
    window.unlockMediaAudio = unlockAudio;
    
    // 暴露媒体控制开关函数供外部调用
    window.toggleMediaControl = toggleMediaControl;
    window.enableMediaControl = enableMediaControl;
    window.disableMediaControl = disableMediaControl;
})();