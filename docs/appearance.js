(() => {
  const button = document.querySelector('#motion-toggle');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let paused = reduced.matches;
  try { paused = paused || localStorage.getItem('cliploom-motion') === 'paused'; } catch {}
  function update() {
    document.body.classList.toggle('motion-paused', paused || reduced.matches);
    button.textContent = paused || reduced.matches ? 'Motion off' : 'Pause motion';
    button.setAttribute('aria-label', paused || reduced.matches ? 'Background motion is off' : 'Pause background motion');
    button.setAttribute('aria-pressed', String(paused || reduced.matches));
  }
  button.onclick = () => { paused = !paused; try { localStorage.setItem('cliploom-motion', paused ? 'paused' : 'on'); } catch {} update(); };
  reduced.addEventListener('change',update);
  update();

  if (!['localhost', '127.0.0.1'].includes(location.hostname) && !document.querySelector('script[src="/_vercel/insights/script.js"]')) {
    const analytics = document.createElement('script');
    analytics.defer = true;
    analytics.src = '/_vercel/insights/script.js';
    document.head.append(analytics);
  }
})();
