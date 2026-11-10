/* =========================================================================
 * 工单分析工作台 · 图表与明细抽屉
 * 纯原生 SVG 渲染：柱状图 / 环形图 / 堆叠柱 / 横向条形 / 折线 + 通用抽屉。
 * 依赖 index.html 中的 <symbol> 图标与 <defs> 渐变。
 * ========================================================================= */
window.WBCharts = (function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var BRAND = '#265FE5';

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pct(v, total) { return (v / total * 100).toFixed(1) + '%'; }

  function truncate(text, max) {
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
  }

  function niceMax(v) {
    if (v <= 4) return 4;
    var step = Math.pow(10, Math.floor(Math.log(v) / Math.LN10)) / 2;
    var m = Math.ceil(v / step) * step;
    return Math.ceil(m / 4) * 4;
  }

  /* ----------------------------- 浮层提示 ----------------------------- */

  var tipEl = document.createElement('div');
  tipEl.className = 'chart-tip';
  tipEl.setAttribute('role', 'tooltip');
  document.body.appendChild(tipEl);

  function showTip(html, x, y) {
    tipEl.innerHTML = html;
    tipEl.classList.add('on');
    var w = tipEl.offsetWidth;
    var h = tipEl.offsetHeight;
    var left = Math.min(Math.max(x - w / 2, 12), window.innerWidth - w - 12);
    var top = y - h - 14;
    if (top < 8) top = y + 18;
    tipEl.style.left = left + 'px';
    tipEl.style.top = top + 'px';
  }

  function hideTip() { tipEl.classList.remove('on'); }

  function tipRows(rows) {
    return rows.map(function (r) {
      return '<div class="tip-row"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>';
    }).join('');
  }

  /* ----------------------------- 柱状图 ----------------------------- */

  function renderColumnChart(container, series, opts) {
    opts = opts || {};
    if (!series.length) { container.innerHTML = ''; return; }
    var W = container.clientWidth || 1000;
    var H = container.clientHeight || 306;
    var interactive = typeof opts.onSelect === 'function';
    var compact = !!opts.compact;
    var left = compact ? 30 : 34;
    var right = 8;
    var iw = W - left - right;
    var slot = iw / series.length;
    /* 标签按 12px 字号估算：项目多且水平放不下时才倾斜，否则水平单行、过长省略 */
    var longest = series.reduce(function (mx, d) { return Math.max(mx, String(d.name).length); }, 0);
    var autoRotate = series.length >= 6 && slot < longest * 12 + 6;
    var rotate = opts.rotate === true || (opts.rotate !== false && autoRotate);
    var m = {
      top: compact ? 20 : 26, right: right,
      bottom: rotate ? (compact ? 88 : 96) : (compact ? 30 : 38),
      left: left
    };
    var ih = H - m.top - m.bottom;
    var total = opts.total || 190;
    var max = niceMax(Math.max.apply(null, series.map(function (d) { return d.value; })));
    var bw = Math.min(compact ? 22 : 30, Math.max(6, slot * (rotate ? 0.52 : 0.44)));
    container.classList.toggle('chart-static', !interactive);

    var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
      esc(opts.label) + '，共 ' + series.length + ' 个分类，最高为' + esc(series[0].name) + ' ' + series[0].value + ' 件">'];

    for (var t = 0; t <= 4; t++) {
      var val = max / 4 * t;
      var gy = m.top + ih - (val / max) * ih;
      svg.push('<line class="' + (t === 0 ? 'baseline' : 'grid-line') + '" x1="' + m.left + '" y1="' + gy + '" x2="' + (W - m.right) + '" y2="' + gy + '"/>');
      svg.push('<text class="axis-label" x="' + (m.left - 8) + '" y="' + (gy + 4) + '" text-anchor="end">' + Math.round(val) + '</text>');
    }

    series.forEach(function (d, i) {
      var x = m.left + slot * i + (slot - bw) / 2;
      var h = Math.max((d.value / max) * ih, 2);
      var y = m.top + ih - h;
      var active = !opts.selected || opts.selected === d.name;
      svg.push('<g class="bar-group' + (opts.selected === d.name ? ' is-selected' : '') + '" data-i="' + i + '"' +
        (interactive ? ' tabindex="0" role="button" aria-label="' + esc(d.name) + ' ' + d.value + ' 件，点击下钻"' : '') + '>');
      svg.push('<rect class="bar" x="' + x + '" y="' + y + '" width="' + bw + '" height="' + h +
        '" rx="3" fill="url(#g-bar)" opacity="' + (active ? 1 : 0.42) + '" style="animation-delay:' + (i * 22) + 'ms"/>');
      svg.push('<rect x="' + (m.left + slot * i) + '" y="' + m.top + '" width="' + slot + '" height="' + ih + '" fill="transparent"/>');
      svg.push('<text class="axis-label strong" x="' + (x + bw / 2) + '" y="' + (y - 6) + '" text-anchor="middle" style="font-weight:600;fill:' +
        (active ? '#1B1B1F' : '#8A8F99') + '">' + d.value + '</text>');
      /* 标签单行显示：水平按槽宽截断，倾斜按斜向可容纳字数，悬停显示完整名称 */
      var label = rotate
        ? truncate(d.name, compact ? (slot > 44 ? 9 : 8) : (slot > 46 ? 12 : 10))
        : truncate(d.name, Math.max(2, Math.floor((slot - 6) / 11)));
      var labelTitle = '<title>' + esc(d.name) + '</title>';
      if (rotate) {
        svg.push('<text class="axis-label" transform="translate(' + (m.left + slot * i + slot / 2 + 4) + ',' + (m.top + ih + (compact ? 10 : 14)) +
          ') rotate(-38)" text-anchor="end">' + esc(label) + labelTitle + '</text>');
      } else if (slot >= 26) {
        svg.push('<text class="axis-label" x="' + (m.left + slot * i + slot / 2) + '" y="' + (m.top + ih + 19) + '" text-anchor="middle">' +
          esc(label) + labelTitle + '</text>');
      }
      svg.push('</g>');
    });

    svg.push('</svg>');
    container.innerHTML = svg.join('');

    $$('.bar-group', container).forEach(function (g) {
      var d = series[Number(g.getAttribute('data-i'))];
      function enter(e) {
        var r = g.getBoundingClientRect();
        showTip('<div class="tip-title">' + esc(d.name) + '</div>' +
          tipRows([['工单量', d.value + ' 件'], ['占本期', pct(d.value, total)]]) +
          (interactive ? '<div class="tip-foot">点击柱体可下钻预警明细</div>' : ''), r.left + r.width / 2, e.clientY || r.top);
      }
      g.addEventListener('mousemove', enter);
      g.addEventListener('mouseenter', enter);
      g.addEventListener('mouseleave', hideTip);
      if (interactive) {
        g.addEventListener('focus', function () {
          var r = g.getBoundingClientRect();
          showTip('<div class="tip-title">' + esc(d.name) + '</div>' + tipRows([['工单量', d.value + ' 件']]), r.left + r.width / 2, r.top);
        });
        g.addEventListener('blur', hideTip);
        g.addEventListener('click', function () { hideTip(); opts.onSelect(d.name); });
        g.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hideTip(); opts.onSelect(d.name); }
        });
      }
    });
  }

  /* ----------------------------- 环形图 ----------------------------- */

  function renderDonut(container, legendEl, items, total, centerLabel, opts) {
    opts = opts || {};
    var colors = opts.colors || ['#265FE5', '#12B5C9', '#FF7A45', '#7A5AF8', '#FFB020'];
    var size = 132, cx = size / 2, cy = size / 2, r = 51, sw = 13;
    var c = 2 * Math.PI * r;
    var offset = 0;
    var active = null;

    var svg = ['<svg viewBox="0 0 ' + size + ' ' + size + '" role="group" aria-label="' +
      esc(centerLabel) + '构成：' + items.map(function (d) { return esc(d.name) + ' ' + d.value + ' 件'; }).join('，') + '">'];
    svg.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#F0F2F5" stroke-width="' + sw + '"/>');
    items.forEach(function (d, i) {
      var len = (d.value / total) * c;
      var gap = 2;
      svg.push('<circle class="donut-seg" data-i="' + i + '" cx="' + cx + '" cy="' + cy + '" r="' + r +
        '" fill="none" stroke="' + (colors[i] || '#A6AEC2') + '" stroke-width="' + sw + '" stroke-linecap="butt"' +
        ' stroke-dasharray="' + Math.max(len - gap, 1) + ' ' + c + '" stroke-dashoffset="' + (-offset) +
        '" transform="rotate(-90 ' + cx + ' ' + cy + ')" tabindex="0" role="button" aria-label="' +
        esc(d.name) + ' ' + d.value + ' 件，' + d.pct + '%，点击下钻"' +
        ' style="transition:stroke-dasharray .6s cubic-bezier(.22,.61,.36,1) ' + (i * 80) + 'ms,stroke-width .15s,opacity .15s"/>');
      offset += len;
    });
    /* 中心数字 24px：字框上方的 ascender 空间让文本偏上，基线压在圆心下方 2px 才是视觉居中 */
    svg.push('<text class="donut-center" x="' + cx + '" y="' + (cy + 2) + '" text-anchor="middle">' +
      '<tspan class="num" x="' + cx + '" dy="0">' + total + '</tspan>' +
      '<tspan class="lbl" x="' + cx + '" dy="20">' + esc(centerLabel) + '</tspan></text>');
    svg.push('</svg>');
    container.innerHTML = svg.join('');

    legendEl.innerHTML = items.map(function (d, i) {
      return '<li class="legend-item" data-i="' + i + '" role="button" tabindex="0" aria-pressed="false" aria-label="' +
        esc(d.name) + ' ' + d.value + ' 件，' + d.pct + '%，点击下钻">' +
        '<span class="swatch" style="background:' + (colors[i] || '#A6AEC2') + '"></span>' +
        '<span class="name">' + esc(d.name) + '</span>' +
        '<span class="val">' + d.value + '</span>' +
        '<span class="pct">' + d.pct + '%</span></li>';
    }).join('');

    var numEl = $('.donut-center .num', container);
    var lblEl = $('.donut-center .lbl', container);

    function paint(index) {
      active = index;
      $$('.donut-seg', container).forEach(function (s, i) {
        var on = i === index;
        s.style.strokeWidth = on ? '17' : '';
        s.style.opacity = (index === null || on) ? '1' : '.42';
        s.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      $$('.legend-item', legendEl).forEach(function (li, i) {
        li.setAttribute('aria-pressed', i === index ? 'true' : 'false');
      });
      if (numEl && lblEl) {
        numEl.textContent = index === null ? total : items[index].value;
        lblEl.textContent = index === null ? centerLabel : items[index].name;
      }
    }

    function pick(index) {
      paint(active === index ? null : index);
      if (opts.onPick) opts.onPick(items[index], index);
    }

    $$('.donut-seg', container).forEach(function (seg) {
      var i = Number(seg.getAttribute('data-i'));
      var d = items[i];
      seg.addEventListener('mousemove', function (e) {
        showTip('<div class="tip-title">' + esc(d.name) + '</div>' +
          tipRows([['工单量', d.value + ' 件'], ['占比', d.pct + '%']]) +
          '<div class="tip-foot">点击扇区可下钻</div>', e.clientX, e.clientY);
      });
      seg.addEventListener('mouseleave', hideTip);
      seg.addEventListener('click', function () { hideTip(); pick(i); });
      seg.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hideTip(); pick(i); }
      });
      seg.addEventListener('focus', function () { paint(i); });
      seg.addEventListener('blur', function () { paint(null); });
    });

    $$('.legend-item', legendEl).forEach(function (li) {
      var i = Number(li.getAttribute('data-i'));
      li.addEventListener('click', function () { pick(i); });
      li.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(i); }
      });
      li.addEventListener('mouseenter', function () {
        var seg = $$('.donut-seg', container)[i];
        if (seg && active === null) seg.style.opacity = '1';
        if (numEl && lblEl && active === null) {
          numEl.textContent = items[i].value;
          lblEl.textContent = items[i].name;
        }
      });
      li.addEventListener('mouseleave', function () {
        if (active === null) {
          $$('.donut-seg', container).forEach(function (s) { s.style.opacity = '1'; });
          if (numEl && lblEl) { numEl.textContent = total; lblEl.textContent = centerLabel; }
        }
      });
    });
  }

  /* ----------------------------- 堆叠柱 / 单值柱 ----------------------------- */

  function renderStacked(container, rows, opts) {
    opts = opts || {};
    var W = container.clientWidth || 620;
    var H = container.clientHeight || 218;
    /* 手机号标签斜排：按可用槽宽自动选角度，保证相邻标签不重叠；
       传 opts.angleCount 时按同组数据的最大条数统一角度，使同卡不同 tab（一人多诉 / 重新交办）倾斜角度一致 */
    var labelLen = 72;
    var slotCount = Math.max(rows.length, opts.angleCount || 0, 1);
    var ang = Math.acos(Math.min(1, Math.max(0.16, ((W - 36) / slotCount - 6) / labelLen))) * 180 / Math.PI;
    ang = Math.min(58, Math.max(20, ang));
    var bottom = Math.round(Math.min(78, labelLen * Math.sin(ang * Math.PI / 180) + 16));
    var m = { top: 24, right: 6, bottom: bottom, left: 30 };
    var iw = W - m.left - m.right;
    var ih = H - m.top - m.bottom;
    var max = niceMax(Math.max.apply(null, rows.map(function (d) { return d.total; })));
    var slot = iw / rows.length;
    var bw = Math.min(26, slot * 0.56);
    var partNames = opts.partNames || [];
    var segColors = opts.colors || [];

    var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.label) + '">'];
    for (var t = 0; t <= 4; t++) {
      var val = max / 4 * t;
      var gy = m.top + ih - (val / max) * ih;
      svg.push('<line class="' + (t === 0 ? 'baseline' : 'grid-line') + '" x1="' + m.left + '" y1="' + gy + '" x2="' + (W - m.right) + '" y2="' + gy + '"/>');
      svg.push('<text class="axis-label" x="' + (m.left - 6) + '" y="' + (gy + 4) + '" text-anchor="end">' + Math.round(val) + '</text>');
    }

    rows.forEach(function (d, i) {
      var x = m.left + slot * i + (slot - bw) / 2;
      var acc = 0;
      var isSelected = opts.selected === d.phone;
      svg.push('<g class="bar-group' + (isSelected ? ' is-selected' : '') + '" data-i="' + i + '" tabindex="0" role="button" aria-label="' +
        esc(d.phone) + '，' + d.total + ' 件，点击查看下探">');
      var parts = d.parts || [d.total];
      parts.forEach(function (v, si) {
        if (!v) return;
        var h = (v / max) * ih;
        var y = m.top + ih - acc - h;
        var fill = !d.parts ? 'url(#g-bar)' : (segColors[si] || 'url(#g-bar)');
        svg.push('<rect class="stack-seg" x="' + x + '" y="' + y + '" width="' + bw + '" height="' + Math.max(h, 1) +
          '" rx="1.5" fill="' + fill + '" style="animation-delay:' + (i * 24 + si * 30) + 'ms"/>');
        acc += h;
      });
      svg.push('<rect x="' + (m.left + slot * i) + '" y="' + m.top + '" width="' + slot + '" height="' + ih + '" fill="transparent"/>');
      svg.push('<text class="axis-label" x="' + (x + bw / 2) + '" y="' + (m.top + ih - (d.total / max) * ih - 6) +
        '" text-anchor="middle" style="font-weight:600;fill:' + BRAND + '">' + d.total + '</text>');
      var lx = m.left + slot * i + slot / 2;
      var ly = m.top + ih + 16;
      svg.push('<text class="axis-label" x="' + lx + '" y="' + ly + '" text-anchor="end"' +
        ' transform="rotate(-' + ang.toFixed(0) + ' ' + lx + ' ' + ly + ')"' +
        (isSelected ? ' style="font-weight:600;fill:' + BRAND + '"' : '') + '>' + esc(d.phone) + '</text>');
      svg.push('</g>');
    });
    svg.push('</svg>');
    container.innerHTML = svg.join('');

    $$('.bar-group', container).forEach(function (g) {
      var d = rows[Number(g.getAttribute('data-i'))];
      var title = d.phone + (d.parts ? ' · 本期多诉' : (opts.singleLabel || '本期同诉'));
      var body = d.parts ? d.parts.map(function (v, i) {
        if (!v) return '';
        var c = segColors[i] || BRAND;
        return '<div class="tip-row"><span><i class="tip-dot" style="background:' + c + '"></i>' + esc(partNames[i] || '') + '</span><b>' + v + '</b></div>';
      }).join('') : tipRows([['工单量', d.total + ' 件']]);
      function enter(e) {
        var r = g.getBoundingClientRect();
        showTip('<div class="tip-title">' + esc(d.phone) + '</div>' +
          tipRows([[d.parts ? '合计' : '工单量', d.total + ' 件']]) + body +
          '<div class="tip-foot">点击查看该诉求人下探画像</div>', r.left + r.width / 2, e.clientY || r.top);
      }
      g.addEventListener('mousemove', enter);
      g.addEventListener('mouseenter', enter);
      g.addEventListener('mouseleave', hideTip);
      g.addEventListener('focus', function () {
        var r = g.getBoundingClientRect();
        showTip('<div class="tip-title">' + esc(title) + '</div>' + tipRows([['工单量', d.total + ' 件']]), r.left + r.width / 2, r.top);
      });
      g.addEventListener('blur', hideTip);
      g.addEventListener('click', function () { hideTip(); opts.onSelect(d.phone); });
      g.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hideTip(); opts.onSelect(d.phone); }
      });
    });
  }

  /* ----------------------------- 横向条形 ----------------------------- */

  function barsHtml(rows, opts) {
    opts = opts || {};
    var max = Math.max.apply(null, rows.map(function (d) { return d.v; }));
    return rows.map(function (d, i) {
      var w = Math.max((d.v / max) * 100, 2);
      return '<div class="hbar' + (opts.clickable ? ' clickable' : '') + (opts.selected === d.n ? ' is-selected' : '') + '" data-i="' + i + '" role="' + (opts.clickable ? 'button' : 'group') + '"' +
        (opts.clickable ? ' tabindex="0"' : '') +
        ' aria-label="' + esc(d.n) + ' ' + d.v + ' 件' + (opts.clickable ? '，点击查看详情' : '') + '"' +
        (opts.ranked ? ' style="animation-delay:' + (i * 30) + 'ms"' : '') + '>' +
        (opts.ranked ? '<span class="rank" aria-hidden="true">' + (i + 1) + '</span>' : '') +
        '<span class="hbar-label" title="' + esc(d.n) + '">' + esc(d.n) + '</span>' +
        '<span class="hbar-track"><span class="hbar-fill" data-w="' + w + '"></span></span>' +
        '<span class="hbar-value">' + d.v + '</span></div>';
    }).join('');
  }

  function animateBars(root) {
    window.requestAnimationFrame(function () {
      $$('.hbar-fill', root).forEach(function (el) { el.style.width = el.getAttribute('data-w') + '%'; });
    });
  }

  function renderBars(container, rows, opts) {
    opts = opts || {};
    container.innerHTML = barsHtml(rows, opts);
    animateBars(container);

    $$('.hbar', container).forEach(function (el) {
      var d = rows[Number(el.getAttribute('data-i'))];
      el.addEventListener('mousemove', function (e) {
        showTip('<div class="tip-title">' + esc(d.n) + '</div>' +
          tipRows([['工单量', d.v + ' 件'], ['排名', '第 ' + (Number(el.getAttribute('data-i')) + 1) + ' 位']]) +
          (opts.clickable ? '<div class="tip-foot">点击查看点位详情</div>' : ''), e.clientX, e.clientY);
      });
      el.addEventListener('mouseleave', hideTip);
      if (opts.clickable && opts.onSelect) {
        el.addEventListener('click', function () { hideTip(); opts.onSelect(d); });
        el.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hideTip(); opts.onSelect(d); }
        });
      }
    });
  }

  /* ----------------------------- 折线图 ----------------------------- */

  function renderTrend(container, values, dates, opts) {
    opts = opts || {};
    var W = container.clientWidth || 300;
    var H = container.clientHeight || 118;
    var m = { top: 14, right: 12, bottom: 20, left: 22 };
    var iw = W - m.left - m.right;
    var ih = H - m.top - m.bottom;
    var max = Math.max.apply(null, values);
    var peak = values.indexOf(max);
    var pts = values.map(function (v, i) {
      return [m.left + (iw / (values.length - 1)) * i, m.top + ih - (v / max) * ih];
    });

    var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
      esc(opts.label || '趋势分布') + '：' + dates.map(function (d, i) { return d + ' ' + values[i] + ' 件'; }).join('，') + '">'];
    [0, max / 2, max].forEach(function (val, i) {
      var y = m.top + ih - (val / max) * ih;
      svg.push('<line class="' + (i === 0 ? 'baseline' : 'grid-line') + '" x1="' + m.left + '" y1="' + y + '" x2="' + (W - m.right) + '" y2="' + y + '"/>');
      svg.push('<text class="axis-label" x="' + (m.left - 5) + '" y="' + (y + 3.5) + '" text-anchor="end" style="font-size:12px">' + Math.round(val) + '</text>');
    });

    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0] + ',' + p[1]; }).join(' ');
    var area = line + ' L' + pts[pts.length - 1][0] + ',' + (m.top + ih) + ' L' + pts[0][0] + ',' + (m.top + ih) + ' Z';
    svg.push('<path d="' + area + '" fill="url(#g-area)"/>');
    svg.push('<path class="line-path" d="' + line + '" fill="none" stroke="url(#g-line)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>');

    pts.forEach(function (p, i) {
      var isPeak = i === peak;
      svg.push('<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + (isPeak ? 4.5 : 3) + '" fill="' + (isPeak ? BRAND : '#fff') + '" stroke="' + BRAND + '" stroke-width="1.6"/>');
      if (i % 2 === 0 || i === values.length - 1) {
        svg.push('<text class="axis-label" x="' + p[0] + '" y="' + (H - 4) + '" text-anchor="middle" style="font-size:12px">' + dates[i] + '</text>');
      }
    });
    svg.push('<text class="axis-label" x="' + Math.min(pts[peak][0] + 4, W - 58) + '" y="' + (pts[peak][1] - 10) +
      '" style="font-size:12px;fill:' + BRAND + ';font-weight:600">峰值 ' + max + ' 件</text>');

    pts.forEach(function (p, i) {
      svg.push('<circle class="trend-hit" data-i="' + i + '" cx="' + p[0] + '" cy="' + p[1] + '" r="11" fill="transparent" tabindex="0" role="button" aria-label="' +
        dates[i] + ' ' + values[i] + ' 件"/>');
    });
    svg.push('</svg>');
    container.innerHTML = svg.join('');

    $$('.trend-hit', container).forEach(function (hit) {
      var i = Number(hit.getAttribute('data-i'));
      function enter(e) {
        showTip('<div class="tip-title">' + dates[i] + '</div>' + tipRows([['当日工单', values[i] + ' 件']]), e.clientX, e.clientY);
      }
      hit.addEventListener('mousemove', enter);
      hit.addEventListener('mouseenter', enter);
      hit.addEventListener('mouseleave', hideTip);
      hit.addEventListener('focus', function () {
        var b = hit.getBoundingClientRect();
        showTip('<div class="tip-title">' + dates[i] + '</div>' + tipRows([['当日工单', values[i] + ' 件']]), b.left + b.width / 2, b.top);
      });
      hit.addEventListener('blur', hideTip);
    });
  }

  /* ----------------------------- 明细抽屉 ----------------------------- */

  var lastFocus = null;

  function sectionHtml(sec) {
    var h = '<section class="drawer-section"><h3>' + esc(sec.title) + '</h3>';
    if (sec.desc) h += '<p class="drawer-desc">' + esc(sec.desc) + '</p>';
    if (sec.hbars) {
      h += '<div class="hbars drawer-hbars' + (sec.ranked ? ' hbars-ranked' : '') + '">' + barsHtml(sec.hbars, { ranked: sec.ranked }) + '</div>';
    }
    if (sec.table) {
      h += '<div class="drawer-table-wrap"><table class="drawer-table"><thead><tr>' +
        sec.table.head.map(function (x) { return '<th>' + x + '</th>'; }).join('') +
        '</tr></thead><tbody>' +
        sec.table.rows.map(function (r) {
          return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
        }).join('') +
        '</tbody></table></div>';
    }
    if (sec.list) {
      h += '<ul class="drawer-list">' + sec.list.map(function (it) {
        return '<li><div class="li-main"><b>' + esc(it.title) + '</b><span>' + esc(it.desc || '') + '</span></div>' +
          (it.meta ? '<span class="li-meta">' + esc(it.meta) + '</span>' : '') + '</li>';
      }).join('') + '</ul>';
    }
    return h + '</section>';
  }

  function openDrawer(cfg) {
    var dlg = $('#drawer');
    var backdrop = $('#drawer-backdrop');
    if (!dlg || !backdrop) return;
    cfg = cfg || {};
    lastFocus = document.activeElement;

    /* 下钻弹窗不再展示顶部 kicker 文案，直接以标题为首行 */
    /* 标题拆出文字节点，避免 textContent 覆盖图标；图标可由 cfg.icon 切换 */
    var titleText = $('#drawer-title-text');
    if (titleText) titleText.textContent = cfg.title || '明细';
    var titleIco = $('#drawer-ico');
    if (titleIco && cfg.icon) titleIco.src = 'icons/' + cfg.icon + '.png';
    var sub = $('#drawer-sub');
    sub.textContent = cfg.sub || '';
    sub.hidden = !cfg.sub;

    var body = '';
    if (cfg.metrics && cfg.metrics.length) {
      body += '<div class="drawer-metrics"' + (cfg.metrics.length < 3
        ? ' style="grid-template-columns:repeat(' + cfg.metrics.length + ',minmax(0,1fr))"' : '') + '>';
      cfg.metrics.forEach(function (m) {
        body += '<div class="drawer-metric"><span>' + esc(m.label) + '</span><b>' + esc(m.value) +
          (m.unit ? '<i>' + esc(m.unit) + '</i>' : '') + '</b></div>';
      });
      body += '</div>';
    }
    (cfg.sections || []).forEach(function (sec) { body += sectionHtml(sec); });
    var grid = cfg.chartGrid || [];
    if (grid.length) {
      body += '<div class="drawer-chart-grid">' + grid.map(function (c, i) {
        return '<section class="drawer-chart"><h3>' +
          (c.icon ? '<svg class="ico ico-xs" aria-hidden="true"><use href="' + c.icon + '"/></svg>' : '') +
          esc(c.title) + '</h3><div class="drawer-chart-body" id="drawer-chart-' + i + '"></div></section>';
      }).join('') + '</div>';
    }
    /* 先应用宽度变体并强制布局，否则图表会按未展开的旧宽度计算坐标 */
    dlg.classList.toggle('drawer-wide', !!cfg.wide);
    $('#drawer-body').innerHTML = body;
    void dlg.offsetWidth;
    animateBars($('#drawer-body'));
    function renderGrid() {
      grid.forEach(function (c, i) {
        var el = $('#drawer-chart-' + i);
        if (!el) return;
        if (c.kind === 'trend') {
          renderTrend(el, c.values || [], c.dates || [], { label: c.title });
        } else if (c.kind === 'bars') {
          el.classList.add('is-bars');
          el.innerHTML = '<div class="hbars drawer-hbars">' + barsHtml(c.rows || [], {}) + '</div>';
          animateBars(el);
        } else {
          renderColumnChart(el, c.series || [], { label: c.title, compact: true, rotate: c.rotate, total: c.total });
        }
      });
    }
    renderGrid();

    var foot = $('#drawer-foot');
    foot.innerHTML = '';
    var actions = cfg.actions || [];
    actions.forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + (a.primary ? 'btn-primary' : 'btn-ghost');
      b.textContent = a.label;
      b.addEventListener('click', function () {
        if (a.onClick) a.onClick();
        if (!a.keepOpen) closeDrawer();
      });
      foot.appendChild(b);
    });
    if (!actions.length) {
      var close = document.createElement('button');
      close.type = 'button';
      close.className = 'btn btn-ghost';
      close.textContent = '关闭';
      close.addEventListener('click', closeDrawer);
      foot.appendChild(close);
    }

    dlg.classList.toggle('drawer-wide', !!cfg.wide);
    backdrop.hidden = false;
    dlg.setAttribute('aria-hidden', 'false');
    document.body.classList.add('drawer-open');
    window.requestAnimationFrame(function () {
      backdrop.classList.add('on');
      dlg.classList.add('on');
    });
    var closeBtn = $('#drawer-close');
    if (closeBtn) closeBtn.focus();
  }

  function closeDrawer() {
    var dlg = $('#drawer');
    var backdrop = $('#drawer-backdrop');
    if (!dlg || !backdrop) return;
    dlg.classList.remove('on');
    backdrop.classList.remove('on');
    dlg.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('drawer-open');
    hideTip();
    window.setTimeout(function () { backdrop.hidden = true; }, 260);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function initDrawer() {
    var closeBtn = $('#drawer-close');
    var backdrop = $('#drawer-backdrop');
    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
    if (backdrop) backdrop.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var dlg = $('#drawer');
        if (dlg && dlg.classList.contains('on')) closeDrawer();
      }
    });
  }

  initDrawer();

  return {
    renderColumnChart: renderColumnChart,
    renderDonut: renderDonut,
    renderStacked: renderStacked,
    renderBars: renderBars,
    renderTrend: renderTrend,
    barsHtml: barsHtml,
    openDrawer: openDrawer,
    closeDrawer: closeDrawer,
    showTip: showTip,
    hideTip: hideTip,
    esc: esc,
    pct: pct
  };
})();
