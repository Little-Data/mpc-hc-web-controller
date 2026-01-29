(() => {
  const STORAGE_KEY = 'mpcSkipRules';
  const ruleList    = document.getElementById('skipRuleList');
  const addBtn      = document.getElementById('btnAddSkipRule');

  /* 状态追踪 */
  const state = {
    lastFilePath: '',      // 上一次处理的文件路径
    lastPosMs: 0,          // 上一次播放位置（毫秒）
    enableConsole: false, // 是否显示控制台调试信息
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
    
    const filePath = data.filePath || '';
    const currentPos = data.posMs || 0;
    
    // 检测文件变化：路径不同或位置突变（相差超过10秒认为是新文件/手动跳转）
    const isNewFile = filePath !== state.lastFilePath || 
                      Math.abs(currentPos - state.lastPosMs) > 10000;
    
  if (isNewFile) {
    state.lastFilePath = filePath;
    
    if (currentPos < 500) {
      const skip = window.getSkipRuleFor?.(filePath);
      if (skip && skip.enabled) {
        const startMs = timeStrToMs(skip.start);
        const endMs = timeStrToMs(skip.end);
        
        // 防御检查确保片头时间有效
        if (startMs > currentPos && startMs < endMs && data.durMs > 0) {
          sendPercent((startMs / data.durMs) * 100);
          state.lastPosMs = startMs;
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

    const startMs = timeStrToMs(skip.start);
    const endMs = timeStrToMs(skip.end);

    // 防御：片头时间应小于片尾时间
    if (startMs >= endMs) {
      state.lastPosMs = currentPos;
      return;
    }

    /* 片头跳过 */
    // 当前在片头区域内 且 不是从片头后跳转回来的
    if (currentPos < startMs && currentPos < 5000) {
      sendPercent((startMs / data.durMs) * 100);
      debug.log(`[Skip] 片头跳过: ${skip.start} -> 跳转到片头结束`);
    }

    /* 片尾跳过 */
    // 上一次在片尾前 且 当前已到或超过片尾点
    if (state.lastPosMs < endMs && currentPos >= endMs) {
      sendCommand(920); // 下一文件
      debug.log(`[Skip] 片尾跳过: 检测到跨越 ${skip.end}，触发下一集`);
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
      card.innerHTML = `
        <label style="flex:1;display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" class="cb-skip-enable" data-idx="${idx}"
                 ${r.enabled ? 'checked' : ''}>
          <span>${folderText}  |  片头结束 ${r.start}  |  片尾开始 ${r.end}</span>
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
      const blob = new Blob([JSON.stringify(rules, null, 2)], { type: 'application/json' });
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
                !/^\d{2}:\d{2}:\d{2}$/.test(r.start) ||
                !/^\d{2}:\d{2}:\d{2}$/.test(r.end)) {
              throw new Error(`第 ${i + 1} 条字段缺失或时间格式不对`);
            }
            r.enabled = Boolean(r.enabled);
          });
          const merge = confirm(`共 ${arr.length} 条规则。\n“确定”覆盖现有，“取消”合并追加。`);
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

    const startRaw = prompt('片头结束时间', r.start);
    if (startRaw === null || startRaw.trim() === '') return;

    const endRaw = prompt('片尾开始时间', r.end);
    if (endRaw === null || endRaw.trim() === '') return;

    const start = toStandardTimeStr(startRaw.trim());
    const end = toStandardTimeStr(endRaw.trim());
    if (!start || !end) {
      alert('时间格式无效！');
      return;
    }
    rules[idx] = { ...r, folder: newFolder, start, end };
    saveRules(rules);
    renderRules();
  };

  /* 新增规则 */
  addBtn.addEventListener('click', async () => {
    if (!window.currentFullPath) {
      // 尝试触发一次状态更新获取路径
      if (typeof getPlayStatus === 'function') await getPlayStatus();
    }

    const startRaw = prompt('片头结束时间');
    if (startRaw === null || startRaw.trim() === '') return;

    const endRaw = prompt('片尾开始时间');
    if (endRaw === null || endRaw.trim() === '') return;

    const start = toStandardTimeStr(startRaw.trim());
    const end   = toStandardTimeStr(endRaw.trim());
    if (!start || !end) {
      alert('时间格式无效！');
      return;
    }

    const rules = loadRules();
    rules.push({ folder: currentFolder(), start, end, enabled: true });
    saveRules(rules);
    renderRules();
  });

  function currentFolder() {
    if (!window.currentFullPath) return '';
    const last = window.currentFullPath.lastIndexOf('\\');
    return last === -1 ? '' : window.currentFullPath.slice(0, last);
  }

  /* 对外：返回当前文件匹配到的“启用”规则 */
  window.getSkipRuleFor = function (filePath) {
    if (!filePath) return null;
    const folder = filePath.lastIndexOf('\\') === -1
                ? ''
                : filePath.slice(0, filePath.lastIndexOf('\\'));
    return loadRules().find(r => r.enabled && (r.folder === '' || r.folder === folder)) || null;
  };

  // 初始化渲染
  renderRules();
})();