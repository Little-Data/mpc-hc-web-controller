(() => {
  const STORAGE_KEY = 'mpcSkipRules';
  const ruleList    = document.getElementById('skipRuleList');
  const addBtn      = document.getElementById('btnAddSkipRule');

  /* 读写 */
  function loadRules() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return raw.map(r => ({ ...r, enabled: r.enabled !== false }));
    } catch { return []; }
  }
  function saveRules(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  /* 渲染 */
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

    // 启用/禁用
    ruleList.querySelectorAll('.cb-skip-enable').forEach(cb =>
      cb.addEventListener('change', e => {
        const rules = loadRules();
        rules[+e.target.dataset.idx].enabled = e.target.checked;
        saveRules(rules);
      })
    );

    // 删除
    ruleList.querySelectorAll('.btn-del').forEach(b =>
      b.addEventListener('click', e => {
        if (!confirm('确定删除这条跳过规则？')) return;
        const rules = loadRules();
        rules.splice(+e.target.dataset.idx, 1);
        saveRules(rules);
        renderRules();
      })
    );
    /* ===== 导入/导出跳过规则 ===== */
    const bar = document.createElement('div');
    bar.className = 'custom-bar';
    bar.style.cssText = 'margin-top:8px;display:flex;gap:8px;flex-wrap:wrap';
    bar.innerHTML = `
        <button class="control-btn" id="btnExportSkip">导出 JSON</button>
        <label class="control-btn" style="cursor:pointer">
        导入 JSON
        <input type="file" id="inpImportSkip" accept=".json" style="display:none">
        </label>`;
    // 先清掉旧按钮栏（避免重复）
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
            renderRules();   // 重新渲染
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

        /* === 文件夹路径 === */
        const newFolderRaw = prompt('文件夹路径（留空为所有情况）', r.folder);
        if (newFolderRaw === null) return;          // 点“取消”直接退出
        const newFolder = newFolderRaw.trim();      // 空字符串代表“所有情况”

        /* === 片头结束时间 === */
        const startRaw = prompt('片头结束时间', r.start);
        if (startRaw === null || startRaw.trim() === '') return; // 取消或空即退出

        /* === 片尾开始时间 === */
        const endRaw = prompt('片尾开始时间', r.end);
        if (endRaw === null || endRaw.trim() === '') return;

        /* 以下保持原逻辑 */
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
    if (!window.currentFullPath) await getPlayStatus();

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

  renderRules();
})();
