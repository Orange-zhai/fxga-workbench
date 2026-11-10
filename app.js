/* =========================================================================
 * 工单分析工作台
 * 业务交互：筛选联动、多选下拉、扇区下钻、诉求人下探、预警明细、重点事项。
 * ========================================================================= */
(function () {
  'use strict';

  var D = window.APP_DATA;
  var C = window.WBCharts;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var esc = C.esc;

  var CATEGORIES = D.CATEGORIES;
  var TYPES = D.TYPES;
  var SOURCES = D.SOURCES;
  var TYPE_OPTIONS = TYPES.map(function (d) { return { name: d.name, value: d.value }; });

  var state = {
    level: '1',
    focus: D.FOCUS_SEED.map(cloneFocus),
    catFilter: 'all',
    orgFilter: 'all',
    types: [],
    kw: '',
    dateStart: '2026-09-01',
    dateEnd: '2026-09-30',
    sortKey: 'count',
    sortDir: 'desc',
    person: '2219',
    repeatSet: 'repeat',
    sameSet: 'same',
    catDrill: null,
    personDrill: false,
    pointDrill: null,
    orders: { items: [], page: 1, size: 10 },
    editingIndex: -1
  };

  function cloneFocus(item) {
    return {
      name: item.name, cat: item.cat, count: item.count, yoy: item.yoy, mom: item.mom,
      tags: (item.tags || []).slice(), includes: (item.includes || []).slice(),
      excludes: (item.excludes || []).slice(), units: (item.units || []).slice(),
      note: item.note
    };
  }

  /* ----------------------------- 通用 ----------------------------- */

  function fmtDate(v) { return v ? v.replace(/-/g, '/') : '—'; }

  function fmtRange() { return fmtDate(state.dateStart) + ' – ' + fmtDate(state.dateEnd); }

  function toast(msg, actionLabel, action) {
    var region = $('#toast-region');
    var node = document.createElement('div');
    node.className = 'toast';
    node.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#i-check"/></svg><span></span>';
    node.querySelector('span').textContent = msg;
    if (actionLabel) {
      var btn = document.createElement('button');
      btn.className = 'link-btn';
      btn.type = 'button';
      btn.textContent = actionLabel;
      btn.addEventListener('click', function () { action(); node.remove(); });
      node.appendChild(btn);
    }
    region.appendChild(node);
    window.setTimeout(function () { node.remove(); }, actionLabel ? 6000 : 3200);
  }

  function pseudoDelta(name) {
    var n = 0;
    for (var i = 0; i < name.length; i++) n += name.charCodeAt(i);
    return {
      yoy: (n % 2 ? '+' : '-') + ((n % 25 + 3) / 10).toFixed(1) + '%',
      mom: (n % 3 ? '+' : '-') + ((n % 17 + 2) / 10).toFixed(1) + '%'
    };
  }

  /* ----------------------------- 下探数据构造 ----------------------------- */

  function hashStr(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) % 99991;
    return n;
  }

  /* 按权重拆分整件数，保证拆分后合计与所点元素件数一致 */
  function partition(total, weights) {
    var sum = weights.reduce(function (s, w) { return s + w; }, 0) || 1;
    var out = weights.map(function (w) { return Math.floor(total * w / sum); });
    var rest = total - out.reduce(function (s, v) { return s + v; }, 0);
    var i = 0;
    while (rest > 0 && out.length) {
      out[i % out.length] += 1;
      rest -= 1;
      i += 1;
    }
    return out;
  }

  function weightedSeries(pairs, total, limit) {
    var list = pairs.slice(0, limit || pairs.length);
    if (!list.length) return [];
    var vals = partition(total, list.map(function (p) { return p.w; }));
    return list.map(function (p, i) { return { name: p.n, value: vals[i] }; });
  }

  function subWeights(cat) {
    var subs = D.SUBS[cat] || [];
    var pairs = subs.map(function (s) {
      var row = CATEGORIES['2'].items.filter(function (d) { return d.name === s; })[0];
      return { n: s, w: row ? row.value : 3 };
    });
    return pairs.length ? pairs : [{ n: cat || '综合受理', w: 1 }];
  }

  function pointWeights(cat) {
    var pairs = [];
    D.WARNINGS.forEach(function (r) {
      if (cat && r.cat !== cat) return;
      var hit = pairs.filter(function (p) { return p.n === r.point; })[0];
      if (hit) hit.w += r.count;
      else pairs.push({ n: r.point, w: r.count });
    });
    pairs.sort(function (a, b) { return b.w - a.w; });
    D.POINTS.forEach(function (p) {
      if (pairs.length < 4 && !pairs.some(function (x) { return x.n === p.n; })) {
        pairs.push({ n: p.n, w: Math.max(1, Math.round(p.v / 8)) });
      }
    });
    return pairs.slice(0, 4);
  }

  function unitWeights(cat) {
    var main = D.ORG_BY_CAT[cat] || '市城市管理局';
    var pool = D.ORG_OPTIONS.filter(function (o) { return o !== main; });
    var start = hashStr(cat) % pool.length;
    return [
      { n: main, w: 6 },
      { n: pool[start], w: 3 },
      { n: pool[(start + 4) % pool.length], w: 2 }
    ];
  }

  /* ----------------------------- 筛选 ----------------------------- */

  function currentWarnings() {
    return D.WARNINGS.filter(function (r) {
      if (state.catFilter !== 'all' && r.cat !== state.catFilter) return false;
      if (state.orgFilter !== 'all' && r.org !== state.orgFilter) return false;
      if (state.types.length && state.types.indexOf(r.type) === -1) return false;
      if (state.kw) {
        var kw = state.kw.toLowerCase();
        if ((r.point + r.cat + r.org + r.type).toLowerCase().indexOf(kw) === -1) return false;
      }
      var day = r.time.slice(0, 10);
      if (state.dateStart && day < state.dateStart) return false;
      if (state.dateEnd && day > state.dateEnd) return false;
      return true;
    });
  }

  function hasFilter() {
    return state.catFilter !== 'all' || state.orgFilter !== 'all' || state.types.length > 0 ||
      !!state.kw || state.dateStart !== '2026-09-01' || state.dateEnd !== '2026-09-30';
  }

  /* ----------------------------- 工单类型多选 ----------------------------- */

  function renderTypeTrigger() {
    var value = $('#type-value');
    var clear = $('#type-clear-inline');
    if (!state.types.length) {
      value.textContent = '全部类型';
      clear.hidden = true;
    } else {
      value.textContent = '已选 ' + state.types.length + ' 项' +
        (state.types.length <= 2 ? ' · ' + state.types.join('、') : '');
      clear.hidden = false;
    }
    $('#type-count').textContent = '已选 ' + state.types.length + ' 项';
    $('#type-trigger').setAttribute('aria-label', '工单类型，' + (state.types.length ? state.types.join('、') : '全部类型'));
  }

  function renderTypeList() {
    var kw = ($('#type-search').value || '').trim().toLowerCase();
    var list = TYPE_OPTIONS.filter(function (d) { return !kw || d.name.toLowerCase().indexOf(kw) > -1; });
    var box = $('#type-list');
    if (!list.length) {
      box.innerHTML = '<li><p class="dropdown-empty">没有匹配的工单类型</p></li>';
      return;
    }
    box.innerHTML = list.map(function (d) {
      var on = state.types.indexOf(d.name) > -1;
      return '<li><button type="button" class="opt" role="option" aria-selected="' + on + '" data-name="' + esc(d.name) + '">' +
        '<span class="box"><svg class="ico" aria-hidden="true"><use href="#i-check"/></svg></span>' +
        '<span class="opt-n">' + esc(d.name) + '</span>' +
        '<span class="opt-v">' + d.value + ' 件</span></button></li>';
    }).join('');
    $$('#type-list .opt').forEach(function (btn) {
      btn.addEventListener('click', function () { toggleType(btn.getAttribute('data-name')); });
    });
  }

  function setTypes(list) {
    state.types = list.slice();
    renderTypeTrigger();
    renderTypeList();
    renderTable();
  }

  function toggleType(name) {
    var i = state.types.indexOf(name);
    if (i > -1) state.types.splice(i, 1);
    else state.types.push(name);
    renderTypeTrigger();
    renderTypeList();
    renderTable();
  }

  function openTypePanel(open) {
    var panel = $('#type-panel');
    if (open) {
      $('#type-search').value = '';
      renderTypeList();
    }
    panel.hidden = !open;
    $('#type-trigger').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) window.setTimeout(function () { $('#type-search').focus(); }, 20);
  }

  /* ------------------- 单选下拉：统一白色菜单（与工单类型下拉一致） ------------------- */

  var SELECT_UI = {};

  function selectOptionHtml(sel) {
    var html = [];
    for (var i = 0; i < sel.options.length; i++) {
      var o = sel.options[i];
      html.push('<li><button type="button" class="opt" role="option" data-v="' + esc(o.value) + '"' +
        ' aria-selected="' + (i === sel.selectedIndex ? 'true' : 'false') + '">' +
        '<span class="opt-n">' + esc(o.text) + '</span>' +
        '<svg class="ico opt-check" aria-hidden="true"><use href="#i-check"/></svg></button></li>');
    }
    return html.join('');
  }

  function syncSelect(id) {
    var ui = SELECT_UI[id];
    if (!ui) return;
    var opt = ui.sel.options[ui.sel.selectedIndex];
    ui.valueEl.textContent = opt ? opt.text : '';
    ui.valueEl.classList.toggle('is-empty', !!opt && opt.value === '');
    $$('.opt', ui.list).forEach(function (btn) {
      btn.setAttribute('aria-selected', btn.getAttribute('data-v') === ui.sel.value ? 'true' : 'false');
    });
  }

  function bindSelectOptions(id) {
    var ui = SELECT_UI[id];
    $$('.opt', ui.list).forEach(function (btn) {
      btn.addEventListener('click', function () {
        ui.sel.value = btn.getAttribute('data-v');
        syncSelect(id);
        closeSelects();
        ui.trigger.focus();
        ui.sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
  }

  function rebuildSelect(id) {
    var ui = SELECT_UI[id];
    if (!ui) return;
    ui.list.innerHTML = selectOptionHtml(ui.sel);
    bindSelectOptions(id);
    syncSelect(id);
  }

  function closeSelects() {
    Object.keys(SELECT_UI).forEach(function (id) {
      var ui = SELECT_UI[id];
      ui.panel.hidden = true;
      ui.panel.classList.remove('up');
      ui.trigger.setAttribute('aria-expanded', 'false');
    });
  }

  function toggleSelect(id, open) {
    var ui = SELECT_UI[id];
    if (!ui) return;
    var next = typeof open === 'boolean' ? open : ui.panel.hidden;
    closeSelects();
    ui.panel.hidden = !next;
    ui.trigger.setAttribute('aria-expanded', next ? 'true' : 'false');
    if (next) placeSelect(ui);
  }

  /* 向上/向下展开：优先完整展示，两侧都不够时改小菜单高度 */
  function placeSelect(ui) {
    ui.panel.classList.remove('up');
    ui.list.style.maxHeight = '';
    var clip = clipBox(ui.panel);
    var tr = ui.trigger.getBoundingClientRect();
    var need = ui.panel.offsetHeight;
    var below = clip.bottom - tr.bottom - 6 - 8;
    var above = tr.top - 6 - clip.top - 8;
    if (need > below && above > below) ui.panel.classList.add('up');
    var space = ui.panel.classList.contains('up') ? above : below;
    if (need > space && space > 72) ui.list.style.maxHeight = (space - 14) + 'px';
  }

  /* 取最近的滚动裁切容器边界（含视口） */
  function clipBox(el) {
    var box = { top: 0, bottom: window.innerHeight };
    var node = el.parentElement;
    while (node && node !== document.body) {
      var cs = window.getComputedStyle(node);
      if (cs.overflowY !== 'visible' || cs.overflowX !== 'visible') {
        var r = node.getBoundingClientRect();
        box.top = Math.max(box.top, r.top);
        box.bottom = Math.min(box.bottom, r.bottom);
      }
      node = node.parentElement;
    }
    return box;
  }

  function initSelectUI() {
    $$('.select-wrap').forEach(function (wrap) {
      var sel = $('select', wrap);
      if (!sel || !sel.id || SELECT_UI[sel.id]) return;
      var id = sel.id;
      var label = document.querySelector('label[for="' + id + '"]');

      sel.classList.add('select-native');
      sel.setAttribute('tabindex', '-1');
      sel.setAttribute('aria-hidden', 'true');

      var trigger = document.createElement('div');
      trigger.className = 'select-trigger';
      trigger.id = id + '-trigger';
      trigger.setAttribute('role', 'combobox');
      trigger.setAttribute('tabindex', '0');
      trigger.setAttribute('aria-haspopup', 'listbox');
      trigger.setAttribute('aria-expanded', 'false');
      if (label) trigger.setAttribute('aria-label', label.textContent.trim());
      trigger.innerHTML = '<span class="select-value"></span>' +
        '<svg class="ico ico-xs select-caret" aria-hidden="true"><use href="#i-chev-down"/></svg>';

      var panel = document.createElement('div');
      panel.className = 'dropdown-panel select-panel';
      panel.hidden = true;
      panel.innerHTML = '<ul class="dropdown-list" role="listbox"></ul>';

      var caret = $('.select-caret', wrap);
      if (caret && !trigger.contains(caret)) caret.parentNode.removeChild(caret);
      wrap.appendChild(trigger);
      wrap.appendChild(panel);

      SELECT_UI[id] = {
        sel: sel, trigger: trigger, panel: panel,
        list: $('.dropdown-list', panel),
        valueEl: $('.select-value', trigger)
      };
      rebuildSelect(id);

      trigger.addEventListener('click', function () { toggleSelect(id); });
      trigger.addEventListener('keydown', function (e) {
        var opts = $$('.opt', ui().list);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (ui().panel.hidden) toggleSelect(id, true);
          var i = selectedIndex(opts);
          var next = Math.min(opts.length - 1, Math.max(0, i < 0 ? 0 : i + (e.key === 'ArrowDown' ? 1 : -1)));
          if (opts[next]) opts[next].focus();
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleSelect(id, ui().panel.hidden);
        } else if (e.key === 'Escape') {
          closeSelects();
        }
      });
      sel.addEventListener('change', function () { syncSelect(id); });

      function ui() { return SELECT_UI[id]; }
    });

    /* 点击其他区域或按 Esc 关闭白色菜单 */
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.select-wrap') && !e.target.closest('.select-panel')) closeSelects();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSelects();
    });
  }

  function selectedIndex(opts) {
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].getAttribute('aria-selected') === 'true') return i;
    }
    return -1;
  }

  /* ----------------------------- 业务分类图 ----------------------------- */

  function renderCategory() {
    var conf = CATEGORIES[state.level];
    var series = conf.items.slice();
    if (state.catDrill && !series.some(function (d) { return d.name === state.catDrill; })) {
      state.catDrill = null;
    }
    C.renderColumnChart($('#cat-chart'), series, {
      label: '市局业务分类工单量',
      selected: state.catDrill,
      onSelect: toggleCatDrill
    });
    var total = series.reduce(function (s, d) { return s + d.value; }, 0);
    $('#cat-meta').textContent = series.length + ' 个分类 · ' + total + ' 件 · ' + conf.note;
    $('#cat-clear').hidden = state.catFilter === 'all';
    renderCatDrill();
  }

  /* 点击柱体：页内展开四图表面板，与原型一致 */
  function toggleCatDrill(name) {
    state.catDrill = state.catDrill === name ? null : name;
    renderCategory();
    if (state.catDrill) {
      var panel = $('#cat-drill');
      if (panel && !panel.hidden) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function renderCatDrill() {
    var box = $('#cat-drill');
    if (!box) return;
    var name = state.catDrill;
    if (!name) { box.hidden = true; return; }
    var row = CATEGORIES[state.level].items.filter(function (d) { return d.name === name; })[0];
    if (!row) { state.catDrill = null; box.hidden = true; return; }
    box.hidden = false;
    var total = row.value;
    $('#cat-drill-title').innerHTML = '市局业务分类下探 <span class="drill-sep">|</span> ' +
      esc(name) + ' <em>' + total + '</em>';

    C.renderColumnChart($('#cat-d-sub'), weightedSeries(subWeights(name), total, 4), {
      label: name + ' 子类分布', compact: true, total: total
    });
    C.renderColumnChart($('#cat-d-point'), weightedSeries(pointWeights(name), total, 4), {
      label: name + ' 高频点位', compact: true, total: total
    });
    C.renderTrend($('#cat-d-trend'), partition(total, [1, 2, 3, 2, 4, 3, 2, 3]), D.TREND_DATES, {
      label: name + ' 趋势分布'
    });
    C.renderColumnChart($('#cat-d-org'), weightedSeries(unitWeights(name), total, 3), {
      label: name + ' 承办单位分布', compact: true, total: total
    });
  }

  function applyCatFilter(cat) {
    state.catFilter = cat;
    var sel = $('#f-cat');
    if (cat === 'all') sel.value = 'all';
    else if ($$('option', sel).some(function (o) { return o.value === cat; })) sel.value = cat;
    syncSelect('f-cat');
    renderTable();
    renderCategory();
  }

  /* ----------------------------- 环形图与下钻 ----------------------------- */

  function renderDonuts() {
    C.renderDonut($('#donut-type'), $('#legend-type'), TYPES, 190, '工单总量', {
      colors: D.TYPE_COLORS,
      onPick: function (item) { openDonutDrill('type', item); }
    });
    C.renderDonut($('#donut-source'), $('#legend-source'), SOURCES, 190, '工单总量', {
      colors: D.SOURCE_COLORS,
      onPick: function (item) { openDonutDrill('source', item); }
    });
  }

  function statusTag(s) {
    return '<span class="tag-status' + (s === '在办' ? ' doing' : '') + '">' + esc(s) + '</span>';
  }

  function openDonutDrill(kind, item) {
    var isType = kind === 'type';
    var spec = {
      total: item.value,
      cats: CATEGORIES['1'].items.slice(0, 6).map(function (c) { return c.name; }),
      points: D.POINTS.slice(0, 5).map(function (p) { return p.n; }),
      title: item.name,
      scope: (isType ? '工单类型' : '工单来源') + '「' + item.name + '」· ' + item.value +
        ' 件 · 占本期 ' + item.pct + '% · 统计区间 ' + fmtRange()
    };
    if (isType) spec.type = item.name;
    else spec.source = item.name;
    openOrdersModal(spec);
  }

  /* ----------------------------- 诉求人 ----------------------------- */

  function repeatRows() { return state.repeatSet === 'reassign' ? D.REASSIGN : D.REPEAT; }

  function sameRows() {
    if (state.sameSet !== 'reassign') return D.SAME;
    /* 一人同诉图只取总量口径，不分段 */
    return D.REASSIGN.map(function (r) {
      return { phone: r.phone, total: r.total };
    });
  }

  function renderRepeatLegend(rows) {
    var legend = $('#legend-repeat');
    if (!legend) return;
    var used = {};
    rows.forEach(function (r) {
      (r.parts || []).forEach(function (v, i) { if (v) used[i] = true; });
    });
    var html = D.PERSON_CATS.map(function (name, i) {
      if (!used[i]) return '';
      return '<li><span class="swatch" style="background:' + D.PERSON_COLORS[i] + '"></span>' +
        '<span class="name">' + esc(name) + '</span></li>';
    }).join('');
    legend.innerHTML = html;
    legend.hidden = !html;
  }

  function renderPersons() {
    var p = D.PROFILES[state.person];
    var sel = p ? p.phone : null;
    var rows = repeatRows();
    renderRepeatLegend(rows);
    /* 一人多诉与重新交办共用同一 X 轴倾斜角度：按两套数据的最大条数锁定，不随 tab 切换变化 */
    var angleCount = Math.max(D.REPEAT.length, D.REASSIGN.length);
    C.renderStacked($('#repeat-chart'), rows, {
      label: state.repeatSet === 'reassign' ? '重新交办诉求人工单量' : '一人多诉 TOP10 诉求人工单量',
      colors: D.PERSON_COLORS,
      partNames: D.PERSON_CATS,
      selected: sel,
      angleCount: angleCount,
      onSelect: selectPerson
    });
    C.renderStacked($('#same-chart'), sameRows(), {
      label: state.sameSet === 'reassign' ? '重新交办诉求人工单量' : '一人同诉 TOP10 诉求人工单量',
      colors: D.PERSON_COLORS,
      singleLabel: '本期同诉',
      selected: sel,
      angleCount: angleCount,
      onSelect: selectPerson
    });
    syncSegs();
  }

  function syncSegs() {
    $$('.seg-mini').forEach(function (seg) {
      var panel = seg.getAttribute('data-panel');
      var active = panel === 'repeat' ? state.repeatSet : state.sameSet;
      $$('button', seg).forEach(function (b) {
        b.setAttribute('aria-selected', b.getAttribute('data-set') === active ? 'true' : 'false');
      });
    });
  }

  function ensureProfile(phone) {
    var key = phone.slice(-4);
    if (D.PROFILES[key]) return key;
    var row = D.REPEAT.concat(D.SAME).filter(function (d) { return d.phone === phone; })[0];
    var total = row ? row.total : 12;
    D.PROFILES[key] = {
      phone: phone, count: total + 9, window: '近 90 天',
      cats: [
        { n: '市容环境', v: Math.max(1, Math.round(total * 0.45)) },
        { n: '物业管理', v: Math.max(1, Math.round(total * 0.33)) },
        { n: '交通管理', v: Math.max(1, total - Math.round(total * 0.78)) }
      ],
      points: [
        { n: '解放西路夜市步行街', v: Math.max(1, Math.round(total * 0.4)) },
        { n: '中山路XX小区', v: Math.max(1, Math.round(total * 0.3)) },
        { n: '滨江花园小区', v: Math.max(1, total - Math.round(total * 0.7)) }
      ],
      trend: [1, 1, 2, 1, 2, 3, 2, 1],
      units: [
        { n: '市城市管理局', v: Math.max(1, Math.round(total * 0.5)) },
        { n: '市住房城乡建设局', v: Math.max(1, Math.round(total * 0.3)) },
        { n: '市生态环境局', v: Math.max(1, total - Math.round(total * 0.8)) }
      ],
      note: '该诉求人画像由近 90 天工单自动聚合，建议结合高频点位开展核查。'
    };
    return key;
  }

  function selectPerson(phone) {
    state.person = ensureProfile(phone);
    state.personDrill = true;
    renderPersons();
    renderPersonDrill();
    var panel = $('#person-drill');
    if (panel && !panel.hidden) panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast('已下探 ' + phone + ' 的诉求画像');
  }

  /* 诉求人下探：与市局业务分类一致的页内四图表面板 */
  function renderPersonDrill() {
    var box = $('#person-drill');
    if (!box) return;
    if (!state.personDrill) { box.hidden = true; return; }
    var p = D.PROFILES[state.person] || D.PROFILES['2219'];
    box.hidden = false;
    $('#person-drill-title').innerHTML = '重点诉求人下探 <span class="drill-sep">|</span> ' +
      esc(p.phone) + ' <em>' + p.count + '</em>';

    C.renderColumnChart($('#pd-cats'), p.cats.map(function (d) { return { name: d.n, value: d.v }; }), {
      label: '诉求人市局业务分类构成', compact: true, total: p.count
    });
    C.renderColumnChart($('#pd-points'), p.points.map(function (d) { return { name: d.n, value: d.v }; }), {
      label: '诉求人点位分布', compact: true, total: p.count
    });
    C.renderTrend($('#pd-trend'), p.trend, D.TREND_DATES, { label: '诉求人诉求趋势' });
    C.renderColumnChart($('#pd-units'), p.units.map(function (d) { return { name: d.n, value: d.v }; }), {
      label: '诉求人承办单位分布', compact: true, total: p.count
    });
    $('#person-drill-note').textContent = p.note;
  }

  /* ----------------------------- 表格 ----------------------------- */

  function renderTable() {
    var rows = currentWarnings();
    rows.sort(function (a, b) {
      var v = state.sortKey === 'count' ? a.count - b.count : a.time.localeCompare(b.time);
      return state.sortDir === 'asc' ? v : -v;
    });

    var tbody = $('#warn-tbody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td class="table-empty" colspan="4">当前筛选条件下暂无预警记录。' +
        '<button class="link-btn" type="button" id="warn-clear">清除全部筛选</button></td></tr>';
    } else {
      tbody.innerHTML = rows.map(function (r, i) {
        return '<tr tabindex="0" data-i="' + i + '" aria-label="' + esc(r.point) + '，' + esc(r.cat) + '，' + r.count +
          ' 件，点击查看点位详情">' +
          '<td><span class="cell-point"><span title="' + esc(r.point) + '">' + esc(r.point) + '</span></span></td>' +
          '<td><span class="cat-tag">' + esc(r.cat) + '</span></td>' +
          '<td><span class="count">' + r.count + '</span></td>' +
          '<td><span class="time">' + esc(r.time) + '</span></td>' +
          '</tr>';
      }).join('');
      $$('#warn-tbody tr').forEach(function (tr) {
        var r = rows[Number(tr.getAttribute('data-i'))];
        tr.addEventListener('click', function () { openWarnOrders(r); });
        tr.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openWarnOrders(r); }
        });
      });
    }

    var clearBtn = $('#warn-clear');
    if (clearBtn) clearBtn.addEventListener('click', function () { resetAll(true); });

    $$('.sort').forEach(function (btn) {
      var key = btn.getAttribute('data-key');
      var th = btn.parentNode;
      var active = state.sortKey === key;
      th.setAttribute('aria-sort', active ? (state.sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
      var use = btn.querySelector('use');
      if (use) use.setAttribute('href', active ? (state.sortDir === 'asc' ? '#i-chev-up' : '#i-chev-down') : '#i-chev-down');
      btn.style.color = active ? 'var(--brand)' : '';
    });

    var summary = $('#warn-summary');
    if (summary) {
      summary.textContent = hasFilter()
        ? '当前筛选 ' + rows.length + ' 条 / 共 ' + D.WARNINGS.length + ' 条预警'
        : '共 ' + D.WARNINGS.length + ' 条预警，已展示全部点位';
    }

    renderChips();
  }

  function renderChips() {
    var box = $('#warn-filter');
    var chips = [];
    if (state.catFilter !== 'all') {
      chips.push({ label: '业务分类：' + state.catFilter, clear: function () { applyCatFilter('all'); } });
    }
    if (state.orgFilter !== 'all') {
      chips.push({ label: '承办单位：' + state.orgFilter, clear: function () { state.orgFilter = 'all'; $('#f-org').value = 'all'; syncSelect('f-org'); renderTable(); } });
    }
    if (state.types.length) {
      chips.push({ label: '工单类型：' + state.types.join('、'), clear: function () { setTypes([]); } });
    }
    if (state.kw) {
      chips.push({ label: '关键词：' + state.kw, clear: function () { state.kw = ''; $('#f-kw').value = ''; renderTable(); } });
    }
    if (state.dateStart !== '2026-09-01' || state.dateEnd !== '2026-09-30') {
      chips.push({ label: '时间段：' + fmtRange(), clear: function () { state.dateStart = '2026-09-01'; state.dateEnd = '2026-09-30'; $('#f-date-start').value = state.dateStart; $('#f-date-end').value = state.dateEnd; renderDateTrigger(); renderTable(); } });
    }
    if (!chips.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = chips.map(function (c, i) {
      return '<span class="chip">' + esc(c.label) + '<button type="button" aria-label="移除筛选：' + esc(c.label) + '" data-i="' + i + '">' +
        '<svg class="ico" aria-hidden="true"><use href="#i-x"/></svg></button></span>';
    }).join('');
    $$('.chip button', box).forEach(function (b) {
      b.addEventListener('click', function () { chips[Number(b.getAttribute('data-i'))].clear(); });
    });
  }

  /* ----------------------------- 点位 ----------------------------- */

  function renderPoints() {
    C.renderBars($('#point-list'), D.POINTS.slice(), {
      ranked: true,
      clickable: true,
      selected: state.pointDrill,
      onSelect: function (d) { togglePointDrill(d.n); }
    });
  }

  /* 点位下探：与市局业务分类一致的页内四图表面板 */
  function togglePointDrill(point) {
    state.pointDrill = state.pointDrill === point ? null : point;
    renderPoints();
    renderPointDrill();
    if (state.pointDrill) {
      var panel = $('#point-drill');
      if (panel && !panel.hidden) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function renderPointDrill() {
    var box = $('#point-drill');
    if (!box) return;
    var point = state.pointDrill;
    if (!point) { box.hidden = true; return; }
    var hit = D.POINTS.filter(function (p) { return p.n === point; })[0];
    var total = hit ? hit.v : 1;
    box.hidden = false;
    $('#point-drill-title').innerHTML = '重点点位下探 <span class="drill-sep">|</span> ' +
      esc(point) + ' <em>' + total + '</em>';

    var catPairs = [];
    D.WARNINGS.forEach(function (r) {
      if (r.point !== point) return;
      var c = catPairs.filter(function (x) { return x.n === r.cat; })[0];
      if (c) c.w += r.count;
      else catPairs.push({ n: r.cat, w: r.count });
    });
    catPairs.sort(function (a, b) { return b.w - a.w; });
    if (!catPairs.length) catPairs = [{ n: '市容环境', w: 3 }, { n: '交通管理', w: 2 }];
    C.renderColumnChart($('#ptd-cats'), weightedSeries(catPairs, total, 4), {
      label: point + ' 市局业务分类构成', compact: true, total: total
    });

    C.renderColumnChart($('#ptd-types'), weightedSeries([
      { n: '投诉', w: 6 }, { n: '举报', w: 2.6 }, { n: '意见建议', w: 1.6 }
    ], total), { label: point + ' 工单类型构成', compact: true, total: total });

    C.renderTrend($('#ptd-trend'), partition(total, [1, 2, 2, 3, 2, 4, 3, 2]), D.TREND_DATES, {
      label: point + ' 工单趋势'
    });

    var orgPairs = [];
    catPairs.forEach(function (c) {
      var orgName = D.ORG_BY_CAT[c.n] || '市城市管理局';
      var hit2 = orgPairs.filter(function (m) { return m.n === orgName; })[0];
      if (hit2) hit2.w += c.w;
      else orgPairs.push({ n: orgName, w: c.w });
    });
    orgPairs.sort(function (a, b) { return b.w - a.w; });
    C.renderColumnChart($('#ptd-org'), weightedSeries(orgPairs, total, 3), {
      label: point + ' 承办单位分布', compact: true, total: total
    });
  }

  /* ----------------------------- 重点事项 ----------------------------- */

  function renderFocus() {
    var list = $('#focus-list');
    list.innerHTML = state.focus.map(function (item, i) {
      var up = item.yoy.indexOf('+') === 0;
      var momUp = item.mom.indexOf('+') === 0;
      var tags = (item.tags || []).slice(0, 3);
      return '<article class="focus-item" data-i="' + i + '">' +
        '<div class="focus-top"><h3>' + esc(item.name) + '</h3>' +
        '<div class="focus-actions">' +
        '<button class="icon-btn" type="button" data-act="edit" aria-label="编辑 ' + esc(item.name) + '"><svg class="ico" aria-hidden="true"><use href="#i-edit"/></svg></button>' +
        '<button class="icon-btn danger" type="button" data-act="del" aria-label="删除 ' + esc(item.name) + '"><svg class="ico" aria-hidden="true"><use href="#i-trash"/></svg></button>' +
        '</div></div>' +
        '<div class="focus-metrics"><div class="focus-main"><span class="focus-label">工单量</span>' +
        '<div class="focus-value"><span class="num">' + item.count + '</span><span class="unit">件</span></div></div>' +
        '<div class="focus-deltas">' +
        '<span class="mini-delta ' + (up ? 'up' : 'down') + '">同比' + esc(item.yoy) + '</span>' +
        '<span class="mini-delta ' + (momUp ? 'up' : 'down') + '">环比' + esc(item.mom) + '</span>' +
        '</div></div>' +
        (tags.length ? '<div class="focus-tags">' + tags.map(function (t) {
          return '<span class="tag-mini">' + esc(t) + '</span>';
        }).join('') + '</div>' : '') +
        '<div class="focus-bottom"><span class="focus-note" title="' + esc(item.note) + '">' + esc(item.note) + '</span>' +
        '<button class="link-btn" type="button" data-act="drill">研判下钻<svg class="ico ico-xs" aria-hidden="true"><use href="#i-arrow-right"/></svg></button></div>' +
        '</article>';
    }).join('') || '<p class="table-empty">暂无关注事项，可点击「添加事项」创建。</p>';

    var n = state.focus.length;
    $('#focus-count').textContent = n + ' / 10';
    $('#focus-progress').style.width = (n / 10 * 100) + '%';
    var note = $('.quota-note');
    note.textContent = '关注额度 ' + n + ' / 10' + (n >= 10 ? '，已达上限' : '，还可添加 ' + (10 - n) + ' 项');
    $('#btn-add-focus').disabled = n >= 10;

    $$('.focus-item', list).forEach(function (row) {
      var i = Number(row.getAttribute('data-i'));
      /* 整卡可点击：鼠标落在卡片任意处都可进入研判下钻，与 hover 指示条、箭头位移构成一套反馈 */
      row.addEventListener('click', function () { drillFocus(state.focus[i]); });
      $$('[data-act]', row).forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          /* 编辑 / 删除 / 下钻按钮各自处理，阻止冒泡避免再触发整卡下钻 */
          e.stopPropagation();
          var act = btn.getAttribute('data-act');
          if (act === 'del') removeFocus(i);
          if (act === 'edit') openDialog(i);
          if (act === 'drill') drillFocus(state.focus[i]);
        });
      });
    });
  }

  function removeFocus(i) {
    var removed = state.focus.splice(i, 1)[0];
    renderFocus();
    toast('已移除关注事项「' + removed.name + '」', '撤销', function () {
      state.focus.splice(i, 0, removed);
      renderFocus();
    });
  }

  /* 重点事项下钻：居中弹窗内 2×2 四图表，内容与原型一致 */
  function drillFocus(item) {
    var cat = item.cat || item.name.replace(/类$/, '');
    var total = item.count || 1;
    var catSeries = weightedSeries(subWeights(cat), total, 4);
    var pointSeries = weightedSeries(pointWeights(cat), total, 4);
    var orgSeries = weightedSeries(unitWeights(cat), total, 3);
    C.openDrawer({
      wide: true,
      icon: 'focus',
      title: item.name + '（' + total + ' 件）',
      sub: '统计区间 ' + fmtRange() + ' · ' +
        (item.units && item.units.length ? '承办 ' + item.units[0] : '按市局业务分类归口'),
      chartGrid: [
        { title: '市局业务分类', icon: '#i-layers', kind: 'column', series: catSeries, total: total },
        { title: '趋势分布', icon: '#i-trend-up', kind: 'trend', values: partition(total, [1, 2, 3, 2, 4, 3, 2, 3]), dates: D.TREND_DATES },
        { title: '点位分布', icon: '#i-pin', kind: 'column', series: pointSeries, total: total },
        { title: '单位分布', icon: '#i-building', kind: 'column', series: orgSeries, total: total }
      ],
      actions: [{
        label: '查看工单明细', primary: true,
        onClick: function () {
          window.setTimeout(function () {
            openOrdersModal({
              total: total, cat: cat, title: item.name,
              scope: '事项「' + item.name + '」· 市局业务分类 ' + cat + ' · 统计区间 ' + fmtRange()
            });
          }, 60);
        }
      }]
    });
  }

  /* ----------------------------- 事项表单 ----------------------------- */

  var tagState = { tags: [], includes: [], excludes: [], units: [] };
  var TAG_LIMIT = { tags: 5, includes: 10, excludes: 10, units: 5 };
  var TAG_NAME = { tags: '扩展标签', includes: '包含关键词', excludes: '不包含关键词', units: '关联承办单位' };
  var KW_EMPTY = {
    includes: '暂无包含关键词（在上方输入后敲回车添加）',
    excludes: '暂无排除关键词（工单含有排除词将被自动剔除）'
  };

  function renderTagField(kind) {
    var chips = tagState[kind].map(function (v, i) {
      return '<span class="tag-chip' + (kind === 'excludes' ? ' exclude' : '') + '">' + esc(v) +
        '<button type="button" data-kind="' + kind + '" data-i="' + i + '" aria-label="移除 ' + esc(v) + '">' +
        '<svg class="ico" aria-hidden="true"><use href="#i-x"/></svg></button></span>';
    }).join('');
    var list = $('#' + kind + '-list');
    if (list) list.innerHTML = chips;
    var view = $('#' + kind + '-view');
    if (view) view.innerHTML = chips || '<p class="kw-empty">' + KW_EMPTY[kind] + '</p>';
    var counter = $('#' + kind + '-count');
    if (counter) {
      counter.textContent = kind === 'tags'
        ? tagState.tags.length + ' / ' + TAG_LIMIT.tags
        : '已添加 ' + tagState[kind].length + ' 个';
    }
  }

  function addTag(kind, raw) {
    var v = String(raw || '').trim().replace(/[,，;；]$/, '');
    if (!v) return;
    if (v.length > 12) { toast('单个' + TAG_NAME[kind] + '不超过 12 个字'); return; }
    if (tagState[kind].indexOf(v) > -1) { toast('「' + v + '」已存在'); return; }
    if (tagState[kind].length >= TAG_LIMIT[kind]) {
      toast(TAG_NAME[kind] + '最多添加 ' + TAG_LIMIT[kind] + ' 个');
      return;
    }
    tagState[kind].push(v);
    renderTagField(kind);
  }

  function bindTagField(kind) {
    var input = $('#' + kind + '-input');
    if (!input) return;
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
        e.preventDefault();
        if (input.value.trim()) {
          addTag(kind, input.value);
          input.value = '';
        }
        return;
      }
      if (e.key === 'Backspace' && !input.value && tagState[kind].length) {
        tagState[kind].pop();
        renderTagField(kind);
      }
      if (e.key === 'Escape') input.blur();
    });
    input.addEventListener('blur', function () {
      if (input.value.trim()) { addTag(kind, input.value); input.value = ''; }
    });
  }

  function renderAllTags() {
    ['tags', 'includes', 'excludes', 'units'].forEach(renderTagField);
  }

  function catInputValue(cat) {
    if (!cat) return '';
    return D.CAT_OPTIONS.indexOf(cat + '类') > -1 ? cat + '类' : cat;
  }

  function catCount(cat) {
    var hit = CATEGORIES['1'].items.filter(function (d) { return d.name === cat; })[0];
    return hit ? hit.value : 1;
  }

  function deriveNote(item) {
    if (item.tags && item.tags.length) return '标签 · ' + item.tags.join('、');
    if (item.includes && item.includes.length) return '关键词 · ' + item.includes.slice(0, 2).join('、');
    return item.note || '待补充关注理由';
  }

  function fillDialogOptions() {
    var catSel = $('#add-cat');
    catSel.innerHTML = '<option value="">分类：点击选择或搜索关联...</option>' +
      D.CAT_OPTIONS.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
    var unitSel = $('#add-unit');
    unitSel.innerHTML = '<option value="">点击选择或输入搜索关联的主要承办单位...</option>' +
      D.ORG_OPTIONS.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
    [catSel, unitSel].forEach(function (sel) {
      rebuildSelect(sel.id);
    });
  }

  function openDialog(index) {
    closeSelects();
    state.editingIndex = typeof index === 'number' ? index : -1;
    var editing = state.editingIndex > -1;
    var dlg = $('#add-dialog');
    $('#add-dialog-title-text').textContent = editing ? '编辑重点事项' : '添加重点事项';
    $('#add-dialog-sub').textContent = (editing ? '调整' : '配置') +
      '该重点事项的名称、业务定义、扩展标签、关键词与关联承办单位';
    $('#add-submit').textContent = editing ? '保存修改' : '确认添加';
    $('#add-name-error').classList.remove('on');
    $('#add-name').classList.remove('invalid');

    if (editing) {
      var item = state.focus[state.editingIndex];
      $('#add-name').value = item.name;
      $('#add-cat').value = catInputValue(item.cat);
      $('#add-unit').value = (item.units && item.units[0]) || '';
      tagState = {
        tags: (item.tags || []).slice(),
        includes: (item.includes || []).slice(),
        excludes: (item.excludes || []).slice(),
        units: (item.units || []).slice()
      };
    } else {
      $('#add-form').reset();
      tagState = { tags: [], includes: [], excludes: [], units: [] };
    }
    syncSelect('add-cat');
    syncSelect('add-unit');
    renderAllTags();

    if (typeof dlg.showModal === 'function') dlg.showModal();
    window.setTimeout(function () { $('#add-name').focus(); }, 30);
  }

  function submitFocus(e) {
    e.preventDefault();
    var name = $('#add-name').value.trim();
    if (!name) {
      $('#add-name').classList.add('invalid');
      $('#add-name-error').classList.add('on');
      $('#add-name').focus();
      return;
    }
    if (state.focus.some(function (it, i) { return it.name === name && i !== state.editingIndex; })) {
      toast('已存在同名关注事项，请更换名称');
      return;
    }
    var catRaw = $('#add-cat').value.trim();
    var cat = catRaw ? catRaw.replace(/类$/, '') : '';
    var count = cat ? catCount(cat) : 1;
    var unit = $('#add-unit').value;
    tagState.units = unit ? [unit] : [];

    if (state.editingIndex > -1) {
      var item = state.focus[state.editingIndex];
      item.name = name;
      item.cat = cat || item.cat;
      item.count = cat ? count : item.count;
      item.tags = tagState.tags.slice();
      item.includes = tagState.includes.slice();
      item.excludes = tagState.excludes.slice();
      item.units = tagState.units.slice();
      item.note = deriveNote(item);
      toast('已更新关注事项「' + name + '」');
    } else {
      if (state.focus.length >= 10) { toast('关注额度已达上限（10 项）'); return; }
      var delta = pseudoDelta(name);
      var created = {
        name: name, cat: cat, count: count,
        yoy: delta.yoy, mom: delta.mom,
        tags: tagState.tags.slice(), includes: tagState.includes.slice(),
        excludes: tagState.excludes.slice(), units: tagState.units.slice(),
        note: ''
      };
      created.note = deriveNote(created);
      state.focus.push(created);
      toast('已添加关注事项「' + name + '」');
    }
    $('#add-dialog').close();
    renderFocus();
  }

  /* ----------------------------- 工单列表弹窗 ----------------------------- */

  var ORDER_DAYS = ['02', '03', '05', '07', '09', '11', '14', '16', '18', '20', '22', '24', '26', '28'];
  var ORDER_TIMES = ['08:12:36', '09:24:11', '10:47:05', '13:36:48', '15:06:52', '16:38:19', '18:52:44', '20:11:08'];
  var ORDER_SOURCES = ['电话 12345', '微信公众号', '小程序', '政务 APP', '市长信箱'];
  var ORDER_TYPES = ['投诉', '投诉', '举报', '投诉', '意见建议', '投诉', '举报', '投诉'];

  function pad(n, len) {
    var s = String(n);
    while (s.length < (len || 2)) s = '0' + s;
    return s;
  }

  /* 按下钻对象确定性生成工单明细，件数与所点元素保持一致 */
  function makeOrders(spec) {
    var total = Math.max(1, spec.total || 1);
    var cats = spec.cats && spec.cats.length ? spec.cats : [spec.cat || '市容环境'];
    var points = spec.points && spec.points.length ? spec.points
      : (spec.point ? [spec.point] : ['解放西路夜市步行街', '中山路XX小区', '滨江花园小区']);
    var seed = hashStr([spec.title || '', cats.join(','), points.join(','), total].join('|'));
    var rows = [];
    for (var i = 0; i < total; i++) {
      var cat = cats[(seed + i) % cats.length];
      var pool = D.ORDER_SUMMARIES[cat] || D.ORDER_SUMMARIES['市容环境'];
      var day = ORDER_DAYS[ORDER_DAYS.length - 1 - i % ORDER_DAYS.length];
      rows.push({
        id: 'GD202609' + day + pad(500 + i, 4),
        type: spec.type || ORDER_TYPES[(seed + i) % ORDER_TYPES.length],
        cat: cat,
        point: points[(seed + i * 3) % points.length],
        source: spec.source || ORDER_SOURCES[(seed + i * 2) % ORDER_SOURCES.length],
        time: '2026-09-' + day + ' ' + ORDER_TIMES[(seed + i * 5) % ORDER_TIMES.length],
        status: (seed + i) % 7 === 0 ? '重新交办' : (seed + i) % 4 === 0 ? '在办' : '已办结',
        org: D.ORG_BY_CAT[cat] || '市城市管理局',
        phone: spec.phone || D.ORDER_PHONES[(seed + i * 3) % D.ORDER_PHONES.length],
        summary: pool[(seed + i) % pool.length]
      });
    }
    return rows;
  }

  /* 工单字段派生：基础字段之外的列按原型规则推导，保证 33 列均有内容 */
  function orderTags(o) { return D.ORDER_TAGS[o.cat] || ['民生诉求']; }
  function orderField(o, key) {
    var tail = String(o.phone || '').slice(-4);
    var digits = String(o.id || '').replace(/\D/g, '');
    switch (key) {
      case 'id': return o.id;
      case 'savePhoneMark': return tail === '1234' || tail === '6666' || tail === '8888' ? '是' : '否';
      case 'hotlineCategory': return D.HOTLINE_CATS[o.cat] || '综合协同事务';
      case 'replyContent':
        return '已按规范办理：针对反映的“' + o.summary + '”，经承办单位派员赴现场勘查与核查处置，已依法落实管理措施并向当事人反馈情况。';
      case 'category': return o.cat;
      case 'revisitContent':
        if (o.status === '已办结') return '回访诉求人表示满意，现场问题已解决，感谢热线及相关部门的高效处理。';
        if (o.status === '重新交办') return '回访诉求人反映现场偶有反弹，对目前处置成效表示不满意，要求责任单位抓紧长效落实。';
        return '回访诉求人表示基本满意，建议承办单位后续加强常态化巡查防范。';
      case 'type': return o.type;
      case 'source': return o.source;
      case 'callerName':
        return D.CALLER_NAMES[(parseInt(digits.slice(-2), 10) || 0) % D.CALLER_NAMES.length];
      case 'factCert': return o.type === '投诉' ? '情况属实' : o.type === '举报' ? '基本属实' : '已核实';
      case 'phone': return o.phone;
      case 'appealJudgment': return o.status === '重新交办' ? '重复诉求/建议督办' : '诉求合理';
      case 'location': return o.point;
      case 'content': return o.summary;
      case 'satisfaction': return o.status === '已办结' ? '满意' : o.status === '重新交办' ? '不满意' : '基本满意';
      case 'preContactTime': return o.time.slice(0, 10) + ' 09:15';
      case 'tags': return orderTags(o).join('、');
      case 'createdAt': return o.time;
      case 'isTrafficTag': return o.cat === '交通管理' || /路|交警|车/.test(o.summary) ? '是' : '否';
      case 'sourceUnit': return '市 12345 便民热线中心';
      case 'returnType': return o.status === '重新交办' ? '职能交叉退单' : '无退单';
      case 'distributor':
        return D.DISTRIBUTORS[(parseInt(digits.slice(-1), 10) || 0) % D.DISTRIBUTORS.length];
      case 'returnReason': return o.status === '重新交办' ? '经现场核查涉及权属重叠，建议协同联合整治' : '-';
      case 'unit': return o.org;
      case 'splitType': return o.status === '重新交办' ? '协同转派' : '不拆单';
      case 'replyUnit': return o.org;
      case 'handleUnit': return o.org;
      case 'isPreContactOverdue': return o.status === '重新交办' ? '是' : '否';
      case 'cityBureauOverdueUnit': return o.status === '重新交办' ? o.org : '无';
      case 'govOverdueUnit': return '无';
      case 'extendedTags': return orderTags(o).map(function (t) { return '#' + t; }).join(' ');
      case 'isMalicious': return o.status === '重新交办' && (tail === '1234' || tail === '8888') ? '疑似高频' : '否';
      case 'resultJudgment': return o.status === '已办结' ? '解决' : o.status === '重新交办' ? '正在办理' : '基本解决';
      default: return o[key] == null ? '-' : String(o[key]);
    }
  }

  /* 工单列表表头与列宽：33 列按原型字段渲染，表格总宽由列宽累加，超出弹窗可横向滚动 */
  function initOrdersTable() {
    var cols = $('#orders-cols');
    var head = $('#orders-head');
    var table = $('#orders-table');
    if (!cols || !head || !table) return;
    var seqWidth = 64;
    var total = seqWidth;
    cols.innerHTML = '<col style="width:' + seqWidth + 'px">' + D.ORDER_COLUMNS.map(function (c) {
      total += c.width;
      return '<col style="width:' + c.width + 'px">';
    }).join('');
    head.innerHTML = '<th scope="col" class="num">序号</th>' + D.ORDER_COLUMNS.map(function (c) {
      return '<th scope="col">' + esc(c.label) + '</th>';
    }).join('');
    table.style.width = total + 'px';
  }

  function renderOrders() {
    var view = state.orders;
    var size = view.size;
    var pages = Math.max(1, Math.ceil(view.items.length / size));
    if (view.page > pages) view.page = pages;
    if (view.page < 1) view.page = 1;
    var start = (view.page - 1) * size;
    var pageRows = view.items.slice(start, start + size);
    $('#orders-tbody').innerHTML = pageRows.map(function (o, i) {
      return '<tr>' +
        '<td class="num">' + (start + i + 1) + '</td>' +
        D.ORDER_COLUMNS.map(function (c) {
          var v = orderField(o, c.key);
          if (c.key === 'category') return '<td title="' + esc(v) + '"><span class="cat-tag">' + esc(v) + '</span></td>';
          if (c.key === 'id') return '<td title="' + esc(v) + '"><b>' + esc(v) + '</b></td>';
          return '<td title="' + esc(v) + '">' + esc(v) + '</td>';
        }).join('') +
        '</tr>';
    }).join('') || '<tr><td class="table-empty" colspan="' + (D.ORDER_COLUMNS.length + 1) + '">当前条件下暂无可展示的工单。</td></tr>';
    $('#orders-pageinfo').textContent = '共 ' + view.items.length + ' 件工单 · 第 ' + view.page + ' / ' + pages + ' 页';
    $('#orders-pager').innerHTML = pageList(view.page, pages);
  }

  function pageList(page, pages) {
    var out = ['<button class="pg-btn" type="button" data-page="' + (page - 1) + '"' +
      (page <= 1 ? ' disabled' : '') + '>上一页</button>'];
    var nums = [];
    for (var i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || Math.abs(i - page) <= 1) nums.push(i);
      else if (nums[nums.length - 1] !== '…') nums.push('…');
    }
    nums.forEach(function (p) {
      if (p === '…') { out.push('<span class="pg-gap" aria-hidden="true">…</span>'); return; }
      out.push('<button class="pg-btn' + (p === page ? ' is-active' : '') + '" type="button" data-page="' + p + '"' +
        (p === page ? ' aria-current="page"' : '') + '>' + p + '</button>');
    });
    out.push('<button class="pg-btn" type="button" data-page="' + (page + 1) + '"' +
      (page >= pages ? ' disabled' : '') + '>下一页</button>');
    return out.join('');
  }

  function openOrdersModal(spec) {
    var dlg = $('#orders-dialog');
    if (!dlg) return;
    var items = makeOrders(spec);
    state.orders = { items: items, page: 1, size: Number($('#orders-size').value) || 10 };
    /* 标题拆出文字节点，避免 textContent 覆盖掉标题前的图标 */
    $('#orders-title-text').textContent = '工单列表（共 ' + items.length + ' 件工单）';
    $('#orders-sub').textContent = spec.scope || ('统计区间 ' + fmtRange() + ' · 按受理时间倒序');
    renderOrders();
    if (typeof dlg.showModal === 'function') {
      if (!dlg.open) dlg.showModal();
    } else {
      dlg.setAttribute('open', '');
    }
  }

  function csvCell(v) { return '"' + String(v).replace(/"/g, '""') + '"'; }

  function exportOrders() {
    var items = state.orders.items;
    if (!items.length) { toast('当前列表暂无可导出的工单'); return; }
    var head = ['序号'].concat(D.ORDER_COLUMNS.map(function (c) { return c.label; }));
    var lines = [head.map(csvCell).join(',')].concat(items.map(function (o, i) {
      return [i + 1].concat(D.ORDER_COLUMNS.map(function (c) { return orderField(o, c.key); })).map(csvCell).join(',');
    }));
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '工单列表_' + items.length + '件.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    toast('已导出 ' + items.length + ' 件工单明细');
  }

  /* KPI 查看明细：全部工单 */
  function openKpiOrders() {
    openOrdersModal({
      total: D.KPI.total,
      scope: '工单量 · 全部渠道合计 ' + D.KPI.total + ' 件 · 统计区间 ' + fmtRange()
    });
  }

  /* 预警行下钻：该点位该分类的预警工单 */
  function openWarnOrders(r) {
    openOrdersModal({
      total: r.count, cat: r.cat, point: r.point, title: r.point + r.cat,
      scope: '群发预警 · ' + r.point + ' · ' + r.cat + ' · 近 30 天同类触发 ' + r.count + ' 件 · 最近 ' + r.time
    });
  }

  /* 三处页内下探面板的「查看」统一进入工单列表弹窗 */
  function drillOrders(kind) {
    if (kind === 'cat') {
      var name = state.catDrill;
      var row = name && CATEGORIES[state.level].items.filter(function (d) { return d.name === name; })[0];
      if (!row) return;
      openOrdersModal({
        total: row.value, cat: name, title: name,
        scope: '市局业务分类「' + name + '」· ' + row.value + ' 件 · 统计区间 ' + fmtRange()
      });
      return;
    }
    if (kind === 'person') {
      var p = D.PROFILES[state.person];
      if (!p) return;
      openOrdersModal({
        total: p.count, phone: p.phone, title: p.phone,
        cats: p.cats.map(function (d) { return d.n; }),
        points: p.points.map(function (d) { return d.n; }),
        scope: '重点诉求人 ' + p.phone + ' · ' + p.window + '内 ' + p.count + ' 件'
      });
      return;
    }
    var point = state.pointDrill;
    if (!point) return;
    var hit = D.POINTS.filter(function (x) { return x.n === point; })[0];
    var total = hit ? hit.v : 1;
    var cats = [];
    D.WARNINGS.forEach(function (r) {
      if (r.point === point && cats.indexOf(r.cat) === -1) cats.push(r.cat);
    });
    openOrdersModal({
      total: total, point: point, cats: cats, title: point,
      scope: '重点点位「' + point + '」· ' + total + ' 件 · 口径：近 30 天同一小区 / 商圈触发 ≥3 件'
    });
  }

  function bindDrillEvents() {
    [['#cat-drill-orders', function () { drillOrders('cat'); }],
      ['#cat-drill-close', function () { state.catDrill = null; renderCategory(); }],
      ['#person-drill-orders', function () { drillOrders('person'); }],
      ['#person-drill-close', function () { state.personDrill = false; renderPersonDrill(); }],
      ['#point-drill-orders', function () { drillOrders('point'); }],
      ['#point-drill-close', function () { state.pointDrill = null; renderPoints(); renderPointDrill(); }]
    ].forEach(function (item) {
      var el = $(item[0]);
      if (el) el.addEventListener('click', item[1]);
    });

    var dlg = $('#orders-dialog');
    if (!dlg) return;
    $('#orders-close').addEventListener('click', function () { dlg.close(); });
    $('#orders-size').addEventListener('change', function () {
      state.orders.size = Number(this.value) || 10;
      state.orders.page = 1;
      renderOrders();
    });
    $('#orders-export').addEventListener('click', exportOrders);
    $('#orders-pager').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-page]');
      if (!btn || btn.disabled) return;
      state.orders.page = Number(btn.getAttribute('data-page'));
      renderOrders();
    });
  }

  /* 查看全部预警：全部预警点位对应的工单列表 */
  function openWarnAllOrders() {
    var rows = D.WARNINGS.slice().sort(function (a, b) { return b.count - a.count; });
    var points = [];
    var cats = [];
    var total = 0;
    rows.forEach(function (r) {
      if (points.indexOf(r.point) === -1) points.push(r.point);
      if (cats.indexOf(r.cat) === -1) cats.push(r.cat);
      total += r.count;
    });
    openOrdersModal({
      total: total, cats: cats, points: points, title: '群发预警监测',
      scope: '群发预警监测 · 当前触发 ' + rows.length + ' 起 · 关联 ' + total + ' 件工单 · 统计区间 ' + fmtRange()
    });
  }

  /* --------------------------- 查询时间段 --------------------------- */

  var DATA_END = '2026-09-30';

  function shiftISODate(v, days) {
    var d = new Date(v + 'T00:00:00');
    if (isNaN(d.getTime())) return v;
    d.setDate(d.getDate() + days);
    var m = String(d.getMonth() + 1), day = String(d.getDate());
    return d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (day.length < 2 ? '0' + day : day);
  }

  function spanDays(s, e) {
    var a = new Date(s + 'T00:00:00'), b = new Date(e + 'T00:00:00');
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
    return Math.round((b - a) / 86400000) + 1;
  }

  /* 触发框始终展示为一段区间：起 至 止 */
  function renderDateTrigger() {
    var s = $('#f-date-start').value;
    var e = $('#f-date-end').value;
    var val = $('#date-value');
    if (!val) return;
    if (s && e) {
      val.textContent = fmtDate(s) + ' 至 ' + fmtDate(e);
      val.classList.remove('is-empty');
    } else {
      val.textContent = '请选择时间段';
      val.classList.add('is-empty');
    }
    var days = $('#date-days');
    if (days) {
      var n = s && e ? spanDays(s, e) : 0;
      days.textContent = n > 0 ? '共 ' + n + ' 天' : '请选择完整的起止日期';
    }
    markDatePresets();
  }

  function markDatePresets() {
    var s = $('#f-date-start').value;
    var e = $('#f-date-end').value;
    var span = s && e ? spanDays(s, e) : 0;
    $$('.date-preset').forEach(function (btn) {
      var on = span > 0 && span === Number(btn.getAttribute('data-days'));
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function openDatePanel(open) {
    var panel = $('#date-panel');
    if (!panel) return;
    if (open) renderDateTrigger();
    panel.hidden = !open;
    $('#date-trigger').setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function setDateRange(s, e, silent) {
    if (!s || !e) { toast('请选择完整的时间段'); return false; }
    if (s > e) { toast('时间段的开始日期不能晚于结束日期'); return false; }
    $('#f-date-start').value = s;
    $('#f-date-end').value = e;
    renderDateTrigger();
    return applyFilters(silent);
  }

  function initDatePeriod() {
    var trigger = $('#date-trigger');
    var panel = $('#date-panel');
    if (!trigger || !panel) return;

    trigger.addEventListener('click', function () { openDatePanel(panel.hidden); });
    trigger.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDatePanel(panel.hidden); }
      if (e.key === 'Escape') { openDatePanel(false); hidePanelFocus(); }
    });

    $$('.date-preset').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var days = Number(btn.getAttribute('data-days')) || 7;
        var end = $('#f-date-end').value || DATA_END;
        setDateRange(shiftISODate(end, -(days - 1)), end, true);
        openDatePanel(false);
      });
    });

    ['#f-date-start', '#f-date-end'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        var s = $('#f-date-start').value;
        var e = $('#f-date-end').value;
        if (s && e && s > e) { toast('时间段的开始日期不能晚于结束日期'); renderDateTrigger(); return; }
        renderDateTrigger();
        applyFilters(true);
      });
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest('#date-period')) openDatePanel(false);
    });

    renderDateTrigger();
  }

  function applyFilters(silent) {
    var s = $('#f-date-start').value;
    var e = $('#f-date-end').value;
    if (s && e && s > e) { toast('开始日期不能晚于结束日期，请重新选择'); return false; }
    state.dateStart = s;
    state.dateEnd = e;
    state.catFilter = $('#f-cat').value;
    state.orgFilter = $('#f-org').value;
    state.kw = $('#f-kw').value.trim();
    renderCategory();
    renderTable();
    if (silent) return true;
    var parts = [];
    if (state.catFilter !== 'all') parts.push('分类 ' + state.catFilter);
    if (state.orgFilter !== 'all') parts.push('单位 ' + state.orgFilter);
    if (state.types.length) parts.push('类型 ' + state.types.join('、'));
    if (state.kw) parts.push('关键词「' + state.kw + '」');
    toast(parts.length
      ? '已应用筛选：' + parts.join('、') + '，命中 ' + currentWarnings().length + ' 条预警'
      : '已刷新 ' + fmtRange() + ' 时间段的全部数据');
    return true;
  }

  /* ----------------------------- 事件 ----------------------------- */

  function bindFilterEvents() {
    $('#type-trigger').addEventListener('click', function (e) {
      if (e.target.closest('#type-clear-inline')) return;
      openTypePanel($('#type-panel').hidden);
    });
    $('#type-trigger').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTypePanel($('#type-panel').hidden); }
      if (e.key === 'Escape') { openTypePanel(false); hidePanelFocus(); }
    });
    $('#type-clear-inline').addEventListener('click', function (e) {
      e.stopPropagation();
      setTypes([]);
    });
    $('#type-all').addEventListener('click', function () {
      setTypes(TYPE_OPTIONS.map(function (d) { return d.name; }));
    });
    $('#type-clear').addEventListener('click', function () { setTypes([]); });
    $('#type-search').addEventListener('input', renderTypeList);
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#type-dd')) openTypePanel(false);
    });

    $('#btn-query').addEventListener('click', function () { applyFilters(false); });

    $('#btn-reset').addEventListener('click', function () { resetAll(false); });

    $('#f-kw').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); $('#btn-query').click(); }
    });
  }

  function hidePanelFocus() {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  function resetAll(silent) {
    state.dateStart = '2026-09-01';
    state.dateEnd = '2026-09-30';
    state.catFilter = 'all';
    state.orgFilter = 'all';
    state.types = [];
    state.kw = '';
    $('#f-date-start').value = state.dateStart;
    $('#f-date-end').value = state.dateEnd;
    $('#f-cat').value = 'all';
    $('#f-org').value = 'all';
    $('#f-kw').value = '';
    syncSelect('f-cat');
    syncSelect('f-org');
    renderDateTrigger();
    openDatePanel(false);
    renderTypeTrigger();
    renderTypeList();
    renderCategory();
    renderTable();
    if (!silent) toast('已重置全部筛选条件');
  }

  function bindFocusEvents() {
    $('#btn-add-focus').addEventListener('click', function () { openDialog(); });
    $('#add-close').addEventListener('click', function () { $('#add-dialog').close(); });
    $('#add-cancel').addEventListener('click', function () { $('#add-dialog').close(); });
    $('#add-form').addEventListener('submit', submitFocus);

    $('#add-name').addEventListener('input', function () {
      $('#add-name').classList.remove('invalid');
      $('#add-name-error').classList.remove('on');
    });

    $$('.tag-list, .kw-view').forEach(function (list) {
      list.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-kind]');
        if (!btn) return;
        var kind = btn.getAttribute('data-kind');
        var i = Number(btn.getAttribute('data-i'));
        tagState[kind].splice(i, 1);
        renderTagField(kind);
      });
    });
    ['tags', 'includes', 'excludes', 'units'].forEach(bindTagField);

    /* 关键词规则：输入框右侧的「添加」按钮，与回车行为一致 */
    $$('[data-add]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var kind = btn.getAttribute('data-add');
        var input = $('#' + kind + '-input');
        if (input && input.value.trim()) {
          addTag(kind, input.value);
          input.value = '';
        }
        if (input) input.focus();
      });
    });
  }

  function bindMiscEvents() {
    $$('#cat-seg button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('#cat-seg button').forEach(function (b) { b.setAttribute('aria-selected', 'false'); });
        btn.setAttribute('aria-selected', 'true');
        state.level = btn.getAttribute('data-level');
        renderCategory();
      });
    });

    $('#cat-clear').addEventListener('click', function () { applyCatFilter('all'); });
    bindDrillEvents();

    $$('.sort').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-key');
        if (state.sortKey === key) state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
        else { state.sortKey = key; state.sortDir = 'desc'; }
        renderTable();
      });
    });

    $$('.seg-mini').forEach(function (seg) {
      $$('button', seg).forEach(function (btn) {
        btn.addEventListener('click', function () {
          var panel = seg.getAttribute('data-panel');
          if (panel === 'repeat') state.repeatSet = btn.getAttribute('data-set');
          else state.sameSet = btn.getAttribute('data-set');
          renderPersons();
        });
      });
    });

    $$('[data-toast]').forEach(function (btn) {
      btn.addEventListener('click', function () { toast(btn.getAttribute('data-toast')); });
    });

    $('#btn-kpi-detail').addEventListener('click', openKpiOrders);
    $('#btn-warn-all').addEventListener('click', openWarnAllOrders);

    var userBtn = $('.user-btn');
    if (userBtn) userBtn.addEventListener('click', function () { toast('当前账号：管理员 · 市公安局研判专班'); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        C.hideTip();
        openTypePanel(false);
      }
    });

    var ro = new ResizeObserver(function () {
      renderCategory();
      renderPersons();
      renderPersonDrill();
    });
    ro.observe($('#cat-chart'));
    ro.observe($('#repeat-chart'));
  }

  /* ----------------------------- 启动 ----------------------------- */

  renderDonuts();
  initOrdersTable();
  renderTypeTrigger();
  renderTypeList();
  renderCategory();
  renderPersons();
  renderPersonDrill();
  renderPoints();
  renderTable();
  renderFocus();
  fillDialogOptions();
  initSelectUI();
  initDatePeriod();
  bindFilterEvents();
  bindFocusEvents();
  bindMiscEvents();

  // 首次进入给出一次操作引导
  window.setTimeout(function () {
    toast('提示：点击柱体、扇区、点位或表格行均可下钻明细');
  }, 900);
})();
