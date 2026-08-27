(() => {
  const mq = window.matchMedia('(max-width: 640px)');
  const title = document.querySelector('.access-title-form-row .access-title');
  if (!title) return;

  const lines = [
    title.querySelector('.access-title-the'),
    title.querySelector('.access-title-listening'),
    title.querySelector('.access-title-archive')
  ].filter(Boolean);

  if (lines.length !== 3) return;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  let raf = 0;

  function fontMetrics(el) {
    const cs = getComputedStyle(el);
    const fontSize = parseFloat(cs.fontSize) || 16;
    const lineHeight = parseFloat(cs.lineHeight) || fontSize;
    const family = cs.fontFamily;
    const weight = cs.fontWeight;
    const style = cs.fontStyle;

    ctx.font = `${style} ${weight} ${fontSize}px ${family}`;
    const m = ctx.measureText(el.textContent.trim());

    const fontAscent = Number.isFinite(m.fontBoundingBoxAscent)
      ? m.fontBoundingBoxAscent
      : (Number.isFinite(m.actualBoundingBoxAscent) ? m.actualBoundingBoxAscent : fontSize * .8);
    const fontDescent = Number.isFinite(m.fontBoundingBoxDescent)
      ? m.fontBoundingBoxDescent
      : (Number.isFinite(m.actualBoundingBoxDescent) ? m.actualBoundingBoxDescent : fontSize * .2);
    const actualAscent = Number.isFinite(m.actualBoundingBoxAscent) ? m.actualBoundingBoxAscent : fontAscent;
    const actualDescent = Number.isFinite(m.actualBoundingBoxDescent) ? m.actualBoundingBoxDescent : fontDescent;

    const fontBox = fontAscent + fontDescent || fontSize;
    const extraLeading = lineHeight - fontBox;
    const baselineFromTop = extraLeading / 2 + fontAscent;

    return {
      lineHeight,
      inkTop: baselineFromTop - actualAscent,
      inkBottom: baselineFromTop + actualDescent
    };
  }

  function applyEqualVisualGaps() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      lines.forEach(el => el.style.setProperty('margin-top', '0px', 'important'));
      if (!mq.matches) return;

      const metrics = lines.map(fontMetrics);
      const desiredGap = Math.max(3, Math.min(5, window.innerWidth * 0.009));

      for (let i = 1; i < lines.length; i++) {
        const prev = metrics[i - 1];
        const curr = metrics[i];
        const naturalVisualGap = (prev.lineHeight - prev.inkBottom) + curr.inkTop;
        const correction = desiredGap - naturalVisualGap;
        lines[i].style.setProperty('margin-top', `${correction.toFixed(2)}px`, 'important');
      }
    });
  }

  window.addEventListener('resize', applyEqualVisualGaps, { passive: true });
  if (document.fonts?.ready) document.fonts.ready.then(applyEqualVisualGaps);
  applyEqualVisualGaps();
})();
