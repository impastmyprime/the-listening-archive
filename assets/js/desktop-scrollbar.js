(() => {
  const desktopQuery = window.matchMedia('(min-width: 769px) and (hover: hover) and (pointer: fine)');
  const track = document.getElementById('viewportScrollbar');
  const thumb = document.getElementById('viewportScrollbarThumb');
  if (!track || !thumb) return;

  let rafId = 0;
  let dragging = false;
  let dragStartY = 0;
  let dragStartScrollY = 0;

  const metrics = () => {
    const viewportHeight = window.innerHeight;
    const scrollHeight = Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0
    );
    const trackHeight = Math.max(0, track.clientHeight);
    const maxScroll = Math.max(0, scrollHeight - viewportHeight);
    const proportional = scrollHeight > 0 ? (viewportHeight / scrollHeight) * trackHeight : trackHeight;
    const thumbHeight = Math.min(trackHeight, Math.max(28, proportional));
    const travel = Math.max(0, trackHeight - thumbHeight);
    return { viewportHeight, scrollHeight, trackHeight, maxScroll, thumbHeight, travel };
  };

  const sync = () => {
    rafId = 0;
    if (!desktopQuery.matches) {
      track.style.opacity = '';
      thumb.style.height = '';
      thumb.style.transform = '';
      return;
    }

    const m = metrics();
    if (m.trackHeight <= 0 || m.scrollHeight <= m.viewportHeight + 1) {
      track.style.opacity = '0';
      thumb.style.height = `${m.trackHeight}px`;
      thumb.style.transform = 'translateY(0)';
      return;
    }

    track.style.opacity = '1';
    const progress = m.maxScroll > 0 ? Math.min(1, Math.max(0, window.scrollY / m.maxScroll)) : 0;
    thumb.style.height = `${m.thumbHeight}px`;
    thumb.style.transform = `translateY(${progress * m.travel}px)`;
  };

  const requestSync = () => {
    if (!rafId) rafId = requestAnimationFrame(sync);
  };

  thumb.addEventListener('pointerdown', (event) => {
    if (!desktopQuery.matches || event.button !== 0) return;
    dragging = true;
    dragStartY = event.clientY;
    dragStartScrollY = window.scrollY;
    thumb.classList.add('is-dragging');
    thumb.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  thumb.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const m = metrics();
    if (m.travel <= 0 || m.maxScroll <= 0) return;
    const deltaY = event.clientY - dragStartY;
    const scrollDelta = (deltaY / m.travel) * m.maxScroll;
    window.scrollTo({ top: dragStartScrollY + scrollDelta, behavior: 'auto' });
  });

  const endDrag = (event) => {
    if (!dragging) return;
    dragging = false;
    thumb.classList.remove('is-dragging');
    if (event && thumb.hasPointerCapture?.(event.pointerId)) {
      thumb.releasePointerCapture(event.pointerId);
    }
  };

  thumb.addEventListener('pointerup', endDrag);
  thumb.addEventListener('pointercancel', endDrag);
  window.addEventListener('scroll', requestSync, { passive: true });
  window.addEventListener('resize', requestSync, { passive: true });
  desktopQuery.addEventListener?.('change', requestSync);

  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(requestSync);
    ro.observe(document.documentElement);
    if (document.body) ro.observe(document.body);
  }

  const mo = new MutationObserver(requestSync);
  mo.observe(document.body, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });

  requestSync();
})();
