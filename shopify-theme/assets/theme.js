/* ============================================================
   THEME TOGGLE — dark default, radial-reveal wipe to light/back
   ============================================================ */
(() => {
  const root = document.documentElement;
  const btn = document.getElementById('themeToggle');
  if(!btn) return;
  const saved = localStorage.getItem('neoaid_theme');
  if(saved === 'light') root.setAttribute('data-theme', 'light');

  function applyTheme(next, originX, originY){
    const wipe = document.createElement('div');
    wipe.className = 'theme-wipe ' + (next === 'light' ? 'to-light' : 'to-dark');
    wipe.style.setProperty('--wipe-x', originX + 'px');
    wipe.style.setProperty('--wipe-y', originY + 'px');
    document.body.appendChild(wipe);
    // phase 1: shutter expands to cover
    requestAnimationFrame(() => { wipe.classList.add('phase-expand'); });
    // at peak coverage, swap the theme (behind the curtain)
    setTimeout(() => {
      if(next === 'light') root.setAttribute('data-theme', 'light');
      else root.removeAttribute('data-theme');
      localStorage.setItem('neoaid_theme', next);
      wipe.classList.remove('phase-expand');
      wipe.classList.add('phase-contract');
    }, 550);
    // remove the curtain after it finishes contracting
    setTimeout(() => { wipe.remove(); }, 1150);
  }

  btn.addEventListener('click', (e) => {
    const rect = btn.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next, x, y);
  });
})();

/* ============================================================
   WHIP-SLIDE CHANNEL SWITCH — hero headline cycles with whip blur
   ============================================================ */
(() => {
  const h1 = document.getElementById('heroHead');
  if(!h1) return;
  const CHANNELS = [
    'CHILL<br/><span class="acid">BEYOND</span><br/>THE <span class="blood">LIMIT.</span>',
    '<span style="white-space:nowrap"><span class="acid">日本一</span>ピースな</span><br/><span style="white-space:nowrap"><span class="blood">CBD</span>ショップ</span>',
    'NIIGATA<br/><span class="acid">UNDER</span><br/><span class="blood">GROUND</span>',
    'STAY <span class="acid">PEACE</span><br/>STAY <span class="blood">HIGH</span>',
    '<span class="acid">EST.</span> <span class="blood">2023</span><br/>NEO+AID'
  ];
  let idx = 0;
  function flip(){
    h1.classList.remove('whip-in');
    void h1.offsetWidth; // restart
    h1.classList.add('whip-out');
    setTimeout(() => {
      idx = (idx + 1) % CHANNELS.length;
      h1.innerHTML = CHANNELS[idx];
      h1.classList.remove('whip-out');
      void h1.offsetWidth;
      h1.classList.add('whip-in');
    }, 320);
  }
  function schedule(){
    const t = 4000 + Math.random() * 2500;
    setTimeout(() => { flip(); schedule(); }, t);
  }
  schedule();
})();

/* Product grid is rendered server-side via Liquid in shop-grid section. */

/* ============================================================
   HERO VIDEO — local mp4, scratch-synced. Exposes a YT-API-shaped
   shim so the existing scratch code keeps working unchanged.
   ============================================================ */
let ytPlayer = null, ytReady = false, ytDuration = 0, ytPos = 0, ytPending = false;

(function initBgVideo(){
  const v = document.getElementById('ytFrame');
  if(!v || v.tagName !== 'VIDEO') return;
  const heroVideoEl = document.querySelector('.hero-video');
  v.muted = true; v.loop = true; v.playsInline = true;
  ytPlayer = {
    getCurrentTime: () => v.currentTime || 0,
    getDuration:    () => v.duration || 0,
    seekTo: (t) => { try{ const d = v.duration || 0; if(!d) return;
      let p = ((t % d) + d) % d; v.currentTime = p; }catch(e){} },
    playVideo:  () => { v.play().catch(()=>{}); },
    pauseVideo: () => { try{ v.pause(); }catch(e){} },
    mute: () => { v.muted = true; }
  };
  v.addEventListener('loadedmetadata', () => {
    ytDuration = v.duration || 0;
    ytReady = true;
    if(heroVideoEl) heroVideoEl.classList.add('yt-on');
    v.play().catch(()=>{});
  });
  v.addEventListener('error', () => {
    if(heroVideoEl) heroVideoEl.classList.add('yt-fail');
  });
})();

function ytScheduleSeek(){
  if(ytPending || !ytReady) return;
  ytPending = true;
  requestAnimationFrame(() => {
    ytPending = false;
    if(ytReady && ytDuration > 0){
      try { ytPlayer.seekTo(ytPos); } catch(e){}
    }
  });
}

/* ============================================================
   AUDIO + VINYL SCRATCH (existing) — also drives the video.
   ============================================================ */
(() => {
  const gate = document.getElementById('gate');
  const vinyl = document.getElementById('vinyl');
  const tonearm = document.getElementById('tonearm');
  const btnPlay = document.getElementById('btnPlay');
  const btnStop = document.getElementById('btnStop');
  const vol = document.getElementById('vol');
  const now = document.getElementById('now');

  // ---- PLAYLIST (random shuffle) — URLs injected by Liquid via window.NEO_BGM
  const PLAYLIST = (window.NEO_BGM && window.NEO_BGM.length) ? window.NEO_BGM : [];
  let shuffleQueue = [];
  let currentTrackUrl = '';
  function pickNextTrack(){
    if(shuffleQueue.length === 0){
      shuffleQueue = [...PLAYLIST].sort(() => Math.random() - 0.5);
      // avoid repeating the same track right after itself
      if(shuffleQueue[0] === currentTrackUrl && shuffleQueue.length > 1){
        [shuffleQueue[0], shuffleQueue[1]] = [shuffleQueue[1], shuffleQueue[0]];
      }
    }
    currentTrackUrl = shuffleQueue.shift();
    return currentTrackUrl;
  }
  function trackLabel(url){
    return decodeURIComponent(url.split('/').pop().replace(/\.mp3$/i,''));
  }

  let ctx, gainNode;
  let bufferFwd = null;     // forward AudioBuffer
  let bufferRev = null;     // reverse AudioBuffer
  let duration = 0;
  let position = 0;         // playhead in seconds (forward time)
  let playSource = null;    // active forward source during normal play
  let playStartTime = 0;    // ctx.currentTime when playSource started
  let playStartPos = 0;     // position at start of playSource
  let isPlaying = false;
  let isDragging = false;
  let rotation = 0;         // visual cumulative angle (deg)
  let bufferReady = false;
  let loadingTrack = false;

  async function loadTrack(url){
    loadingTrack = true;
    bufferReady = false;
    try{
      const res = await fetch(encodeURI(url));
      const ab = await res.arrayBuffer();
      bufferFwd = await ctx.decodeAudioData(ab);
      duration = bufferFwd.duration;
      bufferRev = ctx.createBuffer(bufferFwd.numberOfChannels, bufferFwd.length, bufferFwd.sampleRate);
      for(let c = 0; c < bufferFwd.numberOfChannels; c++){
        const src = bufferFwd.getChannelData(c);
        const dst = bufferRev.getChannelData(c);
        const N = src.length;
        for(let i = 0; i < N; i++) dst[i] = src[N - 1 - i];
      }
      bufferReady = true;
      position = 0;
      const nt = document.getElementById('nowText');
      if(nt) nt.textContent = 'NOW SPINNING · ' + trackLabel(url);
    } finally {
      loadingTrack = false;
    }
  }

  async function initAudio(){
    if(ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    gainNode = ctx.createGain();
    gainNode.gain.value = parseFloat(vol.value);
    gainNode.connect(ctx.destination);
    await loadTrack(pickNextTrack());
  }

  async function advanceTrack(){
    if(loadingTrack) return;
    const wasPlaying = isPlaying;
    stopPlaySource();
    await loadTrack(pickNextTrack());
    if(wasPlaying) playForwardFrom(0);
  }

  function currentPosition(){
    if(playSource && isPlaying && !isDragging){
      return Math.min(duration, playStartPos + (ctx.currentTime - playStartTime));
    }
    return position;
  }

  function stopPlaySource(){
    if(playSource){
      const s = playSource;
      playSource = null; // clear first so onended doesn't trigger advance
      try { s.onended = null; } catch(e){}
      try { s.stop(); } catch(e){}
      try { s.disconnect(); } catch(e){}
    }
  }

  function playForwardFrom(pos){
    stopPlaySource();
    if(!bufferReady) return;
    pos = ((pos % duration) + duration) % duration;
    position = pos;
    const src = ctx.createBufferSource();
    src.buffer = bufferFwd;
    src.loop = false;
    src.connect(gainNode);
    src.start(0, pos);
    playSource = src;
    playStartTime = ctx.currentTime;
    playStartPos = pos;
    src.onended = () => {
      if(src !== playSource) return; // stopped manually
      playSource = null;
      if(isPlaying && !isDragging) advanceTrack();
    };
  }

  async function startPlayback(){
    await initAudio();
    try { await ctx.resume(); } catch(e){}
    playForwardFrom(position);
    isPlaying = true;
    btnPlay.textContent = '❚❚';
    vinyl.classList.remove('paused');
    tonearm.classList.add('down');
    now.classList.add('show');
    now.classList.remove('paused');
    requestAnimationFrame(spinLoop);
  }
  function pausePlayback(){
    if(!isPlaying) return;
    position = currentPosition();
    stopPlaySource();
    isPlaying = false;
    btnPlay.textContent = '▶';
    vinyl.classList.add('paused');
    tonearm.classList.remove('down');
    now.classList.add('paused');
  }

  // CSS-free rotation: drive vinyl transform via JS so we control everything
  // Remove CSS spin keyframes by overriding inline transform.
  vinyl.style.animation = 'none';
  let lastFrame = performance.now();
  function spinLoop(now2){
    const dt = (now2 - lastFrame) / 1000;
    lastFrame = now2;
    if(isPlaying && !isDragging){
      rotation += 360 / 1.8 * dt; // matches original 1.8s/rev
    }
    vinyl.style.transform = `rotate(${rotation}deg)`;
    requestAnimationFrame(spinLoop);
  }
  requestAnimationFrame((t)=>{ lastFrame = t; spinLoop(t); });

  // Intro gate — "DROP THE NEEDLE" theatrical opening
  gate.addEventListener('click', async () => {
    // 1) ignite — pulse explodes, logo quakes
    gate.classList.add('dropping');

    // 2) shockwave ring + radial flash
    const ring = document.createElement('div');
    ring.className = 'needle-ring';
    document.body.appendChild(ring);
    const flash = document.createElement('div');
    flash.className = 'needle-flash';
    document.body.appendChild(flash);
    requestAnimationFrame(() => { ring.classList.add('bang'); flash.classList.add('bang'); });

    // 3) status text at ~280ms
    const status = document.createElement('div');
    status.className = 'gate-status';
    status.textContent = '▼ DROPPING THE NEEDLE';
    document.body.appendChild(status);
    setTimeout(() => status.classList.add('show'), 260);

    // 4) curtain bars wipe upward at ~720ms to reveal the page
    const curtain = document.createElement('div');
    curtain.className = 'needle-curtain';
    curtain.innerHTML = '<b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b>';
    document.body.appendChild(curtain);
    setTimeout(() => curtain.classList.add('lift'), 720);

    // 5) kick off audio in parallel (don't block visuals)
    startPlayback().catch(()=>{});

    // 6) cleanup
    setTimeout(() => {
      try{ gate.remove(); }catch(e){}
      try{ flash.remove(); }catch(e){}
      try{ ring.remove(); }catch(e){}
      try{ status.remove(); }catch(e){}
      try{ curtain.remove(); }catch(e){}
    }, 2000);
  }, { once:true });

  btnPlay.addEventListener('click', () => {
    if(isPlaying){ pausePlayback(); if(ytReady) try{ ytPlayer.pauseVideo(); }catch(e){} }
    else        { startPlayback();   if(ytReady) try{ ytPlayer.playVideo(); ytPlayer.mute(); }catch(e){} }
  });
  btnStop.addEventListener('click', () => {
    pausePlayback();
    position = 0;
    if(ytReady) try{ ytPlayer.seekTo(0,true); ytPlayer.pauseVideo(); }catch(e){}
  });
  vol.addEventListener('input', () => {
    if(gainNode) gainNode.gain.value = parseFloat(vol.value);
  });

  // ============ SCRATCH ============
  // Direction rule: cursor moves DOWN or RIGHT → forward. UP or LEFT → reverse.
  // signedDelta = dx + dy (px). Positive→forward, negative→reverse.
  // - rotates the disc by k * signedDelta degrees
  // - advances playhead by m * signedDelta seconds
  // - fires a short grain in the right direction with rate proportional to |velocity|
  let lastX = 0, lastY = 0, lastTs = 0;
  let activeGrains = new Set();

  // pixels → seconds (a 200px drag spans ~1 second of audio)
  const SEC_PER_PX = 1 / 200;
  // pixels → degrees (a 200px drag rotates the disc ~270°)
  const DEG_PER_PX = 270 / 200;
  // grain length
  const GRAIN_SEC = 0.08;

  function pointerXY(e){
    if(e.touches && e.touches[0]) return [e.touches[0].clientX, e.touches[0].clientY];
    return [e.clientX, e.clientY];
  }

  function playGrain(atPos, direction, speed){
    if(!bufferReady) return;
    speed = Math.max(0.3, Math.min(4, speed));
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 0.005);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + GRAIN_SEC);
    if(direction >= 0){
      src.buffer = bufferFwd;
      src.playbackRate.value = speed;
      const offset = ((atPos % duration) + duration) % duration;
      src.connect(g).connect(gainNode);
      src.start(0, offset);
    } else {
      src.buffer = bufferRev;
      src.playbackRate.value = speed;
      // reverse buffer: position p forward = (duration - p) offset in reversed buffer
      const offset = duration - (((atPos % duration) + duration) % duration);
      src.connect(g).connect(gainNode);
      src.start(0, Math.max(0, offset));
    }
    src.stop(ctx.currentTime + GRAIN_SEC + 0.02);
    activeGrains.add(src);
    src.onended = () => { activeGrains.delete(src); try{src.disconnect();}catch(e){} try{g.disconnect();}catch(e){} };
  }

  async function onDown(e){
    e.preventDefault();
    if(!ctx){ await initAudio(); }
    try { await ctx.resume(); } catch(e){}
    // capture LIVE position BEFORE flipping isDragging (currentPosition() short-circuits when dragging)
    const livePos = (playSource && isPlaying)
      ? (playStartPos + (ctx.currentTime - playStartTime))
      : position;
    position = ((livePos % duration) + duration) % duration;
    isDragging = true;
    vinyl.classList.add('dragging');
    stopPlaySource();
    // pause + capture video position
    if(ytReady){
      try { ytPos = ytPlayer.getCurrentTime() || 0; } catch(err){}
      try { ytPlayer.pauseVideo(); } catch(err){}
    }
    const [x, y] = pointerXY(e);
    lastX = x; lastY = y; lastTs = performance.now();
  }
  function onMove(e){
    if(!isDragging) return;
    e.preventDefault();
    const [x, y] = pointerXY(e);
    const now2 = performance.now();
    const dx = x - lastX;
    const dy = y - lastY;
    const dt = Math.max(1, now2 - lastTs);
    const signed = dx + dy;          // up/left negative, down/right positive
    const absMove = Math.abs(signed);
    if(absMove < 0.5){ lastX = x; lastY = y; lastTs = now2; return; }

    // advance playhead
    const dSec = signed * SEC_PER_PX;
    position = position + dSec;
    if(position < 0) position += duration;
    if(position >= duration) position -= duration;

    // rotate visual
    rotation += signed * DEG_PER_PX;

    // grain
    const speed = Math.min(4, Math.max(0.5, (absMove / dt) * 8)); // px/ms → ~rate
    playGrain(position, signed >= 0 ? 1 : -1, speed);

    // drive video — 1px ≈ 1/120 of a second (~1s per 120px drag)
    if(ytReady && ytDuration > 0){
      ytPos += signed / 120;
      if(ytPos < 0) ytPos = ytDuration + ytPos;
      if(ytPos >= ytDuration) ytPos = ytPos % ytDuration;
      ytScheduleSeek();
    }

    lastX = x; lastY = y; lastTs = now2;
  }
  function onUp(){
    if(!isDragging) return;
    isDragging = false;
    vinyl.classList.remove('dragging');
    // resume forward playback from current position
    if(isPlaying){
      playForwardFrom(position);
    }
    // resume video from scrubbed position
    if(ytReady){
      try { ytPlayer.seekTo(ytPos, true); ytPlayer.playVideo(); ytPlayer.mute(); } catch(err){}
    }
  }

  vinyl.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  vinyl.addEventListener('touchstart', onDown, { passive:false });
  window.addEventListener('touchmove', onMove, { passive:false });
  window.addEventListener('touchend', onUp);
})();
