(function (root) {
  'use strict';
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function dimensions(ratio, sourceWidth, sourceHeight) {
    if (ratio === 'horizontal') return { width: 1280, height: 720 };
    const aspect = { vertical: 9 / 16, horizontal: 16 / 9, square: 1 }[ratio] || (sourceWidth && sourceHeight ? sourceWidth / sourceHeight : 16 / 9);
    return { width: 720, height: Math.max(2, Math.round(720 / aspect / 2) * 2) };
  }
  function crop(sourceWidth, sourceHeight, width, height, x = 50, y = 50) {
    const scale = Math.max(width / sourceWidth, height / sourceHeight);
    const sw = width / scale, sh = height / scale;
    return { sx: (sourceWidth - sw) * clamp(x, 0, 100) / 100, sy: (sourceHeight - sh) * clamp(y, 0, 100) / 100, sw, sh };
  }
  function wrap(context, text, maxWidth) {
    const rows = [];
    for (const paragraph of text.split('\n')) {
      let row = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        if (row && context.measureText(`${row} ${word}`).width > maxWidth) { rows.push(row); row = ''; }
        if (context.measureText(word).width > maxWidth) {
          if (row) { rows.push(row); row = ''; }
          const letters = typeof Intl.Segmenter === 'function' ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word), item => item.segment) : Array.from(word);
          for (const letter of letters) {
            if (row && context.measureText(row + letter).width > maxWidth) { rows.push(row); row = ''; }
            row += letter;
          }
        } else row += (row ? ' ' : '') + word;
      }
      rows.push(row);
    }
    return rows;
  }
  function draw(canvas, context, source, time, lines, style) {
    const w = canvas.width, h = canvas.height;
    context.fillStyle = '#141914'; context.fillRect(0, 0, w, h);
    if (source.videoWidth && source.videoHeight) {
      const c = crop(source.videoWidth, source.videoHeight, w, h, style.cropX, style.cropY);
      context.drawImage(source, c.sx, c.sy, c.sw, c.sh, 0, 0, w, h);
    }
    const caption = lines.find(c => time >= c.start && time < c.end);
    if (!caption) return false;
    const fontSize = style.size * w / 720;
    context.font = `800 ${fontSize}px system-ui, sans-serif`;
    context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillStyle = style.color; context.strokeStyle = '#101010'; context.lineJoin = 'round';
    const maxWidth = w * .86, rows = wrap(context, caption.text, maxWidth), lineHeight = fontSize * 1.18;
    const textWidth = Math.min(maxWidth, Math.max(...rows.map(text => context.measureText(text).width)));
    const x = clamp(w * style.x / 100, textWidth / 2, w - textWidth / 2);
    const blockHeight = rows.length * lineHeight;
    const y = clamp(h * style.y / 100, blockHeight / 2, h - blockHeight / 2) - (rows.length - 1) * lineHeight / 2;
    context.lineWidth = fontSize / 9;
    rows.forEach((text, index) => {
      if (style.shadow) context.strokeText(text, x, y + index * lineHeight);
      context.fillText(text, x, y + index * lineHeight);
    });
    return true;
  }
  const api = { dimensions, crop, wrap, draw };
  if (typeof module !== 'undefined') module.exports = api;
  else root.CliploomMedia = api;
})(typeof window !== 'undefined' ? window : globalThis);
