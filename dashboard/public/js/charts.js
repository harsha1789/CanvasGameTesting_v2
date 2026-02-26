/**
 * GamePulse Charts — Lightweight Canvas 2D chart helpers.
 */

const Charts = {
  colors: {
    success: '#22c55e',
    danger: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6',
    accent: '#06b6d4',
    purple: '#a78bfa',
    muted: '#64748b',
    bg: '#1e293b',
    border: '#334155',
    text: '#e2e8f0',
    textDim: '#94a3b8',
  },

  /** Horizontal bar chart */
  barChart(canvasId, data, options = {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { labels, values, color = this.colors.accent, maxValue } = data;
    const barHeight = options.barHeight || 24;
    const gap = options.gap || 6;
    const labelWidth = options.labelWidth || 140;
    const h = (barHeight + gap) * labels.length + 20;
    const w = canvas.parentElement.clientWidth || 500;

    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);

    const max = maxValue || Math.max(...values, 1);
    const barAreaWidth = w - labelWidth - 60;

    labels.forEach((label, i) => {
      const y = i * (barHeight + gap) + 10;
      const barW = (values[i] / max) * barAreaWidth;

      // Label
      ctx.fillStyle = this.colors.textDim;
      ctx.font = '11px -apple-system, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(label.length > 20 ? label.slice(0, 20) + '...' : label, labelWidth - 10, y + barHeight / 2);

      // Bar background
      ctx.fillStyle = this.colors.border;
      ctx.beginPath();
      ctx.roundRect(labelWidth, y, barAreaWidth, barHeight, 3);
      ctx.fill();

      // Bar fill
      if (barW > 0) {
        ctx.fillStyle = typeof color === 'function' ? color(values[i], i) : color;
        ctx.beginPath();
        ctx.roundRect(labelWidth, y, Math.max(barW, 3), barHeight, 3);
        ctx.fill();
      }

      // Value text
      ctx.fillStyle = this.colors.text;
      ctx.font = '11px -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(values[i].toLocaleString(), labelWidth + barW + 8, y + barHeight / 2);
    });
  },

  /** Donut chart for status code distribution */
  donutChart(canvasId, data, options = {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = options.size || 120;
    canvas.width = size;
    canvas.height = size;

    const { segments } = data;
    const total = segments.reduce((s, seg) => s + seg.value, 0);
    if (total === 0) return;

    const cx = size / 2;
    const cy = size / 2;
    const outerR = size / 2 - 4;
    const innerR = outerR * 0.6;
    let startAngle = -Math.PI / 2;

    segments.forEach(seg => {
      const sliceAngle = (seg.value / total) * 2 * Math.PI;
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, startAngle, startAngle + sliceAngle);
      ctx.arc(cx, cy, innerR, startAngle + sliceAngle, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = seg.color;
      ctx.fill();
      startAngle += sliceAngle;
    });

    // Center text
    ctx.fillStyle = this.colors.text;
    ctx.font = 'bold 16px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(total.toLocaleString(), cx, cy);
  },

  /** Percentile bar visualization */
  percentileBar(canvasId, data) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.parentElement.clientWidth || 300;
    canvas.width = w;
    canvas.height = 50;

    const { p50, p90, p95, p99, max } = data;
    const barY = 24;
    const barH = 10;
    const scale = (w - 100) / (max || p99 || 1);

    const bars = [
      { label: 'P50', value: p50, color: this.colors.success },
      { label: 'P90', value: p90, color: this.colors.warning },
      { label: 'P95', value: p95, color: '#f97316' },
      { label: 'P99', value: p99, color: this.colors.danger },
    ];

    // Background
    ctx.fillStyle = this.colors.border;
    ctx.beginPath();
    ctx.roundRect(50, barY, w - 100, barH, 3);
    ctx.fill();

    // Draw markers
    bars.forEach(bar => {
      const x = 50 + bar.value * scale;
      ctx.fillStyle = bar.color;
      ctx.beginPath();
      ctx.arc(x, barY + barH / 2, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = this.colors.textDim;
      ctx.font = '9px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(bar.label, x, barY - 6);
      ctx.fillText(`${bar.value}ms`, x, barY + barH + 12);
    });
  },
};
