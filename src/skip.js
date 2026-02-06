(() => {
  const STORAGE_KEY = 'mpcSkipRules';
  const ruleList    = document.getElementById('skipRuleList');
  const addBtn      = document.getElementById('btnAddSkipRule');

  /* 状态追踪 */
  const state = {
    lastFilePath: '',      // 上一次处理的文件路径
    lastPosMs: 0,          // 上一次播放位置（毫秒）
    enableConsole: false,  // 是否显示控制台调试信息
    skipInProgress: false, // 是否正在执行跳过操作（防止重复发送）
    lastSkipTime: 0,       // 上次跳过操作的时间戳
    skipCooldownMs: 100,  // 跳过冷却时间（毫秒），防止重复触发
  };

  // 日志输出封装
  const debug = {
      log: function(...args) {
          if (state.enableConsole) {
              console.log(...args);
          }
      },
  };

  /* 读写规则 */
  function loadRules() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return raw.map(r => ({ ...r, enabled: r.enabled !== false }));
    } catch { return []; }
  }

  function saveRules(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  /* 时间解析辅助函数 */

  /**
   * 解析时间区间字符串
   * 支持格式：
   * - "HH:MM:SS" 或 "MM:SS" 或 "SS" → 单点时间
   * - "HH:MM:SS-HH:MM:SS" → 时间区间
   * @param {string} raw - 原始输入字符串
   * @returns {Object|null} {start: ms, end: ms} 或 null（单点时间返回 {point: ms}）
   */
  function parseTimeRange(raw) {
    if (typeof raw !== 'string') return null;
    const s = raw.trim();

    // 检查是否是区间格式（包含 - 或 ~ 或 至）
    const rangeDelimiters = /[-~至]/;
    if (rangeDelimiters.test(s)) {
      const parts = s.split(rangeDelimiters).map(p => p.trim());
      if (parts.length === 2) {
        const startMs = timeStrToMs(parts[0]);
        const endMs = timeStrToMs(parts[1]);
        if (startMs !== null && endMs !== null && startMs < endMs) {
          return { start: startMs, end: endMs, isRange: true };
        }
      }
      return null;
    }

    // 单点时间
    const ms = timeStrToMs(s);
    return ms !== null ? { point: ms, isRange: false } : null;
  }

  /**
   * 将时间区间或单点时间格式化为标准显示字符串
   */
  function formatTimeRange(rangeObj) {
    if (!rangeObj) return '';
    if (rangeObj.isRange) {
      return `${msToTimeStr(rangeObj.start)} - ${msToTimeStr(rangeObj.end)}`;
    }
    return msToTimeStr(rangeObj.point);
  }

  /**
   * 毫秒转 HH:MM:SS
   */
  function msToTimeStr(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
  }

  /**
   * 标准时间字符串转毫秒
   */
  function timeStrToMs(str) {
    if (!str || typeof str !== 'string') return null;
    let s = str.trim();

    // 纯数字 → 秒（如 120 → 00:02:00）
    if (/^\d+$/.test(s)) {
      return parseInt(s, 10) * 1000;
    }

    // 处理 M:S 格式（如 2:6 → 02:06，即 2分6秒）
    if (/^\d+:\d+$/.test(s)) {
      const parts = s.split(':').map(Number);
      const m = parts[0];
      const sec = parts[1];
      return (m * 60 + sec) * 1000;
    }

    const parts = s.split(':').map(Number);
    if (parts.some(isNaN)) return null;

    let h = 0, m = 0, sec = 0;
    if (parts.length === 3) {
      [h, m, sec] = parts;
    } else if (parts.length === 1) {
      [sec] = parts;
    } else {
      return null;
    }

    // 进位处理
    if (sec >= 60) { m += Math.floor(sec / 60); sec %= 60; }
    if (m >= 60) { h += Math.floor(m / 60); m %= 60; }

    return (h * 3600 + m * 60 + sec) * 1000;
  }

  /* 跨区间检测逻辑 */

  /**
   * 检查并执行跳过（由 tools.js 每帧调用）
   * @param {Object} data - 播放状态数据
   * @param {number} data.posMs - 当前位置（毫秒）
   * @param {string} data.filePath - 文件完整路径
   * @param {number} data.durMs - 总时长（毫秒）
   * @param {string} data.playStatus - 播放状态（正在播放/暂停等）
   * @param {Function} sendCommand - 发送命令的回调(cmdId)
   * @param {Function} sendPercent - 发送进度跳转的回调(percent)
   */
  window.performSkipCheck = function(data, sendCommand, sendPercent) {
    if (!data || data.playStatus !== '正在播放' || !data.durMs) return;

    const now = Date.now();
    const filePath = data.filePath || '';
    const currentPos = data.posMs || 0;

    // 检查是否在冷却期内
    if (state.skipInProgress || (now - state.lastSkipTime) < state.skipCooldownMs) {
      // 冷却期内只更新位置，不执行跳过检查
      state.lastPosMs = currentPos;
      return;
    }

    // 检测文件变化：路径不同或位置突变（相差超过10秒认为是新文件/手动跳转）
    const isNewFile = filePath !== state.lastFilePath || 
                      Math.abs(currentPos - state.lastPosMs) > 10000;

    if (isNewFile) {
      state.lastFilePath = filePath;

      if (currentPos < 500) {
        const skip = window.getSkipRuleFor?.(filePath);
        if (skip && skip.enabled) {
          // 解析片头设置
          const headRange = parseTimeRange(skip.start);
          let headEndMs = null;

          if (headRange) {
            if (headRange.isRange) {
              // 区间格式：跳到区间结束点
              headEndMs = headRange.end;
            } else {
              // 单点时间：片头结束时间
              headEndMs = headRange.point;
            }
          }

          // 防御检查确保片头时间有效
          if (headEndMs !== null && headEndMs > currentPos && data.durMs > 0) {
            // 设置跳过标志，防止重复发送
            state.skipInProgress = true;
            state.lastSkipTime = now;
            
            sendPercent((headEndMs / data.durMs) * 100);
            state.lastPosMs = headEndMs;
            debug.log(`[Skip] 新文件片头跳过: 跳转到 ${msToTimeStr(headEndMs)}`);
            
            // 延迟清除跳过标志（确保命令已处理）
            setTimeout(() => {
              state.skipInProgress = false;
            }, 500);
            return;
          }
        }
      }

      // 其他情况记录位置后返回
      state.lastPosMs = currentPos;
      return;
    }

    const skip = window.getSkipRuleFor?.(filePath);
    if (!skip || !skip.enabled) {
      state.lastPosMs = currentPos;
      return;
    }

    // 解析片头和片尾设置
    const headRange = parseTimeRange(skip.start);
    const tailRange = parseTimeRange(skip.end);

    /* 片头跳过逻辑 */
    if (headRange) {
      let shouldSkip = false;
      let targetMs = null;

      if (headRange.isRange) {
        // 区间逻辑：当前在片头区间起点和终点之间时，跳到终点
        if (currentPos >= headRange.start && currentPos < headRange.end) {
          shouldSkip = true;
          targetMs = headRange.end;
        }
      } else {
        // 单点逻辑：当前在片头结束时间之前，且播放位置小于5秒时触发
        if (currentPos < headRange.point && currentPos < 5000) {
          shouldSkip = true;
          targetMs = headRange.point;
        }
      }

      if (shouldSkip && targetMs !== null && targetMs > currentPos) {
        // 设置跳过标志，防止重复发送
        state.skipInProgress = true;
        state.lastSkipTime = now;
        
        sendPercent((targetMs / data.durMs) * 100);
        debug.log(`[Skip] 片头跳过: ${formatTimeRange(headRange)} -> 跳转到 ${msToTimeStr(targetMs)}`);
        state.lastPosMs = targetMs;
        
        // 延迟清除跳过标志
        setTimeout(() => {
          state.skipInProgress = false;
        }, 500);
        return;
      }
    }

    /* 片尾跳过逻辑 */
    if (tailRange) {
      let shouldSkip = false;
      let targetMs = null;

      if (tailRange.isRange) {
        // 区间逻辑：当前在片尾区间起点和终点之间时，跳到终点
        if (currentPos >= tailRange.start && currentPos < tailRange.end) {
          shouldSkip = true;
          targetMs = tailRange.end;
        }
      } else {
        // 单点逻辑：上一次在片尾点之前，当前已到或超过片尾点
        if (state.lastPosMs < tailRange.point && currentPos >= tailRange.point) {
          shouldSkip = true;
          targetMs = null; // 旧逻辑触发下一文件
        }
      }

      if (shouldSkip) {
        // 设置跳过标志，防止重复发送
        state.skipInProgress = true;
        state.lastSkipTime = now;
        
        if (targetMs !== null) {
          // 区间逻辑：跳转到片尾区间结束点
          sendPercent((targetMs / data.durMs) * 100);
          debug.log(`[Skip] 片尾区间跳过: ${formatTimeRange(tailRange)} -> 跳转到 ${msToTimeStr(targetMs)}`);
          state.lastPosMs = targetMs;
        } else {
          // 单点逻辑：触发下一文件
          sendCommand(920);
          debug.log(`[Skip] 片尾跳过: 检测到跨越 ${msToTimeStr(tailRange.point)}，触发下一集`);
        }
        
        // 延迟清除跳过标志（片尾跳过需要更长冷却时间）
        setTimeout(() => {
          state.skipInProgress = false;
        }, 1000);
        return;
      }
    }

    // 保存当前位置供下次比较
    state.lastPosMs = currentPos;
  };

  window.performSkipCheck = performSkipCheck;

  /* 渲染规则列表 */
  function renderRules() {
    const rules = loadRules();
    ruleList.innerHTML = '';
    rules.forEach((r, idx) => {
      const card     = document.createElement('div');
      card.className = 'custom-card';
      const folderText = r.folder === '' ? '（所有情况）' : r.folder;

      // 格式化显示时间
      const headDisplay = r.start ? formatTimeDisplay(r.start) : '（未设置）';
      const tailDisplay = r.end ? formatTimeDisplay(r.end) : '（未设置）';

      card.innerHTML = `
        <label style="flex:1;display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" class="cb-skip-enable" data-idx="${idx}"
                 ${r.enabled ? 'checked' : ''}>
          <span>${folderText}  |  片头: ${headDisplay}  |  片尾: ${tailDisplay}</span>
        </label>
        <div style="display:flex;gap:6px">
          <button class="control-btn" data-idx="${idx}" onclick="editSkipRule(${idx})">编辑</button>
          <button class="control-btn btn-del" data-idx="${idx}">删除</button>
        </div>`;
      ruleList.appendChild(card);
    });

    // 启用/禁用开关
    ruleList.querySelectorAll('.cb-skip-enable').forEach(cb =>
      cb.addEventListener('change', e => {
        const rules = loadRules();
        rules[+e.target.dataset.idx].enabled = e.target.checked;
        saveRules(rules);
      })
    );

    // 删除按钮
    ruleList.querySelectorAll('.btn-del').forEach(b =>
      b.addEventListener('click', e => {
        if (!confirm('确定删除这条跳过规则？')) return;
        const rules = loadRules();
        rules.splice(+e.target.dataset.idx, 1);
        saveRules(rules);
        renderRules();
      })
    );

    /* 导入/导出栏 */
    const bar = document.createElement('div');
    bar.className = 'custom-bar';
    bar.style.cssText = 'margin-top:8px;display:flex;gap:8px;flex-wrap:wrap';
    bar.innerHTML = `
        <button class="control-btn" id="btnExportSkip">导出 JSON</button>
        <label class="control-btn" style="cursor:pointer">
        导入 JSON
        <input type="file" id="inpImportSkip" accept=".json" style="display:none">
        </label>`;
    const oldBar = ruleList.parentNode.querySelector('.custom-bar');
    if (oldBar) oldBar.remove();
    ruleList.after(bar);

    /* 导出 */
    document.getElementById('btnExportSkip').addEventListener('click', () => {
      const rules = loadRules();
      if (!rules.length) return alert('暂无跳过规则可导出');

      // 转换为标准格式导出
      const standardRules = rules.map(r => {
        // 转换时间为标准格式 00:00:00
        const convertToStandard = (raw) => {
          if (!raw) return '';
          const rangeObj = parseTimeRange(raw);
          if (rangeObj) {
            return formatTimeRange(rangeObj);
          }
          return raw;
        };

        return {
          folder: r.folder,
          start: convertToStandard(r.start),
          end: convertToStandard(r.end),
          enabled: r.enabled
        };
      });

      const blob = new Blob([JSON.stringify(standardRules, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'mpc-skip-rules.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });

    /* 导入 */
    document.getElementById('inpImportSkip').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const arr = JSON.parse(reader.result);
          if (!Array.isArray(arr)) throw new Error('格式错误');
          arr.forEach((r, i) => {
            if (typeof r.folder !== 'string' ||
                typeof r.start !== 'string' ||
                typeof r.end !== 'string') {
              throw new Error(`第 ${i + 1} 条字段缺失`);
            }
            // 验证时间格式（支持区间或单点时间）
            const headValid = parseTimeRange(r.start) !== null;
            const tailValid = parseTimeRange(r.end) !== null;
            if (!headValid || !tailValid) {
              throw new Error(`第 ${i + 1} 条时间格式无效，支持格式如：02:30 或 01:45-02:50`);
            }
            r.enabled = Boolean(r.enabled);
          });
          const merge = confirm(`共 ${arr.length} 条规则。
“确定”覆盖现有，“取消”合并追加。`);
          const rules = merge ? arr : [...loadRules(), ...arr];
          saveRules(rules);
          renderRules();
        } catch (err) {
          alert('导入失败：' + err.message);
        } finally {
          e.target.value = '';
        }
      };
      reader.readAsText(file);
    });
  }

  /**
   * 将输入的时间格式化为标准显示格式 00:00:00
   * 支持区间显示
   */
  function formatTimeDisplay(raw) {
    if (!raw) return '';
    const rangeObj = parseTimeRange(raw);
    if (rangeObj) {
      return formatTimeRange(rangeObj);
    }
    // 如果解析失败，返回原始值
    return raw;
  }

  function normalizeTimeStr(raw) {
    if (typeof raw !== 'string') return null;
    const s = raw.trim();
    // 纯数字 → 秒
    if (/^\d+$/.test(s)) {
      const sec = parseInt(s, 10);
      return [0, 0, sec];
    }
    // 已有 : 分隔
    const p = s.split(':').map(Number);
    if (p.some(isNaN)) return null;
    const len = p.length;
    if (len === 2) return [0, p[0], p[1]];          // MM:SS
    if (len === 3) return [p[0], p[1], p[2]];        // HH:MM:SS
    return null;
  }

  function toStandardTimeStr(raw) {
    const arr = normalizeTimeStr(raw);
    if (!arr) return null;
    let [h, m, sec] = arr;
    // 进位
    if (sec >= 60) { m += Math.floor(sec / 60); sec %= 60; }
    if (m >= 60) { h += Math.floor(m / 60); m %= 60; }
    return [h, m, sec]
      .map(v => v.toString().padStart(2, '0'))
      .join(':');
  }

  /* 全局函数：编辑规则（含文件夹路径） */
  window.editSkipRule = function (idx) {
    const rules = loadRules();
    const r = rules[idx];
    if (!r) return;

    const newFolderRaw = prompt('文件夹路径（留空为所有情况）', r.folder);
    if (newFolderRaw === null) return;
    const newFolder = newFolderRaw.trim();

    const startRaw = prompt(
      '片头设置\n支持格式：\n- 单时间：02:50 表示片头结束时间\n- 区间：01:45-02:50 表示播放到01:45时跳转到02:50', 
      r.start
    );
    if (startRaw === null || startRaw.trim() === '') return;

    const endRaw = prompt(
      '片尾设置\n支持格式：\n- 单时间：20:32 表示片尾开始时间，到达后触发下一集\n- 区间：20:32-22:42 表示播放到20:32时跳转到22:42', 
      r.end
    );
    if (endRaw === null || endRaw.trim() === '') return;

    const start = startRaw.trim();
    const end = endRaw.trim();

    // 验证格式
    if (!parseTimeRange(start)) {
      alert('片头时间格式无效！\n支持格式如：02:30 或 01:45-02:50');
      return;
    }
    if (!parseTimeRange(end)) {
      alert('片尾时间格式无效！\n支持格式如：20:32 或 20:32-22:42');
      return;
    }

    rules[idx] = { ...r, folder: newFolder, start, end };
    saveRules(rules);
    renderRules();
    // 重置状态缓存，确保新规则立即生效
    state.lastFilePath = '';
  };

  /* 新增规则 */
  addBtn.addEventListener('click', async () => {
    if (!window.currentFullPath) {
      // 尝试触发一次状态更新获取路径
      if (typeof getPlayStatus === 'function') await getPlayStatus();
    }

    const startRaw = prompt(
      '片头设置\n支持格式：\n- 单时间：02:50 表示片头结束时间\n- 区间：01:45-02:50 表示播放到01:45时跳转到02:50\n留空表示不设置片头'
    );
    if (startRaw === null) return;

    const endRaw = prompt(
      '片尾设置\n支持格式：\n- 单时间：20:32 表示片尾开始时间\n- 区间：20:32-22:42 表示播放到20:32时跳转到22:42\n留空表示不设置片尾'
    );
    if (endRaw === null) return;

    const start = startRaw.trim();
    const end = endRaw.trim();

    // 验证格式（如果输入了内容）
    if (start && !parseTimeRange(start)) {
      alert('片头时间格式无效！\n支持格式如：02:30 或 01:45-02:50');
      return;
    }
    if (end && !parseTimeRange(end)) {
      alert('片尾时间格式无效！\n支持格式如：20:32 或 20:32-22:42');
      return;
    }

    const rules = loadRules();
    rules.push({ folder: currentFolder(), start, end, enabled: true });
    saveRules(rules);
    renderRules();
    // 重置状态缓存，确保新规则立即生效
    state.lastFilePath = '';
  });

  /**
   * 获取当前文件夹的相对路径
   */
  function currentFolder() {
    if (!window.currentFullPath) return '';
    // 统一处理斜杠
    const path = window.currentFullPath.replace(/\//g, '\\');
    const lastSlash = path.lastIndexOf('\\');
    if (lastSlash === -1) return '';
    const dirPath = path.slice(0, lastSlash);
    // 获取最后一级文件夹名
    const lastDirSlash = dirPath.lastIndexOf('\\');
    if (lastDirSlash === -1) return dirPath;
    return dirPath.slice(lastDirSlash + 1);
  }

  /**
   * 获取文件所在文件夹的相对路径
   * 用于规则匹配
   */
  function getFolderNameFromPath(filePath) {
    if (!filePath) return '';
    // 统一处理斜杠
    const path = filePath.replace(/\//g, '\\');
    const lastSlash = path.lastIndexOf('\\');
    if (lastSlash === -1) return '';
    const dirPath = path.slice(0, lastSlash);
    // 获取最后一级文件夹名
    const lastDirSlash = dirPath.lastIndexOf('\\');
    if (lastDirSlash === -1) return dirPath;
    return dirPath.slice(lastDirSlash + 1);
  }

  /* 对外：返回当前文件匹配到的“启用”规则 */
  window.getSkipRuleFor = function (filePath) {
    if (!filePath) return null;
    // 使用相对路径匹配
    const folderName = getFolderNameFromPath(filePath);
    return loadRules().find(r => r.enabled && (r.folder === '' || r.folder === folderName)) || null;
  };

  // 初始化渲染
  renderRules();
})();
